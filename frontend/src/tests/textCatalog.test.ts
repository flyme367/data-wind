import { describe, expect, it } from "vitest";
import { dataChangeArrow, dataChangeTrend, tableGrid, widgetNode, wordCloudLayout } from "../data/editor";
import { chartRows } from "../data/chartSvg";
import { textCatalog, textPaletteNode, textCategories, usedTextCategories } from "../data/textCatalog";

describe("山海鲸「文本」组件目录", () => {
  it("包含 11 个组件且分类 chips 全部有素材", () => {
    expect(textCatalog).toHaveLength(11);
    expect(new Set(textCatalog.map((entry) => entry.label)).size).toBe(textCatalog.length);
    expect(usedTextCategories).toEqual(textCategories);
  });

  it("目录覆盖字段落到 textPaletteNode 生成的节点上", () => {
    const metric = textPaletteNode(textCatalog[0]!);
    expect(metric.widget!.kind).toBe("metric");
    expect(metric.widget!.text).toBe("");
    expect(metric.widget!.value).toBe("12345");
    expect(metric.boxSize).toMatchObject({ x: 220, y: 110 });

    const up = textPaletteNode(textCatalog.find((entry) => entry.label === "数据变化-上升")!);
    expect(up.data).toMatchObject({ change: "+50%", showValue: false });

    const flip = textPaletteNode(textCatalog.find((entry) => entry.label === "翻牌器")!);
    expect(flip.widget!.value).toBe("123.45");
    expect(flip.widget!.text).toBe("");
  });

  it("数据变化三个预设分别对应持平 / 上升 / 下降", () => {
    const trendOf = (label: string) => dataChangeTrend(String(textPaletteNode(textCatalog.find((entry) => entry.label === label)!).data?.change));
    expect(trendOf("数据变化-保持不变")).toBe("flat");
    expect(trendOf("数据变化-上升")).toBe("up");
    expect(trendOf("数据变化-下降")).toBe("down");
    expect(dataChangeArrow).toEqual({ up: "↑", down: "↓", flat: "—" });
  });

  it("表格 / 报表 / 词云 / 多行文本预设可直接落画布", () => {
    const table = widgetNode("tableBasic");
    expect(tableGrid(table as never).columns).toEqual(["姓名", "年龄", "性别"]);
    expect(widgetNode("tableIndex").name).toBe("基础表格（含序号列）");
    const report = widgetNode("report");
    expect(report.boxSize).toMatchObject({ x: 520, y: 300 });
    expect(report.widget!.background).toBe("#fdfdfb");
    expect(wordCloudLayout(chartRows(widgetNode("wordCloud") as never)).length).toBeGreaterThan(0);
    expect(widgetNode("textMultiline").widget!.text).toContain("\n");
  });

  it("dataChangeTrend 兼容无符号正数与 +0", () => {
    expect(dataChangeTrend("0%")).toBe("flat");
    expect(dataChangeTrend("12.6%")).toBe("up");
    expect(dataChangeTrend("+0%")).toBe("up");
    expect(dataChangeTrend("-8.2%")).toBe("down");
  });

  it("wordCloudLayout 字号随 value 归一化且颜色循环", () => {
    const layout = wordCloudLayout([{ name: "a", value: 100 }, { name: "b", value: 50 }, { name: "c", value: 0 }], 10, 40);
    expect(layout.map((item) => item.size)).toEqual([40, 25, 10]);
    expect(layout[0]!.color).not.toBe(layout[1]!.color);
  });
});
