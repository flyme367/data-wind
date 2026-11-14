import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Notification, Toast } from "@/lib/toast";
import { AllApplication, ApplicationMenu, ChartHistogram, Cube, CubeThree, Earth, Edit, FolderOpen, FullScreen, Keyboard, Layers, MapTwo, Monitor, Paint, Play,
  Plus, Refresh, Search, Terminal, Text, VideoTwo, ViewGridList, Viewfinder } from "@icon-park/react";
import { Shirt, TriangleAlert } from "lucide-react";
import { AssetFamilyStrip, BoardAssetLibrary, BoardOverlay, ComponentPalette, insertKitEntry, KIT_MIME, WIDGET_MIME } from "../components/BoardComponents";
import { kitCatalog } from "../data/kitCatalog";
import { boardAssetCounts } from "../data/boardAssetCounts";
import { readUserAssets } from "../state/userAssets";
import { LiveDataManager } from "../data/liveData";
import { triggerDataEdge } from "../data/interactionEdges";
import { interactionConditionMatches, runBoardInteractions, runDataInteractions, runInteractions, copySelection, pasteSelection, duplicateSelection, deleteSelection, selectAll, focusSelection, selection } from "../state/sceneActions";
import TopMenuBar, { saveCurrentScene } from "../components/TopMenuBar";
import Viewport from "../components/Viewport";
import TourBar from "../components/TourBar";
import PropertiesPanel from "../components/PropertiesPanel";
import BoardBackground from "../components/BoardBackground";
import BoardStatusBar from "../components/BoardStatusBar";
import EditorBootSkeleton from "../components/EditorBootSkeleton";
import DebugConsole from "../components/DebugConsole";
import SceneContextMenuHost from "../components/SceneContextMenuHost";
import { SceneTreePanel } from "../components/LeftPanel";
import AssetLibraryPanel from "../components/AssetLibraryPanel";
import { getState, useStore, setState } from "../state/store";
import { openSceneContextMenu } from "../state/contextMenu";
import type { SceneNode } from "../types";
import { getSceneBridge, type SceneSnapshot } from "../workers/bridge";
import { loadProjects, saveProjects, persistBoardSize, persistScene, readBoardSize, readScene, readEditorSettings, readProjectParams, persistEditorSettings, hasStoredBoardPages } from "../state/projects";
import { readSnapshotBytes } from "../state/projectStore";
import { saveBoardMedia } from "../state/boardMedia";
import { BACKGROUND_BOARD_PAGE_ID, FOREGROUND_BOARD_PAGE_ID, defaultEditorSettings } from "../data/editor";
import { runtimeFlat } from "../data/runtimeScene";

const railIcon = { theme: "two-tone", fill: ["currentColor", "#333333"] } satisfies { theme: "two-tone"; fill: string[] };

const modelCategories = [
  { label: "全部", icon: <AllApplication {...railIcon} /> }, { label: "模型", icon: <CubeThree {...railIcon} /> },
  { label: "GIS", icon: <Earth {...railIcon} /> }, { label: "地表", icon: <MapTwo {...railIcon} /> },
  { label: "标绘", icon: <Edit {...railIcon} /> }, { label: "材质", icon: <Paint {...railIcon} /> },
  { label: "动效", icon: <Play {...railIcon} /> }, { label: "场景", icon: <Viewfinder {...railIcon} /> },
];

const boardCategories = [
  { label: "全部", icon: <AllApplication {...railIcon} /> }, { label: "图表", icon: <ChartHistogram {...railIcon} /> },
  { label: "文本", icon: <Text {...railIcon} /> }, { label: "媒体", icon: <VideoTwo {...railIcon} /> },
  { label: "控件", icon: <ViewGridList {...railIcon} /> }, { label: "地图", icon: <Earth {...railIcon} /> },
  { label: "3D", icon: <Cube {...railIcon} /> }, { label: "拓扑", icon: <ApplicationMenu {...railIcon} /> },
  { label: "套件", icon: <Shirt size={18} fill="currentColor" strokeWidth={1} /> },
];

type BoardResizeEdge = "n" | "e" | "s" | "w";
interface BoardResizeDrag {
  edge: BoardResizeEdge;
  pointerId: number;
  startX: number;
  startY: number;
  width: number;
  height: number;
  scale: number;
  handle: HTMLButtonElement;
}

/** 山海鲸 4.7.13 快捷键列表全表（底栏快捷键按钮上方浮层，逐项实测抄录；macOS 亦显示 Ctrl） */
const shortcutItems: [string, string][] = [
  ["新建子看板", "Ctrl + N"], ["保存项目(S)", "Ctrl + S"], ["另存为(Shift + S)", "Ctrl + Shift + S"],
  ["项目重命名(R)", "Ctrl + R"], ["项目设置(P)", "Ctrl + P"], ["编辑数据(D)", "Ctrl + D"],
  ["刷新数据", "Ctrl + F5"], ["搜索并添加组件(F)", "Ctrl + F"], ["撤销(Z)", "Ctrl + Z"],
  ["恢复(Y)", "Ctrl + Y / Ctrl + Shift + Z"], ["复制(C)", "Ctrl + C"], ["粘贴(V)", "Ctrl + V"],
  ["删除", "Delete / Backspace"], ["全选(A)", "Ctrl + A"], ["放大缩小", "Ctrl + 滚轮"],
  ["创建分组", "Ctrl + G"], ["取消分组", "Ctrl + Shift + G"], ["隐藏/显示辅助线", "Ctrl + ;"],
  ["锁定/解锁辅助线", "Ctrl + Alt + ;"], ["显示/隐藏选中项", "Ctrl + Shift + H"], ["锁定/解除锁定图层", "Ctrl + Shift + L"],
];

export default function WorkspacePage({ projectId }: { projectId: string }) {
  const state = useStore();
  const [projectName,setProjectName] = useState(() => loadProjects().find((p) => p.id === projectId)?.name ?? "未命名项目");
  const [snapshot, setSnapshot] = useState<SceneSnapshot | null>(null);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(() => new URLSearchParams(location.hash.split("?")[1]).get("preview") === "1");
  const [boardSelected, setBoardSelected] = useState(false);
  // 图层树根节点选中（@board 看板设置 / @scene 场景设置）：右侧面板为固定列，选中根节点时内容切到根设置
  const [rootNodeId, setRootNodeId] = useState<"@board" | "@scene" | null>(null);
  const [assetCategory, setAssetCategory] = useState<string | null>(null);
  // 看板素材面板（山海鲸式）：深/浅色与资产库 tab、rail 搜索词、chips 联动、缩略图刷新
  const [assetTab, setAssetTab] = useState<"dark" | "light" | "asset">("dark");
  const [assetQuery, setAssetQuery] = useState("");
  const [assetChip, setAssetChip] = useState("全部");
  const [kitFamilyId, setKitFamilyId] = useState("free");
  const [refreshKey, setRefreshKey] = useState(0);
  const [assetSearchFocusTick, setAssetSearchFocusTick] = useState(0);
  useEffect(() => setAssetChip("全部"), [assetCategory, assetTab]);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [libraryExpanded, setLibraryExpanded] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [fit, setFit] = useState(true);
  const [pageDialog, setPageDialog] = useState(false);
  const [pageNameDraft, setPageNameDraft] = useState("");
  // 重命名目标页签：null=当前活动子看板（树根菜单入口），否则为底栏页签右键指定的页面
  const [renamePageId, setRenamePageId] = useState<string | null>(null);
  const [pageTransition, setPageTransition] = useState(0);
  const [shortcuts, setShortcuts] = useState(false);
  // 山海鲸「删除提醒」：底栏页签 ✕/右键删除的统一确认弹窗（勾选不再提示后直接删除）
  const [deleteDialog, setDeleteDialog] = useState<{ kind: "page"; id: string; name: string } | { kind: "foreground" } | { kind: "background" } | null>(null);
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(() => localStorage.getItem("dw_board_delete_confirm_skip") === "1");
  // 山海鲸式缩放自由输入框（钳制 10%–500%；拟合态显示实际比例两位小数）
  const [zoomDraft, setZoomDraft] = useState("100%");
  const zoomInputFocused = useRef(false);
  const [debugConsoleOpen, setDebugConsoleOpen] = useState(false);
  const [bootHiding, setBootHiding] = useState(false);
  const [bootGone, setBootGone] = useState(false);
  const bootStartRef = useRef(performance.now());
  const stageRef = useRef<HTMLDivElement>(null);
  const stageAreaRef = useRef<HTMLDivElement>(null);
  const boardResize = useRef<BoardResizeDrag | null>(null);
  const gestureZoomStart = useRef(100);
  const gestureZoomActive = useRef(false);
  const zoomState = useRef({ fit, zoom, preview, editing, actualZoom: 100 });
  const backgroundFileRef = useRef<HTMLInputElement>(null);
  const dataManager = useRef<LiveDataManager | null>(null);
  const sharedDataIds = useRef(new Set<string>());
  const dataRuleMatches = useRef(new Map<string, boolean>());
  const [stageWidth, setStageWidth] = useState(900);
  const [stageHeight,setStageHeight] = useState(680);
  useEffect(() => { if (preview || editing) setBoardSelected(false); }, [preview, editing]);
  // 编辑态提示：顶部居中常驻浮层（Toaster 已在 App 根挂载，top-center offset 48），替代原顶部整条提示栏
  useEffect(() => {
    if (!editing || preview) return;
    Notification.open({
      id: "dw-editing-notice",
      duration: 0,
      content: (<span className="editing-notice-hint">进入编辑状态会自动隐藏其他组件图层，双击空白区域退出编辑状态
        <Button size="sm" variant="destructive" onClick={() => setEditing(false)}>退出编辑</Button></span>) as unknown as string,
    });
    return () => { Notification.close("dw-editing-notice"); };
  }, [editing, preview]);
  useEffect(() => { if (state.selectedIds.length) setBoardSelected(false); }, [state.selectedIds]);
  useEffect(() => { setBoardSelected(false); }, [state.settings.boardActivePageId, state.boardLayer]);
  // 真实节点选中（树点/画布点选/全选）与切换子大屏都会让根设置让位；取消选中后回落到当前模式根设置
  useEffect(() => { if (state.selectedId || state.selectedIds.length) setRootNodeId(null); }, [state.selectedId, state.selectedIds.length]);
  useEffect(() => { setRootNodeId(null); }, [state.settings.boardActivePageId, state.boardLayer]);
  const categories=editing?modelCategories:boardCategories;
  // 图层树根节点/右键「设置」入口：面板切到看板/场景设置，并清空画布选择
  const openRoot = (id: "@board" | "@scene") => { setRootNodeId(id); setBoardSelected(false); getSceneBridge().post({ type: "select", id: null }); };
  const changeEditing=(value:boolean)=>{setEditing(value);setBoardSelected(false);setAssetCategory(null);setRootNodeId(value?"@scene":"@board");getSceneBridge().post({type:"select",id:null})};
  const activePage = state.settings.boardPages.find((page) => page.id === state.settings.boardActivePageId) ?? state.settings.boardPages[0]!;
  const backgroundPage = state.settings.boardBackgroundPage;
  const showSharedBackground = preview || state.boardLayer === "page";
  const canvasSettings = !preview && state.boardLayer === "background"
    ? { ...state.settings, ...backgroundPage.style }
    : !preview && state.boardLayer === "foreground" && state.settings.boardForegroundPage
      ? { ...state.settings, ...state.settings.boardForegroundPage.style } : state.settings;
  const canvasBackgroundColor = canvasSettings.boardBackgroundEnabled ? canvasSettings.boardColor
    : showSharedBackground && backgroundPage.style.boardBackgroundEnabled ? backgroundPage.style.boardColor : "transparent";
  const pageStyle = (settings: typeof state.settings) => ({
    boardColor: settings.boardColor, boardFillColor: settings.boardFillColor, boardFit: settings.boardFit, boardBackgroundEnabled: settings.boardBackgroundEnabled,
    boardBackgroundMediaId: settings.boardBackgroundMediaId, boardBackgroundMediaName: settings.boardBackgroundMediaName,
    boardBackgroundFill: settings.boardBackgroundFill, boardBackgroundBlur: settings.boardBackgroundBlur,
    boardMusicEnabled: settings.boardMusicEnabled, boardMusicId: settings.boardMusicId,
    boardMusicName: settings.boardMusicName, boardMusicVolume: settings.boardMusicVolume,
  });
  const activateBoardPage = (pageId: string, animate = false) => {
    const current = getState();
    const page = current.settings.boardPages.find((item) => item.id === pageId);
    if (!page) return;
    if (page.id === current.settings.boardActivePageId && current.boardLayer === "page") {
      setEditing(false);
      setAssetCategory(null);
      return;
    }
    getSceneBridge().post({ type: "configure", patch: { boardActivePageId: page.id, boardActiveStateId: "",
      ...page.style, boardDefaultState: { ...current.settings.boardDefaultState, ...page.style } } });
    setState({ boardLayer: "page", boardSize: { width: page.width, height: page.height }, selectedId: null, selectedIds: [] });
    getSceneBridge().post({ type: "select", id: null });
    setEditing(false);
    setAssetCategory(null);
    if (animate) {
      setPageTransition(0);
      requestAnimationFrame(() => setPageTransition((value) => value + 1));
    }
  };
  const activateBackgroundBoard = () => {
    const current = getState();
    setState({ boardLayer: "background", boardSize: { width: current.settings.boardBackgroundPage.width,
      height: current.settings.boardBackgroundPage.height }, selectedId: null, selectedIds: [] });
    getSceneBridge().post({ type: "select", id: null });
    setEditing(false);
    setAssetCategory(null);
  };
  // 山海鲸底栏「前景 ⊕」：未创建时点击即创建空前景看板并进入；已创建则直接切换编辑表面
  const activateForegroundBoard = () => {
    const current = getState();
    let page = current.settings.boardForegroundPage;
    if (!page) {
      page = { id: FOREGROUND_BOARD_PAGE_ID, name: "前景看板", width: current.boardSize.width,
        height: current.boardSize.height, style: pageStyle(current.settings) };
      getSceneBridge().post({ type: "configure", patch: { boardForegroundPage: page } });
    }
    setState({ boardLayer: "foreground", boardSize: { width: page.width, height: page.height }, selectedId: null, selectedIds: [] });
    getSceneBridge().post({ type: "select", id: null });
    setEditing(false);
    setAssetCategory(null);
  };
  const createBoardPage = (duplicateCurrent = false) => {
    const current = getState();
    if (current.settings.boardPages.length >= 12) { Toast.info("最多添加 12 个子看板"); return; }
    const id = crypto.randomUUID();
    const sourcePage = current.settings.boardPages.find((item) => item.id === current.settings.boardActivePageId) ?? current.settings.boardPages[0]!;
    const page = { id, name: `子看板${current.settings.boardPages.length + 1}`,
      width: current.boardLayer === "background" ? sourcePage.width : current.boardSize.width,
      height: current.boardLayer === "background" ? sourcePage.height : current.boardSize.height, style: pageStyle(current.settings),
      ...(duplicateCurrent ? { cover: current.settings.boardPages.find((item) => item.id === current.settings.boardActivePageId)?.cover } : {}) };
    const pages = [...current.settings.boardPages, page];
    const tree = duplicateCurrent ? (() => {
      const widgets = current.scene.filter((node) => node.type === "widget" && node.boardPageId === current.settings.boardActivePageId);
      const ids = new Map(widgets.map((node) => [node.id, crypto.randomUUID()]));
      const copies = widgets.map((node) => ({ ...structuredClone(node), id: ids.get(node.id)!, boardPageId: id,
        parentId: node.parentId ? ids.get(node.parentId) ?? node.parentId : null,
        interactions: node.interactions?.map((rule) => ({ ...rule, id: crypto.randomUUID(),
          targetId: ids.get(rule.targetId) ?? rule.targetId })) }));
      return [...current.scene, ...copies];
    })() : current.scene;
    getSceneBridge().post({ type: "loadScene", tree, settings: { ...current.settings, boardPages: pages,
      boardActivePageId: id, boardActiveStateId: "", ...page.style,
      boardDefaultState: { ...current.settings.boardDefaultState, ...page.style } } });
    setState({ boardLayer: "page", boardSize: { width: page.width, height: page.height }, selectedId: null, selectedIds: [] });
    setEditing(false);
    setAssetCategory(null);
  };
  const openPageRename = (pageId?: string) => {
    const current = getState();
    const target = current.settings.boardPages.find((page) => page.id === (pageId ?? current.settings.boardActivePageId));
    if (!target) return;
    setRenamePageId(pageId ?? null);
    setPageNameDraft(target.name);
    setPageDialog(true);
  };
  const renameActiveBoardPage = () => {
    const current = getState();
    const targetId = renamePageId ?? current.settings.boardActivePageId;
    if (!pageNameDraft.trim()) return;
    getSceneBridge().post({ type: "configure", patch: { boardPages: current.settings.boardPages.map((page) =>
      page.id === targetId ? { ...page, name: pageNameDraft.trim().slice(0, 100) } : page) } });
    setPageDialog(false);
  };
  const deleteBoardPage = (pageId: string) => {
    const current = getState();
    if (current.settings.boardPages.length <= 1) { Toast.info("至少保留一个子看板"); return; }
    const target = current.settings.boardPages.find((page) => page.id !== pageId)!;
    const pages = current.settings.boardPages.filter((page) => page.id !== pageId);
    if (current.settings.boardPages[0]?.id === pageId)
      saveProjects(loadProjects().map((project) => project.id === projectId ? { ...project, thumbnail: target.cover } : project));
    const tree = current.scene.map((node) => node.type === "widget" && node.boardPageId === pageId
      ? { ...node, boardPageId: target.id } : node);
    const active = pages.find((page) => page.id === (current.settings.boardActivePageId === pageId ? target.id : current.settings.boardActivePageId)) ?? pages[0]!;
    getSceneBridge().post({ type: "loadScene", tree, settings: { ...current.settings, boardPages: pages,
      boardActivePageId: active.id, boardActiveStateId: "", ...active.style,
      boardDefaultState: { ...current.settings.boardDefaultState, ...active.style },
      boardCarouselEnabled: pages.length > 1 && current.settings.boardCarouselEnabled } });
    setState({ boardLayer: "page", boardSize: { width: active.width, height: active.height }, selectedId: null, selectedIds: [] });
  };
  // 删除保留层看板：前景=移除该层组件与配置；背景=清空组件并重置为默认样式
  const deleteReservedBoard = (kind: "foreground" | "background") => {
    const current = getState();
    const reservedId = kind === "foreground" ? FOREGROUND_BOARD_PAGE_ID : BACKGROUND_BOARD_PAGE_ID;
    const tree = current.scene.filter((node) => !(node.type === "widget" && node.boardPageId === reservedId));
    const settings = kind === "foreground"
      ? { ...current.settings, boardForegroundPage: null }
      : { ...current.settings, boardBackgroundPage: structuredClone(defaultEditorSettings.boardBackgroundPage) };
    getSceneBridge().post({ type: "loadScene", tree, settings });
    const activePage = current.settings.boardPages.find((page) => page.id === current.settings.boardActivePageId) ?? current.settings.boardPages[0]!;
    setState({ boardLayer: "page", boardSize: { width: activePage.width, height: activePage.height }, selectedId: null, selectedIds: [] });
  };
  // 山海鲸式删除入口：勾选过「不再提示」直接执行，否则弹删除提醒
  const requestDelete = (target: { kind: "page"; id: string; name: string } | { kind: "foreground" } | { kind: "background" }) => {
    if (localStorage.getItem("dw_board_delete_confirm_skip") === "1") {
      if (target.kind === "page") deleteBoardPage(target.id); else deleteReservedBoard(target.kind);
      return;
    }
    setDeleteDialog(target);
  };
  const confirmDeleteDialog = () => {
    const target = deleteDialog;
    if (!target) return;
    if (skipDeleteConfirm) localStorage.setItem("dw_board_delete_confirm_skip", "1");
    setDeleteDialog(null);
    if (target.kind === "page") deleteBoardPage(target.id); else deleteReservedBoard(target.kind);
  };
  const addBoardBackground = async (file: File) => {
    const type = file.type.toLowerCase();
    if (file.size > 100_000_000) { Toast.error("文件不能超过 100 MB"); return; }
    if (!type.startsWith("image/") && !type.startsWith("video/")) { Toast.error("请选择图片或视频文件"); return; }
    try {
      const media = await saveBoardMedia(file);
      const current = getState();
      const stylePatch = { boardBackgroundMediaId: media.id, boardBackgroundMediaName: media.name, boardBackgroundEnabled: true };
      getSceneBridge().post({ type: "configure", patch: { boardBackgroundPage: {
        ...current.settings.boardBackgroundPage,
        style: { ...current.settings.boardBackgroundPage.style, ...stylePatch },
      } } });
      Toast.success("背景媒体已添加");
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : "背景媒体添加失败");
    }
  };
  useEffect(()=>{const update=()=>{const p=loadProjects().find(p=>p.id===projectId);if(p)setProjectName(p.name)};window.addEventListener("dw:project-name",update);return()=>window.removeEventListener("dw:project-name",update)},[projectId]);
  useEffect(()=>{if(!preview)setState({runtime:{}})},[preview]);
  useEffect(() => {
    if (!preview || state.projectId !== projectId) return;
    runBoardInteractions("boardActive");
  }, [preview, projectId, state.projectId, state.settings.boardActivePageId]);
  useEffect(() => {
    if (!preview || !state.settings.boardCarouselEnabled || state.settings.boardPages.length < 2) return;
    const delay = Math.max(100, state.settings.boardPageDuration * 1000);
    const timer = window.setInterval(() => {
      const current = getState();
      const index = current.settings.boardPages.findIndex((page) => page.id === current.settings.boardActivePageId);
      const next = current.settings.boardPages[(index + 1) % current.settings.boardPages.length];
      if (next) activateBoardPage(next.id, true);
    }, delay);
    return () => window.clearInterval(timer);
  }, [preview, state.settings.boardCarouselEnabled, state.settings.boardPages, state.settings.boardPageDuration, state.settings.boardActivePageId]);
  useEffect(() => {
    const onNavigate = (event: Event) => {
      const target = String((event as CustomEvent<{ target?: string }>).detail?.target ?? "");
      const current = getState();
      const page = current.settings.boardPages.find((item) => item.id === target || item.name === target);
      if (page) { activateBoardPage(page.id, true); return; }
      const project = loadProjects().find((item) => item.id === target || item.name === target);
      if (project) window.location.hash = `#/project/layer?projectId=${encodeURIComponent(project.id)}&preview=1`;
      else Toast.warning(`没有找到名为「${target || "空"}」的看板`);
    };
    const openBackground = () => { activateBackgroundBoard(); window.dispatchEvent(new Event("dw:open-board-style")); };
    window.addEventListener("dw:navigate-board", onNavigate);
    window.addEventListener("dw:open-board-background", openBackground);
    return () => { window.removeEventListener("dw:navigate-board", onNavigate); window.removeEventListener("dw:open-board-background", openBackground); };
  }, []);
  useEffect(() => {
    const activeEvents = new Set<string>();
    const onDevEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string; payload?: unknown }>).detail;
      const name = detail?.name ?? "";
      if (activeEvents.has(name)) return;
      activeEvents.add(name);
      try { runBoardInteractions("custom", name, detail?.payload); } finally { activeEvents.delete(name); }
    };
    window.addEventListener("dw:dev-event", onDevEvent);
    return () => window.removeEventListener("dw:dev-event", onDevEvent);
  }, []);
  useEffect(() => {
    if (!preview || state.projectId !== projectId) { dataRuleMatches.current.clear(); return; }
    const rules = state.settings.boardInteractions.map((rule) => ({
      key: `board:${rule.id}`, rule, node: null as SceneNode | null,
    }));
    const currentKeys = new Set(rules.map((item) => item.key));
    for (const key of dataRuleMatches.current.keys()) if (!currentKeys.has(key)) dataRuleMatches.current.delete(key);
    for (const item of rules) {
      if (item.rule.event !== "data") continue;
      const matches = interactionConditionMatches(item.rule, state.liveData);
      triggerDataEdge(dataRuleMatches.current, item.key, matches, () => runDataInteractions(item.rule, null));
    }
  }, [preview, projectId, state.projectId, state.settings.boardInteractions, state.settings.boardActivePageId, state.scene, state.liveData]);
  useEffect(()=>{const update=(event:Event)=>{const patch=(event as CustomEvent).detail;getSceneBridge().post({type:"configure",patch});};window.addEventListener("dw:hud",update);return()=>window.removeEventListener("dw:hud",update)},[]);
  // 看板素材覆盖面板：点击 rail/面板之外的空白处关闭（山海鲸式；rail 内点击走 Nav 自身的开关/切换）
  useEffect(() => {
    if (!assetCategory || editing || preview) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".editor-asset-column")) return;
      setAssetCategory(null);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [assetCategory, editing, preview]);
  // 山海鲸式：点收起 rail 顶部搜索按钮展开菜单后，自动聚焦搜索框（看板面板与 3D 抽屉两套搜索框；仅经此入口聚焦，点分类展开不打字焦点）
  useEffect(() => {
    if (!assetSearchFocusTick) return;
    document.querySelector<HTMLInputElement>(".asset-rail-search input, .library-search input")?.focus();
  }, [assetSearchFocusTick]);

  useEffect(() => {
    const bridge = getSceneBridge();
    let saveTimer = 0;
    let current: SceneSnapshot | null = null;
    let lastRevision = -1;
    const settings = readEditorSettings(projectId);
    // 山海鲸 4.7.13 术语为「子看板」：历史自动命名的子大屏N 一并迁移
    settings.boardPages = settings.boardPages.map((page) => /^子大屏\d+$/.test(page.name)
      ? { ...page, name: page.name.replace("子大屏", "子看板") } : page);
    const storedBoardSize = readBoardSize(projectId);
    if (!hasStoredBoardPages(projectId) && settings.boardPages[0]) settings.boardPages[0] = { ...settings.boardPages[0], ...storedBoardSize };
    const activePage = settings.boardPages.find((page) => page.id === settings.boardActivePageId) ?? settings.boardPages[0]!;
    setState({ boardLayer: "page", stats: { backend: "-", fps: 0, instances: 0, visible: 0, particles: 0, tris: 0 },
      projectId, boardSize: { width: activePage.width, height: activePage.height }, scene: [], flat: [], viewOrigin: { x: 0, z: 0 }, selectedId: null, selectedIds: [], runtime: {},
      liveData: { "builtin:project-params": readProjectParams(projectId) }, dataStatus: {}, settings, revision: 0, canUndo: false,
      canRedo: false, lastSavedAt: null, saveError: null });
    const persist = () => {
      if (!current || current.projectId !== projectId || current.loadError) return;
      try { persistScene(projectId, current.tree); persistEditorSettings(projectId,current.settings); setState({ lastSavedAt: Date.now(), saveError: null }); }
      catch { setState({ saveError: "自动保存失败，请导出项目备份" }); }
    };
    const unsubscribe = bridge.subscribe((next) => {
      if (next.projectId !== projectId) return;
      const wasLoadError = Boolean(current?.loadError);
      current = next;
      setSnapshot(next);
      setState({ scene: next.tree, flat: next.flat, viewOrigin: next.viewOrigin, selectedId: next.selectedId, selectedIds: next.selectedIds, settings: next.settings, hud:{grid:next.settings.grid,flylines:next.settings.flylines,stats:next.settings.stats},
        revision: next.revision, canUndo: next.canUndo, canRedo: next.canRedo,
        ...(next.loadError ? { saveError: next.loadError } : wasLoadError ? { saveError: null } : {}) });
      if (next.revision !== lastRevision) {
        lastRevision = next.revision;
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(persist, 400);
      }
    });
    const template = loadProjects().find((p) => p.id === projectId)?.template ?? "empty";
    const snapshotBytes = readSnapshotBytes(projectId);
    if (snapshotBytes) {
      // Phase 2 零拷贝：场景树由 worker 侧从快照字节解码，主线程只 transfer 字节
      bridge.post({ type: "loadSnapshot", projectId, data: snapshotBytes.buffer as ArrayBuffer, settings, template });
    } else {
      let saved = null;
      try { saved = readScene(projectId); }
      catch { Toast.error("保存的场景数据格式无效，已打开空白场景"); saved = []; }
      bridge.post({ type: "openProject", projectId, tree: saved, settings, template });
    }
    const flush = () => persist();
    window.addEventListener("pagehide", flush);
    return () => { window.clearTimeout(saveTimer); persist(); unsubscribe(); window.removeEventListener("pagehide", flush); };
  }, [projectId]);

  useEffect(() => {
    const manager = new LiveDataManager((update) => {
      const current = getState();
      if (current.projectId !== projectId) return;
      const liveData = { ...current.liveData }, dataStatus = { ...current.dataStatus };
      if (update.clear) { delete liveData[update.id]; delete dataStatus[update.id]; }
      if (update.data) liveData[update.id] = update.data;
      if (update.status) dataStatus[update.id] = update.status;
      setState({ liveData, dataStatus });
    });
    dataManager.current = manager;
    const refresh = (event: Event) => manager.refresh((event as CustomEvent<{ id?: string }>).detail?.id);
    window.addEventListener("dw:refresh-data", refresh);
    return () => {
      window.removeEventListener("dw:refresh-data", refresh);
      manager.dispose();
      if (dataManager.current === manager) dataManager.current = null;
      if (getState().projectId === projectId) setState({ liveData: {}, dataStatus: {} });
    };
  }, [projectId]);

  useEffect(() => {
    if (state.projectId !== projectId) return;
    const shared = state.settings.boardSharedData;
    const connections = shared.map((item) => ({
      id: item.id,
      dataSource: item.enabled && item.source ? { ...item.source, enabled: item.enabled } : undefined,
    }));
    dataManager.current?.sync([...state.scene, ...connections]);

    const liveData = { ...getState().liveData };
    const dataStatus = { ...getState().dataStatus };
    let changed = false;
    const nextIds = new Set(shared.map((item) => item.id));
    for (const id of sharedDataIds.current) if (!nextIds.has(id)) {
      if (id in liveData) { delete liveData[id]; changed = true; }
      if (id in dataStatus) { delete dataStatus[id]; changed = true; }
    }
    for (const item of shared) {
      if (!item.source && item.enabled && item.data) {
        if (JSON.stringify(liveData[item.id] ?? null) !== JSON.stringify(item.data)) { liveData[item.id] = item.data; changed = true; }
      } else if (!item.enabled && item.id in liveData) { delete liveData[item.id]; changed = true; }
    }
    sharedDataIds.current = nextIds;
    if (changed) setState({ liveData, dataStatus });
  }, [projectId, state.projectId, state.scene, state.settings.boardSharedData]);

  useEffect(() => {
    if (state.projectId !== projectId) return;
    try {
      const current = getState();
      if (current.boardLayer === "background") {
        const page = current.settings.boardBackgroundPage;
        if (page.width !== state.boardSize.width || page.height !== state.boardSize.height)
          getSceneBridge().post({ type: "configure", patch: { boardBackgroundPage: {
            ...page, width: state.boardSize.width, height: state.boardSize.height,
          } } });
      } else {
        persistBoardSize(projectId, state.boardSize);
        const pages = current.settings.boardPages;
        const activeId = current.settings.boardActivePageId;
        const active = pages.find((page) => page.id === activeId);
        if (active && (active.width !== state.boardSize.width || active.height !== state.boardSize.height))
          getSceneBridge().post({ type: "configure", patch: { boardPages: pages.map((page) => page.id === activeId
            ? { ...page, width: state.boardSize.width, height: state.boardSize.height } : page) } });
      }
    }
    catch { setState({ saveError: "看板尺寸保存失败" }); }
  }, [projectId, state.projectId, state.boardSize]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {setStageWidth(entry.contentRect.width);setStageHeight(entry.contentRect.height)});
    observer.observe(stage);
    return () => observer.disconnect();
  }, [preview]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && preview) { setPreview(false); return; }
      if (preview) return;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "s") {
        event.preventDefault(); void saveCurrentScene().catch((error: unknown) => Toast.error(error instanceof Error ? error.message : "保存失败")); return;
      }
      if (event.key === "F5") {
        event.preventDefault(); window.dispatchEvent(new Event("dw:refresh-data")); Toast.info("已刷新数据连接"); return;
      }
      if ((event.target as HTMLElement)?.closest("input, textarea, [contenteditable=true], [role=combobox]")) return;
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault(); getSceneBridge().post({ type: event.shiftKey ? "redo" : "undo" });
      } else if (command && event.key.toLowerCase() === "d" && getState().selectedId) {
        event.preventDefault(); duplicateSelection();
      } else if(command&&event.key.toLowerCase()==="c"){event.preventDefault();copySelection();
      } else if(command&&event.key.toLowerCase()==="v"){event.preventDefault();pasteSelection();
      } else if(command&&event.key.toLowerCase()==="a"){event.preventDefault();selectAll(editing);
      } else if(command&&event.key.toLowerCase()==="g"){event.preventDefault();getSceneBridge().post({type:event.shiftKey?"ungroup":"group",ids:selection()});
      } else if(command&&event.key.toLowerCase()==="y"){event.preventDefault();getSceneBridge().post({type:"redo"});
      } else if (["Delete", "Backspace"].includes(event.key) && getState().selectedId) {
        event.preventDefault(); deleteSelection();
      } else if (event.key.toLowerCase() === "f") focusSelection();
      else if(editing&&["w","e","r"].includes(event.key.toLowerCase()))setState({tool:({w:"move",e:"rotate",r:"scale"} as const)[event.key.toLowerCase() as "w"]});
      else if(event.key==="Escape"){getSceneBridge().post({type:"select",id:null});setAssetCategory(null);setBoardSelected(false);setRootNodeId(null)}
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, preview]);

  // 首开加载骨架（山海鲸式）：场景快照到达且引擎就绪（或明确失败）后才撤下，另保底展示 600ms 防闪烁
  const booting = !(snapshot && snapshot.projectId === projectId) || !(state.engineReady || state.webgpuError);
  useEffect(() => {
    if (booting) { setBootHiding(false); setBootGone(false); return; }
    const remain = Math.max(0, 600 - (performance.now() - bootStartRef.current));
    const timer = window.setTimeout(() => setBootHiding(true), remain);
    return () => window.clearTimeout(timer);
  }, [booting]);
  useEffect(() => {
    if (!bootHiding) return;
    const timer = window.setTimeout(() => setBootGone(true), 320);
    return () => window.clearTimeout(timer);
  }, [bootHiding]);

  const fitScale=Math.max(.02,Math.min((stageWidth-(preview?0:48))/state.boardSize.width,(stageHeight-(preview?0:70))/state.boardSize.height));
  const previewScale=state.settings.boardFit==="cover"?Math.max(stageWidth/state.boardSize.width,stageHeight/state.boardSize.height)
    :["original", "responsive"].includes(state.settings.boardFit)?1:fitScale;
  const responsivePreview = preview && state.settings.boardFit === "responsive";
  const actualZoom=preview?previewScale*100:fit?Math.min(fitScale*100,100):zoom;
  // 山海鲸式缩放读数：拟合态显示实际比例两位小数；手动输入钳制 10%–500%
  const zoomDisplay = `${fit ? actualZoom.toFixed(2) : String(Math.round(zoom * 10) / 10)}%`;
  zoomState.current = { fit, zoom, preview, editing, actualZoom };
  useEffect(() => { if (!zoomInputFocused.current) setZoomDraft(zoomDisplay); }, [zoomDisplay, fit, zoom]);
  const commitZoomDraft = (raw?: string) => {
    const parsed = Number.parseFloat((raw ?? zoomDraft).replace("%", "").trim());
    if (Number.isFinite(parsed)) {
      const clamped = Math.max(10, Math.min(500, parsed));
      setZoom(clamped); setFit(false);
    }
    zoomInputFocused.current = false;
    setZoomDraft(zoomDisplay);
  };
  useEffect(() => {
    const area = stageAreaRef.current;
    if (!area) return;
    const startGesture = (event: Event) => {
      const current = zoomState.current;
      if (current.preview || current.editing) return;
      event.preventDefault();
      gestureZoomActive.current = true;
      gestureZoomStart.current = current.fit ? current.actualZoom : current.zoom;
      setFit(false);
    };
    const changeGesture = (event: Event) => {
      const current = zoomState.current;
      if (current.preview || current.editing || !gestureZoomActive.current) return;
      const scale = (event as Event & { scale?: number }).scale;
      if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) return;
      event.preventDefault();
      setZoom(Math.max(10, Math.min(400, gestureZoomStart.current * scale)));
    };
    const endGesture = (event: Event) => {
      if (gestureZoomActive.current) event.preventDefault();
      gestureZoomActive.current = false;
    };
    const zoomWheel = (event: WheelEvent) => {
      const current = zoomState.current;
      if (current.preview || current.editing) return;
      event.preventDefault(); event.stopPropagation();
      if (gestureZoomActive.current) return;
      const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? area.clientHeight || 800 : 1);
      const factor = Math.exp(-delta * (event.ctrlKey || event.metaKey ? 0.003 : 0.0015));
      const currentZoom = current.fit ? current.actualZoom : current.zoom;
      setZoom(Math.max(10, Math.min(400, currentZoom * factor)));
      setFit(false);
    };
    area.addEventListener("gesturestart", startGesture, { passive: false });
    area.addEventListener("gesturechange", changeGesture, { passive: false });
    area.addEventListener("gestureend", endGesture, { passive: false });
    area.addEventListener("wheel", zoomWheel, { passive: false, capture: true });
    return () => {
      area.removeEventListener("gesturestart", startGesture);
      area.removeEventListener("gesturechange", changeGesture);
      area.removeEventListener("gestureend", endGesture);
      area.removeEventListener("wheel", zoomWheel, true);
    };
  }, [preview, editing]);
  const startBoardResize = (event: ReactPointerEvent<HTMLButtonElement>, edge: BoardResizeEdge) => {
    event.preventDefault(); event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    boardResize.current = { edge, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      width: state.boardSize.width, height: state.boardSize.height, scale: Math.max(actualZoom / 100, 0.02), handle };
    // Freeze the current fitted zoom during resize so the boundary keeps tracking the pointer.
    setZoom(actualZoom); setFit(false); setBoardSelected(true);
  };
  const moveBoardResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = boardResize.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    // The board is centered in the stage, so resize both sides to keep the dragged edge under the pointer.
    const dx = (event.clientX - drag.startX) / drag.scale * 2;
    const dy = (event.clientY - drag.startY) / drag.scale * 2;
    const width = drag.edge === "e" ? drag.width + dx : drag.edge === "w" ? drag.width - dx : drag.width;
    const height = drag.edge === "s" ? drag.height + dy : drag.edge === "n" ? drag.height - dy : drag.height;
    setState({ boardSize: { width: Math.max(100, Math.min(8192, Math.round(width))),
      height: Math.max(100, Math.min(8192, Math.round(height))) } });
  };
  const finishBoardResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = boardResize.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    boardResize.current = null;
    if (drag.handle.hasPointerCapture(event.pointerId)) drag.handle.releasePointerCapture(event.pointerId);
  };
  return <div className={`editor-page ${preview ? "is-preview" : ""}`}>
    {!bootGone && <EditorBootSkeleton projectName={projectName} hiding={bootHiding} />}
    <TopMenuBar projectName={projectName} projectId={projectId} editing={editing} setEditing={changeEditing} preview={preview} setPreview={setPreview} />
    {/* 编辑器骨架：纵向 body > 横向行（图层树 aside + 素材列 + 画布 main + 属性栏）；底部 footer 工具栏 */}
    <div className={`editor-body ${assetCategory && !preview ? "asset-open" : ""}`}>
      <div className="editor-body-row">
      {!preview && <>
        <aside className={`editor-tree ${treeCollapsed ? "is-collapsed" : ""}`} aria-label="图层树"><SceneTreePanel snapshot={snapshot} editing={editing} setEditing={changeEditing}
          boardName={state.boardLayer === "background" ? backgroundPage.name
            : state.boardLayer === "foreground" ? state.settings.boardForegroundPage?.name ?? "前景看板" : activePage.name}
          boardLayer={state.boardLayer === "foreground" ? "page" : state.boardLayer}
          boardPageId={state.settings.boardActivePageId} onSelectRoot={openRoot} /></aside>
        {/* 山海鲸式浮层素材库：rail 定宽撑起列；看板态展开后为整块覆盖面板（展开 rail + 分组条 + 抽屉），
            3D 编辑态维持旧抽屉（AssetLibraryPanel），排版依据 docs/board-asset-panel-sync.md */}
        <div className="editor-asset-column">
          <nav className={`editor-asset-rail ${editing ? "is-3d" : "is-board"}`} aria-label="素材类型">
            <Button className="asset-rail-search-trigger" variant="ghost" size="icon-sm" aria-label="搜索组件"
              onClick={() => { setAssetCategory((prev) => prev ?? "全部"); setAssetSearchFocusTick((tick) => tick + 1); }}><Search size={17} /></Button>
            {categories.map((category) => <button key={category.label} type="button"
              className={assetCategory === category.label ? "is-selected" : ""} aria-pressed={assetCategory === category.label}
              onClick={() => setAssetCategory(assetCategory === category.label ? null : category.label)}>
              {category.icon}
              <span className="asset-rail-label">{category.label}{!editing && <i className="asset-rail-count">{boardAssetCounts[category.label] ?? 0}</i>}</span>
            </button>)}
          </nav>
          {assetCategory && (editing ? <aside className={`editor-asset-drawer ${libraryExpanded ? "is-expanded" : ""}`}>
            <AssetLibraryPanel category={assetCategory} libraryExpanded={libraryExpanded}
              onToggleLibrary={() => setLibraryExpanded(!libraryExpanded)} onClose={() => setAssetCategory(null)} />
          </aside>
            : <section className={`asset-overlay-panel is-${assetTab} ${assetCategory === "套件" ? "is-kit" : ""} ${["拓扑", "套件"].includes(assetCategory) ? "has-family" : ""} ${libraryExpanded ? "is-expanded" : ""}`}>
              <div className="asset-panel-rail">
                {assetTab !== "asset" && <div className="asset-rail-search-row">
                  <div className="asset-rail-search relative">
                    <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" size={14} />
                    <Input className="h-7 text-xs pl-7 pr-6" placeholder="搜索组件" aria-label="搜索组件" value={assetQuery}
                      onChange={(event) => setAssetQuery(event.target.value)} />
                    {assetQuery && <button aria-label="清空组件搜索" className="absolute top-1/2 right-1.5 -translate-y-1/2 border-0 bg-transparent text-muted-foreground"
                      onClick={() => setAssetQuery("")}>×</button>}
                  </div>
                </div>}
                <nav className="asset-rail-expanded" aria-label="素材类型展开">
                  {assetTab === "asset" ? <div className="asset-rail-nav">
                    <button type="button" className="is-selected" aria-current="true">
                      <FolderOpen {...railIcon} />
                      <span className="asset-rail-label">全部<i className="asset-rail-count">{readUserAssets().length}</i></span>
                    </button>
                  </div>
                    : <div className="asset-rail-nav">
                      {boardCategories.map((category) => <button key={category.label} type="button"
                        className={assetCategory === category.label ? "is-selected" : ""} aria-pressed={assetCategory === category.label}
                        onClick={() => setAssetCategory(assetCategory === category.label ? null : category.label)}>
                        {category.icon}
                        <span className="asset-rail-label">{category.label}<i className="asset-rail-count">{boardAssetCounts[category.label] ?? 0}</i></span>
                      </button>)}
                    </div>}
                </nav>
              </div>
              <div className="asset-panel-main">
                <header className="asset-panel-header">
                  <ToggleGroup className="asset-theme-tabs flex" aria-label="素材库切换" value={[assetTab]}
                    onValueChange={(values) => {
                      const next = values[0] as typeof assetTab | undefined;
                      if (!next) return;
                      setAssetTab(next);
                      if (next === "light") setKitFamilyId("light");
                      if (next === "dark" && assetTab === "light") setKitFamilyId("free");
                    }}>
                    <ToggleGroupItem value="dark">深色</ToggleGroupItem>
                    <ToggleGroupItem value="light">浅色</ToggleGroupItem>
                    <ToggleGroupItem value="asset">资产库</ToggleGroupItem>
                  </ToggleGroup>
                  <div className="asset-panel-actions">
                    <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm"
                      aria-label="刷新素材" onClick={() => setRefreshKey((key) => key + 1)} />}><Refresh /></TooltipTrigger><TooltipContent>刷新素材</TooltipContent></Tooltip>
                    <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm"
                      aria-label={libraryExpanded ? "收起素材库" : "展开素材库"} onClick={() => setLibraryExpanded(!libraryExpanded)} />}><FullScreen /></TooltipTrigger>
                      <TooltipContent>{libraryExpanded ? "收起素材库" : "展开素材库"}</TooltipContent></Tooltip>
                  </div>
                </header>
                <div className="asset-panel-body" key={refreshKey}>
                  {assetTab === "asset" ? <BoardAssetLibrary query={assetQuery} />
                    : <>{["拓扑", "套件"].includes(assetCategory)
                      && <AssetFamilyStrip category={assetCategory as "拓扑" | "套件"} chip={assetChip} onChip={setAssetChip} familyId={kitFamilyId} onFamily={setKitFamilyId} />}
                    <ComponentPalette category={assetCategory} query={assetQuery} chip={assetChip} onChip={setAssetChip} kitFamilyId={kitFamilyId}
                      onKitInsert={() => setAssetCategory(null)} /></>}
                </div>
              </div>
            </section>)}
        </div>
      </>}
      {/* stage 保持原生 main（ResizeObserver 需要 DOM ref）；语义一致 */}
      <main className={`editor-stage ${!preview ? "has-editor-rulers" : ""} ${editing && !preview ? "is-editing" : ""} ${!preview && debugConsoleOpen ? "has-debug-console" : ""}`} ref={stageRef}>
        {!preview && <><div className="ruler ruler-horizontal">{Array.from({ length: 25 }, (_, index) => <span key={index}>{(index - 2) * 400}</span>)}</div>
          <div className="ruler ruler-vertical">{Array.from({ length: 30 }, (_, index) => <span key={index}>{(index - 6) * 400}</span>)}</div></>}
        <div className={`editor-stage-area ${preview && ["cover", "original"].includes(state.settings.boardFit) ? "is-scroll-fit" : ""}`}
          ref={stageAreaRef}
          style={{ backgroundColor: preview ? state.settings.boardFillColor : undefined }}
          onDoubleClick={(event) => { if (event.target === event.currentTarget) setEditing(false); }}>
          <div className={`board-canvas ${editing || runtimeFlat(state).length > 0 ? "has-3d" : ""} ${state.settings.boardOutline && !preview ? "is-outline" : ""} ${pageTransition ? `board-page-${state.settings.boardCarouselAnimation}` : ""}`} style={{ width: preview&&(state.settings.boardFit==="stretch"||responsivePreview)?stageWidth:state.boardSize.width*actualZoom/100, height:preview&&(state.settings.boardFit==="stretch"||responsivePreview)?stageHeight:state.boardSize.height*actualZoom/100, background:canvasBackgroundColor, animationDuration: `${state.settings.boardCarouselDuration}s` }}
            onPointerMove={moveBoardResize} onPointerUp={finishBoardResize} onPointerCancel={finishBoardResize}
            onClick={(event) => { if (preview && !(event.target instanceof Element && event.target.closest(".rust-board-layer"))) runBoardInteractions("click"); }}
            onDoubleClick={(event) => {
              if (event.target instanceof Element && event.target.closest(".rust-board-layer")) return;
              if (preview) runBoardInteractions("dblclick"); else setEditing(true);
            }}
            onDragOver={(event) => {
              if (editing || preview || !event.dataTransfer.types.some(type => type === WIDGET_MIME || type === KIT_MIME)) return;
              event.preventDefault(); event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(event) => {
              const kitId = event.dataTransfer.getData(KIT_MIME);
              if (kitId && !editing && !preview) {
                event.preventDefault(); event.stopPropagation();
                const entry = kitCatalog.find(item => item.id === kitId);
                const rect = event.currentTarget.getBoundingClientRect();
                const origin = { x: (event.clientX - rect.left) / rect.width * state.boardSize.width,
                  y: (event.clientY - rect.top) / rect.height * state.boardSize.height };
                if (entry) void insertKitEntry(entry, origin).then(inserted => { if (inserted) setAssetCategory(null); })
                  .catch(error => Toast.error(String(error)));
                return;
              }
              const raw = event.dataTransfer.getData(WIDGET_MIME);
              if (!raw || editing || preview) return;
              event.preventDefault(); event.stopPropagation();
              try {
                const node = JSON.parse(raw) as SceneNode;
                // 落点换算成看板坐标，组件以落点为中心（与山海鲸拖入一致）
                const layer = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(".rust-board-layer");
                const rect = layer?.getBoundingClientRect();
                const width = node.boxSize?.x ?? 300, height = node.boxSize?.y ?? 100;
                const x = rect && rect.width > 0 ? (event.clientX - rect.left) / rect.width * state.boardSize.width - width / 2 : 80;
                const y = rect && rect.height > 0 ? (event.clientY - rect.top) / rect.height * state.boardSize.height - height / 2 : 80;
                getSceneBridge().post({ type: "add", node: { ...node, boardPageId: state.boardLayer === "background" ? BACKGROUND_BOARD_PAGE_ID : state.settings.boardActivePageId,
                  transform: { position: { x, y, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } } });
              } catch { Toast.warning({ content: "组件数据无效，请重新拖入", duration: 2 }); }
            }}>
            <BoardBackground preview={preview} settingsOverride={canvasSettings} includeSharedBackground={showSharedBackground}/>
            <Viewport mode="editor" editable={editing && !preview} onPick={(id,additive,trigger="click") => {
              if (id) setBoardSelected(false);
              if(preview){const node=state.scene.find(n=>n.id===id);if(node)runInteractions(node,trigger);return;}
              if(trigger==="click")getSceneBridge().post({type:"select",id:editing?id:null,additive});
            }} />
            <BoardOverlay preview={preview} editing={editing} scale={preview&&state.settings.boardFit==="stretch"?stageWidth/state.boardSize.width:actualZoom/100} scaleY={preview&&state.settings.boardFit==="stretch"?stageHeight/state.boardSize.height:undefined}
              responsiveSize={responsivePreview ? { width: stageWidth, height: stageHeight } : undefined}
              onBackgroundSelect={() => { if (!editing && !preview) { setBoardSelected(true); getSceneBridge().post({ type: "select", id: null }); } }}
              onSelect={() => setBoardSelected(false)} />
            {boardSelected && !preview && !editing && state.selectedIds.length === 0 && <div className="board-canvas-selection" aria-label="画布尺寸控制点">
              {(["n", "e", "s", "w"] as const).map(edge => <button key={edge} type="button"
                className={`board-canvas-resize-handle ${edge}`} aria-label={edge === "e" || edge === "w" ? "调整画布宽度" : "调整画布高度"}
                title="拖动调整画布尺寸"
                onPointerDown={event => startBoardResize(event, edge)} onClick={event => event.stopPropagation()}
                onDoubleClick={event => event.stopPropagation()} />)}
            </div>}
            {preview && <TourBar />}
            {!editing && !preview && <Button className="enter-3d" variant="ghost" onClick={() => setEditing(true)}><Cube />双击进入 3D 编辑</Button>}
          </div>
        </div>
        {!preview && debugConsoleOpen && <DebugConsole onClose={() => setDebugConsoleOpen(false)} />}
      </main>
      {!preview && <PropertiesPanel editing={editing} rootNode={rootNodeId} />}
      </div>
      {!preview && <footer className="board-toolbar">
        <input ref={backgroundFileRef} className="board-background-file-input" type="file" accept="image/*,video/*"
          aria-label="添加背景图片或视频" onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void addBoardBackground(file);
          }} />
        <div className={`board-toolbar-tree ${treeCollapsed ? "is-collapsed" : ""}`}>
          <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm"
            aria-label={treeCollapsed ? "展开图层列表" : "收起图层列表"} onClick={() => setTreeCollapsed(!treeCollapsed)} />}><Layers /></TooltipTrigger>
            <TooltipContent>{treeCollapsed ? "展开图层列表" : "收起图层列表"}</TooltipContent></Tooltip>
        </div>
        <div className={`board-toolbar-assets ${treeCollapsed ? "is-tree-collapsed" : ""}`} />
        <div className="board-toolbar-main">
          <div className="board-strip">
            {/* 前景：未创建时显示「前景 ⊕」（点击创建并进入前景看板），已创建为可删除页签（1:1 山海鲸 4.7.13） */}
            {!state.settings.boardForegroundPage ? (
              <div className="board-tab-group board-foreground-group">
                <Button size="sm" variant="ghost" className="board-strip-tab" onClick={activateForegroundBoard}>前景</Button>
                <Button size="sm" variant="ghost" className="board-tab-add-circle" aria-label="添加前景看板"
                  onClick={activateForegroundBoard}>
                  <span className="board-tab-plus-circle"><Plus size={8} /></span>
                </Button>
              </div>
            ) : (
              <div className="board-tab-group board-foreground-group has-close">
                <Button size="sm" variant="ghost" role="tab" aria-selected={state.boardLayer === "foreground" && !editing}
                  className={`board-strip-tab ${state.boardLayer === "foreground" && !editing ? "current-board" : ""}`}
                  onClick={activateForegroundBoard}><Layers size={13} />前景看板</Button>
                <button type="button" className="board-tab-close" aria-label="删除前景看板"
                  onClick={() => requestDelete({ kind: "foreground" })}>×</button>
              </div>
            )}
            <div className="board-page-tabs" role="tablist" aria-label="子看板">
              {state.settings.boardPages.map((page) => {
                const active = page.id === state.settings.boardActivePageId && state.boardLayer === "page" && !editing;
                return <div key={page.id} className={`board-page-tab-wrap ${active ? "is-active" : ""}`}
                  onContextMenu={(event) => { event.preventDefault(); openSceneContextMenu(event.clientX, event.clientY, `@pagetab:${page.id}`); }}>
                  <Button size="sm" variant="ghost" role="tab" aria-selected={active}
                    className={`board-strip-tab board-page-tab ${active ? "current-board" : ""}`}
                    onClick={() => activateBoardPage(page.id)}><Monitor size={12} />{page.name}</Button>
                  {state.settings.boardPages.length > 1 && <button type="button" className="board-tab-close"
                    aria-label={`删除${page.name}`} onClick={() => requestDelete({ kind: "page", id: page.id, name: page.name })}>×</button>}
                </div>;
              })}
            </div>
            {/* 山海鲸「+」直接新建子看板（无菜单）；重命名/删除在页签右键与悬停 ✕ */}
            <Button size="sm" variant="ghost" className="board-page-add" aria-label="新建子看板"
              onClick={() => createBoardPage(false)}><Plus size={16} /></Button>
            <div className="board-tab-group board-background-group">
              {state.boardLayer === "background" && !editing ? (
                <>
                  <Button size="sm" variant="ghost" role="tab" aria-selected className="board-strip-tab current-board"
                    onClick={activateBackgroundBoard}><Layers size={13} />背景看板</Button>
                  <button type="button" className="board-tab-close" aria-label="删除背景看板"
                    onClick={() => requestDelete({ kind: "background" })}>×</button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="ghost" role="tab" aria-selected={false} className="board-strip-tab"
                    onClick={activateBackgroundBoard}>背景</Button>
                  <Button size="sm" variant="ghost" className="board-tab-add-circle" aria-label="添加背景图片或视频"
                    onClick={() => { activateBackgroundBoard(); backgroundFileRef.current?.click(); }}>
                    <span className="board-tab-plus-circle"><Plus size={8} /></span>
                  </Button>
                </>
              )}
            </div>
          </div>
          <span className="toolbar-spacer" />
          <span className="zoom-select-hint" title="鼠标滚轮或触控板双指捏合缩放画布">
            <Input aria-label="画布缩放" className="board-zoom-input h-7 text-center text-[11px] text-[#e5e5e5]" value={zoomDraft}
              onChange={(event) => setZoomDraft(event.target.value)}
              onFocus={() => { zoomInputFocused.current = true; }}
              onBlur={(event) => commitZoomDraft(event.currentTarget.value)}
              onKeyDown={(event) => { if (event.key === "Enter") (event.currentTarget as HTMLInputElement).blur(); }} />
          </span>
          <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm"
            aria-label="最佳显示比例" onClick={() => setFit(true)} />}><FullScreen /></TooltipTrigger><TooltipContent>最佳显示比例</TooltipContent></Tooltip>
          <Popover open={shortcuts} onOpenChange={setShortcuts}>
            <PopoverTrigger render={<span />}>
              <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm"
                aria-label="快捷键列表" aria-expanded={shortcuts} />}><Keyboard /></TooltipTrigger><TooltipContent>快捷键列表</TooltipContent></Tooltip>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" sideOffset={8} className="w-auto min-w-0 gap-0 p-0">
              <div className="shortcut-panel" role="dialog" aria-label="快捷键列表">
                <header className="shortcut-panel-head"><span>快捷键列表</span>
                  <button type="button" className="shortcut-panel-close" aria-label="关闭快捷键列表"
                    onClick={() => setShortcuts(false)}>×</button></header>
                <ul className="shortcut-panel-list">{shortcutItems.map(([action, keys]) => <li key={action}>
                  <span className="shortcut-action">{action}</span><span className="shortcut-keys">{keys}</span></li>)}</ul>
              </div>
            </PopoverContent>
          </Popover>
          <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm"
            aria-label="调试面板" aria-pressed={debugConsoleOpen} onClick={() => setDebugConsoleOpen((open) => !open)} />}><Terminal /></TooltipTrigger><TooltipContent>调试面板</TooltipContent></Tooltip>
        </div>
        <BoardStatusBar />
      </footer>}
    </div>
    {!preview && <SceneContextMenuHost rootActions={{
      openRoot, edit3D: () => changeEditing(true),
      renamePage: () => openPageRename(),
      addPage: createBoardPage, deletePage: () => requestDelete({ kind: "page", id: state.settings.boardActivePageId, name: activePage.name }),
      canDeletePage: state.settings.boardPages.length > 1,
    }} />}
    <Dialog open={pageDialog} onOpenChange={(open) => { if (!open) setPageDialog(false); }}>
      <DialogContent className="sm:max-w-[360px]!">
        <DialogHeader><DialogTitle>重命名子看板</DialogTitle></DialogHeader>
        <Input aria-label="子看板名称" value={pageNameDraft} maxLength={100}
          onChange={(event) => setPageNameDraft(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && renameActiveBoardPage()} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setPageDialog(false)}>取消</Button>
          <Button onClick={renameActiveBoardPage}>确定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(deleteDialog)} onOpenChange={(open) => { if (!open) setDeleteDialog(null); }}>
      <DialogContent className="sm:max-w-[400px]!">
        <DialogHeader><DialogTitle>删除提醒</DialogTitle></DialogHeader>
        <div className="board-delete-confirm">
          <TriangleAlert size={22} className="board-delete-confirm-icon" aria-hidden="true" />
          <span>{deleteDialog?.kind === "page" ? `是否删除${deleteDialog.name}？` : deleteDialog?.kind === "foreground" ? "是否删除前景看板？" : "是否删除背景看板？"}</span>
        </div>
        <label className="board-delete-skip"><input type="checkbox" checked={skipDeleteConfirm}
          onChange={(event) => setSkipDeleteConfirm(event.currentTarget.checked)} />不再提示</label>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleteDialog(null)}>取消</Button>
          <Button onClick={confirmDeleteDialog}>确定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {preview && <PreviewExitHint onExit={() => setPreview(false)} />}
    {state.saveError && <div className="save-error" role="alert">{state.saveError}</div>}
  </div>;
}

// 预览态退出浮标（对齐山海鲸：满屏预览不保留顶栏）：鼠标移动时浮现，闲置 2.6s 后淡出，Esc 亦可退出
function PreviewExitHint({ onExit }: { onExit: () => void }) {
  const [visible, setVisible] = useState(true);
  const idleTimer = useRef(0);
  useEffect(() => {
    const awaken = () => {
      setVisible(true);
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setVisible(false), 2600);
    };
    awaken();
    window.addEventListener("pointermove", awaken);
    return () => { window.removeEventListener("pointermove", awaken); window.clearTimeout(idleTimer.current); };
  }, []);
  return <Button size="sm" className={`preview-exit ${visible ? "" : "is-idle"}`}
    aria-label="退出预览" onClick={onExit}><FullScreen />退出预览</Button>;
}
