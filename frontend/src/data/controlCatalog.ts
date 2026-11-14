import type { WidgetKind } from "./editor";

export interface ControlCatalogEntry {
  kind: WidgetKind;
  label: string;
  category: string;
  keywords?: readonly string[];
}

/** 山海鲸「控件」分类的 chips，顺序即展示顺序，「全部」始终在首位。 */
export const controlCategories = ["全部", "默认控件"] as const;

/** 按山海鲸「默认控件」的顺序展示本项目已支持的控件。 */
export const controlCatalog: ControlCatalogEntry[] = [
  { kind: "dropdown", label: "基础下拉菜单", category: "默认控件" },
  { kind: "groupPanel", label: "分组面板", category: "默认控件" },
  { kind: "list", label: "列表", category: "默认控件" },
  { kind: "button", label: "按钮", category: "默认控件" },
  { kind: "dialog", label: "弹窗", category: "默认控件" },
  { kind: "tabs", label: "可切换分组面板（选项卡）", category: "默认控件" },
  { kind: "menuVertical", label: "纵向菜单", category: "默认控件" },
  { kind: "menuHorizontal", label: "横向菜单", category: "默认控件" },
  { kind: "search", label: "搜索框", category: "默认控件" },
  { kind: "progress", label: "进度条", category: "默认控件" },
  { kind: "iframe", label: "iframe", category: "默认控件" },
  { kind: "weather", label: "天气", category: "默认控件" },
  { kind: "clock", label: "基础时间", category: "默认控件", keywords: ["时钟"] },
  { kind: "calendar", label: "基础日历", category: "默认控件" },
  { kind: "timer", label: "基础计时器", category: "默认控件" },
  { kind: "timeline", label: "基础时间轴", category: "默认控件" },
  { kind: "shape", label: "基础图形/形状", category: "默认控件" },
  { kind: "timePicker", label: "时间选择器", category: "默认控件" },
  { kind: "timeRange", label: "时间范围选择器", category: "默认控件" },
  { kind: "twin2d", label: "二维孪生", category: "默认控件" },
  { kind: "checkbox", label: "复选框", category: "默认控件" },
  { kind: "input", label: "输入框", category: "默认控件" },
  { kind: "switch", label: "开关", category: "默认控件" },
  { kind: "slider", label: "数值滑动条", category: "默认控件" },
  { kind: "timeProgress", label: "时间进度条", category: "默认控件" },
  { kind: "colorPicker", label: "颜色", category: "默认控件" },
  { kind: "upload", label: "上传", category: "默认控件" },
  { kind: "tree", label: "树形控件", category: "默认控件" },
];

/** 旧名称仍可用于搜索，分类视图和「全部」视图使用相同规则。 */
export const matchesControlEntry = (entry: ControlCatalogEntry, query: string): boolean =>
  !query || entry.label.includes(query) || entry.category.includes(query)
    || Boolean(entry.keywords?.some((keyword) => keyword.includes(query)));

/** 有素材的分类才会显示对应 chip。 */
export const usedControlCategories = controlCategories.filter((category) =>
  category === "全部" || controlCatalog.some((entry) => entry.category === category));
