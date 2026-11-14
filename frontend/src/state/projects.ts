import {
  BACKGROUND_BOARD_PAGE_ID, FOREGROUND_BOARD_PAGE_ID, defaultEditorSettings,
  isValidInteractionTargetScope, isValidSettingSource, normalizeWidgetStyle, widgetLabels,
  type BoardPage, type BoardScript, type BoardSharedData, type BoardState, type BoardStateStyle, type EditorSettings,
  type Interaction,
} from "../data/editor";
import type { SceneNode, Vec3 } from "../types";
import { modelAssetById } from "../data/modelCatalog";
import { validateDataSource } from "../data/dataSources";
import { sanitizeDataConditions } from "../data/dataConditions";
import type { PortableBoardMedia } from "./boardMedia";
import { isProjectStoreReady, readIndex, readSnapshotMeta, readSnapshotScene, readSnapshotState, writeIndex, writeSnapshot } from "./projectStore";
import { migrateLegacyKitImages, type SnapshotPayload } from "./snapshotCodec";
import { defaultTerrain, MAX_TERRAINS, validateTerrain } from "../data/terrain";
import { defaultWater, MAX_WATERS, MAX_SHALLOW_WATERS, validateWater } from "../data/water";

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  openedAt: number;
  updatedAt?: number;
  template?: "empty" | "campus";
  folder?: string;
  thumbnail?: string;
  trashedAt?: number;
  /** 本地发布标记：非云端发布，仅表示成品入口（viewer.html）可全屏查看 */
  publishedAt?: number;
}

export const PROJECTS_KEY = "dw_projects";
export const sceneKey = (id: string) => `dw_scene_${id}`;

export interface BoardSize { width: number; height: number; }
const validBoardRange = (board: { width: number; height: number }) =>
  [board.width, board.height].every((n) => Number.isFinite(n) && n >= 100 && n <= 8192);
export function readBoardSize(id: string): BoardSize {
  const meta = readSnapshotMeta(id);
  if (meta && validBoardRange(meta.boardSize)) return meta.boardSize;
  try {
    const board = JSON.parse(localStorage.getItem(`dw_board_${id}`) ?? "null");
    if (board && validBoardRange(board)) return board;
  } catch { /* A missing or invalid optional board size uses the standard dimensions. */ }
  return { width: 1920, height: 1080 };
}

/// 合并缓存中的快照分段（惰性解码）与覆盖项，得到完整载荷供重编码。
/// 项目尚无快照时：带 scene 的写入会建快照，否则返回 null 走 legacy 键。
function composeSnapshot(id: string, patch: Partial<SnapshotPayload> & Pick<SnapshotPayload, "savedAt">): SnapshotPayload | null {
  if (!isProjectStoreReady()) return null;
  const meta = readSnapshotMeta(id);
  const state = readSnapshotState(id);
  const scene = (patch.scene ?? readSnapshotScene(id)) as SceneNode[] | null;
  if (!meta && scene === null) return null;
  if (scene === null) throw new Error("项目场景无法读取");
  return {
    name: loadProjects().find((item) => item.id === id)?.name ?? meta?.name ?? "",
    savedAt: patch.savedAt,
    boardSize: patch.boardSize ?? meta?.boardSize ?? readBoardSize(id),
    scene,
    settings: patch.settings ?? state?.settings ?? null,
    params: patch.params ?? state?.params ?? null,
  };
}

export function persistBoardSize(id: string, board: BoardSize) {
  const payload = composeSnapshot(id, { boardSize: board, savedAt: Date.now() });
  if (payload) writeSnapshot(id, payload);
  else localStorage.setItem(`dw_board_${id}`, JSON.stringify(board));
}

const validProjectMeta = (item: unknown): item is ProjectMeta =>
  typeof item === "object" && item !== null && typeof (item as ProjectMeta).id === "string" &&
  typeof (item as ProjectMeta).name === "string" &&
  Number.isFinite((item as ProjectMeta).createdAt) && Number.isFinite((item as ProjectMeta).openedAt);

export function loadProjects(): ProjectMeta[] {
  if (isProjectStoreReady()) {
    const index = readIndex();
    return index ? index.filter(validProjectMeta) : [];
  }
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(validProjectMeta);
  } catch {
    return [];
  }
}

export function saveProjects(projects: ProjectMeta[]): void {
  if (isProjectStoreReady()) writeIndex(projects);
  else localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

export function createProject(name: string, template: ProjectMeta["template"] = "empty") {
  const project: ProjectMeta = {
    id: crypto.randomUUID(), name: name.trim() || "未命名项目",
    createdAt: Date.now(), openedAt: Date.now(), updatedAt: Date.now(), template,
  };
  saveProjects([project, ...loadProjects()]);
  return project;
}

const vector = (value: unknown): value is Vec3 => {
  if (!value || typeof value !== "object") return false;
  const v = value as Vec3;
  return [v.x, v.y, v.z].every((n) => typeof n === "number" && Number.isFinite(n));
};

/** Validate at the file/storage boundary before sending a scene to a Worker or WASM. */
export function validateScene(value: unknown): SceneNode[] {
  if (!Array.isArray(value) || value.length > 4096) throw new Error("场景对象格式不正确");
  const types = ["group", "model", "marker", "flyline", "fence", "light", "camera", "widget", "terrain", "water"];
  if (value.filter((n) => n?.type === "terrain").length > MAX_TERRAINS) throw new Error(`最多支持 ${MAX_TERRAINS} 块地形`);
  if (value.filter((n) => n?.type === "water").length > MAX_WATERS) throw new Error(`最多支持 ${MAX_WATERS} 个水体`);
  if (value.filter((n) => n?.type === "water" && n.water?.preset === "shallow").length > MAX_SHALLOW_WATERS) throw new Error(`最多支持 ${MAX_SHALLOW_WATERS} 个浅水模拟`);
  const ids = new Set<string>();
  for (const n of value) {
    if (!n || typeof n.id !== "string" || !n.id || ids.has(n.id) ||
      typeof n.name !== "string" || !types.includes(n.type) ||
      typeof n.visible !== "boolean" || typeof n.locked !== "boolean" ||
      !(n.parentId === null || typeof n.parentId === "string") ||
      typeof n.color !== "string" || !/^#[0-9a-f]{6}$/i.test(n.color) ||
      !vector(n.transform?.position) || !vector(n.transform?.rotation) ||
      !vector(n.transform?.scale) || (n.boxSize !== undefined && !vector(n.boxSize)) ||
      (n.modelId !== undefined && (n.type !== "model" || !(modelAssetById.has(n.modelId) || (typeof n.modelId === "string" && n.modelId.startsWith("custom-") && validCustomMesh(n.customMesh))))) ||
      (n.to !== undefined && !vector(n.to))) {
      throw new Error("场景包含无效对象、重复 ID 或无效坐标");
    }
    if(n.lightIntensity!==undefined&&(!Number.isFinite(n.lightIntensity)||n.lightIntensity<0||n.lightIntensity>5))throw new Error("光照强度无效");
    if (n.type === "terrain") {
      if (n.terrain === undefined) n.terrain = structuredClone(defaultTerrain);
      validateTerrain(n.terrain);
      if (!n.boxSize || [n.boxSize.x, n.boxSize.y, n.boxSize.z].some((v) => v <= 0 || v > 100_000)
        || Object.values(n.transform.scale).some((v) => typeof v !== "number" || v <= 0)) throw new Error("地形尺寸和缩放必须大于零");
    } else if (n.terrain !== undefined) throw new Error("地形参数只能用于地形对象");
    if (n.type === "water") {
      if (n.water === undefined) n.water = structuredClone(defaultWater);
      validateWater(n.water);
      if (!n.boxSize || [n.boxSize.x, n.boxSize.y, n.boxSize.z].some((v) => v <= 0 || v > 100_000)
        || Object.values(n.transform.scale).some((v) => typeof v !== "number" || v <= 0)) throw new Error("水体尺寸和缩放必须大于零");
    } else if (n.water !== undefined) throw new Error("水体参数只能用于水体对象");
    if(n.type === "widget" && (!n.widget || !Object.hasOwn(widgetLabels,n.widget.kind) ||
      typeof n.widget.text!=="string" || typeof n.widget.value!=="string" || typeof n.widget.unit!=="string" ||
      ![n.widget.fontSize,n.widget.opacity,n.widget.radius].every(Number.isFinite) ||
      ![n.widget.background,n.widget.borderColor,n.widget.image].every((v:unknown)=>typeof v==="string") ||
      !["left","center","right"].includes(n.widget.align))) throw new Error("看板组件格式无效");
    // 旧项目缺少山海鲸同款样式字段（字体/边框/阴影）时补齐默认值
    if(n.type === "widget" && n.widget) n.widget = normalizeWidgetStyle(n.widget);
    if (n.type === "widget") {
      if (n.boardPageId === undefined) n.boardPageId = "board-1";
      if (typeof n.boardPageId !== "string" || !n.boardPageId || n.boardPageId.length > 100) throw new Error("看板页面引用无效");
    }
    if(n.data !== undefined && (!n.data || typeof n.data!=="object" || Array.isArray(n.data) || JSON.stringify(n.data).length>1_000_000)) throw new Error("数据必须是 JSON 对象，且小于 1 MB");
    if(n.dataSource !== undefined) validateDataSource(n.dataSource);
    if(n.sharedDataSourceId !== undefined && (typeof n.sharedDataSourceId !== "string" || n.sharedDataSourceId.length > 100)) throw new Error("公共数据源引用无效");
    if(n.bindings!==undefined && (!n.bindings||typeof n.bindings!=="object"||Object.values(n.bindings).some(v=>typeof v!=="string")))throw new Error("数据绑定格式无效");
    if (n.interactions !== undefined) {
      if (!Array.isArray(n.interactions) || n.interactions.length > 100) throw new Error("交互规则格式无效");
      n.interactions = n.interactions.map((rule: unknown, index: number) => {
        const normalized = normalizeInteraction(rule, index);
        if (!normalized) throw new Error("交互规则格式无效");
        return normalized;
      });
    }
    ids.add(n.id);
  }
  const parents = new Map<string, string | null>(value.map((n) => [n.id, n.parentId]));
  for (const n of value) {
    const visited = new Set<string>([n.id]);
    let parent = n.parentId;
    while (parent && parents.has(parent)) {
      if (visited.has(parent)) throw new Error("场景分组存在循环引用");
      visited.add(parent);
      parent = parents.get(parent);
    }
  }
  return value as SceneNode[];
}

/// 缓存中的场景对象可能已被读取方持有，validateScene 会就地补默认值，克隆避免污染 store 缓存；
/// legacy 路径本来就经 JSON.parse 出全新对象，两条路径读取语义一致。
export function readScene(id: string): SceneNode[] | null {
  const scene = readSnapshotScene(id);
  if (scene) return validateScene(structuredClone(scene));
  if (isProjectStoreReady()) return null;
  const raw = localStorage.getItem(sceneKey(id));
  return raw === null ? null : validateScene(JSON.parse(raw));
}

export function persistScene(id: string, scene: SceneNode[]): void {
  const payload = composeSnapshot(id, { scene, savedAt: Date.now() });
  if (payload) writeSnapshot(id, payload);
  else localStorage.setItem(sceneKey(id), JSON.stringify(scene));
  const projects = loadProjects();
  const project = projects.find((item) => item.id === id);
  if (project) {
    project.updatedAt = Date.now();
    saveProjects(projects);
  }
}

/** 项目参数（交互 action "projectParams" 的 liveData 持久化）。 */
export function readProjectParams(id: string): Record<string, unknown> {
  const snapshot = readSnapshotState(id);
  try {
    const value: unknown = snapshot ? snapshot.params : JSON.parse(localStorage.getItem(`dw_params_${id}`) ?? "null");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

export function persistParams(id: string, params: Record<string, unknown>): void {
  const payload = composeSnapshot(id, { params, savedAt: Date.now() });
  if (payload) writeSnapshot(id, payload);
  else localStorage.setItem(`dw_params_${id}`, JSON.stringify(params));
}

/** 启动防抖：判断该项目是否存过看板页（替代对 dw_editor_ 裸键的直读）。 */
export function hasStoredBoardPages(id: string): boolean {
  const state = readSnapshotState(id);
  if (state) return Array.isArray((state.settings as Partial<EditorSettings> | null)?.boardPages);
  try { return Array.isArray(JSON.parse(localStorage.getItem(`dw_editor_${id}`) ?? "null")?.boardPages); } catch { return false; }
}

export function downloadFile(name: string, content: BlobPart, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]/g, "_");
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseProjectFile(raw: string, opts?: { migrateKitImages?: boolean }): {
  name: string; scene: SceneNode[]; settings: EditorSettings; params?: Record<string, unknown>;
  boardSize?: BoardSize; boardMedia?: PortableBoardMedia[];
} {
  const data = JSON.parse(raw);
  const settings = validateEditorSettings(data?.settings);
  const pageIds = new Set([...settings.boardPages.map((page) => page.id), BACKGROUND_BOARD_PAGE_ID, FOREGROUND_BOARD_PAGE_ID]);
  const activePageId = settings.boardActivePageId;
  const scene = validateScene(Array.isArray(data) ? data : data?.scene).map((node) =>
    node.type === "widget" && !pageIds.has(node.boardPageId ?? "") ? { ...node, boardPageId: activePageId } : node);
  // 2026-11-14 kits 图片 webp 迁移：编辑器导入的旧 JSON 把 png/jpg 引用改指 webp。
  // 发布包 viewer（migrateKitImages:false）例外——包内自带同代资产，重写反而 404。
  const migrate = <T,>(value: T): T => (opts?.migrateKitImages === false
    ? value : migrateLegacyKitImages(value) as T);
  return {
    name: !Array.isArray(data) && typeof data?.name === "string" ? data.name : "导入的项目",
    scene: migrate(scene),
    settings: migrate(settings),
    params: data?.params && typeof data.params === "object" && !Array.isArray(data.params) ? migrate(data.params) : undefined,
    boardSize: data?.boardSize && [data.boardSize.width,data.boardSize.height].every(n=>Number.isFinite(n)&&n>=100&&n<=8192) ? data.boardSize : undefined,
    boardMedia: Array.isArray(data?.boardMedia) ? data.boardMedia.slice(0, 64) as PortableBoardMedia[] : undefined,
  };
}

function validCustomMesh(value: unknown): boolean {
  const m=value as SceneNode["customMesh"];
  return Boolean(m && typeof m.bytes==="string" && m.bytes.length<=4_000_000 && /^RFdNM[A-Za-z0-9+/=]*$/.test(m.bytes) && Number.isInteger(m.triangles) && m.triangles>0 && typeof m.sourceName==="string");
}
export function validateEditorSettings(value: unknown): EditorSettings {
  const result=structuredClone(defaultEditorSettings);
  if(!value||typeof value!=="object")return result;
  const input=value as Partial<EditorSettings>;
  for(const k of ["background","groundColor","boardColor","boardFillColor"] as const) if(typeof input[k]==="string"&&/^#[0-9a-f]{6}$/i.test(input[k]!))result[k]=input[k]!;
  for(const k of ["ground","fog","grid","flylines","stats","boardOutline","boardCarouselEnabled","boardBackgroundEnabled","boardMusicEnabled"] as const) if(typeof input[k]==="boolean")result[k]=input[k]!;
  for(const [k,min,max] of [["time",0,24],["exposure",.1,3],["contrast",.1,3],["saturation",0,3],["fogDistance",20,600]] as const)if(typeof input[k]==="number"&&Number.isFinite(input[k]))result[k]=Math.max(min,Math.min(max,input[k]!));
  if(input.boardFit&&["contain","cover","responsive","original","stretch"].includes(input.boardFit))result.boardFit=input.boardFit;
  if(input.boardLayout&&["static","flow"].includes(input.boardLayout))result.boardLayout=input.boardLayout;
  if (input.boardCarouselAnimation && ["none", "fade", "slideX", "slideY"].includes(input.boardCarouselAnimation))
    result.boardCarouselAnimation = input.boardCarouselAnimation;
  else if (input.boardCarouselAnimation === "slide") result.boardCarouselAnimation = "slideX";
  else if (input.boardCarouselAnimation === "zoom") result.boardCarouselAnimation = "fade";
  if(input.boardBackgroundFill&&["stretch","tile","none"].includes(input.boardBackgroundFill))result.boardBackgroundFill=input.boardBackgroundFill;
  for(const [key,min,max] of [["boardCarouselDuration",0.1,60],["boardPageDuration",0.1,3600],["boardBackgroundBlur",0,80],["boardMusicVolume",0,100]] as const)
    if(typeof input[key]==="number"&&Number.isFinite(input[key]))result[key]=Math.max(min,Math.min(max,input[key]!));
  for(const key of ["boardBackgroundMediaId","boardBackgroundMediaName","boardMusicId","boardMusicName","boardVersion","boardElementUid"] as const)
    if(typeof input[key]==="string"&&input[key]!.length<=2048)result[key]=input[key]!;
  if(Array.isArray(input.boardInteractions))result.boardInteractions=input.boardInteractions.slice(0,100)
    .flatMap((rule, index) => {
      const normalized = normalizeInteraction(rule, index);
      return normalized ? [normalized] : [];
    });
  if(Array.isArray(input.boardSharedData))result.boardSharedData=input.boardSharedData.slice(0,32).flatMap((item) => {
    if(!item||typeof item.id!=="string"||!item.id||typeof item.name!=="string"||!item.name.trim()||typeof item.enabled!=="boolean")return [];
    const shared: BoardSharedData={id:item.id.slice(0,100),name:item.name.trim().slice(0,100),enabled:item.enabled};
    if(item.source){try{shared.source=validateDataSource(item.source)}catch{return []}}
    if(item.data&&typeof item.data==="object"&&!Array.isArray(item.data)){try{if(JSON.stringify(item.data).length<=1_000_000)shared.data=structuredClone(item.data)}catch{return []}}
    if(typeof item.fileName==="string")shared.fileName=item.fileName.slice(0,255);
    return [shared];
  });
  result.boardDataConditions = sanitizeDataConditions(input.boardDataConditions);
  if(Array.isArray(input.boardScripts))result.boardScripts=input.boardScripts.slice(0,20).flatMap((item) => {
    if(!item||typeof item.id!=="string"||!item.id||typeof item.name!=="string"||!item.name.trim()||typeof item.enabled!=="boolean"||typeof item.fileName!=="string"||typeof item.code!=="string"||item.code.length>100_000)return [];
    if(item.settingsJson!==undefined&&(typeof item.settingsJson!=="string"||item.settingsJson.length>100_000))return [];
    return [{id:item.id.slice(0,100),name:item.name.trim().slice(0,100),enabled:item.enabled,fileName:item.fileName.slice(0,255),code:item.code,...(item.settingsJson?{settingsJson:item.settingsJson}:{})} as BoardScript];
  });
  const currentBoardStyle: BoardStateStyle = {
    boardColor: result.boardColor, boardFillColor: result.boardFillColor, boardFit: result.boardFit, boardBackgroundEnabled: result.boardBackgroundEnabled,
    boardBackgroundMediaId: result.boardBackgroundMediaId, boardBackgroundMediaName: result.boardBackgroundMediaName,
    boardBackgroundFill: result.boardBackgroundFill, boardBackgroundBlur: result.boardBackgroundBlur,
    boardMusicEnabled: result.boardMusicEnabled, boardMusicId: result.boardMusicId,
    boardMusicName: result.boardMusicName, boardMusicVolume: result.boardMusicVolume,
  };
  result.boardDefaultState = sanitizeBoardStateStyle(input.boardDefaultState, currentBoardStyle);
  if (Array.isArray(input.boardStates)) result.boardStates = input.boardStates.slice(0, 12).flatMap((item) => {
    if (!item || typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name.trim()) return [];
    return [{ id: item.id.slice(0, 100), name: item.name.trim().slice(0, 100),
      style: sanitizeBoardStateStyle(item.style, currentBoardStyle) } satisfies BoardState];
  });
  if (typeof input.boardActiveStateId === "string" && result.boardStates.some((item) => item.id === input.boardActiveStateId))
    result.boardActiveStateId = input.boardActiveStateId;
  if (Array.isArray(input.boardPages)) result.boardPages = input.boardPages.slice(0, 12).flatMap((item) => {
    if (!item || typeof item.id !== "string" || !item.id || item.id === BACKGROUND_BOARD_PAGE_ID || item.id.length > 100 ||
        typeof item.name !== "string" || !item.name.trim()) return [];
    const dimension = (candidate: unknown, fallback: number) => typeof candidate === "number" && Number.isFinite(candidate)
      ? Math.max(100, Math.min(8192, candidate)) : fallback;
    return [{ id: item.id, name: item.name.trim().slice(0, 100),
      width: dimension(item.width, 1920), height: dimension(item.height, 1080),
      style: sanitizeBoardStateStyle(item.style, currentBoardStyle),
      ...(typeof item.cover === "string" && item.cover.length <= 1_000_000 ? { cover: item.cover } : {}) } satisfies BoardPage];
  });
  if (!result.boardPages.length) result.boardPages = structuredClone(defaultEditorSettings.boardPages);
  const backgroundPage = input.boardBackgroundPage as Partial<BoardPage> | undefined;
  if (backgroundPage && typeof backgroundPage === "object") {
    const dimension = (candidate: unknown, fallback: number) => typeof candidate === "number" && Number.isFinite(candidate)
      ? Math.max(100, Math.min(8192, candidate)) : fallback;
    result.boardBackgroundPage = {
      id: BACKGROUND_BOARD_PAGE_ID,
      name: "背景看板",
      width: dimension(backgroundPage.width, 1920),
      height: dimension(backgroundPage.height, 1080),
      style: sanitizeBoardStateStyle(backgroundPage.style, defaultEditorSettings.boardBackgroundPage.style),
      ...(typeof backgroundPage.cover === "string" && backgroundPage.cover.length <= 1_000_000
        ? { cover: backgroundPage.cover } : {}),
    };
  }
  // 前景看板为可选表面：缺省保持 null（底栏显示「前景 ⊕」，点击才创建）
  const foregroundPage = input.boardForegroundPage as Partial<BoardPage> | null | undefined;
  if (foregroundPage && typeof foregroundPage === "object") {
    const dimension = (candidate: unknown, fallback: number) => typeof candidate === "number" && Number.isFinite(candidate)
      ? Math.max(100, Math.min(8192, candidate)) : fallback;
    result.boardForegroundPage = {
      id: FOREGROUND_BOARD_PAGE_ID,
      name: "前景看板",
      width: dimension(foregroundPage.width, 1920),
      height: dimension(foregroundPage.height, 1080),
      style: sanitizeBoardStateStyle(foregroundPage.style, defaultEditorSettings.boardBackgroundPage.style),
      ...(typeof foregroundPage.cover === "string" && foregroundPage.cover.length <= 1_000_000
        ? { cover: foregroundPage.cover } : {}),
    };
  } else {
    result.boardForegroundPage = null;
  }
  result.boardActivePageId = typeof input.boardActivePageId === "string" &&
    result.boardPages.some((item) => item.id === input.boardActivePageId)
    ? input.boardActivePageId : result.boardPages[0]!.id;
  if(Array.isArray(input.bookmarks))result.bookmarks=input.bookmarks.slice(0,30).filter(b=>b&&typeof b.id==="string"&&typeof b.name==="string"&&Array.isArray(b.target)&&b.target.length===3&&[...b.target,b.yaw,b.pitch,b.dist].every(Number.isFinite));
  return result;
}

function sanitizeBoardStateStyle(value: unknown, fallback: BoardStateStyle): BoardStateStyle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...fallback };
  const input = value as BoardStateStyle;
  const result: BoardStateStyle = { ...fallback };
  if (typeof input.boardColor === "string" && /^#[0-9a-f]{6}$/i.test(input.boardColor)) result.boardColor = input.boardColor;
  if (typeof input.boardFillColor === "string" && /^#[0-9a-f]{6}$/i.test(input.boardFillColor)) result.boardFillColor = input.boardFillColor;
  if (input.boardFit && ["contain", "cover", "responsive", "original", "stretch"].includes(input.boardFit)) result.boardFit = input.boardFit;
  if (typeof input.boardBackgroundEnabled === "boolean") result.boardBackgroundEnabled = input.boardBackgroundEnabled;
  if (typeof input.boardBackgroundMediaId === "string" && input.boardBackgroundMediaId.length <= 2048) result.boardBackgroundMediaId = input.boardBackgroundMediaId;
  if (typeof input.boardBackgroundMediaName === "string" && input.boardBackgroundMediaName.length <= 255) result.boardBackgroundMediaName = input.boardBackgroundMediaName;
  if (input.boardBackgroundFill && ["stretch", "tile", "none"].includes(input.boardBackgroundFill)) result.boardBackgroundFill = input.boardBackgroundFill;
  if (typeof input.boardBackgroundBlur === "number" && Number.isFinite(input.boardBackgroundBlur)) result.boardBackgroundBlur = Math.max(0, Math.min(80, input.boardBackgroundBlur));
  if (typeof input.boardMusicEnabled === "boolean") result.boardMusicEnabled = input.boardMusicEnabled;
  if (typeof input.boardMusicId === "string" && input.boardMusicId.length <= 2048) result.boardMusicId = input.boardMusicId;
  if (typeof input.boardMusicName === "string" && input.boardMusicName.length <= 255) result.boardMusicName = input.boardMusicName;
  if (typeof input.boardMusicVolume === "number" && Number.isFinite(input.boardMusicVolume)) result.boardMusicVolume = Math.max(0, Math.min(100, input.boardMusicVolume));
  return result;
}

const optionalInteractionKeys = [
  "name", "targetIds", "targetScope", "settingKey", "settingSource", "triggerValue", "actionEventName",
  "itemValue", "condition", "sequence", "delayMs", "durationMs", "animation", "easing", "animationStack",
] as const;

function normalizeInteraction(value: unknown, index: number): Interaction | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const rule = { ...value } as Interaction;
  // Earlier snapshots serialized undefined object fields as JSON null.
  for (const key of optionalInteractionKeys) if (rule[key] == null) delete rule[key];
  if (!isValidInteraction(rule)) return undefined;
  return { ...rule, name: rule.name?.trim() || `交互${index + 1}` };
}

function isValidInteraction(rule: Interaction): boolean {
  return typeof rule.id==="string"&&(rule.name===undefined||typeof rule.name==="string"&&rule.name.length<=100)&&
    ["click","dblclick","mouseenter","mouseleave","componentEnter","componentLeave","componentSelected","componentUnselected","itemClick","data","boardActive","custom"].includes(rule.event)&&
    ["toggle","show","hide","focus","color","message","state","text","dialog","refresh","fullscreen","modify","componentCustom","projectParams","logout","payload","navigateBoard","openUrl","passEvent","devEvent","script","boardState","playEntrance","none"].includes(rule.action)&&
    typeof rule.targetId==="string"&&typeof rule.value==="string"&&rule.value.length<=100_000&&(rule.triggerValue===undefined||typeof rule.triggerValue==="string")&&(rule.actionEventName===undefined||typeof rule.actionEventName==="string")&&(rule.itemValue===undefined||typeof rule.itemValue==="string"&&rule.itemValue.length<=300)&&
    (rule.targetIds===undefined||Array.isArray(rule.targetIds)&&rule.targetIds.length<=100&&rule.targetIds.every(id=>typeof id==="string"&&id.length<=200))&&
    (rule.targetScope===undefined||isValidInteractionTargetScope(rule.targetScope))&&
    (rule.settingKey===undefined||typeof rule.settingKey==="string"&&rule.settingKey.length<=100)&&
    (rule.settingSource===undefined||isValidSettingSource(rule.settingSource))&&
    (rule.sequence===undefined||["with","after"].includes(rule.sequence))&&
    (rule.delayMs===undefined||Number.isFinite(rule.delayMs)&&rule.delayMs>=0&&rule.delayMs<=120_000)&&
    (rule.durationMs===undefined||Number.isFinite(rule.durationMs)&&rule.durationMs>=0&&rule.durationMs<=120_000)&&
    (rule.animation===undefined||["fade","slideLeft","slideRight","slideUp","slideDown","zoom"].includes(rule.animation))&&
    (rule.easing===undefined||["linear","exponentialIn","exponentialOut","easeInOut"].includes(rule.easing))&&
    (rule.animationStack===undefined||typeof rule.animationStack==="boolean")&&
    (!rule.condition||(typeof rule.condition.sourceId==="string"&&typeof rule.condition.field==="string"&&rule.condition.field.length<=100&&typeof rule.condition.value==="string"&&rule.condition.value.length<=300&&["==","!=",">","<",">=","<=","contains"].includes(rule.condition.op)));
}
export function readEditorSettings(id: string): EditorSettings {
  const state = readSnapshotState(id);
  if (state?.settings !== null && state?.settings !== undefined) {
    try { return validateEditorSettings(state.settings); } catch { /* 损坏快照回退 legacy 键与默认值 */ }
  }
  try{return validateEditorSettings(JSON.parse(localStorage.getItem(`dw_editor_${id}`)??"null"))}catch{return structuredClone(defaultEditorSettings)}
}
export function persistEditorSettings(id: string, settings: EditorSettings): void {
  const payload = composeSnapshot(id, { settings, savedAt: Date.now() });
  if (payload) writeSnapshot(id, payload);
  else localStorage.setItem(`dw_editor_${id}`,JSON.stringify(settings));
}
