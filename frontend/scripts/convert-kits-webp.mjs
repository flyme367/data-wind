// 一次性迁移（2026-11-14）：kits assets/thumbs 的 png/jpg 全部转为 webp 最小压缩，
// 模板与目录清单里的引用同步重写。文件名保留原内容哈希、只换扩展名。
// 编码规范走 lib-webp.mjs（q60 -m 6，有损/无损取小者）；此后新产图脚本必须直接产 webp。
import { readdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeMinWebp } from "./lib-webp.mjs";

const scripts = dirname(fileURLToPath(import.meta.url));
const kits = join(scripts, "..", "public", "kits");
const catalog = join(scripts, "..", "src", "data", "referenceKits.json");
const CONCURRENCY = 4;
const IMAGE_EXT = /\.(png|jpe?g)$/i;

const listImages = async dir => (await readdir(dir))
  .filter(name => IMAGE_EXT.test(name))
  .map(name => join(dir, name));

// web 引用路径形如 /kits/assets/<hash>.png，与模板 JSON 内的写法完全一致。
const webPath = path => `/${relative(kits, path).split("\\").join("/")}`;

const runPool = async (items, worker) => {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  });
  await Promise.all(runners);
};

const convert = async paths => {
  const mapping = [], failures = [];
  let before = 0, after = 0, done = 0;
  await runPool(paths, async path => {
    try {
      const original = await readFile(path);
      const webp = await encodeMinWebp(original);
      if (!webp.length) throw new Error("empty webp output");
      const target = path.replace(IMAGE_EXT, ".webp");
      await writeFile(target, webp);
      await rm(path);
      const size = await stat(target);
      before += original.length;
      after += size.size;
      mapping.push([webPath(path), webPath(target)]);
    } catch (error) {
      failures.push([path, error.message]);
    }
    done += 1;
    if (done % 50 === 0 || done === paths.length) {
      console.log(`converted ${done}/${paths.length}; failures=${failures.length}; ` +
        `${(before / 1048576).toFixed(1)}MB -> ${(after / 1048576).toFixed(1)}MB`);
    }
  });
  return { mapping, failures, before, after };
};

const rewriteReferences = async (mapping, files) => {
  if (!mapping.length) return;
  // 按旧文件全名做精确字符串替换（哈希名唯一，替换无歧义）；长名优先避免前缀覆盖。
  const ordered = [...mapping].sort((a, b) => b[0].length - a[0].length);
  for (const file of files) {
    let text = await readFile(file, "utf8");
    for (const [from, to] of ordered) text = text.split(from).join(to);
    await writeFile(file, text);
  }
};

const main = async () => {
  const limit = Number((process.argv.find(arg => arg.startsWith("--limit=")) ?? "").split("=")[1]) || Infinity;
  const assets = await listImages(join(kits, "assets")).then(paths => paths.slice(0, limit));
  const thumbs = await listImages(join(kits, "thumbs")).then(paths => paths.slice(0, limit));
  console.log(`migrating ${assets.length} assets + ${thumbs.length} thumbs to webp`);
  const { mapping, failures, before, after } = await convert([...assets, ...thumbs]);
  const templates = (await readdir(join(kits, "templates")))
    .filter(name => name.endsWith(".json")).map(name => join(kits, "templates", name));
  await rewriteReferences(mapping, [...templates, catalog]);
  for (const [path, error] of failures) console.error(`FAILED ${path}: ${error}`);
  console.log(`done: ${mapping.length} converted, ${failures.length} failures; ` +
    `${(before / 1048576).toFixed(1)}MB -> ${(after / 1048576).toFixed(1)}MB ` +
    `(${before ? Math.round((1 - after / before) * 100) : 0}% smaller)`);
};

main().catch(error => { console.error(error); process.exit(1); });
