import { ancestorMatches, normalizeWidgetStyle } from "../data/editor";
import { kitMetadata, kitRecord } from "../data/kitRuntime";
import type { KitWeatherSample } from "../data/kitWeather";
import { kitBoardVisuals } from "./kitBoard";
import { expandKitLists, type KitListTransition } from "./kitList";
import type { SceneNode } from "../types";

export interface RustBoardNode {
  id: string; name: string; x: number; y: number; width: number; height: number;
  rotation: number; color: string; locked: boolean;
  widget: NonNullable<SceneNode["widget"]>;
  data: Record<string, unknown>;
}

/** Widgets whose visible content changes on the one-second clock. */
export function boardUsesSecondClock(kind: string): boolean {
  return kind === "clock" || kind === "timer" || kind === "calendar";
}

/** Maps with a visible breathing point need animation frames between clock ticks. */
export function boardHasMotion(node: RustBoardNode): boolean {
  const text = node.data.__kitTextAnimation;
  if (text && typeof text === "object" && !Array.isArray(text)) {
    const animation = text as Record<string, unknown>;
    if (typeof animation.startAt === "number" && Number.isFinite(animation.startAt)) {
      const elapsed = Date.now() - animation.startAt - Number(animation.delay || 0);
      const duration = Math.max(1, Number(animation.duration) || 1000);
      if (elapsed >= 0) {
        const interval = Math.max(0, Number(animation.interval) || 0);
        const phase = animation.loop === true ? elapsed % (duration + interval) : elapsed;
        if (phase < duration + 100) return true;
      }
    }
  }
  const metric = node.data.__kitMetricAnimation;
  if (metric && typeof metric === "object" && !Array.isArray(metric)) {
    const animation = metric as Record<string, unknown>;
    if (typeof animation.startAt === "number" && Number.isFinite(animation.startAt)) {
      const elapsed = Date.now() - animation.startAt - Number(animation.delay || 0);
      const duration = Math.max(1, Number(animation.duration) || 1000);
      if (elapsed >= 0) {
        const interval = Math.max(0, Number(animation.interval) || 0);
        const phase = animation.loop === true && animation.mode === "count" ? elapsed % (duration + interval) : elapsed;
        if (phase < duration + 100) return true;
      }
    }
  }
  if (Array.isArray(node.data.__dwEntrance) && node.data.__dwEntrance.some((item: unknown) => {
    if (!item || typeof item !== "object") return false;
    const animation = item as { startAt?: unknown; delay?: unknown; duration?: unknown };
    return typeof animation.startAt === "number" && typeof animation.delay === "number"
      && typeof animation.duration === "number"
      && Date.now() < animation.startAt + animation.delay + animation.duration + 100;
  })) return true;
  const chart = node.data.chart;
  if (chart && typeof chart === "object" && !Array.isArray(chart)) {
    const options = chart as Record<string, unknown>;
    if (["dynamicBar", "pathAnimation"].includes(String(options.variant)) && options.playAnimation !== false) return true;
    const configuredCount = Number(options.visibleCategoryCount ?? 10);
    const limitsCategories = (node.widget.kind.startsWith("line") || node.widget.kind.startsWith("area"))
      && options.variant !== "rangeArea";
    const visibleFlows = limitsCategories && options.categoryVisibilityMode === "custom" && Number.isFinite(configuredCount)
      && configuredCount < 2 ? 0 : 3;
    if (options.flowEnabled === true && options.playAnimation !== false
      && ["line", "lineSmooth", "lineMulti", "area", "areaGradient", "areaStacked", "dualAxis"].includes(node.widget.kind)
      && options.variant !== "rangeArea" && Array.isArray(options.flowStyles)
      && options.flowStyles.slice(0, visibleFlows).some(style => style && typeof style === "object" && style.enabled === true)) return true;
  }
  if (node.widget.kind === "mapTrack") return true;
  if (node.widget.kind !== "mapOutline" && node.widget.kind !== "mapTile") return false;
  const breath = node.data.breath;
  if (!breath || typeof breath !== "object" || Array.isArray(breath)) return false;
  return Array.isArray(node.data.rows) && node.data.rows.some((row: unknown) => {
    if (!row || typeof row !== "object") return false;
    const point = row as { lon?: unknown; lat?: unknown };
    return typeof point.lon === "number" && Number.isFinite(point.lon)
      && typeof point.lat === "number" && Number.isFinite(point.lat);
  });
}

/** Only scene values cross the boundary; all component layout and geometry are generated in Rust. */
export function boardNodes(scene: SceneNode[], preview = false,
  listOffsets: ReadonlyMap<string, number> = new Map(), listSelections: ReadonlyMap<string, number> = new Map(),
  listTransitions: ReadonlyMap<string, KitListTransition> = new Map(),
  weather?: (options: Record<string, unknown>) => KitWeatherSample | undefined): RustBoardNode[] {
  scene = expandKitLists(scene, preview, listOffsets, listSelections, listTransitions);
  const byId = new Map(scene.map(node => [node.id, node]));
  const childNames = new Map<string, string[]>();
  for (const node of scene) if (node.parentId) {
    const siblings = childNames.get(node.parentId);
    if (siblings) siblings.push(node.name); else childNames.set(node.parentId, [node.name]);
  }
  const tabOverlays = new Map<string, { node: RustBoardNode; after: number }>();
  const result: RustBoardNode[] = [];
  for (const node of scene) {
    if (!node.widget || !node.visible || ancestorMatches(node, byId, parent => !parent.visible)) continue;
    const meta = kitMetadata(node);
    if (node.type !== "widget" && !meta) continue;
    // The editable source definition stays in the scene snapshot, outside the per-frame Rust payload.
    const { __kit: _source, __kitColor, __kitRelatedOptions, __kitActiveRows: _rows,
      __kitFilterContext: _filterContext, __kitDataLinkage: _linkage, __kitLinkRowIndices: _linkRows, ...data } = node.data ?? {};
    const rendered: RustBoardNode = {
      id: node.id, name: node.name,
      x: node.transform.position.x, y: node.transform.position.y,
      width: node.boxSize?.x ?? 300, height: node.boxSize?.y ?? 64,
      rotation: node.transform.rotation.z, color: node.color, locked: node.locked,
      widget: normalizeWidgetStyle(node.widget), data,
    };
    const ancestors = new Set<string>();
    const listBackgrounds: RustBoardNode[] = [];
    if (meta) {
      if (typeof __kitColor === "string") rendered.color = __kitColor;
      let parent = node.parentId ? byId.get(node.parentId) : undefined;
      while (parent && parent.id !== node.id && !ancestors.has(parent.id)) {
        ancestors.add(parent.id);
        if (kitMetadata(parent)) rendered.widget.opacity *= parent.widget?.opacity ?? 1;
        parent = parent.parentId ? byId.get(parent.parentId) : undefined;
      }
      const labels = [...childNames.get(node.id) ?? []].reverse();
      for (const visual of kitBoardVisuals(rendered, meta, labels, kitRecord(__kitRelatedOptions), weather)) {
        if (rendered.data.__kitListClip && !visual.data.__kitResource)
          visual.data.__kitListClip = rendered.data.__kitListClip;
        if (visual.data.__kitPanelTab) tabOverlays.set(node.id, { node: visual, after: -1 });
        else if (visual.data.__kitListBackground) listBackgrounds.push(visual);
        else result.push(visual);
      }
      if (node.type === "group" && !rendered.data.__kitClose) rendered.data.passThrough = true;
    }
    result.push(rendered);
    result.push(...listBackgrounds);
    for (const id of [node.id, ...ancestors]) {
      const overlay = tabOverlays.get(id);
      if (overlay) overlay.after = result.length - 1;
    }
  }
  if (!tabOverlays.size) return result;
  const after = new Map<number, RustBoardNode[]>();
  for (const overlay of [...tabOverlays.values()].reverse()) {
    const group = after.get(overlay.after);
    if (group) group.push(overlay.node); else after.set(overlay.after, [overlay.node]);
  }
  return result.flatMap((node, index) => [node, ...after.get(index) ?? []]);
}

export function boardClock(now = new Date()) {
  return {
    time: now.toLocaleTimeString("zh-CN", { hour12: false }),
    year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate(),
    firstWeekday: new Date(now.getFullYear(), now.getMonth(), 1).getDay(),
    days: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(), now: now.getTime(),
  };
}
