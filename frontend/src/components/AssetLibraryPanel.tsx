import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Button, Empty, Input, Toast, Tooltip } from "@douyinfe/semi-ui";
import { Cube, FullScreen, Layers, Plus, Search, ViewGridList } from "@icon-park/react";
import { importModelFiles, modelAssetSceneNode } from "../engine/modelAsset";
import { deleteModelAsset, getModelAsset, saveModelAsset, type ModelAssetMeta } from "../state/modelAssets";
import { modelAssetError, useModelAssets } from "./ModelAssetLibrary";
import { getAssetsBridge, getSceneBridge } from "../workers/bridge";
import type { AssetItem } from "../workers/assets.worker";
import { buildAssetFolders, childChips, matchesAssetFolder, type AssetFolder } from "../data/assetGroups";
import { getState, setState, useStore } from "../state/store";
import { primitiveNode } from "../engine/primitives";
import { modelAssetById } from "../data/modelCatalog";
import { modelNode } from "../data/modelNode";
import { createTemplateScene } from "../data/sceneTemplates";
import { MAX_WATERS, MAX_SHALLOW_WATERS, waterNode } from "../data/water";
import { MAX_TERRAINS, terrainNode } from "../data/terrain";
import { deleteUserAsset, readUserAssets, USER_ASSETS_EVENT, type UserAsset } from "../state/userAssets";

const featuredModels = ["medical-23602", "medical-23588", "medical-23604", "medical-23610", "medical-23589"];

/** 山海鲸 3D 编辑里不带三级分类 chips 的栏目（GIS/地表/动效/场景 的子分类仍从左侧子栏进入） */
const chipsOffGroups = new Set(["GIS", "地表", "动效", "场景"]);

/** 3D 编辑公共栏：搜索 + 「资源库 / 资产库」切换（山海鲸 3D 编辑同款） */
export default function AssetLibraryPanel({ category, libraryExpanded, onToggleLibrary, onClose }: {
  category: string; libraryExpanded: boolean; onToggleLibrary: () => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<"resource" | "asset">("resource");
  const [query, setQuery] = useState("");
  return <>
    <div className="library-common-bar">
      <Input className="library-search" size="small" prefix={<Search />} placeholder="搜索组件" value={query}
        onChange={setQuery} showClear aria-label="搜索组件" />
      <div className="library-switch" role="tablist" aria-label="素材库切换">
        <button type="button" role="tab" aria-selected={tab === "resource"} className={tab === "resource" ? "is-active" : ""}
          onClick={() => setTab("resource")}>资源库</button>
        <button type="button" role="tab" aria-selected={tab === "asset"} className={tab === "asset" ? "is-active" : ""}
          onClick={() => setTab("asset")}>资产库</button>
      </div>
      <div className="library-bar-actions">
        <Tooltip content={libraryExpanded ? "收起资源库" : "展开资源库"}><span><Button size="small" theme="borderless" icon={<FullScreen />}
          aria-label={libraryExpanded ? "收起资源库" : "展开资源库"} onClick={onToggleLibrary} /></span></Tooltip>
        <Button size="small" theme="borderless" aria-label="关闭资源库" onClick={onClose}>×</Button>
      </div>
    </div>
    <div className="asset-library-body">
      {tab === "resource" ? <ResourceLibrary key={category} category={category} query={query} />
        : <UserAssetLibrary query={query} />}
    </div>
  </>;
}

interface SubEntry { key: string; label: string }
interface SubSection { header?: string; entries: SubEntry[] }

/** 山海鲸「模型」分类的二级栏目：导入模型 → 基础模型 → 模型库 → 模型套件（山海鲸 4.7.13 实测顺序） */
const modelBasicOrder = ["AI建模", "形状", "参数化模型"];
const modelLibraryOrder = ["植被", "建筑物", "交通工具", "室外装饰", "家具装饰", "设备", "交通设施", "人和动物", "环境", "3D地图", "商品样品", "精灵图", "全景天空"];
const modelKitOrder = ["医疗设备", "交通套件", "农业基础", "工业套件", "室内家具", "机房套件", "军事模型", "农作物"];
/** 山海鲸有栏目但我们暂无内容的静态占位（点击显示空状态，随内容扩充自动替换为真实分组） */
const staticFolderLabels = new Set(["AI建模", "参数化模型", "3D地图", "商品样品", "精灵图", "全景天空",
  "交通套件", "农业基础", "工业套件", "室内家具", "机房套件", "军事模型", "农作物"]);
export const isStaticFolderKey = (key: string) => key.startsWith("static:");
const staticEntry = (label: string): SubEntry => ({ key: `static:${label}`, label });

function resourceSections(category: string, folders: AssetFolder[]): SubSection[] {
  if (category === "地表") {
    const entries = folders.flatMap((folder) => folder.children.length ? folder.children : [folder]);
    const rank = (label: string) => label === "水体" ? 0 : label === "地形" ? 1 : 2;
    entries.sort((a, b) => rank(a.label) - rank(b.label));
    return [{ entries: entries.map(({ key, label }) => ({ key, label })) }];
  }
  if (category === "模型") {
    const byLabel = new Map(folders.map((entry) => [entry.key === "group:医疗" ? "医疗设备" : entry.label === "基础形状" ? "形状" : entry.label, entry]));
    const ordered = (labels: string[]) => labels.map((label) => {
      const real = byLabel.get(label);
      return real ? { key: real.key, label } : staticEntry(label);
    });
    return [
      { entries: [{ key: "import", label: "导入模型" }] },
      { header: "基础模型", entries: ordered(modelBasicOrder) },
      { header: "模型库", entries: ordered(modelLibraryOrder) },
      { header: "模型套件", entries: ordered(modelKitOrder) },
    ];
  }
  if (folders.length === 1 && folders[0]!.children.length)
    return [{ header: folders[0]!.label, entries: folders[0]!.children.map((child) => ({ key: child.key, label: child.label })) }];
  return [{ entries: folders.map((entry) => ({ key: entry.key, label: entry.label })) }];
}

function ResourceLibrary({ category, query }: { category: string; query: string }) {
  const scoped = category === "全部" ? null : [category];
  const { assets: importedModels, error: modelError } = useModelAssets();
  const [items, setItems] = useState<AssetItem[]>([]);
  const [allItems, setAllItems] = useState<AssetItem[]>([]);
  const [folder, setFolder] = useState(category === "模型" ? "import" : category === "地表"
    ? `child:${encodeURIComponent("地表")}:${encodeURIComponent("水体")}` : "all");
  const [busy, setBusy] = useState(false);
  const queryRef = useRef(query);
  queryRef.current = query;
  const filesRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const bridge = getAssetsBridge();
    return bridge.subscribe((received, result) => {
      if (!received) setAllItems(result);
      if (received === queryRef.current) setItems(result);
    });
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => getAssetsBridge().search(query), 120);
    return () => window.clearTimeout(timer);
  }, [query]);
  const folders = useMemo(() => buildAssetFolders(allItems, scoped), [allItems, scoped]);
  const sections = useMemo(() => resourceSections(category, folders), [category, folders]);
  const q = query.trim();
  const imported = importedModels.filter((asset) => !q || asset.name.toLowerCase().includes(q.toLowerCase()));
  /** 三级分类 chips：选中二级栏目（group:）或其子分类（child:）时显示该栏目下的子分类过滤行（山海鲸 3D 编辑同款，含空分类占位） */
  const groupKeyOfFolder = folder.startsWith("group:") ? folder
    : folder.startsWith("child:") ? `group:${folder.split(":")[1] ?? ""}` : "";
  const activeGroup = groupKeyOfFolder ? folders.find((entry) => entry.key === groupKeyOfFolder) : undefined;
  const chips = activeGroup ? childChips(activeGroup) : [];
  const findLabel = (entries: AssetFolder[]): string | undefined => {
    for (const entry of entries) {
      if (entry.key === folder) return entry.label;
      const found = findLabel(entry.children);
      if (found) return found;
    }
    return undefined;
  };
  const filtered = items.filter((item) => matchesAssetFolder(item, scoped, folder));
  if (folder === "all" && ["3D", "模型"].includes(category) && !q) {
    const rank = (item: AssetItem) => {
      const index = featuredModels.indexOf(item.modelId ?? "");
      return index >= 0 ? index : item.category.startsWith("医疗") ? featuredModels.length : featuredModels.length + 1;
    };
    filtered.sort((a, b) => rank(a) - rank(b));
  }
  const state = useStore();
  const selected = state.scene.find((node) => node.id === state.selectedId);
  const importFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const { bytes, sourceName } = await importModelFiles(files);
      const asset = await saveModelAsset(bytes, sourceName);
      Toast.success(`“${asset.name}”已保存到资源库`);
    } catch (failure) { Toast.error(modelAssetError(failure)); }
    finally { setBusy(false); }
  };
  const addImported = (asset: ModelAssetMeta) => {
    void getModelAsset(asset.id).then((bytes) => getSceneBridge().post({ type: "add", node: modelAssetSceneNode(bytes, asset.name) }))
      .catch((error: unknown) => Toast.error(modelAssetError(error)));
  };
  const addAsset = (item: AssetItem) => {
    const bridge = getSceneBridge();
    if (item.type === "water") {
      const scene = getState().scene;
      if (scene.filter((n) => n.type === "water").length >= MAX_WATERS) { Toast.info(`最多添加 ${MAX_WATERS} 个水体`); return; }
      if (item.waterPreset === "shallow" && scene.filter((n) => n.water?.preset === "shallow").length >= MAX_SHALLOW_WATERS) { Toast.info(`最多添加 ${MAX_SHALLOW_WATERS} 个浅水模拟`); return; }
      bridge.post({ type: "add", node: waterNode(item.waterPreset) });
      return;
    }
    if (item.type === "terrain") {
      if (getState().scene.filter((n) => n.type === "terrain").length >= MAX_TERRAINS) { Toast.info(`最多添加 ${MAX_TERRAINS} 块地形`); return; }
      bridge.post({ type: "add", node: terrainNode(item.terrainPreset) });
      return;
    }
    if (item.primitive) { bridge.post({ type: "add", node: primitiveNode(item.primitive) }); return; }
    if (item.type === "material") {
      const node = getState().scene.find((entry) => entry.id === getState().selectedId);
      if (!node || node.type === "group") { Toast.info("请先选中要套用颜色的对象"); return; }
      if (node.locked) { Toast.info("请先解锁对象"); return; }
      bridge.post({ type: "color", id: node.id, color: item.color });
      return;
    }
    if (item.type === "scene") {
      if (item.templateId) bridge.post({ type: "appendScene", name: item.name, tree: createTemplateScene(item.templateId) });
      return;
    }
    if (item.type === "flyline") setState({ hud: { ...getState().hud, flylines: true } });
    const model = item.modelId ? modelAssetById.get(item.modelId) : undefined;
    const xyz = (value: [number, number, number]) => ({ x: value[0], y: value[1], z: value[2] });
    bridge.post({ type: "add", node: model ? modelNode(model) : {
      type: item.type, name: item.name, color: item.color,
      ...(item.position ? { transform: { position: xyz(item.position), rotation: xyz([0, 0, 0]), scale: xyz([1, 1, 1]) } } : {}),
      ...(item.size ? { boxSize: xyz(item.size) } : {}), ...(item.to ? { to: xyz(item.to) } : {}),
    } });
  };
  const folderLabel = folder === "import" ? "导入模型"
    : folder === "all" ? (["3D", "模型"].includes(category) ? "全部模型" : "全部素材")
      : isStaticFolderKey(folder) ? folder.slice("static:".length)
        : findLabel(folders) ?? "全部素材";
  const hint = category === "材质" ? "选中对象后点击套用" : category === "场景" ? "整组添加 · 支持撤销" : "点击添加 · 模型可拖入";
  const importedCards = imported.map((asset) =>
    <Button key={asset.id} className="asset-card" theme="borderless" type="tertiary"
      title={`${asset.name} · ${asset.triangles} 个三角面`} onClick={() => addImported(asset)}>
      <span className="asset-thumbnail" style={{ "--asset-color": "#e5ac72" } as React.CSSProperties}><Cube size={40} /></span>
      <span className="asset-card-name">{asset.name}</span><small className="asset-card-type">我的模型</small>
      <button className="asset-card-delete" aria-label={`删除模型 ${asset.name}`}
        onClick={(event) => { event.stopPropagation(); void deleteModelAsset(asset.id).catch((failure: unknown) => Toast.error(modelAssetError(failure))); }}>×</button>
    </Button>);
  return <>
    <aside className="asset-subcolumn" aria-label="资源子分类">
      {sections.map((section, index) => <Fragment key={section.header ?? `section-${index}`}>
        {section.header && <div className="asset-subsection"><ViewGridList size={12} />{section.header}</div>}
        {section.entries.map((entry) =>
          <button key={entry.key} type="button" className={`asset-subitem ${folder === entry.key ? "is-active" : ""}`}
            onClick={() => setFolder(entry.key)}>
            <span className="asset-subitem-label">{entry.label}</span>
            <span className="asset-subitem-arrow" aria-hidden="true">›</span>
          </button>)}
      </Fragment>)}
    </aside>
    <div className="asset-results">
      {folder === "import" ? <>
        <div className="asset-results-heading"><strong>导入模型</strong><span>{imported.length} 个模型</span></div>
        <div className="asset-results-hint">支持 Blender 导出的 GLB / glTF / OBJ，关联 .bin、.mtl 与贴图需一并选择，导入后保存在资源库</div>
        <div className="asset-grid">
          <button type="button" className="model-import-dashed" disabled={busy} aria-label="导入模型"
            onClick={() => filesRef.current?.click()}>
            <Plus size={20} /><span>导入模型</span>
          </button>
          {importedCards}
        </div>
        {modelError && <p role="alert" className="model-import-error">{modelError}</p>}
      </> : <>
        {chips.length > 0 && !chipsOffGroups.has(activeGroup?.label ?? "") && <div className="asset-subchips" role="group"
          aria-label={activeGroup ? `${activeGroup.label}子分类` : "子分类"}>
          <button type="button" className={folder === groupKeyOfFolder ? "is-active" : ""}
            onClick={() => setFolder(groupKeyOfFolder)}>全部</button>
          {chips.map((chip) =>
            <button key={chip.key} type="button" className={folder === chip.key ? "is-active" : ""}
              onClick={() => setFolder(chip.key)}>{chip.label}</button>)}
        </div>}
        <div className="asset-results-heading"><strong>{folderLabel}</strong><span>{filtered.length} 个素材</span></div>
        <div className="asset-results-hint">{hint}</div>
        {category === "材质" && <div className="asset-context-note">{selected ? `当前对象：${selected.name}` : "先在画布或图层中选择对象"}<small>颜色预设保留模型原有纹理和明暗</small></div>}
        {category === "GIS" && <div className="asset-context-note">地理轮廓、监测点位与区域图层<small>地理轮廓基于 Natural Earth 本地数据</small></div>}
        {folder === "all" && ["3D", "模型"].includes(category) && imported.length > 0 && <>
          <div className="asset-results-heading"><strong>我的模型</strong><span>点击添加到场景</span></div>
          <div className="asset-grid">{importedCards}</div>
        </>}
        {filtered.length ? <div className="asset-grid">{filtered.map((item) => <Button key={item.id} className="asset-card" theme="borderless" type="tertiary"
          title={`${item.name} · ${item.category}`}
          draggable={item.type === "model" && !item.primitive} onDragStart={(event) => {
            if (item.type === "model") {
              event.dataTransfer.setData("application/x-data-wind-model", item.modelId ?? "@basic-box");
              event.dataTransfer.effectAllowed = "copy";
            }
          }}
          onClick={() => addAsset(item)}><span className="asset-thumbnail" style={{ "--asset-color": item.color } as React.CSSProperties}>
            <AssetPreview item={item} />
          </span><span className="asset-card-name">{item.name}</span><small className="asset-card-type">{item.category.split(" / ")[1] ?? item.category}</small></Button>)}</div>
          : <Empty description="暂无匹配素材" />}
      </>}
      <input hidden ref={filesRef} type="file" multiple accept=".glb,.gltf,.obj,.bin,.mtl,.dwasset,image/*"
        aria-label="选择模型及关联文件" onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void importFiles(files);
        }} />
    </div>
  </>;
}

function AssetPreview({ item }: { item: AssetItem }) {
  if (item.thumbnail) return <img src={item.thumbnail} alt={item.name} loading="lazy" draggable={false} />;
  if (item.type === "material") return <span className="asset-material-sphere" />;
  if (item.type === "water") return <svg viewBox="0 0 120 80" aria-hidden="true" className="asset-vector-preview">
    <path d={item.waterPreset === "river" ? "M18 12C94 17 19 53 100 62L91 74C5 60 73 28 9 24Z" : item.waterPreset === "lake" ? "M12 42C9 18 54 14 88 25S113 62 69 69 16 66 12 42Z" : "M10 33 69 12 113 36 53 64Z"} fill="currentColor" opacity=".8" />
    <g stroke="#b2eff6" strokeWidth="2" fill="none" opacity=".9"><path d="M30 38q8-5 16 0t16 0t16 0"/><path d="M42 49q8-5 16 0t16 0"/></g>
    {item.waterPreset === "shallow" && <g fill="#c7f4ff"><circle cx="43" cy="30" r="3"/><path d="m43 17 4 8h-8Z"/></g>}
    {item.waterPreset === "pool" && <path d="M10 33v9l43 31 60-28v-9M53 64v9" fill="none" stroke="#a6b8c8" strokeWidth="3"/>}
  </svg>;
  if (item.type === "terrain") return <svg viewBox="0 0 120 80" aria-hidden="true" className="asset-vector-preview">
    <path d="m8 57 38 17 65-25-37-16Z" fill="currentColor" opacity=".3" />
    <path d={item.terrainPreset === "flat" ? "m8 53 38 17 65-25-37-16Z" : "m8 53 27-18 12 8 23-33 22 24 19 11-65 25Z"} fill="currentColor" />
    <path d="m47 43 23-33 4 26-28 34Z" fill="#fff" opacity=".18" />
    {item.terrainPreset === "snow" && <path d="m57 29 13-19 15 16-12-4-7 8-3-6Z" fill="#edf4f5" />}
  </svg>;
  if (item.type === "marker") return <svg viewBox="0 0 120 80" aria-hidden="true" className="asset-vector-preview">
    <ellipse cx="60" cy="63" rx="28" ry="9" fill="currentColor" opacity=".12" />
    <ellipse cx="60" cy="63" rx="19" ry="6" fill="none" stroke="currentColor" opacity=".5" />
    <path d="M60 56V29M50 23l10-13 10 13-10 13Z" stroke="currentColor" fill="currentColor" strokeWidth="2" />
  </svg>;
  if (item.type === "flyline") return <svg viewBox="0 0 120 80" aria-hidden="true" className={`asset-vector-preview ${item.library === "动效" ? "is-animated" : ""}`}>
    <ellipse cx="23" cy="63" rx="12" ry="4" fill="currentColor" opacity=".2" />
    <ellipse cx="100" cy="51" rx="12" ry="4" fill="currentColor" opacity=".2" />
    <path d="M23 60Q57-19 100 48" fill="none" stroke="currentColor" strokeWidth="2.5" className="asset-flow-path" />
    <circle cx="23" cy="60" r="3" fill="currentColor" /><circle cx="100" cy="48" r="3" fill="currentColor" />
  </svg>;
  if (item.type === "fence") return <svg viewBox="0 0 120 80" aria-hidden="true" className="asset-vector-preview">
    <path d="m16 48 38 18 49-28-39-16Z" fill="currentColor" opacity=".14" />
    <path d="M16 48V29l38 18v19m0-19 49-28v19M16 29l48-27 39 17" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="m16 48 38 18 49-28" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>;
  return <Cube size={40} />;
}

/** 资产库：右键「添加到资产库」保存的用户素材，点击重新加入场景 */
function UserAssetLibrary({ query }: { query: string }) {
  const [assets, setAssets] = useState<UserAsset[]>(() => readUserAssets());
  useEffect(() => {
    const update = () => setAssets(readUserAssets());
    window.addEventListener(USER_ASSETS_EVENT, update);
    return () => window.removeEventListener(USER_ASSETS_EVENT, update);
  }, []);
  const q = query.trim();
  const filtered = assets.filter((asset) => !q || asset.name.includes(q));
  const add = (asset: UserAsset) => {
    const roots = asset.tree.filter((n) => !asset.tree.some((p) => p.id === n.parentId));
    if (roots.length === 1) getSceneBridge().post({ type: "add", node: structuredClone(roots[0]) });
    else getSceneBridge().post({ type: "appendScene", name: asset.name, tree: structuredClone(asset.tree) });
  };
  return <div className="asset-results">
    <div className="asset-results-heading"><strong>我的素材</strong><span>{filtered.length} 个素材</span></div>
    <div className="asset-results-hint">选中场景对象后右键「添加到资产库」保存 · 点击添加到场景</div>
    {filtered.length ? <div className="asset-grid">{filtered.map((asset) =>
      <Button key={asset.id} className="asset-card" theme="borderless" type="tertiary"
        title={`${asset.name} · 点击添加到场景`} onClick={() => add(asset)}>
        <span className="asset-thumbnail" style={{ "--asset-color": "#8fb7e8" } as React.CSSProperties}><Layers size={40} /></span>
        <span className="asset-card-name">{asset.name}</span><small className="asset-card-type">资产</small>
        <button className="asset-card-delete" aria-label={`删除素材 ${asset.name}`}
          onClick={(event) => { event.stopPropagation(); deleteUserAsset(asset.id); }}>×</button>
      </Button>)}</div>
      : <Empty description="暂无资产，选中场景对象后右键「添加到资产库」保存" />}
  </div>;
}
