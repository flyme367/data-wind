import { describe, expect, it } from "vitest";
import { applyDataFilter, sanitizeDataFilter, validateDataSource } from "../data/dataSources";

describe("山海鲸数据条件", () => {
  it("按字段与操作符过滤 rows", () => {
    const data = { rows: [{ name: "园区", value: 100 }, { name: "厂房", value: 42 }, { name: "园区二期", value: 7 }] };
    expect(applyDataFilter(data, { field: "name", op: "==", value: "园区" }).rows).toEqual([{ name: "园区", value: 100 }]);
    expect(applyDataFilter(data, { field: "name", op: "contains", value: "园区" }).rows).toHaveLength(2);
    expect(applyDataFilter(data, { field: "value", op: ">", value: "50" }).rows).toEqual([{ name: "园区", value: 100 }]);
    expect(applyDataFilter(data, { field: "value", op: "<=", value: "42" }).rows).toEqual([{ name: "厂房", value: 42 }, { name: "园区二期", value: 7 }]);
    expect(applyDataFilter(data, { field: "name", op: "!=", value: "园区" }).rows).toHaveLength(2);
    // 非 rows 数据原样保留
    expect(applyDataFilter({ value: 5 }, { field: "name", op: "==", value: "x" })).toEqual({ value: 5 });
    expect(applyDataFilter(data, undefined)).toBe(data);
  });
  it("清洗非法条件并在校验时保留合法条件", () => {
    expect(sanitizeDataFilter({ field: " name ", op: "contains", value: "x" })).toEqual({ field: "name", op: "contains", value: "x" });
    expect(sanitizeDataFilter({ field: "", op: "==", value: "x" })).toBeUndefined();
    expect(sanitizeDataFilter({ field: "__proto__.x", op: "==", value: "1" })).toBeUndefined();
    expect(sanitizeDataFilter({ field: "a", op: "~", value: "1" })).toBeUndefined();
    const source = validateDataSource({ kind: "api", enabled: true, url: "https://example.com/api", path: "", method: "GET",
      headers: {}, body: "", intervalMs: 5000, filter: { field: "name", op: ">", value: "50" } });
    expect(source.filter).toEqual({ field: "name", op: ">", value: "50" });
    const dropped = validateDataSource({ kind: "api", enabled: true, url: "https://example.com/api", path: "", method: "GET",
      headers: {}, body: "", intervalMs: 5000, filter: { field: "", op: "==", value: "" } });
    expect(dropped.filter).toBeUndefined();
  });
});
