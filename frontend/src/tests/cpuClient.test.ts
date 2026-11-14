import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  init: vi.fn(), parallelInit: vi.fn(), pool: vi.fn(),
}));
vi.mock("../wasm/cpu/data_wind_cpu.js", () => ({ default: mocks.init }));
vi.mock("../wasm/cpu-parallel/data_wind_cpu.js", () => ({
  default: mocks.parallelInit, initThreadPool: mocks.pool,
}));
beforeEach(() => {
  vi.resetModules();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.init.mockResolvedValue(undefined);
  mocks.parallelInit.mockResolvedValue(undefined);
  mocks.pool.mockResolvedValue(undefined);
  vi.stubGlobal("crossOriginIsolated", false);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function allowThreads(cores = 16) {
  vi.stubGlobal("crossOriginIsolated", true);
  vi.stubGlobal("Worker", class {});
  vi.stubGlobal("navigator", { hardwareConcurrency: cores });
}

describe("CPU wasm thread selection", () => {
  it("keeps ordinary static deployments on the portable module", async () => {
    const { loadCpuModule } = await import("../engine/cpuClient");
    await Promise.all([loadCpuModule(), loadCpuModule()]);
    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.parallelInit).not.toHaveBeenCalled();
    expect(mocks.pool).not.toHaveBeenCalled();
  });

  it("waits for one shared thread pool before handing out the module", async () => {
    allowThreads();
    let resolvePool!: () => void;
    mocks.pool.mockReturnValue(new Promise<void>((resolve) => { resolvePool = resolve; }));
    const { loadCpuModule } = await import("../engine/cpuClient");
    const ready = loadCpuModule();
    await vi.waitFor(() => expect(mocks.pool).toHaveBeenCalledWith(8));
    expect(mocks.parallelInit).toHaveBeenCalledTimes(1);
    resolvePool();
    await ready;
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it.each(["module", "pool"])("falls back when the parallel %s fails", async (stage) => {
    allowThreads(4);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    (stage === "module" ? mocks.parallelInit : mocks.pool).mockRejectedValue(new Error("blocked"));
    const { loadCpuModule } = await import("../engine/cpuClient");
    const module = await loadCpuModule();
    expect(mocks.init).toHaveBeenCalledTimes(1);
    await loadCpuModule();
    expect(mocks.parallelInit).toHaveBeenCalledTimes(1);
  });

  it("keeps a single-core browser on the portable module", async () => {
    allowThreads(1);
    const { loadCpuModule } = await import("../engine/cpuClient");
    await loadCpuModule();
    expect(mocks.init).toHaveBeenCalledOnce();
    expect(mocks.pool).not.toHaveBeenCalled();
  });
});
