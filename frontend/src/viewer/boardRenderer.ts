import { RustBoardHost, type BoardHostOptions } from "../engine/boardCanvas";
import { resolveRuntimeScene, type LiveValues, type RuntimeOverrides } from "../data/runtimeScene";
import type { SceneNode } from "../types";
import type { BoardDataCondition } from "../data/dataConditions";
import { responsiveKitScene } from "../data/kitRuntime";

export interface BoardRenderState {
  scene: SceneNode[];
  runtime: RuntimeOverrides;
  liveData: LiveValues;
  conditions?: BoardDataCondition[];
  boardWidth: number; boardHeight: number; scale: number; scaleY?: number;
  responsiveSize?: { width: number; height: number };
}

/** Published pages use exactly the same Rust renderer and media/input host as the editor. */
export class BoardRenderer {
  private readonly host: RustBoardHost;
  constructor(container: HTMLElement, options: BoardHostOptions) {
    this.host = new RustBoardHost(container, options);
    void this.host.ready.catch(() => {});
  }
  render(state: BoardRenderState): void {
    const resolved = resolveRuntimeScene(state.scene, state.liveData, state.runtime, state.conditions);
    const scene = state.responsiveSize ? responsiveKitScene(resolved,
      { width: state.boardWidth, height: state.boardHeight }, state.responsiveSize) : resolved;
    this.host.render({ ...state, preview: true,
      boardWidth: state.responsiveSize?.width ?? state.boardWidth, boardHeight: state.responsiveSize?.height ?? state.boardHeight, scene });
  }
  dispose(): void { this.host.dispose(); }
}
