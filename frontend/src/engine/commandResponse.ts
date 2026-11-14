import { ByteBuffer } from "flatbuffers";
import { BoardEvent as BoardEventTable, CommandResponse, Event as ResponseEvent, EventPayload,
  ErrorEvent, HudEvent, PickEvent, ProbeEvent, StatsEvent, TransformEvent } from "../protocol/generated/data-wind-protocol";
import { readJsonValue } from "./commands";
import type { EngineStats } from "../types";
import type { HudToggles } from "../state/store";

export const RESPONSE_VERSION = 1;

/** 看板（egui canvas）交互事件，与 3D 引擎事件共用同一条 DWCR 队列。 */
export interface ResponseHandlers {
  pick?(id: string | null): void;
  transform?(id: string, position: [number, number, number]): void;
  stats?(value: EngineStats): void;
  hud?(value: HudToggles): void;
  error?(message: string): void;
  probe?(rgba: [number, number, number, number]): void;
  boardEvent?(event: { id: string; kind: string; action: number; value: unknown }): void;
}

/** Internal Rust-produced packets only; this is not a verifier for arbitrary external files. */
export function readCommandResponse(bytes: Uint8Array): CommandResponse | null {
  if (bytes.byteLength === 0) return null;
  if (bytes.byteLength < 12) throw new Error("引擎响应头不完整");
  const buffer = new ByteBuffer(bytes);
  if (buffer.readUint32(0) !== bytes.byteLength - 4) throw new Error("引擎响应长度不匹配");
  buffer.setPosition(4);
  if (!CommandResponse.bufferHasIdentifier(buffer)) throw new Error("引擎响应标识不匹配");
  const rootOffset = buffer.readUint32(4);
  if (rootOffset < 4 || rootOffset + 8 > bytes.byteLength) throw new Error("引擎响应根表越界");
  const response = CommandResponse.getRootAsCommandResponse(buffer);
  if (response.protocolVersion() !== RESPONSE_VERSION) throw new Error("引擎响应协议版本不兼容，请刷新页面");
  return response;
}

/** Read generated accessors directly; never unpack the packet into a JSON-like object graph. */
export function dispatchCommandResponse(bytes: Uint8Array, handlers: ResponseHandlers): void {
  const response = readCommandResponse(bytes);
  if (!response) return;
  const event = new ResponseEvent();
  for (let i = 0, count = response.eventsLength(); i < count; i += 1) {
    if (!response.events(i, event)) throw new Error("引擎事件缺失");
    switch (event.payloadType()) {
      case EventPayload.PickEvent: {
        const value: PickEvent | null = event.payload(new PickEvent());
        if (!value) throw new Error("拾取响应缺失");
        handlers.pick?.(value.id());
        break;
      }
      case EventPayload.TransformEvent: {
        const value: TransformEvent | null = event.payload(new TransformEvent());
        const id = value?.id();
        const position = value?.position();
        if (id == null || !position) throw new Error("变换响应缺失");
        handlers.transform?.(id, [position.x(), position.y(), position.z()]);
        break;
      }
      case EventPayload.StatsEvent: {
        const value: StatsEvent | null = event.payload(new StatsEvent());
        const backend = value?.backend();
        if (!value || backend == null) throw new Error("统计响应缺失");
        handlers.stats?.({ backend, fps: value.fps(), instances: value.instances(),
          visible: value.visible(), particles: value.particles(), tris: value.triangles() });
        break;
      }
      case EventPayload.HudEvent: {
        const value: HudEvent | null = event.payload(new HudEvent());
        if (!value) throw new Error("HUD 响应缺失");
        handlers.hud?.({ grid: value.grid(), flylines: value.flylines(), stats: value.stats() });
        break;
      }
      case EventPayload.ErrorEvent: {
        const value: ErrorEvent | null = event.payload(new ErrorEvent());
        const message = value?.message();
        if (message == null) throw new Error("错误响应缺失");
        handlers.error?.(message);
        break;
      }
      case EventPayload.ProbeEvent: {
        const value: ProbeEvent | null = event.payload(new ProbeEvent());
        const rgba = value?.rgba();
        if (!rgba) throw new Error("诊断响应缺失");
        handlers.probe?.([rgba.r(), rgba.g(), rgba.b(), rgba.a()]);
        break;
      }
      case EventPayload.BoardEvent: {
        const value: BoardEventTable | null = event.payload(new BoardEventTable());
        const id = value?.id();
        if (!value || id == null) throw new Error("看板事件缺失");
        const payload = value.value();
        handlers.boardEvent?.({
          id,
          kind: value.kind() ?? "",
          action: value.action(),
          value: payload ? readJsonValue(payload) : null,
        });
        break;
      }
      case EventPayload.NONE:
        throw new Error("引擎事件类型缺失");
      default:
        // Future union members may be appended without breaking older readers.
        break;
    }
  }
}
