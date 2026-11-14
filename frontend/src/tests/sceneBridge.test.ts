import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneMessage, SceneSnapshot } from "../workers/sceneModel";

class FakeWorker {
  static instance: FakeWorker;
  messages: unknown[] = [];
  onmessage: ((event: MessageEvent<SceneMessage>) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { FakeWorker.instance = this; }
  postMessage(message: unknown) { this.messages.push(message); }
  emit(data: SceneMessage) { this.onmessage?.({ data } as MessageEvent<SceneMessage>); }
}

beforeEach(() => { vi.resetModules(); vi.stubGlobal("Worker", FakeWorker); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("scene worker checkpoints", () => {
  it("queues the checkpoint after edits and resolves with the worker's latest scene", async () => {
    const { getSceneBridge } = await import("../workers/bridge");
    const bridge = getSceneBridge(), worker = FakeWorker.instance;
    bridge.post({ type: "rename", id: "a", name: "新名称" });
    const result = bridge.checkpoint("project-a");
    expect(worker.messages).toEqual([
      { type: "rename", id: "a", name: "新名称" }, { type: "checkpoint", requestId: 1 },
    ]);
    const snapshot = { projectId: "project-a", revision: 2, tree: [{ id: "a", name: "新名称" }] } as SceneSnapshot;
    worker.emit({ type: "checkpoint", requestId: 1, snapshot });
    await expect(result).resolves.toBe(snapshot);
  });

  it("rejects a checkpoint from another project and propagates worker failure", async () => {
    const { getSceneBridge } = await import("../workers/bridge");
    const bridge = getSceneBridge(), worker = FakeWorker.instance;
    const switched = bridge.checkpoint("project-a");
    worker.emit({ type: "checkpoint", requestId: 1, snapshot: { projectId: "project-b" } as SceneSnapshot });
    await expect(switched).rejects.toThrow("项目已切换");
    const failed = bridge.checkpoint("project-a");
    worker.onerror?.();
    await expect(failed).rejects.toThrow("工作线程");
  });
});
