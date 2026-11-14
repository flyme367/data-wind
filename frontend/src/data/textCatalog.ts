import { widgetNode, type WidgetConfig, type WidgetKind } from "./editor";

export interface TextCatalogEntry {
  kind: WidgetKind;
  label: string;
  category: string;
  /** 相对 widgetNode(kind) 预设的组件字段覆盖（标题 / 数值 / 字号等） */
  widget?: Partial<WidgetConfig>;
  /** 相对预设的 data 覆盖（变化值、表格列行等） */
  data?: Record<string, unknown>;
  /** 覆盖预设默认尺寸 [宽, 高] */
  size?: [number, number];
}

/** 山海鲸「文本」分类的 chips，顺序即展示顺序，「全部」始终在首位。 */
export const textCategories = [
  "全部", "指标卡", "数据表格", "数据变化", "单行文本", "多行文本", "词云", "翻牌器",
] as const;

/** 文本素材目录：对齐山海鲸「文本」分类的 11 个组件，label 沿用其命名。 */
export const textCatalog: TextCatalogEntry[] = [
  { kind: "metric", label: "基础普通指标卡", category: "指标卡", widget: { text: "", value: "12345", unit: "" }, size: [220, 110] },
  { kind: "tableBasic", label: "基础数据表格", category: "数据表格" },
  { kind: "report", label: "中国式报表", category: "数据表格" },
  { kind: "tableIndex", label: "基础表格（含序号列）", category: "数据表格" },
  { kind: "dataChange", label: "数据变化-保持不变", category: "数据变化", widget: { text: "", value: "", unit: "", fontSize: 30 }, data: { change: "0%", showValue: false }, size: [200, 100] },
  { kind: "dataChange", label: "数据变化-上升", category: "数据变化", widget: { text: "", value: "", unit: "", fontSize: 30 }, data: { change: "+50%", showValue: false }, size: [200, 100] },
  { kind: "dataChange", label: "数据变化-下降", category: "数据变化", widget: { text: "", value: "", unit: "", fontSize: 30 }, data: { change: "-50%", showValue: false }, size: [200, 100] },
  { kind: "text", label: "基础单行文本", category: "单行文本", widget: { text: "双击修改文字" } },
  { kind: "textMultiline", label: "基础多行文本", category: "多行文本" },
  { kind: "wordCloud", label: "基础词云", category: "词云" },
  { kind: "flipCounter", label: "翻牌器", category: "翻牌器", widget: { text: "", value: "123.45", unit: "" }, size: [260, 90] },
];

/** 有素材的分类才会显示对应 chip。 */
export const usedTextCategories = textCategories.filter((category) =>
  category === "全部" || textCatalog.some((entry) => entry.category === category));

/** 目录项 → 场景节点：以 widgetNode(kind) 预设为底，套用目录覆盖字段，点击添加与缩略图共用。 */
export function textPaletteNode(entry: TextCatalogEntry) {
  const node = widgetNode(entry.kind);
  if (entry.widget) node.widget = { ...node.widget!, ...entry.widget };
  if (entry.data) node.data = { ...node.data, ...entry.data };
  if (entry.size) node.boxSize = { x: entry.size[0], y: entry.size[1], z: 1 };
  return node;
}
