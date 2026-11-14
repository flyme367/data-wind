import { describe, expect, it } from "vitest";
import {
  computeViewOrigin,
  fromEnginePoint,
  toEngineFlat,
  toEnginePoint,
  VIEW_ORIGIN_THRESHOLD,
  ZERO_ORIGIN,
} from "../engine/viewOrigin";
import type { SceneNode } from "../types";

function placedNode(type: SceneNode["type"], x: number, z: number, extra: Partial<SceneNode> = {}): SceneNode {
  return {
    id: `${type}-${x}-${z}`,
    name: type,
    type,
    visible: true,
    locked: false,
    parentId: null,
    transform: { position: { x, y: 1, z }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    color: "#FFFFFF",
    boxSize: { x: 1, y: 1, z: 1 },
    ...extra,
  };
}

describe("computeViewOrigin", () => {
  it("returns zero for empty and small scenes", () => {
    expect(computeViewOrigin([])).toEqual(ZERO_ORIGIN);
    expect(computeViewOrigin([placedNode("model", 120, -80)])).toEqual(ZERO_ORIGIN);
    expect(computeViewOrigin([placedNode("model", VIEW_ORIGIN_THRESHOLD, 0)])).toEqual(ZERO_ORIGIN);
  });

  it("centers a far-away scene on XZ and keeps Y untouched", () => {
    const origin = computeViewOrigin([
      placedNode("model", 1_000_000, 500_000),
      placedNode("model", 1_000_040, 500_020),
    ]);
    expect(origin).toEqual({ x: 1_000_020, z: 500_010 });
  });

  it("includes flyline endpoints and ignores non-renderable nodes", () => {
    const origin = computeViewOrigin([
      placedNode("model", 0, 0),
      placedNode("flyline", 0, 0, { to: { x: 900_000, y: 0, z: 0 } }),
      placedNode("widget", 8_000_000, 8_000_000),
      placedNode("camera", 8_000_000, 8_000_000),
      placedNode("light", 8_000_000, 8_000_000),
      placedNode("group", 8_000_000, 8_000_000),
    ]);
    expect(origin.x).toBe(450_000);
    expect(origin.z).toBe(0);
  });

  it("skips nodes with non-finite positions", () => {
    const broken = placedNode("model", 0, 0);
    broken.transform.position.x = Number.NaN;
    expect(computeViewOrigin([broken])).toEqual(ZERO_ORIGIN);
  });
});

describe("engine-space conversions", () => {
  const origin = { x: 1_000_020, z: 500_010 };

  it("shifts points both ways and round-trips", () => {
    const world: [number, number, number] = [1_000_013.5, 4, 500_004.25];
    const engine = toEnginePoint(world, origin);
    expect(engine[0]).toBeCloseTo(-6.5, 10);
    expect(engine[1]).toBe(4);
    expect(engine[2]).toBeCloseTo(-5.75, 10);
    expect(fromEnginePoint(engine, origin)[0]).toBeCloseTo(world[0], 10);
    expect(fromEnginePoint(engine, origin)[2]).toBeCloseTo(world[2], 10);
  });

  it("returns the input untouched at zero origin", () => {
    const point: [number, number, number] = [3, 4, 5];
    expect(toEnginePoint(point, ZERO_ORIGIN)).toBe(point);
    expect(fromEnginePoint(point, ZERO_ORIGIN)).toBe(point);
  });

  it("shifts flat instances without mutating the input", () => {
    const flat = [
      { id: "a", kind: "box" as const, pos: [1_000_000, 2, 500_000] as [number, number, number], size: [1, 1, 1] as [number, number, number], rotY: 0, color: [1, 1, 1] as [number, number, number] },
      { id: "b", kind: "flyline" as const, pos: [1_000_000, 2, 500_000] as [number, number, number], size: [0.3, 0.3, 0.3] as [number, number, number], rotY: 0, color: [1, 1, 1] as [number, number, number], to: [1_000_040, 4, 500_020] as [number, number, number] },
    ];
    const shifted = toEngineFlat(flat, origin);
    expect(flat[0].pos).toEqual([1_000_000, 2, 500_000]);
    expect(shifted).not.toBe(flat);
    expect(shifted[0].pos[0]).toBeCloseTo(-20, 10);
    expect(shifted[1].to![0]).toBeCloseTo(20, 10);
    expect(shifted[1].to![2]).toBeCloseTo(10, 10);
    expect(shifted[0].id).toBe("a");
  });

  it("returns the same flat array at zero origin", () => {
    const flat: never[] = [];
    expect(toEngineFlat(flat, ZERO_ORIGIN)).toBe(flat);
  });
});
