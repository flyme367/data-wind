import type { SceneNode } from "../types";
import { filterKitRows, kitChoiceItems, kitMetadata, kitOptions, kitPrivateData, kitRecord, kitRows } from "./kitRuntime";
import type { LiveValues, RuntimeOverrides } from "./runtimeScene";

type LinkScalar = string | number | boolean;
type LinkValue = LinkScalar | LinkScalar[];
type LinkFields = Record<string, LinkValue>;
type LinkFilters = Record<string, LinkFields>;
export type KitLinkKind = "linkage" | "selection";
export type KitLinkDirection = "out" | "in";
const isLinkScalar = (value: unknown): value is LinkScalar => ["string", "number", "boolean"].includes(typeof value);

/** The reference stores separate outgoing and incoming lists in a nested settings object. */
export function kitAdvancedRule(options: Record<string, unknown>, kind: KitLinkKind, direction: KitLinkDirection) {
  const nested = kitRecord(kitRecord(options[`${kind}-advanced-settings`])[`${kind}-${direction}`]);
  const mode = nested[`${kind}-mode`] ?? options[`${kind}-mode`] ?? "blacklist";
  const list = nested[`${kind}-elements`] ?? options[`${kind}-elements`];
  return { mode: mode === "whitelist" ? "whitelist" : "blacklist", elements: Array.isArray(list) ? list : [] };
}

export function kitLinkReference(value: unknown): string {
  if (typeof value === "string") return value;
  const item = kitRecord(value);
  const path = Array.isArray(item.elementPath) ? item.elementPath.at(-1) : undefined;
  return String(path ?? item.uid ?? item.id ?? "");
}

function fields(node: SceneNode, liveData: LiveValues): { uid: string; alias: string }[] {
  const meta = kitMetadata(node);
  if (!meta) return [];
  const source = node.sharedDataSourceId ? liveData[node.sharedDataSourceId] : liveData[node.id];
  const columns = Array.isArray(source?.columns) ? source.columns.map(String) : [];
  const declared = kitPrivateData(meta.source)?.fields ?? [];
  const result = declared.map(field => ({ uid: field.uid, alias: field.alias || field.uid }));
  for (const uid of columns) if (!result.some(field => field.uid === uid)) result.push({ uid, alias: uid });
  const available = source ?? node.data;
  for (const uid of Object.keys(kitRows(available?.rows, available?.__kitImportedColumns ?? available?.columns)[0] ?? {}))
    if (!result.some(field => field.uid === uid)) result.push({ uid, alias: uid });
  return result;
}

function bindingUid(value: unknown): string | undefined {
  const binding = kitRecord(Array.isArray(value) ? value[0] : value);
  const uid = Array.isArray(binding.uid) ? binding.uid.at(-1) : undefined;
  return typeof uid === "string" ? uid : undefined;
}

function bindingUids(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).flatMap(item => {
    const uid = bindingUid(item);
    return uid ? [uid] : [];
  });
}

function permits(options: Record<string, unknown>, other: SceneNode, kind: KitLinkKind, direction: KitLinkDirection): boolean {
  if (options[`${kind}-advanced`] !== true) return true;
  const rule = kitAdvancedRule(options, kind, direction);
  const includes = rule.elements.some(item => {
    const value = kitLinkReference(item);
    return value === other.id || value === kitMetadata(other)?.source.uid;
  });
  return rule.mode === "whitelist" ? includes : !includes;
}

/** Build transient filters from an item click; project data and templates stay untouched. */
export function updateKitLinkage(scene: SceneNode[], liveData: LiveValues, runtime: RuntimeOverrides,
  clicked: SceneNode, payload: unknown, value?: string): RuntimeOverrides {
  const source = scene.find(node => node.id === clicked.id) ?? clicked;
  const meta = kitMetadata(source);
  if (!meta) return runtime;
  const options = kitOptions(meta.source);
  if (options["linkage-out"] !== true) return runtime;
  const sourceFields = fields(source, liveData), event = kitRecord(payload);
  const menu = meta.source.type.startsWith("widget.group.buttons");
  const dropdown = meta.source.type === "widget.basic.dropdown-v2";
  const tree = dropdown && event.__kitDropdownTree === true;
  if (tree && event.isParent === true && options["use-json-node-linkage"] !== true) return runtime;
  const choice = menu || dropdown;
  const mode = options[menu ? "button-option-setting" : "dropdown-option-setting"];
  const label = typeof payload === "string" ? payload : tree ? event.value : event.name ?? event.value ?? value;
  const multipleValues = Array.isArray(payload) ? payload : tree && Array.isArray(event.values) ? event.values : undefined;
  const multiple = Boolean(multipleValues);
  const labels = (multipleValues ?? [label]).filter(isLinkScalar);
  const cleared = multiple && !labels.length || payload === "" || (payload == null && value === "") || dropdown
    && options["show-default-option"] === true && label === String(options["dropdown-tip-text"] ?? "请选择");
  const row = kitRecord(event.row);
  let choiceRows = Object.keys(row).length ? [row] : [];
  if (choice && mode === "data" && labels.length && !choiceRows.length) {
    const shared = source.sharedDataSourceId ? liveData[source.sharedDataSourceId] : undefined;
    const own = liveData[source.id], available = { ...source.data, ...shared, ...own };
    const liveRows = Array.isArray(shared?.rows) || Array.isArray(own?.rows);
    const linked = linkedKitRows(source, available, liveRows, runtime[source.id]?.dataPatch?.__kitDataLinkage);
    const raw = liveRows || available.__kitImportedData === true ? available.rows : kitPrivateData(meta.source)?.rows;
    const columns = available.__kitImportedData === true && !liveRows
      ? available.__kitImportedColumns ?? available.columns : available.columns;
    const rows = filterKitRows(linked?.rows ?? kitRows(raw, columns), options);
    const field = bindingUid(options[menu ? "axis-value" : "dropdown-item-fields"]);
    choiceRows = rows.filter(item => field && item[field] !== undefined
      && labels.some(selected => String(item[field]) === String(selected)));
  }
  const fieldId = ["axis-fields", "axis-x", "axis-name", "axis-category", "relationship-field"]
    .map(key => typeof options[key] === "string" ? String(options[key]) : bindingUid(options[key]))
    .find(Boolean);
  let selected: { uid: string; alias: string; value: LinkValue }[] = [];
  if (choice && mode === "data") {
    const optionField = bindingUid(options[menu ? "axis-value" : "dropdown-item-fields"]);
    const linkageFields = bindingUids(options[menu ? "buttons-linkage-fields" : "dropdown-linkage-fields"]);
    if (tree && optionField && labels.length) {
      const field = sourceFields.find(item => item.uid === optionField);
      const perLevel = Array.isArray(options["json-node-linkage-fields"]) ? options["json-node-linkage-fields"] : [];
      const alias = perLevel[Number(event.depth)] || field?.alias;
      if (field && typeof alias === "string" && alias)
        selected = [{ ...field, alias, value: multiple ? labels : labels[0]! }];
    } else selected = linkageFields.flatMap(uid => {
      const field = sourceFields.find(item => item.uid === uid);
      const values = choiceRows.map(item => item[uid]).filter(isLinkScalar);
      if (!values.length && uid === optionField) values.push(...labels);
      return field && values.length ? [{ ...field, value: multiple ? values : values[0]! }] : [];
    });
  } else if (choice) {
    const field = options[menu ? "linkage-field" : "relationship-field"];
    const items = kitChoiceItems(meta.source.type, options, []);
    const values = kitRecord(options[menu ? "linkage-values" : "relationship-values"]);
    const mapped = labels.map(label => {
      const index = items.findIndex(item => item === String(label));
      return values[`${String(label)}-${index}`] ?? values[String(label)] ?? label;
    }).filter(isLinkScalar);
    if (typeof field === "string" && field && mapped.length)
      selected = [{ uid: field, alias: field, value: multiple ? mapped : mapped[0]! }];
  } else if (fieldId) {
    const field = sourceFields.find(item => item.uid === fieldId || item.alias === fieldId);
    const item = field ? row[field.uid] ?? event.name ?? value : undefined;
    if (field && ["string", "number", "boolean"].includes(typeof item))
      selected = [{ ...field, value: item as LinkValue }];
  } else {
    selected = sourceFields.flatMap(field => {
      const item = row[field.uid];
      return ["string", "number", "boolean"].includes(typeof item) ? [{ ...field, value: item as LinkValue }] : [];
    });
  }
  if (!selected.length && !cleared) return runtime;
  let result = runtime;
  for (const target of scene) {
    if (target.id === source.id || source.boardPageId && target.boardPageId && source.boardPageId !== target.boardPageId) continue;
    const targetMeta = kitMetadata(target);
    if (!targetMeta) continue;
    const targetOptions = kitOptions(targetMeta.source);
    const previous = kitRecord(runtime[target.id]?.dataPatch?.__kitDataLinkage) as LinkFilters;
    const filters = { ...previous };
    delete filters[source.id];
    if (!cleared && targetOptions["linkage-in"] === true && permits(options, target, "linkage", "out")
        && permits(targetOptions, source, "linkage", "in")) {
      const sameSource = Boolean(source.sharedDataSourceId && source.sharedDataSourceId === target.sharedDataSourceId);
      const targetFields = fields(target, liveData);
      const pairs = selected.flatMap(field => {
        const destination = targetFields.find(item => sameSource && item.uid === field.uid)
          ?? targetFields.find(item => item.alias === field.alias);
        return destination ? [[destination.uid, field.value] as const] : [];
      });
      const matched: LinkFields = Object.fromEntries(pairs);
      if (pairs.length) Object.defineProperty(filters, source.id, { value: matched, enumerable: true, configurable: true, writable: true });
    }
    if (JSON.stringify(filters) === JSON.stringify(previous)) continue;
    if (result === runtime) result = { ...runtime };
    const existing = runtime[target.id] ?? {};
    Object.defineProperty(result, target.id, { value: { ...existing, dataPatch: { ...existing.dataPatch,
      __kitDataLinkage: filters } }, enumerable: true, configurable: true, writable: true });
  }
  return result;
}

/** Carry a selected item to compatible controls without changing their source data. */
export function updateKitSelection(scene: SceneNode[], runtime: RuntimeOverrides, clicked: SceneNode,
  payload: unknown, value?: string): RuntimeOverrides {
  const source = scene.find(node => node.id === clicked.id) ?? clicked, meta = kitMetadata(source);
  if (!meta) return runtime;
  const options = kitOptions(meta.source);
  if (options["selection-out"] !== true) return runtime;
  const event = kitRecord(payload);
  const tree = meta.source.type === "widget.basic.dropdown-v2" && event.__kitDropdownTree === true;
  if (tree && event.isParent === true && options["use-json-node-selection"] !== true) return runtime;
  const multipleValues = Array.isArray(payload) ? payload : tree && Array.isArray(event.values) ? event.values : undefined;
  const values = multipleValues?.filter(isLinkScalar).map(String);
  const current = values ? values[0] ?? "" : typeof payload === "string" ? payload
    : tree ? event.value : event.name ?? event.value ?? value;
  const selected = meta.source.type === "widget.basic.dropdown-v2" && options["show-default-option"] === true
    && current === String(options["dropdown-tip-text"] ?? "请选择") ? "" : current;
  if (!["string", "number", "boolean"].includes(typeof selected)) return runtime;
  let result = runtime;
  for (const target of scene) {
    if (target.id === source.id || source.boardPageId && target.boardPageId && source.boardPageId !== target.boardPageId) continue;
    const targetMeta = kitMetadata(target);
    if (!targetMeta || !target.widget || !["menuHorizontal", "menuVertical", "dropdown", "tableBasic", "list"].includes(target.widget.kind)) continue;
    const targetOptions = kitOptions(targetMeta.source), existing = runtime[target.id] ?? {};
    const previous = kitRecord(existing.dataPatch?.__kitSelection);
    const allowed = targetOptions["selection-in"] === true && permits(options, target, "selection", "out")
      && permits(targetOptions, source, "selection", "in");
    if (!allowed && previous.sourceId !== source.id) continue;
    const perLevel = tree && Array.isArray(options["json-node-selection-fields"]) ? options["json-node-selection-fields"] : [];
    const levelName = perLevel[Number(event.depth)];
    const targetField = typeof levelName === "string" && levelName
      ? fields(target, {}).find(item => item.uid === levelName || item.alias === levelName)?.uid : undefined;
    const field = targetField ?? bindingUid(targetOptions["selection-fields"] ?? targetOptions["axis-fields"]);
    const next = { sourceId: source.id, value: allowed ? String(selected) : "",
      ...(values ? { values: allowed ? values : [] } : {}), ...(field ? { field } : {}) };
    if (JSON.stringify(next) === JSON.stringify(previous)) continue;
    if (result === runtime) result = { ...runtime };
    Object.defineProperty(result, target.id, { value: { ...existing, dataPatch: { ...existing.dataPatch,
      __kitSelection: next } }, enumerable: true, configurable: true, writable: true });
  }
  return result;
}

/** Apply all active source selections before data fields are mapped to visual properties. */
export function linkedKitRows(node: SceneNode, data: Record<string, unknown> | undefined,
  liveRows: boolean, filters: unknown): { rows: Record<string, unknown>[]; indices: number[] } | undefined {
  const meta = kitMetadata(node), active = Object.values(kitRecord(filters)).map(kitRecord)
    .filter(item => Object.keys(item).length > 0);
  if (!meta || kitOptions(meta.source)["linkage-in"] !== true || !active.length) return undefined;
  const raw = liveRows || data?.__kitImportedData === true ? data?.rows : kitPrivateData(meta.source)?.rows;
  const columns = data?.__kitImportedData === true && !liveRows ? data.__kitImportedColumns ?? data.columns : data?.columns;
  const rows: Record<string, unknown>[] = [], indices: number[] = [];
  kitRows(raw, columns).forEach((row, index) => {
    if (active.every(group => Object.entries(group).every(([key, expected]) =>
      row[key] !== undefined && row[key] !== null && (Array.isArray(expected)
        ? expected.some(value => String(row[key]) === String(value)) : String(row[key]) === String(expected))))) {
      rows.push(row); indices.push(index);
    }
  });
  return { rows, indices };
}
