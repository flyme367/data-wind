import { dataAt } from "./editor";

export type ConditionOperator = "=" | "!=" | ">" | "<" | ">=" | "<=" | "⊃" | "!⊃" | "∅" | "!∅";
export type ConditionSelector = "each" | "first" | "last" | "any" | "all" | "index";
export interface DataConditionRule {
  sourceId: string; field: string; operator: ConditionOperator; value: string;
  selector: ConditionSelector; index: number;
}
export interface BoardDataCondition { id: string; name: string; groups: DataConditionRule[][] }
export interface KitConditionContext {
  conditions: BoardDataCondition[];
  sources: Record<string, Record<string, unknown>>;
  currentSourceId?: string;
}
const operators: ConditionOperator[] = ["=", "!=", ">", "<", ">=", "<=", "⊃", "!⊃", "∅", "!∅"];
const selectors: ConditionSelector[] = ["each", "first", "last", "any", "all", "index"];

export function sanitizeDataConditions(value: unknown): BoardDataCondition[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    if (typeof raw.id !== "string" || !raw.id || typeof raw.name !== "string" || !raw.name.trim()
        || !Array.isArray(raw.groups)) return [];
    const groups = raw.groups.slice(0, 30).flatMap((group: unknown) => {
      if (!Array.isArray(group)) return [];
      const rules = group.slice(0, 30).flatMap((item: unknown) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const rule = item as Record<string, unknown>;
        if (typeof rule.sourceId !== "string" || rule.sourceId.length > 100 || typeof rule.field !== "string"
            || rule.field.length > 100 || /(__proto__|constructor|prototype)/.test(rule.field)
            || !operators.includes(rule.operator as ConditionOperator) || !selectors.includes(rule.selector as ConditionSelector)
            || typeof rule.value !== "string" || rule.value.length > 300) return [];
        return [{ sourceId: rule.sourceId, field: rule.field, operator: rule.operator as ConditionOperator,
          value: rule.value, selector: rule.selector as ConditionSelector,
          index: Math.max(1, Math.min(1_000_000, Math.trunc(Number(rule.index) || 1))) }];
      });
      return [rules];
    });
    return [{ id: raw.id.slice(0, 100), name: raw.name.trim().slice(0, 100), groups }];
  });
}

function matches(actual: unknown, operator: ConditionOperator, expected: string): boolean {
  const empty = actual === null || actual === undefined || actual === "";
  if (operator === "∅") return empty;
  if (operator === "!∅") return !empty;
  if (empty) return false;
  const text = String(actual);
  if (operator === "=") return text === expected;
  if (operator === "!=") return text !== expected;
  if (operator === "⊃") return text.includes(expected);
  if (operator === "!⊃") return !text.includes(expected);
  const a = Number(actual), b = Number(expected);
  const delta = expected !== "" && Number.isFinite(a) && Number.isFinite(b) ? a - b
    : text.localeCompare(expected, "zh-CN", { numeric: true });
  return operator === ">" ? delta > 0 : operator === ">=" ? delta >= 0
    : operator === "<" ? delta < 0 : delta <= 0;
}

/** A named condition is OR between groups and AND within a group. */
export function filterConditionRows<T extends Record<string, unknown>>(rows: T[], condition: BoardDataCondition,
  context: KitConditionContext): T[] {
  const sources = context.sources;
  const valueAt = (row: Record<string, unknown>, field: string, index: number, count: number) =>
    field === "$row" ? index + 1 : field === "$reverse-row" ? count - index : field === "$count" ? count
      : Object.hasOwn(row, field) ? row[field] : dataAt(row, field);
  const groups = condition.groups.filter(group => group.length > 0).map(group => group.map(rule => {
    if (!rule.field) return () => false;
    const current = rule.sourceId === "$current" || rule.sourceId === context.currentSourceId;
    if (rule.sourceId === "builtin:project-params") {
      const params = sources[rule.sourceId];
      const result = matches(params && Object.hasOwn(params, rule.field) ? params[rule.field] : dataAt(params, rule.field),
        rule.operator, rule.value);
      return () => result;
    }
    const data = sources[rule.sourceId], source = current ? rows : data?.rows;
    if (!Array.isArray(source) || !source.length) return () => false;
    const columns = Array.isArray(data?.columns) ? data.columns.map(String) : [];
    const records = source.map(item => Array.isArray(item) ? Object.fromEntries(columns.map((name, index) => [name, item[index]]))
      : item && typeof item === "object" ? item as Record<string, unknown> : {});
    const test = (item: Record<string, unknown>, at: number) =>
      matches(valueAt(item, rule.field, at, records.length), rule.operator, rule.value);
    if (rule.selector === "each" && current) return test;
    const result = rule.selector === "first" ? test(records[0]!, 0)
      : rule.selector === "last" ? test(records.at(-1)!, records.length - 1)
      : rule.selector === "index" ? rule.index <= records.length && test(records[rule.index - 1]!, rule.index - 1)
      : rule.selector === "all" ? records.every(test) : records.some(test);
    return () => result;
  }));
  return rows.filter((row, index) => groups.some(group => group.every(test => test(row, index))));
}
