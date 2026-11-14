import type { RustBoardNode } from "./boardScene";

/** Translate a received selection into the value expected by the Rust control. */
export function kitSelectionControlValue(node: RustBoardNode): unknown | undefined {
  const raw = node.data.__kitSelection;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const selection = raw as Record<string, unknown>, value = String(selection.value ?? "");
  if (node.data.__kitMenu) {
    const items = Array.isArray(node.data.items) ? node.data.items.map(String) : [];
    return items.includes(value) ? value : "";
  }
  if (node.widget.kind === "dropdown") {
    const items = Array.isArray(node.data.options) ? node.data.options.map(String) : [];
    const style = node.data.__kitDropdown;
    const config = style && typeof style === "object" && !Array.isArray(style) ? style as Record<string, unknown> : {};
    if (config.multiple === true) {
      const values = Array.isArray(selection.values) ? selection.values.map(String) : value ? [value] : [];
      return values.filter(item => items.includes(item));
    }
    const placeholder = String(config.placeholder ?? "");
    return items.includes(value) ? value : placeholder;
  }
  if (!node.data.__kitTable) return undefined;
  const rows = Array.isArray(node.data.__kitTableRawRows) ? node.data.__kitTableRawRows
    : Array.isArray(node.data.rows) ? node.data.rows : [];
  const fields = Array.isArray(node.data.__kitTableFields) ? node.data.__kitTableFields.map(String) : [];
  const field = String(selection.field ?? fields[0] ?? "");
  const column = fields.indexOf(field);
  const index = value ? rows.findIndex(row => {
    const item = Array.isArray(row) ? row[column] : row && typeof row === "object"
      ? (row as Record<string, unknown>)[field] : undefined;
    return item !== null && item !== undefined && String(item) === value;
  }) : -1;
  // A non-negative sentinel suppresses the table's default-first-row selection.
  return { index: index < 0 ? 4_294_967_295 : index };
}
