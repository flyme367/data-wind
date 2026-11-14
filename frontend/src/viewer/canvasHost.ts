import { nodeBounds, type EditorSettings } from "../data/editor";
import type { HudToggles } from "../state/store";
import { acquireEngine } from "../engine/engineClient";
import { createPointerInput } from "../engine/frameInput";
import { dispatchCommandResponse } from "../engine/commandResponse";
import { probeWebGPU } from "../engine/gpuProbe";
import { type SoftCamera } from "../engine/softwareRenderer";
import { createSceneSurface } from "../engine/engineWorker/sceneRenderClient";
import type { SceneSurface } from "../engine/engineWorker/protocol";
import { loadModelBuffer } from "../engine/modelLibrary";
import { createPickEvents, type PickTrigger } from "../engine/pickEvents";
import { fromEnginePoint, toEngineFlat, toEnginePoint, type ViewOrigin } from "../engine/viewOrigin";
import { encodeSceneUpdate, encodeSetEnvironment, encodeSetHud, encodeSetMode } from "../engine/commands";
import type { EngineStats, FlatInstance, SceneNode } from "../types";

type Engine = Awaited<ReturnType<typeof acquireEngine>["ready"]>;

export interface CanvasHostOptions {
  /** 每帧取最新实例数据（软件渲染路径）；引擎路径由 syncScene 推送 */
  getFlat: () => FlatInstance[];
  getScene: () => SceneNode[];
  getSettings: () => EditorSettings;
  getViewOrigin: () => ViewOrigin;
  /** 引擎拾取回调（驱动交互规则） */
  onPick?: (id: string | null, trigger: PickTrigger) => void;
  onStats?: (stats: EngineStats) => void;
}

const daylight = (time: number) => .18 + .82 * Math.max(0, Math.sin((time - 6) / 12 * Math.PI));
const rgba = (hex: string, alpha = 1) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).concat(alpha);

/**
 * 无框架画布宿主：发布成品与编辑器共用同一引擎/软渲染代码路径。
 * 只保留"画面"职责——旋转/平移/缩放、拾取回调、模型注册、环境光照；不包含任何编辑语义。
 */
export class CanvasHost {
  private readonly canvas!: HTMLCanvasElement;
  private readonly fallbackCanvas!: HTMLCanvasElement;
  private readonly loadingEl!: HTMLElement;
  private readonly fallbackEl!: HTMLElement;
  private readonly modelStatusEl!: HTMLElement;
  private readonly errorEl!: HTMLElement;
  private engine: Engine | null = null;
  private software: SceneSurface | null = null;
  private lease: ReturnType<typeof acquireEngine> | null = null;
  private registeredModels = new Set<string>();
  private pendingFlat: FlatInstance[] = [];
  private hud: HudToggles = { grid: true, flylines: true, stats: false };
  private disposed = false;
  private raf = 0;
  private camera: SoftCamera = { target: [2, 2, 0], yaw: 0.75, pitch: 0.55, dist: 72 };
  /** 大场景（如化工厂区）首次推送时自动把轨道相机适配到全景，仅一次 */
  private autoFitDone = false;
  private observer: ResizeObserver;
  private readonly listeners: [EventTarget, string, EventListenerOrEventListenerObject][] = [];

  constructor(container: HTMLElement, private readonly options: CanvasHostOptions) {
    const initialOrigin = options.getViewOrigin();
    this.camera.target = [initialOrigin.x + 2, 2, initialOrigin.z];
    this.canvas = document.createElement("canvas");
    this.canvas.dataset.testid = "scene-canvas";
    this.canvas.setAttribute("aria-label", "三维场景画布");
    this.fallbackCanvas = document.createElement("canvas");
    this.fallbackCanvas.setAttribute("aria-hidden", "true");
    this.fallbackCanvas.dataset.fallback = "true";
    this.loadingEl = document.createElement("div");
    this.loadingEl.className = "viewport-loading";
    this.loadingEl.textContent = "正在加载三维场景…";
    this.fallbackEl = document.createElement("div");
    this.fallbackEl.className = "viewport-fallback";
    this.fallbackEl.textContent = "当前浏览器未启用 GPU · CPU 兼容渲染";
    this.fallbackEl.hidden = true;
    this.modelStatusEl = document.createElement("div");
    this.modelStatusEl.className = "viewport-model-status";
    this.modelStatusEl.hidden = true;
    this.errorEl = document.createElement("div");
    this.errorEl.className = "viewport-error";
    this.errorEl.hidden = true;
    container.classList.add("viewport-host");
    container.append(this.canvas, this.fallbackCanvas, this.loadingEl, this.fallbackEl, this.modelStatusEl, this.errorEl);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.canvas);
    const relative = (event: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top] as const;
    };
    let drag: { kind: "orbit" | "pan"; x: number; y: number; startX: number; startY: number; moved: boolean } | null = null;
    let lastRelease = { x: 0, y: 0 };
    const picks = createPickEvents((id, _additive, trigger) => this.options.onPick?.(id, trigger));
    const pointerDown = (event: PointerEvent) => {
      this.canvas.setPointerCapture(event.pointerId);
      drag = { kind: event.button === 2 ? "pan" : "orbit", x: event.clientX, y: event.clientY,
        startX: event.clientX, startY: event.clientY, moved: false };
      if (!this.software) this.engine?.pointer_down(...relative(event), event.button, false);
    };
    const applyPointerMove = (event: PointerEvent) => {
      if (this.software && drag) {
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        drag.x = event.clientX; drag.y = event.clientY;
        drag.moved ||= Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4;
        if (drag.kind === "orbit") {
          this.camera.yaw -= dx * 0.006;
          this.camera.pitch = Math.max(0.05, Math.min(1.52, this.camera.pitch + dy * 0.006));
        } else {
          const scale = this.camera.dist * 0.0016;
          this.camera.target[0] -= (Math.cos(this.camera.yaw) * dx + Math.sin(this.camera.yaw) * dy) * scale;
          this.camera.target[2] += (Math.sin(this.camera.yaw) * dx - Math.cos(this.camera.yaw) * dy) * scale;
        }
      } else if (!this.software) {
        this.engine?.pointer_move(...relative(event));
      }
    };
    const pointerMoves = createPointerInput(applyPointerMove);
    const onMove = (event: PointerEvent) => pointerMoves.push(event);
    const pointerUp = (event: PointerEvent) => {
      pointerMoves.end(event.type === "pointercancel" ? undefined : event);
      const [x, y] = relative(event);
      lastRelease = { x, y };
      if (this.software) {
        if (event.type !== "pointercancel" && event.button === 0 && drag && !drag.moved) {
          void this.software.pickAt(x, y).then((id) => {
            if (!this.disposed) picks.click(id, x, y, false);
          });
        }
        drag = null;
      } else { this.engine?.pointer_up(x, y, event.button); drag = null; }
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      pointerMoves.flush();
      if (this.software) this.camera.dist = Math.max(6, Math.min(900, this.camera.dist * Math.exp(event.deltaY * 0.0012)));
      else this.engine?.wheel(event.deltaY);
    };
    const contextMenu = (event: Event) => event.preventDefault();
    const doubleClick = (event: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      picks.doubleClick(event.clientX - rect.left, event.clientY - rect.top, false);
    };
    const on = <T extends Event>(target: EventTarget, type: string, handler: (event: T) => void, options?: boolean | AddEventListenerOptions) => {
      const listener = handler as unknown as EventListener;
      target.addEventListener(type, listener, options);
      this.listeners.push([target, type, listener]);
    };
    on(this.canvas, "pointerdown", pointerDown);
    on(this.canvas, "pointermove", onMove);
    on(this.canvas, "pointerup", pointerUp);
    on(this.canvas, "pointercancel", pointerUp);
    on(this.canvas, "wheel", wheel, { passive: false });
    on(this.canvas, "contextmenu", contextMenu);
    on(this.canvas, "dblclick", doubleClick);
    on(window, "dw:camera", (event) => this.applyCamera((event as CustomEvent).detail ?? {}));
    on(window, "dw:reset-camera", () => {
      pointerMoves.clear();
      const origin = this.options.getViewOrigin();
      this.camera = { target: [origin.x + 2, 2, origin.z], yaw: 0.75, pitch: 0.55, dist: 72 };
      this.engine?.reset_camera();
    });

    const responseHandlers = {
      pick: (id: string | null) => picks.click(id, lastRelease.x, lastRelease.y, false),
      transform: () => {},
      stats: (stats: EngineStats) => this.options.onStats?.(stats),
      hud: () => {},
      error: (message: string) => { throw new Error(message); },
    };
    const render = (time: number) => {
      if (this.disposed) return;
      try {
        pointerMoves.flush();
        if (this.software) {
          const settings = this.options.getSettings();
          // Worker 路径只做差量 postMessage；主线程回退路径内部自行渲染与统计
          this.software.render(this.options.getFlat(), this.camera,
            { grid: this.hud.grid, selectedId: null, selectedIds: [], background: settings.background,
              daylight: daylight(settings.time), flylines: this.hud.flylines });
        } else if (this.engine) {
          this.engine.frame(time);
          dispatchCommandResponse(this.engine.take_response(), responseHandlers);
        }
      } catch (error) {
        this.showError(error instanceof Error ? error.message : String(error));
        return;
      }
      this.raf = requestAnimationFrame(render);
    };

    void (async () => {
      try {
        const healthy = await probeWebGPU();
        if (this.disposed) return;
        if (healthy) {
          this.lease = acquireEngine(this.canvas);
          const engine = await this.lease.ready;
          if (this.disposed) return;
          this.engine = engine;
          engine.set_mode(encodeSetMode("editor"));
          engine.set_hud(encodeSetHud(this.hud));
          engine.sync_scene(encodeSceneUpdate(toEngineFlat(this.pendingFlat, this.options.getViewOrigin())));
        } else {
          const rect = this.fallbackCanvas.getBoundingClientRect();
          const surface = await createSceneSurface(this.fallbackCanvas, rect.width || 1, rect.height || 1);
          if (this.disposed) { surface.dispose(); return; }
          this.software = surface;
          surface.setStatsListener((stats) => { if (!this.disposed) this.options.onStats?.(stats); });
          this.fallbackEl.hidden = false;
          this.options.onStats?.({ backend: "CPU", fps: 0, instances: 0, visible: 0, particles: 0, tris: 0 });
        }
        this.loadingEl.hidden = true;
        this.syncEnvironment();
        this.resize();
        this.loadModels();
        this.raf = requestAnimationFrame(render);
      } catch (error) {
        if (!this.disposed) this.showError(error instanceof Error ? error.message : String(error));
      }
    })();
  }

  /** 快照或交互 runtime 变化后推送最新实例数据 */
  syncScene(flat: FlatInstance[]): void {
    this.pendingFlat = flat;
    this.engine?.sync_scene(encodeSceneUpdate(toEngineFlat(flat, this.options.getViewOrigin())));
    this.loadModels();
    this.autoFitCamera(flat);
  }

  /** 默认相机（视距 72m）会落在大型布局内部：实例多且跨度大时自动拉远到全景，仅一次 */
  private autoFitCamera(flat: FlatInstance[]): void {
    if (this.autoFitDone || flat.length < 30) return;
    this.autoFitDone = true;
    const modelIds = this.options.getScene()
      .filter((node) => node.type === "model").map((node) => node.id);
    const bounds = nodeBounds(this.options.getScene(), modelIds);
    const span = Math.hypot(...bounds.size);
    if (span < 150 || this.camera.dist >= span * 0.8) return;
    this.camera.target = bounds.center as SoftCamera["target"];
    this.camera.dist = span * 1.15;
    const target = toEnginePoint(this.camera.target, this.options.getViewOrigin());
    this.engine?.camera_view(target[0], target[1], target[2],
      this.camera.yaw, this.camera.pitch, this.camera.dist);
  }

  setHud(hud: HudToggles): void {
    this.hud = hud;
    this.engine?.set_hud(encodeSetHud(hud));
  }

  /** 背景/地面/雾/曝光对比度与光源节点同步（settings.time → daylight 换算与编辑器一致） */
  syncEnvironment(): void {
    const settings = this.options.getSettings();
    const scene = this.options.getScene();
    const filter = `brightness(${settings.exposure}) contrast(${settings.contrast}) saturate(${settings.saturation})`;
    this.canvas.style.filter = filter;
    this.fallbackCanvas.style.filter = filter;
    if (!this.engine) return;
    this.engine.set_environment(encodeSetEnvironment({
      background: rgba(settings.background),
      ground: rgba(settings.groundColor, settings.ground ? 1 : 0),
      daylight: daylight(settings.time),
      fogDistance: settings.fog ? settings.fogDistance : 10000,
    }));
    const light = scene.find((node) => node.type === "light" && node.visible);
    const position = light?.transform.position ?? { x: .45, y: .85, z: .35 };
    const color = light?.color ?? "#FFFFFF";
    this.engine.set_lighting(position.x, position.y, position.z,
      ...[1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255) as [number, number, number], light?.lightIntensity ?? 1);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    for (const [target, type, handler] of this.listeners) target.removeEventListener(type, handler);
    this.listeners.length = 0;
    this.lease?.release();
    this.engine = null;
    this.software?.dispose();
    this.software = null;
    for (const element of [this.canvas, this.fallbackCanvas, this.loadingEl, this.fallbackEl, this.modelStatusEl, this.errorEl]) element.remove();
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (this.software) this.software.resize(rect.width, rect.height);
    if (this.engine) this.engine.resize(rect.width, rect.height, Math.min(devicePixelRatio || 1, 2));
  }

  private showError(message: string): void {
    this.errorEl.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = "三维场景加载失败";
    const paragraph = document.createElement("p");
    paragraph.textContent = message;
    const button = document.createElement("button");
    button.textContent = "重新加载";
    button.addEventListener("click", () => window.location.reload());
    this.errorEl.append(strong, paragraph, button);
    this.errorEl.hidden = false;
    cancelAnimationFrame(this.raf);
  }

  private loadModels(): void {
    const engine = this.engine, software = this.software;
    if ((!engine && !software) || this.disposed) return;
    const missing = [...new Set(this.pendingFlat.map((item) => item.modelId).filter((id): id is string => Boolean(id)))]
      .filter((id) => !this.registeredModels.has(id));
    if (!missing.length) return;
    this.modelStatusEl.hidden = false;
    this.modelStatusEl.textContent = "正在加载场景模型…";
    void Promise.allSettled(missing.map(async (id) => {
      const model = await loadModelBuffer(id, this.options.getScene().find((node) => node.modelId === id)?.customMesh);
      if (this.disposed || this.engine !== engine || this.software !== software) return;
      if (engine) engine.register_mesh(model.id, model.bytes);
      else software?.registerModel(model);
      this.registeredModels.add(model.id);
    })).then((results) => {
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (this.disposed) return;
      if (failed) {
        this.modelStatusEl.innerHTML = "";
        const message = document.createElement("span");
        message.textContent = failed.reason instanceof Error ? failed.reason.message : "模型加载失败";
        const retry = document.createElement("button");
        retry.textContent = "重试";
        retry.addEventListener("click", () => { this.registeredModels.clear(); this.loadModels(); });
        this.modelStatusEl.append(message, retry);
      } else this.modelStatusEl.hidden = true;
    });
  }

  /** dw:camera 事件：视角预设 / 相机节点 / 收藏视角（focus 由交互规则触发） */
  private applyCamera(detail: { preset?: string; ids?: string[]; bookmark?: SoftCamera; cameraNode?: SceneNode }): void {
    const values = this.engine?.camera_state();
    const previous: SoftCamera = values?.length === 6
      ? { target: fromEnginePoint([values[0], values[1], values[2]], this.options.getViewOrigin()), yaw: values[3], pitch: values[4], dist: values[5] }
      : this.camera;
    const bounds = nodeBounds(this.options.getScene(), detail.ids ?? []);
    const next: SoftCamera = detail.bookmark ?? {
      ...previous,
      target: detail.preset === "focus" ? bounds.center as SoftCamera["target"] : previous.target,
      dist: detail.preset === "focus" ? Math.max(8, Math.hypot(...bounds.size) * 1.8) : previous.dist,
      ...(detail.preset === "top" ? { pitch: 1.55, yaw: 0 } : detail.preset === "front" ? { pitch: .01, yaw: 0 }
        : detail.preset === "right" ? { pitch: .01, yaw: Math.PI / 2 } : detail.preset === "orbit" ? { pitch: .55, yaw: .75 } : {}),
    };
    if (detail.cameraNode) {
      const position = detail.cameraNode.transform.position, targetTo = detail.cameraNode.to ?? { x: 0, y: 2, z: 0 };
      const dx = position.x - targetTo.x, dy = position.y - targetTo.y, dz = position.z - targetTo.z;
      next.target = [targetTo.x, targetTo.y, targetTo.z];
      next.dist = Math.hypot(dx, dy, dz);
      next.yaw = Math.atan2(dx, dz);
      next.pitch = Math.asin(dy / Math.max(.1, next.dist));
    }
    // 与引擎 camera_view 的 clamp 保持一致，视角不允许钻到棋盘地面以下
    next.pitch = Math.min(1.56, Math.max(0.01, next.pitch));
    this.camera = next;
    const target = toEnginePoint(next.target, this.options.getViewOrigin());
    this.engine?.camera_view(target[0], target[1], target[2], next.yaw, next.pitch, next.dist);
  }
}
