import { flattenScene } from "../workers/sceneModel";
import { getSceneBridge } from "../workers/bridge";
import { BACKGROUND_BOARD_PAGE_ID, FOREGROUND_BOARD_PAGE_ID, dataAt, defaultEditorSettings, type EditorSettings, type Interaction } from "../data/editor";
import { executeBoardScript } from "../data/scriptRuntime";
import type { FlatInstance, SceneNode } from "../types";
import type { BoardSize } from "../state/projects";
import { CanvasHost } from "./canvasHost";
import { computeViewOrigin } from "../engine/viewOrigin";
import { BoardRenderer } from "./boardRenderer";
import { showToast } from "./toast";
import { LiveDataManager } from "../data/liveData";
import { databaseGatewayUrl, setDatabaseToken } from "../data/localDatabase";
import { triggerDataEdge } from "../data/interactionEdges";
import { entranceAnimations, interactionSchedule } from "../data/interactionAnimation";
import { changeKitTab, resolveRuntimeScene, scaleBackgroundWidgets, type LiveValues, type RuntimeOverrides } from "../data/runtimeScene";
import { applyInteractionSettings, applyScriptKitOption, setPlaybackFullscreen } from "../data/interactionSettings";
import { readBoardMedia } from "../state/boardMedia";
import { updateKitLinkage, updateKitSelection } from "../data/kitLinkage";

export interface ViewerProject {
  projectId: string;
  projectName: string;
  tree: SceneNode[];
  settings: EditorSettings;
  params?: Record<string, unknown>;
  boardSize: BoardSize;
  template?: "empty" | "campus";
}

export interface ViewerHandle { dispose(): void; }

/** 成品运行时使用与编辑器相同的看板规则、公共数据和背景媒体。 */
export function startViewer(project: ViewerProject, root: HTMLElement): ViewerHandle {
  let scene: SceneNode[] = project.tree;
  let settings: EditorSettings = project.settings ?? structuredClone(defaultEditorSettings);
  let viewOrigin = computeViewOrigin(project.tree);
  const runtime: RuntimeOverrides = {};
  const interactionTimers = new Set<number>();
  const cancelPendingInteractions = () => {
    for (const timer of interactionTimers) window.clearTimeout(timer);
    interactionTimers.clear();
  };
  let liveData: LiveValues = Object.fromEntries(settings.boardSharedData
    .filter((item) => item.enabled && !item.source && item.data).map((item) => [item.id, item.data!]));
  if (project.params) liveData["builtin:project-params"] = project.params;
  let sharedStaticIds = new Set(settings.boardSharedData.filter((item) => !item.source).map((item) => item.id));
  let scale = 1;
  let scaleY: number | undefined;
  const activePage = () => settings.boardPages.find((page) => page.id === settings.boardActivePageId) ?? settings.boardPages[0];
  const activeScene = () => {
    const visible = scene.filter((node) => node.type !== "widget" ||
      !node.boardPageId || node.boardPageId === settings.boardActivePageId ||
      node.boardPageId === BACKGROUND_BOARD_PAGE_ID || node.boardPageId === FOREGROUND_BOARD_PAGE_ID)
      .sort((a, b) => {
      if (a.type !== "widget" || b.type !== "widget") return 0;
      const weight = (node: SceneNode) => node.boardPageId === FOREGROUND_BOARD_PAGE_ID ? 2
        : node.boardPageId === BACKGROUND_BOARD_PAGE_ID ? 0 : 1;
      return weight(a) - weight(b);
      });
    const page = activePage() ?? project.boardSize;
    return scaleBackgroundWidgets(visible, settings.boardBackgroundPage, page, settings.boardForegroundPage);
  };

  const page = document.createElement("div");
  page.className = "viewer-page is-preview";
  page.style.backgroundColor = settings.boardFillColor;
  const board = document.createElement("div");
  board.className = "board-canvas";
  const backdrop = document.createElement("div");
  backdrop.className = "viewer-board-backdrop viewer-board-backdrop-page";
  backdrop.setAttribute("aria-hidden", "true");
  const sharedBackdrop = document.createElement("div");
  sharedBackdrop.className = "viewer-board-backdrop viewer-board-backdrop-shared";
  sharedBackdrop.setAttribute("aria-hidden", "true");
  const pageColor = document.createElement("div");
  pageColor.className = "viewer-board-page-color";
  pageColor.setAttribute("aria-hidden", "true");
  const hostContainer = document.createElement("div");
  board.append(sharedBackdrop, pageColor, backdrop, hostContainer);
  page.appendChild(board);
  root.replaceChildren(page);

  let flatBase = flattenScene(scene);
  const mergedFlat = (): FlatInstance[] =>
    Object.keys(runtime).length || Object.keys(liveData).length || settings.boardDataConditions?.length
      ? flattenScene(resolveRuntimeScene(scene, liveData, runtime, settings.boardDataConditions), true) : flatBase;

  const canvasHost = new CanvasHost(hostContainer, {
    getFlat: () => mergedFlat(),
    getScene: () => resolveRuntimeScene(activeScene(), liveData, runtime, settings.boardDataConditions),
    getSettings: () => settings,
    getViewOrigin: () => viewOrigin,
    onPick: (id, trigger) => {
      if (!id) return;
      const node = resolveRuntimeScene(activeScene(), liveData, runtime, settings.boardDataConditions).find((item) => item.id === id);
      if (node) runInteractions(node, trigger);
    },
  });
  const boardRenderer = new BoardRenderer(board, {
    onClick: (node) => runInteractions(node, "click"),
    onDoubleClick: (node) => runInteractions(node, "dblclick"),
    onComponentEvent: (node, event, value, payload) => {
      if (event === "itemClick") {
        const visible = activeScene();
        const linked = updateKitLinkage(visible, liveData, runtime, node, payload, value);
        const next = updateKitSelection(visible, linked, node, payload, value);
        if (next !== runtime) { Object.assign(runtime, next); refreshRuntime(); }
      }
      runInteractions(node, event, value, payload);
    },
    onKitMenuClear: node => {
      const visible = activeScene();
      const linked = updateKitLinkage(visible, liveData, runtime, node, "", "");
      const next = updateKitSelection(visible, linked, node, "", "");
      if (next !== runtime) { Object.assign(runtime, next); refreshRuntime(); }
    },
    onDialogAction: node => {
      runtime[node.id] = { ...runtime[node.id], visible: false };
      refreshRuntime();
    },
    onKitTabChange: (node, index) => {
      runtime[node.id] = changeKitTab(runtime[node.id], index);
      refreshRuntime();
    },
    onBackgroundClick: () => runBoardInteractions("click"),
    onBackgroundDoubleClick: () => runBoardInteractions("dblclick"),
  });
  const onBoardBackgroundClick = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest(".rust-board-layer")) return;
    runBoardInteractions("click");
  };
  const onBoardBackgroundDoubleClick = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest(".rust-board-layer")) return;
    runBoardInteractions("dblclick");
  };
  board.addEventListener("click", onBoardBackgroundClick);
  board.addEventListener("dblclick", onBoardBackgroundDoubleClick);

  const renderBoard = () => {
    board.classList.toggle("has-3d", mergedFlat().length > 0);
    const sharedStyle = settings.boardBackgroundPage.style;
    board.style.background = settings.boardBackgroundEnabled ? settings.boardColor
      : sharedStyle.boardBackgroundEnabled ? sharedStyle.boardColor ?? "transparent" : "transparent";
    pageColor.style.background = settings.boardBackgroundEnabled ? settings.boardColor : "transparent";
    const page = activePage();
    boardRenderer.render({ scene: activeScene(), runtime, liveData, conditions: settings.boardDataConditions,
      boardWidth: page?.width ?? project.boardSize.width, boardHeight: page?.height ?? project.boardSize.height, scale, scaleY,
      responsiveSize: settings.boardFit === "responsive" ? { width: window.innerWidth, height: window.innerHeight } : undefined });
  };

  let backgroundObjectUrl = "";
  let sharedBackgroundObjectUrl = "";
  let musicObjectUrl = "";
  let mediaRevision = 0;
  const audio = document.createElement("audio");
  audio.loop = true;
  audio.preload = "auto";
  audio.hidden = true;
  audio.setAttribute("aria-label", "看板背景音乐");
  page.appendChild(audio);

  const mediaSource = async (id: string): Promise<{ url: string; type: string; objectUrl: boolean }> => {
    if (!id) return { url: "", type: "", objectUrl: false };
    if (/^https?:\/\//i.test(id)) return { url: id, type: "", objectUrl: false };
    if (id.startsWith("./") || id.startsWith("media/")) {
      const url = new URL(id, window.location.href).href;
      const type = /\.(mp4|webm|mov)$/i.test(id) ? "video/mp4" : "";
      return { url, type, objectUrl: false };
    }
    const record = await readBoardMedia(id);
    return record ? { url: URL.createObjectURL(record.blob), type: record.type, objectUrl: true } : { url: "", type: "", objectUrl: false };
  };

  const updateMedia = () => {
    const revision = ++mediaRevision;
    const sharedStyle = settings.boardBackgroundPage.style;
    const musicSettings = settings.boardMusicEnabled || !sharedStyle.boardMusicEnabled ? settings : sharedStyle;
    void Promise.all([mediaSource(settings.boardBackgroundMediaId), mediaSource(musicSettings.boardMusicId ?? ""),
      mediaSource(sharedStyle.boardBackgroundMediaId ?? "")]).then(([background, music, sharedBackground]) => {
      if (revision !== mediaRevision) {
        for (const item of [background, music, sharedBackground]) if (item.objectUrl) URL.revokeObjectURL(item.url);
        return;
      }
      if (backgroundObjectUrl) URL.revokeObjectURL(backgroundObjectUrl);
      if (sharedBackgroundObjectUrl) URL.revokeObjectURL(sharedBackgroundObjectUrl);
      if (musicObjectUrl) URL.revokeObjectURL(musicObjectUrl);
      backgroundObjectUrl = background.objectUrl ? background.url : "";
      sharedBackgroundObjectUrl = sharedBackground.objectUrl ? sharedBackground.url : "";
      musicObjectUrl = music.objectUrl ? music.url : "";
      const drawBackdrop = (container: HTMLElement, source: { url: string; type: string }, style: typeof sharedStyle) => {
        container.replaceChildren();
        if (!style.boardBackgroundEnabled || !source.url) return;
        const isVideo = source.type.startsWith("video/");
        const tile = style.boardBackgroundFill === "tile" && !isVideo;
        const media = isVideo ? document.createElement("video") : tile ? document.createElement("div") : document.createElement("img");
        if (media instanceof HTMLVideoElement) { media.src = source.url; media.autoplay = true; media.loop = true; media.muted = true; media.playsInline = true; }
        else if (media instanceof HTMLImageElement) { media.src = source.url; media.alt = ""; }
        else { media.style.backgroundImage = `url(${JSON.stringify(source.url)})`; media.style.backgroundRepeat = "repeat"; }
        media.className = "viewer-board-background-media";
        const element = media as HTMLElement;
        element.style.filter = `blur(${style.boardBackgroundBlur ?? 0}px)`;
        element.style.transform = "scale(1.04)";
        if (media instanceof HTMLImageElement || media instanceof HTMLVideoElement) {
          media.style.objectFit = style.boardBackgroundFill === "stretch" ? "fill"
            : style.boardBackgroundFill === "none" ? "none" : "contain";
        }
        container.appendChild(media);
      };
      drawBackdrop(backdrop, background, settings);
      drawBackdrop(sharedBackdrop, sharedBackground, sharedStyle);
      audio.src = music.url;
      audio.volume = Math.max(0, Math.min(1, (musicSettings.boardMusicVolume ?? 100) / 100));
      if (musicSettings.boardMusicEnabled && music.url) void audio.play().catch(() => {});
      else audio.pause();
    }).catch(() => { backdrop.replaceChildren(); sharedBackdrop.replaceChildren(); });
  };

  const playAudioAfterGesture = () => {
    const musicEnabled = settings.boardMusicEnabled || settings.boardBackgroundPage.style.boardMusicEnabled;
    if (musicEnabled && audio.src) void audio.play().catch(() => {});
  };
  page.addEventListener("pointerdown", playAudioAfterGesture);
  const toggleMusic = () => {
    if (!audio.src) return;
    if (audio.paused) void audio.play().catch(() => {}); else audio.pause();
  };
  window.addEventListener("dw:toggle-board-music", toggleMusic);
  updateMedia();

  const dataManager = new LiveDataManager((update) => {
    if (!update.data && !update.clear) return;
    liveData = { ...liveData };
    if (update.clear) delete liveData[update.id];
    if (update.data) liveData[update.id] = update.data;
    canvasHost.syncScene(mergedFlat());
    canvasHost.syncEnvironment();
    renderBoard();
    checkDataInteractions();
  });

  const layout = () => {
    const width = window.innerWidth, height = window.innerHeight;
    const boardPage = activePage();
    const { width: boardWidth, height: boardHeight } = boardPage ?? project.boardSize;
    page.style.backgroundColor = settings.boardFillColor;
    page.classList.toggle("is-scroll-fit", settings.boardFit === "cover" || settings.boardFit === "original");
    if (settings.boardFit === "stretch" || settings.boardFit === "responsive") {
      board.style.width = "100%";
      board.style.height = "100%";
      scale = settings.boardFit === "responsive" ? 1 : width / boardWidth;
      scaleY = settings.boardFit === "responsive" ? undefined : height / boardHeight;
    } else {
      scale = settings.boardFit === "cover" ? Math.max(width / boardWidth, height / boardHeight)
        : settings.boardFit === "original" ? 1 : Math.min(width / boardWidth, height / boardHeight);
      scaleY = undefined;
      board.style.width = `${boardWidth * scale}px`;
      board.style.height = `${boardHeight * scale}px`;
    }
    renderBoard();
  };

  function activatePage(target: string, animate = true): boolean {
    const page = settings.boardPages.find((item) => item.id === target || item.name === target);
    if (!page) return false;
    if (page.id === settings.boardActivePageId) return true;
    cancelPendingInteractions();
    settings = { ...settings, ...page.style, boardActivePageId: page.id, boardActiveStateId: "",
      boardDefaultState: { ...settings.boardDefaultState, ...page.style } };
    if (animate && settings.boardCarouselAnimation !== "none") {
      board.style.animationDuration = `${settings.boardCarouselDuration}s`;
      board.classList.remove("board-page-fade", "board-page-slide", "board-page-slideX", "board-page-slideY", "board-page-zoom");
      void board.offsetWidth;
      board.classList.add(`board-page-${settings.boardCarouselAnimation}`);
      window.setTimeout(() => board.classList.remove(`board-page-${settings.boardCarouselAnimation}`), Math.max(100, settings.boardCarouselDuration * 1000));
    }
    updateMedia();
    layout();
    runBoardInteractions("boardActive");
    checkDataInteractions();
    return true;
  }

  function refreshRuntime(): void {
    canvasHost.syncScene(mergedFlat());
    canvasHost.syncEnvironment();
    renderBoard();
  }

  function performRule(rule: Interaction, node: SceneNode | null, event: Interaction["event"], triggerPayload?: unknown): boolean {
    const id = rule.targetId || node?.id || "";
    const target = id ? activeScene().find((item) => item.id === id) ?? scene.find((item) => item.id === id) : undefined;
    const hasTarget = ["focus", "color", "state", "text", "dialog", "componentCustom", "toggle", "show", "hide", "playEntrance"].includes(rule.action);
    if (hasTarget && !target) { showToast("请先选择有效的目标组件"); return false; }
    let value: unknown = rule.value;
    try { value = JSON.parse(rule.value); } catch { /* Free text parameters are allowed for text and event actions. */ }
    if (!rule.value.trim() && triggerPayload !== undefined) value = triggerPayload;
    if (rule.action === "modify") {
      const result = applyInteractionSettings(rule, node, scene, runtime, value,
        triggerPayload, liveData["builtin:project-params"]);
      if (result === "invalid") showToast("修改设置需要 JSON 对象");
      if (result === "missing") showToast("请先选择有效的目标组件");
      return result === "changed";
    }
    if (rule.action === "message") showToast(rule.value || target?.name || node?.name || "交互已触发");
    else if (rule.action === "refresh") window.dispatchEvent(new Event("dw:refresh-data"));
    else if (rule.action === "fullscreen") {
      setPlaybackFullscreen(rule.value, () => showToast("当前环境不支持全屏"));
    } else if (rule.action === "logout") window.dispatchEvent(new Event("dw:logout"));
    else if (rule.action === "boardState") {
      const style = rule.value ? settings.boardStates.find((item) => item.id === rule.value)?.style : settings.boardDefaultState;
      if (!style) showToast("目标看板状态不存在");
      else { settings = { ...settings, ...style, boardActiveStateId: rule.value }; updateMedia(); layout(); }
    }
    else if (rule.action === "projectParams" || rule.action === "payload") {
      const object = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : { value };
      const sourceId = rule.action === "projectParams" ? "builtin:project-params" : "builtin:payload";
      const data = rule.action === "payload" ? { ...object, payload: object } : { ...liveData[sourceId], ...object };
      liveData = { ...liveData, [sourceId]: data };
      window.dispatchEvent(new CustomEvent(rule.action === "projectParams" ? "dw:project-params" : "dw:payload",
        { detail: rule.action === "projectParams" ? data : object }));
      refreshRuntime();
      checkDataInteractions();
    } else if (rule.action === "passEvent" || rule.action === "devEvent") {
      window.dispatchEvent(new CustomEvent(rule.action === "passEvent" ? "dw:pass-event" : "dw:dev-event", {
        detail: { name: rule.actionEventName || rule.triggerValue || rule.value || "interaction", payload: value },
      }));
    } else if (rule.action === "script") {
      const script = settings.boardScripts.find((item) => item.id === rule.value);
      if (!script?.enabled || !script.code.trim()) showToast("脚本未启用或内容为空");
      else executeBoardScript(script, event, { nodeId: node?.id ?? null, targetId: id, payload: triggerPayload }, (message) => {
        const targetId = typeof message.targetId === "string" ? message.targetId : "";
        const active = scene.find((item) => item.id === targetId);
        if (message.type === "event" && typeof message.name === "string") window.dispatchEvent(new CustomEvent("dw:dev-event", { detail: { name: message.name, payload: message.payload } }));
        else if (message.type === "kitOption") {
          if (applyScriptKitOption(active, runtime, message.key, message.value)) refreshRuntime();
        } else if (message.type === "refresh") window.dispatchEvent(new Event("dw:refresh-data"));
        else if (message.type === "message") showToast(String(message.text ?? ""));
        else if (message.type === "navigate" && typeof message.target === "string") window.dispatchEvent(new CustomEvent("dw:navigate-board", { detail: { target: message.target } }));
        else if (active && ["text", "visible", "color"].includes(String(message.type))) {
          if (message.type === "text") runtime[targetId] = { ...runtime[targetId], text: String(message.text ?? "") };
          if (message.type === "visible") runtime[targetId] = { ...runtime[targetId], visible: Boolean(message.visible) };
          if (message.type === "color" && typeof message.color === "string" && /^#[0-9a-f]{6}$/i.test(message.color)) runtime[targetId] = { ...runtime[targetId], color: message.color };
          refreshRuntime();
        }
      }, (message) => showToast(`脚本执行失败：${message}`));
    } else if (rule.action === "openUrl") {
      try {
        const url = new URL(rule.value, window.location.href);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("仅支持 HTTP 或 HTTPS 链接");
        window.open(url.href, "_blank", "noopener,noreferrer");
      } catch (error) { showToast(error instanceof Error ? error.message : "链接无效"); }
    } else if (rule.action === "navigateBoard") {
      window.dispatchEvent(new CustomEvent("dw:navigate-board", { detail: { target: rule.value } }));
      showToast(rule.value ? `请求跳转看板：${rule.value}` : "请填写目标看板");
    } else if (target && rule.action === "playEntrance") {
      const dataPatch = runtime[id]?.dataPatch ?? {};
      runtime[id] = { ...runtime[id], dataPatch: { ...dataPatch,
        __dwEntrance: entranceAnimations(rule, dataPatch.__dwEntrance) } };
    } else if (rule.action === "componentCustom") {
      window.dispatchEvent(new CustomEvent("dw:component-action", { detail: { targetId: id, name: rule.actionEventName || rule.triggerValue || "custom", payload: value } }));
    } else if (rule.action === "focus") window.dispatchEvent(new CustomEvent("dw:camera", { detail: { preset: "focus", ids: [id] } }));
    else if (target && rule.action === "color" && /^#[0-9a-f]{6}$/i.test(rule.value)) runtime[id] = { ...runtime[id], color: rule.value };
    else if (target && rule.action === "text") runtime[id] = { ...runtime[id], text: rule.value };
    else if (target && rule.action === "state") {
      if (!target.widget || (rule.value && !target.widget.states?.some(item => item.id === rule.value))) {
        showToast("目标组件没有这个状态"); return false;
      }
      runtime[id] = { ...runtime[id], stateId: rule.value || undefined };
    } else if (target && (rule.action === "dialog" || ["toggle", "show", "hide"].includes(rule.action))) {
      const mode = rule.action === "dialog" ? ["open", "close"].includes(rule.value) ? rule.value : "toggle" : rule.action;
      const current = resolveRuntimeScene(scene, liveData, runtime, settings.boardDataConditions).find((item) => item.id === id)?.visible ?? target.visible;
      runtime[id] = { ...runtime[id], visible: mode === "open" || mode === "show" ? true : mode === "close" || mode === "hide" ? false : !current };
    } else if (rule.action === "none") return false;
    else return false;
    return ["color", "text", "state", "dialog", "toggle", "show", "hide", "playEntrance"].includes(rule.action);
  }

  function runRules(rules: Interaction[], node: SceneNode | null, event: Interaction["event"], triggerValue?: string, triggerPayload?: unknown): void {
    let changed = false;
    const matching = rules.filter(rule => rule.event === event
      && !(event === "custom" && rule.triggerValue && rule.triggerValue !== triggerValue)
      && !(["itemClick", "componentSelected", "componentUnselected"].includes(event)
        && rule.itemValue && rule.itemValue !== triggerValue));
    for (const { rule, at } of interactionSchedule(matching)) {
      if (at > 0) {
        const timer = window.setTimeout(() => {
          interactionTimers.delete(timer);
          if (performRule(rule, node, event, triggerPayload)) refreshRuntime();
        }, at);
        interactionTimers.add(timer);
      } else if (performRule(rule, node, event, triggerPayload)) changed = true;
    }
    if (changed) refreshRuntime();
  }

  function runInteractions(node: SceneNode, event: Interaction["event"], triggerValue?: string, triggerPayload?: unknown): void {
    runRules(node.interactions ?? [], node, event, triggerValue, triggerPayload);
  }

  function runBoardInteractions(
    event: "click" | "dblclick" | "boardActive" | "custom", triggerValue?: string, triggerPayload?: unknown,
  ): void {
    runRules(settings.boardInteractions, null, event, triggerValue, triggerPayload);
    if (event !== "custom") return;
    for (const node of activeScene()) runRules(node.interactions ?? [], node, event, triggerValue, triggerPayload);
  }

  const matchCondition = (rule: Interaction): boolean => {
    const condition = rule.condition;
    if (rule.event !== "data" || !condition) return false;
    const value = dataAt(liveData[condition.sourceId], condition.field);
    if (value === undefined) return false;
    const left = Number(value), right = Number(condition.value);
    switch (condition.op) {
      case "==": return String(value) === condition.value;
      case "!=": return String(value) !== condition.value;
      case ">": return Number.isFinite(left) && Number.isFinite(right) && left > right;
      case "<": return Number.isFinite(left) && Number.isFinite(right) && left < right;
      case ">=": return Number.isFinite(left) && Number.isFinite(right) && left >= right;
      case "<=": return Number.isFinite(left) && Number.isFinite(right) && left <= right;
      case "contains": return Array.isArray(value) ? value.some((item) => String(item) === condition.value) : String(value).includes(condition.value);
    }
  };
  const dataMatches = new Map<string, boolean>();
  function checkDataInteractions(): void {
    const rules = settings.boardInteractions.map((rule) => ({ key: `board:${rule.id}`, rule }));
    const keys = new Set(rules.map((item) => item.key));
    for (const key of dataMatches.keys()) if (!keys.has(key)) dataMatches.delete(key);
    for (const item of rules) {
      if (item.rule.event !== "data") continue;
      triggerDataEdge(dataMatches, item.key, matchCondition(item.rule), () => runRules([item.rule], null, "data"));
    }
  }

  const activeDevEvents = new Set<string>();
  const onDevEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ name?: string; payload?: unknown }>).detail;
    const name = detail?.name ?? "";
    if (activeDevEvents.has(name)) return;
    activeDevEvents.add(name);
    try { runBoardInteractions("custom", name, detail?.payload); } finally { activeDevEvents.delete(name); }
  };
  const onNavigateBoard = (event: Event) => {
    const target = String((event as CustomEvent<{ target?: string }>).detail?.target ?? "");
    if (activatePage(target)) return;
    const url = new URL("viewer.html", window.location.href);
    url.searchParams.set("projectId", target);
    window.location.assign(url.href);
  };
  window.addEventListener("dw:dev-event", onDevEvent);
  window.addEventListener("dw:navigate-board", onNavigateBoard);
  const onRefreshData = (event: Event) => dataManager.refresh((event as CustomEvent<{ id?: string }>).detail?.id);
  window.addEventListener("dw:refresh-data", onRefreshData);
  let databaseDialog: HTMLDialogElement | null = null;
  const dismissedDatabaseUrls = new Set<string>();
  let databaseReconnect: HTMLButtonElement | null = null;
  const onDatabaseTokenRequired = (event: Event) => {
    if (databaseDialog?.open) return;
    let url: string;
    try { url = databaseGatewayUrl(String((event as CustomEvent<{ url?: string }>).detail?.url ?? "")); } catch { return; }
    if (dismissedDatabaseUrls.has(url)) return;
    const dialog = document.createElement("dialog"); databaseDialog = dialog; dialog.className = "viewer-database-dialog";
    const title = document.createElement("h3"); title.textContent = "连接本机数据库服务";
    const description = document.createElement("p"); description.textContent = `请输入 ${url} 的服务令牌`;
    const form = document.createElement("form");
    const input = document.createElement("input"); input.type = "password"; input.required = true; input.autocomplete = "off"; input.setAttribute("aria-label", "数据库服务令牌");
    const actions = document.createElement("div");
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "取消";
    const submit = document.createElement("button"); submit.type = "submit"; submit.textContent = "连接";
    const dismiss = () => { dismissedDatabaseUrls.add(url); dialog.close(); dialog.remove(); databaseDialog = null;
      if (!databaseReconnect) { databaseReconnect = document.createElement("button"); databaseReconnect.className = "viewer-database-reconnect"; databaseReconnect.textContent = "连接数据库"; page.appendChild(databaseReconnect); }
      databaseReconnect.onclick = () => { dismissedDatabaseUrls.delete(url); databaseReconnect?.remove(); databaseReconnect = null; onDatabaseTokenRequired(new CustomEvent("dw:database-token-required", { detail: { url } })); }; };
    cancel.addEventListener("click", dismiss);
    dialog.addEventListener("cancel", (cancelEvent) => { cancelEvent.preventDefault(); dismiss(); });
    form.addEventListener("submit", (submitEvent) => { submitEvent.preventDefault(); setDatabaseToken(url, input.value); dialog.close(); dialog.remove(); databaseDialog = null; dataManager.refresh(); });
    actions.append(cancel, submit); form.append(input, actions); dialog.append(title, description, form); page.appendChild(dialog); dialog.showModal(); input.focus();
  };
  window.addEventListener("dw:database-token-required", onDatabaseTokenRequired);
  let carouselTimer = 0;
  const syncCarouselTimer = () => {
    window.clearInterval(carouselTimer);
    if (!settings.boardCarouselEnabled || settings.boardPages.length < 2) return;
    carouselTimer = window.setInterval(() => {
      const index = settings.boardPages.findIndex((item) => item.id === settings.boardActivePageId);
      const next = settings.boardPages[(index + 1) % settings.boardPages.length];
      if (next) activatePage(next.id);
    }, Math.max(100, settings.boardPageDuration * 1000));
  };

  // boardFit 与编辑器预览一致：stretch 拉伸铺满，cover 等比裁切，contain 等比完整
  const bridge = getSceneBridge();
  const unsubscribe = bridge.subscribe((next) => {
    if (next.projectId !== project.projectId) return;
    scene = next.tree;
    settings = next.settings;
    viewOrigin = next.viewOrigin;
    flatBase = next.flat;
    const nextLiveData = { ...liveData };
    for (const id of sharedStaticIds) delete nextLiveData[id];
    for (const item of settings.boardSharedData) if (item.enabled && !item.source && item.data) nextLiveData[item.id] = item.data;
    sharedStaticIds = new Set(settings.boardSharedData.filter((item) => !item.source).map((item) => item.id));
    liveData = nextLiveData;
    dataManager.sync([...scene, ...settings.boardSharedData.map((item) => ({ id: item.id, dataSource: item.enabled && item.source ? { ...item.source, enabled: true } : undefined }))]);
    canvasHost.setHud({ grid: next.settings.grid, flylines: next.settings.flylines, stats: next.settings.stats });
    canvasHost.syncEnvironment();
    canvasHost.syncScene(mergedFlat());
    updateMedia();
    layout();
    checkDataInteractions();
    syncCarouselTimer();
  });
  bridge.post({ type: "openProject", projectId: project.projectId, tree: project.tree, settings, template: project.template ?? "empty" });
  canvasHost.syncScene(flatBase);
  dataManager.sync([...scene, ...settings.boardSharedData.map((item) => ({ id: item.id, dataSource: item.enabled && item.source ? { ...item.source, enabled: true } : undefined }))]);
  layout();
  runBoardInteractions("boardActive");
  checkDataInteractions();
  syncCarouselTimer();

  const fullscreenButton = document.createElement("button");
  fullscreenButton.className = "viewer-fullscreen";
  fullscreenButton.textContent = "全屏";
  fullscreenButton.addEventListener("click", () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => showToast("当前环境不支持全屏"));
  });
  const onFullscreenChange = () => { fullscreenButton.textContent = document.fullscreenElement ? "退出全屏" : "全屏"; };
  document.addEventListener("fullscreenchange", onFullscreenChange);
  page.appendChild(fullscreenButton);

  window.addEventListener("resize", layout);
  return {
    dispose() {
      cancelPendingInteractions();
      board.removeEventListener("click", onBoardBackgroundClick);
      board.removeEventListener("dblclick", onBoardBackgroundDoubleClick);
      window.removeEventListener("resize", layout);
      window.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("dw:dev-event", onDevEvent);
      window.removeEventListener("dw:navigate-board", onNavigateBoard);
      window.removeEventListener("dw:refresh-data", onRefreshData);
      window.removeEventListener("dw:database-token-required", onDatabaseTokenRequired);
      databaseDialog?.remove();
      window.removeEventListener("dw:toggle-board-music", toggleMusic);
      page.removeEventListener("pointerdown", playAudioAfterGesture);
      unsubscribe();
      dataManager.dispose();
      canvasHost.dispose();
      boardRenderer.dispose();
      ++mediaRevision;
      window.clearInterval(carouselTimer);
      if (backgroundObjectUrl) URL.revokeObjectURL(backgroundObjectUrl);
      if (sharedBackgroundObjectUrl) URL.revokeObjectURL(sharedBackgroundObjectUrl);
      if (musicObjectUrl) URL.revokeObjectURL(musicObjectUrl);
      page.remove();
    },
  };
}
