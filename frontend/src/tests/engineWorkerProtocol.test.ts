import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequestHub, type SceneRenderOptions } from "../engine/engineWorker/protocol";
import { camerasEqual, optionsChanged } from "../engine/engineWorker/sceneRenderClient";
import type { SoftCamera } from "../engine/softwareRenderer";

const camera = (overrides: Partial<SoftCamera> = {}): SoftCamera => ({
  target: [2, 2, 0], yaw: 0.75, pitch: 0.55, dist: 72, ...overrides });

const options = (overrides: Partial<SceneRenderOptions> = {}): SceneRenderOptions => ({
  grid: true, selectedId: null, selectedIds: [], flylines: true, ...overrides });

afterEach(() => {
  vi.useRealTimers();
});

describe("渲染 Worker 请求配对", () => {
  it("settle 按配对号回填对应 Promise", async () => {
    const hub = createRequestHub<string | null>(1000);
    const first = hub.call();
    const second = hub.call();
    hub.settle(second.requestId, "b");
    hub.settle(first.requestId, null);
    await expect(first.done).resolves.toBeNull();
    await expect(second.done).resolves.toBe("b");
  });

  it("超时后拒绝且不再影响后续请求", async () => {
    vi.useFakeTimers();
    const hub = createRequestHub<string | null>(50);
    const stale = hub.call();
    const failure = stale.done.catch((error: Error) => error);
    vi.advanceTimersByTime(60);
    await expect(stale.done).rejects.toThrow("超时");
    await expect(failure).resolves.toBeInstanceOf(Error);
    const fresh = hub.call();
    hub.settle(fresh.requestId, "ok");
    await expect(fresh.done).resolves.toBe("ok");
  });

  it("failAll 拒绝全部未完成请求", async () => {
    const hub = createRequestHub<string | null>(1000);
    const first = hub.call();
    const second = hub.call();
    hub.failAll(new Error("崩溃"));
    await expect(first.done).rejects.toThrow("崩溃");
    await expect(second.done).rejects.toThrow("崩溃");
  });
});

describe("Worker 差量消息判定", () => {
  it("相机逐字段比较：原地突变后值相同则不重发", () => {
    const base = camera();
    expect(camerasEqual(null, base)).toBe(false);
    expect(camerasEqual({ ...base, target: [2, 2, 0] }, base)).toBe(true);
    expect(camerasEqual(base, camera({ yaw: 0.8 }))).toBe(false);
    expect(camerasEqual(base, camera({ target: [3, 2, 0] }))).toBe(false);
  });

  it("渲染选项比较：选中集合按内容比较", () => {
    expect(optionsChanged(null, options())).toBe(true);
    expect(optionsChanged(options(), options())).toBe(false);
    expect(optionsChanged(options(), options({ selectedIds: ["a", "b"] }))).toBe(true);
    expect(optionsChanged(options({ selectedIds: ["a", "b"] }), options({ selectedIds: ["a", "b"] }))).toBe(false);
    expect(optionsChanged(options({ flylines: true }), options({ flylines: false }))).toBe(false);
    expect(optionsChanged(options(), options({ background: "#101010" }))).toBe(true);
  });
});
