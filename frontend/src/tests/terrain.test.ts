import { beforeEach, describe, expect, it } from "vitest";
import * as flatbuffers from "flatbuffers";
import { defaultTerrain, terrainNode, validateTerrain } from "../data/terrain";
import { defaultEditorSettings } from "../data/editor";
import { handle } from "../workers/sceneModel";
import { validateScene } from "../state/projects";
import { decodeProjectSnapshot, encodeProjectSnapshot } from "../state/snapshotCodec";
import { encodeSceneUpdate } from "../engine/commands";
import { CommandRequest, SceneUpdate } from "../protocol/generated/data-wind-protocol";
import { computeViewOrigin, toEngineFlat } from "../engine/viewOrigin";

beforeEach(() => handle({ type: "openProject", projectId: "terrain", tree: [], template: "empty" }));

describe("editable terrain", () => {
  it("can restore a preset and reopen it without a null heightmap in the snapshot", () => {
    const node = terrainNode();
    node.terrain!.heightmap = { name: "flat.png", resolution: 33, samples: Array(33 * 33).fill(32768) };
    const id = handle({ type: "add", node })!.selectedId!;
    const restored = handle({ type: "patch", id, patch: { terrain: { ...node.terrain!, heightmap: undefined } } })!;
    const decoded = decodeProjectSnapshot(encodeProjectSnapshot({
      name: "地表", savedAt: 1, boardSize: { width: 1920, height: 1080 }, scene: restored.tree,
      settings: defaultEditorSettings, params: {},
    }));
    expect(() => validateScene(decoded.scene)).not.toThrow();
    expect(decoded.scene[0].terrain!.heightmap).toBeUndefined();
  });

  it("persists imported heights through snapshots and the actual engine command", () => {
    const node = terrainNode("snow");
    node.terrain!.heightmap = { name: "高度.png", resolution: 33,
      samples: Array.from({ length: 33 * 33 }, (_, i) => i % 65536) };
    const created = handle({ type: "add", node })!;
    const scene = validateScene(created.tree);
    const decoded = decodeProjectSnapshot(encodeProjectSnapshot({
      name: "地表", savedAt: 1, boardSize: { width: 1920, height: 1080 }, scene,
      settings: defaultEditorSettings, params: {},
    }));
    expect(decoded.scene[0].terrain).toEqual(scene[0].terrain);
    expect(decoded.scene[0].type).toBe("terrain");
    expect(decoded.scene[0].transform.position.y).toBeCloseTo(scene[0].transform.position.y, 4);
    const wire = CommandRequest.getRootAsCommandRequest(new flatbuffers.ByteBuffer(encodeSceneUpdate(created.flat)));
    const terrain = (wire.payload(new SceneUpdate()) as SceneUpdate).instances(0)!.terrain()!;
    expect(terrain.preset()).toBe("snow");
    expect(terrain.levels()).toBe(6);
    expect(terrain.resolution()).toBe(33);
    expect(Array.from(terrain.heightsArray()!)).toEqual(node.terrain!.heightmap.samples);
  });

  it("supports height edits, undo, visibility and inherited locks", () => {
    const added = handle({ type: "add", node: terrainNode() })!;
    const id = added.selectedId!;
    handle({ type: "setAxis", id, property: "boxSize", axis: "y", value: 48 });
    const resized = handle({ type: "select", id })!.tree[0];
    expect(resized.transform.position.y - resized.boxSize!.y / 2).toBeCloseTo(.03);
    handle({ type: "patch", id, patch: { terrain: { ...defaultTerrain, seed: 123 } } });
    expect(handle({ type: "undo" })!.flat[0].terrain!.seed).toBe(42);
    expect(handle({ type: "redo" })!.flat[0].terrain!.seed).toBe(123);
    expect(handle({ type: "toggleVisible", id })!.flat).toEqual([]);
    handle({ type: "toggleVisible", id });
    const group = handle({ type: "add", node: { type: "group", name: "地表组" } })!.selectedId!;
    handle({ type: "reparent", ids: [id], parentId: group });
    handle({ type: "toggleLocked", id: group });
    expect(handle({ type: "patch", id, patch: { terrain: { ...defaultTerrain, seed: 1 } } })).toBeNull();
    const shown = handle({ type: "select", id })!;
    expect(shown.flat[0].locked).toBe(true);
    expect(handle({ type: "toggleVisible", id: group })!.flat).toEqual([]);
  });

  it("rejects malformed heightmaps and maintains precision at large world coordinates", () => {
    const legacy: unknown = { ...defaultTerrain, collision: undefined };
    validateTerrain(legacy);
    expect(legacy.collision).toBe(false);
    expect(() => validateTerrain({ ...defaultTerrain, heightmap: { name: "bad", resolution: 257, samples: [NaN] } })).toThrow();
    expect(() => validateTerrain({ ...defaultTerrain, levels: 99 })).toThrow();
    const node = terrainNode();
    node.transform!.position.x = 10_000_001;
    const added = handle({ type: "add", node })!;
    const origin = computeViewOrigin(added.tree);
    expect(origin.x).toBe(10_000_001);
    expect(toEngineFlat(added.flat, origin)[0].pos[0]).toBe(0);
  });
});
