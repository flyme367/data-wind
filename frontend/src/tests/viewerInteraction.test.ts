import { afterEach, describe, expect, it, vi } from "vitest";
import { chartCatalog, chartPaletteNode } from "../data/chartCatalog";
import { defaultEditorSettings, widgetNode } from "../data/editor";
import type { BoardHostOptions } from "../engine/boardCanvas";
import type { BoardRenderState } from "../viewer/boardRenderer";
import type { SceneNode } from "../types";

const viewer = vi.hoisted(() => ({
  events: undefined as BoardHostOptions | undefined,
  frames: [] as BoardRenderState[],
}));

vi.mock("../viewer/canvasHost", () => ({
  CanvasHost: class {
    syncScene() {}
    syncEnvironment() {}
    setHud() {}
    dispose() {}
  },
}));
vi.mock("../viewer/boardRenderer", () => ({
  BoardRenderer: class {
    constructor(_container: unknown, options: BoardHostOptions) { viewer.events = options; }
    render(state: BoardRenderState) { viewer.frames.push(structuredClone(state)); }
    dispose() {}
  },
}));
vi.mock("../workers/bridge", () => ({
  getSceneBridge: () => ({ subscribe: () => () => {}, post: () => {} }),
}));
vi.mock("../data/liveData", () => ({
  LiveDataManager: class {
    sync() {}
    refresh() {}
    dispose() {}
  },
}));
vi.mock("../viewer/toast", () => ({ showToast: vi.fn() }));

class FakeElement extends EventTarget {
  style: Record<string, string> = {};
  classList = { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() };
  className = "";
  textContent = "";
  src = "";
  volume = 1;
  paused = true;
  loop = false;
  preload = "";
  hidden = false;
  children: FakeElement[] = [];
  append(...elements: FakeElement[]) { this.children.push(...elements); }
  appendChild(element: FakeElement) { this.children.push(element); return element; }
  replaceChildren(...elements: FakeElement[]) { this.children = elements; }
  setAttribute() {}
  remove() {}
  pause() { this.paused = true; }
  play() { this.paused = false; return Promise.resolve(); }
}

afterEach(() => {
  viewer.events = undefined;
  viewer.frames = [];
  vi.unstubAllGlobals();
});

describe("published chart interactions", () => {
  it("filters a clicked item and renders the clicked value with project parameters", async () => {
    const page = Object.assign(new EventTarget(), {
      innerWidth: 1280, innerHeight: 720, location: new URL("https://example.test/viewer.html"),
      setTimeout, clearTimeout, setInterval, clearInterval,
    });
    const document = Object.assign(new EventTarget(), {
      createElement: () => new FakeElement(), fullscreenElement: null,
    });
    vi.stubGlobal("window", page);
    vi.stubGlobal("document", document);
    vi.stubGlobal("Element", FakeElement);

    const chart = { ...chartPaletteNode(chartCatalog.find(entry => entry.label === "T型分组条形图")!),
      id: "chart", visible: true, locked: false, parentId: null } as SceneNode;
    const text = { ...widgetNode("text"), id: "label", visible: true, locked: false, parentId: null } as SceneNode;
    const dialog = { ...widgetNode("dialog"), id: "dialog", visible: false, locked: false,
      boardPageId: "dw-foreground-board", parentId: null } as SceneNode;
    chart.interactions = [
      { id: "selected", event: "itemClick", itemValue: "示例1", action: "modify",
        targetId: "label", settingKey: "text", value: "{}",
        settingSource: { type: "formula", expression: "{:area} · {:payload.name} · {:payload.value}" } },
      { id: "custom", event: "custom", triggerValue: "update-value", action: "modify",
        targetId: "label", settingKey: "text", value: "{}",
        settingSource: { type: "component", field: "value" } },
      { id: "dialog", event: "itemClick", itemValue: "示例1", action: "dialog",
        targetId: "dialog", value: "open" },
    ];
    const { startViewer } = await import("../viewer/runtime");
    const handle = startViewer({ projectId: "viewer", projectName: "联动", tree: [chart, text, dialog],
      settings: structuredClone(defaultEditorSettings), params: { area: "一区" },
      boardSize: { width: 1920, height: 1080 } }, new FakeElement() as unknown as HTMLElement);
    try {
      const initial = viewer.frames.length;
      viewer.events?.onComponentEvent?.(chart, "itemClick", "示例2", { name: "示例2", value: 30 });
      expect(viewer.frames).toHaveLength(initial);
      viewer.events?.onComponentEvent?.(chart, "itemClick", "示例1", { name: "示例1", value: 24 });
      expect(viewer.frames.at(-1)?.runtime.label?.text).toBe("一区 · 示例1 · 24");
      expect(viewer.frames.at(-1)?.runtime.dialog?.visible).toBe(true);
      viewer.events?.onDialogAction?.(dialog, "close");
      expect(viewer.frames.at(-1)?.runtime.dialog?.visible).toBe(false);
      viewer.events?.onComponentEvent?.(chart, "itemClick", "示例1", { name: "示例1", value: 24 });
      expect(viewer.frames.at(-1)?.runtime.dialog?.visible).toBe(true);
      page.dispatchEvent(new CustomEvent("dw:dev-event", { detail: { name: "update-value", payload: { value: 37 } } }));
      expect(viewer.frames.at(-1)?.runtime.label?.text).toBe("37");
      expect(text.widget?.text).not.toBe("一区 · 示例1 · 24");
    } finally {
      handle.dispose();
    }
  });
});
