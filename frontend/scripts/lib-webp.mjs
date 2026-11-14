// 项目图片统一 webp 最小压缩（2026-11-05 全量迁移后的常驻约定）：
// 有损 q60 与无损各转一次取更小者，cwebp -m 6 最大压缩强度；解码用 dwebp。
import { execFile } from "node:child_process";
import { readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = (cmd, args) => new Promise((resolve, reject) =>
  execFile(cmd, args, error => error ? reject(new Error(`${cmd} failed: ${error.message}`)) : resolve()));

const scratch = stem => join(tmpdir(), `${stem}-${process.pid}-${Math.random().toString(36).slice(2)}`);
const cleanup = paths => Promise.all(paths.map(path => rm(path, { force: true }).catch(() => {})));

/** PNG 字节 → 最小体积 webp 字节。 */
export async function encodeMinWebp(png) {
  const base = scratch("dw-webp"), src = `${base}.png`;
  const lossy = `${base}.webp`, lossless = `${base}-l.webp`;
  await writeFile(src, png);
  try {
    await run("cwebp", ["-q", "60", "-m", "6", "-quiet", src, "-o", lossy]);
    let losslessBytes = null;
    try {
      await run("cwebp", ["-q", "60", "-m", "6", "-lossless", "-quiet", src, "-o", lossless]);
      losslessBytes = await readFile(lossless);
    } catch { /* 小图无损偶尔更大，失败时直接用有损 */ }
    const lossyBytes = await readFile(lossy);
    return losslessBytes && losslessBytes.length < lossyBytes.length ? losslessBytes : lossyBytes;
  } finally { await cleanup([src, lossy, lossless]); }
}

/** 在 path 处写入最小压缩 webp。 */
export async function writeMinWebp(path, png) { await writeFile(path, await encodeMinWebp(png)); }

/** webp 字节 → PNG 文件字节（供 pngjs 等消费）。 */
export async function decodeWebp(webp) {
  const base = scratch("dw-dwebp"), src = `${base}.webp`, out = `${base}.png`;
  await writeFile(src, webp);
  try { await run("dwebp", ["-quiet", src, "-o", out]); return readFile(out); }
  finally { await cleanup([src, out]); }
}

/** 无扩展名路径读源图：webp 优先（dwebp 解码为 PNG 字节），兼容遗留 png 直读。 */
export async function readImagePng(stem) {
  try { return await decodeWebp(await readFile(`${stem}.webp`)); }
  catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return readFile(`${stem}.png`);
  }
}
