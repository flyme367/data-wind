import type { SceneSnapshot, SceneOp, SceneMessage } from "./scene.worker";
import type { AssetItem } from "./assets.worker";

export type { SceneSnapshot, SceneOp };

type Listener = (msg: SceneSnapshot) => void;

function createSceneBridge() {
  const worker = new Worker(new URL("./scene.worker.ts", import.meta.url), {
    type: "module",
  });
  const listeners = new Set<Listener>();
  let latest: SceneSnapshot | null = null;
  let sequence = 0;
  const checkpoints = new Map<number, { projectId: string; resolve: (value: SceneSnapshot) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  worker.onmessage = (e: MessageEvent<SceneMessage>) => {
    const message = e.data;
    if (message.type === "checkpoint") {
      const pending = checkpoints.get(message.requestId);
      if (!pending) return;
      checkpoints.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.snapshot.projectId !== pending.projectId) pending.reject(new Error("项目已切换，请重新保存"));
      else if (message.snapshot.loadError) pending.reject(new Error(message.snapshot.loadError));
      else pending.resolve(message.snapshot);
      return;
    }
    if (message.type === "sceneChanged") {
      latest = message;
    } else if (message.type === "selectionChanged" && latest &&
      message.projectId === latest.projectId && message.revision === latest.revision) {
      // Preserve geometry references so a selection never triggers a full WASM scene upload.
      latest = { ...latest, selectedId: message.selectedId, selectedIds: message.selectedIds };
    } else return;
    const snapshot = latest;
    listeners.forEach((listener) => listener(snapshot));
  };
  worker.onerror = () => {
    for (const pending of checkpoints.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("场景工作线程发生错误，无法保存"));
    }
    checkpoints.clear();
  };
  return {
    post(op: SceneOp): void {
      // 零拷贝加载：快照字节 transfer 给 worker（所有权转移，主线程不再持有）
      if (op.type === "loadSnapshot") worker.postMessage(op, [op.data]);
      else worker.postMessage(op);
    },
    subscribe(l: Listener): () => void {
      listeners.add(l);
      if (latest) l(latest);
      return () => listeners.delete(l);
    },
    snapshot(): SceneSnapshot | null {
      return latest;
    },
    checkpoint(projectId: string): Promise<SceneSnapshot> {
      const requestId = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          checkpoints.delete(requestId);
          reject(new Error("保存超时，请稍后重试"));
        }, 10_000);
        checkpoints.set(requestId, { projectId, resolve, reject, timer });
        try { worker.postMessage({ type: "checkpoint", requestId }); }
        catch (error) {
          clearTimeout(timer);
          checkpoints.delete(requestId);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
  };
}

function createAssetsBridge() {
  const worker = new Worker(new URL("./assets.worker.ts", import.meta.url), {
    type: "module",
  });
  const listeners = new Set<(query: string, items: AssetItem[], counts: Record<string, number>) => void>();
  worker.onmessage = (e: MessageEvent) => {
    if (e.data?.type === "searchResult") {
      listeners.forEach((l) => l(e.data.query, e.data.items, e.data.counts));
    }
  };
  return {
    search(query: string): void {
      worker.postMessage({ type: "search", query });
    },
    subscribe(l: (query: string, items: AssetItem[], counts: Record<string, number>) => void): () => void {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

let sceneBridge: ReturnType<typeof createSceneBridge> | null = null;
let assetsBridge: ReturnType<typeof createAssetsBridge> | null = null;

export function getSceneBridge() {
  if (!sceneBridge) sceneBridge = createSceneBridge();
  return sceneBridge;
}

export function getAssetsBridge() {
  if (!assetsBridge) assetsBridge = createAssetsBridge();
  return assetsBridge;
}
