import { afterEach, describe, expect, it, vi } from "vitest";
import { widgetNode } from "../data/editor";
import { RustBoardHost } from "../engine/boardCanvas";
import { boardNodes } from "../engine/boardScene";
import type { SceneNode } from "../types";

function makeHost(kind: "text" | "clock" | "image" | "mapOutline", withPoints = true) {
  const node = { id: "node", visible: true, locked: false, parentId: null,
    ...widgetNode(kind) } as SceneNode;
  if (kind === "image") node.widget!.image = "";
  if (kind === "mapOutline") {
    node.data = { ...node.data, rows: withPoints ? [{ lon: 10, lat: 10, value: 1 }] : [] };
  }
  const frame = vi.fn(() => new Uint8Array());
  const clearImage = vi.fn();
  const rect = vi.fn(() => ({ width: 320, height: 180 }));
  const host = Object.assign(Object.create(RustBoardHost.prototype), {
    disposed: false, dirty: true, lastPaint: 0, lastSecond: -1,
    nodes: boardNodes([node]), state: {}, resources: new Map(), geoReady: true,
    layer: { hidden: false, getBoundingClientRect: rect },
    surface: { frame, clear_image: clearImage },
    status: {},
  }) as { tick(time: number): void; resources: Map<string, unknown> };
  return { host, frame, clearImage, rect };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("board redraw scheduling", () => {
  it("leaves a static board untouched across clock ticks", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { host, frame, rect } = makeHost("text");
    host.tick(0);
    now.mockReturnValue(2_000);
    host.tick(1_000);
    expect(frame).toHaveBeenCalledTimes(1);
    expect(rect).toHaveBeenCalledTimes(1);
  });

  it("updates clock widgets every second", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { host, frame } = makeHost("clock");
    host.tick(0);
    now.mockReturnValue(2_000);
    host.tick(1_000);
    expect(frame).toHaveBeenCalledTimes(2);
  });

  it("keeps a map's breathing points animated within a second", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { host, frame } = makeHost("mapOutline");
    host.tick(0);
    host.tick(100);
    expect(frame).toHaveBeenCalledTimes(2);
  });

  it("does not animate a map without breathing points", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { host, frame } = makeHost("mapOutline", false);
    host.tick(0);
    host.tick(100);
    expect(frame).toHaveBeenCalledOnce();
  });

  it("clears removed media once and then leaves the empty image static", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { host, frame, clearImage } = makeHost("image");
    const dispose = vi.fn();
    host.resources.set("node", { key: "old", dispose });
    host.tick(0);
    now.mockReturnValue(2_000);
    host.tick(1_000);
    expect(dispose).toHaveBeenCalledOnce();
    expect(clearImage).toHaveBeenCalledOnce();
    expect(frame).toHaveBeenCalledOnce();
  });
});

describe("chart ranking images", () => {
  it("loads the current image, ignores an outdated load, and clears it when disabled", () => {
    class FakeImage extends EventTarget {
      crossOrigin = "";
      src = "";
      naturalWidth = 1;
      naturalHeight = 1;
    }
    class FakeMedia extends EventTarget {}
    class FakeVideo extends FakeMedia {}
    class FakeAudio extends FakeMedia {}
    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal("HTMLImageElement", FakeImage);
    vi.stubGlobal("HTMLMediaElement", FakeMedia);
    vi.stubGlobal("HTMLVideoElement", FakeVideo);
    vi.stubGlobal("HTMLAudioElement", FakeAudio);
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    const node = { id: "chart", visible: true, locked: false, parentId: null, ...widgetNode("bar") } as SceneNode;
    node.data = { ...node.data, chart: { showRanking: true, rankingBackground: "image",
      rankingBackgroundImage: "data:image/png;base64,first" } };
    const rendered = boardNodes([node])[0];
    const setImage = vi.fn(), clearImage = vi.fn();
    const host = Object.assign(Object.create(RustBoardHost.prototype), {
      disposed: false, dirty: false, geoReady: true, state: {}, nodes: [rendered], resources: new Map(),
      surface: { set_image: setImage, clear_image: clearImage },
      decodeCanvas: { width: 1, height: 1, getContext: () => ({ drawImage: vi.fn(),
        getImageData: () => ({ width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) }) }) },
    }) as { loadResources(): void; resources: Map<string, { element: FakeImage }> };
    host.loadResources();
    const first = host.resources.get("chart")!.element;
    (rendered.data.chart as Record<string, unknown>).rankingBackgroundImage = "data:image/png;base64,second";
    host.loadResources();
    const second = host.resources.get("chart")!.element;
    first.dispatchEvent(new Event("load"));
    expect(setImage).not.toHaveBeenCalled();
    second.dispatchEvent(new Event("load"));
    expect(setImage).toHaveBeenCalledOnce();
    expect(setImage).toHaveBeenCalledWith("chart", 1, 1, new Uint8Array([1, 2, 3, 255]));
    Object.assign(rendered.data.chart as object, { legendType: "scroll",
      legendPageLeftImage: "data:image/png;base64,left", legendPageRightImage: "data:image/png;base64,right",
      tooltipBackgroundImage: "data:image/png;base64,tooltip" });
    host.loadResources();
    const leftId = "\u001flegend-left:chart", rightId = "\u001flegend-right:chart";
    const tooltipId = "\u001ftooltip:chart";
    const left = host.resources.get(leftId)!.element, right = host.resources.get(rightId)!.element;
    const tooltip = host.resources.get(tooltipId)!.element;
    host.loadResources();
    expect(host.resources.get(leftId)!.element).toBe(left);
    left.dispatchEvent(new Event("load")); right.dispatchEvent(new Event("load")); tooltip.dispatchEvent(new Event("load"));
    expect(setImage).toHaveBeenCalledWith(leftId, 1, 1, new Uint8Array([1, 2, 3, 255]));
    expect(setImage).toHaveBeenCalledWith(rightId, 1, 1, new Uint8Array([1, 2, 3, 255]));
    expect(setImage).toHaveBeenCalledWith(tooltipId, 1, 1, new Uint8Array([1, 2, 3, 255]));
    expect(host.resources.size).toBe(4);
    (rendered.data.chart as Record<string, unknown>).showRanking = false;
    host.loadResources();
    expect(host.resources.has("chart")).toBe(false);
    expect(host.resources.size).toBe(3);
    expect(clearImage).toHaveBeenCalledTimes(6);
    (rendered.data.chart as Record<string, unknown>).legendType = "plain";
    host.loadResources();
    expect(host.resources.size).toBe(1);
    expect(clearImage).toHaveBeenCalledTimes(8);
    (rendered.data.chart as Record<string, unknown>).showTooltip = false;
    host.loadResources();
    expect(host.resources.size).toBe(0);
    expect(clearImage).toHaveBeenCalledTimes(9);
    rendered.widget.kind = "lineMulti";
    Object.assign(rendered.data.chart as object, { seriesCount: 2, pointShape: "image", pointImage: "data:image/png;base64,uniform",
      seriesStyleEnabled: true, seriesStyles: [
        { pointShape: "image", pointImage: "data:image/png;base64,first-point" },
        { pointShape: "image", pointImage: "data:image/png;base64,second-point" },
      ] });
    host.loadResources();
    const firstPointId = "\u001fpoint:0:chart", secondPointId = "\u001fpoint:1:chart";
    const firstPoint = host.resources.get(firstPointId)!.element;
    const secondPoint = host.resources.get(secondPointId)!.element;
    firstPoint.dispatchEvent(new Event("load")); secondPoint.dispatchEvent(new Event("load"));
    expect(setImage).toHaveBeenCalledWith(firstPointId, 1, 1, new Uint8Array([1, 2, 3, 255]));
    expect(setImage).toHaveBeenCalledWith(secondPointId, 1, 1, new Uint8Array([1, 2, 3, 255]));
    (rendered.data.chart as Record<string, unknown>).showPoints = false;
    host.loadResources();
    expect(host.resources.size).toBe(0);
    expect(clearImage).toHaveBeenCalledWith(firstPointId);
    expect(clearImage).toHaveBeenCalledWith(secondPointId);
  });
});

describe("preview pointer interaction", () => {
  it("does not activate a chart item when the pointer was dragged or released elsewhere", () => {
    const pointer = vi.fn(), onClick = vi.fn();
    const node = { id: "chart" } as SceneNode;
    const host = Object.assign(Object.create(RustBoardHost.prototype), {
      state: { preview: true, scene: [node] }, nodes: [], surface: { pointer }, options: { onClick },
      hit: vi.fn(() => ({ id: "chart", control: false })), relative: vi.fn(() => [0, 0]),
      sceneNode: vi.fn(() => node), setSelectedInteractionNode: vi.fn(), drainEvents: vi.fn(),
    }) as { pointerDown(event: PointerEvent, canvas: HTMLCanvasElement): void;
      pointerUp(event: PointerEvent, canvas: HTMLCanvasElement): void };
    const canvas = { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false) } as unknown as HTMLCanvasElement;
    const event = (x: number) => ({ pointerId: 1, button: 0, clientX: x, clientY: 0,
      preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as PointerEvent;
    host.pointerDown(event(0), canvas);
    host.pointerUp(event(20), canvas);
    expect(pointer.mock.calls.map(call => call[0])).toEqual(["down", "cancel"]);
    expect(onClick).not.toHaveBeenCalled();
    pointer.mockClear();
    host.pointerDown(event(0), canvas);
    host.pointerUp(event(1), canvas);
    expect(pointer.mock.calls.map(call => call[0])).toEqual(["down", "up"]);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
