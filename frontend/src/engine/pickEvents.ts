export type PickTrigger = "click" | "dblclick";
type PickCallback = (id: string | null, additive: boolean, trigger: PickTrigger) => void;
type Point = { x: number; y: number; additive: boolean; time: number };

/** Reconcile asynchronous GPU picks with browser double-click events. */
export function createPickEvents(callback: PickCallback, now: () => number = () => performance.now()) {
  let last: (Point & { id: string | null }) | null = null;
  let pending: Point | null = null;
  const close = (a: Point, b: Point) => b.time - a.time <= 700 && Math.hypot(a.x - b.x, a.y - b.y) <= 8;
  return {
    click(id: string | null, x: number, y: number, additive: boolean) {
      const point = { x, y, additive, time: now() };
      last = { ...point, id };
      callback(id, additive, "click");
      if (pending && close(pending, point)) callback(id, pending.additive, "dblclick");
      pending = null;
    },
    doubleClick(x: number, y: number, additive: boolean) {
      const point = { x, y, additive, time: now() };
      if (last && close(last, point)) callback(last.id, additive, "dblclick");
      else pending = point;
    },
    clear() { last = null; pending = null; },
  };
}
