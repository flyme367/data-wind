import { widgetNode, type WidgetKind } from "./editor";

export interface ChartCatalogEntry {
  kind: WidgetKind;
  label: string;
  category: string;
  /** A palette preset is saved with each node; it never changes another chart. */
  chart?: Record<string, unknown>;
  series?: 1 | 2 | 3;
  color?: string;
}

export const chartCategories = [
  "全部", "柱状图", "条形图", "折线图", "面积图", "双轴图", "百分比图", "雷达图",
  "饼图", "散点图", "仪表盘", "水球图", "漏斗图", "热力图", "色块图", "3D图表", "其他",
] as const;

const cartesianKinds = new Set<WidgetKind>([
  "bar", "barGradient", "barGrouped", "barStacked", "barPercent", "barHorizontal", "barHorizontalStacked",
  "line", "lineSmooth", "lineMulti", "area", "areaGradient", "areaStacked", "dualAxis", "scatter", "bubble",
  "bar3dGrouped", "bar3dStacked",
]);
const pieKinds = new Set<WidgetKind>(["pie", "pieBasic", "pieRose", "pie3d", "donut3d", "rose3d", "roseRing3d"]);

export const chartHasAxes = (kind: WidgetKind, variant: string) => cartesianKinds.has(kind)
  && !["polarBar", "colorRing", "sankey", "pathAnimation"].includes(variant);

export const chartHasLegend = (kind: WidgetKind, variant: string) =>
  (chartHasAxes(kind, variant) || pieKinds.has(kind) || variant === "polarBar" || variant === "colorRing")
  && !["boxplot", "bullet", "path", "sunburst", "dynamicBar"].includes(variant);

/** The properties panel and interaction actions use the same chart-type capabilities. */
export function chartCapabilities(kind: WidgetKind, chart: Record<string, unknown>) {
  const variant = String(chart.variant ?? "");
  const polar = variant === "polarBar" || variant === "colorRing";
  const sankey = variant === "sankey";
  const animated = variant === "pathAnimation" || variant === "dynamicBar";
  const cartesian = chartHasAxes(kind, variant);
  const bars = !polar && !sankey && (kind.startsWith("bar") || kind === "dualAxis");
  const lines = ["line", "lineSmooth", "lineMulti", "area", "areaGradient", "areaStacked", "dualAxis"].includes(kind);
  const pies = pieKinds.has(kind);
  const pie2d = polar || ["pie", "pieBasic", "pieRose"].includes(kind);
  const ring = kind === "pie" || variant === "roseRing" || variant === "colorRing";
  const gauge = kind === "gauge";
  const heat = kind === "heatmap" && !polar && variant !== "treemap";
  const radar = kind === "radar" || kind === "radarFilled";
  const canLabel = cartesian || pie2d || heat || kind === "funnel"
    || variant === "treemap" || sankey || variant === "pizza";
  const hasLegend = chartHasLegend(kind, variant);
  const labelsByDefault = kind === "heatmap" || kind === "funnel" || sankey || variant === "pizza";
  const nameLabels = sankey || ["pizza", "path", "sunburst"].includes(variant);
  return { variant, polar, sankey, animated, cartesian, bars, lines, pies, pie2d, ring, gauge, heat, radar,
    canLabel, hasLegend, labelsByDefault, nameLabels };
}

/** These widgets share the ordinary 2D Cartesian drawing path. */
export function chartRegularCartesian(kind: WidgetKind, chart: Record<string, unknown>): boolean {
  return chartHasAxes(kind, String(chart.variant ?? "")) && !kind.startsWith("bar3d")
    && !["scatter", "bubble"].includes(kind)
    && !["waterfall", "stream", "boxplot", "bullet", "path", "dynamicBar"].includes(String(chart.variant));
}

/** Numeric axis that supports signed values and an explicit range. */
export function chartSignedScaleAxis(kind: WidgetKind, chart: Record<string, unknown>): "X" | "Y" | undefined {
  if (!chartRegularCartesian(kind, chart)
      || ["rangeArea", "rangeBar", "horizontalRange", "pictorial"].includes(String(chart.variant))) return undefined;
  if (kind === "barHorizontal") return "X";
  return ["line", "lineSmooth", "lineMulti", "area", "areaGradient", "bar", "barGradient", "barGrouped"].includes(kind)
    ? "Y" : undefined;
}

/** The ordinary Cartesian renderer can paint a ranking label for each category. */
export function chartSupportsRanking(kind: WidgetKind, chart: Record<string, unknown>): boolean {
  return chartRegularCartesian(kind, chart)
    && !["rangeArea", "rangeBar", "horizontalRange"].includes(String(chart.variant));
}

/** Expose only chart settings that are rendered by the matching chart configuration. */
export function chartSettingKeys(kind: WidgetKind, chart: Record<string, unknown>): Set<string> {
  const c = chartCapabilities(kind, chart);
  const keys = new Set(["showTooltip", "tooltipBackground", "tooltipTextColor", "tooltipFontSize",
    "tooltipPaddingX", "tooltipPaddingY", "tooltipRadius", "tooltipShowIcon", "tooltipPosition",
    "tooltipBackgroundImage", "tooltipFormat", "tooltipComma", "tooltipDecimals", "tooltipPadZeros",
    "tooltipNameColor", "tooltipNameSize", "tooltipShowTitle", "tooltipTitleColor", "tooltipTitleSize",
    "tooltipShowUnitName", "tooltipUnit", "tooltipUnitColor", "tooltipUnitSize"]);
  const add = (...items: string[]) => items.forEach(item => keys.add(item));
  if (c.bars) {
    add("barWidth");
    if (kind !== "barGradient" && chart.gradient !== true
      && !["bubbleBars", "boxplot", "bullet", "pictorial"].includes(c.variant)) add("barRadius");
  }
  if (c.lines) {
    add("lineWidth", "smooth", "showPoints", "pointRadius");
    if (chartRegularCartesian(kind, chart)) add("lineShadowColor", "lineShadowBlur",
      "pointImage", "pointShadowColor", "pointShadowBlur");
    if (chartRegularCartesian(kind, chart) && kind !== "dualAxis" && chart.variant !== "rangeArea")
      add("zeroRemoval", "zeroRemovalMode", "seriesStyleEnabled", "flowEnabled", "playAnimation",
        "categoryVisibilityMode", "visibleCategoryCount");
    if (chartRegularCartesian(kind, chart) && kind !== "dualAxis") add("boundaryGap");
    if (c.variant !== "pathAnimation") add("lineStyle", "pointShape");
    if (kind.startsWith("area")) add("fillOpacity");
  }
  if (kind === "scatter" || c.variant === "pizza") add("pointRadius");
  if (kind === "bubble") add("bubbleScale");
  if (c.variant === "lineBubble") add("lineWidth");
  if (c.pie2d || c.gauge) add("startAngle", "endAngle");
  if (c.pie2d) add("segmentGap");
  if (["pie", "pieBasic", "pieRose"].includes(kind)) add("pieSize", "pieBorderWidth", "pieBorderColor", "labelFormat");
  if (c.ring) add("innerRadius");
  if (c.gauge) add("gaugeMin", "gaugeMax", "gaugeWidth");
  if (c.radar) add("radarLevels");
  if (c.variant === "pictorial") add("symbolCount");
  if (c.animated) add("playAnimation", "duration");
  if (c.variant === "dynamicBar") add("maxItems");
  if (c.sankey) add("nodeWidth", "nodeGap", "linkOpacity");
  if (c.heat) add("heatColumns", "cellGap");
  if (kind === "funnel") add("funnelGap");
  if (kind === "waterball") add("waterBorder");
  if (c.canLabel) {
    add("showLabels", "labelSize", "labelColor");
    if (!c.nameLabels) add("decimals", "unit", "labelPadZeros");
  }
  if (chartSupportsRanking(kind, chart)) add("showRanking", "rankingFontSize", "rankingColor", "rankingFontFamily",
    "rankingBold", "rankingItalic", "rankingUnderline", "rankingStrike", "rankingDistance",
    "rankingTemplate", "rankingDisplay", "rankingCount", "rankingBackground", "rankingBackgroundShape",
    "rankingBackgroundImage", "rankingBackgroundColor", "rankingBackgroundWidth", "rankingBackgroundHeight",
    "rankingFormat", "rankingOffset");
  if (c.cartesian) add("showXAxis", "showYAxis", "showGrid", "axisFontSize", "axisColor");
  if (chartRegularCartesian(kind, chart)) {
    add("showGridX", "showGridY", "gridColorX", "gridColorY",
      "xAxisFontSize", "yAxisFontSize", "xAxisColor", "yAxisColor", "xLabelOffset", "yLabelOffset",
      "showDataZoom", "zoomStart", "zoomEnd", "zoomHeight", "zoomBottom", "labelFormat", "labelColorMode",
      "labelUnitSize", "labelUnitColor", "labelOffsetX", "labelOffsetY", "labelTilt");
    if (c.lines) add("labelFollowDataColor");
    if (c.lines || kind === "dualAxis") add("tooltipShowVerticalPointer", "tooltipShowHorizontalPointer",
      "tooltipPointerStyle", "tooltipPointerColor", "tooltipPointerWidth", "tooltipPointerLabel",
      "tooltipPointerLabelColor", "tooltipPointerLabelSize", "tooltipPointerLabelBackground");
    if (c.bars) add("labelPosition", "labelSpacing", "labelVerticalOffset", "hideZeroLabels", "labelShowCategory");
    const rightAxisChart = chart.variant !== "rangeArea"
      && ["line", "lineSmooth", "lineMulti", "area", "areaGradient"].includes(kind);
    if (kind === "dualAxis" || rightAxisChart) add("showLineLabels", "lineLabelFormat", "lineLabelDecimals", "lineLabelPadZeros",
      "lineLabelPosition", "lineLabelSize", "lineLabelColor", "lineLabelColorMode", "lineLabelFollowDataColor",
      "lineLabelOffsetX", "lineLabelOffsetY", "lineLabelTilt", "lineLabelUnit", "lineLabelUnitSize", "lineLabelUnitColor");
    const signedAxis = chartSignedScaleAxis(kind, chart);
    if (signedAxis) add(...["axisRangeMode", "axisMin", "axisMax", "axisIntervalMode", "axisInterval"].map(key => `${key}${signedAxis}`));
    if (rightAxisChart) add("rightAxisStart", "rightAxisRangeMode", "rightAxisMin", "rightAxisMax",
      "rightAxisIntervalMode", "rightAxisInterval");
    if (rightAxisChart || kind === "dualAxis") add("tooltipRightFormat", "tooltipRightComma", "tooltipRightDecimals",
      "tooltipRightPadZeros", "tooltipRightUnit", "showRightAxis", "showRightAxisLine", "rightAxisLineStyle",
      "rightAxisLineColor", "rightAxisLineWidth", "showRightAxisTicks", "rightAxisTickColor", "rightAxisTickWidth",
      "rightAxisTickLength", "showRightAxisLabel", "rightAxisFontSize", "rightAxisColor", "rightLabelOffset",
      "rightAxisValueFormat", "rightAxisValueScale", "rightAxisDecimals", "rightAxisPadZeros", "rightAxisRotate",
      "showRightAxisName", "rightAxisName", "rightAxisNameFontSize", "rightAxisNameColor", "rightAxisNameGap",
      "rightAxisNameOffset", "showRightGrid", "rightGridStyle", "rightGridDash", "rightGridColor", "rightGridWidth");
    if (rightAxisChart || kind === "dualAxis") add(...["axisFontFamily", "axisBold", "axisItalic", "axisUnderline",
      "axisStrike", "axisLabelOverflow", "axisLabelMaxWidth", "axisLabelShadowColor", "axisLabelShadowBlur"].map(key => `${key}Right`));
    for (const axis of ["X", "Y"]) add(...["gridStyle", "gridWidth", "gridDash", "showAxisLabel",
      "showAxisLine", "axisLineStyle", "axisLineColor", "axisLineWidth", "showAxisTicks",
      "axisTickColor", "axisTickWidth", "axisTickLength", "showAxisName", "axisName", "axisNameFontSize",
      "axisNameColor", "axisNameGap", "axisLabelRotate", "axisFontFamily", "axisBold", "axisItalic", "axisUnderline",
      "axisStrike", "axisLabelOverflow", "axisLabelMaxWidth", "axisLabelShadowColor", "axisLabelShadowBlur"].map(key => `${key}${axis}`));
    const numericAxis = kind === "barHorizontal" || kind === "barHorizontalStacked" ? "X" : "Y";
    add(...["axisValueFormat", "axisValueScale", "axisDecimals", "axisPadZeros"].map(key => `${key}${numericAxis}`));
  }
  if (c.hasLegend) {
    add("showLegend", "legendFontSize", "legendInteractive", "legendPosition", "legendColor",
      "legendFontFamily", "legendBold", "legendItalic", "legendUnderline", "legendStrike",
      "legendTextMode", "legendTextWidth", "legendTextSpacing", "legendShadowColor", "legendShadowBlur",
      "legendMarker", "legendMarkerSize", "legendGap", "legendMaxChars", "legendType", "legendPageTextSize",
      "legendPageTextColor", "legendPageFontFamily", "legendPageBold", "legendPageItalic", "legendPageUnderline", "legendPageStrike",
      "legendPageIconSize", "legendPageItemGap", "legendPageGap", "legendPageIconColor", "legendPageInactiveColor",
      "legendPageLeftImage", "legendPageRightImage");
  }
  return keys;
}

export function chartColorCount(kind: WidgetKind, chart: Record<string, unknown>): number {
  const { sankey, pies, polar, variant } = chartCapabilities(kind, chart);
  const multiSeries = Number(chart.seriesCount ?? (["barGrouped", "barStacked", "barPercent", "barHorizontalStacked",
    "lineMulti", "areaStacked", "dualAxis", "bar3dGrouped", "bar3dStacked"].includes(kind) ? 2 : 1));
  return sankey || pies || polar || kind === "funnel" || variant === "boxplot" || variant === "pizza"
    || ["waffle", "treemap", "colorBlocks"].includes(variant) ? 3
    : variant === "waterfall" || variant === "bullet" ? 2 : Math.min(3, multiSeries);
}

/** 素材预设与底层图形分离，系列数量和专属配置随实例一起保存。 */
export const chartCatalog: ChartCatalogEntry[] = [
  { kind: "barGrouped", label: "T型分组柱状图", category: "柱状图", series: 2, chart: { variant: "tBar" } },
  { kind: "barGrouped", label: "基础分组柱状图2", category: "柱状图", series: 2 },
  { kind: "barGrouped", label: "基础分组柱状图3", category: "柱状图", series: 3 },
  { kind: "barStacked", label: "基础堆叠柱状图2", category: "柱状图", series: 2 },
  { kind: "barStacked", label: "基础堆叠柱状图3", category: "柱状图", series: 3 },
  { kind: "barPercent", label: "基础百分比堆叠柱状图", category: "柱状图", series: 2 },
  { kind: "bar", label: "基础区间柱状图", category: "柱状图", chart: { variant: "rangeBar" } },
  { kind: "bar", label: "基础瀑布图", category: "柱状图", chart: { variant: "waterfall" } },
  { kind: "barGradient", label: "基础渐变直方图", category: "柱状图" },
  { kind: "bar", label: "基础极坐标柱状图", category: "柱状图", chart: { variant: "polarBar" } },
  { kind: "bar", label: "星耀蓝-柱状气泡图1", category: "柱状图", color: "#2d9aff", chart: { variant: "bubbleBars" } },
  { kind: "bar", label: "星耀蓝-柱状气泡图2", category: "柱状图", color: "#4dc9ff", chart: { variant: "bubbleBars", barWidth: 12 } },
  { kind: "bar", label: "琉璃金-柱状气泡图1", category: "柱状图", color: "#e8b65a", chart: { variant: "bubbleBars" } },
  { kind: "bar", label: "琉璃金-柱状气泡图2", category: "柱状图", color: "#ffd87b", chart: { variant: "bubbleBars", barWidth: 12 } },
  { kind: "bar", label: "幻紫-柱状气泡图1", category: "柱状图", color: "#ad81fa", chart: { variant: "bubbleBars" } },
  { kind: "bar", label: "幻紫-柱状气泡图2", category: "柱状图", color: "#d199ff", chart: { variant: "bubbleBars", barWidth: 12 } },
  { kind: "bar", label: "春江蓝-柱状气泡图1", category: "柱状图", color: "#55dded", chart: { variant: "bubbleBars" } },
  { kind: "barHorizontal", label: "T型分组条形图", category: "条形图", series: 2, chart: { variant: "horizontalGrouped", endCap: true } },
  { kind: "barHorizontal", label: "渐变分组条形图", category: "条形图", series: 2, chart: { variant: "horizontalGrouped", gradient: true } },
  { kind: "barHorizontalStacked", label: "基础堆叠条形图2", category: "条形图", series: 2 },
  { kind: "barHorizontalStacked", label: "基础堆叠条形图3", category: "条形图", series: 3 },
  { kind: "barHorizontal", label: "基础区间条形图", category: "条形图", chart: { variant: "horizontalRange" } },
  { kind: "barHorizontalStacked", label: "基础百分比堆叠条形图", category: "条形图", series: 2, chart: { variant: "horizontalPercent" } },
  { kind: "barHorizontal", label: "动态条形图", category: "条形图", chart: { variant: "dynamicBar", duration: 3, maxItems: 5 } },
  { kind: "barHorizontal", label: "琉璃金-条形气泡图1", category: "条形图", color: "#e8b65a", chart: { variant: "horizontalBubble" } },
  { kind: "barHorizontal", label: "春江蓝-条形图气泡1", category: "条形图", color: "#55dded", chart: { variant: "horizontalBubble" } },
  { kind: "line", label: "基础折线图", category: "折线图", series: 1 },
  { kind: "lineMulti", label: "基础折线图2", category: "折线图", series: 2 },
  { kind: "lineMulti", label: "基础折线图3", category: "折线图", series: 3 },
  { kind: "lineSmooth", label: "基础平滑折线图", category: "折线图", series: 1 },
  { kind: "lineSmooth", label: "基础平滑折线图2", category: "折线图", series: 2 },
  { kind: "lineSmooth", label: "基础平滑折线图3", category: "折线图", series: 3 },
  { kind: "area", label: "基础折线面积图", category: "面积图", series: 1 },
  { kind: "area", label: "基础折线面积图2", category: "面积图", series: 2 },
  { kind: "area", label: "基础折线面积图3", category: "面积图", series: 3 },
  { kind: "area", label: "基础平滑面积图", category: "面积图", series: 1, chart: { smooth: true } },
  { kind: "area", label: "基础平滑面积图2", category: "面积图", series: 2, chart: { smooth: true } },
  { kind: "area", label: "基础平滑面积图3", category: "面积图", series: 3, chart: { smooth: true } },
  { kind: "area", label: "基础区间面积图", category: "面积图", chart: { variant: "rangeArea" } },
  { kind: "areaStacked", label: "基础折线堆叠面积图", category: "面积图", series: 2 },
  { kind: "areaStacked", label: "基础平滑线堆叠面积图", category: "面积图", series: 2, chart: { smooth: true } },
  { kind: "dualAxis", label: "基础堆叠双轴图", category: "双轴图", series: 3, chart: { variant: "dualStacked" } },
  { kind: "dualAxis", label: "基础分组双轴图", category: "双轴图", series: 3, chart: { variant: "dualGrouped" } },
  { kind: "dualAxis", label: "反转分组双轴图", category: "双轴图", series: 3, chart: { variant: "dualReverse" } },
  { kind: "gauge", label: "基础百分比图", category: "百分比图", chart: { gaugeWidth: 4, startAngle: -90, endAngle: 270 } },
  { kind: "radar", label: "基础雷达图", category: "雷达图" },
  { kind: "pieBasic", label: "基础饼状图", category: "饼图" },
  { kind: "pie", label: "基础环形图", category: "饼图" },
  { kind: "pieRose", label: "基础玫瑰图", category: "饼图" },
  { kind: "pieRose", label: "基础玫瑰环图", category: "饼图", chart: { variant: "roseRing", innerRadius: 45 } },
  { kind: "scatter", label: "基础散点图", category: "散点图" },
  { kind: "bubble", label: "基础气泡图", category: "散点图" },
  { kind: "bubble", label: "基础时间序列气泡图", category: "散点图", chart: { variant: "timeBubble" } },
  { kind: "bubble", label: "带线气泡图", category: "散点图", chart: { variant: "lineBubble" } },
  { kind: "gauge", label: "基础仪表盘", category: "仪表盘" },
  { kind: "waterball", label: "基础水球图", category: "水球图" },
  { kind: "funnel", label: "基础漏斗图", category: "漏斗图" },
  { kind: "funnel", label: "基础对比漏斗图", category: "漏斗图", chart: { variant: "compareFunnel" } },
  { kind: "funnel", label: "基础对称漏斗图", category: "漏斗图", chart: { variant: "symmetricFunnel" } },
  { kind: "heatmap", label: "基础热力图", category: "热力图" },
  { kind: "heatmap", label: "基础日历热力图", category: "热力图", chart: { variant: "calendarHeatmap", heatColumns: 53, showLabels: false } },
  { kind: "heatmap", label: "基础华夫图", category: "色块图", chart: { variant: "waffle", heatColumns: 10, showLabels: false } },
  { kind: "heatmap", label: "基础矩形图", category: "色块图", chart: { variant: "treemap", showLabels: true } },
  { kind: "heatmap", label: "基础环状色块图", category: "色块图", chart: { variant: "colorRing", innerRadius: 65 } },
  { kind: "heatmap", label: "基础矩形色块图", category: "色块图", chart: { variant: "colorBlocks", heatColumns: 7, showLabels: false } },
  { kind: "bar3dGrouped", label: "基础3D分组柱状图", category: "3D图表", series: 2 },
  { kind: "bar3dStacked", label: "基础3D堆叠柱状图", category: "3D图表", series: 2 },
  { kind: "pie3d", label: "基础3D饼状图", category: "3D图表" },
  { kind: "donut3d", label: "基础3D环形图", category: "3D图表" },
  { kind: "rose3d", label: "基础3D玫瑰图", category: "3D图表" },
  { kind: "roseRing3d", label: "基础3D玫瑰环图", category: "3D图表" },
  { kind: "areaStacked", label: "基础河流图", category: "其他", series: 3, chart: { variant: "stream", showPoints: false, fillOpacity: 60 } },
  { kind: "bar", label: "基础桑基图", category: "其他", chart: { variant: "sankey", showLabels: true } },
  { kind: "pie", label: "基础玉珏图", category: "其他", chart: { variant: "jade", startAngle: -225, endAngle: 45, innerRadius: 35, segmentGap: 2 } },
  { kind: "barHorizontal", label: "基础甘特图", category: "其他", chart: { variant: "horizontalRange" } },
  { kind: "line", label: "基础路径图", category: "其他", chart: { variant: "path" } },
  { kind: "radar", label: "基础披萨图", category: "其他", chart: { variant: "pizza", showLabels: true } },
  { kind: "bar", label: "基础箱型图", category: "其他", chart: { variant: "boxplot" } },
  { kind: "barHorizontal", label: "基础子弹图", category: "其他", chart: { variant: "bullet" } },
  { kind: "areaStacked", label: "Echarts二开基础示例", category: "其他", series: 3,
    chart: { variant: "stream", codeCompatibility: false, showPoints: false, fillOpacity: 60 } },
  { kind: "line", label: "路径动画", category: "其他", chart: { variant: "pathAnimation", duration: 3 } },
  { kind: "area", label: "雨量关系图", category: "其他", series: 2, chart: { variant: "rainRelation" } },
  { kind: "dualAxis", label: "柱形雨量图", category: "其他", series: 2, chart: { variant: "rainBars" } },
  { kind: "bar", label: "图形柱状图", category: "其他", chart: { variant: "pictorial", symbolCount: 10 } },
  { kind: "pieBasic", label: "旭日图", category: "其他", chart: { variant: "sunburst" } },
];

export const usedChartCategories = chartCategories.filter((category) =>
  category === "全部" || chartCatalog.some((entry) => entry.category === category));

/** Click and drag use the same preset, including its name and independent option object. */
export function chartPaletteNode(entry: ChartCatalogEntry) {
  const node = widgetNode(entry.kind);
  node.name = entry.label;
  node.widget = { ...node.widget!, text: "", background: "transparent", borderColor: "transparent", borderStyle: "none", radius: 0 };
  if (entry.color) node.color = entry.color;
  const chart = { ...entry.chart, ...(entry.series ? { seriesCount: entry.series } : {}) };
  if (["折线图", "面积图", "双轴图"].includes(entry.category) && entry.chart?.variant !== "rangeArea")
    Object.assign(chart, { tooltipAxisTrigger: true });
  if (["dynamicBar", "pathAnimation"].includes(String(entry.chart?.variant))) Object.assign(chart, { startAt: Date.now() });
  let rows = Array.isArray(node.data?.rows) ? node.data.rows as Record<string, unknown>[] : [];
  if (["rangeBar", "horizontalRange", "rangeArea"].includes(String(entry.chart?.variant))) {
    rows = rows.map((row, i) => {
      const end = Number(row.value) || 0;
      return { ...row, value: Math.round(end * (0.12 + (i % 3) * 0.1)), value2: end };
    });
  }
  if (entry.chart?.variant === "waterfall") rows = [
    { name: "收入", value: 620 }, { name: "增长", value: 180 }, { name: "成本", value: -240 },
    { name: "利润", value: 150 }, { name: "调整", value: -90 },
  ];
  if (["waffle", "treemap", "colorRing"].includes(String(entry.chart?.variant))) rows = [
    { name: "类别一", value: 40 }, { name: "类别二", value: 28 },
    { name: "类别三", value: 20 }, { name: "类别四", value: 12 },
  ];
  if (entry.chart?.variant === "calendarHeatmap") rows = Array.from({ length: 371 }, (_, i) => ({
    name: `第${i + 1}天`, value: (i * 37 + (i % 11) * 13) % 101,
  }));
  if (entry.chart?.variant === "compareFunnel") rows = rows.map((row, i) => ({ ...row,
    value2: Math.round((Number(row.value) || 0) * (0.65 + (i % 3) * 0.12)),
  }));
  if (entry.chart?.variant === "sankey") rows = [
    { source: "页面", target: "首页", value: 20 }, { source: "页面", target: "管理", value: 30 },
    { source: "页面", target: "产品", value: 50 }, { source: "首页", target: "模块一", value: 12 },
    { source: "首页", target: "模块二", value: 8 }, { source: "管理", target: "模块二", value: 12 },
    { source: "管理", target: "模块三", value: 18 }, { source: "产品", target: "模块一", value: 20 },
    { source: "产品", target: "模块三", value: 30 },
  ];
  if (entry.chart?.variant === "boxplot") rows = [
    { name: "A", min: 12, q1: 28, median: 40, q3: 52, max: 70 },
    { name: "B", min: 20, q1: 38, median: 54, q3: 67, max: 90 },
    { name: "C", min: 8, q1: 24, median: 35, q3: 48, max: 75 },
    { name: "D", min: 15, q1: 30, median: 48, q3: 62, max: 84 },
  ];
  if (entry.chart?.variant === "bullet") rows = [
    { name: "指标一", value: 68, value2: 85 }, { name: "指标二", value: 76, value2: 90 },
    { name: "指标三", value: 52, value2: 70 }, { name: "指标四", value: 89, value2: 95 },
  ];
  if (entry.chart?.variant === "path") rows = [
    { name: "A", x: 5, value: 48 }, { name: "B", x: 60, value: 82 },
    { name: "C", x: 28, value: 18 }, { name: "D", x: 90, value: 62 },
    { name: "E", x: 45, value: 35 },
  ];
  if (entry.chart?.variant === "sunburst") rows = [
    { name: "产品", value: 60, children: [{ name: "产品A", value: 35 }, { name: "产品B", value: 25 }] },
    { name: "服务", value: 40, children: [{ name: "服务A", value: 22 }, { name: "服务B", value: 18 }] },
  ];
  if (entry.chart?.variant === "dynamicBar") rows = [1, 2, 3, 4].flatMap(period =>
    ["茶饮料", "咖啡", "气泡水", "碳酸饮料", "饮用水"].map((name, i) => ({
      name, period: `${period}月`, value: 500 + ((period * 317 + i * 211) % 1100),
    })));
  if (entry.chart?.variant === "pathAnimation") rows = [
    { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 },
    { x: 0.2, y: 0.8 }, { x: 0.2, y: 0.2 },
  ];
  const series = entry.series;
  if (series) {
    rows = rows.map((row, i) => {
      const value = Number(row.value) || 0;
      const item: Record<string, unknown> = { ...row };
      if (series >= 2) item.value2 = row.value2 ?? Math.round(value * (0.48 + (i % 3) * 0.12));
      else delete item.value2;
      if (series >= 3) item.value3 = row.value3 ?? Math.round(value * (0.32 + (i % 2) * 0.13));
      else delete item.value3;
      return item;
    });
  }
  node.data = { ...node.data, rows, chart };
  return node;
}
