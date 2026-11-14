import { decodePreviewFrame } from "../captureFrame";
import type { EngineStats, FlatInstance } from "../../types";
import type { ModelBuffer } from "../modelLibrary";
import { SoftwareRenderer, type SoftCamera } from "../softwareRenderer";
import { createRequestHub, type Scene3dEvent, type SceneRenderOptions, type SceneSurface } from "./protocol";

const filtered = (flat: FlatInstance[], options: SceneRenderOptions): FlatInstance[] =>
  options.flylines ? flat : flat.filter((item) => item.kind !== "flyline");

/** localStorage 在隐私模式等场景会抛异常，读一次缓存结果 */
const debugStatsEnabled = (): boolean => {
  try { return localStorage.getItem("dw_debug_stats") === "1"; } catch { return false; }
};

function frameToCanvas(buffer: ArrayBuffer): HTMLCanvasElement {
  const frame = decodePreviewFrame(new Uint8Array(buffer));
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法创建截图画布");
  context.putImageData(new ImageData(frame.pixels, frame.width, frame.height), 0, 0);
  return canvas;
}

export function camerasEqual(previous: SoftCamera | null, next: SoftCamera): boolean {
  return Boolean(previous) && previous!.target[0] === next.target[0] && previous!.target[1] === next.target[1]
    && previous!.target[2] === next.target[2] && previous!.yaw === next.yaw
    && previous!.pitch === next.pitch && previous!.dist === next.dist;
}

export function optionsChanged(previous: SceneRenderOptions | null, next: SceneRenderOptions): boolean {
  if (!previous) return true;
  return previous.grid !== next.grid || previous.selectedId !== next.selectedId
    || previous.background !== next.background || previous.daylight !== next.daylight
    || (previous.selectedIds ?? []).join("|") !== (next.selectedIds ?? []).join("|");
}

/** OffscreenCanvas 渲染 Worker 的主线程客户端：render() 只做差量 postMessage，重绘由 Worker 自驱。 */
export class SceneRenderWorkerClient implements SceneSurface {
  private readonly worker: Worker;
  private readonly readyPromise: Promise<void>;
  private readonly picks = createRequestHub<string | null>(5000);
  private readonly snapshots = createRequestHub<ArrayBuffer>(15000);
  private statsListener: ((stats: EngineStats) => void) | null = null;
  private attached = false;
  private size = { width: 1, height: 1 };
  private lastFlat: FlatInstance[] | null = null;
  private lastFlylines: boolean | null = null;
  private lastCamera: SoftCamera | null = null;
  private lastOptions: SceneRenderOptions | null = null;

  private constructor() {
    this.worker = new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" });
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("渲染工作线程加载超时")), 30_000);
      this.worker.onmessage = (event: MessageEvent<Scene3dEvent>) => {
        const message = event.data;
        if (message.type === "ready") {
          clearTimeout(timer);
          resolve();
          return;
        }
        if (message.type === "workerError" && message.phase === "init") {
          clearTimeout(timer);
          reject(new Error(message.message));
          return;
        }
        this.handleMessage(message);
      };
      this.worker.onerror = (event) => {
        clearTimeout(timer);
        this.picks.failAll(new Error("渲染工作线程崩溃"));
        this.snapshots.failAll(new Error("渲染工作线程崩溃"));
        reject(new Error(event.message || "渲染工作线程加载失败"));
      };
    });
    const onVisibility = () => {
      if (this.attached) this.worker.postMessage({ type: "visibility", hidden: document.hidden });
    };
    document.addEventListener("visibilitychange", onVisibility);
    this.readyPromise.catch(() => { document.removeEventListener("visibilitychange", onVisibility); });
  }

  static async create(): Promise<SceneRenderWorkerClient | null> {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined"
      || !HTMLCanvasElement.prototype.transferControlToOffscreen) return null;
    try {
      const client = new SceneRenderWorkerClient();
      await client.readyPromise;
      return client;
    } catch (error) {
      console.warn("3D 渲染工作线程不可用，回退主线程软渲。", error);
      return null;
    }
  }

  private handleMessage(message: Scene3dEvent): void {
    switch (message.type) {
      case "stats":
        // 调试开关：localStorage.dw_debug_stats=1 才打渲染统计明细，避免每 500ms 刷红色噪音
        if (message.debug && debugStatsEnabled()) console.log("[worker-stats]", JSON.stringify(message.debug));
        this.statsListener?.({ backend: "CPU", fps: message.fps, instances: message.instances,
          visible: message.instances, particles: 0, tris: 0 });
        break;
      case "pickResult":
        this.picks.settle(message.requestId, message.id);
        break;
      case "snapshotResult":
        this.snapshots.settle(message.requestId, message.buffer);
        break;
      case "workerError":
        console.error("渲染工作线程错误：", message.message);
        break;
      case "ready":
        break;
    }
  }

  attach(canvas: HTMLCanvasElement, width: number, height: number): void {
    this.size = { width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) };
    const offscreen = canvas.transferControlToOffscreen();
    this.attached = true;
    this.worker.postMessage({ type: "init3d", canvas: offscreen, width: this.size.width, height: this.size.height },
      [offscreen]);
  }

  render(flat: FlatInstance[], camera: SoftCamera, options: SceneRenderOptions): void {
    if (!this.attached) return;
    if (flat !== this.lastFlat || options.flylines !== this.lastFlylines) {
      this.lastFlat = flat;
      this.lastFlylines = options.flylines;
      this.worker.postMessage({ type: "scene", flat: filtered(flat, options) });
    }
    if (!camerasEqual(this.lastCamera, camera)) {
      this.lastCamera = { target: [...camera.target] as SoftCamera["target"], yaw: camera.yaw, pitch: camera.pitch, dist: camera.dist };
      this.worker.postMessage({ type: "camera", camera: this.lastCamera });
    }
    if (optionsChanged(this.lastOptions, options)) {
      this.lastOptions = { ...options, selectedIds: [...(options.selectedIds ?? [])] };
      this.worker.postMessage({ type: "options", options: this.lastOptions });
    }
  }

  async pickAt(x: number, y: number): Promise<string | null> {
    if (!this.attached) return null;
    const { requestId, done } = this.picks.call();
    this.worker.postMessage({ type: "pick", requestId, x, y });
    return done.catch(() => null);
  }

  resize(width: number, height: number): void {
    this.size = { width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) };
    if (!this.attached) return;
    this.worker.postMessage({ type: "resize", width: this.size.width, height: this.size.height });
  }

  registerModel(model: ModelBuffer): void {
    if (!this.attached) return;
    this.worker.postMessage({ type: "registerModel", id: model.id, bytes: model.bytes });
  }

  async renderSnapshot(width: number, height: number, flat: FlatInstance[], camera: SoftCamera,
    options: SceneRenderOptions): Promise<HTMLCanvasElement> {
    if (!this.attached) throw new Error("渲染工作线程尚未就绪");
    const { requestId, done } = this.snapshots.call();
    this.worker.postMessage({ type: "snapshot", requestId, width, height, flat, camera, options });
    return frameToCanvas(await done);
  }

  getSize(): { width: number; height: number } {
    return { ...this.size };
  }

  setStatsListener(listener: ((stats: EngineStats) => void) | null): void {
    this.statsListener = listener;
  }

  dispose(): void {
    this.picks.dispose();
    this.snapshots.dispose();
    this.worker.terminate();
  }
}

/** 主线程回退：包装现有 SoftwareRenderer，与 Worker 客户端共用 SceneSurface 接口。 */
class MainThreadSoftwareSurface implements SceneSurface {
  private frames = 0;
  private lastStats = 0;
  private statsListener: ((stats: EngineStats) => void) | null = null;

  constructor(private readonly renderer: SoftwareRenderer) {}

  render(flat: FlatInstance[], camera: SoftCamera, options: SceneRenderOptions): void {
    const now = performance.now();
    this.renderer.render(filtered(flat, options), camera, {
      grid: options.grid, selectedId: options.selectedId, time: now / 1000,
      background: options.background, daylight: options.daylight, selectedIds: options.selectedIds,
    });
    this.frames += 1;
    if (now - this.lastStats > 500) {
      this.statsListener?.({ backend: "CPU", fps: Math.round(this.frames * 1000 / (now - this.lastStats)),
        instances: flat.length, visible: flat.length, particles: 0, tris: 0 });
      this.frames = 0;
      this.lastStats = now;
    }
  }

  async pickAt(x: number, y: number): Promise<string | null> {
    return this.renderer.pick(x, y) ?? null;
  }

  resize(width: number, height: number): void {
    this.renderer.resize(width, height);
  }

  registerModel(model: ModelBuffer): void {
    this.renderer.registerModel(model);
  }

  async renderSnapshot(width: number, height: number, flat: FlatInstance[], camera: SoftCamera,
    options: SceneRenderOptions): Promise<HTMLCanvasElement> {
    return this.renderer.renderSnapshot(width, height, filtered(flat, options), camera, {
      grid: options.grid, selectedId: null, selectedIds: [], time: performance.now() / 1000,
      background: options.background, daylight: options.daylight,
    });
  }

  getSize(): { width: number; height: number } {
    return this.renderer.size;
  }

  setStatsListener(listener: ((stats: EngineStats) => void) | null): void {
    this.statsListener = listener;
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

/** 优先创建渲染 Worker（OffscreenCanvas + 独立 wasm），失败回退主线程 SoftwareRenderer。 */
export async function createSceneSurface(canvas: HTMLCanvasElement, width: number, height: number): Promise<SceneSurface> {
  const client = await SceneRenderWorkerClient.create();
  if (client) {
    try {
      client.attach(canvas, width, height);
      return client;
    } catch (error) {
      console.warn("OffscreenCanvas 渲染不可用，回退主线程软渲。", error);
      client.dispose();
    }
  }
  return new MainThreadSoftwareSurface(await SoftwareRenderer.create(canvas));
}
