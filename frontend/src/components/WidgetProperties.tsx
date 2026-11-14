import { Children, cloneElement, isValidElement, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NumberInput } from "@/components/ui-ext/number-input";
import { Toast } from "@/lib/toast";
import { Camera, Delete as DeleteIcon, Down, Lock, Unlock } from "@icon-park/react";
import { useStore } from "../state/store";
import { getSceneBridge } from "../workers/bridge";
import { NODE_TYPE_LABEL, type SceneNode, type Vec3 } from "../types";
import type { WidgetConfig } from "../data/editor";
import {
  isChartWidget, isMediaWidget, mediaCarouselAnimTypes, mediaCarouselFitOptions, mediaEasings,
  mediaImageAnimTypes, mediaImageFitOptions, mediaPlaybackRates, mediaPlayModes,
  monitorProtocols, monitorRtspTransports, topologyAutoLayout, widgetBorderStyles,
  widgetFontFamilies, widgetFontWeights,
} from "../data/editor";
import { captureWidgetCover } from "../engine/exportBoard";
import { resolveRuntimeNode } from "../data/runtimeScene";
import { BufferedInput, ColorField, Field, NumberField } from "./PropertyFields";
import { MAP_THEME_OPTIONS } from "../data/mapSvg";
import ChartProperties from "./ChartProperties";

/** 属性面板折叠分区：受控 Collapsible，展开态由 Panels 的 Set 集中管理。 */
function Panel({ itemKey, header, open = false, onOpenChange, children }: {
  itemKey: string; header: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void; children?: ReactNode;
}) {
  return <Collapsible open={open} onOpenChange={onOpenChange} data-panel={itemKey}>
    <CollapsibleTrigger className="properties-collapse-header" aria-label={typeof header === "string" ? header : undefined}>
      <span className="flex-1 text-left">{header}</span>
      <Down theme="outline" size={12} className="shrink-0 transition-transform" style={{ transform: open ? undefined : "rotate(-90deg)" }}/>
    </CollapsibleTrigger>
    <CollapsibleContent keepMounted className="properties-collapse-content">{children}</CollapsibleContent>
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

/** 图元组件「文本设置」的标题字段文案，缺省回退「标题文本」。 */
const controlTextLabels: Partial<Record<WidgetConfig["kind"], string>> = {
  dropdown: "当前选中项", timePicker: "当前选中时间", search: "占位提示", progress: "进度标签",
  dialog: "弹窗标题", weather: "城市与天气", calendar: "日历标题", timer: "计时说明",
  timeline: "时间轴标题", flipCounter: "翻牌器标题", dataChange: "指标名称",
  tableBasic: "表格标题", tableIndex: "表格标题", wordCloud: "词云标题", textMultiline: "文本内容",
  mapRegion: "地图标题", mapPoint: "地图标题", mapFlyline: "地图标题", mapHeat: "地图标题", mapTrack: "地图标题", mapBar: "地图标题",
};

/**
 * 图元组件右侧属性面板：分区对齐山海鲸同类组件——
 * 位置尺寸 / 基础设置 / 组件内容 / 文本设置 / 背景设置 / 边框设置 / 阴影设置。
 */
export default function WidgetProperties({ node, editStateId }: { node: SceneNode; editStateId?: string }) {
  const state = useStore(), wBase = node.widget!;
  const imageRef = useRef<HTMLInputElement>(null);
  const geoRef = useRef<HTMLInputElement>(null);
  const post = getSceneBridge().post;
  // 山海鲸「默认状态」：选中非默认状态时，样式面板展示合并后的值，写入进该状态的补丁（位置/数据等节点级字段不受影响）
  const activeState = editStateId ? wBase.states?.find((item) => item.id === editStateId) : undefined;
  const chartNode = activeState ? resolveRuntimeNode(node, {}, { [node.id]: { stateId: activeState.id } }) : node;
  const w: WidgetConfig = activeState ? { ...wBase, ...activeState.patch } : wBase;
  const patchWidget = (patch: Partial<WidgetConfig>) => activeState
    ? post({ type: "patchWidgetState", id: node.id, stateId: activeState.id, patch })
    : post({ type: "patchWidget", id: node.id, patch });
  const patchData = (patch: Record<string, unknown>) => post({ type: "patchData", id: node.id, patch });
  const setAxis = (property: "position" | "rotation" | "boxSize", axis: keyof Vec3, value: number) =>
    post({ type: "setAxis", id: node.id, property, axis, value });
  const widgetData = node.data ?? {};
  // 山海鲸「拓扑图」自动布局：按连线 BFS 分层重排节点
  const autoLayoutTopology = () => {
    const nodes = Array.isArray(widgetData.nodes) ? widgetData.nodes as { id: string; name: string; x: number; y: number }[] : [];
    const edges = Array.isArray(widgetData.edges) ? widgetData.edges as { from: string; to: string }[] : [];
    if (!nodes.length) { Toast.info("暂无拓扑节点数据"); return; }
    const width = node.boxSize?.x ?? 520;
    patchData({ nodes: topologyAutoLayout(nodes, edges, width) });
    Toast.success("已按连线分层布局");
  };
  const urls = Array.isArray(widgetData.urls) ? (widgetData.urls as unknown[]).map(String) : [];
  const optionValues = Array.isArray(widgetData.options) ? widgetData.options as string[]
    : Array.isArray(widgetData.items) ? widgetData.items as string[] : [];
  const hasText = !["shape", "report", "mapOutline", "mapTile"].includes(w.kind) && !isMediaWidget(w.kind)
    && (!isChartWidget(w.kind) || w.kind === "table");
  const shadowOn = w.shadowColor !== "transparent";
  // 山海鲸「地图」分类（轮廓/瓦片）：无 组件内容/文本设置，分区为 地图设置/底图层/呼吸点层/展示设置/影像设置（面板盘点见 docs/map-components-sync.md）
  const isNewMap = w.kind === "mapOutline" || w.kind === "mapTile";
  const mapGroup = (key: string) => (widgetData[key] && typeof widgetData[key] === "object" ? widgetData[key] : {}) as Record<string, unknown>;
  const patchMapGroup = (key: string, patch: Record<string, unknown>) =>
    patchData({ [key]: { ...mapGroup(key), ...patch } });
  const patchNameFont = (patch: Record<string, unknown>) => {
    const font = (mapGroup("map").nameFont ?? {}) as Record<string, unknown>;
    patchMapGroup("map", { nameFont: { ...font, ...patch } });
  };
  const nameFont = mapGroup("map").nameFont as Record<string, unknown> | undefined;
  // 媒体组件的分区名对齐山海鲸：图片设置/展示设置、播放设置、监控设置、轮播图设置/切换按钮、PDF 设置
  const mediaKeys = w.kind === "image" ? ["media", "mediaShow"]
    : w.kind === "carousel" ? ["media", "mediaButtons", "mediaShow"] : ["media"];
  const isChart = isChartWidget(w.kind) && w.kind !== "table";
  const defaultKeys = isMediaWidget(w.kind) ? ["position", "basic", ...mediaKeys]
    : isNewMap ? (w.kind === "mapOutline" ? ["position", "basic", "map", "mapLayer", "breath"] : ["position", "basic", "map", "tile"])
    : isChart ? ["basic"] : ["position", "basic", "content", ...(hasText ? ["text"] : [])];
  const positionPanel = <Panel header={isChart ? "大小&位置" : "位置尺寸 (px)"} itemKey="position"><section className="property-section">
      <NumberField label="位置 X" value={node.transform.position.x} disabled={node.locked} onChange={v => setAxis("position", "x", v)}/>
      <NumberField label="位置 Y" value={node.transform.position.y} disabled={node.locked} onChange={v => setAxis("position", "y", v)}/>
      <NumberField label="宽度" value={node.boxSize?.x ?? 300} min={20} disabled={node.locked} onChange={v => setAxis("boxSize", "x", v)}/>
      <NumberField label="高度" value={node.boxSize?.y ?? 64} min={16} disabled={node.locked} onChange={v => setAxis("boxSize", "y", v)}/>
      <NumberField label="角度 (°)" value={node.transform.rotation.z} disabled={node.locked} onChange={v => setAxis("rotation", "z", v)}/>
    </section></Panel>;
  return <Panels key={node.id} className="properties-collapse" defaultKeys={defaultKeys}>
    {!isChart && positionPanel}
    <Panel header={isChart ? "基本设置" : "基础设置"} itemKey="basic"><section className="property-section">
      {isChart && <Field label="标题文本"><BufferedInput key={`${node.id}-text`} label="标题文本" value={w.text} disabled={node.locked}
        onChange={text => patchWidget({ text })}/></Field>}
      <Field label="对象类型"><Badge variant="secondary">{NODE_TYPE_LABEL[node.type]}</Badge></Field>
      <Field label="显示对象"><Switch size="sm" aria-label="显示对象" checked={node.visible} onCheckedChange={() => post({ type: "toggleVisible", id: node.id })}/></Field>
      <Field label="锁定对象"><Button size="icon-sm" variant="ghost" aria-label="锁定对象" onClick={() => post({ type: "toggleLocked", id: node.id })}>{node.locked ? <Lock/> : <Unlock/>}</Button></Field>
      <Field label="透明度"><NumberInput size="small" min={0} max={1} step={.1} aria-label="透明度" value={w.opacity} onChange={v => typeof v === "number" && patchWidget({ opacity: v })}/></Field>
      {/* 山海鲸「基本设置」：鼠标穿透 / 是否加载存 node.data，Rust hit_test 与渲染端读取（免改线上协议） */}
      <Field label="鼠标穿透"><Switch size="sm" aria-label="鼠标穿透" checked={node.data?.passThrough === true}
        onCheckedChange={checked => patchData({ passThrough: checked })}/></Field>
      <Field label="是否加载"><Switch size="sm" aria-label="是否加载" checked={node.data?.loaded !== false}
        onCheckedChange={checked => patchData({ loaded: checked })}/></Field>
      <Field label="排列"><div className="batch-actions">
        {(["front", "forward", "backward", "back"] as const).map((direction, i) =>
          <Button size="sm" key={direction} disabled={node.locked} aria-label={["置于顶层", "上移一层", "下移一层", "置于底层"][i]}
            onClick={() => post({ type: "reorder", ids: [node.id], direction })}>{["置顶", "上移", "下移", "置底"][i]}</Button>)}
      </div></Field>
      <Field label="所属分组"><SelectField label="所属分组" value={state.scene.some(n => n.id === node.parentId) ? node.parentId ?? "@root" : "@root"}
        options={[{ value: "@root", label: "根图层" }, ...state.scene.filter(n => n.type === "group" && n.id !== node.id).map(n => ({ value: n.id, label: n.name }))]}
        onChange={v => post({ type: "reparent", ids: [node.id], parentId: v === "@root" ? null : String(v) })}/>
      </Field>
    </section></Panel>
    {/* 山海鲸「地图」分类：地图设置（渲染模式/投影方式/地图区域/下钻/行政编码/geojson 文件） */}
    {isNewMap && <Panel header="地图设置" itemKey="map"><section className="property-section">
      <Field label="地图标题"><BufferedInput key={`${node.id}-text`} label="地图标题" value={w.text} onChange={text => patchWidget({ text })}/></Field>
      <Field label="渲染模式"><SelectField label="渲染模式" value={String(widgetData.renderMode ?? "canvas")}
        options={[{ value: "canvas", label: "canvas" }, { value: "webgl", label: "webgl" }]}
        onChange={v => patchData({ renderMode: v })}/></Field>
      <Field label="地图投影方式"><SelectField label="地图投影方式" value={String(widgetData.projection ?? "mercator")}
        options={[{ value: "mercator", label: "默认（墨卡托）" }, { value: "equirect", label: "等距圆柱" }]}
        onChange={v => patchData({ projection: v })}/></Field>
      {w.kind === "mapOutline" && <>
        <Field label="地图区域"><SelectField label="地图区域" value={String(widgetData.region ?? "china")}
          options={[{ value: "china", label: "中国" }, { value: "world", label: "世界" }, { value: "usa", label: "美国" }, { value: "custom", label: "自定义（GeoJSON）" }]}
          onChange={v => patchData({ region: v })}/></Field>
        {String(widgetData.region ?? "china") === "china" && <>
          <Field label="地图下钻"><Switch size="sm" aria-label="地图下钻" checked={widgetData.drill === true}
            onCheckedChange={checked => patchData({ drill: checked })}/></Field>
          <Field label="显示返回按钮"><Switch size="sm" aria-label="显示返回按钮" checked={widgetData.backButton === true}
            onCheckedChange={checked => patchData({ backButton: checked })}/></Field>
        </>}
        {String(widgetData.region ?? "china") === "usa" && <Field label="行政编码"><NumberInput size="small" aria-label="行政编码"
          value={Number(widgetData.adminCode ?? 1100000000)} onChange={v => typeof v === "number" && patchData({ adminCode: v })}/></Field>}
        {String(widgetData.region ?? "china") === "custom" && <>
          <Field label="选择geojson文件"><Button size="sm" className="w-full" onClick={() => geoRef.current?.click()}>
            {widgetData.geojson ? "已加载 GeoJSON，点击替换" : "点击选择文件"}</Button>
            <input hidden ref={geoRef} type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={e => {
              const file = e.target.files?.[0]; if (!file) return;
              if (file.size > 1_500_000) { Toast.error("请选择小于 1.5 MB 的 GeoJSON"); return; }
              const reader = new FileReader();
              reader.onload = () => {
                try { patchData({ geojson: JSON.parse(String(reader.result)) }); Toast.success("GeoJSON 已加载"); }
                catch { Toast.error("GeoJSON 解析失败"); }
              };
              reader.readAsText(file); e.target.value = "";
            }}/></Field>
          <p className="properties-note">支持 Polygon / MultiPolygon FeatureCollection，≤1.5MB。</p>
        </>}
      </>}
      {w.kind === "mapTile" && <Field label="地图范围"><SelectField label="地图范围" value={String(widgetData.region ?? "world")}
        options={[{ value: "world", label: "世界" }, { value: "china", label: "中国" }, { value: "usa", label: "美国" }]}
        onChange={v => patchData({ region: v })}/></Field>}
    </section></Panel>}
    {/* 山海鲸「底图层 → 基本设置」全量字段 */}
    {w.kind === "mapOutline" && <Panel header="底图层" itemKey="mapLayer"><section className="property-section">
      <Field label="填充类型"><SelectField label="填充类型" value={String(mapGroup("map").fillType ?? "color")}
        options={[{ value: "color", label: "颜色" }, { value: "image", label: "图片" }]}
        onChange={v => patchMapGroup("map", { fillType: v })}/></Field>
      {String(mapGroup("map").fillType ?? "color") === "image" &&
        <BufferedInput key={`${node.id}-fill-image`} label="填充图片地址" placeholder="https://…" value={String(mapGroup("map").fillImage ?? "")}
          onChange={fillImage => patchMapGroup("map", { fillImage })}/>}
      <ColorField label="默认颜色" value={String(mapGroup("map").defaultColor ?? "#1b3350")} onChange={defaultColor => patchMapGroup("map", { defaultColor })}/>
      <ColorField label="高亮颜色" value={String(mapGroup("map").highlightColor ?? "#6cbcff")} onChange={highlightColor => patchMapGroup("map", { highlightColor })}/>
      <ColorField label="选中时的颜色" value={String(mapGroup("map").selectedColor ?? "#2f7fe8")} onChange={selectedColor => patchMapGroup("map", { selectedColor })}/>
      <ColorField label="分界线颜色" value={String(mapGroup("map").borderColor ?? "#2c4a6e")} onChange={borderColor => patchMapGroup("map", { borderColor })}/>
      <NumberField label="分界线粗细 (px)" value={Number(mapGroup("map").borderWidth ?? 1)} min={0} max={20} onChange={v => patchMapGroup("map", { borderWidth: v })}/>
      <Field label="分界线类型"><SelectField label="分界线类型" value={String(mapGroup("map").borderStyle ?? "dotted")}
        options={[{ value: "solid", label: "实线" }, { value: "dotted", label: "点线" }]}
        onChange={v => patchMapGroup("map", { borderStyle: v })}/></Field>
      <ColorField label="外轮廓线颜色" value={String(mapGroup("map").outlineColor ?? "#3d6a9e")} onChange={outlineColor => patchMapGroup("map", { outlineColor })}/>
      <NumberField label="外轮廓线粗细 (px)" value={Number(mapGroup("map").outlineWidth ?? 0)} min={0} max={20} onChange={v => patchMapGroup("map", { outlineWidth: v })}/>
      <NumberField label="外轮廓线发光强度" value={Number(mapGroup("map").outlineGlow ?? 0)} min={0} max={100} onChange={v => patchMapGroup("map", { outlineGlow: v })}/>
      <ColorField label="外轮廓线发光颜色" value={String(mapGroup("map").glowColor ?? "#4da3ff")} onChange={glowColor => patchMapGroup("map", { glowColor })}/>
      <NumberField label="阴影大小 (px)" value={Number(mapGroup("map").shadowSize ?? 0)} min={0} max={60} onChange={v => patchMapGroup("map", { shadowSize: v })}/>
      <ColorField label="阴影颜色" value={String(mapGroup("map").shadowColor ?? "#000000")} onChange={shadowColor => patchMapGroup("map", { shadowColor })}/>
      <Field label="区域名称"><Switch size="sm" aria-label="区域名称" checked={mapGroup("map").showRegionNames !== false}
        onCheckedChange={checked => patchMapGroup("map", { showRegionNames: checked })}/></Field>
      <Field label="强制显示所有区域名称"><Switch size="sm" aria-label="强制显示所有区域名称" checked={mapGroup("map").forceShowNames === true}
        onCheckedChange={checked => patchMapGroup("map", { forceShowNames: checked })}/></Field>
      <Field label="名称字体"><SelectField label="名称字体" value={String(nameFont?.family ?? "")}
        options={[{ value: "", label: "系统默认字体" }, ...widgetFontFamilies.filter(f => f.value)]}
        onChange={v => patchNameFont({ family: String(v) })}/></Field>
      <NumberField label="名称字号 (px)" value={Number(nameFont?.size ?? 12)} min={8} max={72} onChange={v => patchNameFont({ size: v })}/>
      <Field label="名称加粗"><Switch size="sm" aria-label="名称加粗" checked={nameFont?.bold === true}
        onCheckedChange={checked => patchNameFont({ bold: checked })}/></Field>
      <Field label="名称倾斜"><Switch size="sm" aria-label="名称倾斜" checked={nameFont?.italic === true}
        onCheckedChange={checked => patchNameFont({ italic: checked })}/></Field>
      <Field label="名称下划线"><Switch size="sm" aria-label="名称下划线" checked={nameFont?.underline === true}
        onCheckedChange={checked => patchNameFont({ underline: checked })}/></Field>
      <Field label="名称删除线"><Switch size="sm" aria-label="名称删除线" checked={nameFont?.strike === true}
        onCheckedChange={checked => patchNameFont({ strike: checked })}/></Field>
    </section></Panel>}
    {/* 山海鲸「呼吸点层 → 基本设置」 */}
    {w.kind === "mapOutline" && <Panel header="呼吸点层" itemKey="breath"><section className="property-section">
      <Field label="显示名称"><Switch size="sm" aria-label="呼吸点显示名称" checked={mapGroup("breath").showName === true}
        onCheckedChange={checked => patchMapGroup("breath", { showName: checked })}/></Field>
      <Field label="呼吸点形状"><SelectField label="呼吸点形状" value={String(mapGroup("breath").shape ?? "circle")}
        options={[{ value: "circle", label: "圆形" }]} onChange={v => patchMapGroup("breath", { shape: v })}/></Field>
      <NumberField label="呼吸点最小半径 (px)" value={Number(mapGroup("breath").minR ?? 5)} min={1} max={60} onChange={v => patchMapGroup("breath", { minR: v })}/>
      <NumberField label="呼吸点最大半径 (px)" value={Number(mapGroup("breath").maxR ?? 15)} min={1} max={120} onChange={v => patchMapGroup("breath", { maxR: v })}/>
      <ColorField label="呼吸点颜色" value={String(mapGroup("breath").color ?? "#ffd66b")} onChange={color => patchMapGroup("breath", { color })}/>
      <p className="properties-note">数据行含经纬度（lon/lat）时渲染呼吸点。</p>
    </section></Panel>}
    {/* 山海鲸「影像设置」（鲸地图）：内置主题矢量 / 在线影像（卫星、电子瓦片，离线自动回退内置主题） */}
    {w.kind === "mapTile" && <Panel header="影像设置" itemKey="tile"><section className="property-section">
      <Field label="底图影像"><SelectField label="底图影像" value={String(mapGroup("tile").imagery ?? "none")}
        options={[{ value: "none", label: "内置主题" }, { value: "satellite", label: "卫星影像" }, { value: "street", label: "电子地图" }]}
        onChange={v => patchMapGroup("tile", { imagery: v })}/></Field>
      <Field label="底图样式"><SelectField label="底图样式" value={String(widgetData.theme ?? "black-gold")}
        options={MAP_THEME_OPTIONS} onChange={v => patchData({ theme: v })}/></Field>
      <NumberField label="中心点经度" value={Number(mapGroup("tile").centerLon ?? 105)} min={-180} max={180} onChange={v => patchMapGroup("tile", { centerLon: v })}/>
      <NumberField label="中心点纬度" value={Number(mapGroup("tile").centerLat ?? 36)} min={-85} max={85} onChange={v => patchMapGroup("tile", { centerLat: v })}/>
      <NumberField label="缩放级别" value={Number(mapGroup("tile").zoom ?? 1)} min={1} max={12} onChange={v => patchMapGroup("tile", { zoom: v })}/>
      <NumberField label="最小缩放级别" value={Number(mapGroup("tile").minZoom ?? 1)} min={1} max={12} onChange={v => patchMapGroup("tile", { minZoom: v })}/>
      <NumberField label="最大缩放级别" value={Number(mapGroup("tile").maxZoom ?? 12)} min={1} max={12} onChange={v => patchMapGroup("tile", { maxZoom: v })}/>
      <Field label="允许移动缩放"><Switch size="sm" aria-label="允许移动缩放" checked={mapGroup("tile").moveZoom !== false}
        onCheckedChange={checked => patchMapGroup("tile", { moveZoom: checked })}/></Field>
      <p className="properties-note">卫星影像 / 电子地图来自公开瓦片服务（需网络，带省界与标注叠加）；离线或加载失败自动回退内置主题矢量边界。</p>
    </section></Panel>}
    {/* 山海鲸「展示设置」 */}
    {w.kind === "mapOutline" && <Panel header="展示设置" itemKey="mapShow"><section className="property-section">
      <Field label="播放动画"><Switch size="sm" aria-label="播放动画" checked={mapGroup("show").playAnim === true}
        onCheckedChange={checked => patchMapGroup("show", { playAnim: checked })}/></Field>
      <Field label="触发数据联动"><Switch size="sm" aria-label="触发数据联动" checked={mapGroup("show").triggerLinkage === true}
        onCheckedChange={checked => patchMapGroup("show", { triggerLinkage: checked })}/></Field>
      <NumberField label="动画延迟时长（秒）" value={Number(mapGroup("show").animDelay ?? 1)} min={0} max={60} onChange={v => patchMapGroup("show", { animDelay: v })}/>
      <NumberField label="单个滚动持续时长（秒）" value={Number(mapGroup("show").scrollDuration ?? 0.5)} min={0.1} max={60} step={.1} onChange={v => patchMapGroup("show", { scrollDuration: v })}/>
      <Field label="循环播放动画"><Switch size="sm" aria-label="循环播放动画" checked={mapGroup("show").loopAnim === true}
        onCheckedChange={checked => patchMapGroup("show", { loopAnim: checked })}/></Field>
      <NumberField label="循环间隔（秒）" value={Number(mapGroup("show").loopInterval ?? 0)} min={0} max={60} onChange={v => patchMapGroup("show", { loopInterval: v })}/>
      <p className="properties-note">呼吸点动画在预览 / 发布端播放；配置先行存储。</p>
    </section></Panel>}
    {/* 山海鲸媒体组件不走「组件内容」，分区改为 图片设置 / 播放设置 / 监控设置 / 轮播图设置 / PDF 设置 */}
    {!isMediaWidget(w.kind) && !isNewMap && !isChart && <Panel header="组件内容" itemKey="content"><section className="property-section">{w.kind === "topology" && <Field label="布局"><Button size="sm" className="w-full" disabled={node.locked} onClick={autoLayoutTopology}>自动布局（按连线分层）</Button></Field>}
      <Field label={controlTextLabels[w.kind] ?? "标题文本"}><BufferedInput key={`${node.id}-text`} label={controlTextLabels[w.kind] ?? "标题文本"} value={w.text} onChange={text => patchWidget({ text })}/></Field>
      {["metric", "weather", "flipCounter", "dataChange"].includes(w.kind) && <>
        <Field label={w.kind === "weather" ? "温度数值" : "指标数值"}><BufferedInput key={`${node.id}-value`} label="指标数值" value={w.value} onChange={value => patchWidget({ value })}/></Field>
        <Field label={w.kind === "weather" ? "温度单位" : "指标单位"}><BufferedInput key={`${node.id}-unit`} label="指标单位" value={w.unit} onChange={unit => patchWidget({ unit })}/></Field>
      </>}
      {w.kind === "dialog" && <Field label="正文内容"><BufferedInput key={`${node.id}-body`} label="正文内容" value={w.value} onChange={value => patchWidget({ value })}/></Field>}
      {["dropdown", "timePicker", "timeRange", "groupPanel", "list", "tabs", "menuVertical", "menuHorizontal", "timeline"].includes(w.kind) &&
        <Field label={["dropdown", "timePicker"].includes(w.kind) ? "下拉选项" : w.kind === "timeRange" ? "时间范围（起 ~ 止）" : "选项 / 行"}>
          <Input className="h-7 text-xs" aria-label="选项列表" key={`${node.id}-${optionValues.join("|")}`} defaultValue={optionValues.join("、")}
            onBlur={e => { const values = e.target.value.split(/[，、,]/).map(s => s.trim()).filter(Boolean); if (values.length) patchData(["dropdown", "timePicker", "timeRange"].includes(w.kind) ? { options: values } : { items: values }); }}/>
        </Field>}
      {["dropdown", "timePicker", "timeRange", "groupPanel", "list", "tabs", "menuVertical", "menuHorizontal", "timeline"].includes(w.kind) &&
        <p className="properties-note">使用「、」「，」或英文逗号分隔</p>}
      {w.kind === "progress" && <Field label="进度百分比"><NumberInput size="small" min={0} max={100} aria-label="进度百分比" value={Number(widgetData.percent) || 0} onChange={v => typeof v === "number" && patchData({ percent: v })}/></Field>}
      {["checkbox", "switch"].includes(w.kind) && <Field label="默认选中"><Switch size="sm" aria-label="默认选中" checked={widgetData.checked === true} onCheckedChange={checked => patchData({ checked })}/></Field>}
      {w.kind === "input" && <Field label="默认内容"><BufferedInput key={`${node.id}-default`} label="默认内容" value={String(widgetData.value ?? "")} onChange={value => patchData({ value })}/></Field>}
      {["slider", "timeProgress"].includes(w.kind) && <>
        {([['min', '最小值'], ['max', '最大值'], ['step', '步长'], ['value', '默认值']] as const).map(([key, label]) =>
          <NumberField key={key} label={label} value={Number(widgetData[key]) || 0} min={key === 'step' ? 0.001 : undefined} onChange={value => patchData({ [key]: value })}/>)}
        {w.kind === "timeProgress" && <p className="properties-note">时间数值以秒为单位</p>}
      </>}
      {w.kind === "colorPicker" && <ColorField label="默认颜色" value={String(widgetData.value ?? "#4b9eff")} onChange={value => patchData({ value })}/>}
      {w.kind === "upload" && <>
        <Field label="文件类型"><BufferedInput key={`${node.id}-accept`} label="文件类型" placeholder="例如 image/*" value={String(widgetData.accept ?? "")} onChange={accept => patchData({ accept })}/></Field>
        <Field label="上传地址"><BufferedInput key={`${node.id}-upload-url`} label="上传地址" placeholder="https://…" value={String(widgetData.uploadUrl ?? "")} onChange={uploadUrl => patchData({ uploadUrl })}/></Field>
        <Field label="允许多选"><Switch size="sm" aria-label="允许多选" checked={widgetData.multiple === true} onCheckedChange={multiple => patchData({ multiple })}/></Field>
        <p className="properties-note">设置地址后，选择文件时以 POST 上传；未设置时仅选择文件。</p>
      </>}
      {["tree", "twin2d"].includes(w.kind) && <p className="properties-note">可在「数据」面板编辑{w.kind === "tree" ? "节点" : "区域"} JSON。</p>}
      {w.kind === "iframe" && <Field label="网页地址">
        <Input className="h-7 text-xs" aria-label="网页地址" placeholder="https://…" key={`${node.id}-${String(widgetData.url ?? "")}`} defaultValue={String(widgetData.url ?? "")} onBlur={e => patchData({ url: e.target.value.trim() })}/>
      </Field>}
      {w.kind === "iframe" && <p className="properties-note">支持嵌入 HTTP / HTTPS 页面；目标站点需允许在 iframe 中显示。</p>}
    </section></Panel>}
    {/* 山海鲸「图片设置」+「展示设置」 */}
    {w.kind === "image" && <Panel header="图片设置" itemKey="media"><section className="property-section">
      <BufferedInput key={`${node.id}-image`} label="图片地址" placeholder="https://…" value={w.image} onChange={image => patchWidget({ image })}/>
      <Button size="sm" className="w-full" onClick={() => imageRef.current?.click()}>选择本地图片</Button>
      <input hidden ref={imageRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => {
        const file = e.target.files?.[0]; if (!file) return;
        if (file.size > 1_500_000) { Toast.error("请选择小于 1.5 MB 的图片"); return }
        const reader = new FileReader();
        reader.onload = () => patchWidget({ image: String(reader.result) });
        reader.readAsDataURL(file); e.target.value = "";
      }}/>
      <Field label="填充方式"><SelectField label="填充方式" value={String(widgetData.objectFit ?? "stretch")}
        options={mediaImageFitOptions} onChange={v => patchData({ objectFit: v })}/></Field>
      {String(widgetData.objectFit ?? "stretch") === "center" && <Field label="外框跟随图片尺寸">
        <Switch size="sm" aria-label="外框跟随图片尺寸" checked={widgetData.frameFollowsImage === true}
          onCheckedChange={checked => patchData({ frameFollowsImage: checked })}/></Field>}
    </section></Panel>}
    {w.kind === "image" && <Panel header="展示设置" itemKey="mediaShow"><section className="property-section">
      <Field label="播放动画"><Switch size="sm" aria-label="播放动画" checked={widgetData.playAnimation === true}
        onCheckedChange={checked => patchData({ playAnimation: checked })}/></Field>
      {widgetData.playAnimation === true && <Field label="动画类型"><SelectField label="动画类型"
        value={String(widgetData.animType ?? "cw")} options={mediaImageAnimTypes} onChange={v => patchData({ animType: v })}/></Field>}
      {widgetData.playAnimation === true && <Field label="缓动方式"><SelectField label="缓动方式"
        value={String(widgetData.easing ?? "easeInOut")} options={mediaEasings} onChange={v => patchData({ easing: v })}/></Field>}
      <NumberField label="动画延迟时长（秒）" value={Number(widgetData.animDelay ?? 1)} min={0} max={60} onChange={v => patchData({ animDelay: v })}/>
      <NumberField label="单个动画持续时长（秒）" value={Number(widgetData.animDuration ?? 1)} min={0.1} max={60} onChange={v => patchData({ animDuration: v })}/>
      <Field label="循环播放"><Switch size="sm" aria-label="循环播放" checked={widgetData.animLoop === true}
        onCheckedChange={checked => patchData({ animLoop: checked })}/></Field>
      <NumberField label="循环间隔（秒）" value={Number(widgetData.animInterval ?? 0)} min={0} max={60} onChange={v => patchData({ animInterval: v })}/>
      <p className="properties-note">动画在预览 / 发布端播放；编辑画布显示静态图。</p>
    </section></Panel>}
    {/* 山海鲸「播放设置」：视频 / 轮播视频 / 音频（山海鲸把地址与黑色背景透明放在「基本设置」，此处并入本分区） */}
    {["video", "carouselVideo", "audio"].includes(w.kind) && <Panel header="播放设置" itemKey="media"><section className="property-section">
      {w.kind === "carouselVideo" ? <Field label="视频地址（每行一个，按顺序轮播）">
        <Textarea rows={4} className="min-h-0" aria-label="视频地址列表" key={`${node.id}-${urls.join("|")}`}
          defaultValue={urls.join("\n")} onBlur={e => patchData({ urls: e.target.value.split(/\n+/).map(s => s.trim()).filter(Boolean) })}/>
      </Field> : <Field label="媒体地址">
        <Input className="h-7 text-xs" aria-label="媒体地址" placeholder="https://… 或 /media/xxx.mp4" key={`${node.id}-${String(widgetData.src ?? "")}`}
          defaultValue={String(widgetData.src ?? "")} onBlur={e => patchData({ src: e.target.value.trim() })}/>
        <p className="properties-note">支持 http(s) 链接或站点内相对路径</p>
      </Field>}
      <Field label="自动播放"><Switch size="sm" aria-label="自动播放"
        checked={w.kind === "audio" ? widgetData.autoplay === true : widgetData.autoplay !== false}
        onCheckedChange={checked => patchData({ autoplay: checked })}/></Field>
      <Field label="循环播放"><Switch size="sm" aria-label="循环播放" checked={widgetData.loop !== false}
        onCheckedChange={checked => patchData({ loop: checked })}/></Field>
      <NumberField label="循环开始时间（秒）" value={Number(widgetData.loopStart ?? 0)} min={0} max={3600} onChange={v => patchData({ loopStart: v })}/>
      <Field label="播放速度"><SelectField label="播放速度" value={String(Number(widgetData.playbackRate ?? 1))}
        options={mediaPlaybackRates.map(rate => ({ value: String(rate.value), label: rate.label }))}
        onChange={v => patchData({ playbackRate: Number(v) })}/></Field>
      {w.kind !== "audio" && <Field label="静音播放"><Switch size="sm" aria-label="静音播放" checked={widgetData.muted !== false}
        onCheckedChange={checked => patchData({ muted: checked })}/></Field>}
      {w.kind === "audio" && <NumberField label="音量 (1-100)" value={Number(widgetData.volume ?? 100)} min={1} max={100} onChange={v => patchData({ volume: v })}/>}
      {w.kind !== "carouselVideo" && <Field label="隐藏控制条"><Switch size="sm" aria-label="隐藏控制条"
        checked={widgetData.hideControls === true} onCheckedChange={checked => patchData({ hideControls: checked })}/></Field>}
      <Field label="播放方式"><SelectField label="播放方式" value={String(widgetData.playMode ?? "pauseResume")}
        options={mediaPlayModes} onChange={v => patchData({ playMode: v })}/></Field>
      {w.kind !== "carouselVideo" && <Field label="黑色背景透明"><Switch size="sm" aria-label="黑色背景透明"
        checked={widgetData.transparentBlack === true} onCheckedChange={checked => patchData({ transparentBlack: checked })}/></Field>}
      {w.kind !== "carouselVideo" && <p className="properties-note">黑色背景透明需 webm 格式且含 Alpha 通道。</p>}
    </section></Panel>}
    {/* 山海鲸「监控设置」：浏览器仅实播 HLS / FLV，RTSP / RTMP 保留配置项 */}
    {w.kind === "monitor" && <Panel header="监控设置" itemKey="media"><section className="property-section">
      <Field label="监控地址">
        <Input className="h-7 text-xs" aria-label="监控地址" placeholder="https://… 或 /media/live.m3u8" key={`${node.id}-${String(widgetData.src ?? "")}`}
          defaultValue={String(widgetData.src ?? "")} onBlur={e => patchData({ src: e.target.value.trim() })}/>
      </Field>
      <Field label="协议类型"><SelectField label="协议类型" value={String(widgetData.protocol ?? "hls")}
        options={monitorProtocols} onChange={v => patchData({ protocol: v })}/></Field>
      {String(widgetData.protocol ?? "hls") === "rtsp" && <Field label="RTSP 底层传输协议">
        <SelectField label="RTSP 底层传输协议" value={String(widgetData.rtspTransport ?? "tcp")}
          options={monitorRtspTransports} onChange={v => patchData({ rtspTransport: v })}/></Field>}
      {["rtsp", "rtmp", "flv"].includes(String(widgetData.protocol ?? "hls")) && <Field label="支持 H265">
        <Switch size="sm" aria-label="支持 H265" checked={widgetData.h265 === true}
          onCheckedChange={checked => patchData({ h265: checked })}/></Field>}
      <Field label="显示控制条"><Switch size="sm" aria-label="显示控制条" checked={widgetData.showControls !== false}
        onCheckedChange={checked => patchData({ showControls: checked })}/></Field>
      <NumberField label="隐藏后销毁等待时间（秒）" value={Number(widgetData.destroyDelay ?? 10)} min={0} max={3600} onChange={v => patchData({ destroyDelay: v })}/>
      <Field label="静音播放"><Switch size="sm" aria-label="静音播放" checked={widgetData.muted !== false}
        onCheckedChange={checked => patchData({ muted: checked })}/></Field>
      {["rtsp", "rtmp"].includes(String(widgetData.protocol ?? "hls")) && <p className="properties-note">浏览器无法播放 RTSP / RTMP 流，请使用 HLS 或 FLV 地址。</p>}
    </section></Panel>}
    {/* 山海鲸「轮播图设置」+「切换按钮」+「展示设置」 */}
    {w.kind === "carousel" && <Panel header="轮播图设置" itemKey="media"><section className="property-section">
      <Field label="图片地址（每行一个）">
        <Textarea rows={4} className="min-h-0" aria-label="图片地址列表" key={`${node.id}-${urls.join("|")}`}
          defaultValue={urls.join("\n")} onBlur={e => patchData({ urls: e.target.value.split(/\n+/).map(s => s.trim()).filter(Boolean) })}/>
      </Field>
      <Field label="填充方式"><SelectField label="填充方式" value={String(widgetData.objectFit ?? "stretch")}
        options={mediaCarouselFitOptions} onChange={v => patchData({ objectFit: v })}/></Field>
      <Field label="显示风格"><SelectField label="显示风格" value={String(widgetData.displayStyle ?? "none")}
        options={[{ value: "none", label: "无" }, { value: "card", label: "卡片" }]} onChange={v => patchData({ displayStyle: v })}/></Field>
      <Field label="切换方向"><SelectField label="切换方向" value={String(widgetData.direction ?? "horizontal")}
        options={[{ value: "horizontal", label: "水平" }, { value: "vertical", label: "竖直" }]} onChange={v => patchData({ direction: v })}/></Field>
    </section></Panel>}
    {w.kind === "carousel" && <Panel header="切换按钮" itemKey="mediaButtons"><section className="property-section">
      <Field label="位置"><SelectField label="按钮位置" value={String(widgetData.buttonPosition ?? "inside")}
        options={[{ value: "inside", label: "内部" }, { value: "outside", label: "外部" }]} onChange={v => patchData({ buttonPosition: v })}/></Field>
      <NumberField label="按钮尺寸 (px)" value={Number(widgetData.buttonSize ?? 30)} min={16} max={120} onChange={v => patchData({ buttonSize: v })}/>
      <ColorField label="按钮颜色" value={String(widgetData.buttonColor ?? "#0a1522aa")} onChange={color => patchData({ buttonColor: color })}/>
      <NumberField label="按钮圆角 (px)" value={Number(widgetData.buttonRadius ?? 0)} min={0} max={60} onChange={v => patchData({ buttonRadius: v })}/>
      <Field label="切换箭头"><SelectField label="切换箭头" value={String(widgetData.arrows ?? "always")}
        options={[{ value: "always", label: "常显示" }, { value: "hover", label: "移入显示" }, { value: "never", label: "不显示" }]}
        onChange={v => patchData({ arrows: v })}/></Field>
      <p className="properties-note">选择「移入显示」后，鼠标悬停组件时显示切换箭头。</p>
    </section></Panel>}
    {w.kind === "carousel" && <Panel header="展示设置" itemKey="mediaShow"><section className="property-section">
      <Field label="播放动画"><Switch size="sm" aria-label="播放动画" checked={widgetData.playAnimation !== false}
        onCheckedChange={checked => patchData({ playAnimation: checked })}/></Field>
      {widgetData.playAnimation !== false && <Field label="动画类型"><SelectField label="动画类型"
        value={String(widgetData.animType ?? "slide")} options={mediaCarouselAnimTypes} onChange={v => patchData({ animType: v })}/></Field>}
      <Field label="循环播放"><Switch size="sm" aria-label="循环播放" checked={widgetData.animLoop !== false}
        onCheckedChange={checked => patchData({ animLoop: checked })}/></Field>
      <NumberField label="单个轮播后停留时长（秒）" value={Number(widgetData.interval) || 3} min={1} max={60}
        onChange={v => typeof v === "number" && patchData({ interval: v })}/>
    </section></Panel>}
    {/* 山海鲸「基础PDF」：文件地址 / 加载时颜色 / 按钮大小 / 按钮字体 / 点击切换下一页 */}
    {w.kind === "pdf" && <Panel header="PDF 设置" itemKey="media"><section className="property-section">
      <Field label="文件地址">
        <Input className="h-7 text-xs" aria-label="文件地址" placeholder="https://… 或 /media/xxx.pdf" key={`${node.id}-${String(widgetData.src ?? "")}`}
          defaultValue={String(widgetData.src ?? "")} onBlur={e => patchData({ src: e.target.value.trim() })}/>
      </Field>
      <ColorField label="加载时颜色" value={String(widgetData.loadingColor ?? "#14283d")} onChange={color => patchData({ loadingColor: color })}/>
      <NumberField label="按钮大小 (px)" value={Number(widgetData.buttonSize ?? 28)} min={16} max={120} onChange={v => patchData({ buttonSize: v })}/>
      <NumberField label="按钮字号 (px)" value={Number(widgetData.buttonFontSize ?? 13)} min={8} max={48} onChange={v => patchData({ buttonFontSize: v })}/>
      <ColorField label="按钮字体颜色" value={String(widgetData.buttonFontColor ?? "#ffffff")} onChange={color => patchData({ buttonFontColor: color })}/>
      <Field label="点击切换下一页"><Switch size="sm" aria-label="点击切换下一页" checked={widgetData.clickNext === true}
        onCheckedChange={checked => patchData({ clickNext: checked })}/></Field>
    </section></Panel>}
    {isChart && <ChartProperties key={node.id} node={chartNode} patchChart={patch => activeState
        ? post({ type: "patchChartState", id: node.id, stateId: activeState.id, patch })
        : post({ type: "patchChart", id: node.id, patch })}/>}
    {isChart && positionPanel}
    {hasText && <Panel header="文本设置" itemKey="text"><section className="property-section">
      <ColorField label={isChartWidget(w.kind) ? "文字 / 图表颜色" : "文字颜色"} value={node.color} disabled={node.locked} onChange={color => post({ type: "color", id: node.id, color })}/>
      <Field label="字体"><SelectField label="字体" value={w.fontFamily} options={widgetFontFamilies} onChange={v => patchWidget({ fontFamily: String(v) })}/></Field>
      <Field label="字号"><NumberInput size="small" min={8} max={200} value={w.fontSize} aria-label="字号" onChange={v => typeof v === "number" && patchWidget({ fontSize: v })}/></Field>
      <Field label="字重"><SelectField label="字重" value={String(w.fontWeight)}
        options={widgetFontWeights.map(weight => ({ value: String(weight.value), label: weight.label }))}
        onChange={v => patchWidget({ fontWeight: Number(v) })}/></Field>
      <Field label="斜体"><Switch size="sm" aria-label="斜体" checked={w.italic} onCheckedChange={checked => patchWidget({ italic: checked })}/></Field>
      <Field label="下划线"><Switch size="sm" aria-label="下划线" checked={w.underline} onCheckedChange={checked => patchWidget({ underline: checked })}/></Field>
      <Field label="对齐方式"><SelectField label="文本对齐" value={w.align} options={[{ value: "left", label: "左对齐" }, { value: "center", label: "居中" }, { value: "right", label: "右对齐" }]} onChange={v => patchWidget({ align: v as WidgetConfig["align"] })}/></Field>
      <NumberField label="行高 (0 为默认)" value={w.lineHeight} min={0} max={3} step={.1} onChange={v => patchWidget({ lineHeight: v })}/>
      <NumberField label="字间距 (0 为默认)" value={w.letterSpacing} min={-20} max={120} onChange={v => patchWidget({ letterSpacing: v })}/>
    </section></Panel>}
    <Panel header="背景设置" itemKey="background"><section className="property-section">
      <ColorField label="组件背景" value={w.background} disabled={node.locked} onChange={background => patchWidget({ background })}/>
    </section></Panel>
    <Panel header="边框设置" itemKey="border"><section className="property-section">
      <Field label="边框样式"><SelectField label="边框样式" value={w.borderStyle} options={widgetBorderStyles} onChange={v => patchWidget({ borderStyle: v as WidgetConfig["borderStyle"] })}/></Field>
      <ColorField label="边框颜色" value={w.borderColor} disabled={node.locked || w.borderStyle === "none"} onChange={borderColor => patchWidget({ borderColor })}/>
      <NumberField label="边框宽度" value={w.borderWidth} min={0} max={40} disabled={node.locked || w.borderStyle === "none"} onChange={v => patchWidget({ borderWidth: v })}/>
      <NumberField label="圆角" value={w.radius} min={0} max={500} disabled={node.locked} onChange={v => patchWidget({ radius: v })}/>
    </section></Panel>
    <Panel header="阴影设置" itemKey="shadow"><section className="property-section">
      <Field label="阴影效果"><Switch size="sm" aria-label="阴影效果" checked={shadowOn}
        onCheckedChange={on => patchWidget(on ? { shadowColor: "#000000b3", shadowBlur: 10, shadowOffsetX: 0, shadowOffsetY: 4 } : { shadowColor: "transparent" })}/></Field>
      {shadowOn && <>
        <ColorField label="阴影颜色" value={w.shadowColor} disabled={node.locked} onChange={shadowColor => patchWidget({ shadowColor })}/>
        <NumberField label="阴影模糊" value={w.shadowBlur} min={0} max={200} disabled={node.locked} onChange={v => patchWidget({ shadowBlur: v })}/>
        <NumberField label="水平偏移" value={w.shadowOffsetX} min={-500} max={500} disabled={node.locked} onChange={v => patchWidget({ shadowOffsetX: v })}/>
        <NumberField label="垂直偏移" value={w.shadowOffsetY} min={-500} max={500} disabled={node.locked} onChange={v => patchWidget({ shadowOffsetY: v })}/>
      </>}
    </section></Panel>
    <Panel header="组件封面" itemKey="widgetcover"><section className="property-section">
      {widgetData.cover ? <img className="board-cover" src={String(widgetData.cover)} alt="组件封面" /> : <p className="properties-note">暂无封面，点击「截屏」截取当前组件画面。</p>}
      <div className="batch-actions"><Button size="sm" disabled={node.locked} onClick={() => {
        captureWidgetCover(node.id).then((cover) => { patchData({ cover }); Toast.success("组件封面已更新"); })
          .catch((error: unknown) => Toast.error(error instanceof Error ? error.message : "截屏失败"));
      }}><Camera/>截屏</Button>
      {widgetData.cover ? <Button size="sm" variant="destructive" disabled={node.locked} onClick={() => patchData({ cover: null })}><DeleteIcon/>清除</Button> : null}</div>
    </section></Panel>
  </Panels>;
}
