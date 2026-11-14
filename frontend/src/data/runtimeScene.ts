import type { AppState } from "../state/store";
import type { FlatInstance, SceneNode } from "../types";
import { flattenScene } from "../workers/sceneModel";
import { BACKGROUND_BOARD_PAGE_ID, FOREGROUND_BOARD_PAGE_ID, boundNode, chartDataWithColor, dataAt, isChartWidget } from "./editor";
import { isKitTabPanel, kitMetadata, kitOptions, kitTabIndex, kitTabLabels, resolveKitOptions, resolveKitRows, resolveKitState } from "./kitRuntime";
import type { BoardDataCondition, KitConditionContext } from "./dataConditions";
import { linkedKitRows } from "./kitLinkage";

export interface RuntimeOverride {
  visible?: boolean; color?: string; stateId?: string; text?: string;
  widgetPatch?: Record<string, unknown>; dataPatch?: Record<string, unknown>;
  layout?: Partial<{ x: number; y: number; width: number; height: number; rotation: number }>;
}
export type RuntimeOverrides = Record<string, RuntimeOverride>;
export type LiveValues = Record<string, Record<string, unknown>>;

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** Merge individual chart settings without discarding the selected variant and series. */
export function mergeRuntimeData(previous: Record<string, unknown> | undefined, patch: Record<string, unknown>) {
  const chart = asRecord(patch.chart);
  const kit = asRecord(patch.__kitOptionOverrides);
  return { ...previous, ...patch,
    ...(chart ? { chart: { ...asRecord(previous?.chart), ...chart } } : {}),
    ...(kit ? { __kitOptionOverrides: { ...asRecord(previous?.__kitOptionOverrides), ...kit } } : {}),
  };
}

export function changeKitTab(previous: RuntimeOverride | undefined, index: number): RuntimeOverride {
  return { ...previous, dataPatch: mergeRuntimeData(previous?.dataPatch, { __kitOptionOverrides: { "active-index": index } }) };
}

/** Data bindings apply first; interactive overrides take precedence until preview ends. */
export function resolveRuntimeNode(node: SceneNode, liveData: LiveValues, runtime: RuntimeOverrides,
  conditions: BoardDataCondition[] = []): SceneNode {
  const override = runtime[node.id];
  if (override?.stateId) node = resolveKitState(node, override.stateId);
  const optionOverrides = asRecord(override?.dataPatch?.__kitOptionOverrides);
  if (optionOverrides) node = resolveKitOptions(node, optionOverrides);
  const shared = node.sharedDataSourceId ? liveData[node.sharedDataSourceId] : undefined;
  const own = liveData[node.id];
  const data = shared || own ? { ...node.data, ...shared, ...own,
    ...(node.widget && node.widget.kind !== "table" && isChartWidget(node.widget.kind) && node.data?.chart !== undefined
      ? { chart: node.data.chart } : {}),
    ...(node.widget && node.widget.kind !== "table" && isChartWidget(node.widget.kind) && node.data?.chartStates !== undefined
      ? { chartStates: node.data.chartStates } : {}) } : node.data;
  const context: KitConditionContext | undefined = conditions.length && kitMetadata(node)
    ? { conditions, sources: liveData, currentSourceId: node.sharedDataSourceId } : undefined;
  const hasLiveRows = Array.isArray(shared?.rows) || Array.isArray(own?.rows)
    || Boolean(node.bindings?.rows && Array.isArray(dataAt(data, node.bindings.rows)));
  const sourced = data ? { ...node, data: context ? { ...data, __kitFilterContext: context } : data } : node;
  const bound = boundNode(sourced);
  const linked = linkedKitRows(node, bound.data, hasLiveRows, override?.dataPatch?.__kitDataLinkage);
  const filtered = linked ? { ...bound, data: { ...bound.data, rows: linked.rows, __kitLinkRowIndices: linked.indices } } : bound;
  let resolved = resolveKitRows(filtered, hasLiveRows || Boolean(linked), context);
  const meta = kitMetadata(resolved);
  const choiceOptions = meta && kitOptions(meta.source);
  if (linked && resolved.widget?.kind === "dropdown" && choiceOptions?.["select-item-after-linkage"] === true
      && !override?.dataPatch?.__kitSelection) {
    const items = Array.isArray(resolved.data?.options) ? resolved.data.options.map(String) : [];
    const tip = String(choiceOptions["dropdown-tip-text"] ?? "请选择");
    const first = items.find(item => choiceOptions["show-default-option"] !== true || item !== tip) ?? "";
    resolved = { ...resolved, data: { ...resolved.data, __kitSelection: {
      sourceId: "__kitDataLinkage", value: first,
      ...(choiceOptions["use-multiple"] === true ? { values: first ? [first] : [] } : {}),
      revision: JSON.stringify(override?.dataPatch?.__kitDataLinkage),
    } } };
  }
  const boundColor = node.bindings?.color ? dataAt(data, node.bindings.color) : undefined;
  const applyColor = (item: SceneNode, candidate: unknown): SceneNode => {
    if (typeof candidate !== "string" || !/^#[0-9a-f]{6}$/i.test(candidate)) return item;
    const data = chartDataWithColor(item, candidate);
    return { ...item, data: kitMetadata(item) ? { ...data, __kitColor: candidate } : data };
  };
  if (!override) return applyColor(resolved, boundColor);
  const { stateId, text, widgetPatch, dataPatch, layout, ...rest } = override;
  // 山海鲸「切换状态」：active 状态 = 组件样式/内容的覆盖补丁；「设置文本」= 运行时改标题
  const patch = stateId ? node.widget?.states?.find((item) => item.id === stateId)?.patch : undefined;
  const chartPatch = patch && stateId ? asRecord(asRecord(node.data?.chartStates)?.[stateId]) : undefined;
  const stateData = chartPatch ? mergeRuntimeData(resolved.data, { chart: chartPatch }) : resolved.data;
  const nextData = dataPatch ? mergeRuntimeData(stateData, dataPatch) : stateData;
  let widget = resolved.widget;
  if (patch && widget) widget = { ...widget, ...patch };
  if (text !== undefined && widget) widget = { ...widget, text };
  if (widgetPatch && widget) widget = { ...widget, ...widgetPatch };
  const position = resolved.transform.position;
  const rotation = resolved.transform.rotation;
  const size = resolved.boxSize;
  const stateColor = Array.isArray(chartPatch?.colors) ? chartPatch.colors[0] : undefined;
  const updatedColors = asRecord(dataPatch?.chart)?.colors;
  const updatedColor = Array.isArray(updatedColors) ? updatedColors[0] : undefined;
  return applyColor({
    ...resolved,
    ...rest,
    ...(dataPatch || chartPatch ? { data: nextData } : {}),
    ...(layout && node.type === "widget" ? {
      transform: { ...resolved.transform,
        position: { ...position, x: layout.x ?? position.x, y: layout.y ?? position.y },
        rotation: { ...rotation, z: layout.rotation ?? rotation.z } },
      boxSize: { x: layout.width ?? size?.x ?? 300, y: layout.height ?? size?.y ?? 64, z: size?.z ?? 1 },
    } : {}),
    ...(widget && (patch || text !== undefined || widgetPatch) ? { widget } : {}),
  }, rest.color ?? updatedColor ?? stateColor ?? boundColor);
}

export function resolveRuntimeScene(scene: SceneNode[], liveData: LiveValues, runtime: RuntimeOverrides,
  conditions: BoardDataCondition[] = []): SceneNode[] {
  const result = scene.map(node => resolveRuntimeNode(node, liveData, runtime, conditions));
  const children = new Map<string, SceneNode[]>();
  for (const node of result) if (node.parentId) {
    const list = children.get(node.parentId);
    if (list) list.push(node); else children.set(node.parentId, [node]);
  }
  const visibleTabs = new Map<string, string>();
  for (const node of result) {
    const kit = kitMetadata(node);
    if (!kit || !isKitTabPanel(kit.source.type)) continue;
    const tabs = [...children.get(node.id) ?? []].reverse();
    const options = kitOptions(kit.source), labels = kitTabLabels(options, tabs.map(tab => tab.name));
    const index = kitTabIndex(options, labels.length);
    const selected = tabs.find(tab => tab.name === labels[index]) ?? tabs[index];
    if (selected) visibleTabs.set(node.id, selected.id);
  }
  return visibleTabs.size ? result.map(node => {
    const selected = node.parentId ? visibleTabs.get(node.parentId) : undefined;
    return selected && node.id !== selected ? { ...node, visible: false } : node;
  }) : result;
}

/** Scale shared background/foreground board widgets to the active child screen's coordinate size. */
export function scaleBackgroundWidgets(
  scene: SceneNode[],
  background: { width: number; height: number },
  target: { width: number; height: number },
  foreground?: { width: number; height: number } | null,
): SceneNode[] {
  const sameSize = (a: { width: number; height: number }, b: { width: number; height: number }) =>
    a.width === b.width && a.height === b.height;
  const bgSame = sameSize(background, target);
  const fgSame = !foreground || sameSize(foreground, target);
  if (bgSame && fgSame) return scene;
  const byId = new Map(scene.map((node) => [node.id, node]));
  const reservedIds = (pageId: string) => new Set(scene.filter((node) => node.type === "widget" &&
    node.boardPageId === pageId).map((node) => node.id));
  const backgroundIds = reservedIds(BACKGROUND_BOARD_PAGE_ID);
  const foregroundIds = foreground ? reservedIds(FOREGROUND_BOARD_PAGE_ID) : new Set<string>();
  // 含保留层组件的分组整体随该层缩放（背景层优先，避免同时含两层组件的分组被双重缩放）
  const groupsFor = (ids: Set<string>) => {
    const groupIds = new Set<string>();
    for (const widgetId of ids) {
      let parent = byId.get(widgetId)?.parentId;
      const seen = new Set<string>();
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        const node = byId.get(parent);
        if (node?.type === "group") groupIds.add(node.id);
        parent = node?.parentId ?? null;
      }
    }
    return groupIds;
  };
  const backgroundGroups = groupsFor(backgroundIds);
  const foregroundGroups = groupsFor(foregroundIds);
  const bgScale = { x: target.width / background.width, y: target.height / background.height };
  const fgScale = foreground ? { x: target.width / foreground.width, y: target.height / foreground.height } : bgScale;
  return scene.map((node) => {
    const inBackground = backgroundIds.has(node.id) || backgroundGroups.has(node.id);
    const inForeground = foregroundIds.has(node.id) || foregroundGroups.has(node.id);
    const scale = inBackground || !inForeground ? (inBackground ? bgScale : null) : fgScale;
    if (!scale) return node;
    return {
      ...node,
      transform: { ...node.transform, position: { ...node.transform.position,
        x: node.transform.position.x * scale.x, y: node.transform.position.y * scale.y } },
      ...(node.boxSize ? { boxSize: { ...node.boxSize, x: node.boxSize.x * scale.x, y: node.boxSize.y * scale.y } } : {}),
    };
  });
}

let cache: { scene: SceneNode[]; flat: unknown[]; liveData: LiveValues; runtime: RuntimeOverrides; result: FlatInstance[] } | null = null;
export function runtimeFlat(state: Pick<AppState, "scene" | "flat" | "liveData" | "runtime">): FlatInstance[] {
  if (!Object.keys(state.liveData).length && !Object.keys(state.runtime).length) return state.flat as FlatInstance[];
  if (cache && cache.scene === state.scene && cache.flat === state.flat && cache.liveData === state.liveData && cache.runtime === state.runtime) return cache.result;
  const result = flattenScene(resolveRuntimeScene(state.scene, state.liveData, state.runtime), true);
  cache = { scene: state.scene, flat: state.flat, liveData: state.liveData, runtime: state.runtime, result };
  return result;
}
