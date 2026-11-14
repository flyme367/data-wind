// 项目二进制存储：IndexedDB（FlatBuffers 快照）+ 内存缓存 + write-behind 写队列。
// main.tsx 启动时 await initProjectStore()；未初始化时（单测/降级环境）projects.ts
// 自动回退 legacy localStorage 路径，本模块不抛同步异常。
//
// Phase 2 零拷贝：缓存持有原始字节，字段级惰性解码——boot 只解 index；
// 场景树默认只在 worker 侧解码（loadSnapshot transfer 字节），主线程仅在
// 导出/复制等旁路场景按需解码并回填缓存。
import {
  decodeProjectIndex, decodeSnapshotHeader, decodeSnapshotScene, decodeSnapshotState,
  encodeProjectIndex, encodeProjectSnapshot, migrateLegacyKitImages, type SnapshotPayload,
} from "./snapshotCodec";
import type { ProjectMeta } from "./projects";

const DB_NAME = "data-wind";
const DB_VERSION = 1;
const INDEX_STORE = "index";
const SNAPSHOT_STORE = "snapshots";
const INDEX_KEY = "index";
export const STORE_ERROR_EVENT = "dw:store-error";

interface StoreBackend {
  getIndex(): Promise<Uint8Array | null>;
  putIndex(bytes: Uint8Array): Promise<void>;
  getSnapshot(id: string): Promise<Uint8Array | null>;
  putSnapshot(id: string, bytes: Uint8Array): Promise<void>;
}

interface CacheEntry {
  raw: Uint8Array;
  /** 惰性解码缓存（首次访问对应字段时回填） */
  state?: { settings: unknown; params: unknown };
  scene?: unknown[];
}

const cache = {
  ready: false,
  index: null as ProjectMeta[] | null,
  snapshots: new Map<string, CacheEntry>(),
};

let backend: StoreBackend | null = null;
let queue: Promise<void> = Promise.resolve();

function reportError(error: unknown, context: string): void {
  console.error(`[projectStore] ${context}`, error);
  try { window.dispatchEvent(new CustomEvent(STORE_ERROR_EVENT, { detail: `${context}: ${String(error)}` })); } catch { /* 非 DOM 环境 */ }
}

/** 写队列串行化：避免 IndexedDB 事务交错；失败只上报，不阻塞后续写。 */
function enqueue(task: () => Promise<void>): void {
  queue = queue.then(task).catch((error) => reportError(error, "写入失败"));
}

export const isProjectStoreReady = (): boolean => cache.ready;

export function readIndex(): ProjectMeta[] | null {
  return cache.index;
}

export function writeIndex(projects: ProjectMeta[]): void {
  cache.index = projects;
  if (!backend) return;
  const bytes = encodeProjectIndex(projects);
  enqueue(async () => { await backend!.putIndex(bytes); });
}

/** 快照标量头（name/savedAt/boardSize）：调用点少且解码极廉价，不做 memo。 */
export function readSnapshotMeta(id: string): ReturnType<typeof decodeSnapshotHeader> | null {
  const entry = cache.snapshots.get(id);
  if (!entry) return null;
  try { return decodeSnapshotHeader(entry.raw); } catch (error) { reportError(error, `快照损坏：${id}`); return null; }
}

/** settings/params 惰性解码并缓存。 */
export function readSnapshotState(id: string): { settings: unknown; params: unknown } | null {
  const entry = cache.snapshots.get(id);
  if (!entry) return null;
  if (!entry.state) {
    try { entry.state = decodeSnapshotState(entry.raw); } catch (error) { reportError(error, `快照损坏：${id}`); return null; }
  }
  return entry.state;
}

/** 场景树惰性解码并缓存（仅导出/复制等旁路；加载走 worker 零拷贝）。 */
export function readSnapshotScene(id: string): unknown[] | null {
  const entry = cache.snapshots.get(id);
  if (!entry) return null;
  if (!entry.scene) {
    try { entry.scene = decodeSnapshotScene(entry.raw); } catch (error) { reportError(error, `快照损坏：${id}`); return null; }
  }
  return entry.scene;
}

/** 原始快照字节副本（供 transfer 给 worker；返回 slice 保护缓存不被 detach）。 */
export function readSnapshotBytes(id: string): Uint8Array | null {
  const entry = cache.snapshots.get(id);
  return entry ? entry.raw.slice() : null;
}

export function writeSnapshot(id: string, payload: SnapshotPayload): void {
  const bytes = encodeProjectSnapshot(payload);
  cache.snapshots.set(id, { raw: bytes, state: { settings: payload.settings, params: payload.params }, scene: payload.scene });
  if (!backend) return;
  enqueue(async () => { await backend!.putSnapshot(id, bytes); });
}

// ------------------------------------------------------------ IndexedDB ----

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 请求失败"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(INDEX_STORE)) db.createObjectStore(INDEX_STORE);
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) db.createObjectStore(SNAPSHOT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开项目数据库"));
    request.onblocked = () => reject(new Error("项目数据库正在升级，请关闭其他编辑器标签后重试"));
  });
}

function idbBackend(db: IDBDatabase): StoreBackend {
  const withStore = async <T>(store: string, run: (objectStore: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const transaction = db.transaction(store, "readonly");
    return requestAsPromise(run(transaction.objectStore(store)));
  };
  return {
    getIndex: () => withStore(INDEX_STORE, (objectStore) => objectStore.get(INDEX_KEY)),
    putIndex: async (bytes) => {
      const transaction = db.transaction(INDEX_STORE, "readwrite");
      transaction.objectStore(INDEX_STORE).put(bytes, INDEX_KEY);
      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("索引写入失败"));
        transaction.onabort = () => reject(transaction.error ?? new Error("索引写入中止"));
      });
    },
    getSnapshot: (id) => withStore(SNAPSHOT_STORE, (objectStore) => objectStore.get(id)),
    putSnapshot: async (id, bytes) => {
      const transaction = db.transaction(SNAPSHOT_STORE, "readwrite");
      transaction.objectStore(SNAPSHOT_STORE).put(bytes, id);
      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("快照写入失败"));
        transaction.onabort = () => reject(transaction.error ?? new Error("快照写入中止"));
      });
    },
  };
}

function memoryBackend(): StoreBackend {
  const index = new Map<string, Uint8Array>();
  const snapshots = new Map<string, Uint8Array>();
  return {
    getIndex: async () => index.get(INDEX_KEY) ?? null,
    putIndex: async (bytes) => void index.set(INDEX_KEY, bytes),
    getSnapshot: async (id) => snapshots.get(id) ?? null,
    putSnapshot: async (id, bytes) => void snapshots.set(id, bytes),
  };
}

// ---------------------------------------------------------- legacy 迁移 ----

const finiteBoard = (value: unknown): value is { width: number; height: number } =>
  typeof value === "object" && value !== null &&
  [(value as { width: unknown }).width, (value as { height: unknown }).height]
    .every((n) => typeof n === "number" && Number.isFinite(n));

function parseJson(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
}

/** legacy localStorage 键（dw_scene_/dw_editor_/dw_board_/dw_params_）→ 快照载荷。 */
function legacySnapshot(id: string, name: string): SnapshotPayload | null {
  const scene = parseJson(`dw_scene_${id}`);
  if (scene === null) return null;
  const board = parseJson(`dw_board_${id}`);
  // legacy 场景不走快照解码，同样要把 kits 旧 png/jpg 引用改指迁移后的 webp。
  const migrate = (value: unknown) => value && typeof value === "object"
    ? migrateLegacyKitImages(value) : value;
  return {
    name, savedAt: Date.now(),
    boardSize: finiteBoard(board) ? board : { width: 1920, height: 1080 },
    scene: migrate(scene) as SnapshotPayload["scene"],
    settings: migrate(parseJson(`dw_editor_${id}`)),
    params: migrate(parseJson(`dw_params_${id}`)),
  };
}

function loadLegacyProjects(): ProjectMeta[] {
  const value = parseJson("dw_projects");
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ProjectMeta =>
    typeof item === "object" && item !== null && typeof (item as ProjectMeta).id === "string" &&
    typeof (item as ProjectMeta).name === "string" &&
    Number.isFinite((item as ProjectMeta).createdAt) && Number.isFinite((item as ProjectMeta).openedAt));
}

/** 把 legacy localStorage 项目迁入 IndexedDB；全部写成功后清理旧键。 */
async function migrateLegacyProjects(): Promise<void> {
  const legacy = loadLegacyProjects().filter((project) => !cache.snapshots.has(project.id));
  if (!legacy.length) return;
  const payloads: Array<[string, SnapshotPayload]> = [];
  for (const project of legacy) {
    const payload = legacySnapshot(project.id, project.name);
    if (payload) payloads.push([project.id, payload]);
  }
  if (payloads.length) {
    const merged = [...(cache.index ?? []), ...legacy];
    writeIndex(merged);
    for (const [id, payload] of payloads) writeSnapshot(id, payload);
    await queue; // 迁移写必须先落盘，成功后才允许删旧键
  }
  for (const project of legacy) {
    for (const prefix of ["dw_scene_", "dw_editor_", "dw_board_", "dw_params_"]) localStorage.removeItem(`${prefix}${project.id}`);
  }
  localStorage.removeItem("dw_projects");
}

// ---------------------------------------------------------------- 初始化 ----

/** 生产入口：打开 IndexedDB、预热索引缓存并迁移 legacy 数据；失败由调用方兜底 legacy 路径。
 *  快照只缓存原始字节（字段级惰性解码），boot 不再解码任何场景/设置。 */
export async function initProjectStore(): Promise<void> {
  if (cache.ready) return;
  const db = await openDatabase();
  backend = idbBackend(db);
  const indexBytes = await backend.getIndex().catch(() => null);
  let index: ProjectMeta[] = [];
  if (indexBytes) {
    try { index = decodeProjectIndex(indexBytes); } catch (error) { reportError(error, "项目索引损坏"); }
  }
  for (const project of index) {
    const bytes = await backend.getSnapshot(project.id).catch(() => null);
    if (bytes) cache.snapshots.set(project.id, { raw: bytes });
  }
  cache.index = index;
  cache.ready = true;
  await migrateLegacyProjects();
}

/** 测试入口：内存后端，不触碰 IndexedDB 与 localStorage。 */
export function initMemoryProjectStore(): void {
  backend = memoryBackend();
  cache.index = [];
  cache.snapshots.clear();
  cache.ready = true;
}

/** 测试辅助：清空缓存回到未初始化状态（恢复 legacy 路径）。 */
export function resetProjectStore(): void {
  backend = null;
  cache.index = null;
  cache.snapshots.clear();
  cache.ready = false;
  queue = Promise.resolve();
}
