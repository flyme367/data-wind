import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneMessage, SceneOp } from "../workers/sceneModel";

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

/** Exercise the actual worker and bridge contracts with synchronous in-process delivery. */
async function connectSceneWorker() {
  let deliver = (_message: SceneMessage) => {};
  const scope = {
    onmessage: null as ((event: MessageEvent<SceneOp>) => void) | null,
    postMessage: vi.fn((message: SceneMessage) => deliver(message)),
  };
  vi.stubGlobal("self", scope);
  vi.stubGlobal("Worker", class {
    onmessage: ((event: MessageEvent<SceneMessage>) => void) | null = null;
    constructor() { deliver = (data) => this.onmessage?.({ data } as MessageEvent<SceneMessage>); }
    postMessage(data: SceneOp) { scope.onmessage?.({ data } as MessageEvent<SceneOp>); }
  });
  await import("../workers/scene.worker");
  const bridge = (await import("../workers/bridge")).getSceneBridge();
  return { bridge, sent: scope.postMessage, deliver: (message: SceneMessage) => deliver(message) };
}

describe("selection messages across the scene worker bridge", () => {
  it("sends a selection without scene data and retains geometry identity for the viewport", async () => {
    const { bridge, sent } = await connectSceneWorker();
    bridge.post({ type: "openProject", projectId: "A", tree: [], template: "empty" });
    bridge.post({ type: "add", node: { type: "model" } });
    const created = bridge.snapshot()!;
    const listener = vi.fn();
    const unsubscribe = bridge.subscribe(listener);
    bridge.post({ type: "select", id: null });
    expect(sent).toHaveBeenLastCalledWith({
      type: "selectionChanged", projectId: "A", revision: created.revision, selectedId: null, selectedIds: [],
    });
    const selected = bridge.snapshot()!;
    expect(selected.selectedId).toBeNull();
    expect(selected.tree).toBe(created.tree);
    expect(selected.flat).toBe(created.flat);
    expect(listener).toHaveBeenLastCalledWith(selected);
    expect(selected.canUndo).toBe(created.canUndo);
    const lateListener = vi.fn();
    bridge.subscribe(lateListener)();
    expect(lateListener).toHaveBeenCalledExactlyOnceWith(selected);
    bridge.post({ type: "transform", id: created.selectedId!, position: [12, 2, 0] });
    expect(bridge.snapshot()!.flat).not.toBe(created.flat);
    expect(bridge.snapshot()!.flat[0].pos).toEqual([12, 2, 0]);
    unsubscribe();
  });

  it("ignores selection patches without a matching project and scene revision", async () => {
    const { bridge, deliver } = await connectSceneWorker();
    const selection: SceneMessage = { type: "selectionChanged", projectId: "A", revision: 0, selectedId: "stale", selectedIds: ["stale"] };
    deliver(selection);
    expect(bridge.snapshot()).toBeNull();
    bridge.post({ type: "openProject", projectId: "A", tree: [], template: "empty" });
    const initial = bridge.snapshot();
    const listener = vi.fn();
    bridge.subscribe(listener);
    listener.mockClear();
    deliver({ ...selection, projectId: "B" });
    deliver({ ...selection, revision: 1 });
    expect(bridge.snapshot()).toBe(initial);
    expect(listener).not.toHaveBeenCalled();
  });

  it("rejects saving a failed snapshot load until a valid scene is imported", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { bridge } = await connectSceneWorker();
      bridge.post({ type: "loadSnapshot", projectId: "broken", data: new ArrayBuffer(16), template: "empty" });
      await expect(bridge.checkpoint("broken")).rejects.toThrow(/快照读取失败/);
      bridge.post({ type: "loadScene", tree: [] });
      await expect(bridge.checkpoint("broken")).resolves.toMatchObject({ projectId: "broken", tree: [] });
    } finally {
      error.mockRestore();
    }
  });
});
