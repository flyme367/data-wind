import type { CSSProperties } from "react";
import type { SceneNode, Vec3 } from "../types";

export type WidgetKind = "text" | "metric" | "bar" | "line" | "pie" | "image" | "button" | "clock" | "table"
  | "dropdown" | "groupPanel" | "list" | "dialog" | "tabs" | "menuVertical" | "menuHorizontal" | "search" | "progress" | "iframe" | "weather"
  | "barGradient" | "barGrouped" | "barStacked" | "barPercent" | "barHorizontal" | "barHorizontalStacked"
  | "lineSmooth" | "lineMulti" | "area" | "areaGradient" | "areaStacked" | "dualAxis"
  | "radar" | "radarFilled" | "pieBasic" | "pieRose" | "scatter" | "bubble" | "gauge" | "waterball" | "funnel" | "heatmap"
  | "bar3dGrouped" | "bar3dStacked" | "pie3d" | "donut3d" | "rose3d" | "roseRing3d"
  | "calendar" | "timer" | "timeline" | "timePicker" | "timeRange" | "shape" | "flipCounter" | "dataChange"
  | "tableBasic" | "tableIndex" | "report" | "textMultiline" | "wordCloud" | "carousel" | "video" | "audio"
  | "monitor" | "carouselVideo" | "pdf"
  | "mapRegion" | "mapPoint" | "mapFlyline" | "mapHeat" | "mapTrack" | "mapBar"
  | "mapOutline" | "mapTile"
  | "twin2d" | "checkbox" | "input" | "switch" | "slider" | "timeProgress" | "colorPicker" | "upload" | "tree" | "topology";
export interface WidgetConfig {
  kind: WidgetKind; text: string; value: string; unit: string; fontSize: number;
  background: string; borderColor: string; opacity: number; radius: number;
  image: string; align: "left" | "center" | "right";
  /** 山海鲸「文本设置」：字体存 CSS font-family 栈，"" 为默认；行高/字间距 0 为默认 */
  fontFamily: string; fontWeight: number; italic: boolean; underline: boolean;
  lineHeight: number; letterSpacing: number;
  /** 山海鲸「边框设置」 */
  borderStyle: "none" | "solid" | "dashed" | "dotted"; borderWidth: number;
  /** 山海鲸「阴影设置」：shadowColor 为 "transparent" 时无阴影 */
  shadowColor: string; shadowBlur: number; shadowOffsetX: number; shadowOffsetY: number;
  /** 山海鲸「默认状态」状态机：附加状态 = 样式/内容覆盖补丁；渲染端拿到的永远是解析后的有效样式 */
  states?: WidgetState[];
}

/** 山海鲸「组件状态」：状态补丁只含样式/内容字段，位置、显示、锁定、数据保持节点级。 */
export interface WidgetState {
  id: string; name: string;
  patch: Partial<WidgetConfig>;
}

/** 状态补丁允许覆盖的字段白名单（组件内容 + 文本/背景/边框/阴影设置）。 */
export const STATE_STYLE_KEYS = ["text", "value", "unit", "image", "fontSize", "background", "borderColor", "opacity",
  "radius", "align", "fontFamily", "fontWeight", "italic", "underline", "lineHeight", "letterSpacing",
  "borderStyle", "borderWidth", "shadowColor", "shadowBlur", "shadowOffsetX", "shadowOffsetY"] as const;
export type StateStyleKey = (typeof STATE_STYLE_KEYS)[number];
export const isStateStyleKey = (key: string): key is StateStyleKey =>
  (STATE_STYLE_KEYS as readonly string[]).includes(key);

/** 状态列表清洗：最多 12 个状态，剔除缺 id / 名字或补丁含非法键的项。 */
export function sanitizeWidgetStates(states: unknown): WidgetState[] {
  if (!Array.isArray(states)) return [];
  const seen = new Set<string>();
  const result: WidgetState[] = [];
  for (const raw of states.slice(0, 12)) {
    const item = raw as WidgetState;
    if (!item || typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name.trim()) continue;
    if (seen.has(item.id)) continue;
    const patch = Object.fromEntries(
      Object.entries(item.patch ?? {}).filter(([key]) => isStateStyleKey(key)),
    ) as Partial<WidgetConfig>;
    seen.add(item.id);
    result.push({ id: item.id, name: item.name.trim(), patch });
  }
  return result;
}

/** 山海鲸「文本设置-字体」下拉项；value 为 CSS font-family 栈，"" 表示跟随默认。 */
export const widgetFontFamilies: { value: string; label: string }[] = [
  { value: "", label: "默认字体" },
  { value: "'PingFang SC','Microsoft YaHei',sans-serif", label: "苹方 PingFang SC" },
  { value: "'Microsoft YaHei',sans-serif", label: "微软雅黑" },
  { value: "SimHei,sans-serif", label: "黑体 SimHei" },
  { value: "SimSun,serif", label: "宋体 SimSun" },
  { value: "KaiTi,serif", label: "楷体 KaiTi" },
  { value: "Arial,sans-serif", label: "Arial" },
  { value: "'Times New Roman',serif", label: "Times New Roman" },
  { value: "'Courier New',monospace", label: "等宽 Courier New" },
];
export const widgetFontWeights = [
  { value: 300, label: "细体 Light" }, { value: 400, label: "常规 Regular" }, { value: 500, label: "中等 Medium" },
  { value: 600, label: "半粗 SemiBold" }, { value: 700, label: "加粗 Bold" },
];
export const widgetBorderStyles = [
  { value: "none", label: "无" }, { value: "solid", label: "实线" },
  { value: "dashed", label: "虚线" }, { value: "dotted", label: "点线" },
];

/** 山海鲸媒体组件下拉项（对照官方组件文档）；媒体行为字段全部存 node.data（JsonValue 透传）。 */
/** 图片「填充方式」：拉伸填充 | 居中；轮播图额外多一档「平铺」。 */
export const mediaImageFitOptions = [
  { value: "stretch", label: "拉伸填充" }, { value: "center", label: "居中" },
];
export const mediaCarouselFitOptions = [
  { value: "stretch", label: "拉伸" }, { value: "center", label: "居中" }, { value: "tile", label: "平铺" },
];
/** 「播放设置-播放速度」。 */
export const mediaPlaybackRates = [
  { value: 2, label: "2.0x" }, { value: 1.5, label: "1.5x" }, { value: 1, label: "1.0x" }, { value: 0.5, label: "0.5x" },
];
/** 「播放方式」：暂停继续 = 暂停后从当前位置继续；从头播放 = 每次播放回到循环开始时间。 */
export const mediaPlayModes = [
  { value: "pauseResume", label: "暂停继续" }, { value: "restart", label: "从头播放" },
];
/** 监控「协议类型」：浏览器仅实播 HLS / FLV，RTSP / RTMP 保留配置项并提示不支持。 */
export const monitorProtocols = [
  { value: "hls", label: "HLS" }, { value: "rtsp", label: "RTSP" }, { value: "rtmp", label: "RTMP" }, { value: "flv", label: "FLV" },
];
export const monitorRtspTransports = [
  { value: "tcp", label: "TCP" }, { value: "udp", label: "UDP" },
  { value: "udpMulticast", label: "UDP_MULTICAST" }, { value: "http", label: "HTTP" },
];
/** 图片「展示设置-缓动方式」10 项（通用缓动命名，待山海鲸实机核对）。 */
export const mediaEasings = [
  { value: "linear", label: "线性" }, { value: "easeIn", label: "缓入" }, { value: "easeOut", label: "缓出" }, { value: "easeInOut", label: "缓入缓出" },
  { value: "backIn", label: "回弹进入" }, { value: "backOut", label: "回弹离开" }, { value: "backInOut", label: "回弹进出" },
  { value: "elasticIn", label: "弹性进入" }, { value: "elasticOut", label: "弹性离开" }, { value: "elasticInOut", label: "弹性进出" },
];
/** 图片展示动画类型：顺时针旋转 / 逆时针旋转 / 闪烁；轮播切换动画：平移 / 翻转。 */
export const mediaImageAnimTypes = [
  { value: "cw", label: "顺时针旋转" }, { value: "ccw", label: "逆时针旋转" }, { value: "blink", label: "闪烁" },
];
export const mediaCarouselAnimTypes = [
  { value: "slide", label: "平移" }, { value: "flip", label: "翻转" },
];

/** 山海鲸同款组件样式的缺省值，供 widgetNode 与旧数据归一化共用。 */
export const defaultWidgetStyle = {
  fontFamily: "", fontWeight: 400, italic: false, underline: false,
  lineHeight: 0, letterSpacing: 0,
  borderStyle: "solid" as WidgetConfig["borderStyle"], borderWidth: 1,
  shadowColor: "transparent", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
};

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** 旧项目 / 导入文件的 widget 缺少新字段或含脏值时补齐默认，保证渲染端拿到的配置完整。 */
export function normalizeWidgetStyle<T extends Partial<WidgetConfig>>(widget: T): T & typeof defaultWidgetStyle {
  return {
    ...widget,
    ...(widget.states ? { states: sanitizeWidgetStates(widget.states) } : {}),
    fontFamily: typeof widget.fontFamily === "string" ? widget.fontFamily : defaultWidgetStyle.fontFamily,
    fontWeight: [300, 400, 500, 600, 700].includes(widget.fontWeight as number) ? widget.fontWeight as number : 400,
    italic: typeof widget.italic === "boolean" ? widget.italic : false,
    underline: typeof widget.underline === "boolean" ? widget.underline : false,
    lineHeight: clampNumber(widget.lineHeight, 0, 0, 3),
    letterSpacing: clampNumber(widget.letterSpacing, 0, -20, 120),
    borderStyle: ["none", "solid", "dashed", "dotted"].includes(widget.borderStyle as string)
      ? widget.borderStyle as WidgetConfig["borderStyle"] : defaultWidgetStyle.borderStyle,
    borderWidth: clampNumber(widget.borderWidth, 1, 0, 40),
    shadowColor: typeof widget.shadowColor === "string" ? widget.shadowColor : defaultWidgetStyle.shadowColor,
    shadowBlur: clampNumber(widget.shadowBlur, 0, 0, 200),
    shadowOffsetX: clampNumber(widget.shadowOffsetX, 0, -500, 500),
    shadowOffsetY: clampNumber(widget.shadowOffsetY, 0, -500, 500),
  };
}

/** 山海鲸同款组件外观样式：素材库卡片的 DOM 外观；画布 / 发布 / PNG 的样式由 Rust 渲染器实现（数值均带单位）。 */
export function widgetAppearanceStyle(w: WidgetConfig, color: string): CSSProperties {
  const style: Record<string, string> = {
    color, background: w.background, borderColor: w.borderColor, textAlign: w.align,
    opacity: String(w.opacity), borderRadius: `${w.radius}px`,
    fontWeight: String(w.fontWeight), fontStyle: w.italic ? "italic" : "normal",
    textDecoration: w.underline ? "underline" : "none",
    borderStyle: w.borderStyle, borderWidth: w.borderStyle === "none" ? "0px" : `${w.borderWidth}px`,
  };
  if (w.fontFamily) style.fontFamily = w.fontFamily;
  if (w.lineHeight > 0) style.lineHeight = String(w.lineHeight);
  if (w.letterSpacing !== 0) style.letterSpacing = `${w.letterSpacing}px`;
  if (w.shadowColor !== "transparent" && (w.shadowBlur !== 0 || w.shadowOffsetX !== 0 || w.shadowOffsetY !== 0))
    style.boxShadow = `${w.shadowOffsetX}px ${w.shadowOffsetY}px ${w.shadowBlur}px ${w.shadowColor}`;
  return style as CSSProperties;
}
export type InteractionSettingSource =
  | { type: "keep" }
  | { type: "component"; field: string }
  | { type: "formula"; expression: string };

export interface InteractionTargetScope {
  mode: "children" | "currentChildren";
  query: string;
  recursive: boolean;
}

export function isValidSettingSource(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<InteractionSettingSource>;
  return source.type === "keep"
    || (source.type === "component" && typeof source.field === "string"
      && !!source.field.trim() && source.field.length <= 300)
    || (source.type === "formula" && typeof source.expression === "string"
      && !!source.expression.trim() && source.expression.length <= 1000);
}

export function isValidInteractionTargetScope(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const scope = value as Partial<InteractionTargetScope>;
  return (scope.mode === "children" || scope.mode === "currentChildren")
    && typeof scope.query === "string" && scope.query.length <= 300
    && typeof scope.recursive === "boolean";
}

export interface Interaction {
  id: string; name?: string;
  event: "click" | "dblclick" | "mouseenter" | "mouseleave" | "componentEnter" | "componentLeave"
    | "componentSelected" | "componentUnselected" | "itemClick" | "data" | "boardActive" | "custom";
  /** 山海鲸的组件、项目、导航与二次开发动作。 */
  action: "toggle" | "show" | "hide" | "focus" | "color" | "message" | "state" | "text" | "dialog" | "refresh" | "fullscreen"
    | "modify" | "componentCustom" | "projectParams" | "logout" | "payload" | "navigateBoard" | "openUrl" | "passEvent" | "devEvent" | "script" | "boardState" | "playEntrance" | "none";
  targetId: string; value: string;
  /** 修改设置可同时应用到多个组件。旧规则仍使用 targetId。 */
  targetIds?: string[];
  targetScope?: InteractionTargetScope;
  settingKey?: string;
  settingSource?: InteractionSettingSource;
  triggerValue?: string;
  /** 动作发出的事件名称，与触发事件名称分别保存。 */
  actionEventName?: string;
  /** 点击组件内部选项时，可限定被点击的值；空值表示所有选项。 */
  itemValue?: string;
  /** 数据触发器在指定数据源字段满足条件时执行。 */
  condition?: { sourceId: string; field: string; op: "==" | "!=" | ">" | "<" | ">=" | "<=" | "contains"; value: string };
  /** 与上一动作同时，或在上一组动作结束后执行。 */
  sequence?: "with" | "after";
  delayMs?: number;
  durationMs?: number;
  animation?: "fade" | "slideLeft" | "slideRight" | "slideUp" | "slideDown" | "zoom";
  easing?: "linear" | "exponentialIn" | "exponentialOut" | "easeInOut";
  animationStack?: boolean;
}
export interface EditorSettings {
  grid: boolean; flylines: boolean; stats: boolean;
  background: string; groundColor: string; ground: boolean; time: number;
  exposure: number; contrast: number; saturation: number; fog: boolean; fogDistance: number;
  boardColor: string; boardFillColor: string;
  boardFit: "contain" | "cover" | "responsive" | "original" | "stretch";
  /** 山海鲸「子看板轮廓」：编辑态画布外围虚线描边 */
  boardOutline: boolean;
  /** 山海鲸「内部组件布局」：静态（手动摆放）或流式（一键行列整理） */
  boardLayout: "static" | "flow";
  boardCarouselEnabled: boolean;
  boardCarouselAnimation: "none" | "fade" | "slideX" | "slideY" | "slide" | "zoom";
  boardCarouselDuration: number;
  boardPageDuration: number;
  boardBackgroundEnabled: boolean;
  boardBackgroundMediaId: string;
  boardBackgroundMediaName: string;
  boardBackgroundFill: "stretch" | "tile" | "none";
  boardBackgroundBlur: number;
  boardMusicEnabled: boolean;
  boardMusicId: string;
  boardMusicName: string;
  boardMusicVolume: number;
  boardInteractions: Interaction[];
  boardSharedData: BoardSharedData[];
  boardDataConditions: import("./dataConditions").BoardDataCondition[];
  boardScripts: BoardScript[];
  boardStates: BoardState[];
  boardDefaultState: BoardStateStyle;
  boardActiveStateId: string;
  boardPages: BoardPage[];
  boardActivePageId: string;
  /** 独立背景看板，组件在预览时位于当前子大屏内容下方。 */
  boardBackgroundPage: BoardPage;
  /** 独立前景看板（山海鲸底栏「前景 ⊕」创建的可选覆盖层），组件位于当前子大屏内容上方；未创建时为 null。 */
  boardForegroundPage: BoardPage | null;
  boardVersion: string;
  boardElementUid: string;
  bookmarks: { id: string; name: string; target: number[]; yaw: number; pitch: number; dist: number }[];
}

export type BoardStateStyle = Partial<Pick<EditorSettings,
  "boardColor" | "boardFillColor" | "boardFit" | "boardBackgroundEnabled" | "boardBackgroundMediaId" |
  "boardBackgroundMediaName" | "boardBackgroundFill" | "boardBackgroundBlur" | "boardMusicEnabled" |
  "boardMusicId" | "boardMusicName" | "boardMusicVolume">>;

export interface BoardState {
  id: string;
  name: string;
  style: BoardStateStyle;
}

/** A child screen owns its widget subset, dimensions and default presentation settings. */
export interface BoardPage {
  id: string;
  name: string;
  width: number;
  height: number;
  style: BoardStateStyle;
  cover?: string;
}

export const BACKGROUND_BOARD_PAGE_ID = "dw-background-board";
export const FOREGROUND_BOARD_PAGE_ID = "dw-foreground-board";

export interface BoardSharedData {
  id: string;
  name: string;
  enabled: boolean;
  source?: import("./dataSources").DataSourceConfig;
  data?: Record<string, unknown>;
  fileName?: string;
}

export interface BoardScript {
  id: string;
  name: string;
  enabled: boolean;
  fileName: string;
  code: string;
  settingsJson?: string;
}
export const defaultEditorSettings: EditorSettings = {
  grid:true,flylines:true,stats:false,
  background: "#1b1d26", groundColor: "#1a1c24", ground: true, time: 15.4,
  exposure: 1, contrast: 1, saturation: 1, fog: true, fogDistance: 240,
  boardColor: "#101a2c", boardFillColor: "#000000", boardFit: "contain", boardOutline: false, boardLayout: "static",
  boardCarouselEnabled: false, boardCarouselAnimation: "none", boardCarouselDuration: 1, boardPageDuration: 3,
  boardBackgroundEnabled: true, boardBackgroundMediaId: "", boardBackgroundMediaName: "", boardBackgroundFill: "tile", boardBackgroundBlur: 0,
  boardMusicEnabled: false, boardMusicId: "", boardMusicName: "", boardMusicVolume: 100,
  boardInteractions: [], boardSharedData: [], boardDataConditions: [], boardScripts: [], boardVersion: "0.0.1", boardElementUid: "dw-board", bookmarks: [],
  boardStates: [], boardDefaultState: {
    boardColor: "#101a2c", boardFillColor: "#000000", boardFit: "contain", boardBackgroundEnabled: true, boardBackgroundMediaId: "",
    boardBackgroundMediaName: "", boardBackgroundFill: "tile", boardBackgroundBlur: 0, boardMusicEnabled: false,
    boardMusicId: "", boardMusicName: "", boardMusicVolume: 100,
  }, boardActiveStateId: "",
  boardPages: [{ id: "board-1", name: "子看板1", width: 1920, height: 1080, style: {
    boardColor: "#101a2c", boardFillColor: "#000000", boardFit: "contain", boardBackgroundEnabled: true,
    boardBackgroundMediaId: "", boardBackgroundMediaName: "", boardBackgroundFill: "tile", boardBackgroundBlur: 0,
    boardMusicEnabled: false, boardMusicId: "", boardMusicName: "", boardMusicVolume: 100,
  } }], boardActivePageId: "board-1",
  boardBackgroundPage: { id: BACKGROUND_BOARD_PAGE_ID, name: "背景看板", width: 1920, height: 1080, style: {
    boardColor: "#1b1d26", boardFillColor: "#000000", boardFit: "contain", boardBackgroundEnabled: true,
    boardBackgroundMediaId: "", boardBackgroundMediaName: "", boardBackgroundFill: "tile", boardBackgroundBlur: 0,
    boardMusicEnabled: false, boardMusicId: "", boardMusicName: "", boardMusicVolume: 100,
  } },
  boardForegroundPage: null,
};
export const widgetLabels: Record<WidgetKind, string> = {
  text: "文本", metric: "指标卡", bar: "基础柱状图", line: "基础折线图", pie: "环形图", image: "图片", button: "按钮", clock: "基础时间", table: "数据表",
  dropdown: "基础下拉菜单", groupPanel: "分组面板", list: "列表", dialog: "弹窗", tabs: "可切换分组面板（选项卡）", menuVertical: "纵向菜单", menuHorizontal: "横向菜单", search: "搜索框", progress: "进度条", iframe: "iframe", weather: "天气",
  barGradient: "渐变柱状图", barGrouped: "基础分组柱状图", barStacked: "基础堆叠柱状图", barPercent: "百分比堆叠柱状图",
  barHorizontal: "基础条形图", barHorizontalStacked: "堆叠条形图", lineSmooth: "平滑折线图", lineMulti: "多系列折线图",
  area: "基础面积图", areaGradient: "渐变面积图", areaStacked: "堆叠面积图", dualAxis: "柱线双轴图",
  radar: "基础雷达图", radarFilled: "填充雷达图", pieBasic: "基础饼图", pieRose: "玫瑰图",
  scatter: "基础散点图", bubble: "气泡图", gauge: "基础仪表盘", waterball: "基础水球图", funnel: "基础漏斗图", heatmap: "基础热力图",
  bar3dGrouped: "基础3D分组柱状图", bar3dStacked: "基础3D堆叠柱状图", pie3d: "基础3D饼状图", donut3d: "基础3D环形图", rose3d: "基础3D玫瑰图", roseRing3d: "基础3D玫瑰环图",
  calendar: "基础日历", timer: "基础计时器", timeline: "基础时间轴", timePicker: "时间选择器",
  timeRange: "时间范围选择器", shape: "基础图形/形状", flipCounter: "翻牌器", dataChange: "数据变化",
  tableBasic: "基础数据表格", tableIndex: "基础表格（含序号列）", report: "中国式报表", textMultiline: "基础多行文本", wordCloud: "基础词云",
  carousel: "轮播图", video: "视频", audio: "音频", monitor: "监控", carouselVideo: "轮播视频", pdf: "基础PDF",
  mapRegion: "区域地图", mapPoint: "点地图", mapFlyline: "飞线地图", mapHeat: "热力地图", mapTrack: "轨迹地图", mapBar: "柱状地图",
  mapOutline: "轮廓地图", mapTile: "瓦片地图",
  twin2d: "二维孪生", checkbox: "复选框", input: "输入框", switch: "开关", slider: "数值滑动条",
  timeProgress: "时间进度条", colorPicker: "颜色", upload: "上传", tree: "树形控件", topology: "拓扑图",
};
/** 图表类组件目录；chartSvg 用于素材库缩略图，画布内容由 Rust 渲染。 */
export const chartWidgetKinds: WidgetKind[] = [
  "bar", "barGradient", "barGrouped", "barStacked", "barPercent", "barHorizontal", "barHorizontalStacked",
  "line", "lineSmooth", "lineMulti", "area", "areaGradient", "areaStacked", "dualAxis",
  "radar", "radarFilled", "pie", "pieBasic", "pieRose", "scatter", "bubble", "gauge", "waterball", "funnel", "heatmap", "table",
  "bar3dGrouped", "bar3dStacked", "pie3d", "donut3d", "rose3d", "roseRing3d",
];
export const isChartWidget = (kind: WidgetKind): boolean => chartWidgetKinds.includes(kind);
/** 媒体类组件：浏览器解码像素 → Rust 纹理绘制（boardCanvas.loadResources 白名单与面板分区共用）。 */
export const mediaWidgetKinds: WidgetKind[] = ["image", "video", "monitor", "carousel", "carouselVideo", "pdf", "audio"];
export const isMediaWidget = (kind: WidgetKind): boolean => mediaWidgetKinds.includes(kind);

/** 图表组件的示例数据：rows 支持 value2 / value3 作为第二、三系列，与“基础分组柱状图”等多系列 preset 配套。 */
const chartSamples: Partial<Record<WidgetKind, Record<string, unknown>[]>> = {
  bar: [{ name: "示例1", value: 1048 }, { name: "示例2", value: 735 }, { name: "示例3", value: 580 }, { name: "示例4", value: 1005 }, { name: "示例5", value: 700 }],
  barGradient: [{ name: "示例1", value: 1048 }, { name: "示例2", value: 735 }, { name: "示例3", value: 580 }, { name: "示例4", value: 1005 }, { name: "示例5", value: 700 }],
  barGrouped: [{ name: "示例1", value: 840, value2: 520 }, { name: "示例2", value: 560, value2: 760 }, { name: "示例3", value: 720, value2: 480 }, { name: "示例4", value: 980, value2: 640 }, { name: "示例5", value: 660, value2: 880 }],
  barStacked: [{ name: "示例1", value: 620, value2: 380 }, { name: "示例2", value: 450, value2: 520 }, { name: "示例3", value: 780, value2: 300 }, { name: "示例4", value: 540, value2: 640 }, { name: "示例5", value: 700, value2: 420 }],
  barPercent: [{ name: "示例1", value: 620, value2: 380 }, { name: "示例2", value: 450, value2: 520 }, { name: "示例3", value: 780, value2: 300 }, { name: "示例4", value: 540, value2: 640 }, { name: "示例5", value: 700, value2: 420 }],
  barHorizontal: [{ name: "示例1", value: 940 }, { name: "示例2", value: 620 }, { name: "示例3", value: 1180 }, { name: "示例4", value: 760 }, { name: "示例5", value: 1040 }],
  barHorizontalStacked: [{ name: "示例1", value: 620, value2: 380 }, { name: "示例2", value: 450, value2: 520 }, { name: "示例3", value: 780, value2: 300 }, { name: "示例4", value: 540, value2: 640 }],
  line: [{ name: "示例1", value: 420 }, { name: "示例2", value: 680 }, { name: "示例3", value: 540 }, { name: "示例4", value: 860 }, { name: "示例5", value: 620 }, { name: "示例6", value: 940 }],
  lineSmooth: [{ name: "示例1", value: 420 }, { name: "示例2", value: 680 }, { name: "示例3", value: 540 }, { name: "示例4", value: 860 }, { name: "示例5", value: 620 }, { name: "示例6", value: 940 }],
  lineMulti: [{ name: "示例1", value: 420, value2: 620, value3: 260 }, { name: "示例2", value: 680, value2: 380, value3: 540 }, { name: "示例3", value: 540, value2: 760, value3: 360 }, { name: "示例4", value: 860, value2: 480, value3: 640 }, { name: "示例5", value: 620, value2: 700, value3: 480 }],
  area: [{ name: "示例1", value: 320 }, { name: "示例2", value: 540 }, { name: "示例3", value: 460 }, { name: "示例4", value: 720 }, { name: "示例5", value: 580 }],
  areaGradient: [{ name: "示例1", value: 320 }, { name: "示例2", value: 540 }, { name: "示例3", value: 460 }, { name: "示例4", value: 720 }, { name: "示例5", value: 580 }],
  areaStacked: [{ name: "示例1", value: 320, value2: 220 }, { name: "示例2", value: 540, value2: 340 }, { name: "示例3", value: 460, value2: 300 }, { name: "示例4", value: 720, value2: 420 }, { name: "示例5", value: 580, value2: 360 }],
  dualAxis: [{ name: "示例1", value: 840, value2: 62 }, { name: "示例2", value: 560, value2: 48 }, { name: "示例3", value: 980, value2: 75 }, { name: "示例4", value: 660, value2: 55 }, { name: "示例5", value: 760, value2: 68 }],
  radar: [{ name: "开发", value: 86 }, { name: "测试", value: 72 }, { name: "运维", value: 64 }, { name: "设计", value: 90 }, { name: "产品", value: 78 }, { name: "运营", value: 68 }],
  radarFilled: [{ name: "开发", value: 86 }, { name: "测试", value: 72 }, { name: "运维", value: 64 }, { name: "设计", value: 90 }, { name: "产品", value: 78 }, { name: "运营", value: 68 }],
  pieBasic: [{ name: "示例1", value: 420 }, { name: "示例2", value: 320 }, { name: "示例3", value: 260 }, { name: "示例4", value: 180 }, { name: "示例5", value: 120 }],
  pieRose: [{ name: "示例1", value: 100 }, { name: "示例2", value: 180 }, { name: "示例3", value: 140 }, { name: "示例4", value: 80 }, { name: "示例5", value: 220 }],
  scatter: [{ name: "示例1", value: 32 }, { name: "示例2", value: 58 }, { name: "示例3", value: 46 }, { name: "示例4", value: 78 }, { name: "示例5", value: 64 }, { name: "示例6", value: 38 }, { name: "示例7", value: 82 }, { name: "示例8", value: 54 }],
  bubble: [{ name: "示例1", value: 40, value2: 30 }, { name: "示例2", value: 62, value2: 55 }, { name: "示例3", value: 28, value2: 74 }, { name: "示例4", value: 74, value2: 42 }, { name: "示例5", value: 52, value2: 86 }, { name: "示例6", value: 84, value2: 24 }, { name: "示例7", value: 36, value2: 58 }],
  gauge: [{ name: "完成率", value: 68 }],
  waterball: [{ name: "储水率", value: 46 }],
  funnel: [{ name: "访问", value: 1000 }, { name: "注册", value: 760 }, { name: "试用", value: 520 }, { name: "付费", value: 340 }, { name: "续费", value: 180 }],
  heatmap: Array.from({ length: 28 }, (_, index) => ({ name: `示例${(index % 7) + 1}`, value: [32, 58, 46, 78, 64, 38, 82, 54, 70, 44, 90, 60, 36, 76, 52, 66, 40, 84, 58, 72, 48, 62, 34, 88, 56, 74, 42, 68][index] })),
  bar3dGrouped: [{ name: "示例1", value: 840, value2: 520 }, { name: "示例2", value: 560, value2: 760 }, { name: "示例3", value: 720, value2: 480 }, { name: "示例4", value: 980, value2: 640 }],
  bar3dStacked: [{ name: "示例1", value: 620, value2: 380 }, { name: "示例2", value: 450, value2: 520 }, { name: "示例3", value: 780, value2: 300 }, { name: "示例4", value: 540, value2: 640 }],
  pie3d: [{ name: "铝", value: 130 }, { name: "铜", value: 60 }, { name: "锌", value: 95 }, { name: "铅", value: 50 }, { name: "锌合金", value: 58 }],
  donut3d: [{ name: "铝", value: 130 }, { name: "铜", value: 60 }, { name: "锌", value: 95 }, { name: "铅", value: 50 }, { name: "锌合金", value: 58 }],
  rose3d: [{ name: "铜", value: 60 }, { name: "铝", value: 130 }, { name: "锌", value: 95 }, { name: "铅", value: 70 }, { name: "金", value: 45 }],
  roseRing3d: [{ name: "铜", value: 60 }, { name: "铝", value: 130 }, { name: "锌", value: 95 }, { name: "铅", value: 70 }, { name: "金", value: 45 }],
};
/** 控件类组件的默认外观与选项数据，选项统一走 data.options / data.items，参考成品“控件”分类。 */
/** 基础词云的示例词条：value 决定字号权重，风格对齐山海鲸「基础词云」缩略图。 */
const WORD_CLOUD_SAMPLES: Record<string, unknown>[] = [
  { name: "India", value: 96 }, { name: "China", value: 88 }, { name: "United States", value: 82 },
  { name: "Indonesia", value: 64 }, { name: "Brazil", value: 70 }, { name: "Nigeria", value: 58 },
  { name: "Pakistan", value: 48 }, { name: "Bangladesh", value: 44 }, { name: "Russia", value: 52 },
  { name: "Mexico", value: 46 }, { name: "Japan", value: 42 }, { name: "Ethiopia", value: 38 },
  { name: "Philippines", value: 40 }, { name: "Egypt", value: 36 }, { name: "Vietnam", value: 34 },
  { name: "Germany", value: 30 }, { name: "Turkey", value: 32 }, { name: "Iran", value: 28 },
  { name: "Thailand", value: 26 }, { name: "France", value: 24 }, { name: "Kenya", value: 22 },
  { name: "Colombia", value: 20 }, { name: "Spain", value: 18 }, { name: "Argentina", value: 16 },
  { name: "Algeria", value: 14 }, { name: "Canada", value: 12 },
];
/** 区域、点和飞线地图的默认示例数据。 */
const MAP_REGION_ROWS: Record<string, unknown>[] = [
  { name: "中国", value: 96 }, { name: "美国", value: 82 }, { name: "印度", value: 70 }, { name: "巴西", value: 64 },
  { name: "俄罗斯", value: 58 }, { name: "澳大利亚", value: 52 }, { name: "德国", value: 46 }, { name: "加拿大", value: 44 },
  { name: "日本", value: 40 }, { name: "南非", value: 36 }, { name: "法国", value: 32 }, { name: "埃及", value: 28 },
];
const MAP_POINT_ROWS: Record<string, unknown>[] = [
  { name: "北京", value: 92, lon: 116.4, lat: 39.9 }, { name: "上海", value: 78, lon: 121.5, lat: 31.2 },
  { name: "东京", value: 70, lon: 139.7, lat: 35.7 }, { name: "新加坡", value: 62, lon: 103.8, lat: 1.35 },
  { name: "悉尼", value: 54, lon: 151.2, lat: -33.9 }, { name: "莫斯科", value: 60, lon: 37.6, lat: 55.8 },
  { name: "伦敦", value: 66, lon: -0.13, lat: 51.5 }, { name: "纽约", value: 74, lon: -74, lat: 40.7 },
  { name: "迪拜", value: 48, lon: 55.3, lat: 25.2 }, { name: "圣保罗", value: 42, lon: -46.6, lat: -23.55 },
];
/** 热力地图示例：更密的城市点集，值决定热斑半径。 */
const MAP_HEAT_ROWS: Record<string, unknown>[] = [
  { name: "北京", value: 96, lon: 116.4, lat: 39.9 }, { name: "上海", value: 88, lon: 121.5, lat: 31.2 },
  { name: "香港", value: 76, lon: 114.2, lat: 22.3 }, { name: "首尔", value: 68, lon: 127, lat: 37.5 },
  { name: "东京", value: 82, lon: 139.7, lat: 35.7 }, { name: "曼谷", value: 58, lon: 100.5, lat: 13.8 },
  { name: "新加坡", value: 64, lon: 103.8, lat: 1.35 }, { name: "孟买", value: 60, lon: 72.9, lat: 19.1 },
  { name: "迪拜", value: 52, lon: 55.3, lat: 25.2 }, { name: "莫斯科", value: 48, lon: 37.6, lat: 55.8 },
  { name: "伊斯坦布尔", value: 50, lon: 29, lat: 41 }, { name: "开罗", value: 44, lon: 31.2, lat: 30 },
  { name: "伦敦", value: 62, lon: -0.13, lat: 51.5 }, { name: "巴黎", value: 58, lon: 2.35, lat: 48.9 },
  { name: "纽约", value: 78, lon: -74, lat: 40.7 }, { name: "洛杉矶", value: 66, lon: -118.2, lat: 34.1 },
  { name: "圣保罗", value: 54, lon: -46.6, lat: -23.55 }, { name: "悉尼", value: 46, lon: 151.2, lat: -33.9 },
];
/** 轨迹地图示例：按行顺序连接的运输路线（值决定途经点大小）。 */
const MAP_TRACK_ROWS: Record<string, unknown>[] = [
  { name: "北京", value: 90, lon: 116.4, lat: 39.9 }, { name: "西安", value: 60, lon: 108.9, lat: 34.3 },
  { name: "成都", value: 66, lon: 104.1, lat: 30.7 }, { name: "昆明", value: 48, lon: 102.7, lat: 25 },
  { name: "河内", value: 42, lon: 105.8, lat: 21 }, { name: "曼谷", value: 54, lon: 100.5, lat: 13.8 },
  { name: "新加坡", value: 72, lon: 103.8, lat: 1.35 }, { name: "雅加达", value: 50, lon: 106.8, lat: -6.2 },
  { name: "珀斯", value: 40, lon: 115.9, lat: -32 }, { name: "悉尼", value: 84, lon: 151.2, lat: -33.9 },
];
/** 中国地图示例：省级 value 决定底图层高亮深浅，带坐标的行同时驱动呼吸点层。 */
const MAP_CHINA_ROWS: Record<string, unknown>[] = [
  { name: "广东省", value: 96, lon: 113.3, lat: 23.1 }, { name: "北京市", value: 88, lon: 116.4, lat: 39.9 },
  { name: "上海市", value: 82, lon: 121.5, lat: 31.2 }, { name: "四川省", value: 74, lon: 104.1, lat: 30.7 },
  { name: "浙江省", value: 70, lon: 120.2, lat: 30.3 }, { name: "江苏省", value: 66, lon: 118.8, lat: 32.1 },
  { name: "湖北省", value: 58, lon: 114.3, lat: 30.6 }, { name: "陕西省", value: 52, lon: 108.9, lat: 34.3 },
  { name: "山东省", value: 48, lon: 117, lat: 36.7 }, { name: "河南省", value: 44, lon: 113.5, lat: 33.9 },
  { name: "福建省", value: 40, lon: 119.3, lat: 26.1 }, { name: "湖南省", value: 36, lon: 112.9, lat: 28.2 },
];
const controlPresets: Partial<Record<WidgetKind, {
  size: [number, number]; text: string; value?: string; unit?: string;
  background: string; border: string; radius?: number; data?: Record<string, unknown>;
}>> = {
  twin2d: { size: [600, 360], text: "二维孪生", background: "#101f30", border: "#284a6d", data: { zones: [{ label: "生产区", x: 30, y: 30, width: 230, height: 120, color: "#4b9eff" }, { label: "仓储区", x: 285, y: 30, width: 280, height: 120, color: "#4bdeb5" }, { label: "办公区", x: 30, y: 175, width: 190, height: 150, color: "#e8a550" }, { label: "设备区", x: 245, y: 175, width: 320, height: 150, color: "#9a8bea" }] } },
  topology: { size: [520, 380], text: "拓扑图", background: "transparent", border: "transparent", data: {
    nodes: [
      { id: "core", name: "核心交换机", x: 260, y: 56 },
      { id: "agg1", name: "汇聚-1", x: 130, y: 170 },
      { id: "agg2", name: "汇聚-2", x: 390, y: 170 },
      { id: "pc1", name: "终端-1", x: 60, y: 300 },
      { id: "pc2", name: "终端-2", x: 210, y: 300 },
      { id: "cam", name: "监控", x: 400, y: 300 },
    ],
    edges: [
      { from: "core", to: "agg1" }, { from: "core", to: "agg2" },
      { from: "agg1", to: "pc1" }, { from: "agg1", to: "pc2" }, { from: "agg2", to: "cam" },
    ],
  } },
  checkbox: { size: [180, 44], text: "复选框", background: "transparent", border: "transparent", data: { checked: false } },
  input: { size: [240, 44], text: "请输入内容", background: "#14283de6", border: "#284a6d", data: { value: "" } },
  switch: { size: [180, 44], text: "开关", background: "transparent", border: "transparent", data: { checked: false } },
  slider: { size: [300, 56], text: "数值滑动条", background: "transparent", border: "transparent", data: { min: 0, max: 100, step: 1, value: 50 } },
  timeProgress: { size: [340, 56], text: "时间进度条", background: "transparent", border: "transparent", data: { min: 0, max: 86400, step: 60, value: 43200 } },
  colorPicker: { size: [180, 50], text: "选择颜色", background: "transparent", border: "transparent", data: { value: "#4b9eff" } },
  upload: { size: [260, 52], text: "选择文件", background: "transparent", border: "transparent", data: { accept: "", multiple: false } },
  tree: { size: [260, 220], text: "树形控件", background: "#14283de6", border: "#284a6d", data: { items: [{ label: "园区", children: ["生产区", "仓储区", "办公区"] }, { label: "设备", children: ["网关", "传感器"] }] } },
  dropdown: { size: [220, 46], text: "华东区域", background: "#14283de6", border: "#284a6d", data: { options: ["华东区域", "华北区域", "华南区域", "西南区域"] } },
  groupPanel: { size: [340, 240], text: "分组面板", background: "#14283dcc", border: "#284a6d", data: { items: ["设备状态", "能耗统计", "告警记录"] } },
  list: { size: [300, 230], text: "监控列表", background: "#14283dcc", border: "#284a6d", data: { items: ["园区网关在线率 98%", "3 号机房温度 24.6℃", "东侧摄像头离线", "消防通道占用告警"] } },
  dialog: { size: [380, 220], text: "系统消息", value: "确认发布当前看板？发布后预览端立即生效。", background: "#16273be8", border: "#3a6ea5", radius: 8 },
  tabs: { size: [420, 260], text: "实时监控", background: "#14283dcc", border: "#284a6d", data: { items: ["实时监控", "统计分析", "告警列表"] } },
  menuVertical: { size: [200, 240], text: "数据总览", background: "#14283de6", border: "#284a6d", data: { items: ["数据总览", "设备管理", "能耗分析", "告警中心", "系统设置"] } },
  menuHorizontal: { size: [480, 48], text: "首页", background: "#14283de6", border: "#284a6d", data: { items: ["首页", "实时监控", "统计分析", "告警中心"] } },
  search: { size: [280, 44], text: "搜索数据…", background: "#14283de6", border: "#284a6d", radius: 22 },
  progress: { size: [320, 72], text: "设备在线率", background: "#14283de6", border: "#284a6d", data: { percent: 68 } },
  iframe: { size: [480, 320], text: "网页", background: "#101a2cf2", border: "#284a6d", data: { url: "https://semi.design" } },
  weather: { size: [240, 120], text: "北京 · 多云", value: "26", unit: "℃", background: "#14283de6", border: "#284a6d" },
  calendar: { size: [300, 300], text: "日历", background: "#14283dcc", border: "#284a6d" },
  timer: { size: [260, 110], text: "运行时长", background: "#14283de6", border: "#284a6d", data: { startAt: 0 } },
  timeline: { size: [460, 110], text: "项目里程碑", background: "#14283de6", border: "#284a6d", data: { items: ["10-08 需求评审", "10-20 开发联调", "11-05 内测", "11-18 上线"], active: 2 } },
  timePicker: { size: [220, 46], text: "08:00", background: "#14283de6", border: "#284a6d", data: { options: ["08:00", "09:00", "10:00", "11:00", "14:00", "16:00"] } },
  timeRange: { size: [320, 46], text: "08:00 ~ 20:00", background: "#14283de6", border: "#284a6d", data: { options: ["08:00", "20:00"] } },
  shape: { size: [160, 160], text: "基础图形", background: "transparent", border: "transparent", data: { shape: "circle" } },
  flipCounter: { size: [340, 96], text: "今日发电量", value: "12,864", unit: "kWh", background: "transparent", border: "transparent" },
  dataChange: { size: [230, 120], text: "今日销售额", value: "28,462", unit: "元", background: "#14283de6", border: "#284a6d", data: { change: "+12.6%" } },
  tableBasic: { size: [420, 240], text: "基础数据表格", background: "#14283de6", border: "#284a6d",
    data: { columns: ["姓名", "年龄", "性别"], rows: [["小刘", "36", "男"], ["小张", "18", "女"], ["小李", "25", "男"], ["小徐", "20", "女"]] } },
  tableIndex: { size: [420, 240], text: "基础表格", background: "#14283de6", border: "#284a6d",
    data: { columns: ["姓名", "年龄", "性别"], rows: [["小刘", "36", "男"], ["小张", "18", "女"], ["小李", "25", "男"], ["小徐", "20", "女"]] } },
  report: { size: [520, 300], text: "", background: "#fdfdfb", border: "#c9cdc4", radius: 2 },
  textMultiline: { size: [300, 130], text: "基础多行文本\n基础多行文本\n基础多行文本", background: "transparent", border: "#2c4a6e" },
  wordCloud: { size: [420, 260], text: "基础词云", background: "transparent", border: "transparent", data: { rows: WORD_CLOUD_SAMPLES } },
  carousel: { size: [480, 270], text: "轮播图", background: "transparent", border: "transparent", data: {
    urls: [] as string[], interval: 3, objectFit: "stretch", displayStyle: "none", direction: "horizontal",
    buttonPosition: "inside", buttonSize: 30, buttonColor: "#ffffff", buttonRadius: 0, arrows: "always",
    playAnimation: true, animType: "slide", animLoop: true } },
  video: { size: [480, 270], text: "视频", background: "transparent", border: "transparent", data: {
    src: "", autoplay: true, loop: true, loopStart: 0, playbackRate: 1, muted: true,
    hideControls: false, playMode: "pauseResume", transparentBlack: false } },
  audio: { size: [360, 72], text: "音频", background: "#14283de6", border: "#284a6d", radius: 8, data: {
    src: "", autoplay: false, startTime: 0, volume: 100, loop: true, playbackRate: 1,
    hideControls: false, playMode: "pauseResume", transparentBlack: false } },
  monitor: { size: [480, 270], text: "监控", background: "transparent", border: "transparent", data: {
    src: "", protocol: "hls", rtspTransport: "tcp", h265: false, showControls: true, destroyDelay: 10, muted: true } },
  carouselVideo: { size: [480, 270], text: "轮播视频", background: "transparent", border: "transparent", data: {
    urls: [] as string[], autoplay: true, loop: true, loopStart: 0, playbackRate: 1, muted: true,
    hideControls: false, playMode: "pauseResume" } },
  pdf: { size: [480, 360], text: "基础PDF", background: "transparent", border: "transparent", data: {
    src: "", loadingColor: "#14283d", buttonSize: 28, buttonFontSize: 13, buttonFontColor: "#ffffff", clickNext: false } },
  mapRegion: { size: [520, 320], text: "区域地图", background: "transparent", border: "transparent", data: { rows: MAP_REGION_ROWS } },
  mapPoint: { size: [520, 320], text: "点地图", background: "transparent", border: "transparent", data: { rows: MAP_POINT_ROWS } },
  mapFlyline: { size: [520, 320], text: "飞线地图", background: "transparent", border: "transparent", data: { origin: [116.4, 39.9], rows: MAP_POINT_ROWS } },
  mapHeat: { size: [520, 320], text: "热力地图", background: "transparent", border: "transparent", data: { rows: MAP_HEAT_ROWS } },
  mapTrack: { size: [520, 320], text: "轨迹地图", background: "transparent", border: "transparent", data: { rows: MAP_TRACK_ROWS } },
  mapBar: { size: [520, 320], text: "柱状地图", background: "transparent", border: "transparent", data: { rows: MAP_POINT_ROWS } },
  /** 山海鲸「轮廓地图」家族（中国/世界/美国/自定义地图）：底图层 + 呼吸点层 + 展示设置 全量配置，见 docs/map-components-sync.md。 */
  mapOutline: { size: [1280, 720], text: "轮廓地图", background: "transparent", border: "transparent", data: {
    region: "china", projection: "mercator",
    map: {
      fillType: "color", fillImage: "", defaultColor: "#1b3350", highlightColor: "#6cbcff", selectedColor: "#2f7fe8",
      borderColor: "#2c4a6e", borderWidth: 1, borderStyle: "dotted",
      outlineColor: "#3d6a9e", outlineWidth: 0, outlineGlow: 0, glowColor: "#4da3ff",
      shadowSize: 0, shadowColor: "#000000",
      showRegionNames: true, forceShowNames: false,
      nameFont: { family: "", size: 12, bold: false, italic: false, underline: false, strike: false },
    },
    breath: { showName: false, shape: "circle", minR: 5, maxR: 15, color: "#ffd66b" },
    show: { playAnim: false, triggerLinkage: false, animDelay: 1, scrollDuration: 0.5, loopAnim: false, loopInterval: 0 },
    rows: MAP_CHINA_ROWS,
  } },
  /** 山海鲸「瓦片地图」家族（GIS 六变体 + 三维地图 3 变体的 2D 风格化近似）：内置主题替代在线影像。
   *  默认中国省级视图（对照山海鲸卡片：省界主题配色 + 区域名 + 首都高亮）。 */
  mapTile: { size: [1280, 720], text: "瓦片地图", background: "transparent", border: "transparent", data: {
    region: "china", theme: "black-gold", projection: "mercator",
    map: {
      borderColor: "#c9a227", borderWidth: 1, borderStyle: "solid", showRegionNames: true,
      nameFont: { family: "", size: 12, bold: false, italic: false, underline: false, strike: false },
    },
    tile: { centerLon: 105, centerLat: 36, zoom: 1, minZoom: 1, maxZoom: 12, moveZoom: true, tileSource: "内置主题", imagery: "none" },
    rows: [{ name: "北京市", value: 96 }],
  } },
};

export function widgetNode(kind: WidgetKind): Partial<SceneNode> & { type: "widget" } {
  const chart = isChartWidget(kind);
  const preset = controlPresets[kind];
  const data: Record<string, unknown> = preset?.data ? { ...preset.data } : chart ? { rows: chartSamples[kind] ?? [{ name: "一月", value: 32 }, { name: "二月", value: 58 }, { name: "三月", value: 46 }, { name: "四月", value: 78 }, { name: "五月", value: 64 }] } : {};
  if (kind === "timer") data.startAt = Date.now();
  return { type: "widget", name: widgetLabels[kind], color: "#6cbcff", boxSize: { x: preset ? preset.size[0] : chart ? 420 : 300, y: preset ? preset.size[1] : chart ? 260 : kind === "metric" ? 140 : 64, z: 1 },
    transform: { position: { x: 80, y: 80, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    widget: { kind, text: preset ? preset.text : chart ? "业务数据" : kind === "button" ? "查看详情" : "数字孪生可视化", value: preset?.value ?? "1,286", unit: preset?.unit ?? "项", fontSize: kind === "metric" ? 36 : 24,
      background: preset ? preset.background : chart || kind === "metric" ? "#14283de6" : kind === "button" ? "#2563eb" : "transparent", borderColor: preset ? preset.border : chart ? "#284a6d" : "transparent",
      opacity: 1, radius: preset?.radius ?? 6, image: "", align: "left", ...defaultWidgetStyle },
    data,
  };
}
/** 山海鲸「拓扑图」自动布局：按连线 BFS 分层（无入边的为根），层内水平居中、层间固定行距。 */
export function topologyAutoLayout(
  nodes: { id: string; name: string; x: number; y: number }[],
  edges: { from: string; to: string }[],
  width: number,
): { id: string; name: string; x: number; y: number }[] {
  if (!nodes.length) return nodes;
  const ids = new Set(nodes.map((node) => node.id));
  const depth = new Map<string, number>();
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    (incoming.get(edge.to) ?? incoming.set(edge.to, []).get(edge.to)!).push(edge.from);
  }
  // 无入边（或成环回退到首个节点）作为根，BFS 定层；断开的节点跟随后继层
  const queue: string[] = nodes.filter((node) => !(incoming.get(node.id)?.length)).map((node) => node.id);
  const roots = queue.length ? queue : [nodes[0].id];
  roots.forEach((id) => depth.set(id, 0));
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor++];
    for (const edge of edges) {
      if (edge.from !== current || depth.has(edge.to)) continue;
      depth.set(edge.to, (depth.get(current) ?? 0) + 1);
      queue.push(edge.to);
    }
  }
  const fallbackDepth = (depth.get(nodes[0].id) ?? 0) + 1;
  const layers = new Map<number, string[]>();
  for (const node of nodes) {
    const level = depth.get(node.id) ?? fallbackDepth;
    (layers.get(level) ?? layers.set(level, []).get(level)!).push(node.id);
  }
  const spacingY = 110;
  return nodes.map((node) => {
    const level = depth.get(node.id) ?? fallbackDepth;
    const layer = layers.get(level) ?? [node.id];
    const index = layer.indexOf(node.id);
    const slot = width / (layer.length + 1);
    return { ...node, x: Math.round(slot * (index + 1) - 60), y: Math.round(40 + level * spacingY) };
  });
}
/** 控件的选项 / 行数据：dropdown 用 data.options，其余控件用 data.items，缺省回退到预设文本。 */
export function widgetOptions(node: SceneNode, key: "options" | "items" = "items"): string[] {
  const raw = node.data?.[key];
  if (Array.isArray(raw)) return raw.slice(0, 12).map((item) => String(item)).filter(Boolean);
  const fallback = node.widget?.text;
  return fallback ? [fallback] : [];
}

/** 表格同时接受二维数组和 API / CSV 常见的对象数组。 */
export function tableGrid(node: SceneNode): { columns: string[]; rows: string[][] } {
  const rawColumns = node.data?.columns;
  const rawRows = Array.isArray(node.data?.rows) ? node.data!.rows : [];
  const sample = rawRows.find((row) => row && typeof row === "object" && !Array.isArray(row));
  const keys = sample ? Object.keys(sample) : [];
  const suppliedColumns = Array.isArray(rawColumns) ? rawColumns.map(String) : [];
  const columns = (keys.length && !suppliedColumns.some((column) => Object.hasOwn(sample, column)) ? keys : suppliedColumns).slice(0, 12);
  const cell = (value: unknown) => value == null ? "" : typeof value === "object" ? JSON.stringify(value) ?? "" : String(value);
  const rows = rawRows.slice(0, 50).map((row) => Array.isArray(row) ? row.map(cell) :
    row && typeof row === "object" ? columns.map((column) => cell(Object.hasOwn(row, column) ? (row as Record<string, unknown>)[column] : undefined)) : [cell(row)]);
  return { columns, rows };
}

/** Keep the original chart-table labels for its default name/value sample. */
export function chartTableGrid(node: SceneNode): { columns: string[]; rows: string[][] } {
  const grid = tableGrid(node);
  if (!Array.isArray(node.data?.columns) && (grid.columns.length === 0 ||
      (grid.columns.length === 2 && grid.columns[0] === "name" && grid.columns[1] === "value"))) {
    return { ...grid, columns: ["名称", "数值"] };
  }
  return grid;
}

/** 中国式报表的固定栅格：列标 A.. + 行号，编辑器与发布端共用同一尺寸。 */
export const reportGridSize = { columns: 12, rows: 10 };
export const reportColumnLabel = (index: number): string => String.fromCharCode(65 + index);

const wordCloudColors = ["#6cbcff", "#4bdeb5", "#f5c452", "#f472b6", "#a78bfa", "#7dd3fc", "#fb923c", "#5eead4"];

/** 词云布局：value 归一化到 min~max 字号，颜色按词条下标循环，编辑器 / 发布端 / 缩略图共用。 */
export function wordCloudLayout(rows: { name: string; value: number }[], min = 14, max = 42) {
  const top = Math.max(...rows.map((row) => row.value), 1);
  return rows.map((row, index) => ({
    word: row.name,
    size: Math.round(min + (row.value / top) * (max - min)),
    color: wordCloudColors[index % wordCloudColors.length],
  }));
}

export type DataChangeTrend = "up" | "down" | "flat";

/** 数据变化的趋势：无符号且数值为 0 视为持平（—），带 - 号为下降，其余为上升。 */
export function dataChangeTrend(change: string): DataChangeTrend {
  const numeric = Number.parseFloat(change) || 0;
  if (!change.startsWith("+") && !change.startsWith("-") && numeric === 0) return "flat";
  return change.startsWith("-") ? "down" : "up";
}
export const dataChangeArrow: Record<DataChangeTrend, string> = { up: "↑", down: "↓", flat: "—" };

/** 基础日历的 6×7 月视图矩阵（周日开头，null 为留白），编辑器与发布端共用。 */
export function calendarCells(now: Date): (number | null)[][] {
  const first = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = Array.from({ length: 42 }, (_, index) => {
    const day = index + 1 - first;
    return day >= 1 && day <= days ? day : null;
  });
  return Array.from({ length: 6 }, (_, row) => cells.slice(row * 7, row * 7 + 7));
}

/** 基础计时器的已计时秒数（data.startAt 为创建时刻的毫秒时间戳）。 */
export function timerSeconds(node: SceneNode, now: Date): number {
  const startAt = Number(node.data?.startAt);
  if (!Number.isFinite(startAt) || startAt <= 0) return 0;
  return Math.max(0, Math.floor((now.getTime() - startAt) / 1000));
}

export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600), m = Math.floor((totalSeconds % 3600) / 60), s = totalSeconds % 60;
  return [h, m, s].map((part) => String(part).padStart(2, "0")).join(":");
}
export function dataAt(data: Record<string, unknown> | undefined, path: string): unknown {
  return path.split(".").filter(Boolean).reduce<unknown>((value, key) => {
    if (["__proto__", "constructor", "prototype"].includes(key)) return undefined;
    return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  }, data);
}
/** Keep an explicit first-series color in sync with an effective node color. */
export function chartDataWithColor(node: SceneNode, nextColor: string): SceneNode["data"] {
  const chart = node.data?.chart;
  if (!node.widget || node.widget.kind === "table" || !isChartWidget(node.widget.kind)
    || !chart || typeof chart !== "object" || Array.isArray(chart)) return node.data;
  const options = chart as Record<string, unknown>;
  if (!Array.isArray(options.colors)) return node.data;
  const colors = [...options.colors]; colors[0] = nextColor;
  return { ...node.data, chart: { ...options, colors } };
}
export function boundNode(node: SceneNode): SceneNode {
  if (!node.bindings) return node;
  const result = structuredClone(node);
  for (const [key, path] of Object.entries(node.bindings)) {
    if (!path.trim()) continue;
    const value = dataAt(node.data, path);
    if (value === undefined) continue;
    if (key === "visible" && typeof value === "boolean") result.visible = value;
    else if (key === "color" && typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) result.color = value;
    else if (["x", "y", "z"].includes(key) && typeof value === "number" && Number.isFinite(value)) result.transform.position[key as keyof Vec3] = value;
    else if (result.widget && ["text", "value", "unit"].includes(key)) result.widget[key as "text"] = String(value);
    else if (result.widget && ["rows", "items", "options", "columns", "urls", "origin"].includes(key) && Array.isArray(value)) result.data = { ...result.data, [key]: value };
    else if (result.widget && ["change", "src", "url"].includes(key) && (typeof value === "string" || typeof value === "number")) result.data = { ...result.data, [key]: String(value) };
    else if (result.widget && ["percent", "active", "startAt"].includes(key) && (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) && Number.isFinite(Number(value))) result.data = { ...result.data, [key]: Number(value) };
  }
  return result;
}
export function rotateVector(p: number[], r: number[]): [number, number, number] {
  const [x,y,z] = p, [rx,ry,rz] = r;
  const a=x*Math.cos(rz)-y*Math.sin(rz), b=x*Math.sin(rz)+y*Math.cos(rz);
  const c=b*Math.cos(rx)-z*Math.sin(rx), d=b*Math.sin(rx)+z*Math.cos(rx);
  return [a*Math.cos(ry)+d*Math.sin(ry), c, -a*Math.sin(ry)+d*Math.cos(ry)];
}
export function descendants(tree: SceneNode[], ids: string[]): Set<string> {
  const result = new Set(ids); let before = -1;
  while (before !== result.size) { before = result.size; for (const n of tree) if (n.parentId && result.has(n.parentId)) result.add(n.id); }
  return result;
}
export function selectionRoots(tree: SceneNode[], ids: string[]): SceneNode[] {
  const selected = new Set(ids), byId = new Map(tree.map(n=>[n.id,n]));
  return tree.filter(n => selected.has(n.id) && !ancestorMatches(n, byId, p=>selected.has(p.id)));
}
export function ancestorMatches(n: SceneNode, byId: Map<string, SceneNode>, predicate: (n: SceneNode)=>boolean): boolean {
  let parent = n.parentId ? byId.get(n.parentId) : undefined; const seen = new Set([n.id]);
  while (parent && !seen.has(parent.id)) { if (predicate(parent)) return true; seen.add(parent.id); parent = parent.parentId ? byId.get(parent.parentId) : undefined; }
  return false;
}
export function nodeBounds(tree: SceneNode[], ids: string[]) {
  const all = descendants(tree, ids), nodes = tree.filter(n=>all.has(n.id) && !["group","light","camera"].includes(n.type));
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  for (const n of nodes) {
    const p=n.transform.position, s=n.boxSize??{x:1,y:1,z:1}, scale=n.transform.scale;
    const center=n.type==="widget"?[p.x+s.x/2,p.y+s.y/2,p.z]:[p.x,p.y,p.z];
    [s.x*scale.x,s.y*scale.y,s.z*scale.z].forEach((size,i)=>{min[i]=Math.min(min[i],center[i]-size/2);max[i]=Math.max(max[i],center[i]+size/2)});
  }
  if (!nodes.length) { min.fill(0); max.fill(0); }
  return { min, max, center: min.map((v,i)=>(v+max[i])/2), size: max.map((v,i)=>v-min[i]) };
}
export function transformedTree(tree: SceneNode[], ids: string[], property: "position"|"rotation"|"scale", delta: number[]): SceneNode[] {
  const result=structuredClone(tree), roots=selectionRoots(result,ids), affected=descendants(result,roots.map(n=>n.id));
  const pivot=nodeBounds(tree,ids).center, byId=new Map(result.map(n=>[n.id,n]));
  for (const n of result) {
    if (!affected.has(n.id) || n.locked || ancestorMatches(n,byId,p=>p.locked)) continue;
    const p=n.transform.position;
    if (property==="position") { p.x+=delta[0];p.y+=delta[1];p.z+=delta[2]; if(n.to){n.to.x+=delta[0];n.to.y+=delta[1];n.to.z+=delta[2]} }
    else {
      const relative=[p.x-pivot[0],p.y-pivot[1],p.z-pivot[2]];
      const shifted=property==="rotation"?rotateVector(relative,delta.map(v=>v*Math.PI/180)):relative.map((v,i)=>v*delta[i]);
      [p.x,p.y,p.z]=shifted.map((v,i)=>v+pivot[i]);
      const value=n.transform[property];
      if(property==="rotation"){value.x+=delta[0];value.y+=delta[1];value.z+=delta[2]}
      else {value.x=Math.max(.01,value.x*delta[0]);value.y=Math.max(.01,value.y*delta[1]);value.z=Math.max(.01,value.z*delta[2])}
    }
  }
  return result;
}
