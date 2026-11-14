import type { FlatInstance, SceneNode, Vec3 } from "../types";
import { ancestorMatches, boundNode, chartDataWithColor, defaultEditorSettings, descendants, isChartWidget, isStateStyleKey, nodeBounds, rotateVector, sanitizeWidgetStates, selectionRoots, transformedTree, type EditorSettings, type Interaction, type WidgetConfig } from "../data/editor";
import type { DataSourceConfig } from "../data/dataSources";
import { modelAssetById } from "../data/modelCatalog";
import { computeViewOrigin, ZERO_ORIGIN, type ViewOrigin } from "../engine/viewOrigin";
import { decodeSnapshotScene } from "../state/snapshotCodec";
import { validateScene } from "../state/projects";
import { defaultTerrain, MAX_TERRAINS, validateTerrain } from "../data/terrain";
import { defaultWater, MAX_WATERS, MAX_SHALLOW_WATERS, validateWater } from "../data/water";
import { kitMetadata, kitPieceAt, mergeKitStaticData, patchKitOptions, patchKitPrivateData, type ReferenceKitWidget } from "../data/kitRuntime";
import { importKitInteractions } from "../data/kitInteractions";

export interface SceneSnapshot {
  projectId: string | null;
  revision: number;
  loadError?: string;
  tree: SceneNode[];
  flat: FlatInstance[];
  /** 场景加载时定下的渲染原点；flat 仍是世界坐标，平移发生在同步给引擎的边界 */
  viewOrigin: ViewOrigin;
  selectedId: string | null;
  selectedIds: string[];
  settings: EditorSettings;
  undoLabels: string[];
  redoLabels: string[];
  canUndo: boolean;
  canRedo: boolean;
}

export type SceneMessage =
  | ({ type: "sceneChanged" } & SceneSnapshot)
  | { type: "selectionChanged"; projectId: string | null; revision: number; selectedId: string | null; selectedIds: string[] }
  | { type: "checkpoint"; requestId: number; snapshot: SceneSnapshot };

/** Control messages share the same worker queue as edits, but do not mutate history. */
export type SceneControl = SceneOp | { type: "checkpoint"; requestId: number };

export type SceneOp =
  | { type: "openProject"; projectId: string; tree: SceneNode[] | null; template?: "empty" | "campus"; settings?: EditorSettings }
  /** Phase 2 零拷贝加载：主线程 transfer 快照原始字节，worker 侧解码+校验（不回传场景对象图） */
  | { type: "loadSnapshot"; projectId: string; data: ArrayBuffer; template?: "empty" | "campus"; settings?: EditorSettings }
  | { type: "duplicate"; id: string }
  | { type: "toggleLocked"; id: string }
  | { type: "select"; id: string | null; additive?: boolean }
  | { type: "selectMany"; ids: string[] }
  | { type: "patch"; id: string; patch: Partial<Pick<SceneNode, "widget" | "data" | "dataSource" | "sharedDataSourceId" | "bindings" | "interactions" | "to" | "lightIntensity" | "terrain" | "water">> }
  | { type: "setDataSource"; id: string; source: DataSourceConfig | null }
  | { type: "setStaticData"; id: string; data: Record<string, unknown> }
  | { type: "patchWidget"; id: string; patch: Partial<WidgetConfig> }
  | { type: "patchKitOptions"; id: string; patch: Record<string, unknown>; stateId?: string }
  | { type: "patchKitData"; id: string; data: NonNullable<ReferenceKitWidget["privateData"]> }
  | { type: "patchKitPieceOptions"; id: string; path: number[]; patch: Record<string, unknown>; stateId?: string }
  | { type: "patchData"; id: string; patch: Record<string, unknown> }
  | { type: "patchChart"; id: string; patch: Record<string, unknown> }
  | { type: "patchChartState"; id: string; stateId: string; patch: Record<string, unknown> }
  | { type: "patchBindings"; id: string; patch: Record<string, string> }
  | { type: "addInteraction"; id: string; rule: Interaction }
  | { type: "updateInteraction"; id: string; ruleId: string; patch: Partial<Omit<Interaction, "id">> }
  | { type: "removeInteraction"; id: string; ruleId: string }
  | { type: "setAxis"; id: string; property: "position" | "rotation" | "scale" | "boxSize" | "to"; axis: keyof Vec3; value: number }
  | { type: "replaceNode"; node: SceneNode }
  | { type: "configure"; patch: Partial<EditorSettings> }
  | { type: "batch"; action: "remove" | "duplicate" | "hide" | "show" | "lock" | "unlock"; ids: string[] }
  | { type: "paste"; nodes: SceneNode[] }
  | { type: "group"; ids: string[]; name?: string }
  | { type: "ungroup"; ids: string[] }
  | { type: "reparent"; ids: string[]; parentId: string | null }
  | { type: "reorder"; ids: string[]; direction: "front" | "back" | "forward" | "backward" }
  // mode "board"：相对看板画布居中（需 boardSize，axis 仅 0/1）；distribute 可按指定边（默认中心）等距分布
  | { type: "align"; ids: string[]; axis: 0 | 1 | 2; mode: "min" | "center" | "max" | "distribute" | "board";
      edge?: "min" | "center" | "max"; board?: { width: number; height: number } }
  | { type: "patchWidgetState"; id: string; stateId: string; patch: Partial<WidgetConfig> }
  | { type: "widgetStates"; id: string; states: unknown }
  // 山海鲸「内部组件布局 › 流式布局」：全部看板组件按行流式整理（可撤销）
  | { type: "flowLayout"; board: { width: number; height: number }; boardPageId?: string }
  | { type: "transformSelection"; ids: string[]; property: "position" | "rotation" | "scale"; delta: number[] }
  | { type: "add"; node: Partial<SceneNode> & { type: SceneNode["type"] }; parentId?: string }
  | { type: "appendScene"; name: string; tree: SceneNode[] }
  | { type: "insertKit"; nodes: SceneNode[] }
  | { type: "remove"; id: string }
  | { type: "rename"; id: string; name: string }
  | { type: "transform"; id: string; position: [number, number, number]; property?: "position" | "rotation" | "scale" }
  | { type: "geometry"; id: string; boxSize: [number, number, number] }
  | { type: "replaceModel"; id: string; modelId: string }
  | { type: "color"; id: string; color: string }
  | { type: "toggleVisible"; id: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "loadScene"; tree: SceneNode[] | null; settings?: EditorSettings };

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

function v(x: number, y: number, z: number) {
  return { x, y, z };
}

function node(
  type: SceneNode["type"],
  name: string,
  parentId: string | null,
  position: [number, number, number],
  boxSize: [number, number, number],
  color: string,
  extra: Partial<SceneNode> = {},
): SceneNode {
  return {
    id: uid(type),
    name,
    type,
    visible: true,
    locked: false,
    parentId,
    transform: {
      position: v(...position),
      rotation: v(0, 0, 0),
      scale: v(1, 1, 1),
    },
    color,
    boxSize: v(...boxSize),
    ...extra,
  };
}

/** 默认数字孪生园区演示场景 */
export function defaultScene(): SceneNode[] {
  const root = "group-root";
  const buildings: SceneNode[] = [
    node("model", "主楼", root, [0, 5, 0], [6, 10, 6], "#93A5E8"),
    node("model", "厂房A", root, [-16, 2, -8], [10, 4, 6], "#D8DEEE"),
    node("model", "厂房B", root, [-16, 2, 4], [10, 4, 6], "#D8DEEE"),
    node("model", "办公楼", root, [12, 4, -6], [5, 8, 5], "#C3CDEA"),
    node("model", "宿舍楼", root, [13, 3, 7], [5, 6, 5], "#C3CDEA"),
    node("model", "仓库", root, [-2, 1.5, -15], [8, 3, 5], "#E4E8F4"),
    node("model", "烟囱", root, [-5, 3.5, -11], [1.6, 7, 1.6], "#8E9BC4"),
    node("model", "储罐", root, [20, 2, 2], [3.2, 4, 3.2], "#B9C4E4"),
    node("model", "配电房", root, [6, 1.5, 12], [3, 3, 3], "#DDE3F2"),
  ];
  const others: SceneNode[] = [
    node("marker", "标记点-01", root, [0, 10.5, 0], [0.6, 0.6, 0.6], "#5B7CFA"),
    node("marker", "标记点-02", root, [12, 8.5, -6], [0.6, 0.6, 0.6], "#39C46E"),
    node(
      "flyline",
      "飞线-01",
      root,
      [-16, 4, -8],
      [0.3, 0.3, 0.3],
      "#FF7847",
      { to: v(12, 8, -6) },
    ),
    node(
      "flyline",
      "飞线-02",
      root,
      [0, 10, 0],
      [0.3, 0.3, 0.3],
      "#F7B500",
      { to: v(20, 4, 2) },
    ),
    node("fence", "电子围栏", root, [-16, 0.05, -2], [14, 0.1, 20], "#00C2FF"),
    node("camera", "鸟瞰相机", null, [18, 16, 18], [0, 0, 0], "#666666"),
    node("light", "主光源", null, [8, 18, 6], [0, 0, 0], "#FFFFFF"),
  ];
  return [...buildings, ...others];
}

let projectId: string | null = null;
let revision = 0;
let tree: SceneNode[] = [];
let selectedId: string | null = null;
let selectedIds: string[] = [];
let settings: EditorSettings = structuredClone(defaultEditorSettings);
let loadError: string | undefined;
type History = { tree: SceneNode[]; settings: EditorSettings; loadError?: string; label: string };
let undoStack: History[] = [];
let redoStack: History[] = [];
let operationLabel = "编辑对象";
let cachedContent: Pick<SceneSnapshot, "tree" | "flat"> | null = null;
let viewOrigin: ViewOrigin = ZERO_ORIGIN;

/** 打开/加载项目的共用收尾：换项目 ID、建树、清选择与撤销历史。树的所有权归 worker，不再复制。 */
function resetProjectState(nextProjectId: string, nextTree: SceneNode[], nextSettings?: EditorSettings): void {
  projectId = nextProjectId;
  loadError = undefined;
  tree = nextTree;
  floatVesselsOnWater(tree);
  viewOrigin = computeViewOrigin(tree);
  selectedId = null; selectedIds = [];
  settings = { ...structuredClone(defaultEditorSettings), ...structuredClone(nextSettings ?? {}) };
  undoStack = [];
  redoStack = [];
  revision = 0;
  cachedContent = null;
}

const ROOT_ID = "group-root";

export function flattenScene(tree: SceneNode[], resolved = false): FlatInstance[] {
  const out: FlatInstance[] = [];
  const byId = new Map(tree.map((item) => [item.id, resolved ? item : boundNode(item)]));
  const isVisible = (item: SceneNode): boolean => {
    const visited = new Set<string>();
    let current: SceneNode | undefined = item;
    while (current) {
      if (!current.visible || visited.has(current.id)) return false;
      visited.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return true;
  };
  for (const original of tree) {
    const n = byId.get(original.id)!;
    if (!isVisible(n)) continue;
    const p = n.transform.position;
    const base = n.boxSize ?? v(0.5, 0.5, 0.5);
    const scale = n.transform.scale;
    const s = v(base.x * scale.x, base.y * scale.y, base.z * scale.z);
    const col = hexToRgb(n.color);
    if (n.type === "model" || n.type === "terrain" || n.type === "water") {
      out.push({
        id: n.id,
        kind: n.type === "water" ? "water" : n.type === "terrain" ? "terrain" : n.modelId ? "mesh" : "box",
        locked: n.locked || ancestorMatches(n, byId, p => p.locked),
        modelId: n.modelId,
        ...(n.type === "terrain" ? { terrain: n.terrain ?? defaultTerrain } : {}),
        ...(n.type === "water" ? { water: n.water ?? defaultWater } : {}),
        pos: [p.x, p.y, p.z],
        size: [s.x, s.y, s.z],
        rotY: n.transform.rotation.y * Math.PI / 180,
        rotation: [n.transform.rotation.x, n.transform.rotation.y, n.transform.rotation.z].map(n => n * Math.PI / 180) as [number, number, number],
        color: col,
      });
    } else if (n.type === "marker") {
      out.push({
        id: n.id,
        kind: "marker",
        pos: [p.x, p.y, p.z],
        size: [s.x, s.y, s.z],
        rotY: 0,
        color: col,
      });
    } else if (n.type === "flyline") {
      const t = n.to ?? v(0, 0, 0);
      out.push({
        id: n.id,
        kind: "flyline",
        pos: [p.x, p.y, p.z],
        size: [s.x, s.y, s.z],
        rotY: 0,
        color: col,
        to: [t.x, t.y, t.z],
      });
    } else if (n.type === "fence") {
      out.push({
        id: n.id,
        kind: "fence",
        pos: [p.x, p.y, p.z],
        size: [s.x, s.y, s.z],
        rotY: 0,
        color: col,
      });
    }
  }
  return out;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [1, 1, 1];
  const int = parseInt(m[1], 16);
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
}

function snapshot(): SceneSnapshot {
  cachedContent ??= { tree: structuredClone(tree), flat: flattenScene(tree) };
  return {
    projectId,
    revision,
    loadError,
    ...cachedContent,
    viewOrigin: { ...viewOrigin },
    selectedId, selectedIds: selectedIds.slice(), settings: structuredClone(settings),
    undoLabels: undoStack.map(entry => entry.label), redoLabels: redoStack.map(entry => entry.label),
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  };
}

export function currentSnapshot(): SceneSnapshot {
  return snapshot();
}

function pushUndo(): void {
  undoStack.push({ tree: structuredClone(tree), settings: structuredClone(settings), loadError, label: operationLabel });
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
}

function find(id: string): SceneNode | undefined {
  return tree.find((n) => n.id === id);
}

function locked(n: SceneNode): boolean {
  return n.locked || ancestorMatches(n, new Map(tree.map(p => [p.id,p])), p => p.locked);
}
function selectableRoots(ids: string[]) { return selectionRoots(tree,ids).filter(n=>!locked(n)); }
function terrainCapacity(nodes: SceneNode[]): boolean {
  const combined = [...tree, ...nodes];
  return combined.filter((n) => n.type === "terrain").length <= MAX_TERRAINS
    && combined.filter((n) => n.type === "water").length <= MAX_WATERS
    && combined.filter((n) => n.type === "water" && n.water?.preset === "shallow").length <= MAX_SHALLOW_WATERS;
}

function waterContainsPoint(water: SceneNode, x: number, z: number): boolean {
  const config = water.water ?? defaultWater;
  const width = (water.boxSize?.x ?? 80) * water.transform.scale.x;
  const depth = (water.boxSize?.z ?? 60) * water.transform.scale.z;
  const dx = x - water.transform.position.x;
  const dz = z - water.transform.position.z;
  const u = dx / Math.max(width, 0.01);
  const v = dz / Math.max(depth, 0.01);
  if (config.preset === "lake") return u * u * 4 + v * v * 4 <= 1;
  if (config.preset === "river") {
    const halfWidth = config.riverWidth * Math.min(width, depth) / 2;
    return config.points.slice(1).some((point, index) => {
      const a = { x: config.points[index].x * width, z: config.points[index].z * depth };
      const b = { x: point.x * width, z: point.z * depth };
      const segment = { x: b.x - a.x, z: b.z - a.z };
      const lengthSquared = segment.x * segment.x + segment.z * segment.z;
      const t = lengthSquared > 0
        ? Math.max(0, Math.min(1, ((dx - a.x) * segment.x + (dz - a.z) * segment.z) / lengthSquared))
        : 0;
      return Math.hypot(dx - a.x - segment.x * t, dz - a.z - segment.z * t) <= halfWidth;
    });
  }
  return Math.abs(u) <= 0.5 && Math.abs(v) <= 0.5;
}

/** Keep catalog vessel assets from being placed below a visible water surface. */
function floatVesselsOnWater(nodes: SceneNode[]): void {
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const isVisible = (item: SceneNode): boolean => {
    const visited = new Set<string>();
    let current: SceneNode | undefined = item;
    while (current) {
      if (!current.visible || visited.has(current.id)) return false;
      visited.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return true;
  };
  const waters = nodes.filter((item) => item.type === "water" && isVisible(item));
  if (waters.length === 0) return;
  for (const vessel of nodes) {
    if (vessel.type !== "model" || !vessel.modelId || !isVisible(vessel)) continue;
    const asset = modelAssetById.get(vessel.modelId);
    if (!asset?.category.includes("船舶") || asset.name.includes("潜艇")) continue;
    const containing = waters.filter((water) => waterContainsPoint(
      water, vessel.transform.position.x, vessel.transform.position.z,
    ));
    if (containing.length === 0) continue;
    const waterLevel = Math.max(...containing.map((water) => water.transform.position.y));
    const height = (vessel.boxSize?.y ?? 0.5) * vessel.transform.scale.y;
    const draft = Math.max(0.08, Math.min(0.3, height * 0.05));
    const targetBottom = waterLevel - draft;
    const currentBottom = vessel.transform.position.y - height / 2;
    if (currentBottom < targetBottom) vessel.transform.position.y += targetBottom - currentBottom;
  }
}

function remapInteractionTargets(node: SceneNode, ids: Map<string, string>): void {
  if (!node.interactions) return;
  node.interactions = node.interactions.map(rule => ({ ...rule, targetId: ids.get(rule.targetId) ?? rule.targetId,
    ...(rule.targetIds ? { targetIds: rule.targetIds.map(id => ids.get(id) ?? id) } : {}) }));
}

function kitLinkIds(nodes: SceneNode[], ids: Map<string, string>): Map<string, string> {
  const links = new Map(ids), sourceIds = new Map<string, string | null>();
  for (const node of nodes) {
    const sourceId = kitMetadata(node)?.source.uid;
    if (!sourceId) continue;
    sourceIds.set(sourceId, sourceIds.has(sourceId) ? null : ids.get(node.id) ?? null);
  }
  for (const [sourceId, next] of sourceIds) if (next && !links.has(sourceId)) links.set(sourceId, next);
  return links;
}

function remapKitLinkTargets(node: SceneNode, ids: Map<string, string>): void {
  const source = kitMetadata(node)?.source;
  if (!source) return;
  const remapList = (options: Record<string, unknown>, key: string) => {
    const entries = options[key];
    if (!Array.isArray(entries)) return;
    options[key] = entries.map(item => {
      if (typeof item === "string") return ids.get(item) ?? item;
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const value = item as Record<string, unknown>;
      const path = Array.isArray(value.elementPath) ? [...value.elementPath] : undefined;
      const last = path?.at(-1);
      if (path && typeof last === "string") path[path.length - 1] = ids.get(last) ?? last;
      return { ...value, ...(path ? { elementPath: path } : {}),
        ...(typeof value.id === "string" ? { id: ids.get(value.id) ?? value.id } : {}),
        ...(typeof value.uid === "string" ? { uid: ids.get(value.uid) ?? value.uid } : {}) };
    });
  };
  for (const options of [source.options, ...Object.values(source.statesOptions ?? {})]) {
    if (!options) continue;
    for (const kind of ["linkage", "selection"]) {
      remapList(options, `${kind}-elements`);
      const settings = options[`${kind}-advanced-settings`];
      if (!settings || typeof settings !== "object" || Array.isArray(settings)) continue;
      for (const direction of ["out", "in"]) {
        const rule = (settings as Record<string, unknown>)[`${kind}-${direction}`];
        if (rule && typeof rule === "object" && !Array.isArray(rule))
          remapList(rule as Record<string, unknown>, `${kind}-elements`);
      }
    }
  }
}

function copyNodes(nodes: SceneNode[], offset = true): SceneNode[] {
  const copies=structuredClone(nodes), ids=new Map(copies.map(n=>[n.id,uid(n.type)]));
  const linkIds = kitLinkIds(copies, ids);
  for (const n of copies) { n.id=ids.get(n.id)!; n.parentId=n.parentId ? ids.get(n.parentId)??null : null;
    remapInteractionTargets(n, ids);
    remapKitLinkTargets(n, linkIds);
    if (offset) {
      const board = n.type === "widget" || kitMetadata(n);
      n.transform.position.x += board ? 24 : 3;
      n.transform.position.y += board ? 24 : 0;
      if (n.to) n.to.x += 3;
    }
  }
  return copies;
}
export function handle(op: SceneOp): SceneSnapshot | null {
  const labels: Record<string,string> = { add:"添加对象", remove:"删除对象", duplicate:"复制对象", paste:"粘贴对象", group:"合并分组", ungroup:"取消分组", reparent:"调整图层", reorder:"调整顺序", align:"对齐排列", transform:"修改变换", transformSelection:"变换选中对象", configure:"场景设置", patch:"修改属性", patchWidget:"修改组件", patchData:"修改数据", patchChart:"修改图表配置", patchChartState:"修改状态图表配置", patchWidgetState:"修改状态", widgetStates:"组件状态", flowLayout:"流式布局", setDataSource:"配置数据源", setStaticData:"导入静态数据", patchBindings:"修改绑定", addInteraction:"添加交互", updateInteraction:"修改交互", removeInteraction:"删除交互", color:"修改颜色", toggleVisible:"切换可见性", toggleLocked:"切换锁定", rename:"重命名", appendScene:"插入场景", insertKit:"插入套件", loadScene:"导入场景", batch:"批量操作", geometry:"修改尺寸", replaceModel:"替换模型" };
  operationLabel=labels[op.type]??"编辑对象";
  const selected = "id" in op ? find(op.id ?? "") : undefined;
  if (selected && locked(selected) && ["remove", "transform", "geometry", "color", "rename", "replaceModel"].includes(op.type)) {
    return snapshot();
  }
  let changed = true;
  switch (op.type) {
    case "openProject":
      resetProjectState(op.projectId,
        op.tree === null ? (op.template === "empty" ? [] : defaultScene()) : structuredClone(op.tree), op.settings);
      changed = false;
      break;
    case "loadSnapshot": {
      // 零拷贝路径：字节由主线程 transfer 进来，解码+校验都发生在 worker 侧
      let loaded: SceneNode[] | null = null;
      let failure: string | undefined;
      try {
        loaded = validateScene(decodeSnapshotScene(new Uint8Array(op.data)));
      } catch (error) {
        console.error("[sceneModel] 快照解码或校验失败，回退默认场景", error);
        failure = "项目快照读取失败，原始数据已保留。请导入有效场景恢复。";
      }
      resetProjectState(op.projectId, loaded ?? (op.template === "empty" ? [] : defaultScene()), op.settings);
      loadError = failure;
      changed = false;
      break;
    }
    case "select":
      if (op.additive && op.id && find(op.id)) selectedIds=selectedIds.includes(op.id)?selectedIds.filter(id=>id!==op.id):[...selectedIds,op.id];
      else selectedIds=op.id&&find(op.id)?[op.id]:[];
      selectedId=selectedIds.at(-1)??null;
      changed = false;
      break;
    case "add": {
      if (op.node.type === "terrain" && tree.filter((n) => n.type === "terrain").length >= MAX_TERRAINS) return null;
      if (op.node.type === "water" && !terrainCapacity([op.node as SceneNode])) return null;
      if (op.node.terrain) validateTerrain(op.node.terrain);
      if (op.node.water) validateWater(op.node.water);
      pushUndo();
      const parentId = op.parentId ?? ROOT_ID;
      const t = op.node.type;
      const defaults: Record<string, [number, number, number]> = {
        group: [0, 0, 0],
        model: [0, 2, 0],
        terrain: [0, 12.03, 0],
        water: [0, .3, 0],
        marker: [0, 4, 0],
        flyline: [-8, 4, 0],
        fence: [0, 0.05, 0],
        light: [6, 12, 6],
        camera: [14, 12, 14],
        widget: [80, 80, 0],
      };
      const sizes: Record<string, [number, number, number]> = {
        group: [0, 0, 0],
        model: [4, 4, 4],
        terrain: [256, 24, 256],
        water: [80, 2, 60],
        marker: [0.6, 0.6, 0.6],
        flyline: [0.3, 0.3, 0.3],
        fence: [10, 0.1, 10],
        light: [0, 0, 0],
        camera: [0, 0, 0],
        widget: [300, 100, 1],
      };
      const pos = op.node.transform?.position;
      const created = node(
        t,
        op.node.name ?? `${typeLabel(t)}-${Math.floor(Math.random() * 90 + 10)}`,
        t === "camera" || t === "light" || t === "widget" ? null : parentId,
        pos
          ? ([pos.x, pos.y, pos.z] as [number, number, number])
          : defaults[t],
        op.node.boxSize ? [op.node.boxSize.x, op.node.boxSize.y, op.node.boxSize.z] : sizes[t],
        op.node.color ?? "#5B7CFA",
        op.node.to
          ? { to: op.node.to }
          : t === "flyline"
            ? {
                to: {
                  x: (pos?.x ?? defaults[t][0]) + 18,
                  y: (pos?.y ?? defaults[t][1]) + 2,
                  z: (pos?.z ?? defaults[t][2]) + 12,
                },
              }
            : {},
      );
      if (t === "model" && op.node.modelId && (modelAssetById.has(op.node.modelId) || Boolean(op.node.customMesh))) {
        created.modelId = op.node.modelId;
      }
      if (op.node.transform) created.transform = structuredClone(op.node.transform);
      if (t === "terrain") created.terrain = structuredClone(op.node.terrain ?? defaultTerrain);
      if (t === "water") created.water = structuredClone(op.node.water ?? defaultWater);
      for (const key of ["widget","data","dataSource","sharedDataSourceId","boardPageId","bindings","interactions","customMesh"] as const) {
        if (op.node[key] !== undefined) Object.assign(created, { [key]: structuredClone(op.node[key]) });
      }
      if (t === "widget") created.boardPageId = op.node.boardPageId ?? settings.boardActivePageId;
      tree = [...tree, created];
      selectedId = created.id;
      break;
    }
    case "appendScene": {
      if (!op.tree.length || !terrainCapacity(op.tree)) return null;
      pushUndo();
      const group = node("group", op.name, null, [0, 0, 0], [0, 0, 0], "#8E9BC4");
      const copies = structuredClone(op.tree);
      const ids = new Map(copies.map((item) => [item.id, uid(item.type)]));
      for (const item of copies) {
        item.id = ids.get(item.id)!;
        item.parentId = item.parentId ? ids.get(item.parentId) ?? group.id : group.id;
      }
      tree.push(group, ...copies);
      selectedId = group.id;
      break;
    }
    case "insertKit": {
      // 套件插入：整组重映射 id 后平铺进场景并保持多选，首次拖动即可整组移动
      if (!op.nodes.length || tree.length + op.nodes.length > 4096 || !terrainCapacity(op.nodes)) return null;
      pushUndo();
      const copies = copyNodes(op.nodes, false);
      const pageId = settings.boardActivePageId;
      for (const item of copies) item.boardPageId ??= pageId;
      tree.push(...copies);
      selectedIds = selectionRoots(copies, copies.map(item => item.id)).map(item => item.id);
      selectedId = selectedIds.at(-1) ?? null;
      break;
    }
    case "patchKitOptions": {
      const n = find(op.id), meta = n && kitMetadata(n);
      if (!n || !meta || locked(n)) return null;
      const previous = op.stateId ? meta.source.statesOptions?.[op.stateId] ?? {} : meta.source.options ?? {};
      if (Object.entries(op.patch).every(([key, value]) => JSON.stringify(previous[key]) === JSON.stringify(value))) return null;
      pushUndo();
      patchKitOptions(tree, op.id, op.patch, op.stateId);
      if (Object.hasOwn(op.patch, "interacts") && !op.stateId) {
        let root = n;
        for (let parent = find(root.parentId ?? ""); parent && kitMetadata(parent)?.templateId === meta.templateId;
          parent = find(root.parentId ?? "")) root = parent;
        const ids = descendants(tree, [root.id]);
        const manual = (n.interactions ?? []).filter(rule => !rule.id.startsWith("kit-rule-"));
        n.interactions = [...manual, ...importKitInteractions(n, tree.filter(item => ids.has(item.id)))].slice(0, 100);
      }
      break;
    }
    case "patchKitData": {
      const n = find(op.id), meta = n && kitMetadata(n);
      if (!n || !meta || locked(n) || JSON.stringify(op.data).length > 500_000
        || JSON.stringify(meta.source.privateData) === JSON.stringify(op.data)) return null;
      pushUndo();
      patchKitPrivateData(n, op.data);
      break;
    }
    case "patchKitPieceOptions": {
      const n = find(op.id), meta = n && kitMetadata(n);
      const piece = meta && kitPieceAt(meta.source, op.path);
      if (!n || !piece || locked(n)) return null;
      const previous = op.stateId ? piece.statesOptions?.[op.stateId] ?? {} : piece.options ?? {};
      if (Object.entries(op.patch).every(([key, value]) => JSON.stringify(previous[key]) === JSON.stringify(value))) return null;
      pushUndo();
      if (op.stateId) {
        piece.statesOptions ??= {};
        piece.statesOptions[op.stateId] = { ...previous, ...structuredClone(op.patch) };
      } else {
        piece.options = { ...previous, ...structuredClone(op.patch) };
      }
      break;
    }
    case "remove": {
      if (!find(op.id)) return null;
      pushUndo();
      const removed = new Set([op.id]);
      let lastSize = 0;
      while (lastSize !== removed.size) {
        lastSize = removed.size;
        for (const n of tree) {
          if (n.parentId && removed.has(n.parentId)) removed.add(n.id);
        }
      }
      tree = tree.filter((n) => !removed.has(n.id));
      if (selectedId && removed.has(selectedId)) selectedId = null;
      break;
    }
    case "rename": {
      const n = find(op.id);
      if (!n) return null;
      if (n.name === op.name) return null;
      pushUndo();
      n.name = op.name;
      break;
    }
    case "transform": {
      const n = find(op.id);
      if (!n) return null;
      const previous = n.transform[op.property ?? "position"];
      if (!op.position.every(Number.isFinite) ||
        [previous.x, previous.y, previous.z].every((value, index) => value === op.position[index])) return null;
      pushUndo();
      if(n.type === "group") {
        const old=[previous.x,previous.y,previous.z];
        const delta=op.position.map((v,i)=>(op.property==="scale"?v/Math.max(.01,old[i]):v-old[i]));
        tree=transformedTree(tree,[n.id],op.property??"position",delta);
        const group=find(n.id)!;group.transform[op.property??"position"]=v(...op.position);
      } else n.transform[op.property ?? "position"] = v(...op.position);
      break;
    }
    case "replaceModel": {
      const n = find(op.id);
      const asset = modelAssetById.get(op.modelId);
      if (!n || n.type !== "model" || !asset || n.modelId === asset.id) return null;
      pushUndo();
      const floor = n.transform.position.y - (n.boxSize?.y ?? 0) * n.transform.scale.y / 2;
      n.modelId = asset.id;
      n.boxSize = v(asset.size[0], asset.size[1], asset.size[2]);
      n.transform.position.y = floor + asset.size[1] * n.transform.scale.y / 2;
      n.color = "#FFFFFF";
      break;
    }
    case "geometry": {
      const n = find(op.id);
      if (!n || !op.boxSize.every(value=>Number.isFinite(value)&&value>0)) return null;
      if ((n.type === "terrain" || n.type === "water") && op.boxSize.some((value) => value > 100_000)) return null;
      if (n.boxSize && [n.boxSize.x, n.boxSize.y, n.boxSize.z].every((value, index) => value === op.boxSize[index])) return null;
      pushUndo();
      if (n.type === "terrain" && n.boxSize) {
        const offset = rotateVector([0, (op.boxSize[1] - n.boxSize.y) * n.transform.scale.y / 2, 0],
          [n.transform.rotation.x, n.transform.rotation.y, n.transform.rotation.z].map((v) => v * Math.PI / 180));
        n.transform.position.x += offset[0]; n.transform.position.y += offset[1]; n.transform.position.z += offset[2];
      }
      n.boxSize = { x: op.boxSize[0], y: op.boxSize[1], z: op.boxSize[2] };
      break;
    }
    case "color": {
      const n = find(op.id);
      if (!n) return null;
      const data = chartDataWithColor(n, op.color);
      if (n.color === op.color && JSON.stringify(data) === JSON.stringify(n.data)) return null;
      pushUndo();
      n.color = op.color;
      n.data = data;
      break;
    }
    case "toggleVisible": {
      const n = find(op.id);
      if (!n) return null;
      pushUndo();
      n.visible = !n.visible;
      break;
    }
    case "toggleLocked": {
      const n = find(op.id);
      if (!n) return null;
      pushUndo();
      n.locked = !n.locked;
      break;
    }
    case "duplicate": {
      const original = find(op.id);
      if (!original) return null;
      const descendants = new Set([op.id]);
      let previousSize = 0;
      while (previousSize !== descendants.size) {
        previousSize = descendants.size;
        tree.forEach((n) => { if (n.parentId && descendants.has(n.parentId)) descendants.add(n.id); });
      }
      if (!terrainCapacity(tree.filter((n) => descendants.has(n.id)))) return null;
      pushUndo();
      const copies = structuredClone(tree.filter((n) => descendants.has(n.id)));
      const ids = new Map(copies.map((n) => [n.id, uid(n.type)]));
      const linkIds = kitLinkIds(copies, ids);
      for (const n of copies) {
        const oldId = n.id;
        n.id = ids.get(oldId)!;
        if (n.parentId) n.parentId = ids.get(n.parentId) ?? n.parentId;
        remapInteractionTargets(n, ids);
        remapKitLinkTargets(n, linkIds);
        n.transform.position.x += 3;
        if (oldId === op.id) n.name += " 副本";
      }
      tree.push(...copies);
      selectedId = ids.get(op.id) ?? null;
      break;
    }
    case "loadScene": {
      pushUndo();
      tree = op.tree === null ? defaultScene() : structuredClone(op.tree);
      loadError = undefined;
      viewOrigin = computeViewOrigin(tree);
      selectedId = null; selectedIds = [];
      if (op.settings) settings=structuredClone(op.settings);
      break;
    }
    case "undo": {
      const prev = undoStack.pop();
      if (!prev) return null;
      redoStack.push({tree:structuredClone(tree),settings:structuredClone(settings),loadError,label:prev.label});
      tree = prev.tree; settings=prev.settings; loadError=prev.loadError;
      break;
    }
    case "redo": {
      const next = redoStack.pop();
      if (!next) return null;
      undoStack.push({tree:structuredClone(tree),settings:structuredClone(settings),loadError,label:next.label});
      tree = next.tree; settings=next.settings; loadError=next.loadError;
      break;
    }
    case "selectMany":
      selectedIds=[...new Set(op.ids)].filter(id=>Boolean(find(id)));selectedId=selectedIds.at(-1)??null;changed=false;break;
    case "replaceNode": {
      const current=find(op.node.id);if(!current||locked(current)||current.type!==op.node.type)return null;
      if(JSON.stringify(current)===JSON.stringify(op.node))return null;
      pushUndo();tree=tree.map(n=>n.id===op.node.id?structuredClone(op.node):n);break;
    }
    case "configure":
      if(Object.entries(op.patch).every(([key,value])=>JSON.stringify(settings[key as keyof EditorSettings])===JSON.stringify(value)))return null;
      pushUndo();settings={...settings,...structuredClone(op.patch)};break;
    case "patch": {
      const n=find(op.id);if(!n||locked(n))return null;
      if (op.patch.terrain) { if (n.type !== "terrain") return null; validateTerrain(op.patch.terrain); }
      if (op.patch.water) {
        if (n.type !== "water") return null;
        validateWater(op.patch.water);
        if (op.patch.water.preset === "shallow" && n.water?.preset !== "shallow"
          && tree.filter((item) => item.water?.preset === "shallow").length >= MAX_SHALLOW_WATERS) return null;
      }
      if(Object.entries(op.patch).every(([key,value])=>JSON.stringify(n[key as keyof SceneNode])===JSON.stringify(value)))return null;
      pushUndo();Object.assign(n,structuredClone(op.patch));break;
    }
    case "setDataSource": {
      const n = find(op.id); if (!n || locked(n)) return null;
      if (JSON.stringify(n.dataSource ?? null) === JSON.stringify(op.source)) return null;
      pushUndo(); n.dataSource = op.source ? structuredClone(op.source) : undefined; break;
    }
    case "setStaticData": {
      const n = find(op.id); if (!n || locked(n)) return null;
      const chartWidget = n.widget && n.widget.kind !== "table" && isChartWidget(n.widget.kind);
      const chart = chartWidget ? n.data?.chart : undefined;
      const chartStates = chartWidget ? n.data?.chartStates : undefined;
      const next = kitMetadata(n) ? mergeKitStaticData(n, op.data) : { ...op.data, ...(chart !== undefined ? { chart } : {}),
        ...(chartStates !== undefined ? { chartStates } : {}) };
      if (JSON.stringify(next).length > 1_000_000) return null;
      if (!n.dataSource && JSON.stringify(n.data ?? {}) === JSON.stringify(next)) return null;
      pushUndo(); n.data = structuredClone(next); n.dataSource = undefined; break;
    }
    case "patchWidget": {
      const n = find(op.id); if (!n?.widget || locked(n)) return null;
      if (Object.entries(op.patch).every(([key, value]) => JSON.stringify(n.widget![key as keyof WidgetConfig]) === JSON.stringify(value))) return null;
      pushUndo(); n.widget = { ...n.widget, ...structuredClone(op.patch) }; break;
    }
    // 山海鲸「组件状态」：写入 / 增删状态列表；patchWidgetState 把样式补丁写进单个状态
    case "widgetStates": {
      const n = find(op.id); if (!n?.widget || locked(n)) return null;
      const states = sanitizeWidgetStates(op.states);
      if (JSON.stringify(n.widget.states ?? []) === JSON.stringify(states)) return null;
      pushUndo();
      n.widget = { ...n.widget, states: states.length ? states : undefined };
      const kit = kitMetadata(n);
      if (kit) {
        kit.source.states = [{ uid: "", name: "默认状态" }, ...states.map(state => ({ uid: state.id, name: state.name }))];
        const valid = new Set(states.map(state => state.id));
        kit.source.statesOptions = Object.fromEntries(Object.entries(kit.source.statesOptions ?? {}).filter(([id]) => valid.has(id)));
      }
      const raw = n.data?.chartStates;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const valid = new Set(states.map(state => state.id));
        const chartStates = Object.fromEntries(Object.entries(raw).filter(([id]) => valid.has(id)));
        const data = { ...n.data };
        if (Object.keys(chartStates).length) data.chartStates = chartStates;
        else delete data.chartStates;
        n.data = data;
      }
      break;
    }
    case "patchWidgetState": {
      const n = find(op.id); if (!n?.widget || locked(n)) return null;
      const target = n.widget.states?.find((item) => item.id === op.stateId); if (!target) return null;
      const patch = Object.fromEntries(Object.entries(structuredClone(op.patch)).filter(([key]) => isStateStyleKey(key)));
      if (!Object.keys(patch).length) return null;
      if (Object.entries(patch).every(([key, value]) => JSON.stringify(target.patch[key as keyof WidgetConfig]) === JSON.stringify(value))) return null;
      pushUndo();
      n.widget = { ...n.widget, states: n.widget.states!.map((item) => item.id === op.stateId ? { ...item, patch: { ...item.patch, ...patch } } : item) };
      break;
    }
    case "patchChart": {
      const n = find(op.id); if (!n || locked(n)) return null;
      const raw = n.data?.chart;
      const previous = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
      if (Object.entries(op.patch).every(([key, value]) => JSON.stringify(previous[key]) === JSON.stringify(value))) return null;
      pushUndo();
      n.data = { ...n.data, chart: { ...previous, ...structuredClone(op.patch) } };
      break;
    }
    case "patchChartState": {
      const n = find(op.id);
      if (!n?.widget || locked(n) || n.widget.kind === "table" || !isChartWidget(n.widget.kind)
        || !n.widget.states?.some(state => state.id === op.stateId)) return null;
      const raw = n.data?.chartStates;
      const chartStates = raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw as Record<string, unknown> : {};
      const state = chartStates[op.stateId];
      const previous = state && typeof state === "object" && !Array.isArray(state)
        ? state as Record<string, unknown> : {};
      if (Object.entries(op.patch).every(([key, value]) => JSON.stringify(previous[key]) === JSON.stringify(value))) return null;
      pushUndo();
      n.data = { ...n.data, chartStates: { ...chartStates, [op.stateId]: { ...previous, ...structuredClone(op.patch) } } };
      break;
    }
    case "patchData": case "patchBindings": {
      const n = find(op.id); if (!n || locked(n)) return null;
      const previous = op.type === "patchData" ? n.data ?? {} : n.bindings ?? {};
      if (Object.entries(op.patch).every(([key, value]) => JSON.stringify(previous[key]) === JSON.stringify(value))) return null;
      pushUndo();
      if (op.type === "patchData") n.data = { ...previous, ...structuredClone(op.patch) };
      else n.bindings = { ...previous, ...structuredClone(op.patch) } as SceneNode["bindings"];
      break;
    }
    case "addInteraction": {
      const n = find(op.id); if (!n || locked(n) || n.interactions?.some((rule) => rule.id === op.rule.id)) return null;
      pushUndo(); n.interactions = [...(n.interactions ?? []), structuredClone(op.rule)]; break;
    }
    case "updateInteraction": {
      const n = find(op.id), rule = n?.interactions?.find((item) => item.id === op.ruleId);
      if (!n || locked(n) || !rule) return null;
      if (Object.entries(op.patch).every(([key, value]) => JSON.stringify(rule[key as keyof Interaction]) === JSON.stringify(value))) return null;
      pushUndo(); Object.assign(rule, structuredClone(op.patch)); break;
    }
    case "removeInteraction": {
      const n = find(op.id); if (!n || locked(n) || !n.interactions?.some((rule) => rule.id === op.ruleId)) return null;
      pushUndo(); n.interactions = n.interactions.filter((rule) => rule.id !== op.ruleId); break;
    }
    case "setAxis": {
      const n = find(op.id); if (!n || locked(n) || !Number.isFinite(op.value)) return null;
      const current = op.property === "boxSize" ? n.boxSize : op.property === "to" ? n.to : n.transform[op.property];
      if (!current) return null;
      const value = op.property === "boxSize" || op.property === "scale" ? Math.max(.01, op.value) : op.value;
      const next = { ...current, [op.axis]: value };
      if (op.property === "to") return handle({ type: "patch", id: op.id, patch: { to: next } });
      if (op.property === "boxSize") return handle({ type: "geometry", id: op.id, boxSize: [next.x, next.y, next.z] });
      return handle({ type: "transform", id: op.id, property: op.property, position: [next.x, next.y, next.z] });
    }
    case "batch": {
      const roots=op.action==="unlock"?selectionRoots(tree,op.ids):selectableRoots(op.ids), ids=descendants(tree,roots.map(n=>n.id));
      if(!ids.size)return null;
      if(op.action==="remove" && tree.some(n=>ids.has(n.id)&&n.locked))return null;
      if(op.action==="duplicate" && !terrainCapacity(tree.filter(n=>ids.has(n.id))))return null;
      pushUndo();
      if(op.action==="remove")tree=tree.filter(n=>!ids.has(n.id));
      else if(op.action==="duplicate") {
        const copies=copyNodes(tree.filter(n=>ids.has(n.id)));selectionRoots(copies,copies.map(n=>n.id)).forEach(n=>n.name+=" 副本");tree.push(...copies);selectedIds=selectionRoots(copies,copies.map(n=>n.id)).map(n=>n.id);selectedId=selectedIds.at(-1)??null;
      } else for(const n of tree) if(ids.has(n.id)){
        if(op.action==="hide"||op.action==="show")n.visible=op.action==="show";
        else n.locked=op.action==="lock";
      }
      break;
    }
    case "paste": {
      if(!op.nodes.length||!terrainCapacity(op.nodes))return null;pushUndo();const copies=copyNodes(op.nodes);tree.push(...copies);
      selectedIds=selectionRoots(copies,copies.map(n=>n.id)).map(n=>n.id);selectedId=selectedIds.at(-1)??null;break;
    }
    case "group": {
      const roots=selectableRoots(op.ids);if(roots.length<2)return null;
      if(roots.some(n=>n.type==="widget")&&roots.some(n=>n.type!=="widget"))return null;
      pushUndo();const p=nodeBounds(tree,roots.map(n=>n.id)).center as [number,number,number];
      const parent=roots.every(n=>n.parentId===roots[0].parentId)?roots[0].parentId:null;
      const group=node("group",op.name??"新分组",parent,p,[0,0,0],"#8E9BC4");tree.push(group);roots.forEach(n=>n.parentId=group.id);selectedId=group.id;break;
    }
    case "ungroup": {
      const groups=selectableRoots(op.ids).filter(n=>n.type==="group");if(!groups.length)return null;
      pushUndo();const ids=new Set(groups.map(n=>n.id));selectedIds=[];
      for(const n of tree){const group=groups.find(g=>g.id===n.parentId);if(group){n.parentId=group.parentId;n.visible&&=group.visible;selectedIds.push(n.id)}}
      tree=tree.filter(n=>!ids.has(n.id));selectedId=selectedIds.at(-1)??null;break;
    }
    case "reparent": {
      const roots=selectableRoots(op.ids), parent=op.parentId?find(op.parentId):null;
      if(parent&&(parent.type!=="group"||locked(parent)||descendants(tree,roots.map(n=>n.id)).has(parent.id)))return null;
      if(!roots.length||roots.every(n=>n.parentId===op.parentId))return null;
      pushUndo();roots.forEach(n=>n.parentId=op.parentId);break;
    }
    case "reorder": {
      const ids=new Set(op.ids), selected=tree.filter(n=>ids.has(n.id));if(!selected.length)return null;pushUndo();
      if(op.direction==="front")tree=[...tree.filter(n=>!ids.has(n.id)),...selected];
      else if(op.direction==="back")tree=[...selected,...tree.filter(n=>!ids.has(n.id))];
      else { const direction=op.direction==="forward"?1:-1;for(const n of direction>0?[...selected].reverse():selected){const i=tree.indexOf(n),j=i+direction;if(j>=0&&j<tree.length&&!ids.has(tree[j].id))[tree[i],tree[j]]=[tree[j],tree[i]]} }
      break;
    }
    case "align": {
      const roots=selectableRoots(op.ids), axis=op.axis;
      if(op.mode==="board"){
        if(!op.board||axis>1||!roots.length)return null;
        pushUndo();const target=(axis===0?op.board.width:op.board.height)/2;
        for(const n of roots){const b=nodeBounds(tree,[n.id]);const delta=[0,0,0];delta[axis]=target-(b.min[axis]+b.max[axis])/2;
          tree=transformedTree(tree,[n.id],"position",delta);}
        break;
      }
      const edge=op.edge??"center", mode=op.mode;
      if(roots.length<(mode==="distribute"?3:2))return null;
      const bounds=nodeBounds(tree,roots.map(n=>n.id));
      const entries=roots.map(n=>({n,b:nodeBounds(tree,[n.id])})).sort((a,b)=>mode==="distribute"?a.b[edge][axis]-b.b[edge][axis]:a.b.center[axis]-b.b.center[axis]);
      pushUndo();entries.forEach(({n,b},index)=>{
        const target=mode==="distribute"
          ?entries[0].b[edge][axis]+(entries.at(-1)!.b[edge][axis]-entries[0].b[edge][axis])*index/(entries.length-1)
          :bounds[mode][axis];
        const delta=[0,0,0];delta[axis]=target-b[mode==="distribute"?edge:mode][axis];tree=transformedTree(tree,[n.id],"position",delta);
      });break;
    }
    case "flowLayout": {
      // 流式布局：组件按 y→x 排序，逐行铺放（24px 边距，行高取行内最大高度）
      const pageId = op.boardPageId ?? settings.boardActivePageId;
      const widgets = tree.filter((n) => n.type === "widget" && n.boardPageId === pageId && !n.locked && n.boxSize);
      if (widgets.length < 2) return null;
      pushUndo();
      const margin = 24, gap = 24, limit = op.board.width - margin;
      widgets.sort((a, b) => a.transform.position.y - b.transform.position.y || a.transform.position.x - b.transform.position.x);
      let x = margin, y = margin, rowHeight = 0;
      for (const n of widgets) {
        const w = n.boxSize!.x, h = n.boxSize!.y;
        if (x > margin && x + w > limit) { x = margin; y += rowHeight + gap; rowHeight = 0; }
        n.transform.position.x = x; n.transform.position.y = y;
        x += w + gap; rowHeight = Math.max(rowHeight, h);
      }
      void op.board.height;
      break;
    }
    case "transformSelection":
      if(!op.delta.every(Number.isFinite)||!selectableRoots(op.ids).length)return null;
      pushUndo();tree=transformedTree(tree,op.ids,op.property,op.delta);break;
    default:
      return null;
  }
  if (changed) floatVesselsOnWater(tree);
  if (selectedId && !find(selectedId)) selectedId = null;
  selectedIds=selectedIds.filter(id=>Boolean(find(id)));
  if (!["select","selectMany","batch","paste","insertKit","ungroup","undo","redo"].includes(op.type)) selectedIds=selectedId?[selectedId]:[];
  if (changed) {
    revision += 1;
    cachedContent = null;
  }
  return snapshot();
}

function typeLabel(t: SceneNode["type"]): string {
  const labels: Record<string, string> = {
    group: "分组",
    model: "模型",
    terrain: "地形",
    water: "水体",
    marker: "标记点",
    flyline: "飞线",
    fence: "电子围栏",
    light: "灯光",
    camera: "相机",
    widget: "看板组件",
  };
  return labels[t] ?? t;
}

