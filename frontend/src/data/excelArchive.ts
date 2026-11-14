import { Unzip, UnzipInflate } from "fflate";
import { MAX_DATA_BYTES } from "./dataSources";

/** Check actual decompressed bytes before handing an XLSX archive to the parser. */
export function checkExcelArchive(bytes: Uint8Array): void {
  if (bytes.byteLength > MAX_DATA_BYTES) throw new Error("文件不能超过 1 MB");
  let entries = 0, expanded = 0;
  const unzip = new Unzip((file) => {
    entries += 1;
    if (entries > 1000) throw new Error("Excel 文件包含过多内部文件");
    file.ondata = (error, chunk) => {
      if (error) throw error;
      expanded += chunk.byteLength;
      if (expanded > 20_000_000) throw new Error("Excel 解压后不能超过 20 MB");
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
  }
  if (!entries) throw new Error("Excel 文件格式无效");
}
