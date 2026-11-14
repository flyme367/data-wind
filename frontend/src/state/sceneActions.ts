import { Toast } from "../lib/toast";
import { BACKGROUND_BOARD_PAGE_ID, FOREGROUND_BOARD_PAGE_ID, descendants, ancestorMatches, dataAt, type Interaction, type WidgetConfig } from "../data/editor";
import { executeBoardScript } from "../data/scriptRuntime";
import type { SceneNode } from "../types";
import { getSceneBridge } from "../workers/bridge";
import { getState, setAuthed, setRoute, setState, type AppState } from "./store";
import { persistParams } from "./projects";
import { resolveRuntimeNode } from "../data/runtimeScene";
import { entranceAnimations, interactionSchedule } from "../data/interactionAnimation";
import { applyInteractionSettings, applyScriptKitOption, setPlaybackFullscreen } from "../data/interactionSettings";

let clipboard: SceneNode[] = [];

/** 右键菜单「复制组件」：按显式 ids 复制（含后代），与 ⌘C 共用同一剪贴板 */
export function copyNodesToClipboard(ids: string[]): void {
  const { scene } = getState(), covered = descendants(scene, ids);
  const nodes = structuredClone(scene.filter((n) => covered.has(n.id)));
  if (!nodes.length) { Toast.info("请先选择对象"); return; }
  clipboard = nodes;
  Toast.success(`已复制 ${nodes.length} 个对象`);
}

/** 复制交互剪贴板：保存节点的交互规则，粘贴时按目标逐个整体替换 */
let interactionClipboard: Interaction[] | null = null;
export const hasInteractionClipboard = (): boolean => Boolean(interactionClipboard?.length);
export function copyInteractions(id: string): void {
  const node = getState().scene.find((n) => n.id === id);
  if (!node?.interactions?.length) { Toast.info("该组件没有可复制的交互"); return; }
  interactionClipboard = structuredClone(node.interactions);
  Toast.success(`已复制 ${interactionClipboard.length} 条交互`);
}
export function pasteInteractions(ids: string[]): void {
  if (!interactionClipboard?.length) { Toast.info("请先复制交互"); return; }
  const bridge = getSceneBridge();
  for (const id of ids) {
    const rules = interactionClipboard.map((rule) => ({ ...structuredClone(rule), id: crypto.randomUUID() }));
    bridge.post({ type: "patch", id, patch: { interactions: rules } });
  }
  Toast.success(`已粘贴交互到 ${ids.length} 个组件`);
}

/** 复制样式剪贴板：widget 外观字段 + 颜色；粘贴时 patchWidget + color */
const STYLE_KEYS = ["background", "borderColor", "opacity", "radius", "align", "fontSize", "fontFamily", "fontWeight",
  "italic", "underline", "lineHeight", "letterSpacing", "borderStyle", "borderWidth",
  "shadowColor", "shadowBlur", "shadowOffsetX", "shadowOffsetY"] as const;
type WidgetStyle = Pick<WidgetConfig, (typeof STYLE_KEYS)[number]>;
let styleClipboard: { style: WidgetStyle; color: string } | null = null;
export const hasStyleClipboard = (): boolean => Boolean(styleClipboard);
export function copyStyle(id: string): void {
  const node = getState().scene.find((n) => n.id === id);
  if (!node) return;
  if (!node.widget) { Toast.info("该对象不支持复制样式"); return; }
  const style = {} as WidgetStyle;
  for (const key of STYLE_KEYS) (style[key] as WidgetConfig[typeof key]) = structuredClone(node.widget[key]);
  styleClipboard = { style, color: node.color };
  Toast.success("已复制样式");
}
export function pasteStyle(ids: string[]): void {
  if (!styleClipboard) { Toast.info("请先复制样式"); return; }
  const { scene } = getState(), byId = new Map(scene.map((n) => [n.id, n]));
  const bridge = getSceneBridge();
  let applied = 0;
  for (const id of ids) {
    const node = byId.get(id);
    if (!node || node.locked) continue;
    if (node.widget) bridge.post({ type: "patchWidget", id, patch: structuredClone(styleClipboard.style) });
    bridge.post({ type: "color", id, color: styleClipboard.color });
    applied += 1;
  }
  if (applied) Toast.success(`已应用样式到 ${applied} 个对象`);
}
export const selection = () => getState().selectedIds.length ? getState().selectedIds : getState().selectedId ? [getState().selectedId!] : [];
export function deleteSceneObject(id: string | null): void { deleteSelection(id ? [id] : []); }
export function deleteSelection(ids = selection()): void {
  const {scene}=getState(), byId=new Map(scene.map(n=>[n.id,n]));
  const nodes=scene.filter(n=>ids.includes(n.id));
  if (!nodes.length) { Toast.info("请先选中要删除的对象"); return; }
  const affected=descendants(scene,ids);
  if(scene.some(n=>affected.has(n.id)&&(n.locked||ancestorMatches(n,byId,p=>p.locked)))){Toast.info("选中对象或子对象已锁定，请先解锁");return}
  getSceneBridge().post({type:"batch",action:"remove",ids});
}
export function copySelection() {
  const {scene}=getState(),ids=descendants(scene,selection());
  clipboard=structuredClone(scene.filter(n=>ids.has(n.id)));
  if(clipboard.length)Toast.success(`已复制 ${clipboard.length} 个对象`);else Toast.info("请先选择对象");
}
export const hasNodeClipboard = (): boolean => clipboard.length > 0;
export function pasteSelection() { if(clipboard.length)getSceneBridge().post({type:"paste",nodes:clipboard});else Toast.info("请先复制对象"); }
export function duplicateSelection() { getSceneBridge().post({type:"batch",action:"duplicate",ids:selection()}); }
export function focusSelection(ids=selection()) {
  const projectId = getState().projectId;
  if (!projectId) return;
  void getSceneBridge().checkpoint(projectId).then(() => {
    if (getState().projectId === projectId) window.dispatchEvent(new CustomEvent("dw:camera",{detail:{preset:"focus",ids}}));
  }).catch((error: unknown) => Toast.error(error instanceof Error ? error.message : "定位失败"));
}
export function selectAll(editing: boolean) {
  getSceneBridge().post({type:"selectMany",ids:getState().scene.filter(n=>editing?n.type!=="widget":n.type==="widget").map(n=>n.id)});
}
type InteractionEvent = Interaction["event"];

function parsedValue(value: string): unknown {
  try { return JSON.parse(value); } catch { return value; }
}

function needsTarget(rule: Interaction): boolean {
  return ["focus", "color", "state", "text", "dialog", "componentCustom", "toggle", "show", "hide", "playEntrance"]
    .includes(rule.action);
}

function runBoardScript(scriptId: string, trigger: InteractionEvent, payload: unknown): void {
  const script = getState().settings.boardScripts.find((item) => item.id === scriptId);
  if (!script?.enabled || !script.code.trim()) { Toast.info("脚本未启用或内容为空"); return; }
  executeBoardScript(script, trigger, payload, (message) => {
    const targetId = typeof message.targetId === "string" ? message.targetId : "";
    const current = getState();
    if (message.type === "event" && typeof message.name === "string") {
      window.dispatchEvent(new CustomEvent("dw:dev-event", { detail: { name: message.name, payload: message.payload } }));
    } else if (message.type === "kitOption") {
      const runtime = { ...current.runtime };
      if (applyScriptKitOption(current.scene.find(item => item.id === targetId), runtime, message.key, message.value))
        setState({ runtime });
    } else if (["text", "visible", "color"].includes(String(message.type)) && targetId && current.scene.some((item) => item.id === targetId)) {
      const runtime = { ...current.runtime };
      if (message.type === "text") runtime[targetId] = { ...runtime[targetId], text: String(message.text ?? "") };
      if (message.type === "visible") runtime[targetId] = { ...runtime[targetId], visible: Boolean(message.visible) };
      if (message.type === "color" && typeof message.color === "string" && /^#[0-9a-f]{6}$/i.test(message.color))
        runtime[targetId] = { ...runtime[targetId], color: message.color };
      setState({ runtime });
    } else if (message.type === "refresh") window.dispatchEvent(new Event("dw:refresh-data"));
    else if (message.type === "message") Toast.info(String(message.text ?? ""));
    else if (message.type === "navigate" && typeof message.target === "string")
      window.dispatchEvent(new CustomEvent("dw:navigate-board", { detail: { target: message.target } }));
  }, (message) => Toast.error(`脚本执行失败：${message}`));
}

/** 单条动作同时支持组件目标动作和看板级项目/导航/开发动作。 */
function applyInteractionRule(
  rule: Interaction, node: SceneNode | null, event: InteractionEvent, state: AppState,
  runtime: NonNullable<AppState["runtime"]>, triggerPayload?: unknown,
): boolean {
  const id = rule.targetId || node?.id || "";
  const target = id ? state.scene.find((item) => item.id === id) : undefined;
  if (needsTarget(rule) && !target) { Toast.info("请先选择有效的目标组件"); return false; }
  const actionValue = rule.value.trim() ? parsedValue(rule.value) : (triggerPayload ?? parsedValue(rule.value));
  if (rule.action === "modify") {
    const result = applyInteractionSettings(rule, node, state.scene, runtime, actionValue,
      triggerPayload, state.liveData["builtin:project-params"]);
    if (result === "invalid") Toast.error("修改设置需要 JSON 对象");
    if (result === "missing") Toast.info("请先选择有效的目标组件");
    return result === "changed";
  }

  if (rule.action === "message") { Toast.info(rule.value || target?.name || node?.name || "交互已触发"); return false; }
  if (rule.action === "refresh") { window.dispatchEvent(new Event("dw:refresh-data")); return false; }
  if (rule.action === "fullscreen") {
    setPlaybackFullscreen(rule.value, () => Toast.info("当前环境不支持全屏"));
    return false;
  }
  if (rule.action === "logout") {
    setAuthed(false);
    setRoute("login");
    window.dispatchEvent(new Event("dw:logout"));
    return false;
  }
  if (rule.action === "boardState") {
    const style = rule.value ? state.settings.boardStates.find((item) => item.id === rule.value)?.style : state.settings.boardDefaultState;
    if (!style) { Toast.info("目标看板状态不存在"); return false; }
    getSceneBridge().post({ type: "configure", patch: { ...style, boardActiveStateId: rule.value } });
    return false;
  }
  if (rule.action === "projectParams") {
    if (!actionValue || typeof actionValue !== "object" || Array.isArray(actionValue)) { Toast.error("项目参数必须是 JSON 对象"); return false; }
    const params = { ...state.liveData["builtin:project-params"], ...actionValue };
    const liveData = { ...state.liveData, "builtin:project-params": params };
    setState({ liveData });
    if (state.projectId) persistParams(state.projectId, params);
    window.dispatchEvent(new CustomEvent("dw:project-params", { detail: params }));
    return false;
  }
  if (rule.action === "payload") {
    const payload = actionValue && typeof actionValue === "object" && !Array.isArray(actionValue)
      ? actionValue as Record<string, unknown> : { value: actionValue };
    setState({ liveData: { ...state.liveData, "builtin:payload": { ...payload, payload } } });
    window.dispatchEvent(new CustomEvent("dw:payload", { detail: payload }));
    return false;
  }
  if (rule.action === "passEvent") {
    window.dispatchEvent(new CustomEvent("dw:pass-event", { detail: { name: rule.actionEventName || rule.triggerValue || "interaction", payload: actionValue } }));
    return false;
  }
  if (rule.action === "devEvent") {
    window.dispatchEvent(new CustomEvent("dw:dev-event", { detail: { name: rule.actionEventName || rule.triggerValue || rule.value || "interaction", payload: actionValue } }));
    return false;
  }
  if (rule.action === "script") { runBoardScript(rule.value, event, { nodeId: node?.id ?? null, targetId: id, payload: triggerPayload }); return false; }
  if (rule.action === "openUrl") {
    try {
      const url = new URL(rule.value, window.location.href);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("仅支持 HTTP 或 HTTPS 链接");
      window.open(url.href, "_blank", "noopener,noreferrer");
    } catch (error) { Toast.error(error instanceof Error ? error.message : "链接无效"); }
    return false;
  }
  if (rule.action === "navigateBoard") {
    window.dispatchEvent(new CustomEvent("dw:navigate-board", { detail: { target: rule.value } }));
    Toast.info(rule.value ? `请求跳转看板：${rule.value}` : "请填写目标看板");
    return false;
  }
  if (rule.action === "none") return false;
  if (!target) return false;

  if (rule.action === "playEntrance") {
    const dataPatch = runtime[id]?.dataPatch ?? {};
    runtime[id] = { ...runtime[id], dataPatch: { ...dataPatch,
      __dwEntrance: entranceAnimations(rule, dataPatch.__dwEntrance) } };
    return true;
  }

  if (rule.action === "focus") { focusSelection([id]); return false; }
  if (rule.action === "componentCustom") {
    window.dispatchEvent(new CustomEvent("dw:component-action", { detail: { targetId: id, name: rule.actionEventName || rule.triggerValue || "custom", payload: actionValue } }));
    return false;
  }
  if (rule.action === "color" && /^#[0-9a-f]{6}$/i.test(rule.value)) {
    runtime[id] = { ...runtime[id], color: rule.value }; return true;
  }
  if (rule.action === "text") { runtime[id] = { ...runtime[id], text: rule.value }; return true; }
  if (rule.action === "state") {
    if (!target.widget || (rule.value && !target.widget.states?.some(item => item.id === rule.value))) {
      Toast.info("目标组件没有这个状态"); return false;
    }
    runtime[id] = { ...runtime[id], stateId: rule.value || undefined }; return true;
  }
  if (rule.action === "dialog" || ["show", "hide", "toggle"].includes(rule.action)) {
    const mode = rule.action === "dialog" ? ["open", "close"].includes(rule.value) ? rule.value : "toggle" : rule.action;
    const current = resolveRuntimeNode(target, state.liveData, runtime).visible;
    runtime[id] = { ...runtime[id], visible: mode === "open" || mode === "show" ? true : mode === "close" || mode === "hide" ? false : !current };
    return true;
  }
  return false;
}

const interactionTimers = new Set<number>();
export function cancelPendingInteractions(): void {
  for (const timer of interactionTimers) window.clearTimeout(timer);
  interactionTimers.clear();
}

function runRules(rules: Interaction[], node: SceneNode | null, event: InteractionEvent, triggerValue?: string, triggerPayload?: unknown): void {
  const matching = rules.filter(rule => rule.event === event
    && !(event === "custom" && rule.triggerValue && rule.triggerValue !== triggerValue)
    && !(["itemClick", "componentSelected", "componentUnselected"].includes(event)
      && rule.itemValue && rule.itemValue !== triggerValue));
  for (const { rule, at } of interactionSchedule(matching)) {
    if (at > 0) {
      const timer = window.setTimeout(() => {
        interactionTimers.delete(timer);
        const fresh = getState(), delayed = { ...fresh.runtime };
        if (applyInteractionRule(rule, node, event, fresh, delayed, triggerPayload)) setState({ runtime: delayed });
      }, at);
      interactionTimers.add(timer);
      continue;
    }
    const state = getState(), runtime = { ...state.runtime };
    if (applyInteractionRule(rule, node, event, state, runtime, triggerPayload)) setState({ runtime });
  }
}

export function runInteractions(node: SceneNode, event: InteractionEvent, triggerValue?: string, triggerPayload?: unknown): void {
  runRules(node.interactions ?? [], node, event, triggerValue, triggerPayload);
}

export function closeInteractionDialog(id: string): void {
  const state = getState();
  if (!state.scene.some(node => node.id === id)) return;
  setState({ runtime: { ...state.runtime, [id]: { ...state.runtime[id], visible: false } } });
}

export function runBoardInteractions(
  event: "click" | "dblclick" | "boardActive" | "custom", triggerValue?: string, triggerPayload?: unknown,
): void {
  const state = getState();
  runRules(state.settings.boardInteractions, null, event, triggerValue, triggerPayload);
  if (event !== "custom") return;
  for (const node of state.scene.filter((item) => item.type !== "widget" ||
    !item.boardPageId || item.boardPageId === state.settings.boardActivePageId ||
    item.boardPageId === BACKGROUND_BOARD_PAGE_ID || item.boardPageId === FOREGROUND_BOARD_PAGE_ID))
    runRules(node.interactions ?? [], node, event, triggerValue, triggerPayload);
}

export function interactionConditionMatches(rule: Interaction, liveData: AppState["liveData"]): boolean {
  const condition = rule.condition;
  if (rule.event !== "data" || !condition) return false;
  const value = dataAt(liveData[condition.sourceId], condition.field);
  if (value === undefined) return false;
  const left = Number(value), right = Number(condition.value);
  switch (condition.op) {
    case "==": return String(value) === condition.value;
    case "!=": return String(value) !== condition.value;
    case ">": return Number.isFinite(left) && Number.isFinite(right) && left > right;
    case "<": return Number.isFinite(left) && Number.isFinite(right) && left < right;
    case ">=": return Number.isFinite(left) && Number.isFinite(right) && left >= right;
    case "<=": return Number.isFinite(left) && Number.isFinite(right) && left <= right;
    case "contains": return Array.isArray(value) ? value.some((item) => String(item) === condition.value) : String(value).includes(condition.value);
  }
}

export function runDataInteractions(rule: Interaction, node: SceneNode | null): void {
  const state = getState();
  if (node?.type === "widget" && node.boardPageId && node.boardPageId !== state.settings.boardActivePageId &&
      node.boardPageId !== BACKGROUND_BOARD_PAGE_ID) return;
  runRules([rule], node, "data");
}
