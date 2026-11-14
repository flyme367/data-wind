import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { boardClock, boardNodes, boardUsesSecondClock } from "../engine/boardScene";
import { widgetLabels, widgetNode } from "../data/editor";
import { resolveRuntimeScene } from "../data/runtimeScene";
import type { SceneNode } from "../types";

function component(id: string, extra: Partial<SceneNode> = {}): SceneNode {
  return { id, visible: true, locked: false, parentId: null, ...widgetNode("text"), ...extra } as SceneNode;
}

describe("Rust board boundary", () => {
  it("keeps the entire frontend catalog covered by Rust", () => {
    const rust = readFileSync(new URL("../../../engine-rs/data-wind-cpu/src/board/mod.rs", import.meta.url), "utf8");
    const catalog = rust.split("pub const WIDGET_KINDS: &[&str] = &[")[1]!.split("];", 1)[0]!;
    expect([...catalog.matchAll(/"([A-Za-z0-9]+)"/g)].map(match => match[1]).sort())
      .toEqual(Object.keys(widgetLabels).sort());
  });
  it("filters hidden ancestors and preserves resolved bindings and layer order", () => {
    const hidden = component("hidden", { visible: false, type: "group", widget: undefined });
    const child = component("child", { parentId: hidden.id });
    const first = component("first", { data: { text: "静态" }, bindings: { text: "text" } });
    const last = component("last", { transform: { ...first.transform, position: { x: 200, y: 100, z: 0 } } });
    const resolved = resolveRuntimeScene([hidden, child, first, last], { first: { text: "实时设备" } }, { last: { color: "#ff0000" } });
    const nodes = boardNodes(resolved);
    expect(nodes.map(node => node.id)).toEqual(["first", "last"]);
    expect(nodes[0].widget.text).toBe("实时设备");
    expect(nodes[1]).toMatchObject({ x: 200, y: 100, color: "#ff0000" });
  });
  it("passes local time and calendar metadata without implementing widget geometry in JS", () => {
    const now = new Date(2026, 10, 1, 12, 34, 56);
    expect(boardClock(now)).toMatchObject({ year: 2026, month: 11, day: 1,
      firstWeekday: 0, days: 30, now: now.getTime() });
  });
  it("requests second-based redraws only for clock-dependent widgets", () => {
    for (const kind of ["clock", "timer", "calendar"]) expect(boardUsesSecondClock(kind)).toBe(true);
    for (const kind of ["text", "image", "carousel", "mapTrack"]) {
      expect(boardUsesSecondClock(kind)).toBe(false);
    }
  });
});
