import { useEffect, useRef } from "react";
import { RustBoardHost } from "../engine/boardCanvas";
import { registerBoardCapture } from "../engine/boardCapture";
import { changeKitTab, resolveRuntimeScene, scaleBackgroundWidgets } from "../data/runtimeScene";
import { getState, setState, useStore } from "../state/store";
import { cancelPendingInteractions, closeInteractionDialog, runBoardInteractions, runInteractions } from "../state/sceneActions";
import { openSceneContextMenu } from "../state/contextMenu";
import { getSceneBridge } from "../workers/bridge";
import { BACKGROUND_BOARD_PAGE_ID, FOREGROUND_BOARD_PAGE_ID } from "../data/editor";
import type { SceneNode } from "../types";
import { kitMetadata, responsiveKitScene } from "../data/kitRuntime";
import { updateKitLinkage, updateKitSelection } from "../data/kitLinkage";

/** React owns mounting and editor commands; Rust owns every board component's pixels. */
export function BoardOverlay({ preview, editing, scale, scaleY, responsiveSize, onBackgroundSelect, onSelect }: {
  preview: boolean; editing: boolean; scale: number; scaleY?: number;
  responsiveSize?: { width: number; height: number };
  onBackgroundSelect?: () => void; onSelect?: () => void;
}) {
  const state = useStore();
  const mount = useRef<HTMLDivElement>(null);
  const host = useRef<RustBoardHost | null>(null);
  const wasPreview = useRef(false);
  const interactionScope = useRef({ project: state.projectId, page: state.settings.boardActivePageId });
  const callbacks = useRef({ onBackgroundSelect, onSelect });
  callbacks.current = { onBackgroundSelect, onSelect };
  useEffect(() => {
    const board = new RustBoardHost(mount.current!, {
      onClick: node => runInteractions(node, "click"),
      onDoubleClick: node => runInteractions(node, "dblclick"),
      onComponentEvent: (node, event, value, payload) => {
        if (event === "itemClick") {
          const state = getState();
          const linked = updateKitLinkage(state.scene, state.liveData, state.runtime, node, payload, value);
          const runtime = updateKitSelection(state.scene, linked, node, payload, value);
          if (runtime !== state.runtime) setState({ runtime });
        }
        runInteractions(node, event, value, payload);
      },
      onKitMenuClear: node => {
        const state = getState();
        const linked = updateKitLinkage(state.scene, state.liveData, state.runtime, node, "", "");
        const runtime = updateKitSelection(state.scene, linked, node, "", "");
        if (runtime !== state.runtime) setState({ runtime });
      },
      onDialogAction: node => closeInteractionDialog(node.id),
      onKitTabChange: (node, index) => {
        const runtime = getState().runtime;
        setState({ runtime: { ...runtime, [node.id]: changeKitTab(runtime[node.id], index) } });
      },
      onBackgroundClick: () => runBoardInteractions("click"),
      onBackgroundDoubleClick: () => runBoardInteractions("dblclick"),
      onBackgroundSelect: () => callbacks.current.onBackgroundSelect?.(),
      onSelect: (id, additive) => {
        callbacks.current.onSelect?.();
        if (additive || !getState().selectedIds.includes(id)) getSceneBridge().post({ type: "select", id, additive });
      },
      getSnap: () => getState().snap,
      onEdit: edit => {
        if (edit.type === "move") {
          if (edit.dx || edit.dy) getSceneBridge().post({ type: "transformSelection", ids: edit.ids,
            property: "position", delta: [edit.dx, edit.dy, 0] });
        } else {
          const original = getState().scene.find(node => node.id === edit.id);
          if (!original || original.locked) return;
          if (kitMetadata(original)) {
            const parent = getState().scene.find(node => node.id === original.parentId);
            getSceneBridge().post({ type: "patchKitOptions", id: original.id, patch: {
              position: [edit.x - (parent?.transform.position.x ?? 0), edit.y - (parent?.transform.position.y ?? 0)],
              size: [edit.width, edit.height],
            } });
            return;
          }
          getSceneBridge().post({ type: "replaceNode", node: { ...original,
            transform: { ...original.transform, position: { ...original.transform.position, x: edit.x, y: edit.y } },
            boxSize: { x: edit.width, y: edit.height, z: 1 } } });
        }
      },
      onContextMenu: (id, x, y) => {
        if (!getState().selectedIds.includes(id)) getSceneBridge().post({ type: "select", id });
        openSceneContextMenu(x, y, id);
      },
    });
    host.current = board;
    void board.ready.catch(() => {});
    const unregister = registerBoardCapture(size => board.snapshot(size));
    return () => { cancelPendingInteractions(); unregister(); board.dispose(); host.current = null; };
  }, []);
  useEffect(() => {
    if (interactionScope.current.project !== state.projectId
      || interactionScope.current.page !== state.settings.boardActivePageId) {
      cancelPendingInteractions();
      interactionScope.current = { project: state.projectId, page: state.settings.boardActivePageId };
    }
    // 山海鲸「默认状态」所见即所得：非预览时，选中组件按样式面板正在编辑的状态渲染
    const editStateId = !preview && state.selectedId ? state.editingStates[state.selectedId] : undefined;
    const runtime = editStateId ? { ...state.runtime, [state.selectedId as string]: { stateId: editStateId } } : state.runtime;
    const backgroundEditor = state.boardLayer === "background" && !preview;
    const foregroundEditor = state.boardLayer === "foreground" && !preview;
    // 层序：背景看板(底) → 子看板内容 → 前景看板(顶)；仅编辑对应保留层时只渲染该层
    const visibleScene = state.scene.filter((node) => (node.type !== "widget" && !kitMetadata(node)) ||
      (backgroundEditor
        ? node.boardPageId === BACKGROUND_BOARD_PAGE_ID
        : foregroundEditor
          ? node.boardPageId === FOREGROUND_BOARD_PAGE_ID
          : !node.boardPageId || node.boardPageId === state.settings.boardActivePageId ||
            node.boardPageId === BACKGROUND_BOARD_PAGE_ID || node.boardPageId === FOREGROUND_BOARD_PAGE_ID));
    const layerWeight = (node: SceneNode) => node.boardPageId === FOREGROUND_BOARD_PAGE_ID ? 2
      : node.boardPageId === BACKGROUND_BOARD_PAGE_ID ? 0 : 1;
    visibleScene.sort((a, b) => {
      return layerWeight(a) - layerWeight(b);
    });
    const canvasScene = !backgroundEditor && !foregroundEditor ? scaleBackgroundWidgets(visibleScene,
      state.settings.boardBackgroundPage, state.boardSize, state.settings.boardForegroundPage) : visibleScene;
    const resolved = resolveRuntimeScene(canvasScene, state.liveData, runtime, state.settings.boardDataConditions);
    const rendered = responsiveSize ? responsiveKitScene(resolved, state.boardSize, responsiveSize) : resolved;
    host.current?.render({
      scene: rendered,
      boardWidth: responsiveSize?.width ?? state.boardSize.width, boardHeight: responsiveSize?.height ?? state.boardSize.height,
      scale, scaleY, preview, selected: state.selectedIds, hidden: editing && !preview,
    });
    if (wasPreview.current && !preview) cancelPendingInteractions();
    wasPreview.current = preview;
  }, [state.scene, state.liveData, state.runtime, state.editingStates, state.boardSize, state.selectedId, state.selectedIds, state.settings.boardActivePageId, state.settings.boardDataConditions, state.projectId, state.boardLayer, state.settings.boardForegroundPage, scale, scaleY, responsiveSize?.width, responsiveSize?.height, preview, editing]);
  return <div className="rust-board-mount" ref={mount} />;
}
