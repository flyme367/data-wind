/// <reference lib="webworker" />
import { decodePreviewFrame } from "../captureFrame";
import { encodeSoftwareFrame } from "../commands";
import type { FlatInstance } from "../../types";
import type { SoftCamera } from "../softwareRenderer";
import type { Scene3dCommand, Scene3dEvent, SceneRenderOptions } from "./protocol";

type SoftwareSurface = InstanceType<(typeof import("../../wasm/cpu/data_wind_cpu.js"))["SoftwareCanvas"]>;

/** Worker 内的 wasm 初始化：跨源隔离时用 parallel 构建（rayon 多核光栅），否则单线程 portable。 */
async function loadEngine(): Promise<{ surface: SoftwareSurface; threads: number }> {
  const cores = globalThis.navigator?.hardwareConcurrency ?? 1;
  if (globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined" && cores >= 2) {
    try {
      const parallel = await import("../../wasm/cpu-parallel/data_wind_cpu.js");
      await parallel.default();
      // 主线程编辑器与场景 worker 也要线程配额，渲染 Worker 限 4 以内避免线程爆炸
      const threads = Math.min(4, Math.max(1, cores - 2));
      await parallel.initThreadPool(Math.max(1, threads));
      return { surface: new parallel.SoftwareCanvas(), threads: parallel.cpu_threads() };
    } catch (error) {
      console.warn("渲染 Worker 线程池不可用，回退单线程。", error);
    }
  }
  const portable = await import("../../wasm/cpu/data_wind_cpu.js");
  await portable.default();
  return { surface: new portable.SoftwareCanvas(), threads: portable.cpu_threads() };
}

const post = (message: Scene3dEvent, transfer: Transferable[] = []) => {
  (self as unknown as Worker).postMessage(message, transfer);
};

let surface: SoftwareSurface | null = null;
let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;
let width = 1;
let height = 1;
let instances: FlatInstance[] = [];
let camera: SoftCamera = { target: [2, 2, 0], yaw: 0.75, pitch: 0.55, dist: 72 };
let options: SceneRenderOptions = { grid: true, selectedId: null, selectedIds: [], flylines: true };
let hidden = false;
let dirty = true;
let disposed = false;
let loopTimer: ReturnType<typeof setTimeout> | null = null;
let renderedFrames = 0;
let statsAt = 0;

const payload = (flat: FlatInstance[], cameraValue: SoftCamera, optionsValue: SceneRenderOptions, time: number): Uint8Array =>
  // Rust 侧按 CommandRequest(SoftwareFrame) FlatBuffers 解码,不是 JSON(协议迁移 DWCR v1)
  encodeSoftwareFrame(optionsValue.flylines ? flat : flat.filter((item) => item.kind !== "flyline"),
    cameraValue, {
      grid: optionsValue.grid, selectedId: optionsValue.selectedId, time,
      background: optionsValue.background, daylight: optionsValue.daylight, selectedIds: optionsValue.selectedIds,
    });

function paint(time: number): void {
  if (!surface || !canvas || !context) return;
  const bytes = surface.frame(width, height, payload(instances, camera, options, time), false);
  const frame = decodePreviewFrame(bytes);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  context.putImageData(new ImageData(frame.pixels, frame.width, frame.height), 0, 0);
}

/** 自驱渲染环：有变更或存在飞线动画才重绘；帧耗时超过预算时自然降帧。 */
function tick(): void {
  if (disposed) return;
  const started = performance.now();
  if (!hidden && surface) {
    const animated = options.flylines && instances.some((item) => item.kind === "flyline");
    if (dirty || animated) {
      try {
        paint(started / 1000);
        dirty = false;
        renderedFrames += 1;
      } catch (error) {
        post({ type: "workerError", phase: "runtime", message: error instanceof Error ? error.message : String(error) });
      }
    }
    if (started - statsAt > 500) {
      post({ type: "stats", fps: Math.round(renderedFrames * 1000 / Math.max(1, started - statsAt)), instances: instances.length,
        debug: { animated: options.flylines && instances.some((item) => item.kind === "flyline"),
          flylines: options.flylines, hidden, dirty,
          kinds: instances.reduce<Record<string, number>>((acc, item) => { acc[item.kind] = (acc[item.kind] ?? 0) + 1; return acc; }, {}) } });
      renderedFrames = 0;
      statsAt = started;
    }
  }
  const spent = performance.now() - started;
  loopTimer = setTimeout(tick, Math.max(2, 33 - spent));
}

// 用 addEventListener 而非 self.onmessage：wasm 胶水（pthreads/rayon）可能在同作用域覆盖 onmessage
self.addEventListener("message", (event: MessageEvent<Scene3dCommand>) => {
  const message = event.data;
  if (disposed) return;
  switch (message.type) {
    case "init3d":
      canvas = message.canvas;
      context = canvas.getContext("2d");
      width = Math.max(1, Math.floor(message.width));
      height = Math.max(1, Math.floor(message.height));
      dirty = true;
      break;
    case "scene":
      instances = message.flat;
      dirty = true;
      break;
    case "camera":
      camera = message.camera;
      dirty = true;
      break;
    case "options":
      options = message.options;
      dirty = true;
      break;
    case "resize":
      width = Math.max(1, Math.floor(message.width));
      height = Math.max(1, Math.floor(message.height));
      dirty = true;
      break;
    case "registerModel":
      surface?.register_mesh(message.id, message.bytes);
      dirty = true;
      break;
    case "pick": {
      const id = surface?.pick(message.x, message.y) ?? null;
      post({ type: "pickResult", requestId: message.requestId, id });
      break;
    }
    case "snapshot": {
      if (!surface) {
        post({ type: "workerError", phase: "runtime", message: "渲染工作线程尚未就绪" });
        break;
      }
      const bytes = surface.frame(Math.max(1, Math.floor(message.width)), Math.max(1, Math.floor(message.height)),
        payload(message.flat, message.camera, message.options, performance.now() / 1000), true);
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      post({ type: "snapshotResult", requestId: message.requestId, buffer }, [buffer]);
      break;
    }
    case "visibility":
      hidden = message.hidden;
      dirty = true;
      break;
    case "dispose":
      disposed = true;
      if (loopTimer) clearTimeout(loopTimer);
      surface?.free();
      surface = null;
      context = null;
      canvas = null;
      self.close();
      break;
  }
});

void (async () => {
  try {
    const loaded = await loadEngine();
    surface = loaded.surface;
    post({ type: "ready", threads: loaded.threads });
    tick();
  } catch (error) {
    post({ type: "workerError", phase: "init", message: error instanceof Error ? error.message : String(error) });
  }
})();
