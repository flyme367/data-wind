import { describe, expect, it } from "vitest";
import { widgetLabels, widgetNode } from "../data/editor";
import { controlCatalog, controlCategories, matchesControlEntry, usedControlCategories } from "../data/controlCatalog";

describe("山海鲸「控件」组件目录", () => {
  it("已支持的控件按山海鲸默认控件的顺序展示", () => {
    expect(controlCatalog.map((entry) => entry.kind)).toEqual([
      "dropdown", "groupPanel", "list", "button", "dialog", "tabs", "menuVertical", "menuHorizontal",
      "search", "progress", "iframe", "weather", "clock", "calendar", "timer", "timeline", "shape",
      "timePicker", "timeRange", "twin2d", "checkbox", "input", "switch", "slider", "timeProgress", "colorPicker", "upload", "tree",
    ]);
  });

  it("chips 全部有素材且 kind 不重复", () => {
    expect(usedControlCategories).toEqual(controlCategories);
    expect(new Set(controlCatalog.map((entry) => entry.kind)).size).toBe(controlCatalog.length);
    for (const entry of controlCatalog) {
      expect(widgetLabels[entry.kind]).toBe(entry.label);
      expect(widgetNode(entry.kind).name).toBe(entry.label);
    }
  });

  it("基础时间仍可通过原名称搜索", () => {
    const clock = controlCatalog.find((entry) => entry.kind === "clock")!;
    expect(matchesControlEntry(clock, "时钟")).toBe(true);
    expect(matchesControlEntry(clock, "基础时间")).toBe(true);
    expect(matchesControlEntry(clock, "列表")).toBe(false);
  });
});
