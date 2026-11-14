import { modelAssetInfo, verifyModelAsset } from "../engine/modelAsset";

export interface ModelAssetMeta {
  id: string;
  name: string;
  sourceName: string;
  savedAt: number;
  triangles: number;
  textures: number;
  size: number;
}

const CHANGE_EVENT = "dw:model-assets";
const DATABASE = "dw_model_assets";
let openPromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  openPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("models", { keyPath: "id" });
      request.result.createObjectStore("bytes");
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); openPromise = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("无法打开本地模型库"));
    request.onblocked = () => reject(new Error("模型库被其他页面占用，请关闭其他页面后重试"));
  }).catch((error: unknown) => { openPromise = undefined; throw error; });
  return openPromise;
}

export async function listModelAssets(): Promise<ModelAssetMeta[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("models", "readonly");
    const request = tx.objectStore("models").getAll();
    tx.oncomplete = () => resolve((request.result as ModelAssetMeta[]).sort((a, b) => b.savedAt - a.savedAt));
    tx.onerror = () => reject(tx.error ?? new Error("读取模型库失败"));
    tx.onabort = () => reject(tx.error ?? new Error("读取模型库失败"));
  });
}

export async function getModelAsset(id: string): Promise<Uint8Array> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("bytes", "readonly");
    const request = tx.objectStore("bytes").get(id);
    tx.oncomplete = () => request.result instanceof ArrayBuffer
      ? resolve(new Uint8Array(request.result)) : reject(new Error("模型文件不存在"));
    tx.onerror = () => reject(tx.error ?? new Error("读取模型文件失败"));
    tx.onabort = () => reject(tx.error ?? new Error("读取模型文件失败"));
  });
}

export async function saveModelAsset(bytes: Uint8Array, sourceName: string): Promise<ModelAssetMeta> {
  await verifyModelAsset(bytes);
  const info = modelAssetInfo(bytes);
  const meta: ModelAssetMeta = { id: crypto.randomUUID(), ...info, sourceName, savedAt: Date.now(), size: bytes.byteLength };
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["models", "bytes"], "readwrite");
    tx.objectStore("models").put(meta);
    tx.objectStore("bytes").put(bytes.slice().buffer, meta.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("保存模型失败，请检查浏览器存储空间"));
    tx.onabort = () => reject(tx.error ?? new Error("保存模型失败，请检查浏览器存储空间"));
  });
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return meta;
}

export async function deleteModelAsset(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["models", "bytes"], "readwrite");
    tx.objectStore("models").delete(id);
    tx.objectStore("bytes").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("删除模型失败"));
    tx.onabort = () => reject(tx.error ?? new Error("删除模型失败"));
  });
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function onModelAssetsChanged(listener: () => void) {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
