import { readFileSync } from "node:fs";
import { Builder } from "flatbuffers";
import { describe, expect, it, vi } from "vitest";
import { dispatchCommandResponse, readCommandResponse, type ResponseHandlers } from "../engine/commandResponse";
import { BoardAction, CommandResponse, Event as ResponseEvent, EventPayload, PickEvent } from "../protocol/generated/data-wind-protocol";

const fixture = new Uint8Array(readFileSync(new URL("./fixtures/command_response_v1.bin", import.meta.url)));
const handlers = () => ({ pick: vi.fn(), transform: vi.fn(), stats: vi.fn(), hud: vi.fn(), error: vi.fn(), probe: vi.fn() });

function packet(version: number, eventTypes: EventPayload[] = []): Uint8Array {
  const builder = new Builder(128);
  const events = eventTypes.map((type) => {
    const id = builder.createString("future-pick");
    const payload = PickEvent.createPickEvent(builder, id);
    return ResponseEvent.createEvent(builder, type, payload);
  });
  const vector = CommandResponse.createEventsVector(builder, events);
  const response = CommandResponse.createCommandResponse(builder, version, vector);
  CommandResponse.finishSizePrefixedCommandResponseBuffer(builder, response);
  return builder.asUint8Array();
}

describe("Rust -> TypeScript FlatBuffers CommandResponse", () => {
  it("reads all event fields from the Rust-produced fixture without JSON parsing", () => {
    const sink = handlers();
    const parse = vi.spyOn(JSON, "parse").mockImplementation(() => { throw new Error("JSON must not be used"); });
    try { dispatchCommandResponse(fixture, sink); }
    finally { parse.mockRestore(); }
    expect(sink.pick.mock.calls).toEqual([["模型-α🙂"], [null]]);
    expect(sink.transform).toHaveBeenCalledExactlyOnceWith("model-2", [1.25, -2.5, 300000.125]);
    expect(sink.stats).toHaveBeenCalledExactlyOnceWith({ backend: "GPU", fps: 59.5,
      instances: 1024, visible: 512, particles: 8192, tris: 4294967295 });
    expect(sink.hud).toHaveBeenCalledExactlyOnceWith({ grid: false, flylines: true, stats: false });
    expect(sink.error).toHaveBeenCalledExactlyOnceWith("网格加载失败：资源不存在🙂");
    expect(sink.probe).toHaveBeenCalledExactlyOnceWith([0, 51, 204, 255]);
    expect(sink.pick.mock.invocationCallOrder[1]).toBeLessThan(sink.transform.mock.invocationCallOrder[0]);
    expect(sink.transform.mock.invocationCallOrder[0]).toBeLessThan(sink.stats.mock.invocationCallOrder[0]);
  });

  it("keeps a direct byte view, including a packet inside a larger Uint8Array", () => {
    const storage = new Uint8Array(fixture.byteLength + 40);
    storage.set(fixture, 13);
    const bytes = storage.subarray(13, 13 + fixture.byteLength);
    const response = readCommandResponse(bytes)!;
    expect(response.bb!.bytes()).toBe(bytes);
    expect(response.eventsLength()).toBe(7);
  });

  it("treats zero-byte frames and a valid empty response as no events", () => {
    const sink = handlers();
    expect(readCommandResponse(new Uint8Array())).toBeNull();
    dispatchCommandResponse(new Uint8Array(), sink);
    dispatchCommandResponse(packet(1), sink);
    for (const callback of Object.values(sink)) expect(callback).not.toHaveBeenCalled();
  });

  it("rejects truncated packets, wrong identifiers, invalid offsets and incompatible versions", () => {
    expect(() => readCommandResponse(fixture.subarray(0, 10))).toThrow("响应头不完整");
    expect(() => readCommandResponse(fixture.subarray(0, fixture.byteLength - 1))).toThrow("响应长度不匹配");
    const badIdentifier = fixture.slice(); badIdentifier[8] = 0;
    expect(() => readCommandResponse(badIdentifier)).toThrow("响应标识不匹配");
    const badRoot = fixture.slice(); badRoot.fill(255, 4, 8);
    expect(() => readCommandResponse(badRoot)).toThrow("响应根表越界");
    expect(() => readCommandResponse(packet(0))).toThrow("协议版本不兼容");
    expect(() => readCommandResponse(packet(2))).toThrow("协议版本不兼容");
  });

  it("skips a future union member while still handling the next known event", () => {
    const sink = handlers();
    dispatchCommandResponse(packet(1, [255 as EventPayload, EventPayload.PickEvent]), sink);
    expect(sink.pick).toHaveBeenCalledExactlyOnceWith("future-pick");
  });

  it("propagates the error handler's failure without delivering later events", () => {
    const sink: ResponseHandlers = { ...handlers(), error: (message) => { throw new Error(message); } };
    expect(() => dispatchCommandResponse(fixture, sink)).toThrow("网格加载失败：资源不存在🙂");
    expect(sink.probe).not.toHaveBeenCalled();
  });
});

describe("Rust -> TypeScript FlatBuffers board events", () => {
  const boardFixture = new Uint8Array(readFileSync(new URL("./fixtures/board_events_v1.bin", import.meta.url)));

  it("dispatches board interaction events from the shared DWCR queue", () => {
    const sink = handlers();
    const boardEvents: { id: string; kind: string; action: number; value: unknown }[] = [];
    const parse = vi.spyOn(JSON, "parse").mockImplementation(() => { throw new Error("JSON must not be used"); });
    try { dispatchCommandResponse(boardFixture, { ...sink, boardEvent: (event) => boardEvents.push(event) }); }
    finally { parse.mockRestore(); }
    expect(boardEvents.map((event) => event.action)).toEqual([
      BoardAction.Change, BoardAction.Focus, BoardAction.Open, BoardAction.Media,
      BoardAction.Upload, BoardAction.ColorPicker, BoardAction.Change,
    ]);
    expect(boardEvents[0]).toMatchObject({ id: "btn-1", kind: "button", value: "文本-β🙂" });
    expect(boardEvents[2].value).toBeNull();
    expect(boardEvents[4].value).toEqual(["a.csv", "数据-b.json"]);
    expect(boardEvents[6].value).toEqual(
      { min: 0, max: 86399.5, labels: ["低", "高"], nested: { deep: [1, 2.5, null] } });
    // 3D 引擎回调不得被看板事件误触。
    expect(sink.pick).not.toHaveBeenCalled();
    expect(sink.error).not.toHaveBeenCalled();
  });
});
