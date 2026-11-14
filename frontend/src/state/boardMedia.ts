import type { BoardStateStyle, EditorSettings } from "../data/editor";

export interface BoardMediaRecord {
  id: string;
  name: string;
  type: string;
  blob: Blob;
}

export interface PortableBoardMedia {
  id: string;
  name: string;
  type: string;
  data: string;
}

const DB_NAME = "dw_board_media";
const STORE = "assets";
let opening: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = null; reject(request.error ?? new Error("无法打开本地媒体库")); };
    request.onblocked = () => { opening = null; reject(new Error("本地媒体库正在升级，请关闭其他编辑器标签后重试")); };
  });
  return opening;
}

export async function saveBoardMedia(file: File): Promise<BoardMediaRecord> {
  return saveBoardMediaBlob(file, file.name, file.type);
}

export async function saveBoardMediaBlob(blob: Blob, name: string, type: string, id = crypto.randomUUID()): Promise<BoardMediaRecord> {
  const db = await openDatabase();
  const record: BoardMediaRecord = { id, name, type, blob };
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("媒体文件保存失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("媒体文件保存失败"));
  });
  return record;
}

export async function readBoardMedia(id: string): Promise<BoardMediaRecord | null> {
  if (!id) return null;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
    request.onsuccess = () => resolve((request.result as BoardMediaRecord | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("媒体文件读取失败"));
  });
}

export async function removeBoardMedia(id: string): Promise<void> {
  if (!id) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("媒体文件删除失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("媒体文件删除失败"));
  });
}

function referencedMediaIds(settings: EditorSettings): Set<string> {
  const ids = new Set<string>();
  const collect = (style: BoardStateStyle | undefined) => {
    if (style?.boardBackgroundMediaId) ids.add(style.boardBackgroundMediaId);
    if (style?.boardMusicId) ids.add(style.boardMusicId);
  };
  collect(settings);
  collect(settings.boardDefaultState);
  settings.boardStates.forEach((item) => collect(item.style));
  settings.boardPages.forEach((item) => collect(item.style));
  collect(settings.boardBackgroundPage.style);
  return ids;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize)
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  return btoa(binary);
}

/** JSON project files carry the media bytes so a project can move to another browser/device. */
export async function exportBoardMedia(settings: EditorSettings): Promise<PortableBoardMedia[]> {
  const ids = [...referencedMediaIds(settings)].filter((id) => !id.startsWith("./") && !id.startsWith("media/") && !/^https?:\/\//i.test(id));
  const records = await Promise.all(ids.map(readBoardMedia));
  if (records.some((record) => !record)) throw new Error("看板背景或音乐文件不在当前浏览器媒体库中，请重新上传后再导出");
  const present = records.filter((record): record is BoardMediaRecord => Boolean(record));
  const totalBytes = present.reduce((total, record) => total + record.blob.size, 0);
  if (totalBytes > 50_000_000) throw new Error("项目媒体总量超过 50 MB，请改用发布包导出或减少媒体文件");
  return Promise.all(present.map(async (record) => {
    const data = bytesToBase64(new Uint8Array(await record.blob.arrayBuffer()));
    return { id: record.id, name: record.name, type: record.type, data: `data:${record.type || "application/octet-stream"};base64,${data}` };
  }));
}

/** Restore project-file media under new IDs and rewrite every style reference atomically. */
export async function restoreBoardMedia(
  settings: EditorSettings,
  assets: PortableBoardMedia[] | undefined,
): Promise<EditorSettings> {
  if (!assets?.length) return settings;
  const remap = new Map<string, string>();
  const savedIds: string[] = [];
  let totalBytes = 0;
  try {
    for (const asset of assets) {
      if (!asset || typeof asset.id !== "string" || typeof asset.name !== "string" || typeof asset.type !== "string" || typeof asset.data !== "string")
        throw new Error("项目媒体格式无效");
      const match = /^data:([^;,]+)?;base64,([A-Za-z0-9+/]*={0,2})$/.exec(asset.data);
      if (!match) throw new Error(`媒体「${asset.name}」不是有效的 Base64 文件`);
      const binary = atob(match[2]!);
      totalBytes += binary.length;
      if (totalBytes > 50_000_000) throw new Error("项目媒体总量超过 50 MB");
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const id = crypto.randomUUID();
      await saveBoardMediaBlob(new Blob([bytes], { type: asset.type || match[1] || "application/octet-stream" }), asset.name.slice(0, 255), asset.type || match[1] || "application/octet-stream", id);
      savedIds.push(id);
      remap.set(asset.id, id);
    }
  } catch (error) {
    await Promise.all(savedIds.map((id) => removeBoardMedia(id).catch(() => {})));
    throw error;
  }
  const rewrite = (style: BoardStateStyle): BoardStateStyle => ({ ...style,
    ...(style.boardBackgroundMediaId && remap.has(style.boardBackgroundMediaId)
      ? { boardBackgroundMediaId: remap.get(style.boardBackgroundMediaId)! } : {}),
    ...(style.boardMusicId && remap.has(style.boardMusicId) ? { boardMusicId: remap.get(style.boardMusicId)! } : {}),
  });
  return {
    ...settings,
    ...rewrite(settings),
    boardDefaultState: rewrite(settings.boardDefaultState),
    boardStates: settings.boardStates.map((item) => ({ ...item, style: rewrite(item.style) })),
    boardPages: settings.boardPages.map((item) => ({ ...item, style: rewrite(item.style) })),
    boardBackgroundPage: { ...settings.boardBackgroundPage, style: rewrite(settings.boardBackgroundPage.style) },
  };
}

/** Resolve referenced local media to portable relative paths for the static publish ZIP. */
export async function packageBoardMedia(settings: EditorSettings): Promise<{ settings: EditorSettings; files: Record<string, Uint8Array> }> {
  const ids = [...referencedMediaIds(settings)].filter((id) => !id.startsWith("./") && !id.startsWith("media/") && !/^https?:\/\//i.test(id));
  const records = await Promise.all(ids.map(readBoardMedia));
  if (records.some((record) => !record)) throw new Error("发布包引用的看板媒体不在当前浏览器媒体库中，请重新上传后再导出");
  const files: Record<string, Uint8Array> = {};
  const paths = new Map<string, string>();
  let total = 0;
  for (const record of records) {
    if (!record) continue;
    total += record.blob.size;
    if (total > 80_000_000) throw new Error("看板媒体总量超过发布包 80 MB 限制");
    const extension = /\.[a-z0-9]{1,8}$/i.exec(record.name)?.[0] ??
      (record.type.startsWith("image/") ? `.${record.type.slice(6)}` : record.type.startsWith("audio/") ? `.${record.type.slice(6)}` : record.type.startsWith("video/") ? `.${record.type.slice(6)}` : ".bin");
    const path = `media/${record.id}${extension.toLowerCase()}`;
    files[path] = new Uint8Array(await record.blob.arrayBuffer());
    paths.set(record.id, `./${path}`);
  }
  const rewrite = (style: BoardStateStyle): BoardStateStyle => ({ ...style,
    ...(style.boardBackgroundMediaId && paths.has(style.boardBackgroundMediaId)
      ? { boardBackgroundMediaId: paths.get(style.boardBackgroundMediaId)! } : {}),
    ...(style.boardMusicId && paths.has(style.boardMusicId) ? { boardMusicId: paths.get(style.boardMusicId)! } : {}),
  });
  return { files, settings: {
    ...settings, ...rewrite(settings), boardDefaultState: rewrite(settings.boardDefaultState),
    boardStates: settings.boardStates.map((item) => ({ ...item, style: rewrite(item.style) })),
    boardPages: settings.boardPages.map((item) => ({ ...item, style: rewrite(item.style) })),
  } };
}
