import { describe, expect, it } from "vitest";
import { isChartWidget, widgetLabels, widgetNode } from "../data/editor";
import { chartCategories, chartCatalog } from "../data/chartCatalog";
import { chartSvg } from "../data/chartSvg";
import type { SceneNode } from "../types";

const kinds3d = ["bar3dGrouped", "bar3dStacked", "pie3d", "donut3d", "rose3d", "roseRing3d"] as const;

describe("3D 图表目录", () => {
  it("registers six 3D entries with labels, chips and chart routing", () => {
    const entries = chartCatalog.filter((entry) => entry.category === "3D图表");
    expect(entries.map((entry) => entry.kind)).toEqual(kinds3d);
    for (const entry of entries) {
      expect(widgetLabels[entry.kind]).toBe(entry.label);
      expect(isChartWidget(entry.kind)).toBe(true);
      expect(chartCategories).toContain("3D图表");
    }
  });

  it("creates palette nodes with sample rows and chart defaults", () => {
    for (const kind of kinds3d) {
      const node = widgetNode(kind) as unknown as SceneNode;
      expect(node.widget!.kind).toBe(kind);
      expect(node.name).toBe(widgetLabels[kind]);
      expect(node.widget!.text.length).toBeGreaterThan(0);
      const rows = node.data?.rows as { name: string; value: number }[] | undefined;
      expect(rows?.length).toBeGreaterThan(0);
      expect(node.boxSize?.x).toBe(420);
      expect(node.boxSize?.y).toBe(260);
    }
  });

  it("renders pseudo-3D geometry with faces and depth in svg thumbnails", () => {
    for (const kind of kinds3d) {
      const node = widgetNode(kind) as unknown as SceneNode;
      const svg = chartSvg(node);
      if (kind === "bar3dGrouped" || kind === "bar3dStacked") {
        expect(svg).toContain("<polygon"); // 顶面 / 侧面
        expect(svg).toContain("<rect"); // 正面
      } else {
        expect(svg).toContain("A"); // 椭圆弧
        expect(svg).toContain("opacity=\".55\""); // 挤出侧壁
      }
      expect(svg).not.toContain("NaN");
    }
  });
});
