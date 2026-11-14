import { zipSync } from "fflate";
import { modelAssetById } from "../data/modelCatalog";
import { downloadFile, readBoardSize, readEditorSettings, readProjectParams, readScene } from "../state/projects";
import { packageBoardMedia } from "../state/boardMedia";
import type { SceneNode } from "../types";
import { kitAssetPaths } from "../data/kitRuntime";

const TEXT_EXTENSIONS = /\.(?:html|js|mjs|css)$/;
/** JS/CSS 内只继续追踪代码资产；图片类仅允许来自 HTML 引用（favicon 等），避免把素材库缩略图整包拖入 */
const CODE_EXTENSIONS = /\.(?:js|mjs|css|wasm)$/;
const HTML_ASSET_EXTENSIONS = /\.(?:js|mjs|css|wasm|svg|png|jpe?g|webp|gif|ico)$/;
/** 模型库目录不参与通用发现（目录含全部 205 个模型）；场景引用的 mesh 单独按需加入 */
const EXCLUDED_PREFIXES = ["models/", "reference/", "gis/", "kits/"];
const MAX_FILES = 300;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;

const JS_REF_PATTERN = /["'`]([^"'`\s]+?\.(?:js|mjs|css|wasm))["'`]/g;
const HTML_REF_PATTERN = /\b(?:src|href)="([^"]+)"/g;
const CSS_URL_PATTERN = /url\(\s*["']?([^"')]+?)["']?\s*\)/g;

interface BundleResult {
  /** zip 内文件，key 为包内相对路径 */
  files: Record<string, Uint8Array>;
  totalBytes: number;
}

function sameOriginPath(url: URL, base: URL): string | null {
  if (url.origin !== window.location.origin) return null;
  const pathname = decodeURIComponent(url.pathname);
  const prefix = decodeURIComponent(base.pathname);
  const path = (pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname.replace(/^\/+/, ""));
  return path || null;
}

function discoverRefs(text: string, isCss: boolean): string[] {
  const refs: string[] = [];
  for (const pattern of isCss ? [CSS_URL_PATTERN] : [HTML_REF_PATTERN, JS_REF_PATTERN]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) refs.push(match[1]!);
  }
  return refs;
}

/** 从 viewer.html 出发递归收集同源运行时资产（dev 环境引用的是未打包源码，必须先 pnpm build） */
/** 校验响应与扩展名匹配，防止 SPA 回退把 index.html 当 JS 喂进发现队列 */
function contentMatches(path: string, contentType: string | null): boolean {
  const type = (contentType ?? "").toLowerCase();
  if (path.endsWith(".js") || path.endsWith(".mjs")) return type.includes("javascript");
  if (path.endsWith(".css")) return type.includes("text/css");
  if (path.endsWith(".html")) return type.includes("text/html");
  if (path.endsWith(".wasm")) return type.includes("wasm") || type.includes("octet-stream");
  return type !== "" && !type.includes("text/html");
}

async function collectRuntimeAssets(entryHref: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  const visited = new Set<string>();
  const entry = new URL(entryHref, window.location.href);
  const base = new URL(".", entry);
  const queue: { url: URL; isCss: boolean; isHtml: boolean }[] = [{ url: entry, isCss: false, isHtml: true }];
  let total = 0;
  while (queue.length) {
    const { url, isCss, isHtml } = queue.shift()!;
    if (visited.has(url.pathname)) continue;
    visited.add(url.pathname);
    const path = sameOriginPath(url, base);
    if (!path || EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) continue;
    const response = await fetch(url.href);
    if (!response.ok) throw new Error(`${path} 读取失败（${response.status}）`);
    if (!contentMatches(path, response.headers.get("content-type"))) continue;
    const bytes = new Uint8Array(await response.arrayBuffer());
    total += bytes.byteLength;
    if (files.size >= MAX_FILES || total > MAX_TOTAL_BYTES) throw new Error("产物超出打包体积限制");
    files.set(path, bytes);
    if (!TEXT_EXTENSIONS.test(path)) continue;
    const candidates = discoverRefs(new TextDecoder().decode(bytes), isCss);
    for (const ref of candidates) {
      if (ref.startsWith("data:") || ref.startsWith("blob:") || ref.startsWith("#")) continue;
      let resolved: URL;
      try { resolved = new URL(ref, url); } catch { continue; }
      if (resolved.origin !== window.location.origin) continue;
      const allowed = isHtml ? HTML_ASSET_EXTENSIONS : CODE_EXTENSIONS;
      if (!allowed.test(resolved.pathname)) continue;
      queue.push({ url: resolved, isCss: resolved.pathname.endsWith(".css"), isHtml: false });
    }
  }
  return files;
}

async function fetchSceneMeshes(tree: SceneNode[], files: Map<string, Uint8Array>): Promise<void> {
  // Imported and generated shapes already carry their mesh bytes in project.json.
  const modelIds = [...new Set(tree.flatMap((node): string[] => node.modelId && !node.customMesh ? [node.modelId] : []))];
  for (const id of modelIds) {
    const asset = modelAssetById.get(id);
    if (!asset) throw new Error(`场景引用的模型不在素材库中：${id}`);
    const path = asset.mesh.replace(/^\/+/, "");
    if (files.has(path)) continue;
    const response = await fetch(new URL(path, window.location.href));
    if (!response.ok) throw new Error(`模型 ${asset.name} 读取失败（${response.status}）`);
    files.set(path, new Uint8Array(await response.arrayBuffer()));
  }
}

async function fetchMapData(tree: SceneNode[], files: Map<string, Uint8Array>): Promise<void> {
  if (!tree.some((node) => node.widget && ["mapRegion", "mapPoint", "mapFlyline"].includes(node.widget.kind))) return;
  const path = "gis/ne_110m_admin_0_countries.geojson";
  const response = await fetch(new URL(path, window.location.href));
  if (!response.ok) throw new Error(`地图边界数据读取失败（${response.status}）`);
  files.set(path, new Uint8Array(await response.arrayBuffer()));
}

const README_TEXT = `xx可视化 · 发布包
==================

内容
- index.html    发布成品入口（只含渲染运行时，不含编辑器与 UI 框架）
- project.json  本项目的场景数据
- assets/       运行时代码与 WASM 引擎
- models/       场景引用的模型文件
- media/        看板背景图片、视频和音乐文件

使用
1. 将全部文件按原目录结构上传到任意静态文件服务器。
2. 访问 index.html 即可全屏查看成品，无需任何服务端逻辑。

说明
- 项目数据随包分发（project.json），不再依赖浏览器本地存储。
- 成品支持交互规则：点击对象弹出消息、聚焦视角、显示/隐藏、换色。
- 普通静态服务器自动使用单线程兼容引擎。
- 启用 Rayon 多线程需要 HTTPS（或 localhost），且静态服务器额外返回
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  两个响应头；浏览器不支持共享内存或线程池初始化失败时自动回退。
`;

/**
 * 构建可分发的发布包：viewer 运行时（递归收集的同源资产 + 场景引用的模型）+ project.json。
 * 成品页在包内改名 index.html，默认读取同目录 project.json。
 */
export async function buildPublishBundle(projectId: string, projectName: string, includeWeatherKeys = false): Promise<BundleResult> {
  if (import.meta.env.DEV) {
    throw new Error("发布包导出需要在生产构建中使用：先 pnpm build 并部署 dist，再从部署站点导出");
  }
  const tree = readScene(projectId);
  if (!tree) throw new Error("项目场景不存在，可能已被删除");
  const media = await packageBoardMedia(readEditorSettings(projectId));

  const files = await collectRuntimeAssets("viewer.html");
  await fetchSceneMeshes(tree, files);
  await fetchMapData(tree, files);
  for (const path of kitAssetPaths(tree)) {
    const response = await fetch(new URL(path, window.location.href));
    if (!response.ok) throw new Error(`套件资源读取失败（${response.status}）：${path}`);
    files.set(path, new Uint8Array(await response.arrayBuffer()));
  }

  const viewerHtml = files.get("viewer.html");
  if (!viewerHtml) throw new Error("viewer.html 读取失败");
  files.delete("viewer.html");
  const projectJson = new TextEncoder().encode(JSON.stringify({
    format: "data-wind", version: 2, name: projectName,
    scene: tree, settings: media.settings, params: readProjectParams(projectId), boardSize: readBoardSize(projectId),
  }, includeWeatherKeys ? undefined : (key, value: unknown) => key === "map-key" ? [""] : value, 2));

  const bundle: Record<string, Uint8Array> = {
    "index.html": viewerHtml,
    "project.json": projectJson,
    "README.txt": new TextEncoder().encode(README_TEXT),
  };
  for (const [path, bytes] of files) bundle[path] = bytes;
  for (const [path, bytes] of Object.entries(media.files)) bundle[path] = bytes;
  const totalBytes = Object.values(bundle).reduce((sum, bytes) => sum + bytes.byteLength, 0);
  return { files: bundle, totalBytes };
}

/** 打包并触发下载（发布包 zip） */
export async function exportPublishBundle(projectId: string, projectName: string, includeWeatherKeys = false): Promise<void> {
  const { files } = await buildPublishBundle(projectId, projectName, includeWeatherKeys);
  const zipped = zipSync(files);
  downloadFile(`${projectName}-发布包.zip`, zipped, "application/zip");
}
