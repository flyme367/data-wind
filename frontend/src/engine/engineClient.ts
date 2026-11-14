import * as engine from "../wasm/data_wind_engine.js";

// Bevy 引擎（3D GPU）无 rayon 依赖：始终单线程 wasm，始终主线程。
// CPU 渲染（软渲 / 看板栅格化）的并行构建见 cpuClient.ts。
type EngineModule = typeof engine;
type LeaseRecord = {
  users: number;
  promise: Promise<engine.Engine>;
  engine?: engine.Engine;
};
let initialized: Promise<EngineModule> | null = null;
const records = new WeakMap<HTMLCanvasElement, LeaseRecord>();

async function initialize(): Promise<EngineModule> {
  await engine.default();
  return engine;
}

/** 3D 引擎的 WASM 初始化 promise（Board/软渲走 cpuClient）。 */
export async function loadEngineModule() {
  initialized ??= initialize().catch((error) => { initialized = null; throw error; });
  return initialized;
}

/** A lease keeps asynchronous WASM construction safe across React mount/cleanup cycles. */
export function acquireEngine(canvas: HTMLCanvasElement) {
  let record = records.get(canvas);
  if (!record) {
    const created: LeaseRecord = {
      users: 0,
      promise: loadEngineModule().then(async (wasm) => {
        const engine = await wasm.Engine.create(canvas);
        created.engine = engine;
        if (created.users === 0) {
          engine.free();
          records.delete(canvas);
        }
        return engine;
      }).catch((error) => {
        records.delete(canvas);
        throw error;
      }),
    };
    record = created;
    records.set(canvas, record);
  }
  record.users += 1;
  let released = false;
  const lease = record;
  return {
    ready: lease.promise,
    release() {
      if (released) return;
      released = true;
      lease.users -= 1;
      if (lease.users === 0 && lease.engine) {
        lease.engine.free();
        records.delete(canvas);
      }
    },
  };
}
