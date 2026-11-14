import { nodeBounds, descendants } from "../data/editor";
import { openSceneContextMenu } from "../state/contextMenu";
import { resolveRuntimeScene, runtimeFlat } from "../data/runtimeScene";
import TransformHandles, { type HandleProjection } from "./TransformHandles";
import { useEffect, useMemo, useRef, useState } from "react";
import { acquireEngine } from "../engine/engineClient";
import { decodePreviewFrame, registerSceneCapture } from "../engine/captureFrame";
import { createPickEvents, type PickTrigger } from "../engine/pickEvents";
import { createPointerInput } from "../engine/frameInput";
import { dispatchCommandResponse, type ResponseHandlers } from "../engine/commandResponse";
import { fromEnginePoint, toEngineFlat, toEnginePoint } from "../engine/viewOrigin";
import { encodeSceneUpdate, encodeSetEnvironment, encodeSetHud, encodeSetMode, encodeSetSelections } from "../engine/commands";
import { probeWebGPU } from "../engine/gpuProbe";
import { screenPointOnPlane, projectWorldPoint, type SoftCamera } from "../engine/softwareRenderer";
import { createSceneSurface } from "../engine/engineWorker/sceneRenderClient";
import type { SceneSurface } from "../engine/engineWorker/protocol";
import { getState, setState, useStore } from "../state/store";
import type { FlatInstance, SceneNode } from "../types";
import { loadModelBuffer } from "../engine/modelLibrary";
import { modelAssetById } from "../data/modelCatalog";
import { modelNode } from "../data/modelNode";
import { getSceneBridge } from "../workers/bridge";

interface ViewportProps {
  mode: "login" | "editor";
  editable?: boolean;
  onPick?: (id: string | null, additive?: boolean, trigger?: PickTrigger) => void;
}

export default function Viewport({ mode, editable = false, onPick }: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Awaited<ReturnType<typeof acquireEngine>["ready"]> | null>(null);
  const softwareRef = useRef<SceneSurface | null>(null);
  const registeredModels = useRef(new Set<string>());
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [retryModels, setRetryModels] = useState(0);
  const [handles,setHandles]=useState<HandleProjection|null>(null);
  const shiftRef=useRef(false);
  const pickRef = useRef(onPick);
  const editableRef = useRef(editable);
  const planePointRef = useRef<(x: number, y: number, height: number) => [number, number, number] | null>(() => null);
  pickRef.current = onPick;
  editableRef.current = editable;
  const store = useStore();
  const { engineReady, webgpuError, stats, flat: sourceFlat, selectedId, selectedIds, hud, scene, runtime, liveData, settings } = store;
  const flat=useMemo(()=>runtimeFlat({ scene, flat: sourceFlat, runtime, liveData }),[sourceFlat,scene,runtime,liveData]);
  useEffect(()=>{
    const rgba=(hex:string,alpha=1)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).concat(alpha);
    engineRef.current?.set_environment(encodeSetEnvironment({background:rgba(settings.background),ground:rgba(settings.groundColor,settings.ground?1:0),daylight:.18+.82*Math.max(0,Math.sin((settings.time-6)/12*Math.PI)),fogDistance:settings.fog?settings.fogDistance:10000}));
    const light=resolveRuntimeScene(scene,liveData,runtime).find(n=>n.type==="light"&&n.visible),p=light?.transform.position??{x:.45,y:.85,z:.35},color=light?.color??"#FFFFFF";
    engineRef.current?.set_lighting(p.x,p.y,p.z,...[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255) as [number,number,number],light?.lightIntensity??1);
  },[settings,engineReady,scene,liveData,runtime]);
  useEffect(()=>{engineRef.current?.set_selections(encodeSetSelections([...descendants(scene,getState().selectedIds)]))},[selectedId,selectedIds,scene,sourceFlat,engineReady]);
  const modelIds = useMemo(() => [...new Set((flat as FlatInstance[])
    .map((item) => item.modelId).filter((id): id is string => Boolean(id)))].sort().join("|"), [flat]);

  // The viewport owns its engine lease, so scene updates must use that same instance.
  useEffect(() => { if (mode === "editor") {engineRef.current?.sync_scene(encodeSceneUpdate(toEngineFlat(flat as FlatInstance[], getState().viewOrigin)));engineRef.current?.set_selections(encodeSetSelections([...descendants(getState().scene,getState().selectedIds)]));} }, [flat, mode]);
  useEffect(() => { engineRef.current?.set_selection(selectedId); }, [selectedId]);
  useEffect(() => { engineRef.current?.set_hud(encodeSetHud(hud)); }, [hud]);
  useEffect(() => {
    const engine = engineRef.current;
    const software = softwareRef.current;
    if (!engineReady || mode !== "editor" || (!engine && !software)) return;
    const missing = (modelIds ? modelIds.split("|") : []).filter((id) => !registeredModels.current.has(id));
    if (!missing.length) { setModelLoading(false); setModelError(null); return; }
    let cancelled = false;
    setModelLoading(true); setModelError(null);
    void Promise.allSettled(missing.map(async (id) => {
      const model = await loadModelBuffer(id,getState().scene.find(n=>n.modelId===id)?.customMesh);
      if (cancelled || engineRef.current !== engine || softwareRef.current !== software) return;
      if (engine) engine.register_mesh(model.id, model.bytes);
      else software?.registerModel(model);
      registeredModels.current.add(model.id);
    })).then((results) => {
      if (cancelled) return;
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      setModelError(failed ? (failed.reason instanceof Error ? failed.reason.message : "模型加载失败") : null);
      setModelLoading(false);
    });
    return () => { cancelled = true; };
  }, [engineReady, mode, modelIds, retryModels]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const fallbackCanvas = fallbackRef.current!;
    let disposed = false;
    let raf = 0;
    let engine: Awaited<ReturnType<typeof acquireEngine>["ready"]> | null = null;
    let lease: ReturnType<typeof acquireEngine> | null = null;
    let software: SceneSurface | null = null;
    let captureInProgress = false;
    let unregisterCapture = () => {};
    type Point = [number, number, number];
    type SoftDrag = {
      kind: "orbit" | "pan" | "move"; x: number; y: number; startX: number; startY: number; moved: boolean;
      target?: { id: string; start: Point; position: Point; offset: Point };
    };
    type CamPose = { target: Point; yaw: number; pitch: number; dist: number };
    let drag: SoftDrag | null = null;
    let cameraOrigin = getState().viewOrigin;
    let camera: SoftCamera = { target: [cameraOrigin.x + 2, 2, cameraOrigin.z], yaw: 0.75, pitch: 0.55, dist: 72 };
    // 相机平滑飞行:dw:camera 触发补间,指针/滚轮随时打断;engine 与软件渲染路径共用
    let fly: { from: CamPose; to: CamPose; start: number; duration: number; origin: { x: number; z: number } } | null = null;
    let lastRelease = { x: 0, y: 0, additive: false };
    const picks = createPickEvents((id, additive, trigger) => pickRef.current?.(id, additive, trigger));
    const syncCameraOrigin = (origin: { x: number; z: number }) => {
      if (!software || (cameraOrigin.x === origin.x && cameraOrigin.z === origin.z)) return;
      camera.target = [camera.target[0] + origin.x - cameraOrigin.x, camera.target[1], camera.target[2] + origin.z - cameraOrigin.z];
      cameraOrigin = origin;
    };
    setState({ engineReady: false, webgpuError: null });

    planePointRef.current = (x, y, height) => {
      const rect = canvas.getBoundingClientRect();
      if (software) return screenPointOnPlane(camera, x, y, rect.width, rect.height, height);
      const point = engine?.position_on_plane(x, y, height);
      // 引擎返回原点相对坐标，世界坐标需加回原点（软件渲染路径全程 f64，无原点）
      return point?.length === 3 ? fromEnginePoint([point[0], point[1], point[2]], getState().viewOrigin) : null;
    };

    const resize = () => {
      if (captureInProgress) return;
      const rect = canvas.getBoundingClientRect();
      if (software) software.resize(rect.width, rect.height);
      if (engine) engine.resize(rect.width, rect.height, Math.min(devicePixelRatio || 1, 2));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const relative = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top] as const;
    };
    const pointerDown = (event: PointerEvent) => {
      shiftRef.current=event.shiftKey;
      fly = null;
      pointerMoves.start(event);
      canvas.setPointerCapture(event.pointerId);
      if (software) {
        const [x, y] = relative(event);
        // 拾取异步化：Worker 路径 pick 走消息往返，先按 orbit 起手，无位移时升级为 move
        const activeDrag: SoftDrag = drag = { kind: event.button === 2 ? "pan" : "orbit", x: event.clientX,
          y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
        if (event.button === 0 && editableRef.current) {
          void software.pickAt(x, y).then((id) => {
            if (disposed || drag !== activeDrag || activeDrag.kind !== "orbit" || activeDrag.moved) return;
            if ((getState().flat as FlatInstance[]).some((item) => item.id === id && item.locked)) return;
            const node = getState().scene.find((item) => item.id === id
              && ["model", "terrain", "water"].includes(item.type) && !item.locked);
            const pos = node?.transform.position;
            const point = pos ? planePointRef.current(x, y, pos.y) : null;
            if (node && pos && point) {
              activeDrag.kind = "move";
              activeDrag.target = { id: node.id, start: [pos.x, pos.y, pos.z], position: [pos.x, pos.y, pos.z],
                offset: [pos.x - point[0], 0, pos.z - point[2]] };
            }
          });
        }
      } else {
        const [x, y] = relative(event);
        engine?.pointer_down(x, y, event.button, editableRef.current);
      }
    };
    const applyPointerMove = (event: PointerEvent) => {
      if (software && drag) {
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        drag.x = event.clientX; drag.y = event.clientY;
        drag.moved ||= Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4;
        if (drag.kind === "orbit") {
          camera.yaw -= dx * 0.006;
          camera.pitch = Math.max(0.05, Math.min(1.52, camera.pitch + dy * 0.006));
        } else if (drag.kind === "pan") {
          const scale = camera.dist * 0.0016;
          camera.target[0] -= (Math.cos(camera.yaw) * dx + Math.sin(camera.yaw) * dy) * scale;
          camera.target[2] += (Math.sin(camera.yaw) * dx - Math.cos(camera.yaw) * dy) * scale;
        } else if (drag.moved && drag.target) {
          const [x, y] = relative(event);
          const point = planePointRef.current(x, y, drag.target.start[1]);
          if (point) {
            drag.target.position = [point[0] + drag.target.offset[0], drag.target.start[1], point[2] + drag.target.offset[2]];
            const { id, position } = drag.target;
            setState({ flat: (getState().flat as FlatInstance[]).map((item) => item.id === id ? { ...item, pos: position } : item) });
          }
        }
      } else {
        const [x, y] = relative(event);
        engine?.pointer_move(x, y);
      }
    };
    const pointerMoves = createPointerInput(applyPointerMove);
    const pointerMove = (event: PointerEvent) => pointerMoves.push(event);
    const pointerUp = (event: PointerEvent) => {
      // A release may arrive before the next animation frame; commit its final position.
      pointerMoves.end(event.type === "pointercancel" ? undefined : event);
      const [x, y] = relative(event);
      lastRelease = { x, y, additive: shiftRef.current };
      if (software) {
        if (drag?.kind === "move" && drag.target) {
          const target = drag.target;
          picks.click(target.id, x, y, shiftRef.current);
          if (drag.moved && target.position.some((value, index) => value !== target.start[index])) {
            getSceneBridge().post({ type: "transform", id: target.id, position: target.position });
          }
        } else if (drag && !drag.moved) {
          void software.pickAt(x, y).then((id) => { if (!disposed) picks.click(id, x, y, shiftRef.current); });
        }
        drag = null;
      } else engine?.pointer_up(x, y, event.button);
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      fly = null;
      pointerMoves.flush();
      if (software) camera.dist = Math.max(6, Math.min(260, camera.dist * Math.exp(event.deltaY * 0.0012)));
      else engine?.wheel(event.deltaY);
    };
    // 3D 画布右键菜单：命中节点 → 先补选中再弹节点菜单；未命中 → 弹 @scene 场景根菜单。
    // 软件路径 software.pickAt 精确拾取；GPU 引擎路径合成一对左键 down/up 走既有 pick_request 流（引擎仅左键抬起拾取），
    // pick 响应经 pendingContext 分流。副作用：右键点在 egui HUD 控件上会同时触发该控件（罕见，接受）。
    const pendingContext = { current: null as { x: number; y: number } | null };
    const openContextMenuAt = (id: string | null, x: number, y: number) => {
      if (id && !getState().selectedIds.includes(id)) getSceneBridge().post({ type: "select", id });
      openSceneContextMenu(x, y, id ?? "@scene");
    };
    const contextMenu = (event: MouseEvent) => {
      event.preventDefault();
      if (!editableRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      if (software) {
        void software.pickAt(x, y).then((id) => { if (!disposed) openContextMenuAt(id, event.clientX, event.clientY); });
      } else {
        pendingContext.current = { x: event.clientX, y: event.clientY };
        engine?.pointer_down(x, y, 0, true);
        engine?.pointer_up(x, y, 0);
      }
    };
    const doubleClick = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      picks.doubleClick(event.clientX - rect.left, event.clientY - rect.top, event.shiftKey);
    };
    const reset = () => {
      fly = null;
      pointerMoves.clear();
      cameraOrigin = getState().viewOrigin;
      camera = { target: [cameraOrigin.x + 2, 2, cameraOrigin.z], yaw: 0.75, pitch: 0.55, dist: 72 };
      // 引擎相机工作在原点相对空间：默认目标 (2,2,0) 即场景中心附近；软件路径仍为世界坐标
      engine?.reset_camera();
    };
    const view = (event: Event) => {
      const detail=(event as CustomEvent).detail??{},current=getState();
      syncCameraOrigin(current.viewOrigin);
      const values=engine?.camera_state();
      // 引擎相机目标点是原点相对坐标；书签/节点等统一用世界坐标，进出各换算一次
      const origin=getState().viewOrigin;
      const previous=values?.length===6?{target:fromEnginePoint([values[0],values[1],values[2]],origin),yaw:values[3],pitch:values[4],dist:values[5]}:camera;
      const bounds=nodeBounds(current.scene,detail.ids??current.selectedIds);
      const target=detail.preset==="focus"?bounds.center as Point:previous.target;
      const next=detail.bookmark??{...previous,target,dist:detail.preset==="focus"?Math.max(8,Math.hypot(...bounds.size)*1.8):previous.dist,
        ...(detail.preset==="top"?{pitch:1.55,yaw:0}:detail.preset==="front"?{pitch:.01,yaw:0}:detail.preset==="right"?{pitch:.01,yaw:Math.PI/2}:detail.preset==="orbit"?{pitch:.55,yaw:.75}:{})};
      if(detail.cameraNode){const p=detail.cameraNode.transform.position,t=detail.cameraNode.to??{x:0,y:2,z:0},dx=p.x-t.x,dy=p.y-t.y,dz=p.z-t.z;next.target=[t.x,t.y,t.z];next.dist=Math.hypot(dx,dy,dz);next.yaw=Math.atan2(dx,dz);next.pitch=Math.asin(dy/Math.max(.1,next.dist));}
      // 与引擎 camera_view 的 clamp 保持一致，视角不允许钻到棋盘地面以下
      next.pitch=Math.min(1.56,Math.max(.01,next.pitch));
      // 启动平滑飞行;origin 在起飞时固定,补间期间 viewOrigin 不应漂移
      fly = { from: { target: [...previous.target] as Point, yaw: previous.yaw, pitch: previous.pitch, dist: previous.dist },
        to: { target: [...next.target] as Point, yaw: next.yaw, pitch: next.pitch, dist: next.dist },
        start: performance.now(), duration: 1400, origin };
      camera=next;
    };
    const saveView=()=>{const value=engine?.camera_state();const current=getState().settings;
      const saved=value?.length===6?{target:Array.from(fromEnginePoint([value[0],value[1],value[2]],getState().viewOrigin)),yaw:value[3],pitch:value[4],dist:value[5]}:camera;
      getSceneBridge().post({type:"configure",patch:{bookmarks:[...current.bookmarks,{...saved,id:crypto.randomUUID(),name:`视角 ${current.bookmarks.length+1}`}].slice(-30)}});
    };
    window.addEventListener("dw:camera",view);window.addEventListener("dw:save-view",saveView);
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("contextmenu", contextMenu);
    canvas.addEventListener("dblclick", doubleClick);
    window.addEventListener("dw:reset-camera", reset);

    const responseHandlers: ResponseHandlers = {
      pick: (id) => {
        const pending = pendingContext.current;
        pendingContext.current = null;
        if (pending) { openContextMenuAt(id, pending.x, pending.y); return; }
        picks.click(id, lastRelease.x, lastRelease.y, lastRelease.additive);
      },
      transform: (id, position) => getSceneBridge().post({ type: "transform", id, position: fromEnginePoint(position, getState().viewOrigin) }),
      stats: (stats) => setState({ stats }),
      hud: (hud) => getSceneBridge().post({type:"configure",patch:hud}),
      error: (message) => { throw new Error(message); },
    };
    let lastHandles=0;
    const render = (time: number) => {
      if (disposed) return;
      (window as unknown as Record<string, number>).__dwLoopTicks = ((window as unknown as Record<string, number>).__dwLoopTicks ?? 0) + 1;
      try {
        pointerMoves.flush();
        const state = getState();
        const activeFly = fly;
        if (activeFly) {
          const progress = Math.min(1, (time - activeFly.start) / activeFly.duration);
          const ease = progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
          const angle = (activeFly.to.yaw - activeFly.from.yaw + Math.PI) % (2 * Math.PI);
          const delta = (angle % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
          const pose: CamPose = {
            target: [0, 1, 2].map((axis) => activeFly.from.target[axis] + (activeFly.to.target[axis] - activeFly.from.target[axis]) * ease) as Point,
            yaw: activeFly.from.yaw + delta * ease,
            pitch: activeFly.from.pitch + (activeFly.to.pitch - activeFly.from.pitch) * ease,
            dist: activeFly.from.dist * (activeFly.to.dist / activeFly.from.dist) ** ease,
          };
          camera = pose;
          const [ex, ey, ez] = toEnginePoint(pose.target, activeFly.origin);
          engine?.camera_view(ex, ey, ez, pose.yaw, pose.pitch, pose.dist);
          if (progress >= 1) fly = null;
        }
        if (software) {
          syncCameraOrigin(state.viewOrigin);
          // Worker 路径只做差量 postMessage，重绘由渲染 Worker 自驱；主线程回退路径内部自行渲染与统计
          software.render(runtimeFlat(state), camera,
            { grid: state.hud.grid, selectedId: state.selectedId, selectedIds: state.selectedIds,
              background: state.settings.background,
              daylight: .18 + .82 * Math.max(0, Math.sin((state.settings.time - 6) / 12 * Math.PI)),
              flylines: state.hud.flylines });
        } else if (engine) {
          engine.frame(time);
          dispatchCommandResponse(engine.take_response(), responseHandlers);
        }
      } catch (error) {
        setState({ webgpuError: error instanceof Error ? error.message : String(error) });
        return;
      }
      if(time-lastHandles>40){lastHandles=time;
        const current=getState(),ids=current.selectedIds.filter(id=>{const n=current.scene.find(n=>n.id===id);return n&&!n.locked&&n.type!=="widget"});
        if(editableRef.current&&ids.length){const center=nodeBounds(current.scene,ids).center,rect=canvas.getBoundingClientRect();
          const project=(p:number[])=>{if(software)return projectWorldPoint(camera,p as Point,rect.width,rect.height);
            const [ex,ey,ez]=toEnginePoint(p as [number,number,number],getState().viewOrigin);
            return Array.from(engine?.screen_position(ex,ey,ez)??[]);};
          const origin=project(center),axes=[0,1,2].map(i=>project(center.map((v,j)=>v+(i===j?1:0))));
          if(origin.length===2&&axes.every(a=>a.length===2))setHandles(prev=>prev&&Math.abs(prev.origin[0]-origin[0])<.2&&Math.abs(prev.origin[1]-origin[1])<.2&&prev.axes.every((a,i)=>Math.hypot(a[0]-axes[i][0],a[1]-axes[i][1])<.2)?prev:{origin,axes});else setHandles(null);
        }else setHandles(null);
      }
      raf = requestAnimationFrame(render);
    };
    void (async () => {
      try {
        const healthy = await probeWebGPU();
        if (disposed) return;
        registeredModels.current.clear();
        if (healthy) {
          lease = acquireEngine(canvas);
          const ready = await lease.ready;
          if (disposed) return;
          engine = ready;
          engine.set_mode(encodeSetMode(mode));
          engine.set_spin(mode === "login");
          engine.set_hud(encodeSetHud(getState().hud));
          engine.sync_scene(encodeSceneUpdate(toEngineFlat(runtimeFlat(getState()), getState().viewOrigin)));
          engine.set_selection(getState().selectedId);
          // 引擎异步就绪期间前端可能已平滑飞行/切换视角,把期望位姿补放给引擎相机
          const [ix, iy, iz] = toEnginePoint(camera.target, getState().viewOrigin);
          engine.camera_view(ix, iy, iz, camera.yaw, camera.pitch, camera.dist);
          engineRef.current = engine;
        } else {
          const rect = fallbackCanvas.getBoundingClientRect();
          const surface = await createSceneSurface(fallbackCanvas, rect.width || 1, rect.height || 1);
          if (disposed) { surface.dispose(); return; }
          software = surface;
          softwareRef.current = surface;
          surface.setStatsListener((stats) => { if (!disposed) setState({ stats }); });
          setState({ stats: { ...getState().stats, backend: "CPU" } });
        }
        resize();
        if (mode === "editor") unregisterCapture = registerSceneCapture(async (size) => {
          if (captureInProgress) throw new Error("正在生成截图，请稍后重试");
          if (disposed || (!engine && !software)) throw new Error("三维场景尚未就绪");
          if (runtimeFlat(getState()).some((item) => item.modelId && !registeredModels.current.has(item.modelId))) {
            throw new Error("请等待场景模型加载完成后再导出");
          }
          const activeEngine = engine;
          captureInProgress = true;
          try {
            let raw: HTMLCanvasElement;
            if (activeEngine) {
              if (size) activeEngine.set_capture_size(size.width, size.height);
              const state = getState();
              const visible = runtimeFlat(state);
              activeEngine.sync_scene(encodeSceneUpdate(toEngineFlat(visible, state.viewOrigin)));
              activeEngine.set_hud(encodeSetHud(state.hud));
              const rgba = (hex: string, alpha = 1) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).concat(alpha);
              const settings = state.settings;
              activeEngine.set_environment(encodeSetEnvironment({ background: rgba(settings.background), ground: rgba(settings.groundColor, settings.ground ? 1 : 0),
                daylight: .18 + .82 * Math.max(0, Math.sin((settings.time - 6) / 12 * Math.PI)), fogDistance: settings.fog ? settings.fogDistance : 10000 }));
              const light = resolveRuntimeScene(state.scene, state.liveData, state.runtime).find((node) => node.type === "light" && node.visible);
              const point = light?.transform.position ?? { x: .45, y: .85, z: .35 }, color = light?.color ?? "#FFFFFF";
              activeEngine.set_lighting(point.x, point.y, point.z, ...[1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255) as [number, number, number], light?.lightIntensity ?? 1);
              activeEngine.set_selection(null);
              activeEngine.set_selections(encodeSetSelections([]));
              activeEngine.set_preview(true);
              const started = performance.now();
              let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
              while (!bytes.length) {
                if (disposed || engine !== activeEngine) throw new Error("编辑器已关闭，截图已取消");
                if (performance.now() - started > 10_000) throw new Error("GPU 截图超时，请重试");
                activeEngine.frame(performance.now());
                const error = activeEngine.take_preview_error();
                if (error) throw new Error(error);
                bytes = activeEngine.take_preview_frame();
                if (!bytes.length) await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
              }
              const frame = decodePreviewFrame(bytes);
              raw = document.createElement("canvas");
              raw.width = frame.width; raw.height = frame.height;
              const rawContext = raw.getContext("2d", { willReadFrequently: true });
              if (!rawContext) throw new Error("当前浏览器无法创建截图画布");
              const image = rawContext.createImageData(frame.width, frame.height);
              image.data.set(frame.pixels); rawContext.putImageData(image, 0, 0);
            } else {
              const activeSoftware = software!;
              const state = getState();
              syncCameraOrigin(state.viewOrigin);
              const surfaceSize = activeSoftware.getSize();
              raw = await activeSoftware.renderSnapshot(size?.width ?? surfaceSize.width, size?.height ?? surfaceSize.height,
                runtimeFlat(state), camera,
                { grid: state.hud.grid, selectedId: null, selectedIds: [], background: state.settings.background,
                  daylight: .18 + .82 * Math.max(0, Math.sin((state.settings.time - 6) / 12 * Math.PI)),
                  flylines: state.hud.flylines });
            }
            // CSS filters apply to the displayed canvas; bake the same adjustment into the file.
            const output = document.createElement("canvas"); output.width = raw.width; output.height = raw.height;
            const context = output.getContext("2d", { willReadFrequently: true });
            if (!context) throw new Error("当前浏览器无法创建截图画布");
            const current = getState().settings;
            context.filter = `brightness(${current.exposure}) contrast(${current.contrast}) saturate(${current.saturation})`;
            context.drawImage(raw, 0, 0);
            return output;
          } finally {
            if (!disposed && activeEngine && engine === activeEngine) {
              activeEngine.set_preview(false);
              if (size) activeEngine.set_capture_size(0, 0);
              const state = getState();
              activeEngine.set_selection(state.selectedId);
              activeEngine.set_selections(encodeSetSelections([...descendants(state.scene, state.selectedIds)]));
            }
            captureInProgress = false;
            if (!disposed) resize();
          }
        });
        setState({ engineReady: true });
        raf = requestAnimationFrame(render);
      } catch (error) {
        if (!disposed) setState({ webgpuError: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => {
      disposed = true;
      unregisterCapture();
      picks.clear();
      pointerMoves.clear();
      window.removeEventListener("dw:camera",view);window.removeEventListener("dw:save-view",saveView);
      cancelAnimationFrame(raf);
      observer.disconnect();
      if (engineRef.current === engine) engineRef.current = null;
      if (softwareRef.current === software) softwareRef.current = null;
      lease?.release();
      software?.dispose();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("contextmenu", contextMenu);
      canvas.removeEventListener("dblclick", doubleClick);
      window.removeEventListener("dw:reset-camera", reset);
      planePointRef.current = () => null;
    };
  }, [mode]);

  return (
    <div className="viewport relative h-full w-full overflow-hidden" data-backend={stats.backend}
      onDragOver={(event) => {
        if (editableRef.current && event.dataTransfer.types.includes("application/x-data-wind-model")) {
          event.preventDefault(); event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        const id = event.dataTransfer.getData("application/x-data-wind-model");
        const asset = modelAssetById.get(id);
        if (!editableRef.current || (!asset && id !== "@basic-box")) return;
        event.preventDefault();
        const node: Partial<SceneNode> & { type: "model" } = asset ? modelNode(asset) : {
          type: "model", name: "立方体", color: "#93A5E8",
        };
        const rect = canvasRef.current?.getBoundingClientRect();
        const point = rect ? planePointRef.current(event.clientX - rect.left, event.clientY - rect.top, 0) : null;
        if (point) {
          const transform = node.transform ?? {
            position: { x: 0, y: 2, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
          };
          node.transform = { ...transform, position: { ...transform.position, x: point[0], z: point[2] } };
        }
        getSceneBridge().post({ type: "add", node });
      }}>
      <canvas ref={canvasRef} data-testid="scene-canvas" aria-label="三维场景画布"
        style={{filter:`brightness(${settings.exposure}) contrast(${settings.contrast}) saturate(${settings.saturation})`}} className="block h-full w-full touch-none select-none" />
      <canvas ref={fallbackRef} aria-hidden="true"
        style={{filter:`brightness(${settings.exposure}) contrast(${settings.contrast}) saturate(${settings.saturation})`}} className="pointer-events-none absolute inset-0 block h-full w-full" />
      {editable && <TransformHandles projection={handles}/>}
      {!engineReady && !webgpuError && <div className="viewport-loading">正在加载三维场景…</div>}
      {stats.backend === "CPU" && <div className="viewport-fallback">当前浏览器未启用 GPU · CPU 兼容渲染</div>}
      {modelLoading && <div className="viewport-model-status">正在加载场景模型…</div>}
      {modelError && <div className="viewport-model-status" role="alert">{modelError} <button onClick={() => setRetryModels((value) => value + 1)}>重试</button></div>}
      {webgpuError && <div className="viewport-error" role="alert">
        <strong>三维场景加载失败</strong><p>{webgpuError}</p>
        <button onClick={() => window.location.reload()}>重新加载</button>
      </div>}
    </div>
  );
}
