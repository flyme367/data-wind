import { readFile } from "node:fs/promises";
import { zipSync } from "fflate";
import readXlsxFile from "read-excel-file/universal";
import { describe, expect, it } from "vitest";
import { checkExcelArchive } from "../data/excelArchive";
import { excelSheetData } from "../data/excelData";
import { chartTableGrid, tableGrid, widgetNode } from "../data/editor";
import type { SceneNode } from "../types";

describe("Excel import", () => {
  it("reads a real workbook and imports the chosen sheet with typed and empty cells", async () => {
    const bytes = await readFile(new URL("./fixtures/two-sheets.xlsx", import.meta.url));
    checkExcelArchive(bytes);
    const sheets = await readXlsxFile(new Blob([new Uint8Array(bytes)]));
    expect(sheets.map((sheet) => sheet.sheet)).toEqual(["设备", "销售"]);
    const devices = excelSheetData(sheets[0]!);
    expect(devices).toEqual({ columns: ["设备", "数值", "启用"], rows: [
      { 设备: "机组 A", 数值: 42.5, 启用: true }, { 设备: "机组 B", 数值: 10, 启用: "" },
    ] });
    const sales = excelSheetData(sheets[1]!);
    expect(sales).toEqual({ columns: ["月份", "销售额"], rows: [{ 月份: "一月", 销售额: 88 }] });
    expect(tableGrid({ ...widgetNode("tableBasic"), data: sales } as SceneNode)).toEqual({ columns: ["月份", "销售额"], rows: [["一月", "88"]] });
    expect(chartTableGrid({ ...widgetNode("table"), data: sales } as SceneNode)).toEqual({ columns: ["月份", "销售额"], rows: [["一月", "88"]] });
    expect(chartTableGrid(widgetNode("table") as SceneNode).columns).toEqual(["名称", "数值"]);
  });

  it("converts dates to stable strings and rejects invalid headers and oversized sheets", () => {
    expect(excelSheetData({ sheet: "S", data: [["时间", "值"], [new Date("2025-01-01T00:00:00.000Z"), 0]] }))
      .toEqual({ columns: ["时间", "值"], rows: [{ 时间: "2025-01-01T00:00:00.000Z", 值: 0 }] });
    for (const headers of [["A", "A"], ["A", ""], ["__proto__"]]) {
      expect(() => excelSheetData({ sheet: "S", data: [headers] })).toThrow(/表头/);
    }
    expect(() => excelSheetData({ sheet: "S", data: Array.from({ length: 5002 }, () => ["A"]) })).toThrow(/5000/);
    expect(() => excelSheetData({ sheet: "S", data: [["A"], [1, 2]] })).toThrow(/列数/);
  });

  it("limits actual decompressed bytes, not just the XLSX file size", () => {
    const archive = zipSync({ "huge.xml": new Uint8Array(20_000_001) });
    expect(archive.byteLength).toBeLessThan(1_000_000);
    expect(() => checkExcelArchive(archive)).toThrow(/解压后/);
    expect(() => checkExcelArchive(new Uint8Array([1, 2, 3]))).toThrow();
  }, 20_000);
});
