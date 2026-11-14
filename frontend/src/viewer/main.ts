import "../styles/board.css";
import "./viewer.css";
import { loadProjects, parseProjectFile, readBoardSize, readEditorSettings, readProjectParams, readScene } from "../state/projects";
import { initProjectStore } from "../state/projectStore";
import { restoreBoardMedia } from "../state/boardMedia";
import { startViewer } from "./runtime";

/** ?projectId=… 读本地工作区；兼容 #/?projectId=… hash 形式 */
function projectIdFromUrl(): string | null {
  const fromSearch = new URLSearchParams(window.location.search).get("projectId");
  if (fromSearch) return fromSearch;
  const query = window.location.hash.split("?")[1];
  return query ? new URLSearchParams(query).get("projectId") : null;
}

/** ?src=<url> 指定项目 JSON；未指定时默认读取同目录 project.json（发布包布局） */
function srcFromUrl(): string | null {
  const fromSearch = new URLSearchParams(window.location.search).get("src");
  if (fromSearch) return fromSearch;
  const query = window.location.hash.split("?")[1];
  return query ? new URLSearchParams(query).get("src") : null;
}

function renderFatal(root: HTMLElement, title: string, detail: string): void {
  document.title = "xx可视化";
  const page = document.createElement("div");
  page.className = "viewer-fatal";
  const heading = document.createElement("h1");
  heading.textContent = title;
  const message = document.createElement("p");
  message.textContent = detail;
  const link = document.createElement("a");
  link.href = "/";
  link.textContent = "返回编辑器";
  page.append(heading, message, link);
  root.replaceChildren(page);
}

async function startFromProjectFile(root: HTMLElement, raw: string, source: string, projectId: string): Promise<void> {
  try {
    // 发布包默认布局（./project.json）自带同代资产， kits 图片路径不迁移；
    // ?src= 指向的外部 JSON 按部署站点现状迁移旧 png/jpg 引用。
    const data = parseProjectFile(raw, { migrateKitImages: source !== "./project.json" });
    const settings = await restoreBoardMedia(data.settings, data.boardMedia);
    document.title = `${data.name} · xx可视化`;
    startViewer({
      projectId,
      projectName: data.name,
      tree: data.scene,
      settings,
      params: data.params,
      boardSize: data.boardSize ?? { width: 1920, height: 1080 },
    }, root);
  } catch (error) {
    renderFatal(root, "项目数据无效", error instanceof Error ? error.message : `无法解析 ${source}。`);
  }
}

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) return;

  const projectId = projectIdFromUrl();
  if (projectId) {
    await initProjectStore().catch(error => console.warn("[projectStore] 初始化失败，回退 localStorage", error));
    const meta = loadProjects().find((project) => project.id === projectId);
    let tree;
    try {
      tree = readScene(projectId);
    } catch (error) {
      renderFatal(root, "场景数据无效", error instanceof Error ? error.message : "保存的场景数据无法解析。");
      return;
    }
    if (!tree) {
      renderFatal(root, "项目不存在", "本地工作区中没有找到该项目，可能已被删除。");
      return;
    }
    document.title = `${meta?.name ?? "未命名项目"} · xx可视化`;
    startViewer({
      projectId,
      projectName: meta?.name ?? "未命名项目",
      tree,
      settings: readEditorSettings(projectId),
      params: readProjectParams(projectId),
      boardSize: readBoardSize(projectId),
      template: meta?.template,
    }, root);
    return;
  }

  // 发布包模式：读取随包分发的 project.json（或 ?src= 指定的 JSON 地址）
  const source = srcFromUrl() ?? "./project.json";
  try {
    const response = await fetch(source);
    if (!response.ok) {
      renderFatal(root, "未找到项目数据",
        `缺少 projectId 参数，且 ${source} 读取失败（${response.status}）。请从编辑器「打开发布页」进入，或使用导出的发布包。`);
      return;
    }
    await startFromProjectFile(root, await response.text(), source, `file:${source}`);
  } catch (error) {
    renderFatal(root, "项目数据读取失败", error instanceof Error ? error.message : `无法请求 ${source}。`);
  }
}

void boot();
