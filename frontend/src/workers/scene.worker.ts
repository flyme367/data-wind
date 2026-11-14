import { currentSnapshot, handle, type SceneControl, type SceneMessage } from "./sceneModel";

export type { SceneOp, SceneSnapshot, SceneMessage } from "./sceneModel";

self.onmessage = (e: MessageEvent<SceneControl>) => {
  if (e.data.type === "checkpoint") {
    const message: SceneMessage = { type: "checkpoint", requestId: e.data.requestId, snapshot: currentSnapshot() };
    self.postMessage(message);
    return;
  }
  const snapshot = handle(e.data);
  if (!snapshot) return;
  const message: SceneMessage = ["select", "selectMany"].includes(e.data.type) ? {
    type: "selectionChanged", projectId: snapshot.projectId,
    revision: snapshot.revision, selectedId: snapshot.selectedId, selectedIds: snapshot.selectedIds,
  } : { type: "sceneChanged", ...snapshot };
  self.postMessage(message);
};
