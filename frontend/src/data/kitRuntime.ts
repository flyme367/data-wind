import type { SceneNode } from "../types";
import { widgetNode, type WidgetConfig, type WidgetKind } from "./editor";
import { kitComponentData, kitOptionDefaults } from "./kitOptionSchema";
import { importKitInteractions } from "./kitInteractions";
import { filterConditionRows, type KitConditionContext } from "./dataConditions";
import type { KitCatalogEntry } from "./kitCatalog";
import modelPreviews from "./kitModelPreviews.json";
import texturePreviews from "./kitTexturePreviews.json";

export const KIT_CITY_TYPE = "widget.3d.city-builder";
export const KIT_CITY_GEOMETRY_OPTION = "data-wind-city-geometry";
const modelPreviewAssets: Record<string, string> = modelPreviews;
export const kitModelPreviewAsset = (url: string): string | undefined => modelPreviewAssets[url.split("/").at(-1) ?? ""];
const texturePreviewAssets: Record<string, string> = texturePreviews;
export const kitTexturePreviewAsset = (url: string): string | undefined => texturePreviewAssets[url.split("/").at(-1) ?? ""];

export interface ReferenceKitWidget {
  uid?: string;
  name?: string;
  type: string;
  options?: Record<string, unknown>;
  statesOptions?: Record<string, Record<string, unknown>>;
  states?: { uid: string; name: string }[];
  widgets?: ReferenceKitWidget[];
  pieces?: ReferenceKitPiece[];
  privateData?: { fields?: { uid: string; alias?: string; type?: string }[]; rows?: Record<string, unknown>[] };
  [key: string]: unknown;
}
export interface ReferenceKitPiece {
  uid?: string;
  name?: string;
  type: string;
  options?: Record<string, unknown>;
  statesOptions?: Record<string, Record<string, unknown>>;
  states?: { uid: string; name: string }[];
  pieces?: ReferenceKitPiece[];
  [key: string]: unknown;
}

export function kitPieceAt(source: ReferenceKitWidget, path: number[]): ReferenceKitPiece | undefined {
  if (!path.length || path.length > 32) return undefined;
  let pieces = source.pieces;
  let piece: ReferenceKitPiece | undefined;
  for (const index of path) {
    if (!Number.isInteger(index) || index < 0) return undefined;
    piece = pieces?.[index];
    if (!piece) return undefined;
    pieces = piece.pieces;
  }
  return piece;
}
export interface KitMetadata {
  templateId: string;
  familyId: string;
  familyLabel: string;
  label: string;
  source: ReferenceKitWidget;
  thumbnail?: string;
}

export function kitMetadata(node: SceneNode): KitMetadata | undefined {
  const value = node.data?.__kit;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const data = value as KitMetadata;
  return data.source && typeof data.source.type === "string" ? data : undefined;
}
export const kitFileUrl = (value: unknown): string => {
  const path = typeof value === "string" ? value : value && typeof value === "object"
    ? String((value as Record<string, unknown>).relativePath ?? (value as Record<string, unknown>).url ?? "") : "";
  return path.startsWith("/kits/") ? `.${path}` : path;
};
export const kitOptions = (source: ReferenceKitWidget, stateId?: string) => ({
  ...kitOptionDefaults(source.type), ...source.options,
  ...(stateId ? source.statesOptions?.[stateId] : undefined),
});
export const kitPrivateData = (source: ReferenceKitWidget) => source.privateData ?? kitComponentData(source.type);
export const kitNumber = (value: unknown, fallback = 0): number =>
  value !== null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : fallback;
export function kitColor(value: unknown, fallback = "transparent"): string {
  if (typeof value === "string") {
    if (/^#[\da-f]{3,4}$/i.test(value)) return `#${value.slice(1).split("").map(ch => ch + ch).join("")}`;
    const rgb = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
    if (rgb) return `#${rgb.slice(1, 4).map(channel => Math.max(0, Math.min(255, Math.round(Number(channel)))).toString(16).padStart(2, "0")).join("")}${rgb[4] === undefined ? "" : Math.round(Math.max(0, Math.min(1, Number(rgb[4]))) * 255).toString(16).padStart(2, "0")}`;
    return ({ white: "#ffffff", black: "#000000", red: "#ff0000" } as Record<string, string>)[value] ?? value;
  }
  if (Array.isArray(value)) return kitColor(value[0], fallback);
  if (value && typeof value === "object") {
    const colors = (value as { colors?: { color?: unknown }[] }).colors;
    if (!Array.isArray(colors)) return fallback;
    let bestAlpha = -1, representative = fallback;
    for (const stop of colors) {
      const color = kitColor(typeof stop?.color === "string" ? stop.color : undefined, fallback);
      const alpha = color === "transparent" ? 0 : /^#[\da-f]{8}$/i.test(color) ? parseInt(color.slice(7), 16) : 255;
      if (alpha >= bestAlpha) { bestAlpha = alpha; representative = color; }
    }
    return representative;
  }
  return fallback;
}
export const kitRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const record = kitRecord;

export const KIT_CONDITION_STYLES = "__kitConditionStyles";
export function kitConditionalStyles(options: Record<string, unknown>, rows: Record<string, unknown>[],
  context?: KitConditionContext): Record<string, unknown> {
  const style = record(options[KIT_CONDITION_STYLES]);
  if (!context || !Object.keys(style).length) return {};
  const conditions = new Map(context.conditions.map(condition => [condition.id, condition]));
  const matches = new Map<string, boolean>();
  // A component without rows may still refer to project parameters or a shared data source.
  const hasLocalRows = rows.length > 0;
  const result: Record<string, unknown> = {};
  for (const [key, stored] of Object.entries(style)) {
    if (key.startsWith("__") || ["map-key", "size", "position", "rotate", "__proto__", "constructor", "prototype"].includes(key)) continue;
    const definition = record(stored);
    const rules = Array.isArray(definition.rules) ? definition.rules.map(record) : [];
    const applicable = rules.filter(rule => typeof rule.condition === "string" && conditions.has(rule.condition));
    if (!applicable.length) continue;
    const satisfied = applicable.find(rule => {
      const id = rule.condition as string;
      if (!matches.has(id)) {
        const condition = conditions.get(id)!;
        const ordinary = hasLocalRows ? condition : {
          ...condition, groups: condition.groups.filter(group => group.every(test => test.sourceId !== "$current"
            && test.sourceId !== context.currentSourceId)),
        };
        matches.set(id, filterConditionRows(hasLocalRows ? rows : [{}], ordinary, context).length > 0);
      }
      return matches.get(id);
    });
    if (satisfied && Object.hasOwn(satisfied, "value")) result[key] = satisfied.value;
    else if (Object.hasOwn(definition, "otherwise")) result[key] = definition.otherwise;
  }
  return result;
}

export function kitRows(value: unknown, columns?: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  const names = Array.isArray(columns) ? columns.map(String) : [];
  return value.flatMap(row => {
    if (Array.isArray(row) && names.length) return [Object.fromEntries(names.map((name, index) => [name, row[index]]))];
    return row && typeof row === "object" && !Array.isArray(row) ? [row as Record<string, unknown>] : [];
  });
}

export function mergeKitStaticData(node: SceneNode, incoming: Record<string, unknown>): Record<string, unknown> {
  const previous = node.data ?? {};
  const values = Object.fromEntries(Object.entries(incoming).filter(([key]) => !key.startsWith("__kit") && key !== "chart" && key !== "chartStates"));
  const columns = Array.isArray(incoming.columns) ? incoming.columns : undefined;
  return { ...previous, ...values, __kitImportedData: true, __kitImportedColumns: columns };
}
export function kitGradient(value: unknown) {
  const gradient = record(Array.isArray(value) ? value[0] : value);
  if (!Array.isArray(gradient.colors) || gradient.colors.length < 2) return undefined;
  const stops = gradient.colors.flatMap(stop => {
    const { position, color } = record(stop);
    return typeof color === "string" ? [{ position: kitNumber(position), color: kitColor(color) }] : [];
  });
  return stops.length > 1 ? { angle: kitNumber(gradient.angle), stops } : undefined;
}
export const kitPair = (value: unknown, fallback: [number, number]): [number, number] =>
  Array.isArray(value) ? [kitNumber(value[0], fallback[0]), kitNumber(value[1], fallback[1])] : fallback;
const pair = kitPair;

export const isKitTabPanel = (type: string) => type === "widget.group.panel-tab" || type === "widget.group.tab";
export function kitTabLabels(options: Record<string, unknown>, childNames: string[]): string[] {
  const labels = options["panel-button-name"];
  return Array.isArray(labels) ? labels.map(label => String(label).trim()).filter(Boolean) : childNames;
}
export function kitTabIndex(options: Record<string, unknown>, count: number): number {
  return Math.min(Math.max(0, count - 1), Math.max(0, Math.trunc(kitNumber(options["active-index"]))));
}

const kinds: Record<string, WidgetKind> = {
  "widget.basic.text": "text", "widget.basic.paragraph": "textMultiline",
  "widget.basic.card-v2": "metric", "widget.basic.card": "metric",
  "widget.basic.image": "image", "widget.basic.video": "video", "widget.basic.audio": "audio",
  "widget.basic.monitor": "monitor", "widget.basic.carousel": "carousel", "widget.basic.videos": "carouselVideo",
  "widget.basic.pdf": "pdf", "widget.basic.iframe": "iframe", "widget.basic.weather-v2": "weather",
  "widget.basic.button-v2": "button", "widget.basic.button": "button",
  "widget.basic.dropdown-v2": "dropdown", "widget.basic.search": "search",
  "widget.basic.timer-v2": "clock", "widget.basic.timer": "clock", "widget.basic.calendar": "calendar",
  "widget.basic.timing": "timer", "widget.basic.time-scale": "timeline", "widget.basic.graphical": "shape",
  "widget.basic.card-flipper": "flipCounter", "widget.basic.trend": "dataChange",
  "widget.basic.table-v3": "tableBasic", "widget.report.sheet": "report",
  "widget.basic.progress-bar": "progress", "widget.basic.time-picker": "timePicker",
  "widget.basic.calendar-selector": "timePicker", "widget.basic.table-v2": "tableBasic",
  "widget.group.buttons-v2": "menuHorizontal", "widget.group.buttons": "menuHorizontal",
  "widget.group.panel": "shape", "widget.group.popup": "shape", "widget.group.panel-tab": "shape",
  "widget.group.list-v2": "list", "widget.group.list": "list",
  "widget.group.tab": "shape",
  "widget.echarts.column": "barGrouped", "widget.echarts.column-stack": "barStacked",
  "widget.echarts.column-percent": "barPercent", "widget.echarts.histogram": "barGradient",
  "widget.echarts.bar": "barHorizontal", "widget.echarts.bar-stack": "barHorizontalStacked",
  "widget.echarts.bar-percent": "barHorizontalStacked", "widget.echarts.line": "line",
  "widget.echarts.area": "area", "widget.echarts.area-stack": "areaStacked",
  "widget.echarts.biaxial": "dualAxis", "widget.echarts.biaxial-stack": "dualAxis",
  "widget.echarts.biaxial-reverse": "dualAxis", "widget.echarts.pie": "pieBasic",
  "widget.echarts.donut": "pie", "widget.echarts.rose": "pieRose", "widget.echarts.rose-donut": "pieRose",
  "widget.echarts.radar": "radar", "widget.echarts.scatter": "scatter", "widget.echarts.bubble": "bubble",
  "widget.echarts.gauge": "gauge", "widget.echarts.liquid": "waterball", "widget.echarts.progress-v2": "progress",
  "widget.echarts.funnel": "funnel", "widget.echarts.heatmap": "heatmap", "widget.echarts.wordle": "wordCloud",
  "widget.echarts.column3": "bar3dGrouped", "widget.echarts.column-stack3": "bar3dStacked",
  "widget.echarts.pie3": "pie3d", "widget.echarts.donut3": "donut3d",
  "widget.echarts.rose3": "rose3d", "widget.echarts.rose3-donut": "roseRing3d",
  "widget.echarts.interval-histogram": "bar", "widget.echarts.progress": "progress",
  "widget.echarts.interval-graph": "barHorizontal",
  "widget.echarts.radial": "pie", "widget.echarts.gantt": "barHorizontal",
  "widget.echarts.area-interval": "area", "widget.echarts.river": "areaStacked",
  "widget.echarts.funnel-contrast": "funnel", "widget.echarts.funnel-symmetric": "funnel",
  "widget.echarts.waffle": "heatmap", "widget.echarts.treemap": "heatmap",
  "widget.echarts.color-lump": "heatmap", "widget.echarts.pizza": "radar",
  "widget.echarts.punch": "bubble", "widget.echarts.roadmap": "line",
  "widget.echarts.sankey-v2": "bar", "widget.echarts.box-diagram": "bar",
  "widget.echarts.bullet": "barHorizontal", "widget.echarts.waterfall": "bar",
  "widget.echarts.map-china": "mapOutline", "widget.echarts.map-china-v3": "mapOutline",
  "widget.3d.city-builder": "image",
};
export function kitWidgetKind(type: string, options: Record<string, unknown> = {}): WidgetKind {
  if (type.startsWith("widget.basic.main-video")) return "shape";
  if (type.startsWith("widget.group.buttons")) {
    const [rows, columns] = pair(options.layout, [1, 1]);
    return rows > columns ? "menuVertical" : "menuHorizontal";
  }
  return kinds[type] ?? (type.includes("map") ? "mapRegion" : type.includes("topology") ? "topology" : "shape");
}

/** Current font fields replace the legacy fields when both are present. */
export function kitTextFont(type: string, options: Record<string, unknown>): Record<string, unknown> {
  if (type === "widget.basic.text") return record(options["text-font2"] ?? options["text-font"] ?? options.font);
  if (type === "widget.basic.paragraph") return record(options.font2 ?? options.font);
  return record(options["text-font"] ?? options.font ?? options["value-font"]);
}

/** Derive renderable style from the saved source options; the complete source remains editable. */
function kitAppearance(node: SceneNode, options?: Record<string, unknown>): {
  widget: WidgetConfig; color: string;
} {
  const meta = kitMetadata(node);
  const o = options ?? (meta ? kitOptions(meta.source) : {});
  const type = meta?.source.type ?? "";
  const button = type.includes("button") && !type.includes("buttons");
  const buttonState = button && o.checked === true && o["show-select"] === true ? "select" : "default";
  const font = button ? record(o[`text-${buttonState}-font`]) : kitTextFont(type, o);
  const offset = pair(o["font-shadow-offset"] ?? o["font-default-shadow-offset"], [0, 0]);
  const base = node.widget ?? widgetNode(kitWidgetKind(type, o)).widget!;
  const fontSize = Math.max(0, kitNumber(font.size ?? o["font-size"], 20));
  const widget: WidgetConfig = {
    ...base,
    text: String(o.text ?? o.title ?? ""),
    value: String(o.value ?? o.number ?? o.placeholder ?? base.value ?? ""),
    unit: String(o["unit-text"] ?? o.unit ?? o.suffix ?? ""),
    fontSize,
    fontFamily: String(font.family ?? ""), fontWeight: kitNumber(font.weight, font.bold ? 700 : 400),
    italic: font.italic === true, underline: font.underline === true,
    lineHeight: type === "widget.basic.paragraph" && fontSize > 0
      ? kitNumber(o["font-line-height"], fontSize) / fontSize : base.lineHeight,
    letterSpacing: kitNumber(o[button ? `font-${buttonState}-spacing` : "font-spacing"]),
    align: ["left", "center", "right"].includes(String(o[button ? `text-${buttonState}-position` : "text-align"] ?? o["text-position"]))
      ? (o[button ? `text-${buttonState}-position` : "text-align"] ?? o["text-position"]) as WidgetConfig["align"] : "center",
    opacity: Math.max(0, Math.min(1, kitNumber(o.opacity, 100) / 100)),
    background: o.background === false ? "transparent" : kitColor(o[button ? `background-${buttonState}-color` : "background-color"]),
    borderColor: o.border === false ? "transparent" : kitColor(o[button ? `border-${buttonState}-color` : "border-color"]),
    borderStyle: o.border === false ? "none" : String(o[button ? `border-${buttonState}-style` : "border-style"] ?? "solid") as WidgetConfig["borderStyle"],
    borderWidth: o.border === false ? 0 : kitNumber(o[button ? `border-${buttonState}-width` : "border-width"]),
    radius: kitNumber(o[button ? `border-${buttonState}-radius` : "border-radius"]),
    image: kitFileUrl(o.image ?? o.video ?? o["image-file"]),
    shadowColor: ["text", "textMultiline", "clock", "metric"].includes(base.kind) ? "transparent" : kitColor(o["shadow-color"]),
    shadowBlur: Math.max(0, kitNumber(o["font-shadow-blur"] ?? o["shadow-blur"])),
    shadowOffsetX: kitNumber(o["font-shadow-offset-x"], offset[0]),
    shadowOffsetY: kitNumber(o["font-shadow-offset-y"], offset[1]),
  };
  return { widget, color: kitColor(font.color ?? o.color ?? o["fill-color"], "#c2dcf0") };
}

const chartVariants: Record<string, string> = {
  "interval-histogram": "rangeBar", "interval-graph": "horizontalRange",
  "area-interval": "rangeArea", "bar-percent": "horizontalPercent",
  "biaxial-stack": "dualStacked", "biaxial-reverse": "dualReverse", biaxial: "dualGrouped",
  "rose-donut": "roseRing", radial: "jade", gantt: "gantt", river: "stream",
  "funnel-contrast": "compareFunnel", "funnel-symmetric": "symmetricFunnel", waffle: "waffle",
  treemap: "treemap", "color-lump": "colorBlocks", pizza: "pizza", roadmap: "path",
  "sankey-v2": "sankey", "box-diagram": "boxplot", bullet: "bullet", waterfall: "waterfall",
};
const specialKitChartData = new Set(["sankey", "boxplot", "gantt", "stream"]);

function fieldBindings(value: unknown): { uid: string; summary: string }[] {
  return (Array.isArray(value) ? value : [value]).flatMap(item => {
    const { uid: path, summary } = record(item);
    const uid = Array.isArray(path) ? path.at(-1) : undefined;
    return typeof uid === "string" ? [{ uid, summary: typeof summary === "string" ? summary : "none" }] : [];
  });
}

export interface KitChoiceTreeNode { label: string; value: string; children: KitChoiceTreeNode[] }

/** A JSON dropdown binds a field containing an array of { label, value, children } nodes. */
export function kitChoiceTree(options: Record<string, unknown>, rows: Record<string, unknown>[]): KitChoiceTreeNode[] {
  if (options["dropdown-option-setting"] !== "data" || options["use-json-type"] !== true) return [];
  const field = fieldBindings(options["dropdown-item-fields"])[0]?.uid;
  if (!field) return [];
  const parse = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value) as unknown; } catch { return undefined; }
  };
  let remaining = 5000;
  const nodes = (value: unknown, depth: number): KitChoiceTreeNode[] => {
    if (depth > 20 || remaining <= 0 || !Array.isArray(value)) return [];
    return value.flatMap(raw => {
      if (remaining <= 0) return [];
      const item = record(raw), source = item.value ?? item.label;
      if (typeof source !== "string" && typeof source !== "number" && typeof source !== "boolean") return [];
      remaining--;
      const label = item.label ?? source;
      return [{ label: String(label), value: String(source), children: nodes(parse(item.children), depth + 1) }];
    });
  };
  return rows.flatMap(row => nodes(parse(row[field]), 0));
}

export function kitChoiceTreeItems(nodes: KitChoiceTreeNode[]): KitChoiceTreeNode[] {
  return nodes.flatMap(node => [node, ...kitChoiceTreeItems(node.children)]);
}

/** Resolve menu and dropdown options from the same data fields used by the reference. */
export function kitChoiceItems(type: string, options: Record<string, unknown>, rows: Record<string, unknown>[]): string[] {
  const menu = type.startsWith("widget.group.buttons"), dropdown = type === "widget.basic.dropdown-v2";
  if (!menu && !dropdown) return [];
  const mode = options[menu ? "button-option-setting" : "dropdown-option-setting"];
  if (dropdown && mode === "data" && options["use-json-type"] === true)
    return kitChoiceTreeItems(kitChoiceTree(options, rows)).map(node => node.value);
  if (mode === "data") {
    const field = fieldBindings(options[menu ? "axis-value" : "dropdown-item-fields"])[0]?.uid;
    if (!field) return [];
    return rows.flatMap(row => row[field] === undefined || row[field] === null ? [] : [String(row[field])]);
  }
  const values = options[menu ? "button-name-option" : "dropdown-value-text-option"];
  return Array.isArray(values) ? values.map(item => typeof item === "object" && item !== null
    ? String(record(item).label ?? record(item).value ?? "") : String(item)) : [];
}

function choiceIndex(options: Record<string, unknown>, prefix: string, count: number): number {
  if (!count) return -1;
  const mode = options[`${prefix}-custom-type`];
  if (mode === "last") return count - 1;
  if (mode === "custom") return Math.min(count - 1, Math.max(0,
    Math.trunc(kitNumber(options[`${prefix}-custom-type-value`], 1)) - 1));
  return 0;
}

/** Apply the reference component's local row filter before reading data fields. */
export function filterKitRows<T extends Record<string, unknown>>(rows: T[], options: Record<string, unknown>,
  context?: KitConditionContext): T[] {
  if (options.filter !== true) return rows;
  const mode = String(options["filter-condition"] ?? "no-condition");
  if (mode === "data-condition") {
    const condition = context?.conditions.find(item => item.id === options["filter-condition-select"]);
    return condition && context ? filterConditionRows(rows, condition, context) : rows;
  }
  if (mode === "data-row") {
    const index = Math.max(0, Math.trunc(kitNumber(options["filter-data-row-num"], 1)) - 1);
    return rows.slice(index, index + 1);
  }
  if (mode === "data-rows") {
    const start = Math.max(0, Math.trunc(kitNumber(options["filter-data-start-rows-num"], 1)) - 1);
    const count = Math.max(1, Math.trunc(kitNumber(options["filter-data-rows"], 1)));
    return rows.slice(start, start + count);
  }
  if (mode !== "direct-judgment") return rows;
  const field = options["filter-table-field"], operator = options["filter-table-field-condition"];
  if (typeof field !== "string" || typeof operator !== "string" || !field) return rows;
  const expected = options["filter-table-field-value"];
  if (operator !== "∅" && operator !== "!∅" && (expected === undefined || expected === null || expected === "")) return rows;
  return rows.filter(row => {
    const value = row[field];
    const empty = value === null || value === undefined || value === "";
    if (operator === "∅") return empty;
    if (operator === "!∅") return !empty;
    const actualText = String(value ?? ""), expectedText = String(expected);
    if (operator === "=") return actualText === expectedText;
    if (operator === "!=") return actualText !== expectedText;
    if (operator === "⊃") return actualText.includes(expectedText);
    if (operator === "!⊃") return !actualText.includes(expectedText);
    const actualNumber = Number(value), expectedNumber = Number(expected);
    const comparison = !empty && Number.isFinite(actualNumber) && Number.isFinite(expectedNumber)
      ? actualNumber - expectedNumber : actualText.localeCompare(expectedText, "zh-CN", { numeric: true });
    if (operator === ">") return comparison > 0;
    if (operator === ">=") return comparison >= 0;
    if (operator === "<") return comparison < 0;
    if (operator === "<=") return comparison <= 0;
    return true;
  });
}

/** Resolve field-to-option links without mutating the saved source options. */
function relatedKitOptions(options: Record<string, unknown>, rows: Record<string, unknown>[]): Record<string, unknown> {
  const related = record(options["related-fields"]), patch: Record<string, unknown> = {};
  for (const [serializedPath, raw] of Object.entries(related)) {
    let parsed: unknown;
    try { parsed = JSON.parse(serializedPath); } catch { continue; }
    if (!Array.isArray(parsed) || !parsed.length || parsed.length > 16
        || parsed.some(key => typeof key !== "string" || !key || key.length > 256
          || ["__proto__", "prototype", "constructor"].includes(key))) continue;
    const uid = fieldBindings(record(raw)["related-field"])[0]?.uid;
    if (!uid) continue;
    const value = rows[0]?.[uid];
    if (value === undefined) continue;
    const [root, ...path] = parsed as string[];
    if (!root || root === "map-key") continue;
    if (!path.length) { patch[root] = value; continue; }
    let previous = record(patch[root] ?? options[root]);
    const next = { ...previous }; patch[root] = next;
    let target = next;
    for (const key of path.slice(0, -1)) {
      previous = record(previous[key]);
      const child = { ...previous }; target[key] = child; target = child;
    }
    target[path[path.length - 1]!] = value;
  }
  return patch;
}

function aggregate(rows: Record<string, unknown>[], uid: string, summary: string): unknown {
  const values = rows.map(row => row[uid]).filter(value => value !== null && value !== undefined && value !== "");
  if (summary === "count") return values.length;
  if (!values.length || !["sum", "avg", "mean", "min", "max"].includes(summary)) return values[0];
  const numbers = values.map(value => kitNumber(value, Number.NaN)).filter(Number.isFinite);
  if (!numbers.length) return undefined;
  if (summary === "min") return numbers.reduce((lowest, number) => Math.min(lowest, number));
  if (summary === "max") return numbers.reduce((highest, number) => Math.max(highest, number));
  const sum = numbers.reduce((total, number) => total + number, 0);
  return summary === "avg" || summary === "mean" ? sum / numbers.length : sum;
}

type KitRow = Record<string, unknown>;

function sankeyRows(rows: KitRow[], options: KitRow): KitRow[] {
  const nodes = fieldBindings(options["axis-nodes"]);
  const weight = fieldBindings(options["axis-values"])[0];
  if (nodes.length < 2 || !weight) return [];
  const edges: { row: KitRow; source: string; target: string }[] = [];
  for (const row of rows) {
    for (let i = 1; i < nodes.length; i++) {
      const source = String(row[nodes[i - 1]!.uid] ?? "").trim();
      const target = String(row[nodes[i]!.uid] ?? "").trim();
      if (source && target && source !== target) edges.push({ row, source, target });
    }
  }
  const groups = new Map<string, typeof edges>();
  const summarize = ["sum", "avg", "mean", "min", "max", "count"].includes(weight.summary);
  for (const [i, edge] of edges.entries()) {
    const key = summarize ? JSON.stringify([edge.source, edge.target]) : String(i);
    const group = groups.get(key);
    if (group) group.push(edge); else groups.set(key, [edge]);
  }
  return [...groups.values()].slice(0, 100).map(group => {
    const { row, source, target } = group[0]!;
    return { ...row, source, target, name: `${source} → ${target}`,
      value: kitNumber(aggregate(group.map(item => item.row), weight.uid, weight.summary)) };
  });
}

function boxPlotRows(rows: KitRow[], bindings: { uid: string }[], aliases: Map<string, string>): KitRow[] {
  return bindings.flatMap(({ uid }) => {
    const samples = rows.flatMap(row => {
      const value = row[uid];
      const number = typeof value === "number" || typeof value === "string" && value.trim() ? Number(value) : NaN;
      return Number.isFinite(number) ? [number] : [];
    }).sort((a, b) => a - b);
    if (!samples.length) return [];
    const quantile = (fraction: number) => {
      const index = fraction * (samples.length - 1), lower = Math.floor(index);
      return samples[lower]! + (samples[Math.ceil(index)]! - samples[lower]!) * (index - lower);
    };
    return [{ name: aliases.get(uid) ?? uid, field: uid, min: samples[0], q1: quantile(.25),
      median: quantile(.5), value: quantile(.5), q3: quantile(.75), max: samples.at(-1) }];
  });
}

function chartDate(value: unknown): number | undefined {
  if (typeof value !== "string") return;
  const parts = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (!parts) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  const [, yyyy, mm, dd, hh = "0", min = "0", ss = "0"] = parts;
  const year = Number(yyyy), month = Number(mm) - 1, day = Number(dd);
  const hour = Number(hh), minute = Number(min), second = Number(ss);
  if (year < 100 || hour > 23 || minute > 59 || second > 59) return;
  const time = Date.UTC(year, month, day, hour, minute, second);
  const date = new Date(time);
  if (date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day) return time;
}

function ganttRows(rows: KitRow[], options: KitRow): KitRow[] {
  const fields = ["axis-name", "axis-start", "axis-end", "axis-value"].map(key => fieldBindings(options[key])[0]);
  const [name, start, end, progress] = fields;
  if (!name || !start || !end) return [];
  return rows.flatMap(row => {
    const from = chartDate(row[start.uid]), to = chartDate(row[end.uid]);
    if (from === undefined || to === undefined || to < from) return [];
    const value = progress ? Math.min(1, Math.max(0, kitNumber(row[progress.uid]))) : 0;
    return [{ ...row, name: String(row[name.uid] ?? ""), start: from, end: to, value }];
  });
}

/** Generate calendar ticks before sending coordinates to the painter. */
function ganttTicks(rows: KitRow[], options: KitRow) {
  rows = rows.slice(0, 30);
  if (!rows.length) return [];
  let start = Infinity, end = -Infinity;
  for (const row of rows) {
    start = Math.min(start, Number(row.start));
    end = Math.max(end, Number(row.end));
  }
  const day = 86_400_000, calendarMonth = String(options["x-data-interval"]) === "30";
  const period = String(options["x-data-interval"]) === "8" ? 7 * day : day;
  const current = new Date(start);
  const count = Math.max(2, Math.min(30, Math.floor(kitNumber(options["x-start"], 5))));
  const monthSpan = (new Date(end).getUTCFullYear() - current.getUTCFullYear()) * 12
    + new Date(end).getUTCMonth() - current.getUTCMonth() + 1;
  const monthStep = Math.max(1, Math.ceil(monthSpan / (count - 1)));
  const step = period * Math.max(1, Math.ceil((end - start) / (count - 1) / period));
  const label = (time: number) => new Date(time).toISOString().slice(0, options["x-has-time"] === true ? 16 : 10).replace("T", " ");
  const ticks = [{ time: start, label: label(start) }];
  let next = calendarMonth ? Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + monthStep, 1)
    : Math.floor(start / period) * period + step;
  for (let i = 1; i < count - 1 && next < end; i++) {
    ticks.push({ time: next, label: label(next) });
    const date = new Date(next);
    next = calendarMonth ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + monthStep, 1) : next + step;
  }
  if (end > start) ticks.push({ time: end, label: label(end) });
  return ticks;
}

function riverSeries(rows: KitRow[], options: KitRow) {
  const [date, category, weight] = ["axis-date", "axis-category", "axis-value"].map(key => fieldBindings(options[key])[0]);
  if (!date || !category || !weight) return { labels: [], rows: [] };
  const labels = new Set<string>();
  const groups = new Map<number, { name: string; series: Map<string, KitRow[]> }>();
  for (const row of rows) {
    const time = chartDate(row[date.uid]), caption = String(row[category.uid] ?? "");
    if (time === undefined || !caption) continue;
    // The painter accepts up to 30 legend entries and 30 time positions.
    if (!labels.has(caption) && labels.size >= 30) continue;
    labels.add(caption);
    let dateGroup = groups.get(time);
    if (!dateGroup) {
      dateGroup = { name: String(row[date.uid]), series: new Map() };
      groups.set(time, dateGroup);
    }
    const samples = dateGroup.series.get(caption);
    if (samples) samples.push(row); else dateGroup.series.set(caption, [row]);
  }
  const series = [...labels];
  const dates = [...groups.entries()].sort(([a], [b]) => a - b);
  const mapped = dates.map(([, group]) => {
    const streamValues = series.map(label => Math.max(0, kitNumber(aggregate(group.series.get(label) ?? [], weight.uid,
      weight.summary || "sum"))));
    return { name: group.name, streamValues, value: streamValues[0], value2: streamValues[1], value3: streamValues[2] };
  });
  return { labels: series, rows: mapped };
}

function chartData(source: ReferenceKitWidget, previous: Record<string, unknown>): Record<string, unknown> {
  const o = kitOptions(source), privateData = kitPrivateData(source);
  const fields = privateData?.fields ?? [], rawRows = privateData?.rows;
  const nameKey = fieldBindings(o["axis-x"] ?? o["axis-name"] ?? o["axis-category"])[0]?.uid
    ?? fields.find(field => field.type === "string")?.uid ?? fields[0]?.uid;
  const axes = fieldBindings(o["axis-y"] ?? o["axis-value"] ?? o["axis-values"]);
  const lines = fieldBindings(o["axis-line"]);
  const sizes = fieldBindings(o["axis-size"]);
  const selectedValues = source.type === "widget.echarts.biaxial-reverse" ? [...lines, ...axes]
    : [...axes, ...lines, ...sizes];
  const variant = chartVariants[source.type.split(".").at(-1) ?? ""];
  const river = variant === "stream" ? riverSeries(rawRows ?? [], o) : undefined;
  const aliases = new Map(fields.map(field => [field.uid, field.alias ?? field.uid]));
  const bindings = selectedValues.length ? selectedValues : fields.filter(field => field.uid !== nameKey)
    .map(field => ({ uid: field.uid, summary: "none" }));
  const valueKeys = bindings.map(field => field.uid);
  const grouped = new Map<string, Record<string, unknown>[]>();
  const summarize = bindings.some(field => ["sum", "avg", "mean", "min", "max", "count"].includes(field.summary));
  const rowsByName = rawRows?.map((row, index) => {
    const name = String(row[nameKey ?? "name"] ?? index + 1);
    return { name, rows: [row] };
  });
  if (summarize) for (const { name, rows } of rowsByName ?? []) {
    const group = grouped.get(name);
    if (group) group.push(...rows); else grouped.set(name, rows);
  }
  const rowGroups = summarize && rowsByName ? [...grouped].map(([name, rows]) => ({ name, rows })) : rowsByName;
  const rows = river?.rows ?? (variant === "sankey" ? sankeyRows(rawRows ?? [], o)
    : variant === "boxplot" ? boxPlotRows(rawRows ?? [], fieldBindings(o["axis-value"]), aliases)
    : variant === "gantt" ? ganttRows(rawRows ?? [], o)
    : rowGroups?.map(({ name, rows }) => ({ ...rows[0], name,
    ...Object.fromEntries(["value", "value2", "value3"].flatMap((key, index) => {
      const binding = bindings[index];
      return binding ? [[key, kitNumber(aggregate(rows, binding.uid, binding.summary))]]
        : index === 0 ? [[key, kitNumber(rows[0]?.value)]] : [];
    })),
  })));
  const cluster = record(o["series-color-cluster"]);
  const styles = (Array.isArray(cluster.indexes) ? cluster.indexes : []).map(key => record(cluster[String(key)]));
  const fills = Array.isArray(o.palette) ? o.palette : styles.map(series => series["series-color"] ?? series["series-color2"]);
  const colors = fills.map(fill => kitColor(fill, "#1087e4"));
  const rightAxisChart = ["widget.echarts.line", "widget.echarts.area"].includes(source.type);
  const signedVerticalChart = rightAxisChart || ["widget.echarts.column", "widget.echarts.histogram"].includes(source.type);
  const signedHorizontalChart = source.type === "widget.echarts.bar";
  const dualAxisChart = source.type.startsWith("widget.echarts.biaxial");
  const reserveRight = (dualAxisChart || (rightAxisChart && lines.length > 0 && axes.length < 3))
    && o["y-polyline-display"] === true;
  const padding = (["left", "top", "right", "bottom"] as const).map((side, index) =>
    o[`padding-${side}`] === "diy" ? kitNumber(o[`padding-${side}-diy`]) : [34, 18, reserveRight ? 50 : 10, 27][index]);
  const xFont = record(o["x-font"]), yFont = record(o["y-font"]);
  const axisText = (suffix: "X" | "Y" | "Right", key: string, font: Record<string, unknown>) => ({
    [`axisFontFamily${suffix}`]: String(font.family ?? "sans-serif"),
    [`axisBold${suffix}`]: font.bold === true, [`axisItalic${suffix}`]: font.italic === true,
    [`axisUnderline${suffix}`]: font.underline === true,
    [`axisStrike${suffix}`]: font.deleteline === true || font["line-through"] === true,
    [`axisLabelOverflow${suffix}`]: o[`${key}-font-overflow`] === true,
    [`axisLabelMaxWidth${suffix}`]: kitNumber(o[`${key}-font-max-width`], 100),
    [`axisLabelShadowColor${suffix}`]: kitColor(o[`${key}-display-shadow-color`], "#ffffff"),
    [`axisLabelShadowBlur${suffix}`]: kitNumber(o[`${key}-display-shadow-blur`]),
    [`axisLabelShadowOffset${suffix}`]: [kitNumber(o[`${key}-display-shadow-offset-x`]),
      kitNumber(o[`${key}-display-shadow-offset-y`])],
  });
  const pointerFont = record(o["cross-hairs-label-font"]);
  const legendFont = record(o["legend-font"]), legendPageFont = record(o["legend-pageTextStyle"]);
  const pointShapes: Record<string, string> = { rect: "square", emptyRect: "squareEmpty", roundRect: "roundSquare",
    circle: "circle", emptyCircle: "circleEmpty", gradientCircle: "gradientCircle", image: "image",
    triangle: "triangle", diamond: "diamond" };
  const shapeCluster = record(o["series-shape-cluster"]);
  const shapeStyles = (Array.isArray(shapeCluster.indexes) ? shapeCluster.indexes : []).slice(0, 3)
    .map(key => record(shapeCluster[String(key)]));
  const seriesStyles = shapeStyles.map(style => ({
    ...(style["series-shape-type"] !== undefined ? { lineStyle: String(style["series-shape-type"]) } : {}),
    ...(style["series-shape-smooth"] !== undefined ? { smooth: style["series-shape-smooth"] === true } : {}),
    ...(style["series-shape-size"] !== undefined ? { lineWidth: kitNumber(style["series-shape-size"], 2) } : {}),
    ...(style["series-dot-shape-type"] !== undefined ? { showPoints: style["series-dot-shape-type"] !== "none",
      pointShape: pointShapes[String(style["series-dot-shape-type"])] ?? "circle" } : {}),
    ...(style["series-dot-size"] !== undefined ? { pointRadius: kitNumber(style["series-dot-size"], 8) / 2 } : {}),
    ...(style["series-image-url"] !== undefined ? { pointImage: kitFileUrl(style["series-image-url"]) } : {}),
    ...(style["series-dot-shadowBlur"] !== undefined ? { pointShadowBlur: kitNumber(style["series-dot-shadowBlur"]) } : {}),
    ...(style["series-dot-shadowColor"] !== undefined ? { pointShadowColor: kitColor(style["series-dot-shadowColor"]) } : {}),
    ...(style["series-dot-shadowOffset"] !== undefined ? { pointShadowOffset: kitPair(style["series-dot-shadowOffset"], [0, 0]) } : {}),
    ...(style["series-line-shadow-color"] !== undefined ? { lineShadowColor: kitColor(style["series-line-shadow-color"]) } : {}),
    ...(style["series-line-shadow-blur"] !== undefined ? { lineShadowBlur: kitNumber(style["series-line-shadow-blur"]) } : {}),
    ...(style["series-line-shadow-offset"] !== undefined ? { lineShadowOffset: kitPair(style["series-line-shadow-offset"], [0, 0]) } : {}),
  }));
  const flowCluster = record(o["flow-light-cluster"]);
  const flowShapes: Record<string, string> = { rect: "squareEmpty", roundRect: "roundSquare", circle: "circle",
    emptyCircle: "circleEmpty", triangle: "triangle", diamond: "diamond" };
  const flowStyles = (Array.isArray(flowCluster.indexes) ? flowCluster.indexes : []).slice(0, 3).map(key => {
    const style = record(flowCluster[String(key)]);
    return { enabled: style["flow-light"] === true, shape: flowShapes[String(style["flow-light-dot-shape-type"])] ?? "circle",
      color: kitColor(style["flow-light-color"], "#ffffff"), size: kitNumber(style["flow-light-size"], 8),
      trailLength: kitNumber(style["flow-light-trailLength"], 10), duration: kitNumber(style["flow-light-time"], 10) };
  });
  const legendShapes: Record<string, string> = { rect: "square", roundRect: "roundSquare", circle: "circle",
    triangle: "triangle", diamond: "diamond" };
  const pointShape = String(o["unified-dot-shape-type"] ?? "circle");
  const legendShape = String(o["legend-icon"] ?? "circle");
  const labelOffset = kitPair(o["label-offset2"] ?? o["label-text-offset"], [0, 0]);
  const horizontalBar = /^widget\.echarts\.bar(?:-|$)/.test(source.type);
  const labelPosition = String(o["label-position"] ?? "outside");
  const labelFont = record(o["label-font"]), labelUnitFont = record(o["label-unit-font"]);
  const rankingFont = record(o["ranking-text-font"]);
  const lineLabelFont = record(o["polyline-label-font"]), lineUnitFont = record(o["polyline-label-unit-font"]);
  const lineLabelOffset = kitPair(o["polyline-label-text-offset"], [0, 0]);
  const rightAxisFont = record(o["y-polyline-font"]);
  const rightAxisNameFont = record(o["y-polyline-unit-font"]);
  const annotationCluster = record(o["annotation-line-array-cluster"]);
  const referenceLines = o["annotation-line"] === true && Array.isArray(annotationCluster.indexes)
    ? annotationCluster.indexes.slice(0, 32).map(key => {
      const line = record(annotationCluster[String(key)]);
      return {
        value: kitNumber(line["annotation-line-value"]),
        style: line["annotation-line-type"] === "polyline" ? "solid" : "dashed",
        dash: kitNumber(line["annotation-line-dotted-width"], 4),
        color: kitColor(line["annotation-line-color"], "#ffffff"),
        width: kitNumber(line["annotation-line-width"], 1),
        name: String(line["annotation-line-text"] ?? ""),
        textColor: kitColor(line["annotation-line-text-color"], "#ffffff"),
        textOffset: kitPair(line["annotation-line-text-position"], [0, 0]),
      };
    }) : [];
  const chart = {
    ...record(previous.chart),
    ...(variant ? { variant } : {}),
    ...(variant && specialKitChartData.has(variant) ? { kitDataMapping: variant } : {}),
    ...(variant === "sankey" ? { linkOpacity: kitNumber(o["link-opacity"], 60) } : {}),
    ...(variant === "boxplot" ? {
      boxWidth: o["boxDiagram-select-width"] === "1" ? kitNumber(o["boxDiagram-width"], 50) : 0,
      boxFills: Array.isArray(o["palette-fill"]) ? o["palette-fill"].map(fill => kitColor(fill)) : [],
      boxBorder: kitNumber(o["shape-border-width"], 1),
    } : {}),
    ...(variant === "gantt" ? {
      ganttHeight: o["gantt-select-height"] === "1" ? kitNumber(o["gantt-height"], 100) : 0,
      ganttTicks: ganttTicks(rows ?? [], o),
      ganttStyles: styles.map(style => ({
        planColor: kitColor(style["plan-color"], "#21486c"), planGradient: kitGradient(style["plan-color"]),
        finishColor: kitColor(style["finish-color"], "#5b8ff9"), finishGradient: kitGradient(style["finish-color"]),
      })),
    } : {}),
    ...(river ? {
      riverTop: kitNumber(o["shape-top-space"], 10), riverBottom: kitNumber(o["shape-bottom-space"], 10),
      riverBorder: kitNumber(o["shape-border-width"], 0), riverBorderColor: kitColor(o["shape-border-color"], "#ffffff"),
    } : {}),
    ...(colors.length ? { colors, paletteCycle: true } : {}),
    kitBarGradients: fills.map(kitGradient), kitAreaGradients: styles.map(series => kitGradient(series["area-color"])),
    seriesLabels: river?.labels ?? valueKeys.map(key => aliases.get(key) ?? key),
    seriesCount: river?.labels.length ?? (["widget.echarts.bubble", "widget.echarts.scatter", "widget.echarts.punch"].includes(source.type)
      ? 1 : Math.max(1, valueKeys.length || colors.length)),
    showLegend: o.legend !== false, legendFontSize: kitNumber(legendFont.size, 12),
    legendFontFamily: String(legendFont.family ?? "sans-serif"), legendBold: legendFont.bold === true,
    legendItalic: legendFont.italic === true, legendUnderline: legendFont.underline === true,
    legendStrike: legendFont.deleteline === true || legendFont["line-through"] === true,
    legendTextMode: o["legend-text"] === "custom" ? "custom" : "auto",
    legendTextWidth: kitNumber(o["legend-text-width"], 30), legendTextSpacing: kitNumber(o["legend-text-padding"]),
    legendShadowColor: kitColor(o["legend-text-shadowColor"], "#ffffff"),
    legendShadowBlur: kitNumber(o["legend-text-shadowBlur"]),
    legendShadowOffset: kitPair(o["legend-text-shadowOffset"], [0, 0]),
    legendType: o["legend-type"] === "scroll" ? "scroll" : "plain",
    legendPageTextSize: kitNumber(legendPageFont.size, 12),
    legendPageTextColor: kitColor(legendPageFont.color, "#ffffff"),
    legendPageFontFamily: String(legendPageFont.family ?? "sans-serif"), legendPageBold: legendPageFont.bold === true,
    legendPageItalic: legendPageFont.italic === true, legendPageUnderline: legendPageFont.underline === true,
    legendPageStrike: legendPageFont.deleteline === true || legendPageFont["line-through"] === true,
    legendPageIconSize: kitNumber(o["legend-pageIconSize"], 12),
    legendPageItemGap: kitNumber(o["legend-pageButtonItemGap"], 12),
    legendPageGap: kitNumber(o["legend-pageButtonGap"], 12),
    legendPageIconColor: kitColor(o["legend-pageIconColor"], "#ffffff"),
    legendPageInactiveColor: kitColor(o["legend-pageIconInactiveColor"], "#3c3c3c"),
    legendPageLeftImage: kitFileUrl(o["legend-page-leftBackground"]),
    legendPageRightImage: kitFileUrl(o["legend-page-rightBackground"]),
    legendPosition: String(o["legend-position"] ?? "top"),
    legendColor: kitColor(legendFont.color, "#cde3f7"),
    legendMarker: legendShapes[legendShape] ?? "circle", legendMarkerSize: kitNumber(o["legend-icon-size"], 6),
    legendGap: kitNumber(o["legend-itemGap"], 10), legendMaxChars: kitNumber(o["legend-text-limit"], 100),
    showXAxis: o["x-display"] !== false, showYAxis: o["y-display"] !== false,
    showGrid: o.grid !== false, showLabels: o.label === true, referenceLines,
    gridColorX: kitColor(o["grid-x-line-color"], "#a4c4e31e"), gridColorY: kitColor(o["grid-y-line-color"], "#a4c4e31e"),
    showGridX: o["grid-x-display"] ?? o.grid !== false, showGridY: o["grid-y-display"] ?? o.grid !== false,
    gridStyleX: o["grid-x-line-type"] === "dotted" ? "dotted" : "solid",
    gridStyleY: o["grid-y-line-type"] === "dotted" ? "dotted" : "solid",
    gridWidthX: kitNumber(o["grid-x-line-width"], 1), gridWidthY: kitNumber(o["grid-y-line-width"], 1),
    gridDashX: kitNumber(o["grid-x-line-dotted-width"], 4), gridDashY: kitNumber(o["grid-y-line-dotted-width"], 4),
    showAxisLabelX: o["x-label"] !== false, showAxisLabelY: o["y-label"] !== false,
    showAxisLineX: o["x-line"] !== false, showAxisLineY: o["y-line"] !== false,
    axisLineStyleX: String(o["x-line-type"] ?? "solid"), axisLineStyleY: String(o["y-line-type"] ?? "solid"),
    axisLineDashX: kitPair(o["x-dotted-line-width"], [2, 5]), axisLineDashY: kitPair(o["y-dotted-line-width"], [2, 5]),
    axisLineColorX: kitColor(o["x-line-color"], "#cccccc"), axisLineColorY: kitColor(o["y-line-color"], "#cccccc"),
    axisLineWidthX: kitNumber(o["x-line-width"], 1), axisLineWidthY: kitNumber(o["y-line-width"], 1),
    showAxisTicksX: o["x-tickline"] !== false, showAxisTicksY: o["y-tickline"] !== false,
    axisTickColorX: kitColor(o["x-tickline-color"], "#cccccc"), axisTickColorY: kitColor(o["y-tickline-color"], "#cccccc"),
    axisTickWidthX: kitNumber(o["x-tickline-width"], 2), axisTickWidthY: kitNumber(o["y-tickline-width"], 2),
    axisTickLengthX: kitNumber(o["x-tickline-length"], 5), axisTickLengthY: kitNumber(o["y-tickline-length"], 5),
    axisValueFormatX: String(o["x-text-type"] ?? "normal"), axisValueFormatY: String(o["y-text-type"] ?? "normal"),
    axisValueScaleX: String(o["x-value-abbreviation"] ?? "0"), axisValueScaleY: String(o["y-value-abbreviation"] ?? "0"),
    axisDecimalsX: kitNumber(o["x-decimal-places"]), axisDecimalsY: kitNumber(o["y-decimal-places"]),
    axisPadZerosX: o["x-complete-zero"] === true, axisPadZerosY: o["y-complete-zero"] === true,
    axisLabelRotateX: kitNumber(o["x-rotate"]), axisLabelRotateY: kitNumber(o["y-rotate"]),
    showAxisNameX: o["x-unit"] === true, showAxisNameY: o["y-unit"] === true,
    axisNameX: String(o["x-unit-text"] ?? ""), axisNameY: String(o["y-unit-text"] ?? ""),
    axisNameFontSizeX: kitNumber(record(o["x-unit-font"]).size, 12),
    axisNameFontSizeY: kitNumber(record(o["y-unit-font"]).size, 12),
    axisNameColorX: kitColor(record(o["x-unit-font"]).color, "#90acc1"),
    axisNameColorY: kitColor(record(o["y-unit-font"]).color, "#90acc1"),
    axisNameGapX: kitNumber(o["x-nameGap"], 0), axisNameGapY: kitNumber(o["y-nameGap"], 15),
    labelSize: kitNumber(labelFont.size, 12), labelColor: kitColor(labelFont.color, "#a9b1c9"),
    decimals: kitNumber(o["label-decimal-places"], 0), labelPadZeros: o["label-complete-zero"] === true,
    labelFormat: o["label-text-type"] === "percent" ? "percent" : "value", unit: String(o["label-unit-value"] ?? ""),
    labelPosition: ["inside", "top-align"].includes(labelPosition) ? labelPosition : "outside",
    labelSpacing: kitNumber(o["label-shape-spacing"], 15), labelOffsetX: labelOffset[0], labelOffsetY: labelOffset[1],
    labelVerticalOffset: kitNumber(o["label-vertical-offset"]), hideZeroLabels: o["hide-zero-value"] === true,
    labelShowCategory: o[horizontalBar ? "label-y" : "label-x"] === true,
    labelColorMode: o["label-color-type"] === "follow" ? "follow" : "normal",
    labelFollowDataColor: o["label-follow-graph"] === true,
    labelTilt: kitNumber(o["label-tilt"]),
    labelUnitSize: kitNumber(labelUnitFont.size, kitNumber(labelFont.size, 12)),
    labelUnitColor: kitColor(labelUnitFont.color, kitColor(labelFont.color, "#a9b1c9")),
    showRanking: o["ranking-text"] === true,
    rankingFontSize: kitNumber(rankingFont.size, 12), rankingColor: kitColor(rankingFont.color, "#ffffff"),
    rankingFontFamily: String(rankingFont.family ?? "sans-serif"), rankingBold: rankingFont.bold === true,
    rankingItalic: rankingFont.italic === true, rankingUnderline: rankingFont.underline === true,
    rankingStrike: rankingFont.deleteline === true || rankingFont["line-through"] === true,
    rankingDistance: kitNumber(o["ranking-text-distance"]), rankingOffset: kitNumber(o["ranking-text-offset"]),
    rankingTemplate: String(o["ranking-text-template"] ?? "NO.{}"),
    rankingDisplay: String(o["show-text-type"] ?? "all"), rankingCount: kitNumber(o["ranking-text-show-number"], 3),
    rankingBackground: String(o["ranking-text-background"] ?? "shape"),
    rankingBackgroundShape: String(o["ranking-text-background-shape-type"] ?? "rect"),
    rankingBackgroundImage: kitFileUrl(o["ranking-text-background-image"]),
    rankingBackgroundColor: kitColor(o["ranking-text-background-color"], "#ffffff00"),
    rankingBackgroundWidth: kitNumber(o["ranking-text-background-width"], 50),
    rankingBackgroundHeight: kitNumber(o["ranking-text-background-height"], 30),
    rankingFormat: String(o["ranking-text-fommater-type"] ?? "text-template"),
    ...(dualAxisChart || rightAxisChart ? {
      showLineLabels: o["polyline-label"] === true,
      lineLabelFormat: o["polyline-label-text-type"] === "percent" ? "percent" : "value",
      lineLabelDecimals: kitNumber(o["polyline-decimal-places"]),
      lineLabelPadZeros: o["polyline-label-complete-zero"] === true,
      lineLabelPosition: o["polyline-label-position"] === "top" ? "top" : "above",
      lineLabelSize: kitNumber(lineLabelFont.size, 12), lineLabelColor: kitColor(lineLabelFont.color, "#a9b1c9"),
      lineLabelColorMode: o["polyline-label-color-type"] === "follow" ? "follow" : "normal",
      lineLabelFollowDataColor: o["polyline-label-follow-graph"] === true,
      lineLabelOffsetX: lineLabelOffset[0], lineLabelOffsetY: lineLabelOffset[1],
      lineLabelTilt: kitNumber(o["polyline-label-tilt"]), lineLabelUnit: String(o["polyline-label-unit-value"] ?? ""),
      lineLabelUnitSize: kitNumber(lineUnitFont.size, kitNumber(lineLabelFont.size, 12)),
      lineLabelUnitColor: kitColor(lineUnitFont.color, kitColor(lineLabelFont.color, "#a9b1c9")),
    } : {}),
    ...(signedVerticalChart ? {
      axisRangeModeY: o["y-scale-range"] === "custom" ? "custom" : "adaptive",
      axisMinY: kitNumber(o["y-scale-min"], 0), axisMaxY: kitNumber(o["y-scale-max"], 100),
      axisIntervalModeY: o["y-scale-interval-way"] === "number" ? "number" : "value",
      axisIntervalY: kitNumber(o["y-scale-interval"], 50),
    } : {}),
    ...(signedHorizontalChart ? {
      axisRangeModeX: o["x-scale-range"] === "custom" ? "custom" : "adaptive",
      axisMinX: kitNumber(o["x-scale-min"], 0), axisMaxX: kitNumber(o["x-scale-max"], 100),
      axisIntervalModeX: "value", axisIntervalX: kitNumber(o["x-scale-interval"], 50),
    } : {}),
    ...(rightAxisChart ? {
      rightAxisStart: lines.length > 0 && axes.length < 3 ? axes.length + 1 : 0,
      rightAxisRangeMode: o["y-polyline-scale-range"] === "custom" ? "custom" : "adaptive",
      rightAxisMin: kitNumber(o["y-polyline-scale-min"], 0), rightAxisMax: kitNumber(o["y-polyline-scale-max"], 100),
      rightAxisIntervalMode: o["y-polyline-scale-interval-way"] === "number" ? "number" : "value",
      rightAxisInterval: kitNumber(o["y-polyline-scale-interval"], 50),
    } : {}),
    ...(rightAxisChart || dualAxisChart ? {
      ...axisText("Right", "y-polyline", rightAxisFont),
      showRightAxis: o["y-polyline-display"] === true,
      showRightAxisLine: o["y-polyline-line"] !== false,
      rightAxisLineStyle: String(o["y-polyline-line-type"] ?? "solid"),
      rightAxisLineColor: kitColor(o["y-polyline-line-color"], "#cccccc"),
      rightAxisLineWidth: kitNumber(o["y-polyline-line-width"], 1),
      showRightAxisTicks: o["y-polyline-tickline"] !== false,
      rightAxisTickColor: kitColor(o["y-polyline-tickline-color"], "#cccccc"),
      rightAxisTickWidth: kitNumber(o["y-polyline-tickline-width"], 2),
      rightAxisTickLength: kitNumber(o["y-polyline-tickline-length"], 5),
      showRightAxisLabel: o["y-polyline-label"] !== false,
      rightAxisFontSize: kitNumber(rightAxisFont.size, 12), rightAxisColor: kitColor(rightAxisFont.color, "#90acc1"),
      rightLabelOffset: kitNumber(o["y-polyline-label-offset"], 10),
      rightAxisValueFormat: String(o["y-polyline-text-type"] ?? "normal"),
      rightAxisValueScale: String(o["y-polyline-value-abbreviation"] ?? "0"),
      rightAxisDecimals: kitNumber(o["y-polyline-decimal-places"]),
      rightAxisPadZeros: o["y-polyline-complete-zero"] === true,
      rightAxisRotate: kitNumber(o["y-polyline-rotate"]),
      showRightAxisName: o["y-polyline-unit"] === true, rightAxisName: String(o["y-polyline-unit-text"] ?? ""),
      rightAxisNameFontSize: kitNumber(rightAxisNameFont.size, 12),
      rightAxisNameColor: kitColor(rightAxisNameFont.color, "#90acc1"),
      rightAxisNameGap: kitNumber(o["y-polyline-nameGap"], 15), rightAxisNameOffset: kitNumber(o["y-polyline-padding"]),
      showRightGrid: o["grid-y-polyline-display"] === true,
      rightGridStyle: o["grid-y-polyline-line-type"] === "dotted" ? "dotted" : "solid",
      rightGridDash: kitNumber(o["grid-y-polyline-line-dotted-width"], 4),
      rightGridColor: kitColor(o["grid-y-polyline-line-color"], "#a4c4e31e"),
      rightGridWidth: kitNumber(o["grid-y-polyline-line-width"], 1),
    } : {}),
    axisFontSize: kitNumber(xFont.size, 12), axisColor: kitColor(xFont.color, "#a9b1c9"),
    ...axisText("X", "x", xFont), ...axisText("Y", "y", yFont),
    xAxisFontSize: kitNumber(xFont.size, 12), xAxisColor: kitColor(xFont.color, "#a9b1c9"),
    yAxisFontSize: kitNumber(yFont.size, 12), yAxisColor: kitColor(yFont.color, "#a9b1c9"),
    xLabelOffset: kitNumber(o["x-label-offset"], 8), yLabelOffset: kitNumber(o["y-label-offset"], 7), kitPadding: padding,
    barWidth: kitNumber(o["shape-column-width"], 12),
    lineWidth: kitNumber(o["unified-shape-size"] ?? o["unified-shape-width"], 2),
    lineStyle: o["unified-shape-type"] ?? "solid", lineShadowColor: kitColor(o["series-shape-shadow-color"]),
    lineShadowBlur: kitNumber(o["series-shape-shadow-blur"]),
    lineShadowOffset: kitPair(o["series-shape-shadow-offset"], [0, 0]),
    smooth: o["unified-shape-smooth"] === true, boundaryGap: o.boundaryGap !== false, showPoints: pointShape !== "none",
    pointShape: pointShapes[pointShape] ?? "circle", pointRadius: kitNumber(o["unified-dot-size"], 8) / 2,
    pointImage: kitFileUrl(o["image-url"]), pointShadowColor: kitColor(o["unified-dot-shadowColor"]),
    pointShadowBlur: kitNumber(o["unified-dot-shadowBlur"]), pointShadowOffset: kitPair(o["unified-dot-shadowOffset"], [0, 0]),
    seriesStyleEnabled: o["series-shape-custom"] === true, seriesStyles,
    zeroRemoval: o["zero-removal"] === true, zeroRemovalMode: o["zero-removal-mode"] === "segment" ? "segment" : "skip",
    flowEnabled: o["flow-light-show"] === true, flowStyles,
    categoryVisibilityMode: o["series-shape-number-type"] === "custom" ? "custom" : "all",
    visibleCategoryCount: kitNumber(o["shape-column-number"], 10),
    bubbleMin: kitNumber(o["bubble-size-min"], 5), bubbleMax: kitNumber(o["bubble-size-max"], 30),
    bubbleStrokeWidth: kitNumber(o["bubble-outline-width"]), bubbleStrokeColor: kitColor(o["bubble-outline-color"], "#1890ff"),
    startAngle: kitNumber(o["angle-start"], -90), innerRadius: Math.max(0, Math.min(95, 100 - kitNumber(o["ring-size"], 20))),
    segmentGap: kitNumber(o["ring-spacing"]), showTooltip: o.tooltip !== false,
    tooltipAxisTrigger: ["widget.echarts.line", "widget.echarts.area", "widget.echarts.area-stack"].includes(source.type)
      || dualAxisChart,
    tooltipBackground: kitColor(o["tooltip-background-color"], "#10243cf2"),
    tooltipBackgroundImage: kitFileUrl(o["tooltip-background-image"]),
    tooltipFormat: o["tooltip-text-type"] === "percent" ? "percent" : "normal",
    tooltipComma: o["tooltip-comma-display"] === true,
    tooltipDecimals: kitNumber(o["tooltip-decimal-places"]), tooltipPadZeros: o["tooltip-complete-zero"] === true,
    tooltipRightFormat: o["tooltip-right-text-type"] === "percent" ? "percent" : "normal",
    tooltipRightDecimals: kitNumber(o["tooltip-right-decimal-places"]),
    tooltipRightPadZeros: o["tooltip-right-complete-zero"] === true,
    tooltipNameColor: kitColor(o["tooltip-name-font-color"], "#cccccc"),
    tooltipNameSize: kitNumber(o["tooltip-name-font-size"], 14),
    tooltipTextColor: kitColor(o["tooltip-value-font-color"], "#cde3f7"),
    tooltipFontSize: kitNumber(o["tooltip-value-font-size"], 12),
    tooltipShowTitle: o["tooltip-title"] === true,
    tooltipTitleColor: kitColor(o["tooltip-title-font-color"], "#ffffff"),
    tooltipTitleSize: kitNumber(o["tooltip-title-font-size"], 16),
    tooltipShowUnitName: o["tooltip-unit-name"] === true || o["tooltip-unit"] === true,
    tooltipUnit: String(o["tooltip-unit-name"] === true ? o["tooltip-unit-y"] ?? "" : o["tooltip-unit-text"] ?? ""),
    tooltipRightUnit: String(o["tooltip-unit-yRight"] ?? ""),
    tooltipUnitColor: kitColor(o["tooltip-unit-name"] === true ? o["tooltip-unit-color"] : o["tooltip-unit-font-color"], "#ffffff"),
    tooltipUnitSize: kitNumber(o["tooltip-unit-name"] === true ? o["tooltip-unit-size"] : o["tooltip-unit-font-size"], 16),
    tooltipShowVerticalPointer: o["show-cross-hairs-y"] === true,
    tooltipShowHorizontalPointer: o["show-cross-hairs-x"] === true,
    tooltipPointerStyle: o["cross-hairs-line-type"] === "solid" ? "solid" : "dashed",
    tooltipPointerColor: kitColor(o["cross-hairs-line-color"], "#999999"),
    tooltipPointerWidth: kitNumber(o["cross-hairs-line-width"], 1),
    tooltipPointerLabel: o["show-cross-hairs-label"] === true,
    tooltipPointerLabelColor: kitColor(pointerFont.color, "#ffffff"),
    tooltipPointerLabelSize: kitNumber(pointerFont.size, 12),
    tooltipPointerLabelBackground: kitColor(o["cross-hairs-label-background"], "#505765"),
    tooltipPaddingX: kitNumber(o["tooltip-padding-width"], 10), tooltipPaddingY: kitNumber(o["tooltip-padding-height"], 7),
    tooltipRadius: kitNumber(o["tooltip-radius"], 4), tooltipShowIcon: o["tooltip-icon"] === true,
    tooltipPosition: o["tooltip-position"] === "center" ? "center" : "auto",
    showDataZoom: o["slider-display"] === true, zoomHeight: kitNumber(o["slider-height"], 16),
    zoomBottom: kitNumber(o["slider-bottom"], 10), zoomForeground: kitColor(o["slider-foreground-color"], "#5b8ff926"),
    zoomBackground: kitColor(o["slider-background-color"], "#4161800d"), zoomBorderColor: kitColor(o["slider-border-color"], "#cccccc"),
    zoomSliderHeight: kitNumber(o["slider-move-handle-size"], 5), zoomSliderColor: kitColor(o["slider-move-handle-color"], "#5b8ff926"),
    zoomHandleSize: kitNumber(o["slider-handler-size"], 28), zoomHandleColor: kitColor(o["slider-handler-color"], "#f7f7f7"),
    zoomDataLineWidth: kitNumber(o["slider-data-line-width"], 1), zoomDataLineColor: kitColor(o["slider-data-line-color"], "#1890ff"),
    zoomDataAreaColor: kitColor(o["slider-data-area-color"], "#1890ff55"),
    zoomSelectedLineColor: kitColor(o["slider-selected-data-line-color"], "#1c6cb8"),
    zoomSelectedAreaColor: kitColor(o["slider-selected-data-area-color"], "#1c6cb855"),
  };
  return { ...previous, ...(rows ? { rows } : {}), __kitChart: true, chart };
}

function mapSourceNode(node: SceneNode, source: ReferenceKitWidget, incomingRows?: Record<string, unknown>[],
  context?: KitConditionContext): void {
  const data = node.data ?? {};
  const importedRows = data.__kitImportedData === true ? data.rows : undefined;
  const importedColumns = data.__kitImportedData === true ? data.__kitImportedColumns ?? data.columns : undefined;
  const raw = kitOptions(source), original = kitPrivateData(source);
  const rows = filterKitRows(incomingRows ?? (Array.isArray(importedRows) ? kitRows(importedRows, importedColumns)
    : kitRows(original?.rows)), raw, context);
  const related = { ...relatedKitOptions(raw, rows), ...kitConditionalStyles(raw, rows, context) };
  const o = { ...raw, ...related }, appearance = kitAppearance(node, o);
  const privateData = original ? { ...original, rows } : undefined;
  const effectiveSource = { ...source, options: { ...source.options, ...related },
    ...(privateData ? { privateData } : {}) };
  node.widget = appearance.widget;
  if (Object.keys(related).length) data.__kitRelatedOptions = related;
  else delete data.__kitRelatedOptions;
  data.__kitColor = appearance.color;
  node.color = /^#[\da-f]{6}/i.test(appearance.color) ? appearance.color.slice(0, 7) : "#ffffff";
  data.passThrough = o["no-events"] === true || o["mouse-through"] === true || o["mouse-pass"] === true || o["pointer-events"] === false;
  data.loaded = o.loaded !== false;
  const fill = o["fill-style"] ?? o["image-fill-type"] ?? o["fill-type"];
  data.objectFit = fill === "center" ? "center" : fill === "tile" ? "tile" : "stretch";
  const kind = node.widget.kind;
  if (kind === "shape") {
    data.shape = String(o.graphicalType ?? o.shape ?? o["graphical-type"] ?? "rect");
    if (data.shape === "rectangle") data.shape = "rect";
    data.__kitGraphical = source.type === "widget.basic.graphical";
    // Rust's shape fill uses node.color; retain a transparent group instead of painting a solid box.
    data.__kitColor = kitColor(o.graphicalColor ?? o["fill-color"]);
    node.color = /^#[\da-f]{6}/i.test(String(data.__kitColor)) ? String(data.__kitColor).slice(0, 7) : "#ffffff";
  }
  if (kind === "image") {
    data.__kitQuietMedia = true;
    data.playAnimation = o["animation-display"] === true;
    data.animType = ({ clockwise: "rotate", counterclockwise: "rotateReverse", "anti-clockwise": "rotateReverse", flicker: "blink" } as Record<string, string>)[String(o["animation-type"])] ?? o["animation-type"];
    data.animDuration = kitNumber(o["animation-duration"], 1);
    data.animDelay = kitNumber(o["animation-delay"], 1);
    data.animLoop = o["animation-loop"] !== false;
    data.animInterval = kitNumber(o["animation-interval"]);
    data.easing = String(o["animation-easing"] ?? "none");
    data.frameFollowsImage = o["outline-follow-image-size"] === true;
    data.__kitImageFilter = { contrast: kitNumber(o.contrast, 1), saturate: kitNumber(o.saturate, 1),
      hue: kitNumber(o.hue), brightness: kitNumber(o.brightness, 1) };
    if (source.type === "widget.3d.city-builder") node.widget.image = kitMetadata(node)?.thumbnail ?? "";
  }
  if (["video", "audio", "monitor", "pdf"].includes(kind)) {
    data.src = kitFileUrl(o.video ?? o.audio ?? o.file ?? o.src ?? o.url ?? o["main-video"]);
    data.autoplay = o.autoplay !== false;
    data.loop = o.loop !== false;
    data.muted = o.muted !== false;
    data.hideControls = o["no-controls"] === true || o["show-controls"] === false;
    data.playbackRate = kitNumber(o["playback-rate"] ?? o["play-speed"], 1);
    data.loopStart = kitNumber(o["loop-start"]);
  }
  if (["menuHorizontal", "menuVertical", "list", "tabs"].includes(kind)) {
    const names = source.type.startsWith("widget.group.buttons") ? kitChoiceItems(source.type, o, rows)
      : o["button-name-option"] ?? o.items;
    data.items = Array.isArray(names) ? names.map(String) : [];
    const items = data.items as string[];
    const previous = Array.isArray(o["last-button-list"]) ? o["last-button-list"].map(record) : [];
    const selected = o["select-default-type"] === "custom" ? choiceIndex(o, "select-default", items.length)
      : items.findIndex((name, index) => `${name}-${index}` === o["selected-key"]
        || (previous[index]?.label === name && previous[index]?.key === o["selected-key"]));
    data.active = o["allow-unselected"] === true ? selected : Math.max(0, selected);
  }
  if (kind === "dropdown") {
    const items = kitChoiceItems(source.type, o, rows);
    const tree = kitChoiceTree(o, rows);
    if (o["dropdown-option-setting"] === "data" && o["use-json-type"] === true) data.__kitChoiceTree = tree;
    else delete data.__kitChoiceTree;
    const tip = String(o["dropdown-tip-text"] ?? "请选择");
    data.options = o["show-default-option"] === true && o["use-multiple"] !== true ? [tip, ...items] : items;
    const selected = o["dropdown-default-type"] === "custom" ? items[choiceIndex(o, "dropdown-default", items.length)]
      : o["dropdown-default-value"];
    const text = selected === "___default___" ? tip : String(selected ?? (o["show-default-option"] === true ? tip : items[0]) ?? "");
    node.widget.text = o["use-multiple"] === true ? tip : kitChoiceTreeItems(tree).find(item => item.value === text)?.label ?? text;
  }
  if (kind === "carousel" || kind === "carouselVideo") {
    const items = o.images ?? o.videos ?? o["image-list"] ?? o["video-list"];
    if (Array.isArray(items)) data.urls = items.map(kitFileUrl).filter(Boolean);
    data.interval = kitNumber(o["carousel-duration"] ?? o.interval, 3);
  }
  const fields = privateData?.fields ?? [];
  const binding = fieldBindings(o["axis-value"])[0];
  const firstValue = aggregate(privateData?.rows ?? [], binding?.uid ?? fields[0]?.uid ?? "value", binding?.summary ?? "none");
  if (kind === "metric") {
    const candidate = firstValue ?? o.placeholder ?? o.value;
    const number = kitNumber(candidate, Number.NaN);
    if (Number.isFinite(number)) {
      const percent = o["percentage-format"] === "percent";
      const decimals = Math.min(12, Math.max(0, Math.trunc(kitNumber(o["decimal-places"], 2))));
      node.widget.value = (number * (percent ? 100 : 1)).toLocaleString("zh-CN", {
        useGrouping: o["comma-display"] === true, maximumFractionDigits: decimals,
        minimumFractionDigits: o["complete-zero"] === true ? decimals : 0,
        minimumIntegerDigits: o["integer-digits"] === "fixed"
          ? Math.max(1, Math.min(21, Math.trunc(kitNumber(o["fixed-digits"], 2)))) : 1,
      });
      if (percent && !node.widget.unit) node.widget.unit = "%";
    }
  }
  if (kind === "progress") {
    // The percentage chart displays the first bound value, even when its
    // serialized field metadata contains the default `sum` summary.
    const progressValue = source.type === "widget.echarts.progress-v2"
      ? aggregate(privateData?.rows ?? [], binding?.uid ?? fields[0]?.uid ?? "value", "none") : firstValue;
    const value = kitNumber(progressValue ?? o.value ?? o.percent, 68);
    data.__kitProgressValue = value;
    data.percent = Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
  }
  if (kind === "tableBasic" && privateData?.rows && fields.length) {
    const selected = fieldBindings(o["axis-fields"]);
    const visibleFields = selected.length ? selected.map(binding => fields.find(field => field.uid === binding.uid)
      ?? { uid: binding.uid, alias: binding.uid }) : fields;
    data.columns = visibleFields.map(field => field.alias ?? field.uid);
    data.rows = privateData.rows.map(row => visibleFields.map(field => row[field.uid] ?? ""));
    data.__kitTableFields = visibleFields.map(field => field.uid);
  }
  node.data = source.type.startsWith("widget.echarts.") ? chartData(effectiveSource, data) : data;
  if (Array.isArray(importedRows) && incomingRows === undefined) {
    node.data.rows = importedRows;
    if (kind !== "tableBasic" && Array.isArray(importedColumns)) node.data.columns = importedColumns;
  }
}

/** Map imported or live rows through the reference component's selected data fields. */
export function resolveKitRows(node: SceneNode, hasLiveRows = false, context?: KitConditionContext): SceneNode {
  const meta = kitMetadata(node), data = node.data;
  if (!meta || !data) return node;
  const options = kitOptions(meta.source);
  const hasCondition = options.filter === true && options["filter-condition"] === "data-condition"
    && context?.conditions.some(item => item.id === options["filter-condition-select"]);
  const conditional = !!context && Object.keys(record(options[KIT_CONDITION_STYLES])).length > 0;
  if (!Array.isArray(data.rows) && !hasCondition && !conditional) return node;
  // Chart and table nodes already hold their mapped static rows. Only remap raw incoming rows.
  if (!hasLiveRows && data.__kitImportedData !== true && !hasCondition && !conditional) {
    const variant = chartVariants[meta.source.type.split(".").at(-1) ?? ""];
    const chart = record(data.chart);
    if (!variant || !specialKitChartData.has(variant) || chart.kitDataMapping === variant) return node;
    const mapped = { ...node, data: { ...data } };
    mapSourceNode(mapped, meta.source);
    return mapped;
  }
  const isChart = meta.source.type.startsWith("widget.echarts.");
  const isMetric = meta.source.type === "widget.basic.card" || meta.source.type === "widget.basic.card-v2";
  const isTable = meta.source.type === "widget.basic.table-v3" || meta.source.type === "widget.basic.table-v2";
  const isChoiceData = meta.source.type.startsWith("widget.group.buttons") && options["button-option-setting"] === "data"
    || meta.source.type === "widget.basic.dropdown-v2" && options["dropdown-option-setting"] === "data";
  const hasRelated = Object.keys(record(options["related-fields"])).length > 0;
  if (!isChart && !isMetric && !isTable && !isChoiceData && !hasRelated && !conditional) return node;
  const rows = !hasLiveRows && data.__kitImportedData !== true && (hasCondition || conditional)
    ? kitRows(kitPrivateData(meta.source)?.rows)
    : kitRows(data.rows, !hasLiveRows && data.__kitImportedData === true
      ? data.__kitImportedColumns ?? data.columns : data.columns);
  const withRawRows = (value: SceneNode): SceneNode => ({ ...value,
    data: { ...value.data, __kitActiveRows: rows } });
  if (isTable && !conditional) return withRawRows({ ...node, data: { ...data, rows: filterKitRows(rows, options, context) } });
  if (hasRelated || isChoiceData || conditional) {
    const original = kitPrivateData(meta.source);
    const fields = [...original?.fields ?? []];
    for (const key of Object.keys(rows[0] ?? {})) if (!fields.some(field => field.uid === key)) fields.push({ uid: key, alias: key });
    const source = { ...meta.source, privateData: { ...original, fields, rows } };
    const mapped = { ...node, widget: node.widget ? { ...node.widget } : undefined, data: { ...data } };
    mapSourceNode(mapped, source, rows, context);
    if (isTable && mapped.data) mapped.data.rows = filterKitRows(rows, options, context);
    if (mapped.widget && node.widget) for (const key of ["text", "value", "unit"] as const) {
      if (node.bindings?.[key]) mapped.widget[key] = node.widget[key];
    }
    return withRawRows(mapped);
  }
  const keys = ["axis-x", "axis-name", "axis-category", "axis-y", "axis-value", "axis-values", "axis-line", "axis-size",
    "axis-nodes", "axis-start", "axis-end", "axis-date"]
    .flatMap(key => fieldBindings(options[key]).map(binding => binding.uid));
  if (rows.length && !keys.some(key => rows.some(row => Object.hasOwn(row, key)))) return withRawRows(node);
  const fields = [...kitPrivateData(meta.source)?.fields ?? []];
  for (const key of Object.keys(rows[0] ?? {})) if (!fields.some(field => field.uid === key)) fields.push({ uid: key, alias: key });
  const filtered = filterKitRows(rows, options, context);
  const source = { ...meta.source, privateData: { ...kitPrivateData(meta.source), fields, rows: filtered } };
  if (isChart) return withRawRows({ ...node, data: chartData(source, data) });
  if (!node.widget || node.bindings?.value) return withRawRows(node);
  const mapped = { ...node, widget: { ...node.widget }, data: { ...data } };
  mapSourceNode(mapped, source, rows, context);
  return withRawRows({ ...node, widget: { ...node.widget, value: mapped.widget!.value,
    unit: node.bindings?.unit ? node.widget.unit : mapped.widget!.unit } });
}

/** Flatten local child coordinates while preserving the real parent tree and every source option. */
export function importKitTemplate(entry: Pick<KitCatalogEntry, "id" | "familyId" | "familyLabel" | "label" | "thumbnail">,
  template: ReferenceKitWidget, origin = { x: 80, y: 80 }): SceneNode[] {
  const nodes: SceneNode[] = [];
  const visit = (source: ReferenceKitWidget, parentId: string | null, x: number, y: number, root: boolean) => {
    const o = kitOptions(source), kind = kitWidgetKind(source.type, o);
    const position = root ? [0, 0] : pair(o.position, [0, 0]);
    const size = pair(o.size, [300, 64]);
    const node = widgetNode(kind) as SceneNode;
    node.id = `kit-${entry.id}-${nodes.length}-${source.uid ?? "node"}`;
    node.name = root ? entry.label : source.name ?? source.type;
    node.type = source.type.startsWith("widget.group.") && (source.widgets?.length ?? 0) > 0 ? "group" : "widget";
    node.parentId = parentId;
    node.visible = o.visible !== false;
    node.locked = false;
    node.boxSize = { x: Math.max(1, size[0]), y: Math.max(1, size[1]), z: 1 };
    node.transform.position = { x: x + position[0]!, y: y + position[1]!, z: 0 };
    const rotation = Array.isArray(o.rotate) ? o.rotate : Array.isArray(o.rotation) ? o.rotation : [0, 0, 0];
    node.transform.rotation = { x: kitNumber(rotation[0]), y: kitNumber(rotation[1]), z: kitNumber(rotation[2]) };
    const { widgets: _children, ...savedSource } = structuredClone(source);
    node.data = { ...node.data, __kit: {
      templateId: entry.id, familyId: entry.familyId, familyLabel: entry.familyLabel,
      label: entry.label, source: savedSource, thumbnail: kitFileUrl(entry.thumbnail),
    } satisfies KitMetadata };
    mapSourceNode(node, source);
    const names = new Map((source.states ?? []).filter(item => item.uid).map(item => [item.uid, item.name]));
    for (const id of Object.keys(source.statesOptions ?? {})) if (id && !names.has(id)) names.set(id, `状态${names.size + 1}`);
    if (names.size && node.widget) node.widget.states = [...names].map(([id, name]) => ({ id, name, patch: {} }));
    nodes.push(node);
    for (const child of source.widgets ?? []) visit(child, node.id, node.transform.position.x, node.transform.position.y, false);
  };
  visit(template, null, origin.x, origin.y, true);
  for (const node of nodes) node.interactions = importKitInteractions(node, nodes);
  return nodes;
}

export function resolveKitState(node: SceneNode, stateId: string): SceneNode {
  const meta = kitMetadata(node), options = meta?.source.statesOptions?.[stateId];
  return options ? resolveKitOptions(node, options) : node;
}

export function resolveKitOptions(node: SceneNode, options: Record<string, unknown>): SceneNode {
  const meta = kitMetadata(node);
  if (!meta) return node;
  const source = { ...meta.source, options: { ...meta.source.options, ...options } };
  const resolved = { ...node, data: { ...node.data, __kit: { ...meta, source } } };
  mapSourceNode(resolved, source);
  if (typeof options.enable === "boolean") resolved.visible = options.enable;
  if (typeof options.visible === "boolean") resolved.visible = options.visible;
  return resolved;
}

export function patchKitPrivateData(node: SceneNode, data: ReferenceKitWidget["privateData"]): void {
  const meta = kitMetadata(node);
  if (!meta) return;
  if (node.data?.__kitImportedData === true) {
    delete node.data.__kitImportedData;
    delete node.data.__kitImportedColumns;
    delete node.data.rows;
    delete node.data.columns;
  }
  meta.source.privateData = structuredClone(data);
  mapSourceNode(node, meta.source);
}

interface KitRect { x: number; y: number; width: number; height: number }

/** Resize a child in its parent's local coordinates using the reference anchor mode. */
function responsiveAxis(start: number, size: number, parentStart: number, parentSize: number,
  nextStart: number, nextSize: number, mode: string, end: string, center: string, stretch: string): [number, number] {
  const local = start - parentStart, delta = nextSize - parentSize;
  if (mode === "scale") {
    const scale = nextSize / Math.max(1, parentSize);
    return [nextStart + local * scale, Math.max(1, size * scale)];
  }
  if (mode === end) return [nextStart + local + delta, size];
  if (mode === center) return [nextStart + local + delta / 2, size];
  if (mode === stretch) return [nextStart + local, Math.max(1, size + delta)];
  return [nextStart + local, size];
}

function resizeResponsiveNode(child: SceneNode, before: KitRect, after: KitRect): [KitRect, KitRect] {
  const old: KitRect = { x: child.transform.position.x, y: child.transform.position.y,
    width: child.boxSize?.x ?? 1, height: child.boxSize?.y ?? 1 };
  const meta = kitMetadata(child), options = meta ? kitOptions(meta.source) : {};
  const [x, width] = responsiveAxis(old.x, old.width, before.x, before.width, after.x, after.width,
    String(options["responsive-x"] ?? "scale"), "right", "center", "left-right");
  const [y, height] = responsiveAxis(old.y, old.height, before.y, before.height, after.y, after.height,
    String(options["responsive-y"] ?? "scale"), "bottom", "middle", "top-bottom");
  child.transform.position.x = x; child.transform.position.y = y;
  if (child.boxSize) { child.boxSize.x = width; child.boxSize.y = height; }
  return [old, { x, y, width, height }];
}

function resizeKitDescendants(tree: SceneNode[], root: SceneNode, previous: KitRect): SceneNode[] {
  const byParent = new Map<string, SceneNode[]>();
  for (const child of tree) if (child.parentId) {
    const siblings = byParent.get(child.parentId) ?? [];
    siblings.push(child); byParent.set(child.parentId, siblings);
  }
  const descendants: SceneNode[] = [], visited = new Set([root.id]);
  const visit = (parent: SceneNode, before: KitRect, after: KitRect) => {
    for (const child of byParent.get(parent.id) ?? []) {
      if (visited.has(child.id)) continue;
      visited.add(child.id); descendants.push(child);
      const [old, next] = resizeResponsiveNode(child, before, after);
      visit(child, old, next);
    }
  };
  visit(root, previous, { x: root.transform.position.x, y: root.transform.position.y,
    width: root.boxSize?.x ?? previous.width, height: root.boxSize?.y ?? previous.height });
  return descendants;
}

/** Reflow a temporary preview scene without changing the editable project coordinates. */
export function responsiveKitScene(scene: SceneNode[], original: { width: number; height: number },
  viewport: { width: number; height: number }): SceneNode[] {
  if (![original.width, original.height, viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0)
      || original.width === viewport.width && original.height === viewport.height) return scene;
  const eligible = new Set(scene.filter(node => node.widget || kitMetadata(node)).map(node => node.id));
  const next = scene.map(node => eligible.has(node.id) ? { ...node,
    transform: { ...node.transform, position: { ...node.transform.position } },
    boxSize: node.boxSize ? { ...node.boxSize } : undefined,
  } : node);
  const roots: SceneNode[] = [], children = new Map<string, SceneNode[]>();
  for (const node of next) {
    if (!eligible.has(node.id)) continue;
    if (!node.parentId || !eligible.has(node.parentId)) roots.push(node);
    else {
      const siblings = children.get(node.parentId) ?? [];
      siblings.push(node); children.set(node.parentId, siblings);
    }
  }
  const visited = new Set<string>();
  const visit = (nodes: SceneNode[], before: KitRect, after: KitRect) => {
    for (const child of nodes) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      const [old, resized] = resizeResponsiveNode(child, before, after);
      visit(children.get(child.id) ?? [], old, resized);
    }
  };
  visit(roots, { x: 0, y: 0, ...original }, { x: 0, y: 0, ...viewport });
  return next;
}

/** One worker operation updates options, derived style and all affected descendant coordinates. */
export function patchKitOptions(tree: SceneNode[], id: string, patch: Record<string, unknown>, stateId?: string): void {
  const node = tree.find(item => item.id === id), meta = node && kitMetadata(node);
  if (!node || !meta) return;
  const options = meta.source.options ?? {};
  if (stateId) {
    meta.source.statesOptions ??= {};
    meta.source.statesOptions[stateId] = { ...meta.source.statesOptions[stateId], ...structuredClone(patch) };
    return;
  }
  meta.source.options = { ...options, ...structuredClone(patch) };
  const o = meta.source.options;
  const old = { ...node.transform.position }, oldSize = node.boxSize ?? { x: 300, y: 64, z: 1 };
  const oldRotation = node.transform.rotation.z;
  if (typeof patch.visible === "boolean") node.visible = patch.visible;
  else if (typeof patch.enable === "boolean") node.visible = patch.enable;
  if (patch.position) {
    const parent = tree.find(item => item.id === node.parentId);
    const p = pair(o.position, [old.x, old.y]);
    node.transform.position = { x: p[0] + (parent?.transform.position.x ?? 0), y: p[1] + (parent?.transform.position.y ?? 0), z: 0 };
  }
  if (patch.size) {
    const s = pair(o.size, [oldSize.x, oldSize.y]);
    node.boxSize = { x: Math.max(1, s[0]), y: Math.max(1, s[1]), z: 1 };
  }
  if (patch.rotate || patch.rotation) {
    const value = o.rotate ?? o.rotation;
    const r = Array.isArray(value) ? value : [0, 0, 0];
    node.transform.rotation = { x: kitNumber(r[0]), y: kitNumber(r[1]), z: kitNumber(r[2]) };
  }
  mapSourceNode(node, meta.source);
  if (node.type === "group" && (patch.position || patch.size || patch.rotate || patch.rotation)) {
    const descendants = resizeKitDescendants(tree, node, { x: old.x, y: old.y, width: oldSize.x, height: oldSize.y });
    const degrees = node.transform.rotation.z - oldRotation;
    const radians = degrees * Math.PI / 180;
    const cosine = Math.cos(radians), sine = Math.sin(radians);
    for (const child of descendants) {
      if (degrees) {
        const pivotX = node.transform.position.x + (node.boxSize?.x ?? oldSize.x) / 2;
        const pivotY = node.transform.position.y + (node.boxSize?.y ?? oldSize.y) / 2;
        const halfWidth = (child.boxSize?.x ?? 0) / 2, halfHeight = (child.boxSize?.y ?? 0) / 2;
        const x = child.transform.position.x + halfWidth - pivotX;
        const y = child.transform.position.y + halfHeight - pivotY;
        child.transform.position.x = pivotX + x * cosine - y * sine - halfWidth;
        child.transform.position.y = pivotY + x * sine + y * cosine - halfHeight;
        child.transform.rotation.z += degrees;
      }
    }
  }
}

/** All local source assets, including alternate button states, travel with a published project. */
export function kitAssetPaths(tree: SceneNode[]): string[] {
  const paths = new Set<string>();
  const visit = (value: unknown, withModels: boolean) => {
    if (typeof value === "string" && /^\.?\/kits\/(?:assets|thumbs)\/[a-f0-9]{64}\.[a-z0-9]{1,8}$/i.test(value)) {
      const path = value.replace(/^\.?\//, "");
      paths.add(path);
      const preview = withModels && (kitModelPreviewAsset(path) ?? kitTexturePreviewAsset(path));
      if (preview) paths.add(preview.slice(1));
    } else if (value && typeof value === "object") {
      for (const child of Object.values(value)) visit(child, withModels);
    }
  };
  for (const node of tree) {
    const source = kitMetadata(node)?.source;
    if (!source) continue;
    const withModels = source.type === KIT_CITY_TYPE && (source.options?.[KIT_CITY_GEOMETRY_OPTION] === true
      || Object.values(source.statesOptions ?? {}).some(options => options[KIT_CITY_GEOMETRY_OPTION] === true));
    visit(node.data, withModels);
  }
  return [...paths];
}
