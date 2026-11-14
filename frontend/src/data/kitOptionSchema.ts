import referenceDefinitions from "./kitOptionDefinitions.json";
import pieceDefinitions from "./kitPieceOptionDefinitions.json";

/** Raw suite options stay in their original shape; metadata only describes their editor. */
export interface KitOptionDefinition {
  label: string;
  group: string;
  tab?: "style" | "data";
  type?: "text" | "number" | "boolean" | "color" | "palette" | "select" | "font" | "file" | "field" | "json";
  options?: { label: string; value: string | number }[];
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: unknown;
  hidden?: boolean;
  nested?: boolean;
  children?: string[];
  visibleWhen?: { key: string; equals?: unknown; notEquals?: unknown };
}

interface KitOptionSource {
  definitions: Record<string, Record<string, KitOptionDefinition>>;
  inheritance: Record<string, string>;
  components: Record<string, { name: string; version: string }>;
  privateData?: Record<string, {
    fields: { uid: string; alias?: string; type?: string }[];
    rows: Record<string, unknown>[];
  }>;
}
const { definitions, inheritance, components, privateData } = referenceDefinitions as KitOptionSource;

function withParent(type: string, seen = new Set<string>()): Record<string, KitOptionDefinition> {
  if (seen.has(type)) return {};
  seen.add(type);
  const parent = inheritance[type];
  const inherited = parent ? withParent(parent, seen) : {};
  const own = definitions[type] ?? {};
  for (const [key, definition] of Object.entries(own)) {
    inherited[key] = { ...inherited[key], ...definition };
  }
  return inherited;
}

/** Literal configuration from the component and its inherited reference definitions. */
export const kitOptionDefinitionsByType: Record<string, Record<string, KitOptionDefinition>> = Object.fromEntries(
  Object.keys(components).map(type => [type, { ...definitions["@common"], ...withParent(type) }]),
);
// The reference builds its time-format choices from the current date at runtime.
const clockFormats = ["YYYY-MM-DD HH:mm:ss", "YYYY年MM月DD日", "YYYY年MM月", "YYYY年", "MM月", "DD日",
  "HH:mm:ss", "mm分ss秒", "ss秒"];
const clockExample = new Date();
const clockParts: Record<string, string> = { YYYY: String(clockExample.getFullYear()),
  MM: String(clockExample.getMonth() + 1).padStart(2, "0"), DD: String(clockExample.getDate()).padStart(2, "0"),
  HH: String(clockExample.getHours()).padStart(2, "0"), mm: String(clockExample.getMinutes()).padStart(2, "0"),
  ss: String(clockExample.getSeconds()).padStart(2, "0") };
const clockFields = kitOptionDefinitionsByType["widget.basic.timer-v2"];
if (clockFields?.["time-format"]) clockFields["time-format"] = { ...clockFields["time-format"], options: [
  ...clockFormats.map(value => ({ value, label: value.replace(/YYYY|MM|DD|HH|mm|ss/g, token => clockParts[token]!) })),
  { value: "customise", label: "自定义" },
] };
// The table declares these inherited switches without their labels or control types.
const tableSelectionFields = kitOptionDefinitionsByType["widget.basic.table-v3"];
if (tableSelectionFields) {
  for (const key of ["selection-out", "selection-in"]) {
    tableSelectionFields[key] = { ...definitions["@common"]![key]!, ...tableSelectionFields[key],
      label: definitions["@common"]![key]!.label, group: "选中传递", type: "boolean", defaultValue: false };
  }
  if (tableSelectionFields["selection-fields"])
    tableSelectionFields["selection-fields"] = { ...tableSelectionFields["selection-fields"], group: "选中传递" };
}
// These fields are inherited as hidden by the extracted axis schema, although
// the corresponding reference charts expose them in their ranking-text tab.
export const kitRankingTypes = new Set([
  "widget.echarts.column", "widget.echarts.column-stack", "widget.echarts.histogram",
  "widget.echarts.bar", "widget.echarts.bar-stack", "widget.echarts.line", "widget.echarts.area",
  "widget.echarts.area-stack", "widget.echarts.biaxial", "widget.echarts.biaxial-stack", "widget.echarts.biaxial-reverse",
]);
export const kitRankingKeys = new Set([
  "ranking-text", "ranking-text-font", "ranking-text-distance", "ranking-text-template", "show-text-type",
  "ranking-text-show-number", "ranking-text-background", "ranking-text-background-shape-type",
  "ranking-text-background-image", "ranking-text-background-color", "ranking-text-background-width",
  "ranking-text-background-height", "ranking-text-fommater-type",
]);
for (const type of kitRankingTypes) {
  const fields = kitOptionDefinitionsByType[type];
  if (!fields) continue;
  for (const key of kitRankingKeys) {
    if (fields[key]) fields[key] = { ...fields[key], hidden: false, group: "图形文本" };
  }
}
// The axis schema marks the right-axis fields hidden even though the reference
// editor exposes them for line, area and dual-axis charts.
for (const type of ["widget.echarts.line", "widget.echarts.area", "widget.echarts.biaxial",
  "widget.echarts.biaxial-stack", "widget.echarts.biaxial-reverse"]) {
  const fields = kitOptionDefinitionsByType[type];
  if (!fields) continue;
  for (const [key, label] of Object.entries({ "tooltip-right-text-type": "右侧 Y 轴数据显示格式",
    "tooltip-right-decimal-places": "右侧 Y 轴小数位数", "tooltip-right-complete-zero": "右侧 Y 轴小数补零" })) {
    if (fields[key]) fields[key] = { ...fields[key], label, group: "提示信息", hidden: false };
  }
}
for (const [type, fields] of Object.entries(kitOptionDefinitionsByType)) {
  if (!type.startsWith("widget.echarts.")) continue;
  let ancestor: string | undefined = type;
  const seen = new Set<string>();
  while (ancestor && ancestor !== "widget.echarts.axis" && !seen.has(ancestor)) {
    seen.add(ancestor); ancestor = inheritance[ancestor];
  }
  if (ancestor === "widget.echarts.axis") {
    for (const [key, definition] of Object.entries(fields)) {
      if (definition.group === "axis") fields[key] = { ...definition, group: "轴" };
    }
    for (const [key, label] of Object.entries({ "tooltip-unit-name": "显示单位名称", "tooltip-unit-y": "Y 轴单位名称",
      "tooltip-unit-color": "单位颜色", "tooltip-unit-size": "单位字体大小" })) {
      if (fields[key]) fields[key] = { ...fields[key], label, group: "提示信息", hidden: false };
    }
    if (["widget.echarts.line", "widget.echarts.area", "widget.echarts.biaxial", "widget.echarts.biaxial-stack",
      "widget.echarts.biaxial-reverse"].includes(type) && fields["tooltip-unit-yRight"]) {
      fields["tooltip-unit-yRight"] = { ...fields["tooltip-unit-yRight"], label: "右侧 Y 轴单位名称", group: "提示信息", hidden: false };
    }
  }
  for (const [key, definition] of Object.entries(fields)) {
    if (/^(tooltip(?:-|$)|(?:show-)?cross-hairs-)/.test(key)) fields[key] = { ...definition, group: "提示信息" };
  }
}
// The axis base hides right-axis controls; line, area and dual-axis widgets expose them.
for (const type of ["widget.echarts.line", "widget.echarts.area", "widget.echarts.biaxial",
  "widget.echarts.biaxial-stack", "widget.echarts.biaxial-reverse"]) {
  const fields = kitOptionDefinitionsByType[type];
  if (!fields) continue;
  const supported = ["display", "line", "line-type", "line-color", "line-width", "tickline", "tickline-color",
    "tickline-width", "tickline-length", "label", "text-type", "value-abbreviation", "decimal-places", "complete-zero",
    "label-offset", "font", "font-overflow", "font-max-width", "display-shadow-color", "display-shadow-blur",
    "display-shadow-offset-x", "display-shadow-offset-y", "rotate", "unit", "unit-text", "unit-font", "nameGap", "padding"];
  if (type === "widget.echarts.line" || type === "widget.echarts.area")
    supported.push("scale-range", "scale-min", "scale-max", "scale-interval", "scale-interval-way");
  for (const key of [...supported.map(suffix => `y-polyline-${suffix}`),
    ...["display", "line-type", "line-dotted-width", "line-color", "line-width"].map(suffix => `grid-y-polyline-${suffix}`)]) {
    if (fields[key]) fields[key] = { ...fields[key], hidden: false, group: "轴" };
  }
}
// The reference list generates these two groups from a parameterized function, rather than literals.
for (const type of ["widget.group.list-v2", "widget.group.list"]) {
  const fields = kitOptionDefinitionsByType[type];
  if (!fields) continue;
  for (const state of ["default", "selected"]) {
    const group = state === "default" ? "列表项背景（默认样式）" : "列表项背景（选中样式）";
    const prefix = `item-${state}-`;
    const setting = (label: string, extra: Partial<KitOptionDefinition>): KitOptionDefinition =>
      ({ label, group, tab: "style", ...extra });
    fields[`${prefix}color`] = setting("背景颜色", { type: "color", defaultValue: "#ffffff00" });
    fields[`${prefix}image`] = setting("背景图片", { type: "file", defaultValue: "" });
    fields[`${prefix}image-fill`] = setting("填充方式", { type: "select", defaultValue: "stretch", options: [
      { label: "拉伸填充", value: "stretch" }, { label: "平铺", value: "tile" }, { label: "不填充", value: "none" },
    ] });
    fields[`${prefix}blur`] = setting("背景模糊", { type: "number", defaultValue: 0 });
    fields[`${prefix}scale`] = setting("图片比例", { type: "number", defaultValue: 100,
      visibleWhen: { key: `${prefix}image-fill`, equals: "none" } });
    fields[`${prefix}position`] = setting("图片位置", { type: "json", defaultValue: [0, 0],
      visibleWhen: { key: `${prefix}image-fill`, equals: "none" } });
    fields[`${prefix}use-nine-patch`] = setting("是否使用点九", { type: "boolean", defaultValue: false,
      visibleWhen: { key: `${prefix}image-fill`, equals: "stretch" } });
    fields[`${prefix}nine-patch`] = setting("点九编辑", { type: "json",
      visibleWhen: { key: `${prefix}use-nine-patch`, equals: true } });
  }
}
// Line/area widgets also spread a shared, generated set of shadow options.
for (const [type, fields] of Object.entries(kitOptionDefinitionsByType)) {
  let ancestor: string | undefined = type;
  const seen = new Set<string>();
  while (ancestor && ancestor !== "widget.echarts.line" && !seen.has(ancestor)) {
    seen.add(ancestor); ancestor = inheritance[ancestor];
  }
  if (ancestor !== "widget.echarts.line") continue;
  const group = "图形形状";
  for (const [key, definition] of Object.entries(fields)) {
    if (/^(?:unified-(?:dot|shape)|series-(?:shape|dot|image)|image-url|zero-removal|flow-light)(?:-|$)/.test(key))
      fields[key] = { ...definition, group,
        ...(key === "zero-removal" ? { label: "去除零值", hidden: false } : {}),
        ...(key === "zero-removal-mode" ? { label: "去除零值模式", hidden: false } : {}) };
  }
  fields["series-shape-shadow-color"] ??= { label: "阴影颜色", group, tab: "style", type: "color", defaultValue: "#ffffff00" };
  fields["series-shape-shadow-blur"] ??= { label: "阴影模糊程度", group, tab: "style", type: "number", defaultValue: 10 };
  fields["series-shape-shadow-offset"] ??= { label: "阴影偏移", group, tab: "style", type: "json", defaultValue: [0, 0] };
}
export const kitPieceOptionDefinitions = pieceDefinitions as Record<string, Record<string, KitOptionDefinition>>;
export const kitComponentInfo = components;
export function kitComponentData(type: string) {
  const seen = new Set<string>();
  let current: string | undefined = type;
  while (current && !seen.has(current)) {
    const data = privateData?.[current];
    if (data) return data;
    seen.add(current);
    current = inheritance[current];
  }
  return undefined;
}

const defaultsByType = new Map<string, Record<string, unknown>>();
export function kitOptionDefaults(type: string): Record<string, unknown> {
  const cached = defaultsByType.get(type);
  if (cached) return cached;
  const defaults = Object.fromEntries(Object.entries(kitOptionDefinitionsByType[type] ?? definitions["@common"] ?? {})
    .filter(([, def]) => !def.nested && def.defaultValue !== undefined)
    .map(([key, def]) => [key, def.defaultValue]));
  defaultsByType.set(type, defaults);
  return defaults;
}

const alignment = [{ value: "left", label: "左对齐" }, { value: "center", label: "居中对齐" },
  { value: "right", label: "右对齐" }];
const verticalAlignment = [{ value: "top", label: "顶部对齐" }, { value: "center", label: "居中对齐" },
  { value: "bottom", label: "底部对齐" }];
// The button widget serializes vertical alignment as start/center/end, and the
// reference editor exposes both alignments as three-way controls.
const buttonFields = kitOptionDefinitionsByType["widget.basic.button-v2"];
if (buttonFields) for (const state of ["default", "click", "hover", "select"]) {
  const horizontal = `text-${state}-position`, vertical = `text-${state}-vertical`;
  if (buttonFields[horizontal]) buttonFields[horizontal] = { ...buttonFields[horizontal], type: "select", options: alignment };
  if (buttonFields[vertical]) buttonFields[vertical] = { ...buttonFields[vertical], type: "select", options: [
    { value: "start", label: "顶部对齐" }, { value: "center", label: "居中对齐" }, { value: "end", label: "底部对齐" },
  ] };
}
const fillStyles = [{ value: "stretch", label: "拉伸" }, { value: "tile", label: "平铺" },
  { value: "none", label: "不填充" }];

export const kitOptionDefinitions: Record<string, KitOptionDefinition> = {
  ...kitOptionDefinitionsByType["widget.basic.text"],
  ...kitOptionDefinitionsByType["widget.basic.image"],
  position: { label: "位置", group: "大小&位置", type: "json" },
  size: { label: "组件大小", group: "大小&位置", type: "json" },
  rotation: { label: "旋转角度", group: "大小&位置", type: "number" },
  angle: { label: "旋转角度", group: "大小&位置", type: "number" },
  scale: { label: "缩放", group: "大小&位置", type: "json" },
  "z-index": { label: "图层顺序", group: "大小&位置", type: "number" },
  "padding-left": { label: "左边距", group: "响应式布局" },
  "padding-right": { label: "右边距", group: "响应式布局" },
  "padding-top": { label: "上边距", group: "响应式布局" },
  "padding-bottom": { label: "下边距", group: "响应式布局" },
  "margin-left": { label: "左外边距", group: "响应式布局" },
  "margin-right": { label: "右外边距", group: "响应式布局" },
  "margin-top": { label: "上外边距", group: "响应式布局" },
  "margin-bottom": { label: "下外边距", group: "响应式布局" },
  "responsive-x": { label: "水平方向", group: "响应式布局", type: "select", options: [
    { label: "缩放", value: "scale" }, { label: "固定", value: "fixed" },
    { label: "拉伸", value: "stretch" }, { label: "居中", value: "center" },
  ] },
  "responsive-y": { label: "垂直方向", group: "响应式布局", type: "select", options: [
    { label: "缩放", value: "scale" }, { label: "固定", value: "fixed" },
    { label: "拉伸", value: "stretch" }, { label: "居中", value: "center" },
  ] },
  "fluid-width-type": { label: "宽度模式", group: "响应式布局", type: "select", options: [
    { label: "自动", value: "auto" }, { label: "固定", value: "fixed" },
    { label: "百分比", value: "percent" },
  ] },
  "fluid-height-type": { label: "高度模式", group: "响应式布局", type: "select", options: [
    { label: "自动", value: "auto" }, { label: "固定", value: "fixed" },
    { label: "百分比", value: "percent" },
  ] },
  layout: { label: "内部组件布局", group: "基本设置", type: "select", options: [
    { label: "静态布局", value: "static" }, { label: "流式布局", value: "fluid" },
  ] },
  opacity: { label: "不透明度 (%)", group: "基本设置", type: "number", min: 0, max: 100 },
  visible: { label: "是否显示", group: "基本设置", type: "boolean" },
  loaded: { label: "是否加载", group: "基本设置", type: "boolean" },
  loading: { label: "是否加载", group: "基本设置", type: "boolean" },
  "no-events": { label: "鼠标穿透", group: "基本设置", type: "boolean" },
  "mouse-through": { label: "鼠标穿透", group: "基本设置", type: "boolean" },
  "forbid-click-blank": { label: "排除空白区域", group: "基本设置", type: "boolean" },
  "show-selected": { label: "启用选中", group: "基本设置", type: "boolean" },
  "show-select": { label: "启用选中", group: "基本设置", type: "boolean" },
  "show-hover": { label: "启用悬浮", group: "基本设置", type: "boolean" },
  "show-click": { label: "启用按下", group: "基本设置", type: "boolean" },
  checked: { label: "默认选中", group: "基本设置", type: "boolean" },
  disabled: { label: "禁用", group: "基本设置", type: "boolean" },
  text: { label: "文本", group: "基本设置", type: "text" },
  value: { label: "数值", group: "基本设置" },
  unit: { label: "单位", group: "基本设置", type: "text" },
  title: { label: "标题", group: "基本设置", type: "text" },
  placeholder: { label: "占位文字", group: "基本设置", type: "text" },
  items: { label: "选项列表", group: "菜单设置", type: "json" },
  buttons: { label: "菜单项", group: "菜单设置", type: "json" },
  "button-list": { label: "菜单项", group: "菜单设置", type: "json" },
  "button-size": { label: "按钮尺寸", group: "菜单设置", type: "json" },
  "button-gap": { label: "按钮间距", group: "菜单设置", type: "number" },
  "button-direction": { label: "排列方向", group: "菜单设置", type: "select", options: [
    { label: "横向", value: "horizontal" }, { label: "纵向", value: "vertical" },
  ] },
  "selected-index": { label: "默认选中项", group: "菜单设置", type: "number", min: 0 },
  "selected-value": { label: "当前选中值", group: "菜单设置" },
  "allow-empty": { label: "允许不选中", group: "菜单设置", type: "boolean" },
  multiple: { label: "允许多选", group: "菜单设置", type: "boolean" },
  "allow-multiple": { label: "允许多选", group: "菜单设置", type: "boolean" },
  "auto-select": { label: "自动选中", group: "菜单设置", type: "boolean" },
  "text-font": { label: "字体", group: "字体设置", type: "font" },
  "text-font2": { label: "字体", group: "字体设置", type: "font" },
  "text-offset": { label: "文本偏移", group: "字体设置", type: "json" },
  "font-shadow-offset": { label: "发光偏移", group: "字体设置", type: "json" },
  "text-position": { label: "水平对齐方式", group: "字体设置", type: "select", options: alignment },
  "text-vertical": { label: "竖直对齐方式", group: "字体设置", type: "select", options: verticalAlignment },
  background: { label: "背景", group: "背景设置", type: "boolean" },
  "background-color": { label: "背景颜色", group: "背景设置", type: "color" },
  "background-image": { label: "背景图片", group: "背景设置", type: "file" },
  "background-fill-type": { label: "背景填充方式", group: "背景设置", type: "select", options: fillStyles },
  "background-blur": { label: "背景模糊程度", group: "背景设置", type: "number", min: 0 },
  "background-opacity": { label: "背景不透明度", group: "背景设置", type: "number", min: 0, max: 100 },
  "use-nine-patch": { label: "启用九宫格", group: "背景设置", type: "boolean" },
  "nine-patch": { label: "九宫格边距", group: "背景设置", type: "json" },
  border: { label: "边框", group: "边框设置", type: "boolean" },
  "border-color": { label: "边框颜色", group: "边框设置", type: "color" },
  "border-width": { label: "边框粗细 (px)", group: "边框设置", type: "number", min: 0 },
  "border-radius": { label: "边框圆角 (px)", group: "边框设置", type: "number", min: 0 },
  "border-style": { label: "边框类型", group: "边框设置", type: "select", options: [
    { label: "实线", value: "solid" }, { label: "虚线", value: "dashed" },
    { label: "点线", value: "dotted" }, { label: "无", value: "none" },
  ] },
  "shadow-offset": { label: "投影偏移", group: "阴影设置", type: "json" },
  "image-fill-style": { label: "填充方式", group: "图片设置", type: "select", options: fillStyles },
  "image-selected": { label: "选中图片地址", group: "选中样式", type: "file" },
  "animation-click-show": { label: "点击动画", group: "按下样式", type: "boolean" },
  "animation-enter": { label: "入场动画", group: "展示设置" },
  "animation-exit": { label: "离场动画", group: "展示设置" },
  "animation-duration": { label: "单个动画持续时长（秒）", group: "展示设置", type: "number", min: 0, step: 0.1 },
  "animation-delay": { label: "动画延迟时长（秒）", group: "展示设置", type: "number", min: 0, step: 0.1 },
  "animation-interval": { label: "循环间隔（秒）", group: "展示设置", type: "number", min: 0, step: 0.1 },
  "animation-type": { label: "动画类型", group: "展示设置", type: "select", options: [
    { label: "滚动", value: "scroll" }, { label: "闪烁", value: "blink" },
    { label: "顺时针旋转", value: "clockwise" }, { label: "逆时针旋转", value: "anti-clockwise" },
  ] },
  "related-entries": { label: "关联数据项", group: "数据联动", type: "json" },
  "related-fields": { label: "关联字段", group: "数据联动", type: "json" },
  "relationship-field": { label: "联动字段", group: "数据联动", type: "text" },
  "relationship-value": { label: "联动值", group: "数据联动", type: "text" },
  interacts: { label: "交互配置", group: "交互设置", type: "json" },
  data: { label: "数据", group: "图表设置", type: "json" },
  rows: { label: "数据行", group: "图表设置", type: "json" },
  columns: { label: "数据列", group: "图表设置", type: "json" },
  series: { label: "数据系列", group: "图表设置", type: "json" },
  legend: { label: "图例", group: "图例设置" },
  "legend-show": { label: "显示图例", group: "图例设置", type: "boolean" },
  "legend-font": { label: "图例字体", group: "图例设置", type: "font" },
  "legend-position": { label: "图例位置", group: "图例设置" },
  "legend-orient": { label: "图例排列", group: "图例设置", type: "select", options: [
    { label: "横向", value: "horizontal" }, { label: "纵向", value: "vertical" },
  ] },
  "x-axis": { label: "横坐标轴", group: "坐标轴设置", type: "json" },
  "y-axis": { label: "纵坐标轴", group: "坐标轴设置", type: "json" },
  "x-axis-show": { label: "显示横坐标轴", group: "坐标轴设置", type: "boolean" },
  "y-axis-show": { label: "显示纵坐标轴", group: "坐标轴设置", type: "boolean" },
  "x-axis-font": { label: "横轴字体", group: "坐标轴设置", type: "font" },
  "y-axis-font": { label: "纵轴字体", group: "坐标轴设置", type: "font" },
  "axis-label-font": { label: "坐标轴标签字体", group: "坐标轴设置", type: "font" },
  "tooltip-show": { label: "显示提示框", group: "提示框设置", type: "boolean" },
  "tooltip-font": { label: "提示框字体", group: "提示框设置", type: "font" },
  "label-show": { label: "显示数据标签", group: "标签设置", type: "boolean" },
  "label-font": { label: "标签字体", group: "标签设置", type: "font" },
  "label-position": { label: "标签位置", group: "标签设置" },
  "line-width": { label: "线宽", group: "图表设置", type: "number", min: 0 },
  "bar-width": { label: "柱条宽度", group: "图表设置", type: "number", min: 0 },
  "bar-gap": { label: "柱条间距", group: "图表设置" },
  "inner-radius": { label: "内半径", group: "图表设置", type: "number", min: 0 },
  "outer-radius": { label: "外半径", group: "图表设置", type: "number", min: 0 },
  "start-angle": { label: "起始角度", group: "图表设置", type: "number" },
  "end-angle": { label: "结束角度", group: "图表设置", type: "number" },
  "color-list": { label: "配色方案", group: "图表设置", type: "json" },
  "series-color": { label: "系列颜色", group: "图表设置", type: "json" },
  "symbol-size": { label: "标记大小", group: "图表设置", type: "number", min: 0 },
  "data-zoom": { label: "数据缩放", group: "图表设置" },
  smooth: { label: "平滑曲线", group: "图表设置", type: "boolean" },
  min: { label: "最小值", group: "基本设置", type: "number" },
  max: { label: "最大值", group: "基本设置", type: "number" },
  step: { label: "步长", group: "基本设置", type: "number" },
};

const stateNames: Record<string, string> = {
  default: "默认样式", hover: "悬浮样式", click: "按下样式",
  select: "选中样式", selected: "选中样式", disabled: "禁用样式",
};

const optionWords: Record<string, string> = {
  show: "显示", hide: "隐藏", enable: "启用", enabled: "启用", allow: "允许",
  title: "标题", name: "名称", label: "标签", text: "文本", value: "数值", unit: "单位",
  font: "字体", family: "字体", size: "大小", weight: "字重", bold: "加粗",
  italic: "倾斜", underline: "下划线", through: "删除线", spacing: "间隔", indent: "缩进",
  color: "颜色", colors: "颜色", opacity: "不透明度", image: "图片", src: "地址",
  background: "背景", border: "边框", radius: "圆角", width: "宽度", height: "高度",
  style: "样式", fill: "填充", type: "类型", mode: "模式", direction: "方向",
  shadow: "投影", glow: "发光", blur: "模糊", offset: "偏移", position: "位置",
  left: "左", right: "右", top: "上", bottom: "下", center: "居中", middle: "居中",
  horizontal: "水平", vertical: "垂直", x: "X", y: "Y", z: "Z",
  min: "最小值", max: "最大值", step: "步长", interval: "间隔", gap: "间距",
  animation: "动画", duration: "持续时长", delay: "延迟", easing: "缓动", loop: "循环",
  data: "数据", field: "字段", fields: "字段", entries: "数据项", key: "键", format: "格式",
  series: "系列", column: "柱条", bar: "条形", line: "线", area: "面积", pie: "饼图",
  axis: "坐标轴", legend: "图例", tooltip: "提示框", grid: "网格", split: "分隔",
  tick: "刻度", symbol: "标记", item: "项目", items: "项目列表", list: "列表",
  button: "按钮", buttons: "按钮组", menu: "菜单", selected: "选中", select: "选中",
  default: "默认", hover: "悬浮", click: "按下", active: "激活", checked: "选中",
  row: "行", rows: "数据行", columns: "数据列", align: "对齐", count: "数量",
  inner: "内部", outer: "外部", start: "开始", end: "结束", angle: "角度",
  speed: "速度", number: "数字", decimal: "小数", precision: "精度", prefix: "前缀",
  suffix: "后缀", sort: "排序", scroll: "滚动", auto: "自动", index: "索引",
  padding: "内边距", margin: "外边距", responsive: "响应式", fluid: "流式布局",
  header: "表头", body: "正文", footer: "表尾", content: "内容", icon: "图标",
  range: "范围", length: "长度", rotate: "旋转", rotation: "旋转", scale: "缩放",
  basic: "基本", setting: "设置", group: "分组", monitor: "监控", shape: "形状",
  overlay: "叠加层", mark: "标记", point: "点", heatmap: "热力图", cluster: "分组",
  lay: "图层", zero: "零值", removal: "过滤", condition: "条件", hight: "高亮",
};

function optionType(key: string, value: unknown): KitOptionDefinition["type"] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    if (object.__opt_type === "file" || typeof object.relativePath === "string") return "file";
    if (/font2?$/.test(key)) return "font";
    if (Array.isArray(object.colors)) return "color";
    return "json";
  }
  if (Array.isArray(value) || value === null || value === undefined) return "json";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string" && /^(#[\da-f]{3,8}|rgba?\(|hsla?\(|transparent$)/i.test(value)) {
    return "color";
  }
  return "text";
}

function optionGroup(key: string): string {
  if (/^(position|size|scale|rotate|rotation|angle|z-index)(-|$)/.test(key)) return "大小&位置";
  if (/^(responsive|fluid|padding|margin|anchor)(-|$)/.test(key)) return "响应式布局";
  if (/^(animation|entrance|exit|duration|delay|easing)(-|$)/.test(key)) return "展示设置";
  if (/^(related|relationship)(-|$)/.test(key)) return "数据联动";
  if (/^(interacts|events)(-|$)/.test(key)) return "交互设置";
  if (/^(background|nine-patch|use-nine-patch)(-|$)/.test(key)) return "背景设置";
  if (/^(border|radius)(-|$)/.test(key)) return "边框设置";
  if (/^(shadow|glow)(-|$)/.test(key)) return "阴影设置";
  if (/font|^text-(position|vertical|indent|tilt|offset)/.test(key)) return "字体设置";
  if (/^(image|fill-style|center-mode|outline-follow)(-|$)/.test(key)) return "图片设置";
  if (/^(legend)(-|$)/.test(key)) return "图例设置";
  if (/^(tooltip)(-|$)/.test(key)) return "提示框设置";
  if (/^(x-axis|y-axis|axis|split-line)(-|$)/.test(key)) return "坐标轴设置";
  if (/^(label)(-|$)/.test(key)) return "标签设置";
  if (/^(data|series|column|bar|line|area|pie|donut|gauge|grid|symbol|echarts|chart|color-list)(-|$)/.test(key)) return "图表设置";
  if (/^(button|buttons|menu|items|selected|checked|multiple)(-|$)/.test(key)) return "菜单设置";
  return "基本设置";
}

const optionAliases: Record<string, string> = {
  "common.shouldLoad": "是否加载",
  "global.carouselType": "切换方式", "global.listPageDirection": "布局",
  "global.listWheelScroll": "启用滚轮滚动", "global.listScrollDirection": "页面切换",
  "global.listDisplayCount": "每页显示条数", "global.listDisplayCountGrid": "每页显示条数",
  "global.RowEvenlyDistribute": "行均匀分布", "global.hideEmptyTip": "隐藏空数据提示",
};

function optionLabel(key: string): string {
  return optionAliases[key] ?? (key.replace(/([a-z])([A-Z])/g, "$1-$2").split(/[-_.]+/)
    .map(word => optionWords[word.toLowerCase()] ?? word).join("") || "配置项");
}

/**
 * Resolve every raw key without dropping values. Unknown properties remain editable.
 * widgetType distinguishes identically named options declared by different widgets.
 */
export function kitOptionDefinition(key: string, value: unknown, widgetType?: string): KitOptionDefinition {
  const specific = widgetType ? kitOptionDefinitionsByType[widgetType]?.[key] ?? kitPieceOptionDefinitions[widgetType]?.[key] : undefined;
  const exact = specific ?? kitOptionDefinitions[key];
  const commonLabel = kitOptionDefinitions[key]?.label ?? "";
  if (exact) return {
    ...exact,
    label: widgetType === "widget.basic.weather-v2" && key === "map-key" ? "Key"
      : /\p{Script=Han}/u.test(exact.label) ? exact.label
      : /\p{Script=Han}/u.test(commonLabel) ? commonLabel : optionLabel(exact.label || key),
    group: /\p{Script=Han}/u.test(exact.group) ? exact.group : optionLabel(exact.group),
    type: exact.type ?? optionType(key, value),
  };
  const state = key.match(/(?:^|-)(default|hover|click|select|selected|disabled)(?=-|$)/);
  const baseKey = state ? key.replace(state[0], "").replace(/^-/, "") : key;
  const base = kitOptionDefinitions[baseKey];
  return {
    ...base,
    label: base?.label ?? optionLabel(baseKey),
    group: state ? stateNames[state[1]!] : base?.group ?? optionGroup(key),
    type: base?.type ?? optionType(baseKey, value),
    ...(base?.options ? { options: base.options } : {}),
    ...(base?.min !== undefined ? { min: base.min } : {}),
    ...(base?.max !== undefined ? { max: base.max } : {}),
    ...(base?.step !== undefined ? { step: base.step } : {}),
  };
}

export function kitPieceOptionDefinition(type: string, key: string, value: unknown): KitOptionDefinition {
  return kitOptionDefinition(key, value, type);
}
