import { useSyncExternalStore } from "react";

/** 右键菜单状态：只存触发点与目标 id（+ session 令牌），菜单内容在打开时按场景快照构建 */
export interface ContextMenuState {
  x: number;
  y: number;
  targetId: string;
  /** 每次打开自增：旧菜单的关闭监听据此忽略后续新开（同一右键事件里 open→close 竞速） */
  session: number;
}

let state: ContextMenuState | null = null;
let sessionCounter = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export function openSceneContextMenu(x: number, y: number, targetId: string): void {
  sessionCounter += 1;
  state = { x, y, targetId, session: sessionCounter };
  emit();
}

export function closeContextMenu(): void {
  if (!state) return;
  state = null;
  emit();
}

export function getContextMenu(): ContextMenuState | null {
  return state;
}

export function useContextMenu(): ContextMenuState | null {
  return useSyncExternalStore(subscribe, getContextMenu);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// 开发调试句柄（同 store 的 window.__dw 模式）：直接驱动右键菜单开合，隔离监听器与宿主渲染链路
declare global {
  interface Window {
    __dwContextMenu?: { open: typeof openSceneContextMenu; close: typeof closeContextMenu };
  }
}
if (import.meta.env?.DEV) {
  window.__dwContextMenu = { open: openSceneContextMenu, close: closeContextMenu };
}
