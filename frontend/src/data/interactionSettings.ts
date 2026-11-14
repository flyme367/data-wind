import type { SceneNode } from "../types";
import { chartCapabilities, chartColorCount, chartSettingKeys } from "./chartCatalog";
import {
  dataAt, descendants, isChartWidget, isValidSettingSource, STATE_STYLE_KEYS,
  type Interaction, type InteractionSettingSource,
} from "./editor";
import { asRecord, changeKitTab, mergeRuntimeData, type RuntimeOverride, type RuntimeOverrides } from "./runtimeScene";
import { isKitTabPanel, kitMetadata, kitOptions, kitTabIndex, kitTabLabels } from "./kitRuntime";
import { kitOptionDefinitionsByType } from "./kitOptionSchema";

type SettingScope = "any" | "widget" | "chart";
type Setting = { key: string; label: string; group: string; scope: SettingScope } & (
  | { type: "boolean"; initial: boolean }
  | { type: "number"; initial: number; min: number; max: number; step?: number }
  | { type: "text" | "color"; initial: string }
  | { type: "select"; initial: string; options: { value: string; label: string }[] }
);

const settings: Setting[] = [
  { key: "visible", label: "显示对象", group: "基本设置", scope: "any", type: "boolean", initial: true },
  { key: "widget.opacity", label: "透明度", group: "基本设置", scope: "widget", type: "number", initial: 1, min: 0, max: 1, step: 0.1 },
  { key: "data.passThrough", label: "鼠标穿透", group: "基本设置", scope: "widget", type: "boolean", initial: false },
  { key: "data.loaded", label: "是否加载", group: "基本设置", scope: "widget", type: "boolean", initial: true },
  { key: "text", label: "标题文本", group: "基本设置", scope: "widget", type: "text", initial: "" },
  { key: "color", label: "组件颜色", group: "基本设置", scope: "any", type: "color", initial: "#6cbcff" },
  { key: "layout.x", label: "位置 X", group: "大小和位置", scope: "widget", type: "number", initial: 0, min: -8192, max: 8192 },
  { key: "layout.y", label: "位置 Y", group: "大小和位置", scope: "widget", type: "number", initial: 0, min: -8192, max: 8192 },
  { key: "layout.width", label: "宽度", group: "大小和位置", scope: "widget", type: "number", initial: 300, min: 1, max: 8192 },
  { key: "layout.height", label: "高度", group: "大小和位置", scope: "widget", type: "number", initial: 64, min: 1, max: 8192 },
  { key: "layout.rotation", label: "角度", group: "大小和位置", scope: "widget", type: "number", initial: 0, min: -360, max: 360 },
  { key: "data.chart.colors.0", label: "数据颜色 1", group: "图表颜色", scope: "chart", type: "color", initial: "#6cbcff" },
  { key: "data.chart.colors.1", label: "数据颜色 2", group: "图表颜色", scope: "chart", type: "color", initial: "#3ddbb5" },
  { key: "data.chart.colors.2", label: "数据颜色 3", group: "图表颜色", scope: "chart", type: "color", initial: "#e8b04b" },
  { key: "data.chart.showTooltip", label: "显示悬浮提示", group: "图表配置", scope: "chart", type: "boolean", initial: true },
  { key: "data.chart.tooltipBackground", label: "提示背景颜色", group: "提示信息", scope: "chart", type: "color", initial: "#10243c" },
  { key: "data.chart.tooltipTextColor", label: "提示文字颜色", group: "提示信息", scope: "chart", type: "color", initial: "#cde3f7" },
  { key: "data.chart.tooltipFontSize", label: "提示字体大小", group: "提示信息", scope: "chart", type: "number", initial: 12, min: 6, max: 48 },
  { key: "data.chart.tooltipBackgroundImage", label: "提示背景图片", group: "提示信息", scope: "chart", type: "text", initial: "" },
  { key: "data.chart.tooltipFormat", label: "提示数值格式", group: "提示信息", scope: "chart", type: "select", initial: "normal",
    options: [{ value: "normal", label: "数值" }, { value: "percent", label: "百分比" }] },
  { key: "data.chart.tooltipComma", label: "提示千分位分隔", group: "提示信息", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.tooltipDecimals", label: "提示小数位数", group: "提示信息", scope: "chart", type: "number", initial: 0, min: 0, max: 6 },
  { key: "data.chart.tooltipPadZeros", label: "提示小数补零", group: "提示信息", scope: "chart", type: "boolean", initial: true },
  { key: "data.chart.tooltipRightFormat", label: "右轴提示数值格式", group: "提示信息", scope: "chart", type: "select", initial: "normal",
    options: [{ value: "normal", label: "数值" }, { value: "percent", label: "百分比" }] },
  { key: "data.chart.tooltipRightComma", label: "右轴提示千分位分隔", group: "提示信息", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.tooltipRightDecimals", label: "右轴提示小数位数", group: "提示信息", scope: "chart", type: "number", initial: 0, min: 0, max: 6 },
  { key: "data.chart.tooltipRightPadZeros", label: "右轴提示小数补零", group: "提示信息", scope: "chart", type: "boolean", initial: true },
  { key: "data.chart.tooltipNameColor", label: "提示名称颜色", group: "提示信息", scope: "chart", type: "color", initial: "#cde3f7" },
  { key: "data.chart.tooltipNameSize", label: "提示名称字体大小", group: "提示信息", scope: "chart", type: "number", initial: 12, min: 6, max: 48 },
  { key: "data.chart.tooltipShowTitle", label: "显示提示标题", group: "提示信息", scope: "chart", type: "boolean", initial: true },
  { key: "data.chart.tooltipTitleColor", label: "提示标题颜色", group: "提示信息", scope: "chart", type: "color", initial: "#cde3f7" },
  { key: "data.chart.tooltipTitleSize", label: "提示标题字体大小", group: "提示信息", scope: "chart", type: "number", initial: 12, min: 6, max: 48 },
  { key: "data.chart.tooltipShowUnitName", label: "显示提示单位", group: "提示信息", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.tooltipUnit", label: "提示单位", group: "提示信息", scope: "chart", type: "text", initial: "" },
  { key: "data.chart.tooltipRightUnit", label: "右轴提示单位", group: "提示信息", scope: "chart", type: "text", initial: "" },
  { key: "data.chart.tooltipUnitColor", label: "提示单位颜色", group: "提示信息", scope: "chart", type: "color", initial: "#cde3f7" },
  { key: "data.chart.tooltipUnitSize", label: "提示单位字体大小", group: "提示信息", scope: "chart", type: "number", initial: 12, min: 6, max: 48 },
  { key: "data.chart.tooltipShowVerticalPointer", label: "提示垂直辅助线", group: "提示信息", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.tooltipShowHorizontalPointer", label: "提示水平辅助线", group: "提示信息", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.tooltipPointerStyle", label: "提示辅助线类型", group: "提示信息", scope: "chart", type: "select", initial: "dashed",
    options: [{ value: "solid", label: "实线" }, { value: "dashed", label: "虚线" }] },
  { key: "data.chart.tooltipPointerColor", label: "提示辅助线颜色", group: "提示信息", scope: "chart", type: "color", initial: "#999999" },
  { key: "data.chart.tooltipPointerWidth", label: "提示辅助线宽度", group: "提示信息", scope: "chart", type: "number", initial: 1, min: 0, max: 20 },
  { key: "data.chart.tooltipPointerLabel", label: "显示辅助线标签", group: "提示信息", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.tooltipPointerLabelColor", label: "辅助线标签颜色", group: "提示信息", scope: "chart", type: "color", initial: "#ffffff" },
  { key: "data.chart.tooltipPointerLabelSize", label: "辅助线标签大小", group: "提示信息", scope: "chart", type: "number", initial: 12, min: 6, max: 48 },
  { key: "data.chart.tooltipPointerLabelBackground", label: "辅助线标签背景", group: "提示信息", scope: "chart", type: "color", initial: "#505765" },
  { key: "data.chart.tooltipPaddingX", label: "提示左右内边距", group: "提示信息", scope: "chart", type: "number", initial: 10, min: 0, max: 100 },
  { key: "data.chart.tooltipPaddingY", label: "提示上下内边距", group: "提示信息", scope: "chart", type: "number", initial: 7, min: 0, max: 100 },
  { key: "data.chart.tooltipRadius", label: "提示圆角", group: "提示信息", scope: "chart", type: "number", initial: 4, min: 0, max: 50 },
  { key: "data.chart.tooltipShowIcon", label: "提示图标", group: "提示信息", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.tooltipPosition", label: "提示位置", group: "提示信息", scope: "chart", type: "select", initial: "auto",
    options: [{ value: "auto", label: "自动" }, { value: "center", label: "居中" }] },
  { key: "data.chart.barWidth", label: "柱形宽度", group: "图形形状", scope: "chart", type: "number", initial: 0, min: 0, max: 200 },
  { key: "data.chart.barRadius", label: "图形圆角半径", group: "图形形状", scope: "chart", type: "number", initial: 1, min: 0, max: 30 },
  { key: "data.chart.lineWidth", label: "线宽", group: "图形形状", scope: "chart", type: "number", initial: 2.5, min: 0, max: 20, step: 0.5 },
  { key: "data.chart.lineShadowColor", label: "折线阴影颜色", group: "图形形状", scope: "chart", type: "color", initial: "#000000" },
  { key: "data.chart.lineShadowBlur", label: "折线阴影模糊程度", group: "图形形状", scope: "chart", type: "number", initial: 0, min: 0, max: 100 },
  { key: "data.chart.pointImage", label: "数据点图片", group: "图形形状", scope: "chart", type: "text", initial: "" },
  { key: "data.chart.pointShadowColor", label: "数据点阴影颜色", group: "图形形状", scope: "chart", type: "color", initial: "#000000" },
  { key: "data.chart.pointShadowBlur", label: "数据点阴影模糊程度", group: "图形形状", scope: "chart", type: "number", initial: 0, min: 0, max: 100 },
  { key: "data.chart.seriesStyleEnabled", label: "每条折线独立设置", group: "图形形状", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.flowEnabled", label: "每条流光独立设置", group: "图形形状", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.categoryVisibilityMode", label: "图形显示样式", group: "图形形状", scope: "chart", type: "select", initial: "all",
    options: [{ value: "all", label: "显示全部" }, { value: "custom", label: "自定义" }] },
  { key: "data.chart.visibleCategoryCount", label: "图形数量", group: "图形形状", scope: "chart", type: "number", initial: 10, min: 0, max: 30 },
  { key: "data.chart.zeroRemoval", label: "去除零值", group: "图形形状", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.zeroRemovalMode", label: "去除零值模式", group: "图形形状", scope: "chart", type: "select", initial: "skip",
    options: [{ value: "skip", label: "跳过" }, { value: "segment", label: "分段" }] },
  { key: "data.chart.lineStyle", label: "折线形状", group: "图形形状", scope: "chart", type: "select", initial: "solid",
    options: [{ value: "solid", label: "折线" }, { value: "dashed", label: "虚线" }] },
  { key: "data.chart.smooth", label: "平滑曲线", group: "图形形状", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.boundaryGap", label: "两侧留白", group: "图形形状", scope: "chart", type: "boolean", initial: true },
  { key: "data.chart.showPoints", label: "显示数据点", group: "图形形状", scope: "chart", type: "boolean", initial: true },
  { key: "data.chart.pointRadius", label: "数据点半径", group: "图形形状", scope: "chart", type: "number", initial: 3, min: 0, max: 50 },
  { key: "data.chart.pointShape", label: "点形状", group: "图形形状", scope: "chart", type: "select", initial: "circle",
    options: [{ value: "circle", label: "实心圆" }, { value: "circleEmpty", label: "空心圆" },
      { value: "square", label: "实心方块" }, { value: "squareEmpty", label: "空心方块" },
      { value: "roundSquare", label: "圆角方块" }, { value: "triangle", label: "三角形" }, { value: "diamond", label: "菱形" },
      { value: "gradientCircle", label: "渐变圆" }, { value: "image", label: "自定义图片" }] },
  { key: "data.chart.fillOpacity", label: "面积透明度 (%)", group: "图形形状", scope: "chart", type: "number", initial: 35, min: 0, max: 100 },
  { key: "data.chart.bubbleScale", label: "气泡大小系数", group: "图形形状", scope: "chart", type: "number", initial: 1, min: 0.1, max: 4, step: 0.1 },
  { key: "data.chart.startAngle", label: "开始角度", group: "图形形状", scope: "chart", type: "number", initial: -90, min: -360, max: 360 },
  { key: "data.chart.endAngle", label: "结束角度", group: "图形形状", scope: "chart", type: "number", initial: 270, min: -360, max: 720 },
  { key: "data.chart.segmentGap", label: "扇区间隔", group: "图形形状", scope: "chart", type: "number", initial: 0, min: 0, max: 20 },
  { key: "data.chart.innerRadius", label: "圆环内径 (%)", group: "图形形状", scope: "chart", type: "number", initial: 65, min: 0, max: 95 },
  { key: "data.chart.pieSize", label: "图形大小占比 (%)", group: "图形形状", scope: "chart", type: "number", initial: 100, min: 10, max: 100 },
  { key: "data.chart.pieBorderWidth", label: "外部边框宽度", group: "图形形状", scope: "chart", type: "number", initial: 0, min: 0, max: 20 },
  { key: "data.chart.pieBorderColor", label: "外部边框颜色", group: "图形形状", scope: "chart", type: "color", initial: "#ffffff" },
  { key: "data.chart.gaugeMin", label: "最小值", group: "图形形状", scope: "chart", type: "number", initial: 0, min: -1000000, max: 1000000 },
  { key: "data.chart.gaugeMax", label: "最大值", group: "图形形状", scope: "chart", type: "number", initial: 100, min: -1000000, max: 1000000 },
  { key: "data.chart.gaugeWidth", label: "仪表盘宽度 (%)", group: "图形形状", scope: "chart", type: "number", initial: 22, min: 2, max: 90 },
  { key: "data.chart.radarLevels", label: "网格层数", group: "图形形状", scope: "chart", type: "number", initial: 4, min: 1, max: 12 },
  { key: "data.chart.symbolCount", label: "图形数量", group: "图形形状", scope: "chart", type: "number", initial: 10, min: 2, max: 30 },
  { key: "data.chart.playAnimation", label: "播放动画", group: "图形形状", scope: "chart", type: "boolean", initial: true },
  { key: "data.chart.duration", label: "动画周期 (秒)", group: "图形形状", scope: "chart", type: "number", initial: 3, min: 0.2, max: 60, step: 0.1 },
  { key: "data.chart.maxItems", label: "显示条目数", group: "图形形状", scope: "chart", type: "number", initial: 5, min: 1, max: 20 },
  { key: "data.chart.nodeWidth", label: "节点宽度", group: "图形形状", scope: "chart", type: "number", initial: 10, min: 3, max: 40 },
  { key: "data.chart.nodeGap", label: "节点间距", group: "图形形状", scope: "chart", type: "number", initial: 8, min: 0, max: 30 },
  { key: "data.chart.linkOpacity", label: "连线透明度 (%)", group: "图形形状", scope: "chart", type: "number", initial: 35, min: 0, max: 100 },
  { key: "data.chart.heatColumns", label: "每行色块数量", group: "图形形状", scope: "chart", type: "number", initial: 7, min: 1, max: 53 },
  { key: "data.chart.cellGap", label: "色块间距", group: "图形形状", scope: "chart", type: "number", initial: 2, min: 0, max: 20 },
  { key: "data.chart.funnelGap", label: "图形间距", group: "图形形状", scope: "chart", type: "number", initial: 3, min: 0, max: 30 },
  { key: "data.chart.waterBorder", label: "边框宽度", group: "图形形状", scope: "chart", type: "number", initial: 2, min: 0, max: 20 },
  { key: "data.chart.showLabels", label: "显示图形文本", group: "图形文本", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.labelSize", label: "文字大小", group: "图形文本", scope: "chart", type: "number", initial: 12, min: 6, max: 48 },
  { key: "data.chart.labelColor", label: "文字颜色", group: "图形文本", scope: "chart", type: "color", initial: "#cde3f7" },
  { key: "data.chart.decimals", label: "小数位数", group: "图形文本", scope: "chart", type: "number", initial: 0, min: 0, max: 6 },
  { key: "data.chart.labelPadZeros", label: "小数补零", group: "图形文本", scope: "chart", type: "boolean", initial: true },
  { key: "data.chart.labelFormat", label: "文本显示格式", group: "图形文本", scope: "chart", type: "select", initial: "value",
    options: [{ value: "value", label: "数值" }, { value: "percent", label: "百分比" }] },
  { key: "data.chart.unit", label: "单位", group: "图形文本", scope: "chart", type: "text", initial: "" },
  { key: "data.chart.labelColorMode", label: "文字颜色模式", group: "图形文本", scope: "chart", type: "select", initial: "normal",
    options: [{ value: "normal", label: "默认" }, { value: "follow", label: "跟随图形" }] },
  { key: "data.chart.labelFollowDataColor", label: "跟随数据颜色", group: "图形文本", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.labelUnitSize", label: "单位字体大小", group: "图形文本", scope: "chart", type: "number", initial: 12, min: 6, max: 48 },
  { key: "data.chart.labelUnitColor", label: "单位文字颜色", group: "图形文本", scope: "chart", type: "color", initial: "#cde3f7" },
  { key: "data.chart.labelOffsetX", label: "文字水平偏移", group: "图形文本", scope: "chart", type: "number", initial: 0, min: -500, max: 500 },
  { key: "data.chart.labelOffsetY", label: "文字垂直偏移", group: "图形文本", scope: "chart", type: "number", initial: 0, min: -500, max: 500 },
  { key: "data.chart.labelTilt", label: "文字倾斜角度", group: "图形文本", scope: "chart", type: "number", initial: 0, min: -360, max: 360 },
  { key: "data.chart.labelVerticalOffset", label: "图形文本垂直偏移", group: "图形文本", scope: "chart", type: "number", initial: 0, min: -500, max: 500 },
  { key: "data.chart.labelPosition", label: "文本位置", group: "图形文本", scope: "chart", type: "select", initial: "outside",
    options: [{ value: "inside", label: "内部" }, { value: "outside", label: "外部" }, { value: "top-align", label: "顶部" }] },
  { key: "data.chart.labelSpacing", label: "文本与图形的间距", group: "图形文本", scope: "chart", type: "number", initial: 3, min: -200, max: 200 },
  { key: "data.chart.hideZeroLabels", label: "隐藏零值", group: "图形文本", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.labelShowCategory", label: "显示分类名称", group: "图形文本", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.showRanking", label: "排名文本", group: "排名文本", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.rankingFontSize", label: "排名字体大小", group: "排名文本", scope: "chart", type: "number", initial: 12, min: 6, max: 96 },
  { key: "data.chart.rankingColor", label: "排名字体颜色", group: "排名文本", scope: "chart", type: "color", initial: "#ffffff" },
  { key: "data.chart.rankingFontFamily", label: "排名字体", group: "排名文本", scope: "chart", type: "text", initial: "sans-serif" },
  { key: "data.chart.rankingBold", label: "排名文字加粗", group: "排名文本", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.rankingItalic", label: "排名文字倾斜", group: "排名文本", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.rankingUnderline", label: "排名文字下划线", group: "排名文本", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.rankingStrike", label: "排名文字删除线", group: "排名文本", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.rankingDistance", label: "距图形距离", group: "排名文本", scope: "chart", type: "number", initial: 0, min: -500, max: 500 },
  { key: "data.chart.rankingOffset", label: "排名文本偏移", group: "排名文本", scope: "chart", type: "number", initial: 0, min: -500, max: 500 },
  { key: "data.chart.rankingTemplate", label: "排名文本模板", group: "排名文本", scope: "chart", type: "text", initial: "NO.{}" },
  { key: "data.chart.rankingDisplay", label: "显示文本", group: "排名文本", scope: "chart", type: "select", initial: "all", options: [
    { value: "all", label: "全部" }, { value: "max", label: "最大值" }, { value: "min", label: "最小值" },
    { value: "max-and-min", label: "最大值和最小值" }, { value: "custom", label: "自定义" },
  ] },
  { key: "data.chart.rankingCount", label: "显示数量", group: "排名文本", scope: "chart", type: "number", initial: 3, min: 0, max: 30 },
  { key: "data.chart.rankingBackground", label: "文字背景", group: "排名文本", scope: "chart", type: "select", initial: "shape",
    options: [{ value: "shape", label: "图案" }, { value: "image", label: "图片" }] },
  { key: "data.chart.rankingBackgroundShape", label: "背景图案类型", group: "排名文本", scope: "chart", type: "select", initial: "rect",
    options: [{ value: "rect", label: "矩形" }, { value: "down-arrow-rect", label: "带箭头矩形" }] },
  { key: "data.chart.rankingBackgroundImage", label: "文字背景图片", group: "排名文本", scope: "chart", type: "text", initial: "" },
  { key: "data.chart.rankingBackgroundColor", label: "文字背景颜色", group: "排名文本", scope: "chart", type: "color", initial: "#ffffff00" },
  { key: "data.chart.rankingBackgroundWidth", label: "文字背景宽度", group: "排名文本", scope: "chart", type: "number", initial: 50, min: 0, max: 1000 },
  { key: "data.chart.rankingBackgroundHeight", label: "文字背景高度", group: "排名文本", scope: "chart", type: "number", initial: 30, min: 0, max: 1000 },
  { key: "data.chart.rankingFormat", label: "排名文本格式", group: "排名文本", scope: "chart", type: "select", initial: "text-template",
    options: [{ value: "text-template", label: "文本模板" }, { value: "value-template", label: "数值文本模板" }] },
  { key: "data.chart.showLineLabels", label: "显示折线文本", group: "折线文本", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.lineLabelFormat", label: "折线文本显示格式", group: "折线文本", scope: "chart", type: "select", initial: "value",
    options: [{ value: "value", label: "数值" }, { value: "percent", label: "百分比" }] },
  { key: "data.chart.lineLabelDecimals", label: "折线文本小数位数", group: "折线文本", scope: "chart", type: "number", initial: 0, min: 0, max: 6 },
  { key: "data.chart.lineLabelPadZeros", label: "折线文本小数补零", group: "折线文本", scope: "chart", type: "boolean", initial: true },
  { key: "data.chart.lineLabelPosition", label: "折线文本位置", group: "折线文本", scope: "chart", type: "select", initial: "above",
    options: [{ value: "above", label: "折线上方" }, { value: "top", label: "置顶" }] },
  { key: "data.chart.lineLabelSize", label: "折线文本大小", group: "折线文本", scope: "chart", type: "number", initial: 12, min: 6, max: 48 },
  { key: "data.chart.lineLabelColor", label: "折线文本颜色", group: "折线文本", scope: "chart", type: "color", initial: "#cde3f7" },
  { key: "data.chart.lineLabelColorMode", label: "折线文字颜色模式", group: "折线文本", scope: "chart", type: "select", initial: "normal",
    options: [{ value: "normal", label: "默认" }, { value: "follow", label: "跟随图形" }] },
  { key: "data.chart.lineLabelFollowDataColor", label: "折线文字跟随数据颜色", group: "折线文本", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.lineLabelOffsetX", label: "折线文字水平偏移", group: "折线文本", scope: "chart", type: "number", initial: 0, min: -500, max: 500 },
  { key: "data.chart.lineLabelOffsetY", label: "折线文字垂直偏移", group: "折线文本", scope: "chart", type: "number", initial: 0, min: -500, max: 500 },
  { key: "data.chart.lineLabelTilt", label: "折线文字倾斜角度", group: "折线文本", scope: "chart", type: "number", initial: 0, min: -360, max: 360 },
  { key: "data.chart.lineLabelUnit", label: "折线文本单位", group: "折线文本", scope: "chart", type: "text", initial: "" },
  { key: "data.chart.lineLabelUnitSize", label: "折线单位字体大小", group: "折线文本", scope: "chart", type: "number", initial: 12, min: 6, max: 48 },
  { key: "data.chart.lineLabelUnitColor", label: "折线单位文字颜色", group: "折线文本", scope: "chart", type: "color", initial: "#cde3f7" },
  { key: "data.chart.showXAxis", label: "显示 X 轴", group: "轴", scope: "chart", type: "boolean", initial: true },
  { key: "data.chart.showYAxis", label: "显示 Y 轴", group: "轴", scope: "chart", type: "boolean", initial: true },
  { key: "data.chart.rightAxisStart", label: "右轴首个系列 (0 为关闭)", group: "右轴", scope: "chart", type: "number", initial: 0, min: 0, max: 3 },
  { key: "data.chart.axisRangeModeX", label: "X 轴刻度范围", group: "轴", scope: "chart", type: "select", initial: "adaptive",
    options: [{ value: "adaptive", label: "自适应" }, { value: "custom", label: "自定义" }] },
  { key: "data.chart.axisMinX", label: "X 轴最小刻度值", group: "轴", scope: "chart", type: "number", initial: 0, min: -1e12, max: 1e12, step: 0.1 },
  { key: "data.chart.axisMaxX", label: "X 轴最大刻度值", group: "轴", scope: "chart", type: "number", initial: 100, min: -1e12, max: 1e12, step: 0.1 },
  { key: "data.chart.axisIntervalModeX", label: "X 轴刻度间隔方式", group: "轴", scope: "chart", type: "select", initial: "auto",
    options: [{ value: "auto", label: "自适应" }, { value: "value", label: "数值" }, { value: "number", label: "数量" }] },
  { key: "data.chart.axisIntervalX", label: "X 轴刻度间隔", group: "轴", scope: "chart", type: "number", initial: 50, min: 0.001, max: 1e12 },
  { key: "data.chart.axisRangeModeY", label: "Y 轴刻度范围", group: "轴", scope: "chart", type: "select", initial: "adaptive",
    options: [{ value: "adaptive", label: "自适应" }, { value: "custom", label: "自定义" }] },
  { key: "data.chart.axisMinY", label: "Y 轴最小刻度值", group: "轴", scope: "chart", type: "number", initial: 0, min: -1e12, max: 1e12, step: 0.1 },
  { key: "data.chart.axisMaxY", label: "Y 轴最大刻度值", group: "轴", scope: "chart", type: "number", initial: 100, min: -1e12, max: 1e12, step: 0.1 },
  { key: "data.chart.axisIntervalModeY", label: "Y 轴刻度间隔方式", group: "轴", scope: "chart", type: "select", initial: "auto",
    options: [{ value: "auto", label: "自适应" }, { value: "value", label: "数值" }, { value: "number", label: "数量" }] },
  { key: "data.chart.axisIntervalY", label: "Y 轴刻度间隔", group: "轴", scope: "chart", type: "number", initial: 50, min: 0.001, max: 1e12 },
  { key: "data.chart.rightAxisRangeMode", label: "右轴刻度范围", group: "右轴", scope: "chart", type: "select", initial: "adaptive",
    options: [{ value: "adaptive", label: "自适应" }, { value: "custom", label: "自定义" }] },
  { key: "data.chart.rightAxisMin", label: "右轴最小刻度值", group: "右轴", scope: "chart", type: "number", initial: 0, min: -1e12, max: 1e12, step: 0.1 },
  { key: "data.chart.rightAxisMax", label: "右轴最大刻度值", group: "右轴", scope: "chart", type: "number", initial: 100, min: -1e12, max: 1e12, step: 0.1 },
  { key: "data.chart.rightAxisIntervalMode", label: "右轴刻度间隔方式", group: "右轴", scope: "chart", type: "select", initial: "auto",
    options: [{ value: "auto", label: "自适应" }, { value: "value", label: "数值" }, { value: "number", label: "数量" }] },
  { key: "data.chart.rightAxisInterval", label: "右轴刻度间隔", group: "右轴", scope: "chart", type: "number", initial: 50, min: 0.001, max: 1e12 },
  { key: "data.chart.showRightAxis", label: "显示右侧 Y 轴", group: "右轴", scope: "chart", type: "boolean", initial: true },
  { key: "data.chart.showRightAxisLabel", label: "右轴刻度值", group: "右轴", scope: "chart", type: "boolean", initial: true },
  { key: "data.chart.rightAxisFontSize", label: "右轴文字大小", group: "右轴", scope: "chart", type: "number", initial: 10, min: 6, max: 36 },
  { key: "data.chart.rightAxisColor", label: "右轴文字颜色", group: "右轴", scope: "chart", type: "color", initial: "#90acc1" },
  { key: "data.chart.rightLabelOffset", label: "右轴刻度距轴线", group: "右轴", scope: "chart", type: "number", initial: 10, min: 0, max: 100 },
  { key: "data.chart.rightAxisValueFormat", label: "右轴显示格式", group: "右轴", scope: "chart", type: "select", initial: "normal",
    options: [{ value: "normal", label: "数值" }, { value: "percent", label: "百分比" }] },
  { key: "data.chart.rightAxisValueScale", label: "右轴计数单位", group: "右轴", scope: "chart", type: "select", initial: "0",
    options: [{ value: "0", label: "不设置" }, { value: "3", label: "K" }, { value: "4", label: "万" },
      { value: "5", label: "十万" }, { value: "6", label: "百万" }, { value: "7", label: "千万" }, { value: "8", label: "亿" }] },
  { key: "data.chart.rightAxisDecimals", label: "右轴小数位数", group: "右轴", scope: "chart", type: "number", initial: 0, min: 0, max: 6 },
  { key: "data.chart.rightAxisPadZeros", label: "右轴小数补零", group: "右轴", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.rightAxisRotate", label: "右轴刻度值旋转", group: "右轴", scope: "chart", type: "number", initial: 0, min: -90, max: 90 },
  { key: "data.chart.showRightAxisLine", label: "右轴轴线", group: "右轴", scope: "chart", type: "boolean", initial: true },
  { key: "data.chart.rightAxisLineStyle", label: "右轴轴线类型", group: "右轴", scope: "chart", type: "select", initial: "solid",
    options: [{ value: "solid", label: "实线" }, { value: "dashed", label: "虚线" }] },
  { key: "data.chart.rightAxisLineColor", label: "右轴轴线颜色", group: "右轴", scope: "chart", type: "color", initial: "#cccccc" },
  { key: "data.chart.rightAxisLineWidth", label: "右轴轴线宽度", group: "右轴", scope: "chart", type: "number", initial: 1, min: 0, max: 20 },
  { key: "data.chart.showRightAxisTicks", label: "右轴刻度线", group: "右轴", scope: "chart", type: "boolean", initial: true },
  { key: "data.chart.rightAxisTickColor", label: "右轴刻度线颜色", group: "右轴", scope: "chart", type: "color", initial: "#cccccc" },
  { key: "data.chart.rightAxisTickWidth", label: "右轴刻度线宽度", group: "右轴", scope: "chart", type: "number", initial: 2, min: 0, max: 20 },
  { key: "data.chart.rightAxisTickLength", label: "右轴刻度线长度", group: "右轴", scope: "chart", type: "number", initial: 5, min: 0, max: 50 },
  { key: "data.chart.showRightAxisName", label: "显示右轴名称", group: "右轴", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.rightAxisName", label: "右轴名称", group: "右轴", scope: "chart", type: "text", initial: "" },
  { key: "data.chart.rightAxisNameFontSize", label: "右轴名称字体大小", group: "右轴", scope: "chart", type: "number", initial: 12, min: 6, max: 48 },
  { key: "data.chart.rightAxisNameColor", label: "右轴名称颜色", group: "右轴", scope: "chart", type: "color", initial: "#90acc1" },
  { key: "data.chart.rightAxisNameGap", label: "右轴名称距轴线", group: "右轴", scope: "chart", type: "number", initial: 15, min: -100, max: 200 },
  { key: "data.chart.rightAxisNameOffset", label: "右轴名称文本偏移", group: "右轴", scope: "chart", type: "number", initial: 0, min: -100, max: 200 },
  { key: "data.chart.showRightGrid", label: "右轴网格线", group: "右轴", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.rightGridStyle", label: "右轴网格线类型", group: "右轴", scope: "chart", type: "select", initial: "solid",
    options: [{ value: "solid", label: "直线" }, { value: "dotted", label: "虚线" }] },
  { key: "data.chart.rightGridDash", label: "右轴网格虚线宽度", group: "右轴", scope: "chart", type: "number", initial: 4, min: 0.5, max: 100 },
  { key: "data.chart.rightGridColor", label: "右轴网格线颜色", group: "右轴", scope: "chart", type: "color", initial: "#a4c4e3" },
  { key: "data.chart.rightGridWidth", label: "右轴网格线宽度", group: "右轴", scope: "chart", type: "number", initial: 1, min: 0, max: 20 },
  { key: "data.chart.showGrid", label: "显示网格线", group: "轴", scope: "chart", type: "boolean", initial: true },
  { key: "data.chart.axisFontSize", label: "坐标轴文字大小", group: "轴", scope: "chart", type: "number", initial: 10, min: 6, max: 36 },
  { key: "data.chart.axisColor", label: "坐标轴文字颜色", group: "轴", scope: "chart", type: "color", initial: "#90acc1" },
  { key: "data.chart.showGridX", label: "X 轴网格线", group: "轴", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.showGridY", label: "Y 轴网格线", group: "轴", scope: "chart", type: "boolean", initial: true },
  { key: "data.chart.gridColorX", label: "X 轴网格线颜色", group: "轴", scope: "chart", type: "color", initial: "#a4c4e3" },
  { key: "data.chart.gridColorY", label: "Y 轴网格线颜色", group: "轴", scope: "chart", type: "color", initial: "#a4c4e3" },
  { key: "data.chart.xAxisFontSize", label: "X 轴刻度字体大小", group: "轴", scope: "chart", type: "number", initial: 10, min: 6, max: 36 },
  { key: "data.chart.yAxisFontSize", label: "Y 轴刻度字体大小", group: "轴", scope: "chart", type: "number", initial: 10, min: 6, max: 36 },
  { key: "data.chart.xAxisColor", label: "X 轴刻度文字颜色", group: "轴", scope: "chart", type: "color", initial: "#90acc1" },
  { key: "data.chart.yAxisColor", label: "Y 轴刻度文字颜色", group: "轴", scope: "chart", type: "color", initial: "#90acc1" },
  { key: "data.chart.xLabelOffset", label: "X 轴刻度距轴线", group: "轴", scope: "chart", type: "number", initial: 13, min: 0, max: 100 },
  { key: "data.chart.yLabelOffset", label: "Y 轴刻度距轴线", group: "轴", scope: "chart", type: "number", initial: 7, min: 0, max: 100 },
  { key: "data.chart.showDataZoom", label: "启用缩略轴", group: "缩略轴", scope: "chart", type: "boolean", initial: false },
  { key: "data.chart.zoomStart", label: "数据起点 (%)", group: "缩略轴", scope: "chart", type: "number", initial: 0, min: 0, max: 99 },
  { key: "data.chart.zoomEnd", label: "数据终点 (%)", group: "缩略轴", scope: "chart", type: "number", initial: 100, min: 1, max: 100 },
  { key: "data.chart.zoomHeight", label: "缩略轴高度", group: "缩略轴", scope: "chart", type: "number", initial: 16, min: 4, max: 60 },
  { key: "data.chart.zoomBottom", label: "距底部位置", group: "缩略轴", scope: "chart", type: "number", initial: 10, min: 0, max: 100 },
  { key: "data.chart.showLegend", label: "显示图例", group: "图例", scope: "chart", type: "boolean", initial: true },
  { key: "data.chart.legendType", label: "图例类型", group: "图例", scope: "chart", type: "select", initial: "plain",
    options: [{ value: "plain", label: "普通" }, { value: "scroll", label: "翻页" }] },
  { key: "data.chart.legendPageTextSize", label: "翻页按钮文字大小", group: "图例", scope: "chart", type: "number", initial: 12, min: 6, max: 48 },
  { key: "data.chart.legendPageTextColor", label: "翻页按钮文字颜色", group: "图例", scope: "chart", type: "color", initial: "#ffffff" },
  { key: "data.chart.legendPageIconSize", label: "翻页按钮大小", group: "图例", scope: "chart", type: "number", initial: 12, min: 4, max: 60 },
  { key: "data.chart.legendPageItemGap", label: "按钮和文字间隔", group: "图例", scope: "chart", type: "number", initial: 12, min: 0, max: 100 },
  { key: "data.chart.legendPageGap", label: "图例和按钮间隔", group: "图例", scope: "chart", type: "number", initial: 12, min: 0, max: 100 },
  { key: "data.chart.legendPageIconColor", label: "翻页颜色", group: "图例", scope: "chart", type: "color", initial: "#ffffff" },
  { key: "data.chart.legendPageInactiveColor", label: "禁止翻页颜色", group: "图例", scope: "chart", type: "color", initial: "#3c3c3c" },
  { key: "data.chart.legendPageLeftImage", label: "左侧背景图片", group: "图例", scope: "chart", type: "text", initial: "" },
  { key: "data.chart.legendPageRightImage", label: "右侧背景图片", group: "图例", scope: "chart", type: "text", initial: "" },
  { key: "data.chart.legendPosition", label: "图例位置", group: "图例", scope: "chart", type: "select", initial: "auto",
    options: [{ value: "auto", label: "默认" }, { value: "top-left", label: "顶部偏左" }, { value: "top-center", label: "顶部居中" },
      { value: "top-right", label: "顶部偏右" }, { value: "bottom-left", label: "底部偏左" }, { value: "bottom-center", label: "底部居中" },
      { value: "bottom-right", label: "底部偏右" }, { value: "left-top", label: "左侧偏上" }, { value: "left-center", label: "左侧居中" },
      { value: "left-bottom", label: "左侧偏下" }, { value: "right-top", label: "右侧偏上" }, { value: "right-center", label: "右侧居中" },
      { value: "right-bottom", label: "右侧偏下" }] },
  { key: "data.chart.legendFontSize", label: "图例文字大小", group: "图例", scope: "chart", type: "number", initial: 10, min: 6, max: 36 },
  { key: "data.chart.legendColor", label: "图例文字颜色", group: "图例", scope: "chart", type: "color", initial: "#cde3f7" },
  ...([ ["legend", "图例文字"], ["legendPage", "翻页按钮文字"] ] as const).flatMap(([prefix, label]): Setting[] => [
    { key: `data.chart.${prefix}FontFamily`, label: `${label}字体`, group: "图例", scope: "chart", type: "text", initial: "sans-serif" },
    ...([ ["Bold", "加粗"], ["Italic", "倾斜"], ["Underline", "下划线"], ["Strike", "删除线"] ] as const)
      .map(([suffix, suffixLabel]): Setting => ({ key: `data.chart.${prefix}${suffix}`, label: `${label}${suffixLabel}`,
        group: "图例", scope: "chart", type: "boolean", initial: false })),
  ]),
  { key: "data.chart.legendTextMode", label: "图例文本宽度模式", group: "图例", scope: "chart", type: "select", initial: "auto",
    options: [{ value: "auto", label: "自适应" }, { value: "custom", label: "自定义" }] },
  { key: "data.chart.legendTextWidth", label: "图例文本宽度", group: "图例", scope: "chart", type: "number", initial: 30, min: 0, max: 2000 },
  { key: "data.chart.legendTextSpacing", label: "图例文字间距", group: "图例", scope: "chart", type: "number", initial: 0, min: -10, max: 100 },
  { key: "data.chart.legendShadowColor", label: "图例发光颜色", group: "图例", scope: "chart", type: "color", initial: "#ffffff" },
  { key: "data.chart.legendShadowBlur", label: "图例发光程度", group: "图例", scope: "chart", type: "number", initial: 0, min: 0, max: 100 },
  { key: "data.chart.legendMarker", label: "图例图形", group: "图例", scope: "chart", type: "select", initial: "circle",
    options: [{ value: "circle", label: "圆点" }, { value: "square", label: "方块" }, { value: "roundSquare", label: "圆角方块" },
      { value: "triangle", label: "三角形" }, { value: "diamond", label: "菱形" }, { value: "line", label: "线条" }] },
  { key: "data.chart.legendMarkerSize", label: "图例图形大小", group: "图例", scope: "chart", type: "number", initial: 6, min: 2, max: 40 },
  { key: "data.chart.legendGap", label: "图例项间隔", group: "图例", scope: "chart", type: "number", initial: 10, min: 0, max: 100 },
  { key: "data.chart.legendMaxChars", label: "最长文字数量", group: "图例", scope: "chart", type: "number", initial: 100, min: 1, max: 1000 },
  { key: "data.chart.legendInteractive", label: "点击图例切换显示", group: "图例", scope: "chart", type: "boolean", initial: true },
  ...(["X", "Y", "Right"] as const).flatMap((axis): Setting[] => {
    const label = axis === "Right" ? "右轴" : `${axis} 轴`;
    return [
      { key: `data.chart.axisFontFamily${axis}`, label: `${label}刻度字体`, group: "轴", scope: "chart", type: "text", initial: "sans-serif" },
      ...([ ["Bold", "加粗"], ["Italic", "倾斜"], ["Underline", "下划线"], ["Strike", "删除线"] ] as const)
        .map(([suffix, name]): Setting => ({ key: `data.chart.axis${suffix}${axis}`, label: `${label}刻度${name}`,
          group: "轴", scope: "chart", type: "boolean", initial: false })),
      { key: `data.chart.axisLabelOverflow${axis}`, label: `${label}字体过长策略`, group: "轴", scope: "chart", type: "boolean", initial: false },
      { key: `data.chart.axisLabelMaxWidth${axis}`, label: `${label}字体最长宽度`, group: "轴", scope: "chart", type: "number", initial: 100, min: 1, max: 1000 },
      { key: `data.chart.axisLabelShadowColor${axis}`, label: `${label}外发光颜色`, group: "轴", scope: "chart", type: "color", initial: "#ffffff" },
      { key: `data.chart.axisLabelShadowBlur${axis}`, label: `${label}外发光程度`, group: "轴", scope: "chart", type: "number", initial: 0, min: 0, max: 100 },
    ];
  }),
  ...(["X", "Y"] as const).flatMap((axis): Setting[] => [
    { key: `data.chart.showAxisLabel${axis}`, label: `${axis} 轴刻度值`, group: "轴", scope: "chart", type: "boolean", initial: true },
    { key: `data.chart.axisLabelRotate${axis}`, label: `${axis} 轴刻度值旋转`, group: "轴", scope: "chart", type: "number", initial: 0, min: -90, max: 90 },
    { key: `data.chart.showAxisLine${axis}`, label: `${axis} 轴线`, group: "轴", scope: "chart", type: "boolean", initial: false },
    { key: `data.chart.axisLineColor${axis}`, label: `${axis} 轴线颜色`, group: "轴", scope: "chart", type: "color", initial: "#cccccc" },
    { key: `data.chart.axisLineWidth${axis}`, label: `${axis} 轴线宽度`, group: "轴", scope: "chart", type: "number", initial: 1, min: 0, max: 20 },
    { key: `data.chart.axisLineStyle${axis}`, label: `${axis} 轴线类型`, group: "轴", scope: "chart", type: "select", initial: "solid",
      options: [{ value: "solid", label: "实线" }, { value: "dashed", label: "虚线" }, { value: "dottedLine", label: "点线" }] },
    { key: `data.chart.showAxisTicks${axis}`, label: `${axis} 轴刻度线`, group: "轴", scope: "chart", type: "boolean", initial: false },
    { key: `data.chart.axisTickColor${axis}`, label: `${axis} 轴刻度线颜色`, group: "轴", scope: "chart", type: "color", initial: "#cccccc" },
    { key: `data.chart.axisTickWidth${axis}`, label: `${axis} 轴刻度线宽度`, group: "轴", scope: "chart", type: "number", initial: 2, min: 0, max: 20 },
    { key: `data.chart.axisTickLength${axis}`, label: `${axis} 轴刻度线长度`, group: "轴", scope: "chart", type: "number", initial: 5, min: 0, max: 50 },
    { key: `data.chart.gridStyle${axis}`, label: `${axis} 轴网格线类型`, group: "轴", scope: "chart", type: "select", initial: "solid",
      options: [{ value: "solid", label: "实线" }, { value: "dotted", label: "虚线" }] },
    { key: `data.chart.gridWidth${axis}`, label: `${axis} 轴网格线宽度`, group: "轴", scope: "chart", type: "number", initial: 1, min: 0, max: 20 },
    { key: `data.chart.gridDash${axis}`, label: `${axis} 轴网格虚线长度`, group: "轴", scope: "chart", type: "number", initial: 4, min: 0.5, max: 100 },
    { key: `data.chart.axisValueFormat${axis}`, label: `${axis} 轴显示格式`, group: "轴", scope: "chart", type: "select", initial: "normal",
      options: [{ value: "normal", label: "数值" }, { value: "percent", label: "百分比" }] },
    { key: `data.chart.axisValueScale${axis}`, label: `${axis} 轴计数单位`, group: "轴", scope: "chart", type: "select", initial: "0",
      options: [{ value: "0", label: "不设置" }, { value: "3", label: "K" }, { value: "4", label: "万" },
        { value: "5", label: "十万" }, { value: "6", label: "百万" }, { value: "7", label: "千万" }, { value: "8", label: "亿" }] },
    { key: `data.chart.axisDecimals${axis}`, label: `${axis} 轴小数位数`, group: "轴", scope: "chart", type: "number", initial: 0, min: 0, max: 6 },
    { key: `data.chart.axisPadZeros${axis}`, label: `${axis} 轴小数补零`, group: "轴", scope: "chart", type: "boolean", initial: false },
    { key: `data.chart.showAxisName${axis}`, label: `显示 ${axis} 轴名称`, group: "轴", scope: "chart", type: "boolean", initial: false },
    { key: `data.chart.axisName${axis}`, label: `${axis} 轴名称`, group: "轴", scope: "chart", type: "text", initial: "" },
    { key: `data.chart.axisNameColor${axis}`, label: `${axis} 轴名称颜色`, group: "轴", scope: "chart", type: "color", initial: "#90acc1" },
    { key: `data.chart.axisNameFontSize${axis}`, label: `${axis} 轴名称字体大小`, group: "轴", scope: "chart", type: "number", initial: 12, min: 6, max: 48 },
    { key: `data.chart.axisNameGap${axis}`, label: `${axis} 轴名称偏移`, group: "轴", scope: "chart", type: "number", initial: axis === "X" ? 0 : 15, min: -100, max: 200 },
  ]),
];

function supportsSetting(target: SceneNode, setting: Setting): boolean {
  const { scope } = setting;
  if (scope === "any") return true;
  if (!target.widget) return false;
  if (scope === "widget") return true;
  const kind = target.widget.kind;
  if (kind === "table" || !isChartWidget(kind)) return false;
  const chart = asRecord(target.data?.chart) ?? {};
  const color = /^data\.chart\.colors\.([0-2])$/.exec(setting.key);
  if (color) return Number(color[1]) < chartColorCount(kind, chart);
  return chartSettingKeys(kind, chart).has(setting.key.slice("data.chart.".length));
}

export function settingsForTargets(targets: SceneNode[]): Setting[] {
  if (!targets.length) return [];
  const target = targets[0];
  const kind = target.widget?.kind;
  const chart = asRecord(target.data?.chart) ?? {};
  const capabilities = kind ? chartCapabilities(kind, chart) : undefined;
  return settings.filter(setting => targets.every(target => supportsSetting(target, setting))).map(setting => {
    if (setting.key === "data.chart.smooth" && setting.type === "boolean") return { ...setting, initial: kind === "lineSmooth" };
    if (setting.key === "data.chart.showLabels" && setting.type === "boolean") return { ...setting, initial: capabilities?.labelsByDefault ?? false };
    const horizontal = kind === "barHorizontal" || kind === "barHorizontalStacked";
    if (setting.key === "data.chart.showGridX" && setting.type === "boolean") return { ...setting, initial: horizontal };
    if (setting.key === "data.chart.showGridY" && setting.type === "boolean") return { ...setting, initial: !horizontal };
    if (setting.key === "data.chart.xLabelOffset" && setting.type === "number") return { ...setting, initial: horizontal ? 5 : 13 };
    if (setting.key === "data.chart.yLabelOffset" && setting.type === "number") return { ...setting, initial: horizontal ? 5 : 7 };
    if (setting.key === "data.chart.labelSpacing" && setting.type === "number") return { ...setting, initial: horizontal ? 4 : 3 };
    if (setting.key === "data.chart.rightAxisStart" && setting.type === "number") return { ...setting,
      max: Math.min(...targets.map(item => chartColorCount(item.widget!.kind, asRecord(item.data?.chart) ?? {}))) };
    if (setting.key === "data.chart.showRightAxis" && setting.type === "boolean") return { ...setting, initial: kind !== "dualAxis" };
    if (setting.key === "data.chart.pointRadius" && setting.type === "number") return { ...setting,
      initial: kind === "scatter" || capabilities?.variant === "pizza" ? 4 : 3,
      max: targets.every(item => item.widget?.kind === "scatter") ? 30 : 20 };
    if (setting.key === "data.chart.fillOpacity" && setting.type === "number") return { ...setting, initial: kind === "areaGradient" ? 22 : 35 };
    if (setting.key === "data.chart.startAngle" && setting.type === "number") return { ...setting, initial: capabilities?.gauge ? 135 : -90 };
    if (setting.key === "data.chart.endAngle" && setting.type === "number") return { ...setting, initial: capabilities?.gauge ? 405 : 270 };
    return setting;
  });
}

export function resolveInteractionTargets(rule: Interaction, sourceId: string | undefined, scene: SceneNode[]): SceneNode[] {
  const scope = rule.targetScope;
  const ids = rule.targetIds ?? [rule.targetId || (scope ? "" : sourceId ?? "")];
  if (!scope) {
    const targets = new Set(ids);
    return scene.filter(node => targets.has(node.id));
  }
  const parents = new Set(scope.mode === "currentChildren" ? [sourceId] : ids);
  const query = scope.query.trim().toLocaleLowerCase();
  const nested = scope.recursive ? descendants(scene, [...parents].filter((id): id is string => !!id)) : undefined;
  return scene.filter(node => !parents.has(node.id) && (nested?.has(node.id)
    ?? (node.parentId !== null && parents.has(node.parentId)))
    && (!query || node.name.toLocaleLowerCase().includes(query)));
}

export function currentSettingValue(target: SceneNode | undefined, setting: Setting): unknown {
  if (!target) return setting.initial;
  const lineDefaults: Record<string, string> = { showLineLabels: "showLabels", lineLabelFormat: "labelFormat",
    lineLabelDecimals: "decimals", lineLabelPadZeros: "labelPadZeros", lineLabelSize: "labelSize",
    lineLabelColor: "labelColor", lineLabelColorMode: "labelColorMode", lineLabelFollowDataColor: "labelFollowDataColor",
    lineLabelOffsetX: "labelOffsetX", lineLabelOffsetY: "labelOffsetY", lineLabelTilt: "labelTilt", lineLabelUnit: "unit",
    lineLabelUnitSize: "labelUnitSize", lineLabelUnitColor: "labelUnitColor" };
  const chartKey = setting.key.startsWith("data.chart.") ? setting.key.slice("data.chart.".length) : "";
  const chart = asRecord(target.data?.chart);
  if (lineDefaults[chartKey] && chart && chart[chartKey] === undefined) {
    return chart[lineDefaults[chartKey]] ?? setting.initial;
  }
  const color = /^data\.chart\.colors\.([0-2])$/.exec(setting.key);
  if (color) {
    const colors = asRecord(target.data?.chart)?.colors;
    const index = Number(color[1]);
    return (Array.isArray(colors) ? colors[index] : undefined) ?? [target.color, "#3ddbb5", "#e8b04b"][index];
  }
  const position = target.transform.position;
  return dataAt({ ...target, text: target.widget?.text,
    layout: { x: position.x, y: position.y, width: target.boxSize?.x, height: target.boxSize?.y,
      rotation: target.transform.rotation.z } }, setting.key) ?? setting.initial;
}

function patchObject(setting: Setting, value: unknown): Record<string, unknown> {
  const keys = setting.key.split(".");
  const key = keys.shift() ?? setting.key;
  return { [key]: keys.reduceRight<unknown>((child, part) => ({ [part]: child }), value) };
}

export function settingPatch(setting: Setting, value: unknown): string {
  return JSON.stringify(patchObject(setting, value));
}

function fieldValue(data: Record<string, unknown> | undefined, field: string): unknown {
  return data && Object.hasOwn(data, field) ? data[field] : dataAt(data, field);
}

function componentValue(payload: unknown, field: string): unknown {
  const data = asRecord(payload);
  if (field === "_index") return data?._index ?? data?.index;
  if (field === "value" && !data) return payload;
  if (field.startsWith("row.")) return fieldValue(asRecord(data?.row), field.slice(4));
  return fieldValue(data, field);
}

function valueText(value: unknown): string {
  return value && typeof value === "object" ? JSON.stringify(value) ?? "" : String(value ?? "");
}

function arithmetic(tokens: string[]): number {
  let cursor = 0;
  function term(): number {
    const token = tokens[cursor++];
    if (token === "+" || token === "-") return (token === "-" ? -1 : 1) * term();
    if (token !== "(") return token === ")" || token === "*" || token === "/" ? NaN : Number(token);
    const value = sum();
    return tokens[cursor++] === ")" ? value : NaN;
  }
  function product(): number {
    let value = term();
    while (tokens[cursor] === "*" || tokens[cursor] === "/") {
      const operator = tokens[cursor++];
      const right = term();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }
  function sum(): number {
    let value = product();
    while (tokens[cursor] === "+" || tokens[cursor] === "-") {
      const operator = tokens[cursor++];
      const right = product();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }
  const value = sum();
  return cursor === tokens.length ? value : NaN;
}

function formulaValue(expression: string, payload: unknown, params?: Record<string, unknown>): unknown {
  const read = (field: string) => {
    const key = field.trim();
    if (!key) return undefined;
    return key.startsWith("payload.") ? componentValue(payload, key.slice(8)) : fieldValue(params, key);
  };
  const exact = /^\s*\{:\s*([^{}]+?)\s*\}\s*$/.exec(expression);
  if (exact) return read(exact[1]);
  let missing = false;
  const rendered = expression.replace(/\{:\s*([^{}]+?)\s*\}/g, (_token, field: string) => {
    const value = read(field);
    if (value === undefined) missing = true;
    return valueText(value);
  });
  if (missing) return undefined;
  const tokens = rendered.match(/(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|[()+*/-]/gi) ?? [];
  if (!tokens.length || tokens.join("") !== rendered.replace(/\s/g, "")) return rendered;
  if (tokens.length > 1000) return undefined;
  const value = arithmetic(tokens);
  return Number.isFinite(value) ? value : undefined;
}

function dynamicValue(
  setting: Setting, source: InteractionSettingSource, payload: unknown, params?: Record<string, unknown>,
): unknown {
  if (source.type === "keep") return undefined;
  const value = source.type === "component" ? componentValue(payload, source.field)
    : formulaValue(source.expression, payload, params);
  if (value == null) return undefined;
  if (setting.type === "text") return valueText(value);
  if (setting.type === "color") return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
  if (setting.type === "select") return setting.options.some(option => option.value === value) ? value : undefined;
  if (setting.type === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "true" || value === "1") return true;
    if (value === 0 || value === "false" || value === "0") return false;
    return undefined;
  }
  if (setting.type === "number") {
    const number = typeof value === "number" || (typeof value === "string" && value.trim()) ? Number(value) : NaN;
    if (Number.isFinite(number)) return Math.max(setting.min, Math.min(setting.max, number));
  }
  return undefined;
}

function parseLayout(patch: Record<string, unknown>): RuntimeOverride["layout"] {
  const layout: NonNullable<RuntimeOverride["layout"]> = {};
  for (const key of ["x", "y", "width", "height", "rotation"] as const) {
    const value = patch[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const min = key === "width" || key === "height" ? 1 : -8192;
    layout[key] = Math.max(min, Math.min(8192, value));
  }
  return Object.keys(layout).length ? layout : undefined;
}

/** Both preview and published playback apply the same runtime-only component settings. */
export function applyInteractionSettings(
  rule: Interaction, source: SceneNode | null, scene: SceneNode[], runtime: RuntimeOverrides, value: unknown,
  payload?: unknown, params?: Record<string, unknown>,
): "changed" | "invalid" | "missing" | "empty" {
  const targets = resolveInteractionTargets(rule, source?.id, scene);
  if (!targets.length) return "missing";
  let patch = asRecord(value);
  if (rule.settingSource) {
    if (!isValidSettingSource(rule.settingSource)) return "empty";
    const setting = settingsForTargets(targets).find(item => item.key === rule.settingKey);
    if (!setting) return "empty";
    const value = dynamicValue(setting, rule.settingSource, payload, params);
    if (value === undefined) return "empty";
    patch = patchObject(setting, value);
  }
  if (!patch) return "invalid";
  const color = /^data\.chart\.colors\.([0-2])$/.exec(rule.settingKey ?? "");
  if (color) {
    const index = Number(color[1]);
    const value = dataAt(patch, rule.settingKey!);
    if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) return "empty";
    for (const target of targets) {
      const previous = runtime[target.id];
      const state = previous?.stateId ? asRecord(asRecord(target.data?.chartStates)?.[previous.stateId]) : undefined;
      const currentColors = asRecord(previous?.dataPatch?.chart)?.colors ?? state?.colors
        ?? asRecord(target.data?.chart)?.colors;
      const colors = Array.isArray(currentColors) ? currentColors : [];
      const palette = [previous?.color ?? target.color, "#3ddbb5", "#e8b04b"];
      const next = colors.slice();
      for (const [i, fallback] of palette.entries()) {
        if (typeof next[i] !== "string") next[i] = fallback;
      }
      next[index] = value;
      runtime[target.id] = { ...previous, ...(index === 0 ? { color: value } : {}),
        dataPatch: mergeRuntimeData(previous?.dataPatch, { chart: { colors: next } }) };
    }
    return "changed";
  }

  const styles = asRecord(patch.widget) ?? asRecord(patch.widgetPatch) ?? {};
  const widget = Object.fromEntries(Object.entries(styles).filter(([key]) => (STATE_STYLE_KEYS as readonly string[]).includes(key)));
  const data = asRecord(patch.data) ?? asRecord(patch.dataPatch);
  const layout = parseLayout(asRecord(patch.layout) ?? {});
  const shared: RuntimeOverride = {};
  if (typeof patch.visible === "boolean") shared.visible = patch.visible;
  if (typeof patch.color === "string" && /^#[0-9a-f]{6}$/i.test(patch.color)) shared.color = patch.color;
  if (typeof patch.text === "string") shared.text = patch.text;
  const changesWidget = Object.keys(widget).length > 0;
  const changesData = data && Object.keys(data).length > 0;
  let changed = false;
  for (const target of targets) {
    const previous = runtime[target.id];
    const step = data?.__kitTabStep;
    const kit = step === 1 || step === -1 ? kitMetadata(target) : undefined;
    if (kit && isKitTabPanel(kit.source.type)) {
      const options = { ...kitOptions(kit.source, previous?.stateId), ...asRecord(previous?.dataPatch?.__kitOptionOverrides) };
      const children = scene.filter(node => node.parentId === target.id).map(node => node.name);
      const count = kitTabLabels(options, children).length;
      if (count > 0 && (step === 1 || step === -1)) {
        runtime[target.id] = changeKitTab(previous, (kitTabIndex(options, count) + step + count) % count);
        changed = true;
      }
      continue;
    }
    const next = { ...previous, ...shared };
    if (changesWidget && target.widget) next.widgetPatch = { ...previous?.widgetPatch, ...widget };
    if (changesData && data) next.dataPatch = mergeRuntimeData(previous?.dataPatch, data);
    if (layout && target.widget) next.layout = { ...previous?.layout, ...layout };
    if (Object.keys(shared).length || next.widgetPatch !== previous?.widgetPatch
      || next.dataPatch !== previous?.dataPatch || next.layout !== previous?.layout) {
      runtime[target.id] = next;
      changed = true;
    }
  }
  return changed ? "changed" : "empty";
}

/** Apply one script-authored kit option through the same runtime override as interactions. */
export function applyScriptKitOption(node: SceneNode | undefined, runtime: RuntimeOverrides,
  key: unknown, value: unknown): boolean {
  if (!node || typeof key !== "string" || value === undefined || key.startsWith("__")
      || ["map-key", "size", "position", "rotate", "constructor", "prototype"].includes(key)) return false;
  const meta = kitMetadata(node);
  if (!meta) return false;
  const fields = kitOptionDefinitionsByType[meta.source.type] ?? {};
  if (!Object.hasOwn(fields, key) && !Object.hasOwn(meta.source.options ?? {}, key)) return false;
  const previous = runtime[node.id];
  const patch = { __kitOptionOverrides: { [key]: value } };
  runtime[node.id] = { ...previous, dataPatch: mergeRuntimeData(previous?.dataPatch, patch) };
  return true;
}

export function setPlaybackFullscreen(mode: string, onError: () => void): void {
  const active = Boolean(document.fullscreenElement);
  const next = mode === "enter" || (mode !== "exit" && !active);
  if (next === active) return;
  const change = next ? document.documentElement.requestFullscreen?.() : document.exitFullscreen?.();
  if (change) void change.catch(onError);
  else onError();
}
