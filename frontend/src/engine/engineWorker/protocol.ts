import type { EngineStats, FlatInstance } from "../../types";
import type { SoftCamera } from "../softwareRenderer";

/** 渲染 Worker 协议：主线程保留交互权威，Worker 持 wasm surface 自驱渲染。 */

/** 每帧渲染选项；time 由 Worker 时钟注入，主线程传入值仅主线程回退路径使用。 */
export interface SceneRenderOptions {
  grid: boolean;
  selectedId: string | null;
  selectedIds?: string[];
  background?: string;
  daylight?: number;
  /** false 时过滤 flyline 实例（与旧软件渲染路径的调用点过滤等价） */
  flylines: boolean;
}

export interface SceneSurface {
  render(flat: FlatInstance[], camera: SoftCamera, options: SceneRenderOptions): void;
  pickAt(x: number, y: number): Promise<string | null>;
  resize(width: number, height: number): void;
  registerModel(model: { id: string; bytes: Uint8Array }): void;
  renderSnapshot(width: number, height: number, flat: FlatInstance[], camera: SoftCamera,
    options: SceneRenderOptions): Promise<HTMLCanvasElement>;
  /** 导出默认尺寸（transferControlToOffscreen 后主线程读不到 canvas.width） */
  getSize(): { width: number; height: number };
  setStatsListener(listener: ((stats: EngineStats) => void) | null): void;
  dispose(): void;
}

// ---- 主线程 → Worker（scene3d 角色） ----
export type Scene3dCommand =
  | { type: "init3d"; canvas: OffscreenCanvas; width: number; height: number }
  | { type: "scene"; flat: FlatInstance[] }
  | { type: "camera"; camera: SoftCamera }
  | { type: "options"; options: SceneRenderOptions }
  | { type: "resize"; width: number; height: number }
  | { type: "registerModel"; id: string; bytes: Uint8Array }
  | { type: "pick"; requestId: number; x: number; y: number }
  | { type: "snapshot"; requestId: number; width: number; height: number; flat: FlatInstance[]; camera: SoftCamera; options: SceneRenderOptions }
  | { type: "visibility"; hidden: boolean }
  | { type: "dispose" };

// ---- Worker → 主线程 ----
export type Scene3dEvent =
  | { type: "ready"; threads: number }
  | { type: "stats"; fps: number; instances: number; debug?: Record<string, unknown> }
  | { type: "pickResult"; requestId: number; id: string | null }
  | { type: "snapshotResult"; requestId: number; buffer: ArrayBuffer }
  | { type: "workerError"; phase: "init" | "runtime"; message: string };

/** 请求-响应配对：call() 取号并返回 Promise，settle/fail 在收到响应或超时时结束等待。 */
export function createRequestHub<T>(timeoutMs: number) {
  let sequence = 0;
  const pending = new Map<number, { resolve: (value: T) => void; reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout> }>();
  return {
    call(): { requestId: number; done: Promise<T> } {
      const requestId = ++sequence;
      return { requestId, done: new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`渲染工作线程请求超时（#${requestId}）`));
        }, timeoutMs);
        pending.set(requestId, { resolve, reject, timer });
      }) };
    },
    settle(requestId: number, value: T): void {
      const entry = pending.get(requestId);
      if (!entry) return;
      pending.delete(requestId);
      clearTimeout(entry.timer);
      entry.resolve(value);
    },
    failAll(error: Error): void {
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(error);
      }
      pending.clear();
    },
    dispose(): void {
      this.failAll(new Error("渲染工作线程已关闭"));
    },
  };
}
