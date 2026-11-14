// 素材卡片缩略图产图：山海鲸「地图」分类 16 项 → 自家主题渲染 → headless Chrome 截图 → webp q60。
// 运行：node --experimental-websocket scripts/generate-map-thumbs.mjs（Node ≥22 可省 flag）。
// 约定：全项目图片必须 webp q60 取最小（lib-webp.mjs），本脚本不直写 png/jpg 产物（PNG 只落临时目录）。
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { encodeMinWebp } from "./lib-webp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8391;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// 1. 微型打包：mapCatalog/mapSvg/editor 均为纯数据 TS 模块，transpileModule → CJS 注册表
//    （esbuild 不在依赖树内，TypeScript 是现有 devDependency，产图脚本零新增依赖）。
const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const resolveModule = (from, spec) => {
  if (!spec.startsWith(".")) throw new Error(`产图入口只允许相对导入，遇到 ${spec}`);
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`]) {
    if (existsSync(candidate) && !existsSync(join(candidate, "package.json"))) return candidate;
  }
  throw new Error(`cannot resolve ${spec} from ${from}`);
};

function collectModules(entryFile, files = new Map()) {
  if (files.has(entryFile)) return files;
  const source = readFileSync(entryFile, "utf8");
  files.set(entryFile, transpile(source));
  for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
    collectModules(resolveModule(entryFile, match[1]), files);
  }
  return files;
}

const entry = resolve(root, "scripts/map-thumbs-entry.ts");
const modules = collectModules(entry);
const pageScript = `
const __sources = ${JSON.stringify(Object.fromEntries(modules))};
const __cache = new Map();
function __load(file) {
  if (__cache.has(file)) return __cache.get(file).exports;
  const module = { exports: {} };
  __cache.set(file, module);
  const requireFrom = (spec) => {
    const base = new URL(spec, "file://" + file).pathname;
    for (const candidate of [base, base + ".ts"]) {
      if (__sources[candidate]) return __load(candidate);
    }
    throw new Error("module not found: " + spec + " from " + file);
  };
  new Function("exports", "require", "module", __sources[file])(module.exports, requireFrom, module);
  return module.exports;
}
__load(${JSON.stringify(entry)});
`;

// 2. 本地服务：页面 + /gis 地理数据（fetch 相对路径按原样工作）
const publicDir = resolve(root, "public");
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #0b0e13; display: inline-block; }
  .thumb { width: 640px; height: 320px; display: block; }
</style></head><body><script src="/thumbs-bundle.js"></script></body></html>`;
const server = createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/thumbs-bundle.js") {
    response.writeHead(200, { "content-type": "text/javascript" });
    response.end(pageScript);
    return;
  }
  if (url.pathname === "/thumbs.html") {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(html);
    return;
  }
  const file = join(publicDir, decodeURIComponent(url.pathname));
  try {
    response.writeHead(200, { "content-type": url.pathname.endsWith(".geojson") ? "application/json" : "text/plain" });
    response.end(readFileSync(file));
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
});
await new Promise((resolvePort) => server.listen(PORT, "127.0.0.1", resolvePort));

// 3. headless Chrome + 裸 CDP（复用视觉验证工作流：headless=new 即可，地图是 2D SVG）
const userData = mkdtempSync(join(tmpdir(), "dw-map-thumbs-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=9223`, `--user-data-dir=${userData}`,
  "--no-first-run", "--disable-gpu", "--window-size=720,5400", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets = null;
for (let attempt = 0; attempt < 40 && !targets; attempt += 1) {
  await sleep(250);
  try {
    targets = await (await fetch("http://127.0.0.1:9223/json")).json();
  } catch { /* chrome not ready yet */ }
}
if (!targets) throw new Error("headless Chrome 启动失败");
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolveWs, rejectWs) => { ws.onopen = resolveWs; ws.onerror = rejectWs; });

let messageId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
};
const cdp = (method, params = {}) => new Promise((resolveCdp) => {
  messageId += 1;
  pending.set(messageId, resolveCdp);
  ws.send(JSON.stringify({ id: messageId, method, params }));
});
const evaluate = async (expression) => {
  const reply = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (reply.result?.exceptionDetails) throw new Error(expression + " → " + JSON.stringify(reply.result.exceptionDetails.exception?.description ?? "page error"));
  return reply.result?.result?.value;
};

await cdp("Page.enable");
await cdp("Page.navigate", { url: `http://127.0.0.1:${PORT}/thumbs.html` });
await sleep(1200);
const ready = await evaluate("document.title");
if (ready !== "thumbs-ready") throw new Error("产图页面渲染失败: " + ready);
await evaluate("document.fonts.ready.then(() => undefined)");

// 4. 逐卡截图（scale 2 保清晰度）→ webp q60
const tmp = mkdtempSync(join(tmpdir(), "dw-map-thumbs-out-"));
const outDir = resolve(root, "public/reference");
const cards = await evaluate(`Array.from(document.querySelectorAll('.thumb')).map((el) => {
  const r = el.getBoundingClientRect();
  return { id: el.id, label: el.dataset.label, image: el.dataset.image, x: r.x, y: r.y + window.scrollY, w: r.width, h: r.height };
})`);
for (const card of cards) {
  const shot = await cdp("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: card.x, y: card.y, width: card.w, height: card.h, scale: 2 },
  });
  const png = Buffer.from(shot.result.data, "base64");
  // 文件名与 mapCatalog entry.image 严格对齐（/reference/map-xxx.webp → map-xxx.webp）
  const name = card.image.split("/").pop();
  const bytes = await encodeMinWebp(png);
  writeFileSync(join(outDir, name), bytes);
  console.log(`${name}  ${(bytes.length / 1024).toFixed(1)}KB  ← ${card.label}`);
}

// 5. 清理
ws.close();
chrome.kill();
server.close();
rmSync(tmp, { recursive: true, force: true });
rmSync(userData, { recursive: true, force: true });
console.log("缩略图产图完成 → public/reference/");
