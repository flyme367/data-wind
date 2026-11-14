import { asRecord } from "./runtimeScene";

function itemName(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value) ?? "";
}

/** The selectable names use the same data fields as the rendered chart marks. */
export function chartItemNames(data: Record<string, unknown> | undefined): string[] {
  const variant = asRecord(data?.chart)?.variant;
  const rows: unknown[] = Array.isArray(data?.rows) ? data.rows : [];
  const limit = variant === "dynamicBar" ? 5000 : variant === "calendarHeatmap" ? 371
    : variant === "sankey" || variant === "pathAnimation" ? 100 : 30;
  const names = new Set<string>();
  for (const [index, raw] of rows.slice(0, limit).entries()) {
    const row = asRecord(raw) ?? {};
    if (variant === "sankey") {
      const source = itemName(row.source ?? row["节点1"]);
      const target = itemName(row.target ?? row["节点2"]);
      if (!source || !target || source === target || !(Number(row.value ?? row["数值"]) > 0)) continue;
      names.add(source);
      names.add(target);
      names.add(`${source} → ${target}`);
      continue;
    }
    const name = variant === "dynamicBar" ? itemName(Object.hasOwn(row, "name") ? row.name : row["种类"])
      : Object.hasOwn(row, "name") ? itemName(row.name)
        : variant === "pathAnimation" ? `路径点 ${index + 1}` : String(index + 1);
    if (name) names.add(name);
    if (variant === "sunburst" && Array.isArray(row.children)) {
      for (const [childIndex, child] of row.children.slice(0, 30).entries()) {
        const entry = asRecord(child) ?? {};
        const name = Object.hasOwn(entry, "name") ? itemName(entry.name) : String(childIndex + 1);
        if (name) names.add(name);
      }
    }
  }
  if (variant === "pathAnimation" && rows.length >= 2) names.add("动画点");
  return [...names];
}

export function chartItemValueOptions(data: Record<string, unknown> | undefined) {
  const fields = new Set<string>();
  if (Array.isArray(data?.rows)) {
    for (const raw of data.rows.slice(0, 30)) {
      for (const key of Object.keys(asRecord(raw) ?? {})) fields.add(key);
    }
  }
  return [
    { value: "name", label: "数据项名称" }, { value: "value", label: "当前值" },
    { value: "series", label: "系列序号" }, { value: "index", label: "数据项索引" },
    { value: "row", label: "原始行" },
    ...[...fields].map(field => ({ value: `row.${field}`, label: `原始行 · ${field}` })),
  ];
}
