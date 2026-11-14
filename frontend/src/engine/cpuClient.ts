import * as portable from "../wasm/cpu/data_wind_cpu.js";

// CPU 渲染 wasm（软渲 + 看板栅格化）：跨源隔离时用 parallel 构建（rayon 多核），否则 portable。
type CpuModule = Pick<typeof portable, "BoardCanvas" | "SoftwareCanvas" | "cpu_threads">;
let initialized: Promise<CpuModule> | null = null;

function supportsThreads() {
  if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === "undefined"
    || typeof Worker === "undefined" || (globalThis.navigator?.hardwareConcurrency ?? 1) < 2) return false;
  try {
    return new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer instanceof SharedArrayBuffer;
  } catch { return false; }
}

async function initialize(): Promise<CpuModule> {
  if (supportsThreads()) {
    try {
      const parallel = await import("../wasm/cpu-parallel/data_wind_cpu.js");
      await parallel.default();
      // Leave capacity for the editor and its scene/assets workers.
      const threads = Math.min(8, Math.max(2, (navigator.hardwareConcurrency || 2) - 1));
      await parallel.initThreadPool(threads);
      return parallel;
    } catch (error) {
      console.warn("WASM 线程池不可用，使用单线程 CPU 渲染。", error);
    }
  }
  await portable.default();
  return portable;
}

/** Board CPU 渲染与主线程软渲共用一次 WASM 初始化 promise。 */
export function loadCpuModule() {
  initialized ??= initialize().catch((error) => { initialized = null; throw error; });
  return initialized;
}
