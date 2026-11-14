import { useEffect, useMemo, useState, type DragEvent as ReactDragEvent, type ReactNode } from "react";
import { Button, Empty, Toast } from "@douyinfe/semi-ui";

import { Cctv, FileText, Image, Images, Layers, ListVideo, Music, Type, Video } from "lucide-react";
import { BACKGROUND_BOARD_PAGE_ID, FOREGROUND_BOARD_PAGE_ID, dataChangeArrow, dataChangeTrend,
  reportColumnLabel, tableGrid, widgetNode, wordCloudLayout } from "../data/editor";
import { chartRows, chartSvg } from "../data/chartSvg";
import { chartCatalog, chartPaletteNode, usedChartCategories, type ChartCatalogEntry } from "../data/chartCatalog";
import { textCatalog, textPaletteNode, usedTextCategories, type TextCatalogEntry } from "../data/textCatalog";
import { controlCatalog, matchesControlEntry, usedControlCategories, type ControlCatalogEntry } from "../data/controlCatalog";
import { mediaCatalog, usedMediaCategories, type MediaCatalogEntry } from "../data/mediaCatalog";
import { mapCatalog, mapGroupNodes, mapPaletteNode, legacyMapCatalog,
  type LegacyMapCatalogEntry, type MapCatalogEntry } from "../data/mapCatalog";
import { topologyCatalog, usedTopologyCategories } from "../data/topologyCatalog";
import { kitAssetUrl, kitCatalog, kitFamilies, kitNodes, loadKitTemplate, type KitCatalogEntry } from "../data/kitCatalog";
import { MAP_VIEW, loadWorldGeo, mapSvg, onWorldGeo, worldGeoReady } from "../data/mapSvg";
import type { SceneNode } from "../types";
import { getSceneBridge } from "../workers/bridge";
import { twinCatalog } from "../data/catalog";
import { createTemplateScene } from "../data/sceneTemplates";
import { Radio, RadioGroup } from "@douyinfe/semi-ui";
import { deleteUserAsset, readUserAssets, USER_ASSETS_EVENT, type UserAsset } from "../state/userAssets";
import ControlThumb from "./ControlThumb";
import { getState } from "../state/store";
import { kitMetadata } from "../data/kitRuntime";

/** 素材卡拖放 MIME（与 3D 模型的 x-data-wind-model 并列，见 WorkspacePage onDrop）。 */
export const WIDGET_MIME = "application/x-data-wind-widget";
export const KIT_MIME = "application/x-data-wind-kit";

/** 山海鲸式双击容错：双击=两次 click，400ms 内同签名只入画一次，避免同位叠两层。 */
let lastInsert: { signature: string; at: number } | null = null;
function insertOnce<T>(signature: string, post: () => T): T | undefined {
  const now = performance.now();
  if (lastInsert?.signature === signature && now - lastInsert.at < 400) { lastInsert.at = now; return; }
  lastInsert = { signature, at: now };
  return post();
}
function insertWidget(node: Partial<SceneNode> & { type: SceneNode["type"] }): void {
  insertOnce(node.name ?? node.widget?.kind ?? node.type, () => getSceneBridge().post({ type: "add", node }));
}

/** 素材卡拖拽属性：按需构建完整 widget 节点放进 dataTransfer，落点由看板画布换算。 */
function widgetDragProps(build: () => Partial<SceneNode> & { type: SceneNode["type"] }) {
  return {
    draggable: true,
    onDragStart: (event: ReactDragEvent) => {
      event.dataTransfer.setData(WIDGET_MIME, JSON.stringify(build()));
      event.dataTransfer.effectAllowed = "copy";
    },
  };
}

/** 山海鲸「拓扑」分类卡片：缩略图按示例数据画节点连线小图。 */
function TopologyThumb() {
  const node = widgetNode("topology");
  const data = node.data as { nodes?: { id: string; name: string; x: number; y: number }[]; edges?: { from: string; to: string }[] };
  const nodes = data.nodes ?? [], edges = data.edges ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return <svg viewBox="0 0 520 380" className="chart-thumb-svg" aria-hidden="true">
    {edges.map((edge, index) => {
      const a = byId.get(edge.from), b = byId.get(edge.to);
      if (!a || !b) return null;
      return <line key={index} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#3d6a9e" strokeWidth={2} />;
    })}
    {nodes.map((n) => <g key={n.id}>
      <circle cx={n.x} cy={n.y} r={16} fill="#1b3a5c" stroke="#5b9bd5" strokeWidth={2} />
      <text x={n.x} y={n.y + 34} textAnchor="middle" fontSize={12} fill="#9fc6e8">{n.name}</text>
    </g>)}
  </svg>;
}

function TopologyCard({ entry }: { entry: (typeof topologyCatalog)[number] }) {
  return <Button className="chart-card" theme="borderless" type="tertiary" title={`${entry.label} · ${entry.category}`}
    {...widgetDragProps(() => widgetNode(entry.kind))}
    onClick={() => insertWidget(widgetNode(entry.kind))}>
    <span className="chart-thumb"><TopologyThumb /></span>
    <span className="chart-card-name">{entry.label}</span>
  </Button>;
}

/** 卡片缩略图直接用示例数据渲染真实图表，仅用于素材库卡片。 */
function ChartThumb({ entry }: { entry: ChartCatalogEntry }) {
  const node = useMemo(() => chartPaletteNode(entry) as unknown as SceneNode, [entry]);
  const kind = entry.kind;
  if (kind === "metric") return <span className="chart-thumb-metric"><small>{node.widget!.text}</small><strong>{node.widget!.value}<i>{node.widget!.unit}</i></strong></span>;
  if (kind === "table") return <table className="chart-thumb-table" aria-hidden="true"><thead><tr><th>名称</th><th>数值</th></tr></thead>
    <tbody>{chartRows(node).slice(0, 3).map((row, index) => <tr key={index}><td>{row.name}</td><td>{row.value}</td></tr>)}</tbody></table>;
  return <svg viewBox="0 0 400 190" className="chart-thumb-svg" aria-hidden="true" dangerouslySetInnerHTML={{ __html: chartSvg(node) }} />;
}

function ChartCard({ entry }: { entry: ChartCatalogEntry }) {
  return <Button className="chart-card" theme="borderless" type="tertiary" title={`${entry.label} · ${entry.category}`}
    {...widgetDragProps(() => chartPaletteNode(entry))}
    onClick={() => insertWidget(chartPaletteNode(entry))}>
    <span className="chart-thumb"><ChartThumb entry={entry} /></span>
    <span className="chart-card-name">{entry.label}</span>
  </Button>;
}

/** 素材分类 chips：Semi RadioGroup(type=button) 官方分段控件。
 *  is-text 对齐山海鲸纯文字 chip（图表/文本/媒体/控件），默认带框（拓扑/套件）。 */
function PaletteChips({ label, categories, chip, onChange, framed = false }:
  { label: string; categories: readonly string[]; chip: string; onChange: (next: string) => void; framed?: boolean }) {
  return <RadioGroup type="button" buttonSize="small" aria-label={label} value={chip} onChange={(e) => onChange(String(e.target.value))}
    className={`palette-chips-radio ${framed ? "is-framed" : "is-text"}`}>
    {categories.map((name) => <Radio key={name} value={name}>{name}</Radio>)}
  </RadioGroup>;
}

/** chips 状态由面板层持有（拓扑/套件的分组模板条需要与 chips 联动）。 */
type ChipProps = { query: string; chip: string; onChip: (next: string) => void };

function ChartPalette({ query, chip, onChip }: ChipProps) {
  // 搜索时跨全部分类匹配，避免「当前分类内搜不到」的困惑
  const entries = chartCatalog.filter((entry) => (!query || entry.label.includes(query) || entry.category.includes(query))
    && (query || chip === "全部" || entry.category === chip));
  return <>
    <div className="palette-chips" role="tablist" aria-label="图表分类">
      {<PaletteChips label="素材分类" categories={usedChartCategories} chip={chip} onChange={onChip} />}
    </div>
    {entries.length ? <div className="chart-grid">{entries.map((entry) => <ChartCard key={entry.label} entry={entry} />)}</div>
      : <Empty description="暂无匹配组件" />}
  </>;
}

/** 山海鲸「3D」素材分类：子页签 全部/锦绣孪生/3D图表；「锦绣孪生」对应山海鲸「鲸孪生」子库，
 *  收录可整组插入画布的孪生场景模板（模板目录见 data/catalog.ts）。 */
function TwinCard({ entry }: { entry: (typeof twinCatalog)[number] }) {
  return <Button className="chart-card" theme="borderless" type="tertiary" title={`${entry.name} · ${entry.description}`}
    onClick={() => insertOnce(`twin:${entry.id}`, () => getSceneBridge().post({ type: "appendScene", name: entry.name, tree: createTemplateScene(entry.id) }))}>
    <span className="chart-thumb"><img className="twin-thumb-img" src={entry.image} alt={entry.name} loading="lazy" draggable={false} /></span>
    <span className="chart-card-name">{entry.name}</span>
  </Button>;
}

/** 山海鲸「3D」分类无 chips：孪生场景与 3D图表平铺一屏（顺序对齐其实测目录）。 */
function Chart3dPalette({ query }: { query: string }) {
  const twinEntries = twinCatalog.filter((entry) => !query || entry.name.includes(query));
  const entries = chartCatalog.filter((entry) => entry.category === "3D图表")
    .filter((entry) => !query || entry.label.includes(query));
  return <>
    {twinEntries.length + entries.length
      ? <div className="chart-grid">{twinEntries.map((entry) => <TwinCard key={entry.id} entry={entry} />)}
        {entries.map((entry) => <ChartCard key={entry.kind} entry={entry} />)}</div>
      : <Empty description="暂无匹配组件" />}
  </>;
}

/** 文本组件缩略图：用目录预设渲染迷你版真实内容，使用素材库的 tableGrid / wordCloudLayout。 */
function TextThumb({ entry }: { entry: TextCatalogEntry }) {
  const node = useMemo(() => textPaletteNode(entry) as unknown as SceneNode, [entry]);
  const w = node.widget!;
  if (w.kind === "metric") return <span className="text-thumb-metric">{w.value}</span>;
  if (w.kind === "tableBasic" || w.kind === "tableIndex") {
    const { columns, rows } = tableGrid(node);
    return <table className="chart-thumb-table is-grid" aria-hidden="true"><thead><tr>
      {w.kind === "tableIndex" && <th>序号</th>}{columns.map((column, index) => <th key={index}>{column}</th>)}</tr></thead>
      <tbody>{rows.slice(0, 4).map((row, r) => <tr key={r}>{w.kind === "tableIndex" && <td>{r + 1}</td>}
        {columns.map((_, c) => <td key={c}>{row[c] ?? ""}</td>)}</tr>)}</tbody></table>;
  }
  if (w.kind === "report") return <table className="chart-thumb-report" aria-hidden="true">
    <thead><tr><th />{Array.from({ length: 6 }, (_, c) => <th key={c}>{reportColumnLabel(c)}</th>)}</tr></thead>
    <tbody>{Array.from({ length: 4 }, (_, r) => <tr key={r}><th>{r + 1}</th>{Array.from({ length: 6 }, (_, c) => <td key={c} />)}</tr>)}</tbody></table>;
  if (w.kind === "dataChange") {
    const change = String(node.data?.change ?? ""), trend = dataChangeTrend(change);
    return <span className={`text-thumb-change ${trend}`}>{dataChangeArrow[trend]}{change.replace(/^[+-]/, "")}</span>;
  }
  if (w.kind === "text" || w.kind === "textMultiline") return <span className="text-thumb-text">{w.text}</span>;
  if (w.kind === "wordCloud") return <span className="text-thumb-cloud">
    {wordCloudLayout(chartRows(node), 7, 16).map((item, index) =>
      <span key={index} style={{ fontSize: item.size, color: item.color }}>{item.word}</span>)}</span>;
  if (w.kind === "flipCounter") return <span className="board-flip-digits text-thumb-flip">
    {w.value.split("").map((ch, i) => /\d/.test(ch) ? <b key={i}><i>{ch}</i></b> : <em key={i}>{ch}</em>)}</span>;
  return <Type size={40}/>;
}

function TextCard({ entry }: { entry: TextCatalogEntry }) {
  return <Button className="chart-card" theme="borderless" type="tertiary" title={`${entry.label} · ${entry.category}`}
    {...widgetDragProps(() => textPaletteNode(entry))}
    onClick={() => insertWidget(textPaletteNode(entry))}>
    <span className="chart-thumb"><TextThumb entry={entry} /></span>
    <span className="chart-card-name">{entry.label}</span>
  </Button>;
}

function TextPalette({ query, chip, onChip }: ChipProps) {
  // 搜索时跨全部分类匹配，避免「当前分类内搜不到」的困惑
  const entries = textCatalog.filter((entry) => (!query || entry.label.includes(query) || entry.category.includes(query))
    && (query || chip === "全部" || entry.category === chip));
  return <>
    <div className="palette-chips" role="tablist" aria-label="文本分类">
      {<PaletteChips label="素材分类" categories={usedTextCategories} chip={chip} onChange={onChip} />}
    </div>
    {entries.length ? <div className="chart-grid">{entries.map((entry) => <TextCard key={entry.label} entry={entry} />)}</div>
      : <Empty description="暂无匹配组件" />}
  </>;
}

function ControlCard({ entry }: { entry: ControlCatalogEntry }) {
  return <Button className="control-card" theme="borderless" type="tertiary" title={`${entry.label} · ${entry.category}`}
    {...widgetDragProps(() => widgetNode(entry.kind))}
    onClick={() => insertWidget(widgetNode(entry.kind))}>
    <span className="control-card-preview"><ControlThumb kind={entry.kind} /></span>
    <span className="control-card-name">{entry.label}</span>
  </Button>;
}

function ControlPalette({ query, chip, onChip }: ChipProps) {
  // 搜索时跨全部分类匹配，避免「当前分类内搜不到」的困惑
  const entries = controlCatalog.filter((entry) => matchesControlEntry(entry, query)
    && (query || chip === "全部" || entry.category === chip));
  return <>
    <div className="palette-chips" role="tablist" aria-label="控件分类">
      {<PaletteChips label="素材分类" categories={usedControlCategories} chip={chip} onChange={onChip} />}
    </div>
    {entries.length ? <div className="chart-grid">{entries.map((entry) => <ControlCard key={entry.kind} entry={entry} />)}</div>
      : <Empty description="暂无匹配组件" />}
  </>;
}

/** 媒体缩略图：与控件卡片同风格的银灰大图标（顺序对齐山海鲸「媒体」分类）。 */
function MediaThumb({ entry }: { entry: MediaCatalogEntry }) {
  const icon = entry.kind === "image" ? <Image size={40}/> : entry.kind === "video" ? <Video size={40}/>
    : entry.kind === "monitor" ? <Cctv size={40}/> : entry.kind === "carousel" ? <Images size={40}/>
    : entry.kind === "carouselVideo" ? <ListVideo size={40}/> : entry.kind === "pdf" ? <FileText size={40}/>
    : <Music size={40}/>;
  return <span className="control-thumb-icon">{icon}</span>;
}

function MediaCard({ entry }: { entry: MediaCatalogEntry }) {
  return <Button className="chart-card" theme="borderless" type="tertiary" title={`${entry.label} · ${entry.category}`}
    {...widgetDragProps(() => widgetNode(entry.kind))}
    onClick={() => insertWidget(widgetNode(entry.kind))}>
    <span className="chart-thumb"><MediaThumb entry={entry} /></span>
    <span className="chart-card-name">{entry.label}</span>
  </Button>;
}

function MediaPalette({ query, chip, onChip }: ChipProps) {
  // 搜索时跨全部分类匹配，避免「当前分类内搜不到」的困惑
  const entries = mediaCatalog.filter((entry) => (!query || entry.label.includes(query) || entry.category.includes(query))
    && (query || chip === "全部" || entry.category === chip));
  return <>
    <div className="palette-chips" role="tablist" aria-label="媒体分类">
      {<PaletteChips label="素材分类" categories={usedMediaCategories} chip={chip} onChange={onChip} />}
    </div>
    {entries.length ? <div className="chart-grid">{entries.map((entry) => <MediaCard key={entry.kind} entry={entry} />)}</div>
      : <Empty description="暂无匹配组件" />}
  </>;
}

/** 地理数据就绪订阅：首次加载完成后触发重渲染，缩略图与画布共用。 */
function useWorldGeo(): boolean {
  const [ready, setReady] = useState(worldGeoReady());
  useEffect(() => {
    setReady(worldGeoReady());
    return onWorldGeo(() => setReady(true));
  }, []);
  useEffect(() => { void loadWorldGeo(); }, []);
  return ready;
}

/** 旧「数据图层」缩略图：示例数据实时渲染（与画布同源 mapSvg）。 */
function LegacyMapThumb({ entry }: { entry: LegacyMapCatalogEntry }) {
  const ready = useWorldGeo();
  const node = useMemo(() => widgetNode(entry.kind) as unknown as SceneNode, [entry.kind]);
  if (!ready) return <span className="board-map-loading">加载中…</span>;
  return <svg viewBox={`0 0 ${MAP_VIEW.width} ${MAP_VIEW.height}`} className="chart-thumb-svg" aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: mapSvg(node) ?? "" }} />;
}

function LegacyMapCard({ entry }: { entry: LegacyMapCatalogEntry }) {
  return <Button className="chart-card" theme="borderless" type="tertiary" title={`${entry.label} · ${entry.category}`}
    {...widgetDragProps(() => widgetNode(entry.kind))}
    onClick={() => insertWidget(widgetNode(entry.kind))}>
    <span className="chart-thumb"><LegacyMapThumb entry={entry} /></span>
    <span className="chart-card-name">{entry.label}</span>
  </Button>;
}

/** 山海鲸「地图」分类卡片：图片缩略图（自产 webp）+「基」角标；分组卡整组插入（仿套件，不支持拖拽）。 */
function MapCard({ entry }: { entry: MapCatalogEntry }) {
  const insert = () => insertOnce(`map:${entry.label}`, () => {
    if (entry.group) getSceneBridge().post({ type: "insertKit", nodes: mapGroupNodes(entry) });
    else getSceneBridge().post({ type: "add", node: mapPaletteNode(entry) as SceneNode });
  });
  return <Button className="chart-card" theme="borderless" type="tertiary" title={`${entry.label} · ${entry.category}`}
    {...(entry.group ? {} : widgetDragProps(() => mapPaletteNode(entry)))}
    onClick={insert}>
    <span className="chart-thumb map-thumb">
      <img className="twin-thumb-img" src={entry.image} alt={entry.label} loading="lazy" draggable={false} />
      {entry.base ? <span className="map-base-badge" title="基础版可用"><i>基</i></span> : null}
    </span>
    <span className="chart-card-name">{entry.label}</span>
  </Button>;
}

/** 山海鲸「地图」分类无 chips：16 张地图平铺；搜索时追加旧「数据图层」匹配项。 */
function MapPalette({ query }: { query: string }) {
  const entries = mapCatalog.filter((entry) => !query || entry.label.includes(query) || entry.category.includes(query));
  const legacy = query ? legacyMapCatalog.filter((entry) => entry.label.includes(query)) : [];
  return <>
    {entries.length + legacy.length
      ? <div className="chart-grid">{entries.map((entry) => <MapCard key={entry.label} entry={entry} />)}
        {legacy.map((entry) => <LegacyMapCard key={entry.kind} entry={entry} />)}</div>
      : <Empty description="暂无匹配组件" />}
  </>;
}

/** 山海鲸「拓扑」素材分类：节点连线拓扑图（渲染见 Rust board/widgets.rs "topology"）；
 *  chips 为带框样式，左侧另有分组模板条（AssetFamilyStrip）。 */
function TopologyPalette({ query, chip, onChip }: ChipProps) {
  const entries = topologyCatalog.filter((entry) => (!query || entry.label.includes(query) || entry.category.includes(query))
    && (query || chip === "全部" || entry.category === chip));
  return <>
    <div className="palette-chips" role="tablist" aria-label="拓扑分类">
      {<PaletteChips label="素材分类" categories={usedTopologyCategories} chip={chip} onChange={onChip} framed />}
    </div>
    {entries.length ? <div className="chart-grid">{entries.map((entry) => <TopologyCard key={entry.label} entry={entry} />)}</div>
      : <Empty description="暂无匹配组件" />}
  </>;
}

/** Suite cards use their original thumbnails; insertion loads the complete editable layer tree. */
export async function insertKitEntry(entry: KitCatalogEntry, origin?: { x: number; y: number }) {
  const state = getState();
  const pageId = state.boardLayer === "background" ? BACKGROUND_BOARD_PAGE_ID
    : state.boardLayer === "foreground" ? FOREGROUND_BOARD_PAGE_ID : state.settings.boardActivePageId;
  const template = await loadKitTemplate(entry);
  if (state.projectId !== getState().projectId) return false;
  const size = template.options?.size;
  const width = Array.isArray(size) ? Number(size[0]) || 300 : 300;
  const height = Array.isArray(size) ? Number(size[1]) || 64 : 64;
  const at = origin ? { x: origin.x - width / 2, y: origin.y - height / 2 }
    : { x: Math.max(0, (state.boardSize.width - width) / 2), y: Math.max(0, (state.boardSize.height - height) / 2) };
  const nodes = kitNodes(entry, template, at).map(node => ({ ...node, boardPageId: pageId }));
  if (getState().scene.length + nodes.length > 4096) throw new Error("组件数量超出看板上限");
  getSceneBridge().post({ type: "insertKit", nodes });
  return true;
}
function KitCard({ entry, onInsert }: { entry: KitCatalogEntry; onInsert?: () => void }) {
  const [loading, setLoading] = useState(false);
  const insert = () => insertOnce(`kit:${entry.id}`, async () => {
    if (loading) return;
    setLoading(true);
    try { if (await insertKitEntry(entry)) onInsert?.(); }
    catch (error) { Toast.error(error instanceof Error ? error.message : "套件加载失败，请重试"); }
    finally { setLoading(false); }
  });
  return <Button className="chart-card kit-card" theme="borderless" type="tertiary" loading={loading}
    title={`${entry.label} · ${entry.familyLabel}`} draggable={!loading}
    onDragStart={event => { event.dataTransfer.setData(KIT_MIME, entry.id); event.dataTransfer.effectAllowed = "copy"; }}
    onClick={insert}>
    <span className="chart-thumb kit-thumb"><img src={kitAssetUrl(entry.thumbnail)} alt="" loading="lazy" draggable={false} /></span>
    <span className="chart-card-name">{entry.label}</span>
  </Button>;
}
function KitPalette({ query, chip, onChip, familyId, onInsert }: ChipProps & { familyId: string; onInsert?: () => void }) {
  const family = kitFamilies.find(item => item.id === familyId) ?? kitFamilies[0]!;
  const entries = (query ? kitCatalog : family.entries).filter(entry =>
    (!query || `${entry.label} ${entry.familyLabel} ${entry.categories.join(" ")}`.includes(query))
    && (query || chip === "全部" || entry.categories.includes(chip)));
  return <>
    <div className="palette-chips" role="tablist" aria-label="套件分类">
      <PaletteChips label="素材分类" categories={family.categories} chip={chip} onChange={onChip} framed />
    </div>
    {entries.length ? <div className="chart-grid">{entries.map(entry => <KitCard key={entry.id} entry={entry} onInsert={onInsert}/>)}</div>
      : <Empty description="暂无匹配组件" />}
  </>;
}
/** Theme families and component categories are independent, as in the reference library. */
export function AssetFamilyStrip({ category, chip, onChip, familyId, onFamily }:
  { category: "拓扑" | "套件"; chip: string; onChip: (next: string) => void;
    familyId?: string; onFamily?: (next: string) => void }) {
  if (category === "套件") return <aside className="asset-family-strip kit-family-strip" aria-label="套件主题">
    {kitFamilies.map(family => <button key={family.id} type="button" aria-pressed={familyId === family.id}
      className={`asset-family-item ${familyId === family.id ? "is-active" : ""}`} title={family.label}
      onClick={() => { onFamily?.(family.id); onChip("全部"); }}>
      <span className="asset-family-thumb"><img src={kitAssetUrl(family.thumbnail)} alt="" loading="lazy" draggable={false}/></span>
      <span className="asset-family-name">{family.label}</span>
    </button>)}
  </aside>;
  return <aside className="asset-family-strip" aria-label="拓扑分组">
    {usedTopologyCategories.filter(name => name !== "全部").map(group =>
      <button key={group} type="button" className={`asset-family-item ${chip === group ? "is-active" : ""}`}
        title={group} onClick={() => onChip(group)}>
        <span className="asset-family-thumb"><TopologyThumb /></span>
        <span className="asset-family-name">{group}</span>
      </button>)}
  </aside>;
}

/** 资产库 tab：右键「添加到资产库」保存的用户素材，点击重新加入画布，× 删除素材。 */
export function BoardAssetLibrary({ query }: { query: string }) {
  const [assets, setAssets] = useState<UserAsset[]>(() => readUserAssets());
  useEffect(() => {
    const update = () => setAssets(readUserAssets());
    window.addEventListener(USER_ASSETS_EVENT, update);
    return () => window.removeEventListener(USER_ASSETS_EVENT, update);
  }, []);
  const filtered = assets.filter((asset) => !query || asset.name.includes(query));
  if (!filtered.length) return <div className="component-palette"><Empty description="暂无资产，选中组件后右键「添加到资产库」保存" /></div>;
  const add = (asset: UserAsset) => {
    const roots = asset.tree.filter((n) => !asset.tree.some((p) => p.id === n.parentId));
    if (asset.tree.some(kitMetadata)) getSceneBridge().post({ type: "insertKit", nodes: asset.tree.map(node => ({ ...node, boardPageId: undefined })) });
    else if (roots.length === 1 && asset.tree.length === 1) getSceneBridge().post({ type: "add", node: structuredClone(roots[0]) });
    else getSceneBridge().post({ type: "appendScene", name: asset.name, tree: structuredClone(asset.tree) });
  };
  return <div className="component-palette">
    <div className="chart-grid">{filtered.map((asset) => <div key={asset.id} className="user-asset-card" role="button" tabIndex={0}
      title={`${asset.name} · 点击添加到画布`} onClick={() => add(asset)}
      onKeyDown={(e) => { if (["Enter", " "].includes(e.key)) { e.preventDefault(); add(asset); } }}>
      <span className="chart-thumb"><Layers size={20} aria-hidden="true" /></span>
      <span className="chart-card-name">{asset.name}</span>
      <button className="user-asset-delete" aria-label={`删除素材 ${asset.name}`}
        onClick={(e) => { e.stopPropagation(); deleteUserAsset(asset.id); }}>×</button>
    </div>)}</div>
  </div>;
}

/** 看板素材面板主体：搜索与 chips 状态由面板层（WorkspacePage）持有，
 *  排版对齐山海鲸（docs/board-asset-panel-sync.md）——本组件只渲染 chips + 网格。 */
export function ComponentPalette({ category, query, chip, onChip, kitFamilyId = "free", onKitInsert }:
  { category: string; query: string; chip: string; onChip: (next: string) => void; kitFamilyId?: string; onKitInsert?: () => void }) {
  const q = query.trim();
  let body: ReactNode;
  if (category === "图表") body = <ChartPalette query={q} chip={chip} onChip={onChip} />;
  else if (category === "3D") body = <Chart3dPalette query={q} />;
  else if (category === "文本") body = <TextPalette query={q} chip={chip} onChip={onChip} />;
  else if (category === "控件") body = <ControlPalette query={q} chip={chip} onChip={onChip} />;
  else if (category === "媒体") body = <MediaPalette query={q} chip={chip} onChip={onChip} />;
  else if (category === "地图") body = <MapPalette query={q} />;
  else if (category === "拓扑") body = <TopologyPalette query={q} chip={chip} onChip={onChip} />;
  else if (category === "套件") body = <KitPalette query={q} chip={chip} onChip={onChip} familyId={kitFamilyId} onInsert={onKitInsert}/>;
  else if (category === "全部") {
    // 山海鲸「全部」= 无 chips、无小节标题的单一扁平网格，顺序与素材 rail 一致
    const chartEntries = chartCatalog.filter((entry) => entry.category !== "3D图表" && (!q || entry.label.includes(q) || entry.category.includes(q)));
    const chart3dEntries = chartCatalog.filter((entry) => entry.category === "3D图表" && (!q || entry.label.includes(q) || entry.category.includes(q)));
    const twinEntries = twinCatalog.filter((entry) => !q || entry.name.includes(q));
    const textEntries = textCatalog.filter((entry) => !q || entry.label.includes(q) || entry.category.includes(q));
    const controlEntries = controlCatalog.filter((entry) => matchesControlEntry(entry, q));
    const mediaEntries = mediaCatalog.filter((entry) => !q || entry.label.includes(q) || entry.category.includes(q));
    const mapEntries = mapCatalog.filter((entry) => !q || entry.label.includes(q) || entry.category.includes(q));
    const topologyEntries = topologyCatalog.filter((entry) => !q || entry.label.includes(q) || entry.category.includes(q));
    const kitEntries = kitCatalog.filter((entry) => !q || entry.label.includes(q) || entry.category.includes(q));
    const total = chartEntries.length + chart3dEntries.length + twinEntries.length + textEntries.length + controlEntries.length
      + mediaEntries.length + mapEntries.length + topologyEntries.length + kitEntries.length;
    body = total ? <div className="chart-grid">
      {chartEntries.map((entry) => <ChartCard key={entry.label} entry={entry} />)}
      {textEntries.map((entry) => <TextCard key={entry.label} entry={entry} />)}
      {controlEntries.map((entry) => <ControlCard key={entry.kind} entry={entry} />)}
      {mediaEntries.map((entry) => <MediaCard key={entry.kind} entry={entry} />)}
      {mapEntries.map((entry) => <MapCard key={entry.label} entry={entry} />)}
      {chart3dEntries.map((entry) => <ChartCard key={`3d-${entry.kind}`} entry={entry} />)}
      {twinEntries.map((entry) => <TwinCard key={entry.id} entry={entry} />)}
      {topologyEntries.map((entry) => <TopologyCard key={entry.label} entry={entry} />)}
      {kitEntries.map((entry) => <KitCard key={entry.id} entry={entry} onInsert={onKitInsert}/>)}
    </div> : <Empty description="暂无匹配组件" />;
  } else {
    body = <Empty description="暂无匹配组件" />;
  }
  return <div className="component-palette">{body}</div>;
}
export { BoardOverlay } from "./BoardOverlay";
