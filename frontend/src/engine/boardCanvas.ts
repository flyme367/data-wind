import { loadCpuModule } from "./cpuClient";
import { loadEngineModule } from "./engineClient";
import { probeWebGPU } from "./gpuProbe";
import { boardClock, boardHasMotion, boardNodes, boardUsesSecondClock, type RustBoardNode } from "./boardScene";
import { prepareKitMetricAnimations, prepareKitTextAnimations, type MetricAnimation, type TextAnimation } from "./kitMetricAnimation";
import { advanceKitList, advanceKitListSelection, isKitList, kitListInfo, kitListItem, kitListSelectionMatch,
  type KitListTransition } from "./kitList";
import { kitSelectionControlValue } from "./kitSelection";
import { decodePreviewFrame, type CaptureSize } from "./captureFrame";
import { decodeHitResult, encodeBoardClock, encodeBoardSync, encodeGeoJsonDocument, encodeSetValue } from "./commands";
import { dispatchCommandResponse } from "./commandResponse";
import { BoardAction } from "../protocol/generated/data-wind-protocol";
import { makeProjector, MAP_VIEW, mapTileWindow, REGION_VIEWS } from "../data/mapSvg";
import { descendants, isChartWidget } from "../data/editor";
import { KitWeatherService } from "../data/kitWeather";
import { kitMetadata, type ReferenceKitPiece } from "../data/kitRuntime";
import { drawKitScene, kitSceneGeometry } from "./kitScenePreview";
import type { SceneNode } from "../types";

type Surface = Awaited<ReturnType<typeof loadCpuModule>>["BoardCanvas"]["prototype"];
interface Hit { id: string; handle: string | null; control: boolean }
type BoardComponentEvent = "click" | "dblclick" | "mouseenter" | "mouseleave" | "componentEnter"
  | "componentLeave" | "componentSelected" | "componentUnselected" | "itemClick";
export type BoardDialogAction = "close" | "cancel" | "confirm";
export interface BoardState {
  scene: SceneNode[]; boardWidth: number; boardHeight: number;
  scale: number; scaleY?: number; preview: boolean; selected?: string[]; hidden?: boolean;
}
export type BoardEdit = { type: "move"; ids: string[]; dx: number; dy: number }
  | { type: "resize"; id: string; x: number; y: number; width: number; height: number };
export interface BoardHostOptions {
  onClick?: (node: SceneNode) => void;
  onDoubleClick?: (node: SceneNode) => void;
  onComponentEvent?: (node: SceneNode, event: BoardComponentEvent, value?: string, payload?: unknown) => void;
  onKitMenuClear?: (node: SceneNode) => void;
  onDialogAction?: (node: SceneNode, action: BoardDialogAction) => void;
  onKitTabChange?: (node: SceneNode, index: number) => void;
  onBackgroundClick?: () => void;
  onBackgroundDoubleClick?: () => void;
  onBackgroundSelect?: () => void;
  onSelect?: (id: string, additive: boolean) => void;
  onEdit?: (edit: BoardEdit) => void;
  onContextMenu?: (id: string, x: number, y: number) => void;
  getSnap?: () => number;
}
interface Drag {
  node: RustBoardNode; ids: string[]; startX: number; startY: number; pointerId: number;
  visualIds: Set<string>;
  handle: string | null; next?: { x: number; y: number; width: number; height: number };
}
interface PendingBoardVisual {
  nodes: RustBoardNode[];
  expected: Pick<RustBoardNode, "id" | "x" | "y" | "width" | "height">[];
  timer: ReturnType<typeof setTimeout>;
}
interface CarouselState {
  index: number; lastSwitch: number; playedOnce: boolean;
  transition: { from: number; to: number; start: number } | null;
}
interface ListTransition extends KitListTransition { startedAt: number }
const LIST_TRANSITION_MS = 400;
interface PdfState { page: number; pages: number }
interface MediaResource {
  key: string; element?: HTMLImageElement | HTMLMediaElement; pending: Promise<void>; dispose: () => void;
  videoFrameReady?: boolean;
  /** 山海鲸媒体扩展状态：轮播图（轮播状态机）/ 轮播视频（多视频队列）/ 基础PDF（页码） */
  carousel?: CarouselState;
  images?: (HTMLImageElement | undefined)[];
  videos?: HTMLVideoElement[];
  pdf?: PdfState;
  pdfDoc?: import("pdfjs-dist").PDFDocumentProxy;
  pdfTask?: { destroy(): Promise<void> };
  createdAt: number;
  /** 监控「隐藏后销毁等待时间」：loaded=false 起的后台保活计时 */
  hiddenAt?: number;
  startedOnce?: boolean;
  /** 图片「外框跟随图片尺寸」已按该地址调整过，避免重复 resize */
  frameApplied?: string;
  /** 合成帧（轮播过渡 / 图片动画）已稳定，无需继续逐帧上传 */
  settled?: boolean;
  imageAnimation?: { key: string; startedAt: number; complete: boolean; hasFrame: boolean };
  /** 播放参数上次同步的秒刻度 */
  synced?: number;
  /** 山海鲸「瓦片地图」在线影像：已加载瓦片与画布尺寸（合成底图 → set_image） */
  imagery?: { tiles: Map<string, { img: HTMLImageElement; x: number; y: number; z: number }>; width: number; height: number };
}

/** 山海鲸「瓦片地图」在线影像源（无 Key、带 CORS 头，可跨域读像素；离线/失败自动回退内置主题矢量）。 */
const IMAGERY_SOURCES: Record<string, (x: number, y: number, z: number) => string> = {
  satellite: (x, y, z) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  street: (x, y, z) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
};
/** 跨节点共享的瓦片缓存（同一视野多组件复用），LRU 上限防内存膨胀。 */
const tileCache = new Map<string, { img: HTMLImageElement; ok: boolean }>();
const TILE_CACHE_MAX = 240;

let geojson: Promise<unknown> | null = null;
/** 世界国界 + 中国省界 + 美国州界合并下发；feature 打 DATASET 标记，渲染端按区域子集取用。 */
function loadGeojson(): Promise<unknown> {
  // 源头是网络 GeoJSON，这里只 JSON.parse 一次，边界内全程 FlatBuffers。
  geojson ??= Promise.all([
    fetch("./gis/ne_110m_admin_0_countries.geojson").then(readGeo),
    fetch("./gis/china-provinces.geojson").then(readGeo),
    fetch("./gis/us-states.geojson").then(readGeo),
  ]).then(([world, china, usa]) => ({
    features: [
      ...(world.features ?? []).map(tag("world")),
      ...(china.features ?? []).map(tag("china")),
      ...(usa.features ?? []).map(tag("usa")),
    ],
  })).catch(error => { geojson = null; throw error; });
  return geojson;
}

async function readGeo(response: Response): Promise<{ features?: Record<string, unknown>[] }> {
  if (!response.ok) throw new Error("地图边界加载失败");
  return response.json();
}

const tag = (dataset: string) => (feature: Record<string, unknown>) => {
  const props = (feature.properties as Record<string, unknown> ?? {});
  const label = String(props.name ?? "");
  // china/usa 数据源用小写 name：china 是中文名 → NAME_ZH；usa 是英文名 → NAME
  return { ...feature, properties: {
    ...props, DATASET: dataset,
    NAME: dataset === "usa" ? label : String(props.NAME ?? label),
    NAME_ZH: dataset === "china" ? label : String(props.NAME_ZH ?? ""),
  } };
};

/** GPU 建面挂死保护：bevy 窗口冷启动超时不再永远卡在「正在加载看板组件…」，落回 CPU 栅格化。 */
function withTimeout<T>(promise: Promise<T>, milliseconds: number, stage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${stage}超时（${Math.round(milliseconds / 1000)}s）`)), milliseconds);
    promise.then(value => { window.clearTimeout(timer); resolve(value); },
      error => { window.clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); });
  });
}

function pixelsCanvas(bytes: Uint8Array): HTMLCanvasElement {
  const frame = decodePreviewFrame(bytes);
  const canvas = document.createElement("canvas");
  canvas.width = frame.width; canvas.height = frame.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法显示 Rust 渲染的像素");
  context.putImageData(new ImageData(frame.pixels, frame.width, frame.height), 0, 0);
  return canvas;
}

/** 山海鲸媒体组件的 kind 白名单（与 Rust WIDGET_KINDS 保持同步，boardScene 测试兜底）。 */
const MEDIA_KINDS = ["image", "video", "monitor", "carousel", "carouselVideo", "pdf", "audio"];
const MEDIA_URL_PATTERN = /^(https?:\/\/|\/|\.\/|data:(image|video|audio|application\/pdf)[;\/]|blob:)/i;
const LEGEND_LEFT_IMAGE_PREFIX = "\u001flegend-left:";
const LEGEND_RIGHT_IMAGE_PREFIX = "\u001flegend-right:";
const TOOLTIP_IMAGE_PREFIX = "\u001ftooltip:";
const POINT_IMAGE_PREFIX = "\u001fpoint:";
const CITY_IMAGE_PREFIX = "\u001fcity:";

function imageCanvasFilter(filter: unknown): string {
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) return "none";
  const settings = filter as Record<string, number>;
  const value = (key: string, fallback: number, minimum: number, maximum: number) => {
    const number = settings[key];
    return number !== undefined && Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
  };
  return `contrast(${value("contrast", 1, 0, 5)}) saturate(${value("saturate", 1, 0, 5)}) `
    + `brightness(${value("brightness", 1, 0, 5)}) hue-rotate(${value("hue", 0, -360, 360)}deg) blur(${value("blur", 0, 0, 100)}px)`;
}

/** 山海鲸「缓动方式」10 项的进度映射（通用缓动族，下拉名称待实机核对）。 */
function easeValue(progress: number, easing: string): number {
  const x = Math.min(1, Math.max(0, progress));
  switch (easing) {
    case "none": case "linear": return x;
    case "Power1.easeIn": case "easeIn": return x * x;
    case "Power1.easeOut": case "easeOut": return 1 - (1 - x) ** 2;
    case "Back.easeIn": case "backIn": return 2.70158 * x ** 3 - 1.70158 * x * x;
    case "Back.easeOut": case "backOut": { const p = x - 1; return 1 + 2.70158 * p ** 3 + 1.70158 * p * p; }
    case "Back.easeInOut": case "backInOut": return x < 0.5
      ? 2 * (2 * x) ** 2 * ((2.5949095 / 2 + 1) * 2 * x - 2.5949095 / 2) / 2
      : (2 - 2 * (2 * x - 2) ** 2 * ((2.5949095 / 2 + 1) * (2 * x - 2) + 2.5949095 / 2)) / 2;
    case "elasticIn": return x === 0 || x === 1 ? x
      : -(2 ** (10 * x - 10)) * Math.sin((x * 10 - 10.75) * (2 * Math.PI / 3));
    case "elasticOut": return x === 0 || x === 1 ? x
      : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
    case "elasticInOut": return x === 0 || x === 1 ? x : x < 0.5
      ? -(2 ** (20 * x - 10)) * Math.sin((20 * x - 11.125) * (2 * Math.PI / 9)) / 2
      : 2 ** (-20 * x + 10) * Math.sin((20 * x - 11.125) * (2 * Math.PI / 9)) / 2 + 1;
    default: return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2; // easeInOut
  }
}

/** 山海鲸「填充方式」画布合成：在 (x,y,w,h) 区域绘制原始尺寸 sw×sh 的图像。 */
function drawFit(context: CanvasRenderingContext2D, source: CanvasImageSource, sw: number, sh: number,
  fit: string, x: number, y: number, w: number, h: number): void {
  if (fit === "tile") {
    const pattern = context.createPattern(source, "repeat");
    if (pattern) {
      context.save(); context.translate(x, y); context.fillStyle = pattern;
      context.fillRect(0, 0, w, h); context.restore();
    }
    return;
  }
  if (fit === "center") {
    const scale = Math.min(w / sw, h / sh);
    const width = sw * scale, height = sh * scale;
    context.drawImage(source, x + (w - width) / 2, y + (h - height) / 2, width, height);
    return;
  }
  context.drawImage(source, x, y, w, h); // stretch：拉伸填充
}

/** A framework-free input/media host. Every visible component pixel is drawn by Rust. */
export class RustBoardHost {
  readonly ready: Promise<void>;
  private readonly weather = new KitWeatherService(() => {
    if (!this.disposed && this.state) this.render(this.state);
  });
  private readonly layer = document.createElement("div");
  private readonly gpuCanvas = document.createElement("canvas");
  private readonly cpuCanvas = document.createElement("canvas");
  private readonly status = document.createElement("div");
  private readonly textInput = document.createElement("textarea");
  private readonly selectionLayer = document.createElement("div");
  private readonly selectionElements = new Map<string, HTMLElement>();
  private readonly iframeElements = new Map<string, HTMLIFrameElement>();
  private surface: Surface | null = null;
  private state: BoardState | null = null;
  private nodes: RustBoardNode[] = [];
  private disposed = false;
  private dirty = true;
  private raf = 0;
  private lastSecond = -1;
  private lastPaint = 0;
  private buttonRippleUntil = 0;
  private drag: Drag | null = null;
  private previewPress: { id: string; pointerId: number; x: number; y: number } | null = null;
  private pendingVisual: PendingBoardVisual | null = null;
  private hoveredCarouselId: string | null = null;
  private hoveredChartId: string | null = null;
  private hoveredInteractionNodeId: string | null = null;
  private selectedInteractionNodeId: string | null = null;
  private selectedItemValues = new Map<string, string>();
  private listOffsets = new Map<string, number>();
  private listSelections = new Map<string, number>();
  private listPlayback = new Map<string, { lastSwitch: number; started: boolean }>();
  private listTransitions = new Map<string, ListTransition>();
  private listPendingOffsets = new Map<string, { offset: number; direction: 1 | -1 }>();
  private lastListFrame = -Infinity;
  private metricPlayback = new Map<string, MetricAnimation>();
  private textPlayback = new Map<string, TextAnimation>();
  private kitSelectionApplied = new Map<string, string>();
  private lastListTick = -Infinity;
  private previewing = false;
  private inputId: string | null = null;
  private dropdownSearchInput = false;
  private keyboardId: string | null = null;
  private resources = new Map<string, MediaResource>();
  private geoReady = false;
  private geoFailed = false;
  private geoPending: Promise<void> | null = null;
  private observer: ResizeObserver;
  private listeners: (() => void)[] = [];
  private decodeCanvas = document.createElement("canvas");

  constructor(container: HTMLElement, private readonly options: BoardHostOptions = {}) {
    this.layer.className = "rust-board-layer";
    this.layer.dataset.renderer = "rust";
    for (const canvas of [this.gpuCanvas, this.cpuCanvas]) {
      canvas.className = "rust-board-canvas";
      canvas.setAttribute("aria-label", "Rust 看板组件画布");
      canvas.tabIndex = 0;
    }
    this.cpuCanvas.hidden = true;
    this.status.className = "rust-board-status";
    this.status.textContent = "正在加载看板组件…";
    this.status.setAttribute("role", "status");
    this.textInput.className = "rust-board-ime";
    this.textInput.setAttribute("aria-label", "组件输入");
    this.textInput.tabIndex = -1;
    this.selectionLayer.className = "rust-board-selection-layer";
    this.layer.append(this.gpuCanvas, this.cpuCanvas, this.status, this.textInput, this.selectionLayer);
    container.append(this.layer);
    this.observer = new ResizeObserver(() => { this.dirty = true; });
    this.observer.observe(this.layer);
    const root = container.closest<HTMLElement>(".board-canvas") ?? container;
    const on = <T extends Event>(target: EventTarget, name: string, callback: (event: T) => void, capture = false) => {
      const listener = callback as EventListener;
      target.addEventListener(name, listener, capture);
      this.listeners.push(() => target.removeEventListener(name, listener, capture));
    };
    on<PointerEvent>(root, "pointermove", event => {
      if (this.drag) {
        if (this.drag.pointerId === event.pointerId) this.pointerMove(event);
        return;
      }
      if (this.gpuCanvas.hasPointerCapture(event.pointerId) || this.cpuCanvas.hasPointerCapture(event.pointerId)) return;
      const hit = this.hit(event);
      const hitNode = hit && this.nodes.find(node => node.id === hit.id);
      const chartId = this.state?.preview && event.pointerType !== "touch" && hitNode
        && (isChartWidget(hitNode.widget.kind) || hitNode.data.__kitMenu || hitNode.data.__kitButton)
        ? hitNode.id : null;
      const animate = !!chartId && chartId !== this.hoveredChartId && this.animateKitButton(hitNode || undefined, "hover");
      if (chartId || this.hoveredChartId) {
        this.surface?.pointer(animate ? `move@${Date.now()}` : "move", ...this.relative(event));
        this.dirty = true;
      }
      this.hoveredChartId = chartId;
      this.setHoveredInteractionNode(this.state?.preview && event.pointerType !== "touch" && hitNode
        ? hitNode.id : null);
      const hoveredCarousel = hitNode?.widget.kind === "carousel" && hitNode.data.arrows === "hover"
        ? hitNode
        : this.nodes.find(node => node.id === this.hoveredCarouselId && node.widget.kind === "carousel"
          && node.data.arrows === "hover" && this.isInCarouselHoverBounds(node, event));
      this.setHoveredCarousel(hoveredCarousel?.id ?? null);
      for (const canvas of [this.gpuCanvas, this.cpuCanvas]) {
        canvas.style.pointerEvents = hit ? "auto" : "none";
        canvas.style.cursor = hit?.handle ? `${hit.handle}-resize` : this.state?.preview ? "pointer" : "move";
      }
    }, true);
    on<PointerEvent>(root, "pointerleave", event => {
      if (this.gpuCanvas.hasPointerCapture(event.pointerId) || this.cpuCanvas.hasPointerCapture(event.pointerId)) return;
      this.setHoveredCarousel(null);
      this.hoveredChartId = null;
      if (this.state?.preview) {
        this.setHoveredInteractionNode(null);
        this.surface?.pointer("leave", 0, 0);
        this.dirty = true;
      }
    }, true);
    on<WheelEvent>(root, "wheel", event => {
      if (!this.state?.preview || (event.deltaY === 0 && event.deltaX === 0)) return;
      const hit = this.hit(event);
      const visual = this.nodes.find(node => node.id === hit?.id);
      if (event.deltaY !== 0 && visual?.data.__kitDropdown && Array.isArray(visual.data.options)
          && visual.data.options.length > Number((visual.data.__kitDropdown as Record<string, unknown>).maxOptions)) {
        event.preventDefault(); event.stopPropagation();
        this.surface?.pointer(event.deltaY > 0 ? "wheel-down" : "wheel-up", ...this.relative(event));
        this.dirty = true;
        return;
      }
      const menu = visual?.data.__kitMenu as Record<string, unknown> | undefined;
      if (menu?.scroll === true && menu.wheel === true && Array.isArray(visual?.data.items)
          && visual.data.items.length > Number(menu.visibleCount || 3)) {
        event.preventDefault(); event.stopPropagation();
        this.surface?.pointer((event.deltaY || event.deltaX) > 0 ? "wheel-down" : "wheel-up", ...this.relative(event));
        this.dirty = true;
        return;
      }
      const id = visual?.data.__kitListRootId;
      const list = typeof id === "string" ? this.sceneNode(id) : undefined;
      const info = list && kitListInfo(list);
      if (event.deltaY === 0 || !list || !info?.wheel || info.total <= info.capacity) return;
      const current = this.listPendingOffsets.get(list.id)?.offset ?? this.listOffsets.get(list.id) ?? 0;
      const direction = event.deltaY > 0 ? 1 : -1;
      const wrap = info.auto && info.loop && info.infinite;
      const next = wrap ? advanceKitList(list, current, direction)
        : Math.max(0, Math.min(info.total - info.capacity, current + direction));
      if (next === current) return;
      event.preventDefault(); event.stopPropagation();
      this.setKitListOffset(list, next, direction);
    }, true);
    // Touch and pen can press without a preceding hover event.
    on<PointerEvent>(root, "pointerdown", event => {
      if (event.target instanceof Element && event.target.closest(".board-canvas-resize-handle")) return;
      if (event.target === this.gpuCanvas || event.target === this.cpuCanvas) return;
      const hit = this.hit(event);
      if (!hit) {
        if (this.state?.preview) {
          this.surface?.pointer("down", ...this.relative(event)); this.dirty = true;
        }
        if (!this.state?.preview && event.button === 0 && !event.shiftKey) this.options.onBackgroundSelect?.();
        return;
      }
      const canvas = this.surface?.is_gpu() ? this.gpuCanvas : this.cpuCanvas;
      canvas.style.pointerEvents = "auto";
      this.pointerDown(event, canvas);
    }, true);
    on<PointerEvent>(root, "pointerup", event => {
      if (!this.drag || this.drag.pointerId !== event.pointerId) return;
      this.pointerUp(event, this.surface?.is_gpu() ? this.gpuCanvas : this.cpuCanvas);
    }, true);
    on<PointerEvent>(root, "pointercancel", event => {
      if (!this.drag || this.drag.pointerId !== event.pointerId) return;
      this.drag = null; this.sync();
    }, true);
    for (const canvas of [this.gpuCanvas, this.cpuCanvas]) {
      on<KeyboardEvent>(canvas, "keydown", event => {
        if (!this.state?.preview) return;
        const nodes = this.state.scene.filter(node => this.nodes.some(item => item.id === node.id));
        if (!nodes.length) return;
        if (event.key === "Tab") {
          event.preventDefault(); event.stopPropagation();
          const index = nodes.findIndex(node => node.id === this.keyboardId);
          this.keyboardId = nodes[(index + (event.shiftKey ? nodes.length - 1 : 1)) % nodes.length].id;
          this.surface?.focus_node(this.keyboardId); this.dirty = true;
        } else if (["Enter", " "].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          const node = this.sceneNode(this.keyboardId ?? nodes[0].id);
          if (node) {
            this.surface?.activate(node.id); this.drainEvents();
            this.setSelectedInteractionNode(node.id); this.options.onClick?.(node); this.dirty = true;
          }
        }
      });
      on<PointerEvent>(canvas, "pointerdown", event => this.pointerDown(event, canvas));
      on<PointerEvent>(canvas, "pointermove", event => {
        if (!this.state?.preview || canvas.hasPointerCapture(event.pointerId)) this.pointerMove(event);
      });
      on<PointerEvent>(canvas, "pointerup", event => this.pointerUp(event, canvas));
      on<PointerEvent>(canvas, "pointercancel", event => {
        this.surface?.pointer("cancel", 0, 0); this.drag = null; this.previewPress = null; this.sync();
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      });
      on<MouseEvent>(canvas, "dblclick", event => {
        event.stopPropagation(); const node = this.sceneNode(this.hit(event)?.id);
        if (node && this.state?.preview) this.options.onDoubleClick?.(node);
        else if (this.state?.preview) this.options.onBackgroundDoubleClick?.();
      });
      on<MouseEvent>(canvas, "contextmenu", event => {
        event.preventDefault(); event.stopPropagation(); const hit = this.hit(event);
        if (hit && this.state?.preview) {
          const menu = this.nodes.find(node => node.id === hit.id)?.data.__kitMenu as Record<string, unknown> | undefined;
          if (menu?.allowUnselected === true) {
            this.surface?.pointer("context", ...this.relative(event)); this.drainEvents(); this.dirty = true;
          }
        } else if (hit) this.options.onContextMenu?.(hit.id, event.clientX, event.clientY);
      });
    }
    on<InputEvent>(this.textInput, "input", () => {
      if (this.inputId) {
        const value = this.dropdownSearchInput ? { __kitDropdownSearch: this.textInput.value } : this.textInput.value;
        this.surface?.set_value(encodeSetValue(this.inputId, value)); this.drainEvents(); this.dirty = true;
      }
    });
    on<KeyboardEvent>(this.textInput, "keydown", event => {
      event.stopPropagation();
      if (event.key === "Escape" && this.inputId && this.dropdownSearchInput) {
        this.surface?.set_value(encodeSetValue(this.inputId, { __kitDropdownSearch: "", __kitDropdownClose: true }));
        this.dirty = true;
      }
      if (event.key === "Escape" || event.key === "Enter") this.textInput.blur();
    });
    on(this.textInput, "blur", () => {
      this.inputId = null; this.dropdownSearchInput = false; this.surface?.focus_node(undefined); this.dirty = true;
    });
    this.ready = this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      const gpu = await probeWebGPU();
      if (this.disposed) return;
      let surface: Surface | undefined;
      if (gpu) {
        // GPU：看板画布由 bevy 第二窗口（engine wasm 的 BoardCanvas）接管；
        // create 若挂起（winit 收养画布失败等）会永远停在加载态，超时强制回退 CPU。
        try {
          const engine = await withTimeout(loadEngineModule(), 15_000, "引擎模块加载");
          surface = await withTimeout(engine.BoardCanvas.create(this.gpuCanvas, true) as unknown as Promise<Surface>, 10_000, "bevy 看板窗口创建");
        } catch (error) {
          console.warn("bevy 看板窗口不可用，回退 CPU 栅格化。", error);
        }
      }
      if (!surface) {
        const cpu = await loadCpuModule();
        surface = await cpu.BoardCanvas.create(this.cpuCanvas, false);
      }
      if (this.disposed) { surface.free(); return; }
      this.surface = surface;
      this.layer.dataset.backend = surface.is_gpu() ? "GPU" : "CPU";
      this.gpuCanvas.hidden = !surface.is_gpu(); this.cpuCanvas.hidden = surface.is_gpu();
      this.status.hidden = true; this.sync(); this.loadResources();
      this.raf = requestAnimationFrame(time => this.tick(time));
    } catch (error) {
      if (!this.disposed) {
        this.status.textContent = `看板加载失败：${error instanceof Error ? error.message : String(error)}`;
        this.status.setAttribute("role", "alert");
      }
      throw error;
    }
  }

  render(state: BoardState): void {
    const wasPreviewing = this.previewing;
    if (!state.preview || !wasPreviewing) {
      this.listOffsets.clear(); this.listSelections.clear(); this.listPlayback.clear(); this.lastListTick = -Infinity;
      this.listTransitions.clear(); this.listPendingOffsets.clear(); this.lastListFrame = -Infinity;
      this.kitSelectionApplied.clear();
    }
    if (state.preview) for (const node of state.scene) {
      const raw = node.data?.__kitSelection;
      if (!isKitList(node) || !kitListInfo(node)?.selectable || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const selection = raw as Record<string, unknown>, value = String(selection.value ?? "");
      const match = kitListSelectionMatch(node, value, typeof selection.field === "string" ? selection.field : undefined,
        this.listOffsets.get(node.id) ?? 0);
      const key = JSON.stringify([selection, match]);
      if (this.kitSelectionApplied.get(node.id) === key) continue;
      if (!match) this.listSelections.delete(node.id);
      else { this.listSelections.set(node.id, match.index); this.listOffsets.set(node.id, match.start); }
      this.listTransitions.delete(node.id); this.listPendingOffsets.delete(node.id);
      this.kitSelectionApplied.set(node.id, key);
    }
    const weather = this.weather?.frame();
    const nextNodes = boardNodes(state.scene, state.preview, this.listOffsets, this.listSelections, this.listTransitions,
      state.hidden ? undefined : weather?.sample);
    weather?.sync();
    const now = Date.now();
    prepareKitMetricAnimations(nextNodes, this.metricPlayback, now, state.preview);
    prepareKitTextAnimations(nextNodes, this.textPlayback, now, state.preview);
    const previousNodes = this.nodes;
    const previousScene = this.state?.scene ?? [];
    if (this.pendingVisual && this.pendingVisual.expected.every(expected => {
      const node = nextNodes.find(item => item.id === expected.id);
      return node && Math.abs(node.x - expected.x) < 0.01 && Math.abs(node.y - expected.y) < 0.01
        && Math.abs(node.width - expected.width) < 0.01 && Math.abs(node.height - expected.height) < 0.01;
    })) this.clearPendingVisual();
    this.state = state; this.nodes = nextNodes; this.previewing = state.preview;
    if (state.preview) {
      const previousIds = new Set(previousNodes.map(node => node.id));
      const nextIds = new Set(nextNodes.map(node => node.id));
      if (wasPreviewing) {
        for (const node of previousNodes) {
          if (!nextIds.has(node.id) && !this.nodes.some(item => item.id === node.id)) {
            const previous = previousScene.find(item => item.id === node.id);
            this.emitComponentEvent(previous, "componentLeave");
            this.clearSelectedItem(node.id, previous);
          }
        }
      }
      for (const node of nextNodes) {
        if ((!wasPreviewing || !previousIds.has(node.id)) && this.nodes.some(item => item.id === node.id))
          this.emitComponentEvent(state.scene.find(item => item.id === node.id), "componentEnter");
      }
      if (this.selectedInteractionNodeId && !nextIds.has(this.selectedInteractionNodeId))
        this.setSelectedInteractionNode(null);
    } else {
      if (wasPreviewing) {
        for (const node of previousNodes) {
          const previous = previousScene.find(item => item.id === node.id);
          this.emitComponentEvent(previous, "componentLeave");
          this.clearSelectedItem(node.id, previous);
        }
        this.setSelectedInteractionNode(null, previousScene);
      }
      this.hoveredInteractionNodeId = null;
      this.hoveredChartId = null;
      this.previewPress = null;
    }
    if (!this.nodes.some(node => node.id === this.hoveredCarouselId
        && node.widget.kind === "carousel" && node.data.arrows === "hover")) {
      this.hoveredCarouselId = null;
    }
    this.layer.hidden = state.hidden ?? false;
    this.layer.style.width = `${state.boardWidth * state.scale}px`;
    this.layer.style.height = `${state.boardHeight * (state.scaleY ?? state.scale)}px`;
    this.syncIframeOverlays();
    this.sync(); this.loadResources();
  }

  /** Web widgets are real browser frames above the Rust canvas, positioned in board coordinates. */
  private syncIframeOverlays(): void {
    if (!this.state) return;
    const iframeNodes = this.nodes.filter(node => node.widget.kind === "iframe");
    const wanted = new Set(iframeNodes.map(node => node.id));
    for (const [id, element] of this.iframeElements) {
      if (wanted.has(id)) continue;
      element.remove(); this.iframeElements.delete(id);
    }
    const scaleX = this.state.scale;
    const scaleY = this.state.scaleY ?? this.state.scale;
    for (const node of iframeNodes) {
      let element = this.iframeElements.get(node.id);
      if (!element) {
        element = document.createElement("iframe");
        element.className = "rust-board-iframe";
        element.loading = "lazy";
        element.referrerPolicy = "strict-origin-when-cross-origin";
        element.allowFullscreen = true;
        element.title = node.name || "嵌入网页";
        this.layer.append(element);
        this.iframeElements.set(node.id, element);
      }
      const source = String(node.data.url ?? "").trim();
      let url = "";
      try {
        const parsed = new URL(source, window.location.href);
        if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) url = parsed.href;
      } catch { /* Invalid or unsupported schemes leave the widget empty. */ }
      const activeUrl = this.state.hidden || node.data.loaded === false ? "" : url;
      if (element.dataset.source !== activeUrl) {
        element.dataset.source = activeUrl;
        element.src = activeUrl || "about:blank";
      }
      element.hidden = !activeUrl;
      element.title = node.name || "嵌入网页";
      element.style.left = `${node.x * scaleX}px`;
      element.style.top = `${node.y * scaleY}px`;
      element.style.width = `${node.width * scaleX}px`;
      element.style.height = `${node.height * scaleY}px`;
      element.style.transform = `rotate(${node.rotation}deg)`;
      element.style.opacity = String(Math.max(0, Math.min(1, node.widget.opacity)));
      element.style.pointerEvents = this.state.preview ? "auto" : "none";
    }
  }

  private sync(): void {
    if (!this.surface || !this.state) return;
    const drag = this.drag;
    const nodes = drag?.next ? this.draggedNodes(drag) : this.pendingVisual?.nodes ?? this.nodes;
    const renderNodes = nodes.map(node => node.widget.kind === "carousel" && node.data.arrows === "hover"
      ? { ...node, data: { ...node.data, __dwHovered: node.id === this.hoveredCarouselId } }
      : node);
    this.syncSelection(nodes);
    this.surface.sync_scene(encodeBoardSync({ width: this.state.boardWidth, height: this.state.boardHeight,
      preview: this.state.preview, selected: [], nodes: renderNodes }));
    if (this.state.preview) {
      let changed = false;
      for (const node of renderNodes) {
        if (node.data.__kitDecoration) continue;
        const value = kitSelectionControlValue(node);
        if (value === undefined) continue;
        const selection = node.data.__kitSelection as Record<string, unknown>;
        const key = JSON.stringify([value, selection.revision]);
        if (this.kitSelectionApplied.get(node.id) === key) continue;
        this.kitSelectionApplied.set(node.id, key);
        this.surface.set_value(encodeSetValue(node.id, value));
        const selected = Array.isArray(value) ? value.join(", ") : typeof value === "string" ? value
          : Number((value as { index?: unknown }).index) === 4_294_967_295 ? "" : String(selection.value ?? "");
        if (selected) this.selectedItemValues.set(node.id, selected); else this.selectedItemValues.delete(node.id);
        changed = true;
      }
      // Programmatic updates should not recursively emit a second selection event.
      if (changed) this.surface.take_events();
    }
    this.dirty = true;
  }

  private draggedNodes(drag: Drag): RustBoardNode[] {
    const next = drag.next;
    if (!next) return this.nodes;
    const xScale = next.width / Math.max(1, drag.node.width);
    const yScale = next.height / Math.max(1, drag.node.height);
    return this.nodes.map(node => {
      if (node.id === drag.node.id) return { ...node, ...next };
      if (!drag.visualIds.has(node.id.split("::kit-")[0]!)) return node;
      return { ...node, x: next.x + (node.x - drag.node.x) * xScale,
        y: next.y + (node.y - drag.node.y) * yScale,
        width: node.width * xScale, height: node.height * yScale };
    });
  }

  private clearPendingVisual(): void {
    if (!this.pendingVisual) return;
    clearTimeout(this.pendingVisual.timer);
    this.pendingVisual = null;
  }

  private retainPendingVisual(nodes: RustBoardNode[]): void {
    const expected = nodes.flatMap((node, index) => {
      const previous = this.nodes[index];
      return previous && (node.x !== previous.x || node.y !== previous.y
        || node.width !== previous.width || node.height !== previous.height)
        ? [{ id: node.id, x: node.x, y: node.y, width: node.width, height: node.height }]
        : [];
    });
    if (!expected.length) return;
    this.clearPendingVisual();
    const pending: PendingBoardVisual = {
      nodes,
      expected,
      timer: setTimeout(() => {
        if (this.pendingVisual !== pending) return;
        this.pendingVisual = null;
        this.sync();
      }, 1500),
    };
    this.pendingVisual = pending;
  }

  private syncSelection(nodes: RustBoardNode[]): void {
    if (!this.state) return;
    const selected = new Set(this.state.preview ? [] : this.state.selected ?? []);
    const rect = this.layer.getBoundingClientRect();
    const scaleX = rect.width / Math.max(this.state.boardWidth, 1);
    const scaleY = rect.height / Math.max(this.state.boardHeight, 1);
    for (const [id, element] of this.selectionElements) {
      if (!selected.has(id) || !nodes.some(node => node.id === id)) {
        element.remove(); this.selectionElements.delete(id);
      }
    }
    for (const node of nodes) {
      if (!selected.has(node.id)) continue;
      let element = this.selectionElements.get(node.id);
      if (!element) {
        element = document.createElement("div");
        element.className = "rust-board-selection";
        for (const direction of ["n", "e", "s", "w"]) {
          const handle = document.createElement("span");
          handle.className = `rust-board-selection-handle ${direction}`;
          handle.title = "拖动调整尺寸";
          element.append(handle);
        }
        this.selectionLayer.append(element);
        this.selectionElements.set(node.id, element);
      }
      element.classList.toggle("is-locked", node.locked);
      element.style.left = `${node.x * scaleX}px`;
      element.style.top = `${node.y * scaleY}px`;
      element.style.width = `${node.width * scaleX}px`;
      element.style.height = `${node.height * scaleY}px`;
      element.style.transform = `rotate(${node.rotation}deg)`;
    }
  }

  private tick(_time: number): void {
    if (this.disposed) return;
    try {
      const second = Math.floor(Date.now() / 1000);
      if (_time - this.lastPaint >= 33
          && (this.nodes.some(boardHasMotion) || (this.state?.preview && _time < this.buttonRippleUntil))) this.dirty = true;
      if (second !== this.lastSecond) {
        this.lastSecond = second;
        if (this.nodes.some(node => boardUsesSecondClock(node.widget.kind))) this.dirty = true;
        this.loadResources();
      }
      if (this.state?.preview && !this.layer.hidden) this.tickKitLists(_time);
      if (!this.layer.hidden) this.tickMedia();
      if (this.surface && this.dirty && !this.layer.hidden) {
        const rect = this.layer.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const dpr = Math.min(devicePixelRatio || 1, 2);
          const factor = Math.min(dpr, Math.sqrt(16_777_216 / (rect.width * rect.height)));
          const width = Math.max(1, Math.round(rect.width * factor)), height = Math.max(1, Math.round(rect.height * factor));
          const bytes = this.surface.frame(width, height, encodeBoardClock(boardClock()));
          if (bytes.length) {
            const frame = decodePreviewFrame(bytes);
            if (this.cpuCanvas.width !== width) this.cpuCanvas.width = width;
            if (this.cpuCanvas.height !== height) this.cpuCanvas.height = height;
            this.cpuCanvas.getContext("2d")!.putImageData(new ImageData(frame.pixels, width, height), 0, 0);
          }
          this.dirty = false;
          this.lastPaint = _time;
        }
      }
    } catch (error) {
      this.status.hidden = false;
      this.status.textContent = `看板渲染失败：${error instanceof Error ? error.message : String(error)}`;
    }
    this.raf = requestAnimationFrame(next => this.tick(next));
  }

  private tickKitLists(now: number): void {
    const state = this.state;
    if (!state) return;
    let changed = false;
    if (this.listTransitions.size && now - this.lastListFrame >= 33) {
      this.lastListFrame = now;
      for (const [id, transition] of this.listTransitions) {
        transition.progress = Math.min(1, Math.max(0, (now - transition.startedAt) / LIST_TRANSITION_MS));
        if (transition.progress < 1) continue;
        this.listTransitions.delete(id);
        const pending = this.listPendingOffsets.get(id);
        const node = state.scene.find(item => item.id === id && item.visible);
        this.listPendingOffsets.delete(id);
        if (pending && node) this.beginKitListTransition(node, pending.offset, pending.direction, now);
      }
      changed = true;
    }
    if (now - this.lastListTick < 100) {
      if (changed) this.render(state);
      return;
    }
    this.lastListTick = now;
    const present = new Set<string>();
    const hoveredList = this.nodes.find(node => node.id === this.hoveredInteractionNodeId)?.data.__kitListRootId;
    for (const node of state.scene) {
      if (!node.visible || !isKitList(node)) continue;
      present.add(node.id);
      const info = kitListInfo(node);
      if (!info?.auto || !info.total || (info.total <= info.capacity && !(info.selectable && info.autoSelect))
          || (info.selectable && !info.autoSelect && this.listSelections.has(node.id))) continue;
      if (this.listTransitions.has(node.id)) continue;
      if (hoveredList === node.id) {
        const playback = this.listPlayback.get(node.id);
        if (playback) { playback.lastSwitch = now; playback.started = true; }
        continue;
      }
      let playback = this.listPlayback.get(node.id);
      if (!playback) {
        playback = { lastSwitch: now, started: false };
        this.listPlayback.set(node.id, playback);
      }
      if (now - playback.lastSwitch < (playback.started ? info.duration : info.firstDuration)) continue;
      const current = this.listOffsets.get(node.id) ?? 0;
      playback.lastSwitch = now; playback.started = true;
      if (info.selectable && info.autoSelect) {
        const next = advanceKitListSelection(node, this.listSelections.get(node.id), current);
        if (next) {
          this.selectKitListItem(node, kitListItem(node, next.row.value, next.row.index));
          if (next.start !== current) this.beginKitListTransition(node, next.start, 1, now);
          changed = true;
        }
      } else {
        const next = advanceKitList(node, current, 1);
        if (next !== current) { this.beginKitListTransition(node, next, 1, now); changed = true; }
      }
    }
    for (const id of this.listPlayback.keys()) if (!present.has(id)) this.listPlayback.delete(id);
    for (const id of this.listOffsets.keys()) if (!present.has(id)) this.listOffsets.delete(id);
    for (const id of this.listSelections.keys()) if (!present.has(id)) this.listSelections.delete(id);
    for (const id of this.listTransitions.keys()) if (!present.has(id)) this.listTransitions.delete(id);
    for (const id of this.listPendingOffsets.keys()) if (!present.has(id)) this.listPendingOffsets.delete(id);
    if (changed) this.render(state);
  }

  private changeKitListPage(node: SceneNode, name: string): void {
    const info = kitListInfo(node);
    if (!info) return;
    const current = this.listPendingOffsets.get(node.id)?.offset ?? this.listOffsets.get(node.id) ?? 0;
    const page = Number(name);
    const next = name === "‹" ? advanceKitList(node, current, -1) : name === "›"
      ? advanceKitList(node, current, 1) : Number.isInteger(page) && page > 0
        ? Math.min(Math.max(0, info.total - 1), (page - 1) * info.capacity) : current;
    const direction = name === "‹" ? -1 : name === "›" ? 1 : next < current ? -1 : 1;
    this.setKitListOffset(node, next, direction);
  }

  private beginKitListTransition(node: SceneNode, offset: number, direction: 1 | -1, now: number): void {
    const from = this.listOffsets.get(node.id) ?? 0;
    if (from === offset) return;
    this.listOffsets.set(node.id, offset);
    this.listTransitions.set(node.id, { from, to: offset, direction, progress: 0, startedAt: now });
    this.listPlayback.set(node.id, { lastSwitch: now + LIST_TRANSITION_MS, started: true });
  }

  private setKitListOffset(node: SceneNode, offset: number, direction: 1 | -1): void {
    if (this.listTransitions.has(node.id)) {
      if (offset === this.listOffsets.get(node.id)) this.listPendingOffsets.delete(node.id);
      else this.listPendingOffsets.set(node.id, { offset, direction });
      return;
    }
    this.beginKitListTransition(node, offset, direction, performance.now());
    if (this.state) this.render(this.state);
  }

  private emitKitListItem(id?: string): void {
    const visual = this.nodes.find(node => node.id === id);
    const rootId = visual?.data.__kitListRootId;
    const root = typeof rootId === "string" ? this.sceneNode(rootId) : undefined;
    if (!root || !visual) return;
    const payload = kitListItem(root, visual.data.__kitListRow, visual.data.__kitListIndex);
    if (kitListInfo(root)?.selectable) {
      this.selectKitListItem(root, payload);
      if (this.state) this.render(this.state);
    }
    this.emitComponentEvent(root, "itemClick", payload.name, payload);
  }

  private selectKitListItem(root: SceneNode, payload: ReturnType<typeof kitListItem>): void {
    const previous = this.selectedItemValues.get(root.id);
    if (previous !== undefined && previous !== payload.name)
      this.emitComponentEvent(root, "componentUnselected", previous);
    this.selectedItemValues.set(root.id, payload.name);
    this.listSelections.set(root.id, payload.index);
    this.emitComponentEvent(root, "componentSelected", payload.name, payload);
  }

  /** 媒体逐帧/逐秒驱动：视频帧上传、轮播状态机与过渡合成、图片展示动画、监控后台保活、播放参数同步。 */
  private tickMedia(): void {
    if (!this.nodes.some(node => MEDIA_KINDS.includes(node.widget.kind))) return;
    const nodesById = new Map(this.nodes.map(node => [node.id, node]));
    const now = performance.now();
    for (const [id, resource] of this.resources) {
      const node = nodesById.get(id);
      if (!node) continue;
      const kind = node.widget.kind;
      // 视频 / 监控：播放中逐帧上传；循环开始时间在重启后落位
      const video = resource.element instanceof HTMLVideoElement ? resource.element
        : resource.videos?.[resource.carousel?.index ?? 0];
      if (video instanceof HTMLVideoElement && video.readyState >= 2) {
        if (!video.paused) {
          if (resource.startedOnce && video.loop && video.duration) {
            const start = Math.max(0, Number(node.data.loopStart) || 0);
            if (start > 0 && start < video.duration - 0.1 && video.currentTime < start) video.currentTime = start;
          }
          if (resource.videoFrameReady || !video.requestVideoFrameCallback) {
            resource.videoFrameReady = false;
            this.uploadPixels(id, video); this.dirty = true;
          }
        }
      }
      // 轮播图状态机：预览态按「单个轮播后停留时长」推进，过渡期逐帧合成
      if (kind === "carousel" && resource.carousel && this.state?.preview) {
        this.tickCarousel(node, resource, now);
      }
      // 图片「展示设置」动画：预览态逐帧合成旋转 / 闪烁
      if (kind === "image" && this.state?.preview && node.data.playAnimation === true
          && resource.element instanceof HTMLImageElement) {
        this.compositeImageAnimation(node, resource, now);
      } else if (kind === "image" && resource.imageAnimation) {
        if (resource.imageAnimation.hasFrame && resource.element instanceof HTMLImageElement) this.uploadPixels(id, resource.element);
        resource.imageAnimation = undefined;
      }
      // 监控「隐藏后销毁等待时间」：loaded=false 后台保活，超时销毁（重新开启后由 loadResources 重建）
      if (kind === "monitor" && node.data.loaded === false) {
        resource.hiddenAt ??= now;
        if (now - resource.hiddenAt >= Math.max(0, Number(node.data.destroyDelay ?? 10)) * 1000) {
          resource.dispose(); this.resources.delete(id);
          this.surface?.clear_image(id); this.dirty = true;
        }
      } else if (kind === "monitor") {
        resource.hiddenAt = undefined;
      }
      // 播放参数每秒同步一次（面板改动不重建资源，直接生效）
      const tick = Math.floor(now / 1000);
      if (resource.synced !== tick) {
        resource.synced = tick;
        const media = resource.element instanceof HTMLMediaElement ? resource.element : undefined;
        if (media) this.applyPlayback(node, media);
      }
    }
  }

  /** 轮播图推进：停留时长到点切下一张（animLoop=false 只播一轮），切换动画逐帧合成。 */
  private tickCarousel(node: RustBoardNode, resource: MediaResource, now: number): void {
    const urls = Array.isArray(node.data.urls) ? node.data.urls.map(String) : [];
    const state = resource.carousel;
    if (!state || !urls.length) return;
    const interval = Math.max(1, Number(node.data.interval) || 3) * 1000;
    if (!state.transition && now - state.lastSwitch >= interval && !(state.playedOnce && node.data.animLoop === false)) {
      const next = (state.index + 1) % urls.length;
      if (next === 0 && node.data.animLoop === false) {
        state.playedOnce = true; state.lastSwitch = now;
      } else {
        state.transition = node.data.playAnimation !== false
          ? { from: state.index, to: next, start: now } : null;
        state.index = next; state.lastSwitch = now; state.playedOnce = false;
        resource.settled = false; this.dirty = true;
      }
    }
    this.compositeCarousel(node, resource, now);
  }

  /** 轮播图合成：静止帧或「平移 / 翻转」过渡帧（TS 侧画布逐帧合成后整体上传纹理）。 */
  private compositeCarousel(node: RustBoardNode, resource: MediaResource, now: number): void {
    const state = resource.carousel;
    if (!state || resource.settled) return;
    const urls = Array.isArray(node.data.urls) ? node.data.urls.map(String) : [];
    const width = Math.max(1, Math.min(1024, Math.round(node.width)));
    const height = Math.max(1, Math.round(width * node.height / Math.max(1, node.width)));
    this.decodeCanvas.width = width; this.decodeCanvas.height = height;
    const context = this.decodeCanvas.getContext("2d", { willReadFrequently: true })!;
    context.clearRect(0, 0, width, height);
    const fit = String(node.data.objectFit ?? "stretch");
    const draw = (index: number) => {
      const image = resource.images?.[index];
      if (image?.naturalWidth) drawFit(context, image, image.naturalWidth, image.naturalHeight, fit, 0, 0, width, height);
    };
    const transition = state.transition;
    if (!transition) {
      draw(state.index);
      resource.settled = true;
    } else {
      const progress = Math.min(1, (now - transition.start) / 600);
      const eased = easeValue(progress, "easeInOut");
      if (String(node.data.animType ?? "slide") === "flip") {
        const first = progress < 0.5;
        const p = easeValue(first ? progress * 2 : (progress - 0.5) * 2, "easeInOut");
        context.save();
        context.translate(width / 2, 0);
        context.scale(Math.max(first ? 1 - p : p, 0.001), 1);
        context.translate(-width / 2, 0);
        draw(first ? transition.from : transition.to);
        context.restore();
      } else {
        const horizontal = String(node.data.direction ?? "horizontal") === "horizontal";
        const size = horizontal ? width : height;
        const offset = eased * size;
        context.save();
        context.translate(horizontal ? -offset : 0, horizontal ? 0 : -offset);
        draw(transition.from);
        context.restore();
        context.save();
        context.translate(horizontal ? size - offset : 0, horizontal ? 0 : size - offset);
        draw(transition.to);
        context.restore();
      }
      if (progress >= 1) state.transition = null;
    }
    const frame = context.getImageData(0, 0, width, height);
    this.surface?.set_image(node.id, frame.width, frame.height, new Uint8Array(frame.data.buffer));
    this.dirty = true;
  }

  /** 图片「展示设置」动画：延迟后按缓动旋转 / 闪烁，单次或按间隔循环。 */
  private compositeImageAnimation(node: RustBoardNode, resource: MediaResource, now: number): void {
    const image = resource.element;
    if (!(image instanceof HTMLImageElement) || !image.naturalWidth) return;
    const delay = Math.max(0, Number(node.data.animDelay ?? 1)) * 1000;
    const duration = Math.max(0.1, Number(node.data.animDuration ?? 1)) * 1000;
    const gap = Math.max(0, Number(node.data.animInterval ?? 0)) * 1000;
    const key = JSON.stringify([delay, duration, gap, node.data.animLoop, node.data.animType, node.data.easing]);
    if (resource.imageAnimation?.key !== key)
      resource.imageAnimation = { key, startedAt: now, complete: false, hasFrame: false };
    const animation = resource.imageAnimation;
    if (animation.complete) return;
    const elapsed = now - animation.startedAt - delay;
    if (elapsed < 0) return;
    if (node.data.animLoop === false && elapsed >= duration) {
      if (animation.hasFrame) this.uploadPixels(node.id, image);
      animation.hasFrame = false; animation.complete = true;
      return;
    }
    const phase = node.data.animLoop === false ? elapsed : elapsed % (duration + gap);
    if (phase >= duration) {
      if (animation.hasFrame) { this.uploadPixels(node.id, image); animation.hasFrame = false; }
      return;
    }
    const progress = easeValue(phase / duration, String(node.data.easing ?? "easeInOut"));
    const width = Math.max(1, Math.min(1024, Math.round(node.width)));
    const height = Math.max(1, Math.round(width * node.height / Math.max(1, node.width)));
    this.decodeCanvas.width = width; this.decodeCanvas.height = height;
    const context = this.decodeCanvas.getContext("2d", { willReadFrequently: true })!;
    context.clearRect(0, 0, width, height);
    context.save();
    context.filter = imageCanvasFilter(node.data.__kitImageFilter);
    if (String(node.data.animType ?? "cw") === "blink") {
      context.globalAlpha = 1 - progress;
    } else {
      const angle = (["ccw", "rotateReverse", "anti-clockwise"].includes(String(node.data.animType)) ? -1 : 1) * progress * Math.PI * 2;
      context.translate(width / 2, height / 2);
      context.rotate(angle);
      context.translate(-width / 2, -height / 2);
    }
    drawFit(context, image, image.naturalWidth, image.naturalHeight, "center", 0, 0, width, height);
    context.restore();
    const frame = context.getImageData(0, 0, width, height);
    this.surface?.set_image(node.id, frame.width, frame.height, new Uint8Array(frame.data.buffer));
    animation.hasFrame = true;
    this.dirty = true;
  }

  /** 播放设置同步：循环 / 静音 / 倍速 / 音量 / 起始时间（幂等，面板改动即时生效）。 */
  private applyPlayback(node: RustBoardNode, media: HTMLMediaElement): void {
    media.loop = node.data.loop !== false;
    media.muted = node.data.muted !== false;
    const rate = Number(node.data.playbackRate);
    if ([2, 1.5, 1, 0.5].includes(rate)) media.playbackRate = rate;
    if (media instanceof HTMLAudioElement) {
      media.volume = Math.min(100, Math.max(1, Number(node.data.volume) || 100)) / 100;
      const start = Math.max(0, Number(node.data.startTime) || 0);
      if (start > 0 && media.duration > start && media.currentTime < 0.05) media.currentTime = start;
    }
  }

  async snapshot(size: CaptureSize): Promise<HTMLCanvasElement> {
    await this.ready;
    await Promise.all([...this.resources.values()].map(resource => resource.pending));
    if (this.geoPending) await this.geoPending;
    if (!this.surface || this.disposed) throw new Error("Rust 看板渲染器已关闭");
    // Snapshot is generated from the live Rust state, including preview input and selected tabs.
    const output = pixelsCanvas(this.surface.snapshot(size.width, size.height, encodeBoardClock(boardClock())));
    this.dirty = true;
    return output;
  }

  private relative(event: MouseEvent): [number, number] {
    const rect = this.layer.getBoundingClientRect();
    return [(event.clientX - rect.left) / Math.max(rect.width, 1) * (this.state?.boardWidth ?? 1),
      (event.clientY - rect.top) / Math.max(rect.height, 1) * (this.state?.boardHeight ?? 1)];
  }
  private hit(event: MouseEvent): Hit | null {
    if (!this.surface || this.layer.hidden) return null;
    const point = this.relative(event);
    if (this.state && !this.state.preview) {
      const handle = this.selectedHandle(point);
      if (handle) return handle;
      for (let index = this.nodes.length - 1; index >= 0; index--) {
        const node = this.nodes[index];
        if (!node || node.data.__kitDecoration || node.data.__kitPanelTab || node.data.__kitListClone) continue;
        const cx = node.width / 2, cy = node.height / 2;
        const angle = node.rotation * Math.PI / 180;
        const dx = point[0] - node.x - cx, dy = point[1] - node.y - cy;
        const x = cx + Math.cos(angle) * dx + Math.sin(angle) * dy;
        const y = cy - Math.sin(angle) * dx + Math.cos(angle) * dy;
        if (x >= 0 && x <= node.width && y >= 0 && y <= node.height) {
          return { id: node.id, handle: null, control: false };
        }
      }
      return null;
    }
    const hit = decodeHitResult(this.surface.hit_test(...point));
    return hit;
  }

  /** Keep resize targets usable when the board is zoomed out. */
  private selectedHandle([x, y]: [number, number]): Hit | null {
    if (!this.state || this.state.preview) return null;
    const selected = this.state.selected ?? [];
    const rect = this.layer.getBoundingClientRect();
    const scaleX = rect.width / Math.max(this.state.boardWidth, 1);
    const scaleY = rect.height / Math.max(this.state.boardHeight, 1);
    const radius = 8;
    let closest: { id: string; handle: string; distance: number } | null = null;

    for (let index = this.nodes.length - 1; index >= 0; index--) {
      const node = this.nodes[index];
      if (!node || !selected.includes(node.id) || node.locked) continue;
      const centerX = node.width / 2, centerY = node.height / 2;
      const angle = node.rotation * Math.PI / 180;
      const dx = x - node.x - centerX, dy = y - node.y - centerY;
      const localX = centerX + Math.cos(angle) * dx + Math.sin(angle) * dy;
      const localY = centerY - Math.sin(angle) * dx + Math.cos(angle) * dy;
      const handles: [string, number, number][] = [
        ["n", centerX, 0], ["e", node.width, centerY],
        ["s", centerX, node.height], ["w", 0, centerY],
      ];

      for (const [name, handleX, handleY] of handles) {
        const screenX = (localX - handleX) * scaleX;
        const screenY = (localY - handleY) * scaleY;
        const distance = screenX * screenX + screenY * screenY;
        if (Math.abs(screenX) <= radius && Math.abs(screenY) <= radius
            && (!closest || distance < closest.distance)) {
          closest = { id: node.id, handle: name, distance };
        }
      }
    }

    return closest ? { id: closest.id, handle: closest.handle, control: false } : null;
  }
  private setHoveredCarousel(id: string | null): void {
    if (this.hoveredCarouselId === id) return;
    this.hoveredCarouselId = id;
    this.sync();
  }
  private setHoveredInteractionNode(id: string | null): void {
    if (id === this.hoveredInteractionNodeId) return;
    const previous = this.sceneNode(this.hoveredInteractionNodeId ?? undefined);
    this.hoveredInteractionNodeId = id;
    if (previous) this.options.onComponentEvent?.(previous, "mouseleave");
    const current = this.sceneNode(id ?? undefined);
    if (current) this.options.onComponentEvent?.(current, "mouseenter");
  }
  private emitComponentEvent(node: SceneNode | undefined, event: BoardComponentEvent, value?: string, payload?: unknown): void {
    if (node) this.options.onComponentEvent?.(node, event, value, payload);
  }
  private setSelectedInteractionNode(id: string | null, scene = this.state?.scene ?? []): void {
    if (id === this.selectedInteractionNodeId) return;
    const previousId = this.selectedInteractionNodeId;
    this.selectedInteractionNodeId = id;
    this.emitComponentEvent(scene.find(node => node.id === previousId), "componentUnselected");
    this.emitComponentEvent(scene.find(node => node.id === id), "componentSelected");
  }
  private clearSelectedItem(id: string, node?: SceneNode): void {
    const value = this.selectedItemValues.get(id);
    if (value === undefined) return;
    this.selectedItemValues.delete(id);
    if (value !== "") this.emitComponentEvent(node, "componentUnselected", value);
  }
  private isInCarouselHoverBounds(node: RustBoardNode, event: PointerEvent): boolean {
    const [x, y] = this.relative(event);
    const centerX = node.x + node.width / 2, centerY = node.y + node.height / 2;
    const angle = -node.rotation * Math.PI / 180;
    const dx = x - centerX, dy = y - centerY;
    const localX = centerX + dx * Math.cos(angle) - dy * Math.sin(angle);
    const localY = centerY + dx * Math.sin(angle) + dy * Math.cos(angle);
    const margin = Math.max(16, Math.min(120, Number(node.data.buttonSize) || 30)) * 1.2;
    return localX >= -margin && localX <= node.width + margin
      && localY >= -margin && localY <= node.height + margin;
  }
  private sceneNode(id?: string) {
    const original = this.nodes.find(node => node.id === id)?.data.__kitListOriginalId;
    return this.state?.scene.find(node => node.id === (typeof original === "string" ? original : id));
  }

  private animateKitButton(node: RustBoardNode | undefined, mode: "hover" | "click"): boolean {
    const button = node?.data.__kitButton;
    if (!button || typeof button !== "object" || Array.isArray(button)) return false;
    const options = button as Record<string, unknown>;
    if (options[mode] !== true || options[`${mode}Animation`] !== true) return false;
    const configured = Number(options[`${mode}Duration`]);
    const duration = Number.isFinite(configured) ? Math.max(0.016, Math.min(60, configured)) : 0.35;
    this.buttonRippleUntil = Math.max(this.buttonRippleUntil || 0, performance.now() + duration * 1000 + 50);
    return true;
  }

  private pointerDown(event: PointerEvent, canvas: HTMLCanvasElement): void {
    const hit = this.hit(event);
    if (!hit) {
      if (this.state?.preview) {
        this.surface?.pointer("down", ...this.relative(event)); this.dirty = true;
      }
      if (this.state && !this.state.preview && event.button === 0 && !event.shiftKey) this.options.onBackgroundSelect?.();
      return;
    }
    if (event.button !== 0 || !this.state) return;
    event.stopPropagation(); event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    if (this.state.preview) {
      this.previewPress = { id: hit.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      const animate = this.animateKitButton(this.nodes.find(node => node.id === hit.id), "click");
      this.surface?.pointer(animate ? `down@${Date.now()}` : "down", ...this.relative(event)); this.dirty = true; return;
    }
    const focused = document.activeElement;
    if (focused instanceof HTMLElement) focused.blur();
    this.options.onSelect?.(hit.id, event.shiftKey);
    const node = this.nodes.find(node => node.id === hit.id);
    if (!node || node.locked || event.shiftKey) return;
    const [startX, startY] = this.relative(event);
    const ids = this.state.selected?.includes(node.id) ? this.state.selected : [node.id];
    this.drag = { node, startX, startY, pointerId: event.pointerId, handle: hit.handle,
      ids, visualIds: descendants(this.state.scene, hit.handle ? [node.id] : ids) };
  }

  private pointerMove(event: PointerEvent): void {
    if (this.state?.preview) {
      this.surface?.pointer("move", ...this.relative(event)); this.drainEvents(); this.dirty = true; return;
    }
    const drag = this.drag;
    if (!drag) return;
    event.stopPropagation();
    const [x, y] = this.relative(event), n = drag.node;
    let dx = x - drag.startX, dy = y - drag.startY;
    const next = { x: n.x, y: n.y, width: n.width, height: n.height };
    if (!drag.handle) { next.x += dx; next.y += dy; }
    else {
      const angle = n.rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
      [dx, dy] = [c * dx + s * dy, -s * dx + c * dy];
      let left = 0, top = 0;
      if (drag.handle.includes("e")) next.width = Math.max(30, n.width + dx);
      if (drag.handle.includes("s")) next.height = Math.max(24, n.height + dy);
      if (drag.handle.includes("w")) { next.width = Math.max(30, n.width - dx); left = n.width - next.width; }
      if (drag.handle.includes("n")) { next.height = Math.max(24, n.height - dy); top = n.height - next.height; }
      const cx = left + (next.width - n.width) / 2, cy = top + (next.height - n.height) / 2;
      next.x = n.x + n.width / 2 + c * cx - s * cy - next.width / 2;
      next.y = n.y + n.height / 2 + s * cx + c * cy - next.height / 2;
    }
    const snap = this.options.getSnap?.() ?? 0;
    if (snap) { next.x = Math.round(next.x / snap) * snap; next.y = Math.round(next.y / snap) * snap; }
    drag.next = next; this.sync();
  }

  private pointerUp(event: PointerEvent, canvas: HTMLCanvasElement): void {
    event.stopPropagation();
    if (this.state?.preview) {
      const hit = this.hit(event);
      const press = this.previewPress;
      this.previewPress = null;
      const clicked = press?.pointerId === event.pointerId && press.id === hit?.id
        && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 8;
      if (clicked || hit?.control) this.surface?.pointer("up", ...this.relative(event));
      else this.surface?.pointer("cancel", 0, 0);
      const controlAction = this.drainEvents(); this.dirty = true;
      if (!clicked) {
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        return;
      }
      this.emitKitListItem(hit?.id);
      if (controlAction) {
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        return;
      }
      const node = this.sceneNode(hit?.id);
      if (node) {
        this.setSelectedInteractionNode(node.id);
        if (!hit?.control) this.options.onClick?.(node);
      } else {
        this.setSelectedInteractionNode(null);
        this.options.onBackgroundClick?.();
      }
    } else if (this.drag) {
      this.pointerMove(event);
      const drag = this.drag;
      if (drag.next) {
        const nodes = this.draggedNodes(drag);
        this.retainPendingVisual(nodes);
        this.options.onEdit?.(drag.handle ? { type: "resize", id: drag.node.id, ...drag.next }
          : { type: "move", ids: drag.ids, dx: drag.next.x - drag.node.x, dy: drag.next.y - drag.node.y });
      }
      this.drag = null; this.sync();
    }
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  private drainEvents(): boolean {
    if (!this.surface) return false;
    let handledButton = false;
    dispatchCommandResponse(this.surface.take_events(), {
      boardEvent: event => {
        const node = this.sceneNode(event.id);
        if (!node) return;
        switch (event.action) {
          case BoardAction.Change:
            {
              const item = event.value && typeof event.value === "object" && !Array.isArray(event.value)
                ? event.value as Record<string, unknown> : null;
              if (typeof item?.__kitTabIndex === "number") {
                const index = item.__kitTabIndex;
                const name = String(item.name ?? "");
                handledButton = true;
                if (isKitList(node)) { this.changeKitListPage(node, name); break; }
                this.options.onKitTabChange?.(node, index);
                this.emitComponentEvent(node, "itemClick", name, { index, name, value: name });
                break;
              }
              const dialogAction = item?.__dwDialogAction;
              if (dialogAction === "close" || dialogAction === "cancel" || dialogAction === "confirm") {
                handledButton = true;
                const name = { close: "关闭", cancel: "取消", confirm: "确定" }[dialogAction];
                const payload = { name, value: name, action: dialogAction };
                this.options.onDialogAction?.(node, dialogAction);
                this.emitComponentEvent(node, "itemClick", name, payload);
                this.layer.dispatchEvent(new CustomEvent("dw:dialog-action", {
                  bubbles: true, detail: { id: event.id, ...payload },
                }));
                break;
              }
              if (item?.__dwChartItem === true) {
                const { __dwChartItem: _marker, ...payload } = item;
                this.emitComponentEvent(node, "itemClick", String(payload.name ?? ""), payload);
                this.layer.dispatchEvent(new CustomEvent("dw:chart-item-click", {
                  bubbles: true, detail: { id: event.id, kind: event.kind, ...payload },
                }));
                break;
              }
              if (item?.__kitTableRow === true) {
                const { __kitTableRow: _marker, ...payload } = item;
                const value = String(payload.name ?? "");
                const previous = this.selectedItemValues.get(node.id);
                if (previous !== undefined && previous !== value)
                  this.emitComponentEvent(node, "componentUnselected", previous);
                this.selectedItemValues.set(node.id, value);
                this.emitComponentEvent(node, "componentSelected", value, payload);
                this.emitComponentEvent(node, "itemClick", value, payload);
                this.layer.dispatchEvent(new CustomEvent("dw:table-row-click", {
                  bubbles: true, detail: { id: event.id, ...payload },
                }));
                break;
              }
              if (item?.__kitMenuRepeat === true) {
                const value = String(item.value ?? "");
                this.emitComponentEvent(node, "itemClick", value, value);
                handledButton = true;
                break;
              }
              const value = item?.__kitDropdownTree === true ? String(item.value ?? "")
                : typeof event.value === "string" ? event.value : JSON.stringify(event.value);
              const visual = this.nodes.find(candidate => candidate.id === event.id);
              const menu = visual?.data.__kitMenu as Record<string, unknown> | undefined;
              const items = Array.isArray(visual?.data.items) ? visual.data.items : [];
              const fallback = menu && Number.isInteger(menu.active) ? items[Number(menu.active)] : undefined;
              const previous = this.selectedItemValues.get(node.id) ?? (typeof fallback === "string" ? fallback : undefined);
              if (previous !== undefined && previous !== value && (!menu || previous !== ""))
                this.emitComponentEvent(node, "componentUnselected", previous);
              this.selectedItemValues.set(node.id, value);
              if (menu && value === "") {
                this.options.onKitMenuClear?.(node);
              } else {
                this.emitComponentEvent(node, "componentSelected", value);
                this.emitComponentEvent(node, "itemClick", value, event.value);
              }
            }
            this.layer.dispatchEvent(new CustomEvent("dw:control-change", {
              bubbles: true, detail: { id: event.id, kind: event.kind, value: event.value },
            }));
            break;
          case BoardAction.Focus:
            this.inputId = event.id;
            this.dropdownSearchInput = Boolean(event.value && typeof event.value === "object"
              && !Array.isArray(event.value) && (event.value as Record<string, unknown>).__kitDropdownSearch === true);
            this.textInput.value = this.dropdownSearchInput ? "" : typeof event.value === "string" ? event.value : "";
            this.textInput.setAttribute("aria-label", this.dropdownSearchInput ? "搜索下拉选项" : node.widget!.text);
            this.textInput.focus(); this.textInput.setSelectionRange(this.textInput.value.length, this.textInput.value.length);
            break;
          case BoardAction.Open: {
            const url = String(node.data?.url ?? "");
            if (/^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener,noreferrer");
            break;
          }
          case BoardAction.Media: {
            // 视频 / 音频 / 监控 / 轮播视频：点击控制条或画面切换播放（轮播视频取当前活动视频）
            const resource = this.resources.get(event.id);
            const media = resource?.element instanceof HTMLMediaElement ? resource.element
              : resource?.videos?.[resource.carousel?.index ?? 0];
            if (media instanceof HTMLMediaElement) {
              if (media.paused) {
                if (String(node.data?.playMode ?? "pauseResume") === "restart") {
                  const start = Math.max(0, Number(node.data?.loopStart) || 0);
                  if (!media.duration || start < media.duration - 0.1) media.currentTime = start;
                }
                void media.play().catch(() => this.setStatus(event.id, "播放失败，请检查媒体地址"));
              } else media.pause();
              this.setValue(event.id, !media.paused);
            }
            break;
          }
          case BoardAction.Page: {
            // 山海鲸轮播图「切换按钮」/ 基础PDF「翻页按钮 + 点击切换下一页」
            const delta = Number(event.value) || 0;
            if (event.kind === "carousel") this.stepCarousel(event.id, delta);
            else void this.turnPage(event.id, delta);
            break;
          }
          case BoardAction.Upload:
            this.nativePicker(node, "upload");
            break;
          case BoardAction.ColorPicker:
            this.nativePicker(node, "colorPicker");
            break;
        }
      },
    });
    return handledButton;
  }

  private setStatus(id: string, message: string): void {
    if (this.disposed || !this.surface) return;
    this.surface.set_status(id, message); this.dirty = true;
  }

  private setValue(id: string, value: unknown): void {
    if (this.disposed || !this.surface) return;
    this.surface.set_value(encodeSetValue(id, value)); this.drainEvents(); this.dirty = true;
  }

  private nativePicker(node: SceneNode, kind: string): void {
    const input = document.createElement("input");
    input.type = kind === "upload" ? "file" : "color";
    if (kind === "upload") { input.accept = String(node.data?.accept ?? ""); input.multiple = node.data?.multiple === true; }
    else input.value = /^#[0-9a-f]{6}$/i.test(String(node.data?.value)) ? String(node.data?.value) : "#4b9eff";
    input.addEventListener("change", () => {
      if (kind === "colorPicker") { this.setValue(node.id, input.value); return; }
      const files = [...(input.files ?? [])];
      this.setValue(node.id, files.map(file => file.name));
      if (files.length && node.data?.uploadUrl) {
        try {
          const url = new URL(String(node.data.uploadUrl), document.baseURI);
          if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("上传地址无效");
          const body = new FormData(); files.forEach(file => body.append("files", file));
          this.setStatus(node.id, "正在上传…");
          void fetch(url, { method: "POST", body, credentials: "omit" }).then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            this.setStatus(node.id, "上传成功");
          }).catch(() => this.setStatus(node.id, "上传失败，请检查地址与跨域设置"));
        } catch { this.setStatus(node.id, "上传地址无效"); }
      }
    });
    input.click();
  }

  private loadResources(): void {
    if (!this.surface || !this.state) return;
    if (!this.geoReady && !this.geoFailed && !this.geoPending && this.nodes.some(node => node.widget.kind.startsWith("map"))) {
      this.geoPending = loadGeojson().then(json => {
        if (this.disposed) return;
        this.surface?.set_geojson(encodeGeoJsonDocument(json as Parameters<typeof encodeGeoJsonDocument>[0])); this.geoReady = true; this.dirty = true;
      }).catch(() => {
        this.geoFailed = true;
        for (const node of this.nodes.filter(node => node.widget.kind.startsWith("map"))) this.setStatus(node.id, "地图加载失败，请重新加载");
      })
        .finally(() => { this.geoPending = null; });
    }
    const ids = new Set(this.nodes.map(node => node.id));
    const chartIds = new Set(this.nodes.filter(node => isChartWidget(node.widget.kind)).map(node => node.id));
    const cityNodes = this.state.hidden ? [] : this.nodes.filter(node => node.data.__kitCityGeometry === true);
    const cityIds = new Set(cityNodes.map(node => node.id));
    for (const [id, resource] of this.resources) {
      const prefix = [LEGEND_LEFT_IMAGE_PREFIX, LEGEND_RIGHT_IMAGE_PREFIX, TOOLTIP_IMAGE_PREFIX, POINT_IMAGE_PREFIX,
        CITY_IMAGE_PREFIX].find(value => id.startsWith(value));
      const resourceOwner = prefix ? id.slice(prefix.length) : id;
      const owner = prefix === POINT_IMAGE_PREFIX ? resourceOwner.replace(/^[0-2]:/, "") : resourceOwner;
      const chartResource = prefix && prefix !== CITY_IMAGE_PREFIX;
      if (!ids.has(owner) || chartResource && !chartIds.has(owner)
          || prefix === CITY_IMAGE_PREFIX && !cityIds.has(owner)) {
        resource.dispose(); this.resources.delete(id);
        if (prefix) { this.surface.clear_image(id); this.dirty = true; }
      }
    }
    if (cityNodes.length) {
      const sourceNodes = new Map(this.state.scene.map(node => [node.id, node]));
      for (const node of cityNodes) {
        const original = sourceNodes.get(typeof node.data.__kitListOriginalId === "string" ? node.data.__kitListOriginalId : node.id);
        const pieces = original && kitMetadata(original)?.source.pieces;
        if (pieces) this.loadKitCity(node, pieces);
      }
    }
    // List clones often use the same decorative image. Reuse an already decoded
    // image when a new row enters, so transitions do not briefly lose its texture.
    const decodedImages = new Map<string, HTMLImageElement>();
    if (typeof HTMLImageElement !== "undefined") for (const resource of this.resources.values()) {
      if (resource.settled && resource.element instanceof HTMLImageElement && resource.element.naturalWidth > 0)
        decodedImages.set(resource.key, resource.element);
    }
    // 山海鲸「瓦片地图」在线影像：卫星 / 电子瓦片合成底图纹理（离线或跨域失败自动回退内置主题矢量）
    for (const node of this.nodes) {
      if (node.widget.kind !== "mapTile") continue;
      const tile = (node.data.tile ?? {}) as Record<string, unknown>;
      const imagery = String(tile.imagery ?? "none");
      const view = REGION_VIEWS[String(node.data.region ?? "china")] ?? REGION_VIEWS.china!;
      // Rust 侧视野矩形恒为 2:1（720×360 等比 fit），纹理分辨率取 2:1
      const width = Math.max(2, Math.min(1024, Math.round(node.width)));
      const height = Math.max(2, Math.round(width / 2));
      const key = JSON.stringify(["mapImagery", imagery, view.lonMin, view.lonMax,
        Number(tile.centerLon ?? 0), Number(tile.centerLat ?? 0), Number(tile.zoom ?? 1), width]);
      if (this.resources.get(node.id)?.key === key) continue;
      this.resources.get(node.id)?.dispose(); this.resources.delete(node.id);
      this.surface.clear_image(node.id);
      this.dirty = true;
      if (imagery === "none" || !IMAGERY_SOURCES[imagery]) {
        // 占位资源让后续秒级 pass 命中 key 跳过（否则每秒 clear_image + dirty 常驻重绘）
        this.resources.set(node.id, { key, createdAt: performance.now(), pending: Promise.resolve(), dispose: () => {} });
        continue;
      }
      this.loadMapImagery(node, key, imagery, view, width, height);
    }
    for (const node of this.nodes) {
      if (!isChartWidget(node.widget.kind)) continue;
      const chart = node.data.chart && typeof node.data.chart === "object" && !Array.isArray(node.data.chart)
        ? node.data.chart as Record<string, unknown> : {};
      const enabled = chart.showLegend !== false && chart.legendType === "scroll";
      this.loadChartImage(node, `${LEGEND_LEFT_IMAGE_PREFIX}${node.id}`, enabled ? String(chart.legendPageLeftImage ?? "") : "");
      this.loadChartImage(node, `${LEGEND_RIGHT_IMAGE_PREFIX}${node.id}`, enabled ? String(chart.legendPageRightImage ?? "") : "");
      this.loadChartImage(node, `${TOOLTIP_IMAGE_PREFIX}${node.id}`, chart.showTooltip !== false ? String(chart.tooltipBackgroundImage ?? "") : "");
      const styles = Array.isArray(chart.seriesStyles) ? chart.seriesStyles : [];
      const rows = Array.isArray(node.data.rows) ? node.data.rows : [];
      const multi = ["lineMulti", "areaStacked", "dualAxis"].includes(node.widget.kind);
      const inferred = multi ? rows.some(row => row && typeof row === "object"
        && Number((row as Record<string, unknown>).value3) !== 0
        && Number.isFinite(Number((row as Record<string, unknown>).value3))) ? 3 : 2 : 1;
      let seriesCount = Math.max(1, Math.min(3, Math.trunc(Number(chart.seriesCount) || inferred)));
      if ((node.widget.kind.startsWith("line") || node.widget.kind.startsWith("area"))
        && chart.variant !== "rangeArea" && chart.categoryVisibilityMode === "custom") {
        const count = Number(chart.visibleCategoryCount ?? 10);
        if (Number.isFinite(count) && count <= 0) seriesCount = 0;
      }
      const pointChart = ["line", "lineSmooth", "lineMulti", "area", "areaGradient", "areaStacked", "dualAxis"].includes(node.widget.kind);
      for (let series = 0; series < 3; series++) {
        const custom = chart.seriesStyleEnabled === true && styles[series] && typeof styles[series] === "object"
          && !Array.isArray(styles[series]) ? styles[series] as Record<string, unknown> : {};
        const point = { ...chart, ...custom };
        const enabled = pointChart && series < seriesCount && point.showPoints !== false
          && point.pointShape === "image" && Number(point.pointRadius ?? 3) > 0;
        this.loadChartImage(node, `${POINT_IMAGE_PREFIX}${series}:${node.id}`, enabled ? String(point.pointImage ?? "") : "");
      }
    }
    for (const node of this.nodes) {
      const rankingChart = isChartWidget(node.widget.kind);
      const kind = rankingChart ? "image" : node.widget.kind;
      if (!rankingChart && !MEDIA_KINDS.includes(kind)) continue;
      const chart = node.data.chart && typeof node.data.chart === "object" && !Array.isArray(node.data.chart)
        ? node.data.chart as Record<string, unknown> : {};
      const imageSrc = rankingChart
        ? chart.showRanking === true && chart.rankingBackground === "image" ? String(chart.rankingBackgroundImage ?? "") : ""
        : node.widget.image;
      // 监控「隐藏后销毁等待时间」：loaded=false 期间不重建，等销毁计时或重新开启
      if (kind === "monitor" && node.data.loaded === false) continue;
      const urls = Array.isArray(node.data.urls) ? node.data.urls.map(String) : [];
      const src = String(node.data.src ?? "");
      const key = JSON.stringify([rankingChart ? "ranking-image" : kind,
        kind === "image" ? imageSrc : ["carousel", "carouselVideo"].includes(kind) ? urls.join("|") : src,
        kind === "monitor" ? String(node.data.protocol ?? "hls") : "", node.data.loop, node.data.muted,
        node.data.__kitImageFilter]);
      const previous = this.resources.get(node.id);
      if (previous?.key === key) continue;
      const primary = kind === "image" ? imageSrc
        : ["carousel", "carouselVideo"].includes(kind) ? urls[0] ?? "" : src;
      if (kind !== "pdf" && !previous && (!primary || !MEDIA_URL_PATTERN.test(primary))) continue;
      this.resources.get(node.id)?.dispose(); this.resources.delete(node.id);
      this.surface.clear_image(node.id);
      this.dirty = true;
      if (kind === "pdf") { this.loadPdf(node, src, key); continue; }
      if (!primary || !MEDIA_URL_PATTERN.test(primary)) continue;
      if (kind === "carousel") { this.loadCarouselImages(node, urls, key); continue; }
      if (kind === "carouselVideo") { this.loadCarouselVideos(node, urls, key); continue; }
      const decoded = kind === "image" && this.state.preview && node.data.__kitListRootId
        ? decodedImages.get(key) : undefined;
      if (decoded) {
        this.resources.set(node.id, { key, element: decoded, createdAt: performance.now(),
          pending: Promise.resolve(), settled: true, dispose: () => {} });
        try { this.uploadPixels(node.id, decoded); }
        catch { this.setStatus(node.id, "加载失败：媒体来源不允许读取像素"); }
        continue;
      }
      const media = kind === "image" ? new Image()
        : document.createElement(kind === "audio" ? "audio" : "video");
      media.crossOrigin = "anonymous";
      if (media instanceof HTMLMediaElement) {
        media.preload = "auto"; media.loop = node.data.loop !== false; media.muted = node.data.muted !== false;
        if (media instanceof HTMLVideoElement) { media.playsInline = true; }
      }
      const resource: MediaResource = { key, element: media, createdAt: performance.now(), pending: Promise.resolve(), dispose: () => {
        if (media instanceof HTMLMediaElement) { media.pause(); media.removeAttribute("src"); media.load(); }
      } };
      if (media instanceof HTMLVideoElement && media.requestVideoFrameCallback) {
        let frameCallback = 0;
        const onFrame: VideoFrameRequestCallback = () => {
          resource.videoFrameReady = true;
          frameCallback = media.requestVideoFrameCallback(onFrame);
        };
        frameCallback = media.requestVideoFrameCallback(onFrame);
        const release = resource.dispose;
        resource.dispose = () => { media.cancelVideoFrameCallback(frameCallback); release(); };
      }
      // RTSP / RTMP：浏览器无法播放，直接短路提示，不挂标准加载计时器（避免 15s 后被「请求超时」覆盖）
      const unsupportedStream = kind === "monitor" && ["rtsp", "rtmp"].includes(String(node.data.protocol ?? "hls"));
      if (!unsupportedStream) resource.pending = new Promise<void>(resolve => {
        let finished = false;
        const finish = (failure?: string) => {
          if (finished) return; finished = true;
          window.clearTimeout(timer);
          media.removeEventListener("load", loaded); media.removeEventListener("loadeddata", loaded); media.removeEventListener("error", failed);
          if (!this.disposed && this.resources.get(node.id) === resource && failure !== "disposed") {
            if (failure) { this.setStatus(node.id, failure); resolve(); return; }
            try {
              if (!(media instanceof HTMLAudioElement)) this.uploadPixels(node.id, media as HTMLImageElement | HTMLVideoElement);
              resource.settled = true;
              // 山海鲸「自动播放」：预览态起播（被浏览器策略拦截时给出提示）
              if (media instanceof HTMLMediaElement && this.state?.preview
                  && (kind === "monitor" || node.data.autoplay !== false)) {
                void media.play().catch(() => this.setStatus(node.id, "自动播放被浏览器拦截，请点击画面播放"));
              }
              // 山海鲸「外框跟随图片尺寸」：居中填充时组件外框按图片原始尺寸调整（仅编辑态，避免污染预览）
              if (kind === "image" && !rankingChart && !this.state?.preview && media instanceof HTMLImageElement
                  && node.data.frameFollowsImage === true
                  && String(node.data.objectFit ?? "stretch") === "center"
                  && resource.frameApplied !== node.widget.image
                  && (Math.abs(media.naturalWidth - node.width) > 1 || Math.abs(media.naturalHeight - node.height) > 1)) {
                resource.frameApplied = node.widget.image;
                this.options.onEdit?.({ type: "resize", id: node.id, x: node.x, y: node.y,
                  width: media.naturalWidth, height: media.naturalHeight });
              }
            }
            catch { this.setStatus(node.id, "加载失败：媒体来源不允许读取像素"); }
          }
          resolve();
        };
        const loaded = () => finish();
        const failed = () => finish("加载失败：请检查媒体地址");
        const timer = window.setTimeout(() => finish("加载失败：媒体请求超时"), 15000);
        const release = resource.dispose;
        resource.dispose = () => { finish("disposed"); release(); };
        media.addEventListener(media instanceof HTMLImageElement ? "load" : "loadeddata", loaded, { once: true });
        if (media instanceof HTMLMediaElement) {
          media.addEventListener("playing", () => { resource.startedOnce = true; }, { once: true });
        }
        media.addEventListener("error", failed, { once: true });
      });
      this.resources.set(node.id, resource);
      if (unsupportedStream) {
        this.setStatus(node.id, "浏览器不支持 RTSP / RTMP 流，请使用 HLS 或 FLV 地址");
      } else if (kind === "monitor") {
        this.attachMonitorStream(node, media as HTMLVideoElement, resource, primary);
      } else {
        media.src = primary;
      }
    }
  }

  private loadKitCity(node: RustBoardNode, pieces: ReferenceKitPiece[]): void {
    const id = CITY_IMAGE_PREFIX + node.id;
    const scene = kitSceneGeometry(pieces);
    const scale = Math.min(1, 900 / Math.max(node.width, node.height));
    const size = { width: Math.max(2, Math.round(node.width * scale)), height: Math.max(2, Math.round(node.height * scale)) };
    const key = JSON.stringify([scene, size]);
    const previous = this.resources.get(id);
    if (previous?.key === key) return;
    previous?.dispose();
    this.surface?.clear_image(id);
    this.dirty = true;
    const controller = new AbortController();
    const resource: MediaResource = { key, createdAt: performance.now(), pending: Promise.resolve(),
      dispose: () => controller.abort() };
    this.resources.set(id, resource);
    if (scene.objects.length) resource.pending = drawKitScene(scene, size, controller.signal)
      .then(canvas => {
        if (canvas && !controller.signal.aborted && !this.disposed) this.uploadPixels(id, canvas);
      }).catch(() => {});
  }

  private loadChartImage(node: RustBoardNode, id: string, src: string): void {
    if (!this.surface) return;
    const key = JSON.stringify(["chart-image", src]);
    const previous = this.resources.get(id);
    if (previous?.key === key) return;
    if (!previous && (!src || !MEDIA_URL_PATTERN.test(src))) return;
    previous?.dispose(); this.resources.delete(id); this.surface.clear_image(id); this.dirty = true;
    if (!src || !MEDIA_URL_PATTERN.test(src)) return;
    const image = new Image(); image.crossOrigin = "anonymous";
    const resource: MediaResource = { key, element: image, createdAt: performance.now(), pending: Promise.resolve(), dispose: () => {} };
    resource.pending = new Promise<void>(resolve => {
      let finished = false;
      const finish = (failure?: string) => {
        if (finished) return; finished = true; window.clearTimeout(timer);
        image.removeEventListener("load", loaded); image.removeEventListener("error", failed);
        if (!this.disposed && this.resources.get(id) === resource && failure !== "disposed") {
          if (failure) this.setStatus(node.id, failure);
          else try { this.uploadPixels(id, image); resource.settled = true; }
            catch { this.setStatus(node.id, "加载失败：媒体来源不允许读取像素"); }
        }
        resolve();
      };
      const loaded = () => finish();
      const failed = () => finish("加载失败：请检查媒体地址");
      const timer = window.setTimeout(() => finish("加载失败：媒体请求超时"), 15000);
      resource.dispose = () => finish("disposed");
      image.addEventListener("load", loaded, { once: true });
      image.addEventListener("error", failed, { once: true });
    });
    this.resources.set(id, resource);
    image.src = src;
  }

  /** 山海鲸「监控设置-协议类型」：HLS / FLV 经 MSE 库接入 <video>（RTSP / RTMP 已在 loadResources 短路）。 */
  private attachMonitorStream(node: RustBoardNode, video: HTMLVideoElement, _resource: MediaResource, url: string): void {
    const protocol = String(node.data.protocol ?? "hls");
    void (async () => {
      try {
        if (protocol === "hls" && !video.canPlayType("application/vnd.apple.mpegurl")) {
          const { default: Hls } = await import("hls.js");
          if (!Hls.isSupported()) {
            if (this.resources.get(node.id) === _resource) this.setStatus(node.id, "当前浏览器不支持 HLS 播放");
            return;
          }
          const hls = new Hls({ liveDurationInfinity: true });
          hls.loadSource(url); hls.attachMedia(video);
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal && this.resources.get(node.id) === _resource) {
              this.setStatus(node.id, "监控流连接失败，请检查地址与协议");
            }
          });
          const release = _resource.dispose;
          _resource.dispose = () => { hls.destroy(); release(); };
          return;
        }
        if (protocol === "flv") {
          const mpegts = (await import("mpegts.js")).default;
          if (!mpegts.getFeatureList().mseLivePlayback) {
            if (this.resources.get(node.id) === _resource) this.setStatus(node.id, "当前浏览器不支持 FLV 直播流");
            return;
          }
          const player = mpegts.createPlayer({ type: "flv", isLive: true, url }, { enableStashBuffer: false });
          player.attachMediaElement(video); player.load();
          const release = _resource.dispose;
          _resource.dispose = () => { player.destroy(); release(); };
          return;
        }
        video.src = url; // 原生可播（HLS on Safari / mp4 监控回放）
      } catch {
        if (this.resources.get(node.id) === _resource) this.setStatus(node.id, "监控流初始化失败，请检查地址与协议");
      }
    })();
  }

  /** 山海鲸「轮播图」：按地址列表预载全部图片，状态机驱动切换。 */
  private loadCarouselImages(node: RustBoardNode, urls: string[], key: string): void {
    const usable = urls.filter(url => MEDIA_URL_PATTERN.test(url));
    if (!usable.length) return;
    const images = usable.map(url => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.src = url;
      return image;
    });
    const resource: MediaResource = {
      key, createdAt: performance.now(), images,
      carousel: { index: 0, lastSwitch: performance.now(), playedOnce: false, transition: null },
      pending: Promise.all(images.map(image => new Promise<void>(resolve => {
        if (image.complete) { resolve(); return; }
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      }))).then(() => {}),
      dispose: () => { images.forEach(image => { image.src = ""; }); },
    };
    resource.pending.then(() => {
      if (!this.disposed && this.resources.get(node.id) === resource) {
        resource.settled = false; this.dirty = true;
      }
    });
    this.resources.set(node.id, resource);
  }

  /** 山海鲸「轮播视频」：多 <video> 队列按顺序自动循环，播完切下一个。 */
  private loadCarouselVideos(node: RustBoardNode, urls: string[], key: string): void {
    const usable = urls.filter(url => MEDIA_URL_PATTERN.test(url));
    if (!usable.length) return;
    const videos = usable.map(url => {
      const video = document.createElement("video");
      video.crossOrigin = "anonymous"; video.preload = "auto"; video.playsInline = true;
      video.muted = node.data.muted !== false; video.loop = false;
      video.src = url;
      return video;
    });
    const resource: MediaResource = {
      key, createdAt: performance.now(), videos,
      carousel: { index: 0, lastSwitch: performance.now(), playedOnce: false, transition: null },
      pending: Promise.all(videos.map(video => new Promise<void>(resolve => {
        if (video.readyState >= 1) { resolve(); return; }
        video.addEventListener("loadeddata", () => resolve(), { once: true });
        video.addEventListener("error", () => resolve(), { once: true });
      }))).then(() => {}),
      dispose: () => { videos.forEach(video => { video.pause(); video.removeAttribute("src"); video.load(); }); },
    };
    videos.forEach((video, index) => {
      if (video.requestVideoFrameCallback) {
        let frameCallback = 0;
        const onFrame: VideoFrameRequestCallback = () => {
          if (resource.carousel?.index === index) { resource.videoFrameReady = true; }
          frameCallback = video.requestVideoFrameCallback(onFrame);
        };
        frameCallback = video.requestVideoFrameCallback(onFrame);
        const release = resource.dispose;
        resource.dispose = () => { video.cancelVideoFrameCallback(frameCallback); release(); };
      }
      video.addEventListener("ended", () => {
        if (this.resources.get(node.id) !== resource || !resource.carousel) return;
        const next = (resource.carousel.index + 1) % videos.length;
        if (next === 0 && node.data.loop === false) { resource.carousel.playedOnce = true; return; }
        resource.carousel.index = next; resource.carousel.lastSwitch = performance.now();
        const active = videos[next];
        if (this.state?.preview && node.data.autoplay !== false) {
          void active.play().catch(() => this.setStatus(node.id, "播放失败，请检查媒体地址"));
        }
        this.dirty = true;
      }, { once: false });
    });
    resource.pending.then(() => {
      if (!this.disposed && this.resources.get(node.id) === resource && this.state?.preview && node.data.autoplay !== false) {
        void videos[0].play().catch(() => this.setStatus(node.id, "自动播放被浏览器拦截，请点击画面播放"));
      }
    });
    this.resources.set(node.id, resource);
  }

  /** 山海鲸「基础PDF」：pdf.js 解码当前页 → canvas → set_image 纹理；页码经 setValue 回传 Rust 显示。 */
  /** 山海鲸「瓦片地图」在线影像：按当前视野取 XYZ 瓦片网格，逐片到位后合成底图纹理（set_image 供 Rust 铺底）。 */
  private loadMapImagery(node: RustBoardNode, key: string, imagery: string,
    view: { lonMin: number; lonMax: number; latMin: number; latMax: number; projection: "equirect" | "mercator" },
    width: number, height: number): void {
    const tileConfig = (node.data.tile ?? {}) as { centerLon?: number; centerLat?: number; zoom?: number };
    const window = mapTileWindow(view, tileConfig);
    const source = IMAGERY_SOURCES[imagery]!;
    const yToLat = (y: number) => (2 * Math.atan(Math.exp(y)) * 180) / Math.PI - 90;
    // Web 墨卡托层级：瓦片分辨率不低于合成画布；瓦片总数超限则降级层级
    const buildGrid = (z: number) => {
      const n = 2 ** z;
      const x0 = Math.min(n - 1, Math.max(0, Math.floor(((window.lonMin + 180) / 360) * n)));
      const x1 = Math.min(n - 1, Math.max(0, Math.floor(((window.lonMax + 180) / 360) * n)));
      const norm = (mercY: number) => Math.min(n - 1, Math.max(0, Math.floor((0.5 - mercY / (2 * Math.PI)) * n)));
      const y0 = norm(window.top);
      const y1 = Math.max(y0, norm(window.bottom));
      return { n, x0, x1, y0, y1, count: (x1 - x0 + 1) * (y1 - y0 + 1) };
    };
    const neededWorldPx = (width * 360) / window.lonSpan;
    let z = Math.min(18, Math.max(2, Math.round(Math.log2(Math.max(1, neededWorldPx) / 256))));
    let grid = buildGrid(z);
    while (grid.count > 48 && z > 2) { z -= 1; grid = buildGrid(z); }
    const resource: MediaResource = {
      key, createdAt: performance.now(),
      imagery: { tiles: new Map(), width, height },
      pending: Promise.resolve(), dispose: () => {},
    };
    this.resources.set(node.id, resource);
    const queue: { x: number; y: number; z: number; url: string }[] = [];
    for (let y = grid.y0; y <= grid.y1; y++) {
      for (let x = grid.x0; x <= grid.x1; x++) {
        queue.push({ x, y, z, url: source(x, y, z) });
      }
    }
    let settledCount = 0;
    const settle = () => {
      settledCount += 1;
      if (settledCount >= queue.length && this.resources.get(node.id) === resource) {
        // 全部失败：不产纹理，Rust 保持内置主题矢量
        if (!resource.imagery!.tiles.size) { resource.imagery = undefined; }
      }
    };
    for (const entry of queue) {
      const cached = tileCache.get(entry.url);
      if (cached) {
        if (cached.ok) {
          resource.imagery!.tiles.set(entry.url, { img: cached.img, x: entry.x, y: entry.y, z: entry.z });
        }
        settle();
        continue;
      }
      const img = new Image();
      img.crossOrigin = "anonymous";
      const tileEntry = { img, x: entry.x, y: entry.y, z: entry.z };
      // 立即挂入 resource 强引用：无 DOM 父节点的 Image 若无引用会在加载中被 GC（请求无声消失）
      resource.imagery!.tiles.set(entry.url, tileEntry);
      const done = (ok: boolean) => {
        if (!tileCache.has(entry.url)) {
          tileCache.set(entry.url, { img, ok });
          if (tileCache.size > TILE_CACHE_MAX) {
            const oldest = tileCache.keys().next().value;
            if (oldest !== undefined) tileCache.delete(oldest);
          }
        }
        if (this.disposed || this.resources.get(node.id) !== resource) return;
        if (!ok) resource.imagery?.tiles.delete(entry.url);
        this.compositeMapImagery(node, resource);
        settle();
      };
      img.addEventListener("load", () => done(true), { once: true });
      img.addEventListener("error", () => done(false), { once: true });
      img.src = entry.url;
    }
    this.compositeMapImagery(node, resource);
  }

  /** 把已到位的瓦片合成到底图画布并上传纹理（墨卡托线性 → 瓦片映射为轴对齐矩形）。 */
  private compositeMapImagery(node: RustBoardNode, resource: MediaResource): void {
    const imagery = resource.imagery;
    if (!imagery?.tiles.size || !this.surface) return;
    const tileConfig = (node.data.tile ?? {}) as { centerLon?: number; centerLat?: number; zoom?: number };
    const view = REGION_VIEWS[String(node.data.region ?? "china")] ?? REGION_VIEWS.china!;
    const project = makeProjector(view, tileConfig);
    const scale = imagery.width / MAP_VIEW.width;
    this.decodeCanvas.width = imagery.width;
    this.decodeCanvas.height = imagery.height;
    const context = this.decodeCanvas.getContext("2d", { willReadFrequently: true })!;
    context.clearRect(0, 0, imagery.width, imagery.height);
    for (const { img, x, y, z } of imagery.tiles.values()) {
      if (!img.complete || !img.naturalWidth) continue;
      const n = 2 ** z;
      const lon0 = (x / n) * 360 - 180;
      const lon1 = ((x + 1) / n) * 360 - 180;
      const latTop = (2 * Math.atan(Math.exp((0.5 - y / n) * 2 * Math.PI)) * 180) / Math.PI - 90;
      const latBottom = (2 * Math.atan(Math.exp((0.5 - (y + 1) / n) * 2 * Math.PI)) * 180) / Math.PI - 90;
      const [px0, py0] = project(lon0, latTop);
      const [px1, py1] = project(lon1, latBottom);
      context.drawImage(img, px0 * scale, py0 * scale, (px1 - px0) * scale, (py1 - py0) * scale);
    }
    // 不能走 uploadPixels：它重设 decodeCanvas.width（同值也清空画布）会抹掉刚合成的影像
    const frame = context.getImageData(0, 0, imagery.width, imagery.height);
    this.surface.set_image(node.id, frame.width, frame.height, new Uint8Array(frame.data.buffer));
    this.dirty = true;
  }

  private loadPdf(node: RustBoardNode, src: string, key: string): void {
    const resource: MediaResource = { key, createdAt: performance.now(), pdf: { page: 1, pages: 1 }, pending: Promise.resolve(), dispose: () => {} };
    this.resources.set(node.id, resource);
    resource.pending = (async () => {
      if (!src || !MEDIA_URL_PATTERN.test(src)) return;
      const [pdfjs, worker] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const task = pdfjs.getDocument({ url: src });
      const doc = await task.promise;
      if (this.disposed || this.resources.get(node.id) !== resource) { void task.destroy(); return; }
      resource.pdfDoc = doc;
      resource.pdfTask = task;
      resource.pdf = { page: 1, pages: doc.numPages };
      await this.renderPdfPage(node.id, resource, doc, 1);
      this.setValue(node.id, { page: 1, pages: doc.numPages });
    })().catch(() => {
      if (this.resources.get(node.id) === resource) this.setStatus(node.id, "加载失败：请检查 PDF 地址");
    });
    const release = resource.dispose;
    resource.dispose = () => { void resource.pdfTask?.destroy(); resource.pdfDoc = undefined; resource.pdfTask = undefined; resource.pdf = undefined; release(); };
  }

  /** 渲染 PDF 当前页（页码事件与初始加载共用）。 */
  private async renderPdfPage(id: string, resource: MediaResource,
    doc: import("pdfjs-dist").PDFDocumentProxy, page: number): Promise<void> {
    const target = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
    const base = target.getViewport({ scale: 1 });
    const scale = Math.min(2, 1024 / Math.max(base.width, 1));
    const viewport = target.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
    await target.render({ canvas, viewport }).promise;
    if (this.disposed || this.resources.get(id) !== resource) return;
    this.uploadPixels(id, canvas);
    this.dirty = true;
  }

  /** 山海鲸「点击切换下一页 / 翻页按钮」：页码步进后重渲染并回传 Rust。 */
  private async turnPage(id: string, delta: number): Promise<void> {
    const resource = this.resources.get(id);
    if (!resource?.pdf || !resource.pdfDoc || !delta) return;
    if (resource.pdf.pages <= 1) return;
    const next = Math.min(Math.max(1, resource.pdf.page + delta), resource.pdf.pages);
    if (next === resource.pdf.page) return;
    resource.pdf.page = next;
    try {
      await this.renderPdfPage(id, resource, resource.pdfDoc, next);
      this.setValue(id, { page: next, pages: resource.pdf.pages });
    } catch {
      this.setStatus(id, "PDF 翻页失败，请检查文件地址");
    }
  }

  /** 轮播图「切换按钮」：步进页码并触发「平移 / 翻转」过渡合成。 */
  private stepCarousel(id: string, delta: number): void {
    const resource = this.resources.get(id);
    if (!resource?.carousel || !delta) return;
    const node = this.nodes.find(item => item.id === id);
    const urls = Array.isArray(node?.data.urls) ? node.data.urls.map(String) : [];
    if (!urls.length) return;
    const state = resource.carousel;
    const from = state.index;
    state.index = (state.index + delta + urls.length) % urls.length;
    state.transition = node && node.data.playAnimation !== false
      ? { from, to: state.index, start: performance.now() } : null;
    state.lastSwitch = performance.now();
    state.playedOnce = false;
    resource.settled = false;
    this.dirty = true;
  }

  private uploadPixels(id: string, source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement): void {
    const width = source instanceof HTMLImageElement ? source.naturalWidth
      : source instanceof HTMLVideoElement ? source.videoWidth : source.width;
    const height = source instanceof HTMLImageElement ? source.naturalHeight
      : source instanceof HTMLVideoElement ? source.videoHeight : source.height;
    if (!width || !height || !this.surface) return;
    const scale = Math.min(1, 2048 / Math.max(width, height));
    this.decodeCanvas.width = Math.max(1, Math.round(width * scale));
    this.decodeCanvas.height = Math.max(1, Math.round(height * scale));
    const context = this.decodeCanvas.getContext("2d", { willReadFrequently: true })!;
    const filter = this.nodes.find(node => node.id === id)?.data.__kitImageFilter;
    context.filter = imageCanvasFilter(filter);
    context.drawImage(source, 0, 0, this.decodeCanvas.width, this.decodeCanvas.height);
    const frame = context.getImageData(0, 0, this.decodeCanvas.width, this.decodeCanvas.height);
    this.surface.set_image(id, frame.width, frame.height, new Uint8Array(frame.data.buffer));
    this.dirty = true;
  }

  dispose(): void {
    this.disposed = true; cancelAnimationFrame(this.raf); this.observer.disconnect();
    this.weather.dispose();
    this.clearPendingVisual();
    this.listeners.forEach(remove => remove()); this.listeners = [];
    for (const resource of this.resources.values()) resource.dispose();
    this.resources.clear();
    for (const iframe of this.iframeElements.values()) { iframe.src = "about:blank"; iframe.remove(); }
    this.iframeElements.clear();
    this.surface?.free(); this.surface = null; this.layer.remove();
  }
}
