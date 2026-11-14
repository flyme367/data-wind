import { beforeEach, describe, expect, it } from "vitest";
import * as flatbuffers from "flatbuffers";
import { defaultWater, MAX_SHALLOW_WATERS, MAX_WATERS, validateWater, waterNode, waterPresets } from "../data/water";
import { defaultEditorSettings } from "../data/editor";
import { handle } from "../workers/sceneModel";
import { validateScene } from "../state/projects";
import { decodeProjectSnapshot, encodeProjectSnapshot } from "../state/snapshotCodec";
import { encodeSceneUpdate, encodeSoftwareFrame } from "../engine/commands";
import { CommandRequest, SceneUpdate, SoftwareFrame } from "../protocol/generated/data-wind-protocol";
import { computeViewOrigin, toEngineFlat } from "../engine/viewOrigin";

beforeEach(() => handle({ type: "openProject", projectId: "water", tree: [], template: "empty" }));
describe("water surfaces", () => {
  it.each(waterPresets)("saves and encodes the $name component for both renderers", (preset) => {
    const added = handle({ type: "add", node: waterNode(preset.id) })!;
    expect(added.flat[0].kind).toBe("water");
    const decoded = decodeProjectSnapshot(encodeProjectSnapshot({ name: "水体", savedAt: 1,
      boardSize: { width: 1920, height: 1080 }, scene: added.tree, settings: defaultEditorSettings, params: {} }));
    expect(validateScene(decoded.scene)[0].water).toEqual(added.tree[0].water);
    expect(decoded.scene[0].type).toBe("water");
    const request = CommandRequest.getRootAsCommandRequest(new flatbuffers.ByteBuffer(encodeSceneUpdate(added.flat)));
    const c = (request.payload(new SceneUpdate()) as SceneUpdate).instances(0)!.water()!;
    expect(c.preset()).toBe(preset.id);
    expect(c.waveHeight()).toBeCloseTo(preset.height);
    expect(c.pointsLength()).toBe(4);
    expect(c.points(0)!.x()).toBeCloseTo(-.15);
    expect(c.sources(0)!.rate()).toBe(1);
    const software = CommandRequest.getRootAsCommandRequest(new flatbuffers.ByteBuffer(encodeSoftwareFrame(added.flat,
      { target: [0, 0, 0], yaw: 0, pitch: .7, dist: 80 }, { grid: false, selectedId: null, time: 1 })));
    expect((software.payload(new SoftwareFrame()) as SoftwareFrame).instances(0)!.water()!.preset()).toBe(preset.id);
  });
  it("supports editing, undo, copies, water levels and inherited locks", () => {
    const added = handle({ type: "add", node: waterNode("river") })!;
    const id = added.selectedId!, original = added.tree[0].water!;
    const changed = { ...original, waveSpeed: 3, points: [{ x: -.3, z: -.4 }, { x: .3, z: .4 }] };
    handle({ type: "patch", id, patch: { water: changed } });
    expect(handle({ type: "undo" })!.flat[0].water).toEqual(original);
    expect(handle({ type: "redo" })!.flat[0].water).toEqual(changed);
    handle({ type: "setAxis", id, property: "boxSize", axis: "x", value: 120 });
    expect(handle({ type: "select", id })!.tree[0].transform.position.y).toBe(.3);
    const copied = handle({ type: "duplicate", id })!;
    expect(copied.tree.filter((n) => n.type === "water")).toHaveLength(2);
    expect(copied.tree[1].water).toEqual(changed);
    expect(handle({ type: "toggleVisible", id })!.flat.some((f) => f.id === id)).toBe(false);
    handle({ type: "toggleVisible", id });
    const group = handle({ type: "add", node: { type: "group", name: "水域" } })!.selectedId!;
    handle({ type: "reparent", ids: [id], parentId: group });
    handle({ type: "toggleLocked", id: group });
    expect(handle({ type: "patch", id, patch: { water: original } })).toBeNull();
    expect(handle({ type: "select", id })!.flat.find((f) => f.id === id)!.locked).toBe(true);
  });
  it("limits water and simulation counts across add, duplicate and import", () => {
    let last = "";
    for (let i = 0; i < MAX_SHALLOW_WATERS; i++) last = handle({ type: "add", node: waterNode("shallow") })!.selectedId!;
    expect(handle({ type: "add", node: waterNode("shallow") })).toBeNull();
    expect(handle({ type: "duplicate", id: last })).toBeNull();
    for (let i = MAX_SHALLOW_WATERS; i < MAX_WATERS; i++) handle({ type: "add", node: waterNode("lake") });
    expect(handle({ type: "add", node: waterNode("pool") })).toBeNull();
    const full = handle({ type: "select", id: last })!.tree;
    expect(() => validateScene([...full, { ...structuredClone(full[0]), id: "extra" }])).toThrow();
  });
  it("validates finite parameters, source limits and non-degenerate river paths", () => {
    for (const patch of [{ waveHeight: NaN }, { points: [{ x: 0, z: 0 }, { x: 0, z: 0 }] },
      { sources: [{ x: 1, z: 0, rate: 1, radius: .1 }] }, { transparencyDepth: 0 }, { opacity: 2 }]) {
      expect(() => validateWater({ ...structuredClone(defaultWater), ...patch })).toThrow();
    }
    const node = waterNode("river"); node.transform!.position.x = 10_000_001;
    const added = handle({ type: "add", node })!;
    const origin = computeViewOrigin(added.tree);
    const flat = toEngineFlat(added.flat, origin)[0];
    expect(flat.pos[0]).toBe(0);
    expect(flat.water!.points).toEqual(node.water!.points);
  });
});
