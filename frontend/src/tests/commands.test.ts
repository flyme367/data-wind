import { Builder, ByteBuffer } from "flatbuffers";
import { describe, expect, it, vi } from "vitest";
import {
  COMMAND_VERSION, decodeHitResult, decodeStringList, encodeBoardClock, encodeBoardSync,
  encodeSceneUpdate, encodeSetEnvironment, encodeSetHud, encodeSetMode, encodeSetSelections,
  encodeSetValue, encodeSoftwareFrame, readJsonValue, writeJsonValue,
} from "../engine/commands";
import {
  BoardClock, CommandRequest, CommandPayload, HitResult, Instance, JsonValue, SceneUpdate,
  SetHud, StringList,
} from "../protocol/generated/data-wind-protocol";

/** 解码命令信封（与 Rust decode_request 相同的检查），供往返断言使用。 */
function readRequest(bytes: Uint8Array) {
  expect(bytes.byteLength).toBeGreaterThan(0);
  const buffer = new ByteBuffer(bytes);
  const request = CommandRequest.getRootAsCommandRequest(buffer);
  expect(request.protocolVersion()).toBe(COMMAND_VERSION);
  return request;
}

describe("TypeScript -> Rust command encoders", () => {
  it("keeps JSON.parse/stringify out of the boundary", () => {
    const parse = vi.spyOn(JSON, "parse").mockImplementation(() => { throw new Error("JSON must not be used"); });
    const stringify = vi.spyOn(JSON, "stringify").mockImplementation(() => { throw new Error("JSON must not be used"); });
    try {
      encodeSetMode("editor");
      encodeSetHud({ grid: true, flylines: false, stats: true });
      encodeSetSelections(["a", "b"]);
      encodeSetEnvironment({ background: [0, 0, 0, 1], ground: [0.1, 0.2, 0.3, 0], daylight: 0.8, fogDistance: 5000 });
      encodeSceneUpdate([{ id: "α", kind: "box", pos: [1, 2, 3], size: [4, 5, 6], rotY: 0.5, color: [1, 1, 1] }]);
      encodeSetValue("input", "中文🙂");
    } finally {
      parse.mockRestore();
      stringify.mockRestore();
    }
  });

  it("round-trips the SetHud payload type and flags", () => {
    const request = readRequest(encodeSetHud({ grid: false, flylines: true, stats: false }));
    expect(request.payloadType()).toBe(CommandPayload.SetHud);
    const payload = request.payload(new SetHud())!;
    expect([payload.grid(), payload.flylines(), payload.stats()]).toEqual([false, true, false]);
  });

  it("round-trips scene instances including optional fields", () => {
    const request = readRequest(encodeSceneUpdate([
      { id: "box-α🙂", kind: "mesh", pos: [1.5, 2, -3.25], size: [4, 5, 6], rotY: 0.5,
        rotation: [0.25, 0.5, 0.75], color: [0.25, 0.5, 0.75], locked: true, modelId: "model-1" },
      { id: "plain", kind: "marker", pos: [0, 0, 0], size: [1, 1, 1], rotY: 0, color: [1, 0, 0],
        to: [9, 9, 9] },
    ]));
    const payload = request.payload(new SceneUpdate())!;
    expect(payload.instancesLength()).toBe(2);
    const first = payload.instances(0, new Instance())!;
    expect(first.id()).toBe("box-α🙂");
    expect(first.kind()).toBe("mesh");
    const pos = first.pos()!;
    expect([pos.x(), pos.y(), pos.z()]).toEqual([1.5, 2, -3.25]);
    expect([first.rotation(0), first.rotation(1), first.rotation(2)]).toEqual([0.25, 0.5, 0.75]);
    expect(first.locked()).toBe(true);
    expect(first.modelId()).toBe("model-1");
    const second = payload.instances(1, new Instance())!;
    expect(second.rotationLength()).toBe(0);
    expect(second.modelId()).toBeNull();
    expect(second.to(2)).toBe(9);
  });

  it("round-trips generic JSON values through the recursive union", () => {
    const builder = new Builder(128);
    const offset = writeJsonValue(builder, {
      min: 0, max: 86_399.5, flag: true, label: "低🙂", none: null,
      rows: [{ name: "温度", value: 36 }, [1, 2.5]],
    });
    builder.finish(offset);
    const value = JsonValue.getRootAsJsonValue(new ByteBuffer(builder.asUint8Array()));
    expect(readJsonValue(value)).toEqual({
      min: 0, max: 86_399.5, flag: true, label: "低🙂", none: null,
      rows: [{ name: "温度", value: 36 }, [1, 2.5]],
    });
  });

  it("encodes board sync nodes with widget styles and data", () => {
    const bytes = encodeBoardSync({
      width: 1600, height: 900, preview: true, selected: ["widget-1"],
      nodes: [{ id: "widget-1", name: "测试组件", x: 10, y: 20, width: 360, height: 220,
        rotation: 15, color: "#6cbcff", locked: true,
        widget: { kind: "slider", text: "温度", fontSize: 24, opacity: 1, borderStyle: "solid" },
        data: { min: 0, max: 100, checked: false, rows: [{ name: "a", value: 1 }] } }],
    });
    const request = readRequest(bytes);
    expect(request.payloadType()).toBe(CommandPayload.BoardSync);
  });

  it("round-trips the board clock", () => {
    const request = readRequest(encodeBoardClock({
      time: "12:34:56", year: 2026, month: 11, day: 1, firstWeekday: 0, days: 30,
      now: 1_793_500_000_000,
    }));
    const payload = request.payload(new BoardClock())!;
    expect(payload.time()).toBe("12:34:56");
    expect(payload.year()).toBe(2026);
    expect(payload.now()).toBe(1_793_500_000_000);
  });

  it("encodes the software frame envelope with camera and options", () => {
    const request = readRequest(encodeSoftwareFrame(
      [{ id: "cube", kind: "box", pos: [0, 0, 0], size: [5, 5, 5], rotY: 0, color: [0.3, 0.6, 0.9] }],
      { target: [0, 0, 0], yaw: 0.75, pitch: 0.55, dist: 15 },
      { grid: true, selectedId: "cube", time: 1, background: "#101a2c", daylight: 1 },
    ));
    expect(request.payloadType()).toBe(CommandPayload.SoftwareFrame);
  });

  it("decodes small standalone outbound buffers", () => {
    const builder = new Builder(128);
    const items = builder.createString("nw");
    const hit = HitResult.createHitResult(builder, builder.createString("widget-1"), items, true);
    builder.finish(hit);
    expect(decodeHitResult(builder.asUint8Array()))
      .toEqual({ id: "widget-1", handle: "nw", control: true });
    expect(decodeHitResult(new Uint8Array())).toBeNull();

    const listBuilder = new Builder(128);
    const labels = ["text", "slider"].map(item => listBuilder.createString(item));
    const list = StringList.createStringList(listBuilder,
      StringList.createItemsVector(listBuilder, labels));
    listBuilder.finish(list);
    expect(decodeStringList(listBuilder.asUint8Array())).toEqual(["text", "slider"]);
  });
});
