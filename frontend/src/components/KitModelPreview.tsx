import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ReferenceKitPiece } from "../data/kitRuntime";
import { applyKitSceneMaterials, kitSceneGeometry, loadKitSceneTextures, loadPreviewGeometry, previewModelUrl, previewSceneFrame,
  type KitSceneGeometry } from "../engine/kitScenePreview";
import { SoftwareRenderer, type SoftCamera } from "../engine/softwareRenderer";

type PreviewMesh = Awaited<ReturnType<typeof loadPreviewGeometry>>;

function ModelCanvas({ scene, label, selected, onSelect }: {
  scene: KitSceneGeometry; label: string; selected?: string; onSelect?: (id: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState<{
    renderer: SoftwareRenderer; models: Map<string, PreviewMesh>; textures: Map<string, number>; failures: string[];
  }>();
  const [cameraIndex, setCameraIndex] = useState(0);
  const [error, setError] = useState("");
  const controls = useRef<{ index: number; camera: SoftCamera } | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const frameRequest = useRef(0);
  const { assetKey: assets, textureKey } = scene;
  useEffect(() => {
    const controller = new AbortController();
    let renderer: SoftwareRenderer | undefined;
    const setup = async () => {
      const urls = JSON.parse(assets) as string[];
      const models = new Map<string, PreviewMesh>();
      const failures: string[] = [];
      for (const url of urls) {
        try { models.set(url, await loadPreviewGeometry(url, controller.signal)); }
        catch (error) {
          if (controller.signal.aborted) return;
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }
      if (controller.signal.aborted || !canvas.current) return;
      renderer = await SoftwareRenderer.create(canvas.current);
      if (controller.signal.aborted) { renderer.dispose(); renderer = undefined; return; }
      renderer.resize(720, 405);
      for (const [id, model] of models) renderer.registerModelAsset(id, model.bytes);
      const textures = await loadKitSceneTextures(renderer, textureKey, controller.signal);
      if (!controller.signal.aborted) setLoaded({ renderer, models, textures, failures });
    };
    void setup().catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      controller.abort();
      cancelAnimationFrame(frameRequest.current);
      renderer?.dispose();
    };
  }, [assets, textureKey]);

  const frame = useMemo(() => loaded ? previewSceneFrame(scene, loaded.models) : undefined, [scene, loaded]);
  const camera = frame?.cameras[cameraIndex]?.pose ?? frame?.cameras[0]?.pose;
  const draw = () => {
    if (!loaded || !frame?.instances.length || !camera) return;
    const pose = controls.current?.index === cameraIndex ? controls.current.camera : camera;
    loaded.renderer.render(frame.instances, pose, {
      grid: false, selectedId: selected ?? null, time: 0, background: scene.background, daylight: scene.daylight,
    });
  };
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const redraw = () => {
    cancelAnimationFrame(frameRequest.current);
    frameRequest.current = requestAnimationFrame(() => drawRef.current());
  };
  useEffect(() => {
    if (loaded) applyKitSceneMaterials(loaded.renderer, scene, loaded.textures, loaded.models);
    controls.current = null;
    redraw();
  }, [loaded, frame, cameraIndex, selected, scene]);
  const adjust = (change: (pose: SoftCamera) => SoftCamera) => {
    if (!camera) return;
    const pose = controls.current?.index === cameraIndex ? controls.current.camera : camera;
    controls.current = { index: cameraIndex, camera: change(pose) };
    redraw();
  };
  useEffect(() => {
    const element = canvas.current;
    const wheel = (event: WheelEvent) => {
      if (!camera) return;
      event.preventDefault();
      adjust(pose => ({ ...pose, dist: Math.min(125, Math.max(.1, pose.dist * Math.exp(event.deltaY * .001))) }));
    };
    element?.addEventListener("wheel", wheel, { passive: false });
    return () => element?.removeEventListener("wheel", wheel);
  }, [frame, cameraIndex]);

  const triangles = frame?.instances.reduce((sum, item) => sum + (loaded?.models.get(item.modelId!)?.triangles ?? 0), 0);
  const missingTextures = loaded ? (JSON.parse(textureKey) as string[]).length - loaded.textures.size : 0;
  const status = error || (loaded ? triangles
    ? `${frame?.instances.length} 个模型 · ${triangles.toLocaleString("zh-CN")} 个三角面` : "场景中没有可预览的模型"
    : "正在读取模型…");
  return <div className="kit-model-preview">
    {onSelect && <div className="kit-model-preview-toolbar">
      <Select aria-label="预览视角" value={String(cameraIndex)} disabled={!frame?.instances.length}
        onValueChange={value => typeof value === "string" && setCameraIndex(Number(value))}>
        <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent>{frame?.cameras.map((item, index) =>
          <SelectItem key={index} value={String(index)}>{item.name}</SelectItem>)}</SelectContent>
      </Select>
      <Button variant="outline" size="sm" onClick={() => { controls.current = null; redraw(); }}>重置视角</Button>
    </div>}
    <canvas ref={canvas} aria-label={`${label}几何预览`} onPointerDown={event => {
      if (event.button !== 0 || !frame?.instances.length) return;
      drag.current = { x: event.clientX, y: event.clientY, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => {
      const pointer = drag.current;
      if (!pointer) return;
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
      if (!pointer.moved && Math.hypot(dx, dy) < 3) return;
      drag.current = { x: event.clientX, y: event.clientY, moved: true };
      adjust(pose => ({ ...pose, yaw: pose.yaw - dx * .006,
        pitch: Math.max(-1.55, Math.min(1.55, pose.pitch + dy * .006)) }));
    }} onPointerUp={event => {
      const pointer = drag.current;
      drag.current = null;
      if (pointer && !pointer.moved && loaded && onSelect) {
        const rect = event.currentTarget.getBoundingClientRect();
        const point = loaded.renderer.pick((event.clientX - rect.left) / rect.width * loaded.renderer.size.width,
          (event.clientY - rect.top) / rect.height * loaded.renderer.size.height);
        if (point) onSelect(point);
      }
    }} onPointerCancel={() => { drag.current = null; }}/>
    <output role="status">{status}</output>
    {scene.otherModels > 0 && <p className="properties-note">{scene.otherModels} 个模型使用当前预览未识别的文件格式。</p>}
    {missingTextures > 0 && <p className="properties-note">{missingTextures} 张独立贴图无法读取，预览使用模型自带材质。</p>}
    {loaded?.failures.length ? <p className="properties-note">
      {frame?.instances.length ? `${loaded.failures.length} 个模型读取失败。` : loaded.failures[0]}
    </p> : null}
  </div>;
}

export default function KitModelPreview({ source, label, pieces }: {
  source: unknown; label: string; pieces?: ReferenceKitPiece[];
}) {
  const [open, setOpen] = useState(false);
  const url = previewModelUrl(source);
  const scene = useMemo(() => kitSceneGeometry([{ type: "gltf", name: label, options: { model: source }, pieces }]),
    [source, label, pieces]);
  if (!url) return null;
  return <>
    <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>预览模型几何</Button>
    {open && <Dialog open onOpenChange={(next) => { if (!next) setOpen(false); }}>
      <DialogContent className="max-w-[760px]">
        <DialogHeader><DialogTitle>{label}</DialogTitle></DialogHeader>
        <ModelCanvas key={scene.assetKey + scene.textureKey} scene={scene} label={label}/>
      </DialogContent>
    </Dialog>}
  </>;
}

export function KitScenePreview({ pieces, selected, edit, onSelect }: {
  pieces: ReferenceKitPiece[]; selected: string; edit?: { path: string; state: string }; onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const scene = useMemo(() => kitSceneGeometry(pieces, edit), [pieces, edit?.path, edit?.state]);
  if (!scene.objects.length && !open) return null;
  return <>
    <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>预览场景几何</Button>
    {open && <Dialog open onOpenChange={(next) => { if (!next) setOpen(false); }}>
      <DialogContent className="max-w-[760px]">
        <DialogHeader><DialogTitle>三维场景几何</DialogTitle></DialogHeader>
        <ModelCanvas key={scene.assetKey + scene.textureKey} label="场景" scene={scene} selected={selected} onSelect={onSelect}/>
      </DialogContent>
    </Dialog>}
  </>;
}
