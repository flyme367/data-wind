import { defaultEditorSettings, type EditorSettings } from "../data/editor";
import { useSyncExternalStore } from "react";
import type { EngineStats, SceneNode } from "../types";
import type { ViewOrigin } from "../engine/viewOrigin";
import type { DataSourceStatus } from "../data/dataSources";
import type { RuntimeOverrides } from "../data/runtimeScene";

export type Route = "login" | "home" | "workspace";

export interface HudToggles {
  grid: boolean;
  flylines: boolean;
  stats: boolean;
}

export interface AppState {
  route: Route;
  boardSize: { width: number; height: number };
  /** 当前编辑的是共享背景看板、前景看板，还是某个子看板。 */
  boardLayer: "page" | "background" | "foreground";
  projectId: string | null;
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
  lastSavedAt: number | null;
  saveError: string | null;
  /** 场景树（由 scene worker 权威维护，此处为镜像快照） */
  scene: SceneNode[];
  flat: unknown[];
  /** 引擎渲染原点（scene worker 在加载场景时计算，见 engine/viewOrigin） */
  viewOrigin: ViewOrigin;
  selectedId: string | null;
  selectedIds: string[];
  settings: EditorSettings;
  tool: "move" | "rotate" | "scale";
  snap: number;
  runtime: RuntimeOverrides;
  /** 山海鲸「默认状态」：每个组件样式面板当前编辑的状态 id（"" = 默认状态），仅编辑态，不入场景 */
  editingStates: Record<string, string>;
  liveData: Record<string, Record<string, unknown>>;
  dataStatus: Record<string, DataSourceStatus>;
  stats: EngineStats;
  hud: HudToggles;
  engineReady: boolean;
  webgpuError: string | null;
  /** 素材库搜索结果 id 集合（assets worker 返回） */
  assetFilter: string[] | null;
}

let state: AppState = {
  route: "home",
  boardSize: { width: 1920, height: 1080 },
  boardLayer: "page",
  projectId: null,
  revision: 0,
  canUndo: false,
  canRedo: false,
  lastSavedAt: null,
  saveError: null,
  scene: [],
  flat: [],
  viewOrigin: { x: 0, z: 0 },
  selectedId: null, selectedIds: [], settings: structuredClone(defaultEditorSettings), tool: "move", snap: 0, runtime: {}, editingStates: {},
  liveData: {}, dataStatus: {},
  stats: {
    backend: "-",
    fps: 0,
    instances: 0,
    visible: 0,
    particles: 0,
    tris: 0,
  },
  hud: { grid: true, flylines: true, stats: false },
  engineReady: false,
  webgpuError: null,
  assetFilter: null,
};

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function setRoute(route: Route): void {
  window.location.hash = route === "workspace" ? "#/workspace" : "#/login";
  setState({ route });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useStore(): AppState {
  return useSyncExternalStore(subscribe, getState);
}

export function isAuthed(): boolean {
  return sessionStorage.getItem("dw_auth") === "1";
}

export function setAuthed(v: boolean): void {
  if (v) sessionStorage.setItem("dw_auth", "1");
  else sessionStorage.removeItem("dw_auth");
}

// 开发调试句柄
declare global {
  interface Window {
    __dw?: { getState: typeof getState; setState: typeof setState };
  }
}
if (import.meta.env?.DEV) {
  window.__dw = { getState, setState };
}
