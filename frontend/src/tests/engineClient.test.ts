import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  init: vi.fn(), create: vi.fn(),
}));
vi.mock("../wasm/data_wind_engine.js", () => ({ default: mocks.init, Engine: { create: mocks.create } }));
beforeEach(() => {
  vi.resetModules();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.init.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("asynchronous WASM engine leases", () => {
  it("initializes the engine module once across concurrent loads", async () => {
    const { loadEngineModule } = await import("../engine/engineClient");
    await Promise.all([loadEngineModule(), loadEngineModule()]);
    expect(mocks.init).toHaveBeenCalledTimes(1);
  });

  it("reuses construction across React cleanup/remount and frees exactly once", async () => {
    const engine = { free: vi.fn() };
    mocks.create.mockResolvedValue(engine);
    const { acquireEngine } = await import("../engine/engineClient");
    const canvas = {} as HTMLCanvasElement;
    const first = acquireEngine(canvas); first.release();
    const second = acquireEngine(canvas);
    expect(await second.ready).toBe(engine);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(engine.free).not.toHaveBeenCalled();
    second.release(); second.release();
    expect(engine.free).toHaveBeenCalledTimes(1);
  });
  it("frees an engine that finishes constructing after its canvas is unmounted", async () => {
    const engine = { free: vi.fn() };
    mocks.create.mockResolvedValue(engine);
    const { acquireEngine } = await import("../engine/engineClient");
    const lease = acquireEngine({} as HTMLCanvasElement);
    lease.release();
    await lease.ready;
    expect(engine.free).toHaveBeenCalledTimes(1);
  });
  it("allows retrying the same canvas after a failed engine construction", async () => {
    const engine = { free: vi.fn() };
    mocks.create.mockRejectedValueOnce(new Error("device unavailable")).mockResolvedValueOnce(engine);
    const { acquireEngine } = await import("../engine/engineClient");
    const canvas = {} as HTMLCanvasElement;
    const first = acquireEngine(canvas);
    await expect(first.ready).rejects.toThrow("device unavailable");
    first.release();
    const second = acquireEngine(canvas);
    expect(await second.ready).toBe(engine);
    second.release();
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });
  it("allows retrying after engine module initialization fails", async () => {
    mocks.init.mockRejectedValueOnce(new Error("network unavailable")).mockResolvedValue(undefined);
    const { loadEngineModule } = await import("../engine/engineClient");
    await expect(loadEngineModule()).rejects.toThrow("network unavailable");
    await loadEngineModule();
    expect(mocks.init).toHaveBeenCalledTimes(2);
  });
});
