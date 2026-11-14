import { modelAssetById } from "../data/modelCatalog";

export type ModelBuffer = { id: string; bytes: Uint8Array };
const pending = new Map<string, Promise<ModelBuffer>>();
const cachedModels = new Map<string, ModelBuffer>();
const MAX_MODEL_CACHE_BYTES = 64 * 1024 * 1024;
let cachedBytes = 0;

function cacheModel(model: ModelBuffer): void {
  if (model.bytes.byteLength > MAX_MODEL_CACHE_BYTES) return;
  while (cachedBytes + model.bytes.byteLength > MAX_MODEL_CACHE_BYTES) {
    const oldest = cachedModels.keys().next().value;
    if (oldest === undefined) break;
    const evicted = cachedModels.get(oldest)!;
    cachedModels.delete(oldest);
    cachedBytes -= evicted.bytes.byteLength;
  }
  cachedModels.set(model.id, model);
  cachedBytes += model.bytes.byteLength;
}

/** Share concurrent requests and retain recently used mesh bytes up to a fixed budget. */
export function loadModelBuffer(id: string, custom?: { bytes: string }): Promise<ModelBuffer> {
  const cached = cachedModels.get(id);
  if (cached) {
    cachedModels.delete(id);
    cachedModels.set(id, cached);
    return Promise.resolve(cached);
  }
  const existing = pending.get(id);
  if (existing) return existing;
  const request = (async () => {
    if (custom) {
      const data = atob(custom.bytes);
      return { id, bytes: Uint8Array.from(data, (character) => character.charCodeAt(0)) };
    }
    const asset = modelAssetById.get(id);
    if (!asset) throw new Error(`未找到模型：${id}`);
    const response = await fetch(asset.mesh.startsWith("/") ? `.${asset.mesh}` : asset.mesh);
    if (!response.ok) throw new Error(`无法加载模型：${asset.name}`);
    return { id: asset.id, bytes: new Uint8Array(await response.arrayBuffer()) };
  })().then((model) => { cacheModel(model); return model; })
    .finally(() => { pending.delete(id); });
  pending.set(id, request);
  return request;
}
