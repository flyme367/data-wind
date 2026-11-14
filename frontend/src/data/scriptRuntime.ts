import type { BoardScript, Interaction } from "./editor";
import { pushDebugLog } from "./debugLog";

export type ScriptRuntimeMessage = Record<string, unknown> & { type?: string };

/** Execute board-authored JavaScript in a DOM-less worker with a small postMessage API. */
export function executeBoardScript(
  script: BoardScript,
  event: Interaction["event"],
  payload: unknown,
  onMessage: (message: ScriptRuntimeMessage) => void,
  onError: (message: string) => void,
): () => void {
  let settings: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(script.settingsJson ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("自定义设置项须为 JSON 对象");
    settings = parsed as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : "自定义设置项无效";
    pushDebugLog("dev", "error", message);
    onError(message);
    return () => {};
  }
  const workerSource = `
    // 脚本内的 console.* 转发回主线程 → 调试面板「二次开发输出」
    const _dwSend = (level, args) => {
      const text = args.map((item) => { try { return typeof item === "string" ? item : JSON.stringify(item); } catch { return String(item); } }).join(" ");
      postMessage({ type: "log", level, message: text });
    };
    const console = {
      log: (...a) => _dwSend("log", a), info: (...a) => _dwSend("log", a),
      warn: (...a) => _dwSend("warn", a), error: (...a) => _dwSend("error", a),
    };
    let handler = null;
    const dw = {
      settings: {},
      emit: (name, payload = {}) => postMessage({ type: "event", name, payload }),
      setText: (targetId, text) => postMessage({ type: "text", targetId, text: String(text) }),
      setVisible: (targetId, visible) => postMessage({ type: "visible", targetId, visible: Boolean(visible) }),
      setColor: (targetId, color) => postMessage({ type: "color", targetId, color: String(color) }),
      setOption: (targetId, key, value) => postMessage({ type: "kitOption", targetId, key, value }),
      refresh: () => postMessage({ type: "refresh" }),
      message: (text) => postMessage({ type: "message", text: String(text) }),
      navigate: (target) => postMessage({ type: "navigate", target: String(target) }),
      done: () => postMessage({ type: "done" }),
    };
    try {
      ${script.code}\n
      handler = typeof onEvent === "function" ? onEvent : typeof main === "function" ? main : null;
    } catch (error) { postMessage({ type: "error", message: String(error) }); }
    self.addEventListener("message", (event) => {
      if (event.data?.type !== "run") return;
      try {
        dw.settings = event.data.settings ?? {};
        if (handler) handler(event.data.payload, event.data.event, dw);
      } catch (error) { postMessage({ type: "error", message: String(error) }); }
    });
  `;
  const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  const worker = new Worker(url);
  let timeout = 0;
  let disposed = false;
  const finish = () => {
    if (disposed) return;
    disposed = true;
    window.clearTimeout(timeout);
    worker.terminate();
    URL.revokeObjectURL(url);
  };
  timeout = window.setTimeout(finish, 30_000);
  worker.onmessage = (messageEvent: MessageEvent<ScriptRuntimeMessage>) => {
    if (messageEvent.data?.type === "done") { finish(); return; }
    if (messageEvent.data?.type === "log") {
      const level = messageEvent.data.level === "warn" || messageEvent.data.level === "error" ? messageEvent.data.level : "log";
      pushDebugLog("dev", level, String(messageEvent.data.message ?? ""));
      return;
    }
    if (messageEvent.data?.type === "error") {
      const message = String(messageEvent.data.message ?? "未知错误");
      pushDebugLog("dev", "error", message);
      onError(message);
      return;
    }
    onMessage(messageEvent.data);
  };
  worker.onerror = (error) => {
    const message = error.message || "脚本加载失败";
    pushDebugLog("dev", "error", message);
    onError(message);
    finish();
  };
  worker.onmessageerror = () => {
    pushDebugLog("dev", "error", "脚本返回了无法读取的数据");
    onError("脚本返回了无法读取的数据");
  };
  worker.postMessage({ type: "run", event, payload, settings });
  return finish;
}
