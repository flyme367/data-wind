import readXlsxFile from "read-excel-file/browser";
import { checkExcelArchive } from "../data/excelArchive";

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    checkExcelArchive(new Uint8Array(event.data));
    const sheets = await readXlsxFile(event.data, { trim: false });
    self.postMessage({ sheets });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Excel 文件格式无效" });
  }
};
