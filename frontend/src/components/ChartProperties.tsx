import { Children, cloneElement, isValidElement, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Toast } from "@/lib/toast";
import { Down } from "@icon-park/react";
import type { SceneNode } from "../types";
import { chartCapabilities, chartColorCount, chartRegularCartesian, chartSignedScaleAxis, chartSupportsRanking } from "../data/chartCatalog";
import { widgetFontFamilies } from "../data/editor";
import { BufferedInput, ColorField, Field, NumberField } from "./PropertyFields";

/** 属性面板折叠分区：受控 Collapsible，展开态由 Panels 的 Set 集中管理。 */
function Panel({ itemKey, header, open = false, onOpenChange, children }: {
  itemKey: string; header: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void; children?: ReactNode;
}) {
  return <Collapsible open={open} onOpenChange={onOpenChange} data-panel={itemKey}>
    <CollapsibleTrigger className="properties-collapse-header" aria-label={typeof header === "string" ? header : undefined}>
      <span className="flex-1 text-left">{header}</span>
      <Down theme="outline" size={12} className="shrink-0 transition-transform" style={{ transform: open ? undefined : "rotate(-90deg)" }}/>
    </CollapsibleTrigger>
    <CollapsibleContent className="properties-collapse-content">{children}</CollapsibleContent>
  </Collapsible>;
}
function Panels({ defaultKeys = [], className, children }: {
  defaultKeys?: string[]; className?: string; children?: ReactNode;
}) {
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set(defaultKeys));
  const toggle = (itemKey: string, next: boolean) => setOpenKeys(keys => {
    const update = new Set(keys); if (next) update.add(itemKey); else update.delete(itemKey); return update;
  });
  return <div className={className}>{Children.map(children, child => {
    if (!isValidElement(child)) return child;
    const itemKey = (child.props as { itemKey?: unknown }).itemKey;
    if (typeof itemKey !== "string") return child;
    return cloneElement(child as React.ReactElement<React.ComponentProps<typeof Panel>>, {
      open: openKeys.has(itemKey), onOpenChange: next => toggle(itemKey, next),
    });
  })}</div>;
}
/** Semi Select → shadcn Select：受控 value + onValueChange，optionList 展开成 SelectItem。 */
function SelectField({ label, value, options, disabled, onChange }: {
  label?: string; value: string; options: readonly { value: string; label: string }[]; disabled?: boolean; onChange: (value: string) => void;
}) {
  return <Select value={value} onValueChange={value => typeof value === "string" && onChange(value)} disabled={disabled}>
    <SelectTrigger aria-label={label} size="sm" className="w-full"><SelectValue/></SelectTrigger>
    <SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </Select>;
}

/** 图表参数存于组件自己的 data.chart，画布、预览与导出使用同一份数据。 */
export default function ChartProperties({ node, patchChart }: {
  node: SceneNode; patchChart: (patch: Record<string, unknown>) => void;
}) {
  const kind = node.widget!.kind;
  const [labelTab, setLabelTab] = useState<"main" | "line" | "ranking">("main");
  const [tooltipTab, setTooltipTab] = useState<"basic" | "format" | "text" | "unit" | "pointer">("basic");
  const rankImageRef = useRef<HTMLInputElement>(null);
  const tooltipImageRef = useRef<HTMLInputElement>(null);
  const pointImageRef = useRef<HTMLInputElement>(null);
  const seriesImageRefs = useRef<(HTMLInputElement | null)[]>([]);
  const legendLeftImageRef = useRef<HTMLInputElement>(null);
  const legendRightImageRef = useRef<HTMLInputElement>(null);
  const [axisTab, setAxisTab] = useState<"X" | "Y" | "right">("X");
  const chart = node.data?.chart && typeof node.data.chart === "object" && !Array.isArray(node.data.chart)
    ? node.data.chart as Record<string, unknown> : {};
  const set = (key: string, value: unknown) => patchChart({ [key]: value });
  const num = (key: string, fallback: number) => typeof chart[key] === "number" && Number.isFinite(chart[key])
    ? chart[key] as number : fallback;
  const flag = (key: string, fallback = true) => typeof chart[key] === "boolean" ? chart[key] as boolean : fallback;
  const lineFlag = (key: string, fallback = false) => typeof chart[key] === "boolean" ? chart[key] as boolean : fallback;
  const colors = Array.isArray(chart.colors) ? chart.colors : [];
  const palette = [node.color, "#3ddbb5", "#e8b04b", "#a78bfa", "#f472b6", "#67e0ff", "#fb923c"];
  const locked = node.locked;
  const { sankey, animated, cartesian, bars, lines, pie2d, ring, gauge, heat, radar,
    canLabel, hasLegend, labelsByDefault, nameLabels } = chartCapabilities(kind, chart);
  const colorCount = chartColorCount(kind, chart);
  const categoryPalette = sankey || pie2d || kind.startsWith("pie3d") || ["donut3d", "rose3d", "roseRing3d", "funnel"].includes(kind)
    || ["boxplot", "pizza", "waffle", "treemap", "colorBlocks"].includes(String(chart.variant));
  const colorList = categoryPalette
    ? (colors.length ? colors.map((color, i) => typeof color === "string" ? color : palette[i % palette.length]) : palette)
    : palette.slice(0, colorCount).map((fallback, i) => typeof colors[i] === "string" ? colors[i] as string : fallback);
  const setColor = (index: number, value: string) => {
    const next = categoryPalette ? [...colorList] : Array.from({ length: Math.max(colorCount, colors.length) }, (_, i) =>
      typeof colors[i] === "string" ? colors[i] as string : palette[i % palette.length]);
    next[index] = value;
    patchChart({ colors: next, ...(categoryPalette ? { paletteCycle: true } : {}) });
  };
  // These controls currently share the regular Cartesian renderer. Specialised
  // charts have their own geometry and must not advertise unsupported settings.
  const regularCartesian = chartRegularCartesian(kind, chart);
  const rightAxisChart = regularCartesian && chart.variant !== "rangeArea"
    && ["line", "lineSmooth", "lineMulti", "area", "areaGradient"].includes(kind);
  const rankingChart = chartSupportsRanking(kind, chart);
  const lineTabAvailable = kind === "dualAxis" || rightAxisChart;
  const activeLabelTab = labelTab === "ranking" && !rankingChart || labelTab === "line" && !lineTabAvailable ? "main" : labelTab;
  const signedAxis = chartSignedScaleAxis(kind, chart);
  const hasRightAxis = rightAxisChart || (regularCartesian && kind === "dualAxis");
  const hasTooltipPointer = regularCartesian && (lines || kind === "dualAxis");
  const activeTooltipTab = tooltipTab === "pointer" && !hasTooltipPointer ? "basic" : tooltipTab;
  const horizontal = kind === "barHorizontal" || kind === "barHorizontalStacked";
  const gridXDefault = horizontal && flag("showGrid");
  const gridYDefault = !horizontal && flag("showGrid");
  const referenceLines = Array.isArray(chart.referenceLines)
    ? chart.referenceLines.filter((line): line is Record<string, unknown> =>
      !!line && typeof line === "object" && !Array.isArray(line)) : [];
  const updateReference = (index: number, patch: Record<string, unknown>) =>
    set("referenceLines", referenceLines.map((line, i) => i === index ? { ...line, ...patch } : line));
  const conditions = Array.isArray(chart.colorConditions)
    ? chart.colorConditions.filter((item): item is Record<string, unknown> =>
      !!item && typeof item === "object" && !Array.isArray(item)) : [];
  const updateCondition = (index: number, patch: Record<string, unknown>) =>
    set("colorConditions", conditions.map((condition, i) => i === index ? { ...condition, ...patch } : condition));
  const toggle = (label: string, key: string, fallback = true) => <Field label={label}>
    <Switch size="sm" aria-label={label} disabled={locked} checked={flag(key, fallback)} onCheckedChange={value => set(key, value)}/>
  </Field>;
  const number = (label: string, key: string, fallback: number, min: number, max: number, step = 1) =>
    <NumberField label={label} value={num(key, fallback)} min={min} max={max} step={step} disabled={locked} onChange={value => set(key, value)}/>;
  const alphaColor = (label: string, key: string, fallback: string) => {
    const raw = String(chart[key] ?? fallback);
    const hex = /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(raw) ? raw : "#ffffff";
    const alpha = raw === "transparent" ? 0 : hex.length === 9 ? parseInt(hex.slice(7), 16) : 255;
    const compose = (rgb: string, opacity: number) => `${rgb.slice(0, 7)}${Math.round(opacity).toString(16).padStart(2, "0")}`;
    return <><ColorField label={label} value={raw} disabled={locked} onChange={value => set(key, compose(value, alpha))}/>
      <NumberField label={`${label}不透明度 (%)`} value={Math.round(alpha / 255 * 100)} min={0} max={100} disabled={locked}
        onChange={value => set(key, compose(hex, Math.max(0, Math.min(100, value)) * 255 / 100))}/></>;
  };
  const imageField = (label: string, key: string, input: React.RefObject<HTMLInputElement | null>) => <>
    <Field label={label}><BufferedInput label={`${label}地址`} value={String(chart[key] ?? "")}
      disabled={locked} onChange={value => set(key, value)}/></Field>
    <Button size="sm" disabled={locked} onClick={() => input.current?.click()}>选择本地图片</Button>
    <input hidden ref={input} type="file" aria-label={`选择${label}`} accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
      if (file.size > 1_500_000) { Toast.error("请选择小于 1.5 MB 的图片"); return; }
      const reader = new FileReader(); reader.onload = () => set(key, String(reader.result)); reader.readAsDataURL(file);
    }}/>
  </>;
  const seriesStyles = Array.isArray(chart.seriesStyles) ? chart.seriesStyles : [];
  const seriesStyle = (index: number) => seriesStyles[index] && typeof seriesStyles[index] === "object"
    && !Array.isArray(seriesStyles[index]) ? seriesStyles[index] as Record<string, unknown> : {};
  const setSeries = (index: number, key: string, value: unknown) => {
    const next = Array.from({ length: Math.max(seriesStyles.length, index + 1) }, (_, i) => ({ ...seriesStyle(i) }));
    next[index]![key] = value; set("seriesStyles", next);
  };
  const seriesAlphaColor = (label: string, index: number, key: string) => {
    const raw = String(seriesStyle(index)[key] ?? chart[key] ?? "#00000000");
    const hex = /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(raw) ? raw : "#000000";
    const alpha = raw === "transparent" ? 0 : hex.length === 9 ? parseInt(hex.slice(7), 16) : 255;
    const compose = (rgb: string, opacity: number) => `${rgb.slice(0, 7)}${Math.round(opacity).toString(16).padStart(2, "0")}`;
    return <><ColorField label={label} value={raw} disabled={locked} onChange={next => setSeries(index, key, compose(next, alpha))}/>
      <NumberField label={`${label}不透明度 (%)`} value={Math.round(alpha / 255 * 100)} min={0} max={100} disabled={locked}
        onChange={next => setSeries(index, key, compose(hex, Math.max(0, Math.min(100, next)) * 255 / 100))}/></>;
  };
  const flowStyles = Array.isArray(chart.flowStyles) ? chart.flowStyles : [];
  const flowStyle = (index: number) => flowStyles[index] && typeof flowStyles[index] === "object"
    && !Array.isArray(flowStyles[index]) ? flowStyles[index] as Record<string, unknown> : {};
  const setFlow = (index: number, key: string, value: unknown) => {
    const next = Array.from({ length: Math.max(flowStyles.length, index + 1) }, (_, i) => ({ ...flowStyle(i) }));
    next[index]![key] = value; set("flowStyles", next);
  };
  const flowColor = (index: number) => {
    const raw = String(flowStyle(index).color ?? "#ffffff");
    const hex = /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(raw) ? raw : "#ffffff";
    const alpha = raw === "transparent" ? 0 : hex.length === 9 ? parseInt(hex.slice(7), 16) : 255;
    const compose = (rgb: string, opacity: number) => `${rgb.slice(0, 7)}${Math.round(opacity).toString(16).padStart(2, "0")}`;
    return <><ColorField label="流光颜色" value={raw} disabled={locked} onChange={next => setFlow(index, "color", compose(next, alpha))}/>
      <NumberField label="流光颜色不透明度 (%)" value={Math.round(alpha / 255 * 100)} min={0} max={100} disabled={locked}
        onChange={next => setFlow(index, "color", compose(hex, Math.max(0, Math.min(100, next)) * 255 / 100))}/></>;
  };
  const offsetField = (label: string, value: unknown, change: (next: number[]) => void) => {
    const offset = Array.isArray(value) ? value : [0, 0];
    return <><NumberField label={`${label} X`} value={Number(offset[0] ?? 0)} min={-100} max={100} disabled={locked}
      onChange={next => change([next, Number(offset[1] ?? 0)])}/>
      <NumberField label={`${label} Y`} value={Number(offset[1] ?? 0)} min={-100} max={100} disabled={locked}
        onChange={next => change([Number(offset[0] ?? 0), next])}/></>;
  };
  const pointShapeOptions = [{ value: "circle", label: "实心圆" }, { value: "circleEmpty", label: "空心圆" },
    { value: "gradientCircle", label: "渐变圆" }, { value: "square", label: "实心方块" },
    { value: "squareEmpty", label: "空心方块" }, { value: "roundSquare", label: "圆角方块" },
    { value: "triangle", label: "三角形" }, { value: "diamond", label: "菱形" }, { value: "image", label: "自定义图片" }];
  const legendFontFields = (prefix: "legend" | "legendPage", label: string) => <>
    <Field label={`${label}字体`}><SelectField label={`${label}字体`} disabled={locked}
      value={String(chart[`${prefix}FontFamily`] ?? "sans-serif")}
      options={[{ value: "sans-serif", label: "sans-serif" }, ...widgetFontFamilies]}
      onChange={value => set(`${prefix}FontFamily`, value)}/></Field>
    {toggle(`${label}加粗`, `${prefix}Bold`, false)}
    {toggle(`${label}倾斜`, `${prefix}Italic`, false)}
    {toggle(`${label}下划线`, `${prefix}Underline`, false)}
    {toggle(`${label}删除线`, `${prefix}Strike`, false)}
  </>;
  const axisFontFields = (axis: "X" | "Y" | "Right") => {
    const label = axis === "Right" ? "右轴" : `${axis} 轴`;
    const key = (name: string) => `axis${name}${axis}`;
    return <>
      <Field label={`${label}刻度字体`}><SelectField label={`${label}刻度字体`} disabled={locked}
        value={String(chart[key("FontFamily")] ?? "sans-serif")}
        options={[{ value: "sans-serif", label: "sans-serif" }, ...widgetFontFamilies]}
        onChange={value => set(key("FontFamily"), value)}/></Field>
      {toggle(`${label}刻度加粗`, key("Bold"), false)}
      {toggle(`${label}刻度倾斜`, key("Italic"), false)}
      {toggle(`${label}刻度下划线`, key("Underline"), false)}
      {toggle(`${label}刻度删除线`, key("Strike"), false)}
      {toggle(`${label}字体过长策略`, key("LabelOverflow"), false)}
      {flag(key("LabelOverflow"), false) && number(`${label}字体最长宽度`, key("LabelMaxWidth"), 100, 1, 1000)}
      <ColorField label={`${label}外发光颜色`} value={String(chart[key("LabelShadowColor")] ?? "#ffffff")}
        disabled={locked} onChange={value => set(key("LabelShadowColor"), value)}/>
      {number(`${label}外发光程度`, key("LabelShadowBlur"), 0, 0, 100)}
      {offsetField(`${label}外发光偏移`, chart[key("LabelShadowOffset")], value => set(key("LabelShadowOffset"), value))}
    </>;
  };
  const rotation = (label: string, key: string, right = false) => {
    const current = num(key, 0);
    const options = [0, 90, 45, -45, -90].map(degrees => ({
      value: String(right ? degrees : -degrees), label: degrees === 0 ? "不旋转" : `${degrees}°`,
    }));
    if (!options.some(option => option.value === String(current))) {
      options.push({ value: String(current), label: `${right ? current : -current}°` });
    }
    return <Field label={label}><SelectField label={label} disabled={locked} value={String(current)}
      options={options} onChange={value => set(key, Number(value))}/></Field>;
  };
  const valueRange = (right = false) => {
    const axis = signedAxis ?? "Y";
    const mode = right ? "rightAxisRangeMode" : `axisRangeMode${axis}`;
    const minimum = right ? "rightAxisMin" : `axisMin${axis}`;
    const maximum = right ? "rightAxisMax" : `axisMax${axis}`;
    const intervalMode = right ? "rightAxisIntervalMode" : `axisIntervalMode${axis}`;
    const interval = right ? "rightAxisInterval" : `axisInterval${axis}`;
    const label = right ? "右轴刻度范围" : `${axis} 轴刻度范围`;
    return <>
      <Field label={label}><SelectField label={label} disabled={locked}
        value={String(chart[mode] ?? "adaptive")} options={[
          { value: "adaptive", label: "自适应" }, { value: "custom", label: "自定义" },
        ]} onChange={value => set(mode, value)}/></Field>
      {chart[mode] === "custom" && <>
        {number(right ? "右轴最小刻度值" : `${axis} 轴最小刻度值`, minimum, 0, -1e12, 1e12, 0.1)}
        {number(right ? "右轴最大刻度值" : `${axis} 轴最大刻度值`, maximum, 100, -1e12, 1e12, 0.1)}
        <Field label="刻度间隔方式"><SelectField label="刻度间隔方式" disabled={locked}
          value={String(chart[intervalMode] ?? "auto")} options={[
            { value: "auto", label: "自适应" }, { value: "value", label: "数值" }, { value: "number", label: "数量" },
          ]} onChange={value => set(intervalMode, value)}/></Field>
        {chart[intervalMode] !== undefined && chart[intervalMode] !== "auto"
          && number("轴刻度间隔", interval, chart[intervalMode] === "number" ? 3 : 50,
            chart[intervalMode] === "number" ? 1 : 0.001, chart[intervalMode] === "number" ? 100 : 1e12,
            chart[intervalMode] === "number" ? 1 : 0.1)}
        {num(minimum, 0) >= num(maximum, 100) && <p className="properties-note">最大刻度值须大于最小刻度值，当前使用自适应范围。</p>}
      </>}
    </>;
  };

  return <>{chart.codeCompatibility === false && <p className="properties-note">示例使用内置图形渲染；ECharts 自定义代码尚未接入。</p>}
  <Panels className="properties-collapse" defaultKeys={["color", "shape"]}>
    <Panel header={categoryPalette ? "数据颜色" : "颜色"} itemKey="color"><section className="property-section">
      {colorList.map((value, index) => <div className="chart-palette-entry" key={index}>
        <ColorField label={`数据颜色 ${index + 1}`} value={value} disabled={locked} onChange={value => setColor(index, value)}/>
        {categoryPalette && colorList.length > 1 && <Button size="sm" variant="ghost" disabled={locked}
          aria-label={`删除数据颜色 ${index + 1}`} onClick={() => patchChart({ colors: colorList.filter((_, i) => i !== index), paletteCycle: true })}>×</Button>}
      </div>)}
      {categoryPalette && <Button size="sm" disabled={locked || colorList.length >= 30}
        onClick={() => patchChart({ colors: [...colorList, palette[colorList.length % palette.length]], paletteCycle: true })}>添加颜色</Button>}
      {regularCartesian && bars && <div className="chart-conditions">
        <div className="chart-conditions-title">条件样式</div>
        {conditions.map((condition, index) => <div className="chart-reference-line" key={index}>
          <Field label={`规则 ${index + 1}`}><Button size="sm" disabled={locked}
            onClick={() => set("colorConditions", conditions.filter((_, i) => i !== index))}>删除</Button></Field>
          <Field label="条件字段"><BufferedInput label={`规则${index + 1}条件字段`} value={String(condition.field ?? "value")}
            disabled={locked} onChange={value => updateCondition(index, { field: value })}/></Field>
          <Field label="判断方式"><SelectField label={`规则${index + 1}判断方式`} disabled={locked}
            value={String(condition.operator ?? "gte")} options={[
              { value: "gt", label: "大于" }, { value: "gte", label: "大于等于" }, { value: "lt", label: "小于" },
              { value: "lte", label: "小于等于" }, { value: "eq", label: "等于" }, { value: "ne", label: "不等于" },
            ]} onChange={value => updateCondition(index, { operator: value })}/></Field>
          <Field label="比较值"><BufferedInput label={`规则${index + 1}比较值`} value={String(condition.value ?? "0")}
            disabled={locked} onChange={value => updateCondition(index, { value })}/></Field>
          <Field label="作用系列"><SelectField label={`规则${index + 1}作用系列`} disabled={locked}
            value={String(condition.series ?? "all")} options={[
              { value: "all", label: "全部" }, ...Array.from({ length: Math.min(3, colorCount) }, (_, i) =>
                ({ value: String(i + 1), label: `系列 ${i + 1}` })),
            ]} onChange={value => updateCondition(index, { series: value })}/></Field>
          <ColorField label="条件颜色" value={String(condition.color ?? "#ff6b6b")} disabled={locked}
            onChange={value => updateCondition(index, { color: value })}/>
        </div>)}
        <Button size="sm" disabled={locked || conditions.length >= 32} onClick={() => set("colorConditions", [...conditions,
          { field: "value", operator: "gte", value: "0", series: "all", color: "#ff6b6b" }])}>添加条件样式</Button>
      </div>}
    </section></Panel>
    {canLabel && <Panel header="图形文本" itemKey="labels"><section className="property-section">
      {(lineTabAvailable || rankingChart) && <div className="chart-label-tabs" role="tablist" aria-label="图形文本类型">
        <button type="button" role="tab" aria-selected={activeLabelTab === "main"} onClick={() => setLabelTab("main")}>
          {kind === "dualAxis" ? "柱形文本" : horizontal ? "条形文本" : lines ? "折线文本" : "柱形文本"}</button>
        {lineTabAvailable && <button type="button" role="tab" aria-selected={activeLabelTab === "line"} onClick={() => setLabelTab("line")}>
          {kind === "dualAxis" ? "折线文本" : "右轴折线文本"}</button>}
        {rankingChart && <button type="button" role="tab" aria-selected={activeLabelTab === "ranking"} onClick={() => setLabelTab("ranking")}>
          排名文本</button>}
      </div>}
      {activeLabelTab === "main" && <div role="tabpanel">
      {toggle("显示图形文本", "showLabels", labelsByDefault)}
      {flag("showLabels", labelsByDefault) && <>
        {number("文字大小", "labelSize", 12, 6, 48)}
        {regularCartesian && <Field label="文字颜色模式"><SelectField label="文字颜色模式" disabled={locked}
          value={String(chart.labelColorMode ?? "normal")} options={[{ value: "normal", label: "默认" },
            { value: "follow", label: "跟随图形" }]} onChange={value => set("labelColorMode", value)}/></Field>}
        <ColorField label="文字颜色" value={String(chart.labelColor ?? "#cde3f7")} disabled={locked} onChange={value => set("labelColor", value)}/>
        {!nameLabels && <>{number("小数位数", "decimals", 0, 0, 6)}
          {toggle("小数补零", "labelPadZeros")}
          {(regularCartesian || ["pie", "pieBasic", "pieRose"].includes(kind)) && <Field label="文本显示格式"><SelectField label="文本显示格式"
            disabled={locked} value={String(chart.labelFormat ?? "value")} options={[{ value: "value", label: "数值" },
              { value: "percent", label: "百分比" }]} onChange={value => set("labelFormat", value)}/></Field>}
          <Field label="单位"><BufferedInput label="图形文本单位" value={String(chart.unit ?? "")} disabled={locked} onChange={value => set("unit", value)}/></Field>
          {regularCartesian && !!chart.unit && <>{number("单位字体大小", "labelUnitSize", num("labelSize", 12), 6, 48)}
            <ColorField label="单位文字颜色" value={String(chart.labelUnitColor ?? chart.labelColor ?? "#cde3f7")}
              disabled={locked} onChange={value => set("labelUnitColor", value)}/></>}</>}
        {regularCartesian && <>
          {number("倾斜角度", "labelTilt", 0, -360, 360)}
          {number("文字水平偏移", "labelOffsetX", 0, -500, 500)}
          {number("文字垂直偏移", "labelOffsetY", 0, -500, 500)}
          {lines && toggle("跟随数据颜色", "labelFollowDataColor", false)}
          {bars && <><Field label="文本位置"><SelectField label="文本位置" disabled={locked}
            value={String(chart.labelPosition ?? "outside")} options={[{ value: "inside", label: "内部" },
              { value: "outside", label: "外部" }, { value: "top-align", label: "顶部" }]}
            onChange={value => set("labelPosition", value)}/></Field>
            {number("文本与图形的间距", "labelSpacing", horizontal ? 4 : 3, -200, 200)}
            {number("图形文本垂直偏移", "labelVerticalOffset", 0, -500, 500)}
            {toggle("隐藏零值", "hideZeroLabels", false)}
            {toggle(horizontal ? "显示 Y 轴名称" : "显示 X 轴名称", "labelShowCategory", false)}
          </>}
        </>}
      </>}
      </div>}
      {lineTabAvailable && activeLabelTab === "line" && <div role="tabpanel">
        {toggle("显示折线文本", "showLineLabels", flag("showLabels", labelsByDefault))}
        {lineFlag("showLineLabels", flag("showLabels", labelsByDefault)) && <>
          <Field label="折线文本显示格式"><SelectField label="折线文本显示格式" disabled={locked}
            value={String(chart.lineLabelFormat ?? chart.labelFormat ?? "value")} options={[
              { value: "value", label: "数值" }, { value: "percent", label: "百分比" },
            ]} onChange={value => set("lineLabelFormat", value)}/></Field>
          {number("折线文本小数位数", "lineLabelDecimals", num("decimals", 0), 0, 6)}
          {toggle("折线文本小数补零", "lineLabelPadZeros", flag("labelPadZeros"))}
          <Field label="折线文本位置"><SelectField label="折线文本位置" disabled={locked}
            value={String(chart.lineLabelPosition ?? "above")} options={[
              { value: "above", label: "折线上方" }, { value: "top", label: "置顶" },
            ]} onChange={value => set("lineLabelPosition", value)}/></Field>
          {number("折线文本大小", "lineLabelSize", num("labelSize", 12), 6, 48)}
          <ColorField label="折线文本颜色" value={String(chart.lineLabelColor ?? chart.labelColor ?? "#cde3f7")}
            disabled={locked} onChange={value => set("lineLabelColor", value)}/>
          <Field label="折线文字颜色模式"><SelectField label="折线文字颜色模式" disabled={locked}
            value={String(chart.lineLabelColorMode ?? chart.labelColorMode ?? "normal")} options={[
              { value: "normal", label: "默认" }, { value: "follow", label: "跟随图形" },
            ]} onChange={value => set("lineLabelColorMode", value)}/></Field>
          {toggle("折线文字跟随数据颜色", "lineLabelFollowDataColor", flag("labelFollowDataColor", false))}
          {number("折线文字水平偏移", "lineLabelOffsetX", num("labelOffsetX", 0), -500, 500)}
          {number("折线文字垂直偏移", "lineLabelOffsetY", num("labelOffsetY", 0), -500, 500)}
          {number("折线文字倾斜角度", "lineLabelTilt", num("labelTilt", 0), -360, 360)}
          <Field label="折线文本单位"><BufferedInput label="折线文本单位" disabled={locked}
            value={String(chart.lineLabelUnit ?? chart.unit ?? "")} onChange={value => set("lineLabelUnit", value)}/></Field>
          {!!(chart.lineLabelUnit ?? chart.unit) && <>
            {number("折线单位字体大小", "lineLabelUnitSize", num("lineLabelUnitSize", num("lineLabelSize", num("labelSize", 12))), 6, 48)}
            <ColorField label="折线单位文字颜色"
              value={String(chart.lineLabelUnitColor ?? chart.labelUnitColor ?? chart.lineLabelColor ?? chart.labelColor ?? "#cde3f7")}
              disabled={locked} onChange={value => set("lineLabelUnitColor", value)}/>
          </>}
        </>}
      </div>}
      {rankingChart && activeLabelTab === "ranking" && <div role="tabpanel">
        {toggle("排名文本", "showRanking", false)}
        {flag("showRanking", false) && <>
          <Field label="排名字体"><SelectField label="排名字体" disabled={locked}
            value={String(chart.rankingFontFamily ?? "sans-serif")}
            options={[{ value: "sans-serif", label: "sans-serif" }, ...widgetFontFamilies]}
            onChange={value => set("rankingFontFamily", value)}/></Field>
          {number("排名字体大小", "rankingFontSize", 12, 6, 96)}
          {alphaColor("排名字体颜色", "rankingColor", "#ffffff")}
          {toggle("排名文字加粗", "rankingBold", false)}
          {toggle("排名文字倾斜", "rankingItalic", false)}
          {toggle("排名文字下划线", "rankingUnderline", false)}
          {toggle("排名文字删除线", "rankingStrike", false)}
          {number("距图形距离", "rankingDistance", 0, -500, 500)}
          <Field label="文本模板"><BufferedInput label="排名文本模板" value={String(chart.rankingTemplate ?? "NO.{}")} disabled={locked} onChange={value => set("rankingTemplate", value)}/></Field>
          <Field label="显示文本"><SelectField label="排名显示文本" disabled={locked}
            value={String(chart.rankingDisplay ?? "all")} options={[
              { value: "all", label: "全部" }, { value: "max", label: "最大值" }, { value: "min", label: "最小值" },
              { value: "max-and-min", label: "最大值和最小值" }, { value: "custom", label: "自定义" },
            ]} onChange={value => set("rankingDisplay", value)}/></Field>
          {chart.rankingDisplay === "custom" && number("显示数量", "rankingCount", 3, 0, 30)}
          <Field label="文字背景"><SelectField label="排名文字背景" disabled={locked}
            value={String(chart.rankingBackground ?? "shape")} options={[
              { value: "shape", label: "图案" }, { value: "image", label: "图片" },
            ]} onChange={value => set("rankingBackground", value)}/></Field>
          {chart.rankingBackground === "image" ? imageField("文字背景图片", "rankingBackgroundImage", rankImageRef)
            : <Field label="背景图案类型"><SelectField label="排名背景图案类型" disabled={locked}
            value={String(chart.rankingBackgroundShape ?? "rect")} options={[
              { value: "rect", label: "矩形" }, { value: "down-arrow-rect", label: "带箭头矩形" },
            ]} onChange={value => set("rankingBackgroundShape", value)}/></Field>}
          {alphaColor("文字背景颜色", "rankingBackgroundColor", "#ffffff00")}
          {number("文字背景宽度", "rankingBackgroundWidth", 50, 0, 1000)}
          {number("文字背景高度", "rankingBackgroundHeight", 30, 0, 1000)}
          <Field label="文本格式"><SelectField label="排名文本格式" disabled={locked}
            value={String(chart.rankingFormat ?? "text-template")} options={[
              { value: "text-template", label: "文本模板" }, { value: "value-template", label: "数值文本模板" },
            ]} onChange={value => set("rankingFormat", value)}/></Field>
          {kind === "bar" && number("文本偏移", "rankingOffset", 0, -500, 500)}
        </>}
      </div>}
    </section></Panel>}
    <Panel header="图形形状" itemKey="shape"><section className="property-section">
      {bars && <>{number("柱形宽度 (0 为自适应)", "barWidth", 0, 0, 200)}
        {kind !== "barGradient" && chart.gradient !== true && !["bubbleBars", "boxplot", "bullet", "pictorial"].includes(String(chart.variant))
          && number("图形圆角半径", "barRadius", 1, 0, 30)}</>}
      {lines && <>{regularCartesian && kind !== "dualAxis" && chart.variant !== "rangeArea" && <>
        <Field label="显示样式"><SelectField label="折线显示样式" disabled={locked}
          value={String(chart.categoryVisibilityMode ?? "all")} options={[
            { value: "all", label: "显示全部" }, { value: "custom", label: "自定义" },
          ]} onChange={value => set("categoryVisibilityMode", value)}/></Field>
        {chart.categoryVisibilityMode === "custom" && number("图形数量", "visibleCategoryCount", 10, 0, 30)}
      </>}
        {number("线宽", "lineWidth", 2.5, 0, 20, 0.5)}
        {regularCartesian && <>{alphaColor("折线阴影颜色", "lineShadowColor", "#00000000")}
          {number("折线阴影模糊程度", "lineShadowBlur", 0, 0, 100)}
          {offsetField("折线阴影偏移", chart.lineShadowOffset, value => set("lineShadowOffset", value))}</>}
        {regularCartesian && kind !== "dualAxis" && toggle("两侧留白", "boundaryGap")}
        {regularCartesian && kind !== "dualAxis" && chart.variant !== "rangeArea" && <>
          {toggle("去除零值", "zeroRemoval", false)}
          {flag("zeroRemoval", false) && <Field label="去除零值模式"><SelectField label="去除零值模式"
            disabled={locked} value={String(chart.zeroRemovalMode ?? "skip")} options={[
              { value: "skip", label: "跳过" }, { value: "segment", label: "分段" },
            ]} onChange={value => set("zeroRemovalMode", value)}/></Field>}
        </>}
        {chart.variant !== "pathAnimation" && <Field label="折线形状"><SelectField label="折线形状" disabled={locked} value={String(chart.lineStyle ?? "solid")}
          options={[{ value: "solid", label: "折线" }, { value: "dashed", label: "虚线" }]}
          onChange={value => set("lineStyle", value)}/></Field>}
        {toggle("平滑曲线", "smooth", kind === "lineSmooth")}
        {toggle("显示数据点", "showPoints")}
        {flag("showPoints") && <>{number("数据点半径", "pointRadius", 3, 0, 50)}
          {chart.variant !== "pathAnimation" && <Field label="点形状"><SelectField label="点形状" disabled={locked}
            value={String(chart.pointShape ?? "circle")} options={pointShapeOptions}
            onChange={value => set("pointShape", value)}/></Field>}
          {chart.pointShape === "image" && imageField("数据点图片", "pointImage", pointImageRef)}
          {regularCartesian && <>{alphaColor("数据点阴影颜色", "pointShadowColor", "#00000000")}
            {number("数据点阴影模糊程度", "pointShadowBlur", 0, 0, 100)}
            {offsetField("数据点阴影偏移", chart.pointShadowOffset, value => set("pointShadowOffset", value))}</>}</>}
        {regularCartesian && kind !== "dualAxis" && chart.variant !== "rangeArea" && <>
          {toggle("每条折线独立设置", "seriesStyleEnabled", false)}
          {flag("seriesStyleEnabled", false) && Array.from({ length: Math.min(3, colorCount) }, (_, index) => {
            const style = seriesStyle(index);
            const value = (key: string, fallback: unknown) => style[key] ?? chart[key] ?? fallback;
            const numeric = (label: string, key: string, fallback: number, min: number, max: number) =>
              <NumberField label={label} value={Number(value(key, fallback))} min={min} max={max} disabled={locked}
                onChange={next => setSeries(index, key, next)}/>;
            return <details className="chart-reference-line" key={index} open={index === 0}><summary>{`系列 ${index + 1}`}</summary>
              <Field label="折线形状"><SelectField label={`系列 ${index + 1} 折线形状`} disabled={locked}
                value={String(value("lineStyle", "solid"))} options={[{ value: "solid", label: "折线" }, { value: "dashed", label: "虚线" }]}
                onChange={next => setSeries(index, "lineStyle", next)}/></Field>
              <Field label="平滑线"><Switch size="sm" aria-label={`系列 ${index + 1} 平滑线`} disabled={locked}
                checked={!!value("smooth", kind === "lineSmooth")} onCheckedChange={next => setSeries(index, "smooth", next)}/></Field>
              {numeric("折线粗细", "lineWidth", 2.5, 0, 20)}
              {seriesAlphaColor("折线阴影颜色", index, "lineShadowColor")}
              {numeric("折线阴影模糊程度", "lineShadowBlur", 0, 0, 100)}
              {offsetField("折线阴影偏移", value("lineShadowOffset", [0, 0]), next => setSeries(index, "lineShadowOffset", next))}
              <Field label="显示数据点"><Switch size="sm" aria-label={`系列 ${index + 1} 显示数据点`} disabled={locked}
                checked={!!value("showPoints", true)} onCheckedChange={next => setSeries(index, "showPoints", next)}/></Field>
              {!!value("showPoints", true) && <>
                <Field label="点形状"><SelectField label={`系列 ${index + 1} 点形状`} disabled={locked}
                  value={String(value("pointShape", "circle"))} options={pointShapeOptions}
                  onChange={next => setSeries(index, "pointShape", next)}/></Field>
                {numeric("数据点半径", "pointRadius", 3, 0, 50)}
                {value("pointShape", "circle") === "image" && <>
                  <Field label="数据点图片"><BufferedInput label={`系列 ${index + 1} 数据点图片地址`}
                    value={String(value("pointImage", ""))} disabled={locked} onChange={next => setSeries(index, "pointImage", next)}/></Field>
                  <Button size="sm" disabled={locked} onClick={() => seriesImageRefs.current[index]?.click()}>选择本地图片</Button>
                  <input hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label={`选择系列 ${index + 1} 数据点图片`}
                    ref={element => { seriesImageRefs.current[index] = element; }} onChange={event => {
                      const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
                      if (file.size > 1_500_000) { Toast.error("请选择小于 1.5 MB 的图片"); return; }
                      const reader = new FileReader(); reader.onload = () => setSeries(index, "pointImage", String(reader.result)); reader.readAsDataURL(file);
                    }}/>
                </>}
                {seriesAlphaColor("数据点阴影颜色", index, "pointShadowColor")}
                {numeric("数据点阴影模糊程度", "pointShadowBlur", 0, 0, 100)}
                {offsetField("数据点阴影偏移", value("pointShadowOffset", [0, 0]), next => setSeries(index, "pointShadowOffset", next))}
              </>}
            </details>;
          })}
          {toggle("每条流光独立设置", "flowEnabled", false)}
          {flag("flowEnabled", false) && Array.from({ length: Math.min(3, colorCount) }, (_, index) => {
            const flow = flowStyle(index);
            const numeric = (label: string, key: string, fallback: number, min: number, max: number, step = 1) =>
              <NumberField label={label} value={typeof flow[key] === "number" ? flow[key] as number : fallback}
                min={min} max={max} step={step} disabled={locked} onChange={next => setFlow(index, key, next)}/>;
            return <details className="chart-reference-line" key={`flow-${index}`} open={index === 0}><summary>{`系列 ${index + 1} 流光`}</summary>
              <Field label="流光"><Switch size="sm" aria-label={`系列 ${index + 1} 流光`} disabled={locked}
                checked={flow.enabled === true} onCheckedChange={next => setFlow(index, "enabled", next)}/></Field>
              {flow.enabled === true && <>
                <Field label="流光点形状"><SelectField label={`系列 ${index + 1} 流光点形状`} disabled={locked}
                  value={String(flow.shape ?? "circle")} options={pointShapeOptions.filter(option =>
                    ["circle", "circleEmpty", "squareEmpty", "roundSquare", "triangle", "diamond"].includes(option.value))}
                  onChange={next => setFlow(index, "shape", next)}/></Field>
                {flowColor(index)}
                {numeric("流光点大小", "size", 8, 0, 100)}
                {numeric("流光尾部长度 (%)", "trailLength", 10, 0, 100)}
                {numeric("流动所需时间 (秒)", "duration", 10, 0.1, 3600, 0.1)}
              </>}
            </details>;
          })}
        </>}
        {kind.startsWith("area") && number("面积透明度 (%)", "fillOpacity", kind === "areaGradient" ? 22 : 35, 0, 100)}</>}
      {kind === "scatter" && number("散点半径", "pointRadius", 4, 1, 30)}
      {kind === "bubble" && number("气泡大小系数", "bubbleScale", 1, 0.1, 4, 0.1)}
      {chart.variant === "lineBubble" && number("连线宽度", "lineWidth", 2.5, 0.5, 20, 0.5)}
      {pie2d && <>{number("开始角度 (°)", "startAngle", -90, -360, 360)}
        {number("结束角度 (°)", "endAngle", 270, -360, 720)}
        {number(chart.variant === "jade" ? "圆环间隔 (px)" : "扇区间隔 (°)", "segmentGap", 0, 0, 20)}
        {ring && number("圆环内径 (%)", "innerRadius", 65, 0, 95)}</>}
      {["pie", "pieBasic", "pieRose"].includes(kind) && <>
        {number("图形大小占比 (%)", "pieSize", 100, 10, 100)}
        {number("外部边框宽度", "pieBorderWidth", 0, 0, 20)}
        {num("pieBorderWidth", 0) > 0 && <ColorField label="外部边框颜色" value={String(chart.pieBorderColor ?? "#ffffff")}
          disabled={locked} onChange={value => set("pieBorderColor", value)}/>}
      </>}
      {gauge && <>{number("最小值", "gaugeMin", 0, -1000000, 1000000)}
        {number("最大值", "gaugeMax", 100, -1000000, 1000000)}
        {number("仪表盘宽度 (%)", "gaugeWidth", 22, 2, 90)}
        {number("开始角度 (°)", "startAngle", 135, -360, 360)}
        {number("结束角度 (°)", "endAngle", 405, -360, 720)}</>}
      {radar && number("网格层数", "radarLevels", 4, 1, 12)}
      {chart.variant === "pizza" && number("数据点半径", "pointRadius", 4, 1, 20)}
      {chart.variant === "pictorial" && number("图形数量", "symbolCount", 10, 2, 30)}
      {animated && <>{toggle("播放动画", "playAnimation")}{number("动画周期 (秒)", "duration", 3, 0.2, 60, 0.1)}
        {chart.variant === "dynamicBar" && number("显示条目数", "maxItems", 5, 1, 20)}</>}
      {sankey && <>{number("节点宽度", "nodeWidth", 10, 3, 40)}{number("节点间距", "nodeGap", 8, 0, 30)}
        {number("连线透明度 (%)", "linkOpacity", 35, 0, 100)}</>}
      {heat && <>{number("每行色块数量", "heatColumns", 7, 1, 53)}{number("色块间距", "cellGap", 2, 0, 20)}</>}
      {kind === "funnel" && number("图形间距", "funnelGap", 3, 0, 30)}
      {kind === "waterball" && number("边框宽度", "waterBorder", 2, 0, 20)}
      {!bars && !lines && !pie2d && !gauge && !radar && !heat && !sankey && !["scatter", "bubble", "funnel", "waterball"].includes(kind)
        && <p className="properties-note">此图形使用固定几何形状，可调整颜色和图例。</p>}
    </section></Panel>
    {regularCartesian && <Panel header="辅助线" itemKey="reference"><section className="property-section">
      {referenceLines.map((line, index) => <div className="chart-reference-line" key={index}>
        <Field label={`辅助线 ${index + 1}`}><Button size="sm" disabled={locked}
          onClick={() => set("referenceLines", referenceLines.filter((_, i) => i !== index))}>删除</Button></Field>
        <Field label="名称"><BufferedInput label={`辅助线${index + 1}名称`} value={String(line.name ?? "")}
          disabled={locked} onChange={value => updateReference(index, { name: value })}/></Field>
        <NumberField label="数值" value={typeof line.value === "number" ? line.value : 0}
          disabled={locked} onChange={value => updateReference(index, { value })}/>
        <ColorField label="线条颜色" value={String(line.color ?? "#ffb84d")} disabled={locked}
          onChange={value => updateReference(index, { color: value })}/>
        <NumberField label="线条宽度" value={typeof line.width === "number" ? line.width : 1}
          min={1} max={10} disabled={locked} onChange={value => updateReference(index, { width: value })}/>
        <Field label="线条类型"><SelectField label={`辅助线${index + 1}线条类型`} disabled={locked}
          value={String(line.style ?? "solid")} options={[{ value: "solid", label: "实线" }, { value: "dashed", label: "虚线" }]}
          onChange={value => updateReference(index, { style: value })}/></Field>
        {line.style === "dashed" && <NumberField label="虚线宽度" value={typeof line.dash === "number" ? line.dash : 6}
          min={1} max={100} disabled={locked} onChange={value => updateReference(index, { dash: value })}/>}
        <ColorField label="文本颜色" value={String(line.textColor ?? line.color ?? "#ffb84d")} disabled={locked}
          onChange={value => updateReference(index, { textColor: value })}/>
        {([0, 1] as const).map(axis => <NumberField key={axis} label={`文本偏移 ${axis === 0 ? "X" : "Y"}`}
          value={Array.isArray(line.textOffset) && typeof line.textOffset[axis] === "number" ? line.textOffset[axis] : 0}
          min={-1000} max={1000} disabled={locked} onChange={value => {
            const offset = Array.isArray(line.textOffset) ? [...line.textOffset] : [0, 0];
            offset[axis] = value; updateReference(index, { textOffset: offset });
          }}/>) }
      </div>)}
      <Button size="sm" disabled={locked || referenceLines.length >= 32} onClick={() => set("referenceLines", [...referenceLines,
        { name: "", value: 0, color: "#ffb84d", width: 1, style: "solid" }])}>添加辅助线</Button>
    </section></Panel>}
    {regularCartesian && <Panel header="缩略轴" itemKey="dataZoom"><section className="property-section">
      {toggle("启用缩略轴", "showDataZoom", false)}
      {flag("showDataZoom", false) && <>
        {number("缩略轴高度", "zoomHeight", 16, 4, 60)}
        {number("距底部位置", "zoomBottom", 10, 0, 100)}
        <NumberField label="数据起点 (%)" value={num("zoomStart", 0)} min={0} max={99} disabled={locked}
          onChange={value => set("zoomStart", Math.min(value, num("zoomEnd", 100) - 1))}/>
        <NumberField label="数据终点 (%)" value={num("zoomEnd", 100)} min={1} max={100} disabled={locked}
          onChange={value => set("zoomEnd", Math.max(value, num("zoomStart", 0) + 1))}/>
        <ColorField label="缩略轴前景颜色" value={String(chart.zoomForeground ?? "#5b8ff926")} disabled={locked}
          onChange={value => set("zoomForeground", value)}/>
        <ColorField label="缩略轴背景颜色" value={String(chart.zoomBackground ?? "#4161800d")} disabled={locked}
          onChange={value => set("zoomBackground", value)}/>
        <ColorField label="边框颜色" value={String(chart.zoomBorderColor ?? "#cccccc")} disabled={locked}
          onChange={value => set("zoomBorderColor", value)}/>
        {number("顶部滑块高度", "zoomSliderHeight", 5, 0, 30)}
        <ColorField label="顶部滑块颜色" value={String(chart.zoomSliderColor ?? "#5b8ff926")} disabled={locked}
          onChange={value => set("zoomSliderColor", value)}/>
        {number("两侧滑块大小", "zoomHandleSize", 28, 2, 40)}
        <ColorField label="两侧滑块颜色" value={String(chart.zoomHandleColor ?? "#f7f7f7")} disabled={locked}
          onChange={value => set("zoomHandleColor", value)}/>
        {number("数据线条宽度", "zoomDataLineWidth", 1, 0, 10)}
        <ColorField label="数据线条颜色" value={String(chart.zoomDataLineColor ?? "#1890ff")} disabled={locked}
          onChange={value => set("zoomDataLineColor", value)}/>
        <ColorField label="数据面积颜色" value={String(chart.zoomDataAreaColor ?? "#1890ff55")} disabled={locked}
          onChange={value => set("zoomDataAreaColor", value)}/>
        <ColorField label="选中线条颜色" value={String(chart.zoomSelectedLineColor ?? "#1c6cb8")} disabled={locked}
          onChange={value => set("zoomSelectedLineColor", value)}/>
        <ColorField label="选中面积颜色" value={String(chart.zoomSelectedAreaColor ?? "#1c6cb855")} disabled={locked}
          onChange={value => set("zoomSelectedAreaColor", value)}/>
      </>}
    </section></Panel>}
    {cartesian && <Panel header="轴" itemKey="axes"><section className="property-section">
      {regularCartesian ? <>
        <div className="chart-label-tabs" role="tablist" aria-label="坐标轴类型">
          {(["X", "Y"] as const).map(axis => <button type="button" role="tab" key={axis}
            aria-selected={axisTab === axis} onClick={() => setAxisTab(axis)}>{axis}轴</button>)}
          {hasRightAxis && <button type="button" role="tab" aria-selected={axisTab === "right"}
            onClick={() => setAxisTab("right")}>右侧Y轴</button>}
        </div>
        {axisTab !== "right" && <div role="tabpanel">
        {axisTab === "X" ? toggle("启用 X 轴", "showXAxis") : toggle("启用 Y 轴", "showYAxis")}
        {(["X", "Y"] as const).filter(axis => axisTab === axis).map(axis => flag(`show${axis}Axis`) &&
        <Panels key={axis} className="chart-axis-subsections">
          <Panel header="轴线" itemKey={`${axis}-line`}><section className="property-section">
          {toggle(`${axis} 轴线`, `showAxisLine${axis}`, false)}
          {flag(`showAxisLine${axis}`, false) && <>
            <Field label={`${axis} 轴线类型`}><SelectField label={`${axis} 轴线类型`} disabled={locked}
              value={String(chart[`axisLineStyle${axis}`] ?? "solid")} options={[{ value: "solid", label: "实线" },
                { value: "dashed", label: "虚线" }, { value: "dottedLine", label: "点线" }]}
              onChange={value => set(`axisLineStyle${axis}`, value)}/></Field>
            {chart[`axisLineStyle${axis}`] === "dottedLine" && ["线段长度", "线段间隔"].map((label, index) => {
              const current = chart[`axisLineDash${axis}`];
              const pattern = Array.isArray(current) ? current : [2, 5];
              return <NumberField key={label} label={`${axis} 轴${label}`} value={Number(pattern[index] ?? [2, 5][index])}
                min={0.5} max={100} step={0.5} disabled={locked} onChange={value => set(`axisLineDash${axis}`,
                  [index === 0 ? value : Number(pattern[0] ?? 2), index === 1 ? value : Number(pattern[1] ?? 5)])}/>;
            })}
            <ColorField label={`${axis} 轴线颜色`} value={String(chart[`axisLineColor${axis}`] ?? "#cccccc")}
              disabled={locked} onChange={value => set(`axisLineColor${axis}`, value)}/>
            {number(`${axis} 轴线宽度`, `axisLineWidth${axis}`, 1, 0, 20)}
          </>}
          </section></Panel>
          <Panel header="刻度线" itemKey={`${axis}-ticks`}><section className="property-section">
          {toggle(`${axis} 轴刻度线`, `showAxisTicks${axis}`, false)}
          {flag(`showAxisTicks${axis}`, false) && <>
            <ColorField label={`${axis} 轴刻度线颜色`} value={String(chart[`axisTickColor${axis}`] ?? "#cccccc")}
              disabled={locked} onChange={value => set(`axisTickColor${axis}`, value)}/>
            {number(`${axis} 轴刻度线宽度`, `axisTickWidth${axis}`, 2, 0, 20)}
            {number(`${axis} 轴刻度线长度`, `axisTickLength${axis}`, 5, 0, 50)}
          </>}
          </section></Panel>
          <Panel header="刻度值" itemKey={`${axis}-labels`}><section className="property-section">
          {toggle(`${axis} 轴刻度值`, `showAxisLabel${axis}`)}
          {flag(`showAxisLabel${axis}`) && <>
          {(axis === "X") === horizontal && flag(`showAxisLabel${axis}`) && <>
            <Field label={`${axis} 轴显示格式`}><SelectField label={`${axis} 轴显示格式`} disabled={locked}
              value={String(chart[`axisValueFormat${axis}`] ?? "normal")} options={[
                { value: "normal", label: "数值" }, { value: "percent", label: "百分比" },
              ]} onChange={value => set(`axisValueFormat${axis}`, value)}/></Field>
            <Field label={`${axis} 轴计数单位`}><SelectField label={`${axis} 轴计数单位`} disabled={locked}
              value={String(chart[`axisValueScale${axis}`] ?? "0")} options={[
                { value: "0", label: "不设置" }, { value: "3", label: "K" }, { value: "4", label: "万" },
                { value: "5", label: "十万" }, { value: "6", label: "百万" }, { value: "7", label: "千万" },
                { value: "8", label: "亿" },
              ]} onChange={value => set(`axisValueScale${axis}`, value)}/></Field>
            {number(`${axis} 轴小数位数`, `axisDecimals${axis}`, 0, 0, 6)}
            {toggle(`${axis} 轴小数补零`, `axisPadZeros${axis}`, false)}
            {signedAxis === axis && valueRange()}
          </>}
          {number(`${axis} 轴刻度字体大小`, axis === "X" ? "xAxisFontSize" : "yAxisFontSize", num("axisFontSize", 10), 6, 36)}
          <ColorField label={`${axis} 轴刻度文字颜色`}
            value={String(chart[axis === "X" ? "xAxisColor" : "yAxisColor"] ?? chart.axisColor ?? "#90acc1")}
            disabled={locked} onChange={value => set(axis === "X" ? "xAxisColor" : "yAxisColor", value)}/>
          {axisFontFields(axis)}
          {number(`${axis} 轴刻度距轴线`, axis === "X" ? "xLabelOffset" : "yLabelOffset",
            axis === "X" ? (horizontal ? 5 : 13) : (horizontal ? 5 : 7), 0, 100)}
          {rotation(`${axis} 轴刻度值旋转`, `axisLabelRotate${axis}`)}
          </>}
          </section></Panel>
          <Panel header="轴名称" itemKey={`${axis}-name`}><section className="property-section">
          {toggle(`显示 ${axis} 轴名称`, `showAxisName${axis}`, false)}
          {flag(`showAxisName${axis}`, false) && <>
            <Field label={`${axis} 轴名称`}><BufferedInput label={`${axis} 轴名称`} disabled={locked}
              value={String(chart[`axisName${axis}`] ?? "")} onChange={value => set(`axisName${axis}`, value)}/></Field>
            {number(`${axis} 轴名称字体大小`, `axisNameFontSize${axis}`, 12, 6, 48)}
            <ColorField label={`${axis} 轴名称颜色`} value={String(chart[`axisNameColor${axis}`] ?? "#90acc1")}
              disabled={locked} onChange={value => set(`axisNameColor${axis}`, value)}/>
            {number(`${axis} 轴名称偏移`, `axisNameGap${axis}`, axis === "X" ? 0 : 15, -100, 200)}
          </>}
          </section></Panel>
          <Panel header="网格线" itemKey={`${axis}-grid`}><section className="property-section">
          {toggle(`${axis} 轴网格线`, `showGrid${axis}`, axis === "X" ? gridXDefault : gridYDefault)}
          {flag(`showGrid${axis}`, axis === "X" ? gridXDefault : gridYDefault) && <>
            <Field label={`${axis} 轴网格线类型`}><SelectField label={`${axis} 轴网格线类型`} disabled={locked}
              value={String(chart[`gridStyle${axis}`] ?? "solid")} options={[{ value: "solid", label: "实线" },
                { value: "dotted", label: "虚线" }]} onChange={value => set(`gridStyle${axis}`, value)}/></Field>
            {chart[`gridStyle${axis}`] === "dotted" && number(`${axis} 轴网格虚线长度`, `gridDash${axis}`, 4, 0.5, 100, 0.5)}
            <ColorField label={`${axis} 轴网格线颜色`} value={String(chart[`gridColor${axis}`] ?? "#a4c4e31e")}
              disabled={locked} onChange={value => set(`gridColor${axis}`, value)}/>
            {number(`${axis} 轴网格线宽度`, `gridWidth${axis}`, 1, 0, 20)}
          </>}
          </section></Panel>
        </Panels>)}
        </div>}
        {hasRightAxis && axisTab === "right" && <div role="tabpanel">
          {rightAxisChart && number("右轴首个系列 (0 为关闭)", "rightAxisStart", 0, 0, Math.max(1, colorCount))}
          {(kind === "dualAxis" || num("rightAxisStart", 0) > 0) && <>
            {toggle("显示右侧 Y 轴", "showRightAxis", kind !== "dualAxis")}
            {flag("showRightAxis", kind !== "dualAxis") && <Panels className="chart-axis-subsections">
              <Panel header="轴线" itemKey="right-line"><section className="property-section">
              {toggle("右轴轴线", "showRightAxisLine")}
              {flag("showRightAxisLine") && <><Field label="右轴轴线类型"><SelectField label="右轴轴线类型"
                disabled={locked} value={String(chart.rightAxisLineStyle ?? "solid")} options={[
                  { value: "solid", label: "实线" }, { value: "dashed", label: "虚线" },
                ]} onChange={value => set("rightAxisLineStyle", value)}/></Field>
                {number("右轴轴线宽度", "rightAxisLineWidth", 1, 0, 20)}
                <ColorField label="右轴轴线颜色" value={String(chart.rightAxisLineColor ?? "#cccccc")}
                  disabled={locked} onChange={value => set("rightAxisLineColor", value)}/></>}
              </section></Panel>
              <Panel header="刻度线" itemKey="right-ticks"><section className="property-section">
              {toggle("右轴刻度线", "showRightAxisTicks")}
              {flag("showRightAxisTicks") && <>{number("右轴刻度线长度", "rightAxisTickLength", 5, 0, 50)}
                {number("右轴刻度线宽度", "rightAxisTickWidth", 2, 0, 20)}
                <ColorField label="右轴刻度线颜色" value={String(chart.rightAxisTickColor ?? "#cccccc")}
                  disabled={locked} onChange={value => set("rightAxisTickColor", value)}/></>}
              </section></Panel>
              <Panel header="刻度值" itemKey="right-labels"><section className="property-section">
              {toggle("右轴刻度值", "showRightAxisLabel")}
              {flag("showRightAxisLabel") && <>
                <Field label="右轴显示格式"><SelectField label="右轴显示格式" disabled={locked}
                  value={String(chart.rightAxisValueFormat ?? "normal")} options={[
                    { value: "normal", label: "数值" }, { value: "percent", label: "百分比" },
                  ]} onChange={value => set("rightAxisValueFormat", value)}/></Field>
                <Field label="右轴计数单位"><SelectField label="右轴计数单位" disabled={locked}
                  value={String(chart.rightAxisValueScale ?? "0")} options={[
                    { value: "0", label: "不设置" }, { value: "3", label: "K" }, { value: "4", label: "万" },
                    { value: "5", label: "十万" }, { value: "6", label: "百万" }, { value: "7", label: "千万" },
                    { value: "8", label: "亿" },
                  ]} onChange={value => set("rightAxisValueScale", value)}/></Field>
                {number("右轴小数位数", "rightAxisDecimals", 0, 0, 6)}
                {toggle("右轴小数补零", "rightAxisPadZeros", false)}
                {rightAxisChart && valueRange(true)}
                {number("右轴文字大小", "rightAxisFontSize", 10, 6, 36)}
                <ColorField label="右轴文字颜色" value={String(chart.rightAxisColor ?? "#90acc1")}
                  disabled={locked} onChange={value => set("rightAxisColor", value)}/>
                {axisFontFields("Right")}
                {number("右轴刻度距轴线", "rightLabelOffset", 10, 0, 100)}
                {rotation("右轴刻度值旋转", "rightAxisRotate", true)}
              </>}
              </section></Panel>
              <Panel header="轴名称" itemKey="right-name"><section className="property-section">
              {toggle("显示右轴名称", "showRightAxisName", false)}
              {flag("showRightAxisName", false) && <>
                <Field label="右轴名称"><BufferedInput label="右轴名称" disabled={locked}
                  value={String(chart.rightAxisName ?? "")} onChange={value => set("rightAxisName", value)}/></Field>
                {number("右轴名称字体大小", "rightAxisNameFontSize", 12, 6, 48)}
                <ColorField label="右轴名称颜色" value={String(chart.rightAxisNameColor ?? "#90acc1")}
                  disabled={locked} onChange={value => set("rightAxisNameColor", value)}/>
                {number("右轴名称距轴线", "rightAxisNameGap", 15, -100, 200)}
                {number("右轴名称文本偏移", "rightAxisNameOffset", 0, -100, 200)}
              </>}
              </section></Panel>
              <Panel header="网格线" itemKey="right-grid"><section className="property-section">
              {toggle("右轴网格线", "showRightGrid", false)}
              {flag("showRightGrid", false) && <>
                <Field label="右轴网格线类型"><SelectField label="右轴网格线类型" disabled={locked}
                  value={String(chart.rightGridStyle ?? "solid")} options={[
                    { value: "solid", label: "直线" }, { value: "dotted", label: "虚线" },
                  ]} onChange={value => set("rightGridStyle", value)}/></Field>
                {chart.rightGridStyle === "dotted" && number("右轴网格虚线宽度", "rightGridDash", 4, 0.5, 100, 0.5)}
                <ColorField label="右轴网格线颜色" value={String(chart.rightGridColor ?? "#a4c4e31e")}
                  disabled={locked} onChange={value => set("rightGridColor", value)}/>
                {number("右轴网格线宽度", "rightGridWidth", 1, 0, 20)}
              </>}
              </section></Panel>
            </Panels>}
          </>}
        </div>}
      </> : <>{toggle("显示 X 轴", "showXAxis")}{toggle("显示 Y 轴", "showYAxis")}
        {toggle("显示网格线", "showGrid")}{number("坐标轴文字大小", "axisFontSize", 10, 6, 36)}
        <ColorField label="坐标轴文字颜色" value={String(chart.axisColor ?? "#90acc1")} disabled={locked} onChange={value => set("axisColor", value)}/></>}
    </section></Panel>}
    {regularCartesian && <Panel header="内边距" itemKey="padding"><section className="property-section">
      {(["左", "上", "右", "下"] as const).map((side, index) => {
        const reserveRight = hasRightAxis && (kind === "dualAxis" || num("rightAxisStart", 0) > 0)
          && flag("showRightAxis", kind !== "dualAxis");
        const defaults = [34, 18, reserveRight ? 50 : 10, 27];
        const padding = Array.isArray(chart.kitPadding) ? chart.kitPadding : defaults;
        const current = typeof padding[index] === "number" ? padding[index] as number : defaults[index];
        return <NumberField key={side} label={`${side}内边距`} value={current} min={0} max={500} disabled={locked}
          onChange={value => set("kitPadding", defaults.map((fallback, i) => i === index ? value
            : typeof padding[i] === "number" ? padding[i] : fallback))}/>;
      })}
    </section></Panel>}
    {hasLegend && <Panel header="图例" itemKey="legend"><section className="property-section">
      {toggle("显示图例", "showLegend")}
      {flag("showLegend") && <><Field label="图例类型"><SelectField label="图例类型" disabled={locked}
        value={String(chart.legendType ?? "plain")} options={[{ value: "plain", label: "普通" }, { value: "scroll", label: "翻页" }]}
        onChange={value => set("legendType", value)}/></Field>
      <Field label="图例位置"><SelectField label="图例位置" disabled={locked}
        value={String(chart.legendPosition ?? "auto")} options={[
          { value: "auto", label: "默认" }, { value: "top-left", label: "顶部偏左" }, { value: "top-center", label: "顶部居中" },
          { value: "top-right", label: "顶部偏右" }, { value: "bottom-left", label: "底部偏左" },
          { value: "bottom-center", label: "底部居中" }, { value: "bottom-right", label: "底部偏右" },
          { value: "left-top", label: "左侧偏上" }, { value: "left-center", label: "左侧居中" },
          { value: "left-bottom", label: "左侧偏下" }, { value: "right-top", label: "右侧偏上" },
          { value: "right-center", label: "右侧居中" }, { value: "right-bottom", label: "右侧偏下" },
          ...(["top", "bottom"].includes(String(chart.legendPosition)) ? [{ value: String(chart.legendPosition), label: "原有位置" }] : []),
        ]} onChange={value => set("legendPosition", value)}/></Field>
        {number("图例文字大小", "legendFontSize", 10, 6, 36)}
        <ColorField label="图例文字颜色" value={String(chart.legendColor ?? "#cde3f7")} disabled={locked} onChange={value => set("legendColor", value)}/>
        {legendFontFields("legend", "图例文字")}
        <Field label="图例文本"><SelectField label="图例文本" disabled={locked} value={String(chart.legendTextMode ?? "auto")}
          options={[{ value: "auto", label: "自适应" }, { value: "custom", label: "自定义" }]}
          onChange={value => set("legendTextMode", value)}/></Field>
        {chart.legendTextMode === "custom" && number("图例文本宽度", "legendTextWidth", 30, 0, 2000)}
        {number("图例文字间距", "legendTextSpacing", 0, -10, 100)}
        {alphaColor("图例发光颜色", "legendShadowColor", "#ffffff")}
        {number("图例发光程度", "legendShadowBlur", 0, 0, 100)}
        {offsetField("图例发光偏移", chart.legendShadowOffset, value => set("legendShadowOffset", value))}
        <Field label="图例图形"><SelectField label="图例图形" disabled={locked} value={String(chart.legendMarker ?? "circle")}
          options={[{ value: "circle", label: "圆点" }, { value: "square", label: "方块" },
            { value: "roundSquare", label: "圆角方块" }, { value: "triangle", label: "三角形" },
            { value: "diamond", label: "菱形" }, { value: "line", label: "线条" }]}
          onChange={value => set("legendMarker", value)}/></Field>
        {number("图例图形大小", "legendMarkerSize", 6, 2, 40)}
        {number("图例项间隔", "legendGap", 10, 0, 100)}
        {number("最长文字数量", "legendMaxChars", 100, 1, 1000)}
        {chart.legendType === "scroll" && <>
          {number("翻页按钮文字大小", "legendPageTextSize", 12, 6, 48)}
          <ColorField label="翻页按钮文字颜色" value={String(chart.legendPageTextColor ?? "#ffffff")} disabled={locked} onChange={value => set("legendPageTextColor", value)}/>
          {legendFontFields("legendPage", "翻页按钮文字")}
          {number("翻页按钮大小", "legendPageIconSize", 12, 4, 60)}
          {number("按钮和文字间隔", "legendPageItemGap", 12, 0, 100)}
          {number("图例和按钮间隔", "legendPageGap", 12, 0, 100)}
          <ColorField label="翻页颜色" value={String(chart.legendPageIconColor ?? "#ffffff")} disabled={locked} onChange={value => set("legendPageIconColor", value)}/>
          <ColorField label="禁止翻页颜色" value={String(chart.legendPageInactiveColor ?? "#3c3c3c")} disabled={locked} onChange={value => set("legendPageInactiveColor", value)}/>
          {imageField("右侧背景图片", "legendPageRightImage", legendRightImageRef)}
          {imageField("左侧背景图片", "legendPageLeftImage", legendLeftImageRef)}
        </>}
        {toggle("点击图例切换显示", "legendInteractive")}</>}
    </section></Panel>}
    <Panel header="提示信息" itemKey="tooltip"><section className="property-section">
      {toggle("显示悬浮提示", "showTooltip")}
      {flag("showTooltip") && <>
        <div className="chart-label-tabs chart-tooltip-tabs" role="tablist" aria-label="提示信息设置">
          {([ ["basic", "基本样式"], ["format", "数据格式"], ["text", "文字样式"],
            ["unit", "单位名称"], ...(hasTooltipPointer ? [["pointer", "辅助线设置"] as const] : []) ] as const).map(([key, label]) =>
            <button type="button" role="tab" key={key} aria-selected={activeTooltipTab === key} onClick={() => setTooltipTab(key)}>{label}</button>)}
        </div>
        {activeTooltipTab === "basic" && <div role="tabpanel">
          {alphaColor("提示信息背景颜色", "tooltipBackground", "#10243cf2")}
          {imageField("提示信息背景图片", "tooltipBackgroundImage", tooltipImageRef)}
          {number("提示信息左右内边距", "tooltipPaddingX", 10, 0, 100)}
          {number("提示信息上下内边距", "tooltipPaddingY", 7, 0, 100)}
          {number("提示信息圆角", "tooltipRadius", 4, 0, 50)}
          {toggle("显示图标", "tooltipShowIcon", false)}
          <Field label="提示框位置"><SelectField label="提示框位置" disabled={locked} value={String(chart.tooltipPosition ?? "auto")}
            options={[{ value: "auto", label: "自动" }, { value: "center", label: "居中" }]}
            onChange={value => set("tooltipPosition", value)}/></Field>
        </div>}
        {activeTooltipTab === "format" && <div role="tabpanel">
          <Field label="Y 轴数值格式"><SelectField label="Y 轴数值格式" disabled={locked} value={String(chart.tooltipFormat ?? "normal")}
            options={[{ value: "normal", label: "数值" }, { value: "percent", label: "百分比" }]}
            onChange={value => set("tooltipFormat", value)}/></Field>
          {toggle("Y 轴千分位分隔", "tooltipComma", false)}
          {number("Y 轴小数位数", "tooltipDecimals", num("decimals", 0), 0, 6)}
          {toggle("Y 轴小数补零", "tooltipPadZeros", flag("labelPadZeros"))}
          {hasRightAxis && <>
            <Field label="右侧 Y 轴数值格式"><SelectField label="右侧 Y 轴数值格式" disabled={locked} value={String(chart.tooltipRightFormat ?? "normal")}
              options={[{ value: "normal", label: "数值" }, { value: "percent", label: "百分比" }]}
              onChange={value => set("tooltipRightFormat", value)}/></Field>
            {toggle("右侧 Y 轴千分位分隔", "tooltipRightComma", false)}
            {number("右侧 Y 轴小数位数", "tooltipRightDecimals", num("decimals", 0), 0, 6)}
            {toggle("右侧 Y 轴小数补零", "tooltipRightPadZeros", flag("labelPadZeros"))}
          </>}
        </div>}
        {activeTooltipTab === "text" && <div role="tabpanel">
          <ColorField label="名称颜色" value={String(chart.tooltipNameColor ?? chart.tooltipTextColor ?? "#cde3f7")}
            disabled={locked} onChange={value => set("tooltipNameColor", value)}/>
          {number("名称字体大小", "tooltipNameSize", num("tooltipFontSize", 12), 6, 48)}
          <ColorField label="数值颜色" value={String(chart.tooltipTextColor ?? "#cde3f7")} disabled={locked}
            onChange={value => set("tooltipTextColor", value)}/>
          {number("数值字体大小", "tooltipFontSize", 12, 6, 48)}
          {toggle("显示标题", "tooltipShowTitle")}
          {flag("tooltipShowTitle") && <>
            <ColorField label="标题颜色" value={String(chart.tooltipTitleColor ?? chart.tooltipTextColor ?? "#cde3f7")}
              disabled={locked} onChange={value => set("tooltipTitleColor", value)}/>
            {number("标题字体大小", "tooltipTitleSize", num("tooltipFontSize", 12), 6, 48)}
          </>}
        </div>}
        {activeTooltipTab === "unit" && <div role="tabpanel">
          {toggle("显示单位名称", "tooltipShowUnitName", !!chart.unit)}
          {flag("tooltipShowUnitName", !!chart.unit) && <>
            <Field label="Y 轴单位名称"><BufferedInput label="Y 轴单位名称" value={String(chart.tooltipUnit ?? chart.unit ?? "")}
              disabled={locked} onChange={value => set("tooltipUnit", value)}/></Field>
            {hasRightAxis && <Field label="右侧 Y 轴单位名称"><BufferedInput label="右侧 Y 轴单位名称" value={String(chart.tooltipRightUnit ?? chart.unit ?? "")}
              disabled={locked} onChange={value => set("tooltipRightUnit", value)}/></Field>}
            <ColorField label="单位颜色" value={String(chart.tooltipUnitColor ?? chart.tooltipTextColor ?? "#cde3f7")}
              disabled={locked} onChange={value => set("tooltipUnitColor", value)}/>
            {number("单位字体大小", "tooltipUnitSize", num("tooltipFontSize", 12), 6, 48)}
          </>}
        </div>}
        {activeTooltipTab === "pointer" && hasTooltipPointer && <div role="tabpanel">
          {toggle("显示垂直辅助线", "tooltipShowVerticalPointer", false)}
          {toggle("显示水平辅助线", "tooltipShowHorizontalPointer", false)}
          {(flag("tooltipShowVerticalPointer", false) || flag("tooltipShowHorizontalPointer", false)) && <>
            <Field label="辅助线类型"><SelectField label="辅助线类型" disabled={locked} value={String(chart.tooltipPointerStyle ?? "dashed")}
              options={[{ value: "solid", label: "实线" }, { value: "dashed", label: "虚线" }]}
              onChange={value => set("tooltipPointerStyle", value)}/></Field>
            <ColorField label="辅助线颜色" value={String(chart.tooltipPointerColor ?? "#999999")} disabled={locked}
              onChange={value => set("tooltipPointerColor", value)}/>
            {number("辅助线宽度", "tooltipPointerWidth", 1, 0, 20)}
            {toggle("显示辅助线标签", "tooltipPointerLabel", false)}
            {flag("tooltipPointerLabel", false) && <>
              <ColorField label="辅助线标签颜色" value={String(chart.tooltipPointerLabelColor ?? "#ffffff")} disabled={locked}
                onChange={value => set("tooltipPointerLabelColor", value)}/>
              {number("辅助线标签大小", "tooltipPointerLabelSize", 12, 6, 48)}
              <ColorField label="辅助线标签背景" value={String(chart.tooltipPointerLabelBackground ?? "#505765")} disabled={locked}
                onChange={value => set("tooltipPointerLabelBackground", value)}/>
            </>}
          </>}
        </div>}
      </>}
    </section></Panel>
  </Panels></>;
}
