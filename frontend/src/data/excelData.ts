import { MAX_DATA_BYTES } from "./dataSources";

export interface ExcelSheet {
  sheet: string;
  data: unknown[][];
}

function excelCell(value: unknown): string | number | boolean {
  if (value == null) return "";
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string" || typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))) return value;
  throw new Error("Excel 包含不支持的单元格值");
}

/** First row supplies field names; empty cells remain empty and typed values stay typed. */
export function excelSheetData(sheet: ExcelSheet): Record<string, unknown> {
  const rows = sheet.data;
  if (!rows.length || rows.length > 5001) throw new Error("Excel 需要表头，且最多支持 5000 行数据");
  if (!Array.isArray(rows[0]) || !rows[0].length || rows[0].length > 256) throw new Error("Excel 表头需要 1 至 256 列");
  const headers = rows[0].map((value) => String(excelCell(value)).trim());
  if (headers.some((key) => !key || ["__proto__", "constructor", "prototype"].includes(key)) || new Set(headers).size !== headers.length) {
    throw new Error("Excel 表头不能为空、重复或使用保留字段");
  }
  if ((rows.length - 1) * headers.length > 200_000) throw new Error("Excel 最多支持 20 万个数据单元格");
  const data = { columns: headers, rows: rows.slice(1).map((cells) => {
    if (!Array.isArray(cells) || cells.length > headers.length) throw new Error("Excel 数据列数超过表头");
    return Object.fromEntries(headers.map((key, index) => [key, excelCell(cells[index])]));
  }) };
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > MAX_DATA_BYTES) throw new Error("导入的数据不能超过 1 MB");
  return data;
}

/** Parse outside the UI thread and terminate pathological or stalled files. */
export async function readExcelWorkbook(file: File): Promise<ExcelSheet[]> {
  if (file.size > MAX_DATA_BYTES) throw new Error("文件不能超过 1 MB");
  const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/excel.worker.ts", import.meta.url), { type: "module" });
    const finish = (error?: Error, sheets?: ExcelSheet[]) => {
      clearTimeout(timeout);
      worker.terminate();
      if (error) reject(error); else resolve(sheets!);
    };
    const timeout = setTimeout(() => finish(new Error("Excel 解析超时，请缩小文件后重试")), 15_000);
    worker.onmessage = (event: MessageEvent<{ sheets?: ExcelSheet[]; error?: string }>) => {
      if (event.data.error || !event.data.sheets?.length) finish(new Error(event.data.error || "Excel 没有工作表"));
      else finish(undefined, event.data.sheets);
    };
    worker.onerror = () => finish(new Error("Excel 解析失败"));
    worker.onmessageerror = () => finish(new Error("Excel 数据读取失败"));
    try { worker.postMessage(buffer, [buffer]); }
    catch { finish(new Error("无法启动 Excel 解析")); }
  });
}
