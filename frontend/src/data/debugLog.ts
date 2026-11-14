import { useEffect, useState } from "react";

export type DebugChannel = "dev" | "system";
export interface DebugLogEntry { id: number; time: string; level: "log" | "warn" | "error"; text: string; }

const CAPACITY = 500;
const logs: Record<DebugChannel, DebugLogEntry[]> = { dev: [], system: [] };
const listeners = new Set<() => void>();
let sequence = 0;
let installed = false;

const stamp = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });

const toText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

export function pushDebugLog(channel: DebugChannel, level: DebugLogEntry["level"], text: string): void {
  const list = logs[channel];
  list.push({ id: ++sequence, time: stamp(), level, text });
  if (list.length > CAPACITY) list.splice(0, list.length - CAPACITY);
  listeners.forEach((fn) => fn());
}

export function getDebugLog(channel: DebugChannel): DebugLogEntry[] {
  return logs[channel];
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** 组件内订阅某一通道，输出面板打开期间的历史与新日志都会刷新。 */
export function useDebugLog(channel: DebugChannel): DebugLogEntry[] {
  const [, setVersion] = useState(0);
  useEffect(() => subscribe(() => setVersion((v) => v + 1)), [channel]);
  return getDebugLog(channel);
}

/** 抓取主线程 console.warn/error 与全局异常 → 系统信息输出（只装一次）。 */
export function installSystemLogCapture(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  for (const level of ["warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      pushDebugLog("system", level, args.map(toText).join(" "));
      original(...args);
    };
  }
  window.addEventListener("error", (event) => pushDebugLog("system", "error", event.message));
  window.addEventListener("unhandledrejection", (event) => {
    pushDebugLog("system", "error", `未处理的 Promise 拒绝：${toText((event as PromiseRejectionEvent).reason)}`);
  });
}
