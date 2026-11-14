import { afterEach, describe, expect, it, vi } from "vitest";
import { widgetNode } from "../data/editor";
import { RustBoardHost } from "../engine/boardCanvas";
import { boardNodes } from "../engine/boardScene";
import type { SceneNode } from "../types";

function setup() {
  const node = { id: "chart", visible: true, locked: false, parentId: null,
    ...widgetNode("bar") } as SceneNode;
  const edit = vi.fn();
  const canvas = { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true),
    releasePointerCapture: vi.fn() };
  const host = Object.assign(Object.create(RustBoardHost.prototype), {
    state: { scene: [node], boardWidth: 1000, boardHeight: 500, preview: false, selected: [node.id] },
    nodes: boardNodes([node]), surface: {}, drag: null,
    layer: { hidden: false, getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 250 }) },
    options: { onEdit: edit }, sync: vi.fn(),
  }) as {
    hit(event: PointerEvent): { id: string; handle: string | null } | null;
    pointerDown(event: PointerEvent, target: typeof canvas): void;
    pointerMove(event: PointerEvent): void;
    pointerUp(event: PointerEvent, target: typeof canvas): void;
  };
  const event = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1, button: 0,
    shiftKey: false, stopPropagation: vi.fn(), preventDefault: vi.fn() }) as unknown as PointerEvent;
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("HTMLElement", class {});
  return { host, canvas, edit, event };
}

afterEach(() => vi.unstubAllGlobals());

describe("board component editing", () => {
  it("moves a component from its body at the current canvas zoom", () => {
    const { host, canvas, edit, event } = setup();
    host.pointerDown(event(100, 80), canvas);
    host.pointerMove(event(130, 100));
    host.pointerUp(event(130, 100), canvas);
    expect(edit).toHaveBeenCalledWith({ type: "move", ids: ["chart"], dx: 60, dy: 40 });
  });

  it("resizes width from the selected right-edge handle using a screen-sized hit area", () => {
    const { host, canvas, edit, event } = setup();
    expect(host.hit(event(250, 105))?.handle).toBe("e");
    host.pointerDown(event(250, 105), canvas);
    host.pointerMove(event(270, 105));
    host.pointerUp(event(270, 105), canvas);
    expect(edit).toHaveBeenCalledWith({ type: "resize", id: "chart", x: 80, y: 80,
      width: 460, height: 260 });
  });
});
