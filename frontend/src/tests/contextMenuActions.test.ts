import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneNode } from "../types";

vi.mock("@douyinfe/semi-ui", () => ({ Toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

class FakeWorker {
  static instance: FakeWorker;
  messages: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { FakeWorker.instance = this; }
  postMessage(message: unknown) { this.messages.push(message); }
}

let storage: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  storage = new Map();
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  vi.stubGlobal("window", { dispatchEvent: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("CustomEvent", class { detail: unknown; constructor(public type: string, options?: { detail?: unknown }) { this.detail = options?.detail; } });
});

describe("interaction event names", () => {
  it("matches the incoming event and emits the independently configured action event", async () => {
    const { runBoardInteractions } = await import("../state/sceneActions");
    const { getState, setState } = await import("../state/store");
    setState({ settings: { ...getState().settings, boardInteractions: [{ id: "rule", event: "custom", triggerValue: "incoming", action: "passEvent", actionEventName: "outgoing", targetId: "", value: '{"value":42}' }] } });
    runBoardInteractions("custom", "other");
    expect(window.dispatchEvent).not.toHaveBeenCalled();
    runBoardInteractions("custom", "incoming");
    expect(window.dispatchEvent).toHaveBeenCalledOnce();
    expect(vi.mocked(window.dispatchEvent).mock.calls[0][0]).toMatchObject({ type: "dw:pass-event", detail: { name: "outgoing", payload: { value: 42 } } });
  });

  it("continues to emit the original event name for older saved rules", async () => {
    const { runBoardInteractions } = await import("../state/sceneActions");
    const { getState, setState } = await import("../state/store");
    setState({ settings: { ...getState().settings, boardInteractions: [{ id: "legacy", event: "custom", triggerValue: "legacy-event", action: "passEvent", targetId: "", value: "" }] } });
    runBoardInteractions("custom", "legacy-event");
    expect(vi.mocked(window.dispatchEvent).mock.calls[0][0]).toMatchObject({ type: "dw:pass-event", detail: { name: "legacy-event" } });
  });

  it("delivers custom event payloads to interactions on the foreground board", async () => {
    const { runBoardInteractions } = await import("../state/sceneActions");
    const { getState, setState } = await import("../state/store");
    const foreground = makeWidget("foreground", { boardPageId: "dw-foreground-board", interactions: [
      { id: "custom", event: "custom", triggerValue: "update-value", action: "modify",
        targetId: "label", settingKey: "text", value: "{}",
        settingSource: { type: "component", field: "value" } },
    ] });
    const label = makeWidget("label");
    setState({ scene: [foreground, label], runtime: {}, liveData: {},
      settings: { ...getState().settings, boardInteractions: [] } });
    runBoardInteractions("custom", "update-value", { value: 42 });
    expect(getState().runtime.label?.text).toBe("42");
  });

  it("passes the clicked chart item to the built-in payload and filters item names", async () => {
    const { runInteractions } = await import("../state/sceneActions");
    const { getState, setState } = await import("../state/store");
    const chart = makeWidget("chart", { interactions: [{ id: "item", event: "itemClick",
      itemValue: "温度", action: "payload", targetId: "", value: "" }] });
    setState({ scene: [chart], liveData: {} });
    const payload = { name: "温度", value: 24, series: 2, row: { value2: 24 } };
    runInteractions(chart, "itemClick", "压力", payload);
    expect(getState().liveData["builtin:payload"]).toBeUndefined();
    runInteractions(chart, "itemClick", "温度", payload);
    expect(getState().liveData["builtin:payload"]).toMatchObject(payload);
    expect(window.dispatchEvent).toHaveBeenCalledOnce();
  });

  it("opens the dialog selected by a chart item and closes it without changing the saved scene", async () => {
    const { closeInteractionDialog, runInteractions } = await import("../state/sceneActions");
    const { getState, setState } = await import("../state/store");
    const chart = makeWidget("chart", { interactions: [
      { id: "one", event: "itemClick", itemValue: "示例1", action: "dialog", targetId: "dialog-one", value: "open" },
      { id: "two", event: "itemClick", itemValue: "示例2", action: "dialog", targetId: "dialog-two", value: "open" },
    ] });
    const first = makeWidget("dialog-one", { visible: false, boardPageId: "dw-foreground-board" });
    const second = makeWidget("dialog-two", { visible: false, boardPageId: "dw-foreground-board" });
    first.widget!.kind = "dialog";
    second.widget!.kind = "dialog";
    setState({ scene: [chart, first, second], runtime: {}, liveData: {} });
    runInteractions(chart, "itemClick", "示例1", { name: "示例1", value: 36 });
    expect(getState().runtime["dialog-one"]?.visible).toBe(true);
    expect(getState().runtime["dialog-two"]).toBeUndefined();
    closeInteractionDialog("dialog-one");
    expect(getState().runtime["dialog-one"]?.visible).toBe(false);
    runInteractions(chart, "itemClick", "示例2", { name: "示例2", value: 80 });
    expect(getState().runtime["dialog-two"]?.visible).toBe(true);
    expect(first.visible).toBe(false);
    expect(second.visible).toBe(false);
  });

  it("starts the configured entrance animation on component entry", async () => {
    const { runInteractions } = await import("../state/sceneActions");
    const { getState, setState } = await import("../state/store");
    const chart = makeWidget("chart", { interactions: [{ id: "enter", event: "componentEnter",
      action: "playEntrance", targetId: "chart", value: "", delayMs: 200, durationMs: 1000,
      animation: "slideLeft", easing: "linear" }] });
    setState({ scene: [chart], runtime: {} });
    runInteractions(chart, "componentEnter");
    expect(getState().runtime.chart?.dataPatch?.__dwEntrance).toMatchObject([
      { animation: "slideLeft", easing: "linear", delay: 200, duration: 1000 },
    ]);
  });

  it("returns to the default appearance when the pointer leaves", async () => {
    const { runInteractions } = await import("../state/sceneActions");
    const { getState, setState } = await import("../state/store");
    const { resolveRuntimeNode } = await import("../data/runtimeScene");
    const chart = makeWidget("chart", { interactions: [
      { id: "highlight", event: "mouseenter", action: "state", targetId: "chart", value: "highlight" },
      { id: "reset", event: "mouseleave", action: "state", targetId: "chart", value: "" },
    ] });
    chart.widget!.kind = "bar";
    chart.widget!.states = [{ id: "highlight", name: "高亮", patch: { background: "#00ff00" } }];
    chart.data = { chart: { barWidth: 10 }, chartStates: { highlight: { barWidth: 22 } } };
    setState({ scene: [chart], runtime: {}, liveData: {} });
    runInteractions(chart, "mouseenter");
    expect(resolveRuntimeNode(chart, {}, getState().runtime).widget?.background).toBe("#00ff00");
    expect(resolveRuntimeNode(chart, {}, getState().runtime).data?.chart).toMatchObject({ barWidth: 22 });
    runInteractions(chart, "mouseleave");
    expect(resolveRuntimeNode(chart, {}, getState().runtime).widget?.background).toBe("#ff0000");
    expect(resolveRuntimeNode(chart, {}, getState().runtime).data?.chart).toMatchObject({ barWidth: 10 });
  });

  it("changes the selected settings on several charts and retains each preset", async () => {
    const { runInteractions } = await import("../state/sceneActions");
    const { getState, setState } = await import("../state/store");
    const { resolveRuntimeScene } = await import("../data/runtimeScene");
    const source = makeWidget("source", { interactions: [
      { id: "hide-tips", event: "itemClick", action: "modify", targetId: "bars", targetIds: ["bars", "pie"],
        settingKey: "data.chart.showTooltip", value: '{"data":{"chart":{"showTooltip":false}}}' },
      { id: "resize", event: "itemClick", action: "modify", targetId: "bars", targetIds: ["bars", "pie"],
        settingKey: "layout.width", value: '{"layout":{"width":560},"data":{"chart":{"showLegend":false}}}' },
    ] });
    const bars = makeWidget("bars", { data: { chart: { variant: "horizontalGrouped", seriesCount: 2 } } });
    const pie = makeWidget("pie", { data: { chart: { variant: "roseRing", innerRadius: 45 } } });
    setState({ scene: [source, bars, pie], runtime: {}, liveData: {} });
    runInteractions(source, "itemClick", "一月");
    const rendered = resolveRuntimeScene(getState().scene, {}, getState().runtime);
    expect(rendered[1]).toMatchObject({ boxSize: { x: 560 }, data: { chart: {
      variant: "horizontalGrouped", seriesCount: 2, showTooltip: false, showLegend: false,
    } } });
    expect(rendered[2]).toMatchObject({ boxSize: { x: 560 }, data: { chart: {
      variant: "roseRing", innerRadius: 45, showTooltip: false, showLegend: false,
    } } });
    expect(getState().scene[1]).toBe(bars);
    expect(bars.data?.chart).toEqual({ variant: "horizontalGrouped", seriesCount: 2 });
  });

  it("uses the clicked item and project parameters as dynamic settings", async () => {
    const { runInteractions } = await import("../state/sceneActions");
    const { getState, setState } = await import("../state/store");
    const source = makeWidget("chart", { interactions: [
      { id: "name", event: "itemClick", itemValue: "一月", action: "modify", targetId: "label",
        settingKey: "text", value: "{}", settingSource: { type: "formula",
          expression: "{:payload.name} · {:payload.row.产量}台" } },
      { id: "width", event: "itemClick", itemValue: "一月", action: "modify", targetId: "label",
        settingKey: "layout.width", value: "{}", settingSource: { type: "formula",
          expression: "({:payload.value} + {:base}) * 2" } },
      { id: "value", event: "itemClick", itemValue: "一月", action: "modify", targetId: "metric",
        settingKey: "text", value: "{}", settingSource: { type: "component", field: "value" } },
      { id: "missing", event: "itemClick", action: "modify", targetId: "label", settingKey: "text",
        value: '{"text":"fallback"}', settingSource: { type: "component", field: "row.缺失字段" } },
      { id: "keep", event: "itemClick", action: "modify", targetId: "metric", settingKey: "text",
        value: '{"text":"fallback"}', settingSource: { type: "keep" } },
    ] });
    setState({ scene: [source, makeWidget("label"), makeWidget("metric")], runtime: {},
      liveData: { "builtin:project-params": { base: 60 } } });
    const payload = { name: "一月", value: 125, index: 0, row: { 产量: 125 } };
    runInteractions(source, "itemClick", "二月", payload);
    expect(getState().runtime).toEqual({});
    runInteractions(source, "itemClick", "一月", payload);
    expect(getState().runtime.label).toEqual({ text: "一月 · 125台", layout: { width: 370 } });
    expect(getState().runtime.metric).toEqual({ text: "125" });
  });

  it("filters direct or nested children of the chosen interaction target", async () => {
    const { applyInteractionSettings } = await import("../data/interactionSettings");
    const source = makeWidget("source");
    const group = makeWidget("group", { type: "group", parentId: "source" });
    const chart = makeWidget("chart", { name: "产量图表", parentId: "group" });
    const metric = makeWidget("metric", { name: "产量数值", parentId: "source" });
    const other = makeWidget("other", { name: "产量图表" });
    const scene = [source, group, chart, metric, other];
    const base = { id: "children", event: "itemClick", action: "modify", targetId: "other", value: "{}" } as const;
    const runtime = {};
    expect(applyInteractionSettings({ ...base, targetScope: { mode: "currentChildren", query: "产量", recursive: false } },
      source, scene, runtime, { visible: false })).toBe("changed");
    expect(runtime).toEqual({ metric: { visible: false } });
    expect(applyInteractionSettings({ ...base, targetId: "group",
      targetScope: { mode: "children", query: "图表", recursive: false } },
      source, scene, runtime, { visible: false })).toBe("changed");
    expect(runtime).toEqual({ metric: { visible: false }, chart: { visible: false } });
    const nested = {};
    expect(applyInteractionSettings({ ...base,
      targetScope: { mode: "currentChildren", query: "产量", recursive: true } },
      source, scene, nested, { visible: false })).toBe("changed");
    expect(nested).toEqual(runtime);
  });

  it("enters and exits fullscreen explicitly and preserves legacy toggles", async () => {
    const { setPlaybackFullscreen } = await import("../data/interactionSettings");
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    const document = { documentElement: { requestFullscreen }, exitFullscreen, fullscreenElement: null as object | null };
    vi.stubGlobal("document", document);
    const onError = vi.fn();
    setPlaybackFullscreen("exit", onError);
    setPlaybackFullscreen("enter", onError);
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(exitFullscreen).not.toHaveBeenCalled();
    document.fullscreenElement = document.documentElement;
    setPlaybackFullscreen("enter", onError);
    setPlaybackFullscreen("exit", onError);
    setPlaybackFullscreen("", onError);
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(exitFullscreen).toHaveBeenCalledTimes(2);
  });

  it("cancels delayed interaction actions when preview ends", async () => {
    vi.useFakeTimers();
    try {
      const dispatchEvent = vi.fn();
      vi.stubGlobal("window", { dispatchEvent, setTimeout, clearTimeout });
      const { runInteractions, cancelPendingInteractions } = await import("../state/sceneActions");
      const { setState } = await import("../state/store");
      const chart = makeWidget("chart", { interactions: [
        { id: "animation", event: "click", action: "playEntrance", targetId: "chart", value: "", durationMs: 500 },
        { id: "later", event: "click", action: "passEvent", actionEventName: "later", targetId: "", value: "", sequence: "after" },
      ] });
      setState({ scene: [chart], runtime: {} });
      runInteractions(chart, "click");
      vi.advanceTimersByTime(499);
      expect(dispatchEvent).not.toHaveBeenCalled();
      cancelPendingInteractions();
      vi.advanceTimersByTime(1000);
      expect(dispatchEvent).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
afterEach(() => vi.unstubAllGlobals());

const makeWidget = (id: string, extra: Partial<SceneNode> = {}): SceneNode => ({
  id, name: `组件-${id}`, type: "widget", visible: true, locked: false, parentId: null,
  transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  color: "#123456", boxSize: { x: 300, y: 100, z: 1 },
  widget: { kind: "metric", background: "#ff0000", radius: 8, fontSize: 20 } as SceneNode["widget"],
  ...extra,
});

describe("context menu clipboards", () => {
  it("copies nodes with descendants and pastes them as a paste op", async () => {
    const { copyNodesToClipboard, pasteSelection } = await import("../state/sceneActions");
    const { setState } = await import("../state/store");
    const group = makeWidget("g", { type: "group" } as Partial<SceneNode>), child = makeWidget("c", { parentId: "g" });
    setState({ scene: [group, child, makeWidget("other")] });
    copyNodesToClipboard(["g"]);
    pasteSelection();
    const paste = FakeWorker.instance.messages.at(-1) as { type: string; nodes: SceneNode[] };
    expect(paste.type).toBe("paste");
    expect(paste.nodes.map((n) => n.id).sort()).toEqual(["c", "g"]);
    expect(paste.nodes.find((n) => n.id === "c")!.parentId).toBe("g");
  });

  it("copies interactions and pastes regenerated rules onto targets", async () => {
    const { copyInteractions, pasteInteractions, hasInteractionClipboard } = await import("../state/sceneActions");
    const { setState } = await import("../state/store");
    setState({ scene: [makeWidget("a", { interactions: [{ id: "r1", event: "click", action: "focus", targetId: "a", value: "" }] }), makeWidget("b")] });
    copyInteractions("b");
    expect(hasInteractionClipboard()).toBe(false);
    copyInteractions("a");
    expect(hasInteractionClipboard()).toBe(true);
    pasteInteractions(["b"]);
    const patch = FakeWorker.instance.messages.at(-1) as { type: string; id: string; patch: { interactions: { id: string; targetId: string }[] } };
    expect(patch).toMatchObject({ type: "patch", id: "b" });
    expect(patch.patch.interactions).toHaveLength(1);
    expect(patch.patch.interactions[0].id).not.toBe("r1");
    expect(patch.patch.interactions[0].targetId).toBe("a");
  });

  it("copies widget style and applies patchWidget plus color to targets", async () => {
    const { copyStyle, pasteStyle, hasStyleClipboard } = await import("../state/sceneActions");
    const { setState } = await import("../state/store");
    setState({ scene: [makeWidget("a", { color: "#abcdef" }), makeWidget("b"), makeWidget("plain", { widget: undefined })] });
    copyStyle("b");
    expect(hasStyleClipboard()).toBe(true);
    FakeWorker.instance.messages.length = 0;
    copyStyle("a");
    pasteStyle(["b", "plain"]);
    const ops = FakeWorker.instance.messages as { type: string; id: string; patch?: Record<string, unknown>; color?: string }[];
    expect(ops.filter((op) => op.id === "b")).toEqual([
      { type: "patchWidget", id: "b", patch: expect.objectContaining({ background: "#ff0000", radius: 8, fontSize: 20 }) },
      { type: "color", id: "b", color: "#abcdef" },
    ]);
    expect(ops.filter((op) => op.id === "plain")).toEqual([{ type: "color", id: "plain", color: "#abcdef" }]);
  });
});

describe("user assets", () => {
  it("round-trips saved assets and detaches parents outside the saved tree", async () => {
    const { saveUserAsset, readUserAssets, deleteUserAsset } = await import("../state/userAssets");
    const scene = [makeWidget("root-group", { type: "group" } as Partial<SceneNode>), makeWidget("child", { parentId: "root-group" }), makeWidget("loose", { parentId: "outside-group" })];
    saveUserAsset("我的组件", scene, ["root-group", "loose"]);
    const assets = readUserAssets();
    expect(assets).toHaveLength(1);
    expect(assets[0].name).toBe("我的组件");
    const saved = Object.fromEntries(assets[0].tree.map((n) => [n.id, n]));
    expect(saved.child.parentId).toBe("root-group");
    expect(saved.loose.parentId).toBeNull();
    deleteUserAsset(assets[0].id);
    expect(readUserAssets()).toEqual([]);
  });

  it("tolerates corrupt localStorage data", async () => {
    const { readUserAssets } = await import("../state/userAssets");
    storage.set("dw_user_assets", "{oops");
    expect(readUserAssets()).toEqual([]);
    storage.set("dw_user_assets", JSON.stringify({ nope: true }));
    expect(readUserAssets()).toEqual([]);
  });
});

describe("layer tree root context menu", () => {
  const actions = () => ({ openRoot: vi.fn(), edit3D: vi.fn(), renamePage: vi.fn(), addPage: vi.fn(), deletePage: vi.fn(), canDeletePage: true });
  const itemOf = (items: { type: string; key?: string }[], key: string) =>
    items.find((item) => item.type === "item" && item.key === key) as { disabled?: boolean; danger?: boolean; action?: () => void } | undefined;

  it("builds the board root menu with page management and select-all of widgets", async () => {
    const { buildRootContextMenu } = await import("../components/SceneContextMenuHost");
    const { setState } = await import("../state/store");
    setState({ scene: [makeWidget("a"), makeWidget("b")] });
    const items = buildRootContextMenu("@board", actions());
    const labels = items.map((item) => "label" in item ? item.label : "");
    expect(labels).toEqual(expect.arrayContaining(["页面设置", "重命名子看板", "添加空白子看板", "复制当前子看板", "删除子看板", "全选组件", "粘贴"]));
    expect(itemOf(items, "delete-page")!.danger).toBe(true);
    itemOf(items, "select-all")!.action!();
    expect(FakeWorker.instance.messages.at(-1)).toMatchObject({ type: "selectMany", ids: ["a", "b"] });
  });

  it("builds the page-tab context menu with rename and delete only", async () => {
    const { buildRootContextMenu } = await import("../components/SceneContextMenuHost");
    const { getState, setState } = await import("../state/store");
    const renamePage = vi.fn(); const deletePage = vi.fn();
    setState({ scene: [], settings: { ...getState().settings, boardPages: [
      { id: "board-1", name: "子看板1", width: 1920, height: 1080, style: {} }] } });
    const rootActions = { openRoot: vi.fn(), edit3D: vi.fn(), renamePage, addPage: vi.fn(), deletePage, canDeletePage: true };
    const items = buildRootContextMenu("@pagetab:board-1", rootActions);
    expect(items.map((item) => "label" in item ? item.label : "")).toEqual(["重命名", "删除"]);
    itemOf(items, "rename-tab")!.action!();
    expect(renamePage).toHaveBeenCalledWith("board-1");
    itemOf(items, "delete-tab")!.action!();
    expect(deletePage).toHaveBeenCalledWith("board-1");
    // 仅剩一个子看板时删除禁用
    const last = buildRootContextMenu("@pagetab:board-1",
      { ...rootActions, canDeletePage: false });
    expect(itemOf(last, "delete-tab")!.disabled).toBe(true);
  });

  it("builds the 3D scene root menu and selects non-widget objects", async () => {
    const { buildRootContextMenu } = await import("../components/SceneContextMenuHost");
    const { setState } = await import("../state/store");
    setState({ scene: [makeWidget("w"), makeWidget("m", { type: "model" } as Partial<SceneNode>)] });
    const items = buildRootContextMenu("@scene", actions());
    expect(items.map((item) => "label" in item ? item.label : "")).toEqual(expect.arrayContaining(["场景设置", "全选对象", "粘贴"]));
    itemOf(items, "select-all")!.action!();
    expect(FakeWorker.instance.messages.at(-1)).toMatchObject({ type: "selectMany", ids: ["m"] });
  });

  it("enters 3D editing from the twin node menu", async () => {
    const { buildRootContextMenu } = await import("../components/SceneContextMenuHost");
    const rootActions = actions();
    itemOf(buildRootContextMenu("@twin", rootActions), "enter-3d")!.action!();
    expect(rootActions.edit3D).toHaveBeenCalledOnce();
  });

  it("computes layer bucket ids and toggles whole-layer visibility", async () => {
    const { buildRootContextMenu, layerBucketIds } = await import("../components/SceneContextMenuHost");
    const { getState, setState } = await import("../state/store");
    setState({ scene: [makeWidget("cam", { type: "camera" } as Partial<SceneNode>), makeWidget("light", { type: "light" } as Partial<SceneNode>)] });
    expect(layerBucketIds(getState().scene, "@camera")).toEqual(["cam"]);
    expect(layerBucketIds(getState().scene, "@sky")).toEqual([]);
    const items = buildRootContextMenu("@lights", actions());
    itemOf(items, "select-layer")!.action!();
    expect(FakeWorker.instance.messages.at(-1)).toMatchObject({ type: "selectMany", ids: ["light"] });
    itemOf(items, "hide-layer")!.action!();
    expect(FakeWorker.instance.messages.at(-1)).toMatchObject({ type: "batch", action: "hide", ids: ["light"] });
    expect(itemOf(items, "show-layer")!.disabled).toBe(true);
  });

  it("enables paste only when the node clipboard has content", async () => {
    const { buildRootContextMenu } = await import("../components/SceneContextMenuHost");
    const { copyNodesToClipboard } = await import("../state/sceneActions");
    const { setState } = await import("../state/store");
    setState({ scene: [makeWidget("a")] });
    expect(itemOf(buildRootContextMenu("@board", actions()), "paste")!.disabled).toBe(true);
    copyNodesToClipboard(["a"]);
    expect(itemOf(buildRootContextMenu("@board", actions()), "paste")!.disabled).toBe(false);
  });

  it("routes virtual roots to the root menu and real nodes to the node menu", async () => {
    const { buildSceneContextMenu } = await import("../components/SceneContextMenuHost");
    const { setState } = await import("../state/store");
    setState({ scene: [makeWidget("a")] });
    expect(itemOf(buildSceneContextMenu("@board", vi.fn()), "page-settings")).toBeTruthy();
    expect(itemOf(buildSceneContextMenu("a", vi.fn()), "rename")).toBeTruthy();
  });

  it("hides page management in the background layer and scopes select-all to background widgets", async () => {
    const { buildRootContextMenu } = await import("../components/SceneContextMenuHost");
    const { BACKGROUND_BOARD_PAGE_ID } = await import("../data/editor");
    const { setState } = await import("../state/store");
    setState({ boardLayer: "background", scene: [makeWidget("page-a"), makeWidget("bg-a", { boardPageId: BACKGROUND_BOARD_PAGE_ID })] });
    const items = buildRootContextMenu("@board", actions());
    expect(itemOf(items, "rename-page")).toBeUndefined();
    expect(itemOf(items, "add-page")).toBeUndefined();
    expect(itemOf(items, "duplicate-page")).toBeUndefined();
    expect(itemOf(items, "delete-page")).toBeUndefined();
    itemOf(items, "select-all")!.action!();
    expect(FakeWorker.instance.messages.at(-1)).toMatchObject({ type: "selectMany", ids: ["bg-a"] });
  });

  it("scopes board select-all to the active page widgets", async () => {
    const { buildRootContextMenu } = await import("../components/SceneContextMenuHost");
    const { setState } = await import("../state/store");
    setState({ scene: [makeWidget("mine"), makeWidget("other-page", { boardPageId: "page-2" })] });
    const items = buildRootContextMenu("@board", actions());
    itemOf(items, "select-all")!.action!();
    expect(FakeWorker.instance.messages.at(-1)).toMatchObject({ type: "selectMany", ids: ["mine"] });
  });

  it("hides page management in the foreground layer and scopes select-all to foreground widgets", async () => {
    const { buildRootContextMenu } = await import("../components/SceneContextMenuHost");
    const { FOREGROUND_BOARD_PAGE_ID } = await import("../data/editor");
    const { setState } = await import("../state/store");
    setState({ boardLayer: "foreground", scene: [makeWidget("page-a"), makeWidget("fg-a", { boardPageId: FOREGROUND_BOARD_PAGE_ID })] });
    const items = buildRootContextMenu("@board", actions());
    expect(itemOf(items, "rename-page")).toBeUndefined();
    expect(itemOf(items, "delete-page")).toBeUndefined();
    itemOf(items, "select-all")!.action!();
    expect(FakeWorker.instance.messages.at(-1)).toMatchObject({ type: "selectMany", ids: ["fg-a"] });
  });

  it("offers shape settings for the empty shapes bucket", async () => {
    const { buildRootContextMenu } = await import("../components/SceneContextMenuHost");
    const items = buildRootContextMenu("@shapes", actions());
    expect(itemOf(items, "@shapes-settings")!.action).toBeTruthy();
  });
});
