import type { RustBoardNode } from "./boardScene";

export interface MetricAnimation {
  target: number; from: number; startAt: number; delay: number; duration: number;
  mode: string; loop: boolean; interval: number;
}

export interface TextAnimation { key: string; startAt: number }

/** Keep text animation timing stable across scene updates and restart when its content changes. */
export function prepareKitTextAnimations(nodes: RustBoardNode[], playback: Map<string, TextAnimation>,
  now: number, preview: boolean): void {
  if (!preview) { playback.clear(); return; }
  const present = new Set<string>();
  for (const node of nodes) {
    const raw = node.data.__kitTextAnimation;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const data = raw as Record<string, unknown>;
    const key = JSON.stringify([node.widget.text, data.mode, data.delay, data.duration, data.loop, data.interval, data.easing]);
    present.add(node.id);
    let current = playback.get(node.id);
    if (!current || current.key !== key) {
      current = { key, startAt: now };
      playback.set(node.id, current);
    }
    node.data.__kitTextAnimation = { ...data, startAt: current.startAt };
  }
  for (const id of playback.keys()) if (!present.has(id)) playback.delete(id);
}

/** Preserve animation start times across redraws and restart on a new data value. */
export function prepareKitMetricAnimations(nodes: RustBoardNode[], playback: Map<string, MetricAnimation>,
  now: number, preview: boolean): void {
  if (!preview) { playback.clear(); return; }
  const present = new Set<string>();
  for (const node of nodes) {
    const raw = node.data.__kitMetricAnimation;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const data = raw as Record<string, unknown>;
    const target = Number(data.target);
    if (!Number.isFinite(target)) continue;
    present.add(node.id);
    const previous = playback.get(node.id);
    const delay = Math.max(0, Number(data.delay) || 0), duration = Math.max(1, Number(data.duration) || 1000);
    const mode = String(data.mode ?? "count"), loop = data.loop === true, interval = Math.max(0, Number(data.interval) || 0);
    let next = previous;
    if (!previous || previous.target !== target || previous.mode !== mode || previous.delay !== delay
        || previous.duration !== duration || previous.loop !== loop || previous.interval !== interval) {
      const elapsed = previous ? Math.max(0, now - previous.startAt - previous.delay) : 0;
      const phase = previous && previous.loop && previous.mode === "count"
        ? elapsed % (previous.duration + previous.interval) : elapsed;
      const progress = previous ? Math.min(1, phase / previous.duration) : 0;
      const current = previous ? previous.from + (previous.target - previous.from) * progress : 0;
      next = { target, from: mode === "update" ? current : 0, startAt: now, delay, duration, mode, loop, interval };
      playback.set(node.id, next);
    }
    node.data.__kitMetricAnimation = { ...data, ...next };
  }
  for (const id of playback.keys()) if (!present.has(id)) playback.delete(id);
}
