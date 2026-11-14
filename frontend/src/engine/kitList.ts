import { filterKitRows, kitMetadata, kitNumber, kitOptions, kitPair, kitPrivateData, kitRecord, kitRows,
  resolveKitOptions, type KitMetadata } from "../data/kitRuntime";
import type { SceneNode } from "../types";
import type { KitConditionContext } from "../data/dataConditions";

interface ListRow { index: number; value: Record<string, unknown> }
interface ListLayout {
  root: SceneNode;
  rows: ListRow[];
  columns: number;
  rowCount: number;
  width: number;
  height: number;
  direction: string;
  total: number;
  start: number;
  capacity: number;
}

/** The offsets are transient preview state and never become part of the saved scene. */
export interface KitListTransition {
  from: number;
  to: number;
  direction: 1 | -1;
  progress: number;
}

interface ListSlot {
  row: ListRow;
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  clip: { x: number; y: number; width: number; height: number };
}

export const isKitList = (node: SceneNode) => ["widget.group.list-v2", "widget.group.list"]
  .includes(kitMetadata(node)?.source.type ?? "");
const cloneId = (id: string, index: number) => `${id}::kit-list-${index}`;

function fieldUid(value: unknown): string | undefined {
  const binding = kitRecord(Array.isArray(value) ? value[0] : value);
  const uid = Array.isArray(binding.uid) ? binding.uid.at(-1) : undefined;
  return typeof uid === "string" ? uid : undefined;
}

function listRows(root: SceneNode): ListRow[] {
  const meta = kitMetadata(root)!;
  const options = kitOptions(meta.source);
  const source = Array.isArray(root.data?.rows) ? kitRows(root.data.rows, root.data.columns)
    : kitRows(kitPrivateData(meta.source)?.rows);
  let sourceIndex = 0;
  const originalIndices = Array.isArray(root.data?.__kitLinkRowIndices) ? root.data.__kitLinkRowIndices : undefined;
  let rows = filterKitRows(source, options, root.data?.__kitFilterContext as KitConditionContext | undefined).map(value => {
    while (sourceIndex < source.length && source[sourceIndex] !== value) sourceIndex++;
    const index = sourceIndex++;
    return { value, index: typeof originalIndices?.[index] === "number" ? originalIndices[index] : index };
  });
  const sort = String(options["sort-type"] ?? "normal");
  const sortField = fieldUid(options["axis-sort-fields"]);
  if (sortField && sort === "reverse") rows.reverse();
  else if (sortField && (sort === "ASC" || sort === "DESC")) {
    rows.sort((a, b) => String(a.value[sortField] ?? "").localeCompare(String(b.value[sortField] ?? ""),
      "zh-CN", { numeric: true }) * (sort === "DESC" ? -1 : 1));
  }
  const groupField = fieldUid(options["axis-fields"]);
  if (!groupField) rows = [];
  else {
    const seen = new Set<unknown>();
    rows = rows.filter(({ value }) => {
      if (!Object.hasOwn(value, groupField) || seen.has(value[groupField])) return false;
      seen.add(value[groupField]);
      return true;
    });
  }
  return rows;
}

function listLayout(root: SceneNode, preview: boolean, requestedStart: number): ListLayout {
  const options = kitOptions(kitMetadata(root)!.source);
  let rows = listRows(root);
  const direction = String(options["carousel-type"] === "row" ? options["list-row-direction"]
    : options["list-page-direction"] ?? "vertical");
  const count = Math.max(1, Math.min(200, Math.trunc(kitNumber(options["list-display-count"], 2))));
  const [gridRows, gridColumns] = kitPair(options["list-display-count-grid"], [2, 2]);
  const rowCount = direction === "grid" ? Math.max(1, Math.min(200, Math.trunc(gridRows)))
    : direction === "horizontal" ? 1 : count;
  const columns = direction === "grid" ? Math.max(1, Math.min(200, Math.trunc(gridColumns)))
    : direction === "horizontal" ? count : 1;
  const total = rows.length, capacity = Math.min(200, rowCount * columns);
  const rowMode = options["carousel-type"] === "row";
  const infinite = rowMode && options["carousel-loop"] !== false && options["carousel-loop-type"] === "infinite";
  const last = total <= capacity ? 0 : infinite ? total - 1 : rowMode ? total - capacity
    : Math.floor((total - 1) / capacity) * capacity;
  const start = Math.max(0, Math.min(last, Math.trunc(requestedStart)));
  // Keep an editable template visible when the list has no data.
  if (!rows.length && !preview) rows = [{ index: 0, value: {} }];
  else if (infinite && rows.length > capacity) {
    rows = Array.from({ length: capacity }, (_, index) => rows[(start + index) % rows.length]!);
  } else rows = rows.slice(start, start + capacity);
  const width = direction === "horizontal" ? Math.floor((root.boxSize?.x ?? 0) / columns)
    : (root.boxSize?.x ?? 0) / columns;
  const actualRows = Math.max(1, Math.ceil(rows.length / columns));
  const height = direction === "vertical" ? Math.floor((root.boxSize?.y ?? 0) / rowCount)
    : (root.boxSize?.y ?? 0) / (direction === "grid" && options["row-evenly-distribute"] !== false
      ? Math.min(rowCount, actualRows) : rowCount);
  return { root, rows, columns, rowCount, width, height, direction, total, start, capacity };
}

export function kitListInfo(node: SceneNode) {
  if (!isKitList(node)) return undefined;
  const options = kitOptions(kitMetadata(node)!.source);
  const layout = listLayout(node, true, 0);
  return { total: layout.total, capacity: layout.capacity, rowMode: options["carousel-type"] === "row",
    auto: options["carousel-display"] !== false, loop: options["carousel-loop"] !== false,
    infinite: options["carousel-loop-type"] === "infinite",
    selectable: options["use-item-selected"] === true,
    autoSelect: options["carousel-auto-select"] !== false,
    wheel: options["carousel-type"] === "row" && options["list-row-direction"] === "vertical"
      && options["list-wheel-scroll"] === true,
    duration: Math.max(0.1, kitNumber(options["carousel-duration"], 3)) * 1000,
    firstDuration: Math.max(0.1, kitNumber(options["first-carousel-duration"],
      kitNumber(options["carousel-duration"], 3))) * 1000 };
}

export function advanceKitListSelection(node: SceneNode, current: number | undefined, start: number) {
  const info = kitListInfo(node);
  if (!info) return undefined;
  const rows = listRows(node);
  if (!rows.length) return undefined;
  let index = rows.findIndex(row => row.index === current) + 1;
  if (index >= rows.length) {
    if (!info.loop) return undefined;
    index = 0;
  }
  let nextStart = Math.max(0, Math.min(start, Math.max(0, rows.length - 1)));
  if (info.rowMode && info.infinite && info.loop && rows.length > info.capacity) {
    if ((index - nextStart + rows.length) % rows.length >= info.capacity)
      nextStart = (index - info.capacity + 1 + rows.length) % rows.length;
  } else if (index < nextStart || index >= nextStart + info.capacity) {
    nextStart = info.rowMode ? Math.max(0, index - info.capacity + 1)
      : Math.floor(index / info.capacity) * info.capacity;
  }
  return { row: rows[index]!, start: nextStart };
}

function listSlot(layout: ListLayout, slot: number) {
  const column = layout.direction === "horizontal" ? slot : layout.direction === "grid" ? slot % layout.columns : 0;
  const line = layout.direction === "vertical" ? slot : layout.direction === "grid" ? Math.floor(slot / layout.columns) : 0;
  return { x: column * layout.width, y: line * layout.height, width: layout.width, height: layout.height };
}

/** Layout both sides of a transition in one clipped strip, without duplicating shared rows. */
function listSlots(layout: ListLayout, preview: boolean, transition?: KitListTransition): ListSlot[] {
  const root = layout.root;
  const options = kitOptions(kitMetadata(root)!.source);
  const width = Math.max(0, root.boxSize?.x ?? 0), height = Math.max(0, root.boxSize?.y ?? 0);
  const result: ListSlot[] = [];
  const add = (source: ListLayout, row: ListRow, id: number, slot: number, dx = 0, dy = 0) => {
    const cell = listSlot(source, slot);
    const x = cell.x + dx, y = cell.y + dy;
    const left = Math.max(0, x), top = Math.max(0, y);
    const right = Math.min(width, x + cell.width), bottom = Math.min(height, y + cell.height);
    if (preview && (right <= left || bottom <= top)) return;
    if (result.some(item => item.row.index === row.index && Math.abs(item.x - x) < 0.01
        && Math.abs(item.y - y) < 0.01)) return;
    result.push({ row, id, x, y, width: cell.width, height: cell.height,
      clip: { x: root.transform.position.x + left, y: root.transform.position.y + top,
        width: right - left, height: bottom - top } });
  };
  if (!preview || !transition || transition.from === transition.to) {
    layout.rows.forEach((row, slot) => add(layout, row, slot, slot));
    return result;
  }
  const from = listLayout(root, true, transition.from), to = listLayout(root, true, transition.to);
  const rowMode = options["carousel-type"] === "row";
  const wraps = rowMode && options["carousel-loop"] !== false && options["carousel-loop-type"] === "infinite";
  const expected = wraps ? (from.start + transition.direction + from.total) % from.total
    : from.start + transition.direction;
  const single = rowMode && to.start === expected;
  const axis = rowMode ? from.direction : String(options["list-scroll-direction"] ?? "vertical");
  const horizontal = axis === "horizontal";
  const distance = single ? (horizontal ? from.width : from.height) : (horizontal ? width : height);
  const progress = Math.max(0, Math.min(1, transition.progress));
  const outgoing = -transition.direction * distance * progress;
  const incoming = transition.direction * distance * (1 - progress);
  from.rows.forEach((row, slot) => add(from, row, slot, slot,
    horizontal ? outgoing : 0, horizontal ? 0 : outgoing));
  to.rows.forEach((row, slot) => add(to, row, from.capacity + slot, slot,
    horizontal ? incoming : 0, horizontal ? 0 : incoming));
  return result;
}

export function advanceKitList(node: SceneNode, current: number, direction: 1 | -1): number {
  const info = kitListInfo(node);
  if (!info || info.total <= info.capacity) return 0;
  const step = info.rowMode ? 1 : info.capacity;
  const last = info.rowMode ? (info.loop && info.infinite ? info.total - 1 : info.total - info.capacity)
    : Math.floor((info.total - 1) / step) * step;
  const next = current + direction * step;
  if (next > last) return info.loop ? 0 : last;
  if (next < 0) return info.loop ? last : 0;
  return next;
}

export function kitListItem(node: SceneNode, value: unknown, index: unknown) {
  const row = kitRecord(value), options = kitOptions(kitMetadata(node)!.source);
  const field = fieldUid(options["axis-fields"]);
  const name = String((field ? row[field] : undefined) ?? Object.values(row)[0] ?? "");
  return { index: kitNumber(index), name, value: name, row };
}

/** Find the original row index so linked selections keep the correct item after sorting or filtering. */
export function kitListSelectionIndex(node: SceneNode, value: string, field?: string): number | undefined {
  return kitListSelectionMatch(node, value, field, 0)?.index;
}

export function kitListSelectionMatch(node: SceneNode, value: string, field: string | undefined, start: number):
  { index: number; start: number } | undefined {
  if (!isKitList(node) || !value) return undefined;
  const options = kitOptions(kitMetadata(node)!.source);
  const key = field || fieldUid(options["axis-fields"]);
  if (!key) return undefined;
  const rows = listRows(node), position = rows.findIndex(row => String(row.value[key] ?? "") === value);
  const info = kitListInfo(node);
  if (position < 0 || !info) return undefined;
  let next = Math.max(0, Math.min(start, rows.length - 1));
  if (info.rowMode && info.infinite && info.loop && rows.length > info.capacity) {
    if ((position - next + rows.length) % rows.length >= info.capacity)
      next = (position - info.capacity + 1 + rows.length) % rows.length;
  } else if (position < next || position >= next + info.capacity) {
    next = info.rowMode ? Math.max(0, position - info.capacity + 1)
      : Math.floor(position / info.capacity) * info.capacity;
  }
  return { index: rows[position]!.index, start: next };
}

/** Filter a child's data only when it shares the list's grouping field. */
function listChild(node: SceneNode, layout: ListLayout, item: ListSlot, preview: boolean): SceneNode {
  const { row, id: slot } = item;
  const meta = kitMetadata(node);
  let resolved = node;
  if (meta) {
    const privateData = kitPrivateData(meta.source);
    const values = filterKitRows(kitRows(node.data?.__kitActiveRows ?? privateData?.rows), kitOptions(meta.source),
      node.data?.__kitFilterContext as KitConditionContext | undefined);
    const rootMeta = kitMetadata(layout.root)!;
    const groupUid = fieldUid(kitOptions(rootMeta.source)["axis-fields"]);
    const groupFields = kitPrivateData(rootMeta.source)?.fields ?? [];
    const groupAlias = groupFields.find(field => field.uid === groupUid)?.alias || groupUid;
    const childFields = [...privateData?.fields ?? []];
    for (const uid of Object.keys(values[0] ?? {}))
      if (!childFields.some(field => field.uid === uid)) childFields.push({ uid, alias: uid });
    const sameSource = node.sharedDataSourceId && node.sharedDataSourceId === layout.root.sharedDataSourceId;
    const match = childFields.find(field => sameSource && field.uid === groupUid)
      ?? childFields.find(field => (field.alias || field.uid) === groupAlias);
    const grouped = match && groupUid ? values.filter(value => value[match.uid] != null
      && row.value[groupUid] != null && String(value[match.uid]) === String(row.value[groupUid])) : values;
    const ownRow = grouped[0];
    const source = { ...meta.source, options: { ...meta.source.options, filter: false },
      privateData: { ...privateData, rows: grouped } };
    const related = kitRecord(kitOptions(source)["related-fields"]);
    const patch: Record<string, unknown> = {};
    for (const [path, value] of Object.entries(related)) {
      let key: unknown;
      try { const parsed: unknown = JSON.parse(path); key = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : undefined; }
      catch { continue; }
      if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key)) continue;
      const uid = fieldUid(kitRecord(value)["related-field"]);
      if (!uid) continue;
      const result = ownRow?.[uid] ?? row.value[uid];
      if (result !== undefined && result !== null) patch[key] = result;
    }
    const { __kitImportedData: _imported, __kitImportedColumns: _columns, ...priorData } = node.data ?? {};
    const data = { ...priorData, __kit: { ...meta, source } satisfies KitMetadata };
    resolved = resolveKitOptions({ ...node, data }, patch);
  }
  const position = resolved.transform.position;
  return { ...resolved,
    id: slot ? cloneId(node.id, slot) : node.id,
    parentId: slot && node.parentId !== layout.root.id && node.parentId ? cloneId(node.parentId, slot) : node.parentId,
    transform: { ...resolved.transform, position: { ...position,
      x: position.x + item.x, y: position.y + item.y } },
    data: { ...resolved.data, __kitListClone: slot > 0, __kitListOriginalId: node.id,
      __kitListRootId: layout.root.id, __kitListIndex: row.index, __kitListRow: row.value,
      ...(preview ? { __kitListClip: item.clip } : {}) },
  };
}

/** Expand only the rendered scene; the editable and saved scene keeps one set of children. */
export function expandKitLists(scene: SceneNode[], preview: boolean,
  offsets: ReadonlyMap<string, number> = new Map(), selections: ReadonlyMap<string, number> = new Map(),
  transitions: ReadonlyMap<string, KitListTransition> = new Map()): SceneNode[] {
  const byId = new Map(scene.map(node => [node.id, node]));
  const descendants = new Map<string, SceneNode[]>();
  const owner = new Map<string, string>();
  for (const node of scene) {
    let parent = node.parentId ? byId.get(node.parentId) : undefined;
    const seen = new Set<string>();
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      if (isKitList(parent)) {
        owner.set(node.id, parent.id);
        const children = descendants.get(parent.id) ?? [];
        children.push(node); descendants.set(parent.id, children);
        break;
      }
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
  }
  if (!owner.size) return scene;
  const layouts = new Map<string, ListLayout>(), slots = new Map<string, ListSlot[]>();
  for (const [id] of descendants) {
    const layout = listLayout(byId.get(id)!, preview, preview ? offsets.get(id) ?? 0 : 0);
    layouts.set(id, layout);
    slots.set(id, listSlots(layout, preview, transitions.get(id)));
  }
  return scene.flatMap(node => {
    const id = owner.get(node.id), layout = id ? layouts.get(id) : undefined;
    if (layout) return slots.get(id!)!.map(item => listChild(node, layout, item, preview));
    const ownLayout = layouts.get(node.id);
    return ownLayout ? [{ ...node, data: { ...node.data, __kitListInfo: { total: ownLayout.total,
      capacity: ownLayout.capacity, start: ownLayout.start, direction: ownLayout.direction,
      selected: selections.get(node.id), slots: slots.get(node.id)!.map(item => ({ x: item.x, y: item.y,
        width: item.width, height: item.height, clip: item.clip, index: item.row.index, row: item.row.value })) } } }] : [node];
  });
}
