import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { NumberInput } from "@/components/ui-ext/number-input";
import { Toast } from "@/lib/toast";
import { Down } from "@icon-park/react";
import { defaultWater, MAX_SHALLOW_WATERS, validateWater, waterNode, waterPresets,
  type WaterConfig, type WaterPoint, type WaterPreset } from "../data/water";
import type { SceneNode } from "../types";
import { getSceneBridge } from "../workers/bridge";
import { getState } from "../state/store";
import { ColorField, Field } from "./PropertyFields";

/** 属性面板折叠分区：默认展开的受控 Collapsible（替代 Semi Collapse.Panel，PropertiesPanel 装配）。 */
function Panel({ itemKey, header, children }: { itemKey: string; header: string; children?: ReactNode }) {
  const [open, setOpen] = useState(true);
  return <Collapsible open={open} onOpenChange={setOpen} data-panel={itemKey}>
    <CollapsibleTrigger className="properties-collapse-header" aria-label={header}>
      <span className="flex-1 text-left">{header}</span>
      <Down theme="outline" size={12} className="shrink-0 transition-transform" style={{ transform: open ? undefined : "rotate(-90deg)" }}/>
    </CollapsibleTrigger>
    <CollapsibleContent className="properties-collapse-content">{children}</CollapsibleContent>
  </Collapsible>;
}

export default function WaterProperties({ node }: { node: SceneNode }) {
  const c = node.water ?? defaultWater;
  const post = getSceneBridge().post;
  const [selected, setSelected] = useState(0);
  const patch = (value: Partial<WaterConfig>) => {
    const water = { ...c, ...value };
    try { validateWater(water); post({ type: "patch", id: node.id, patch: { water } }); }
    catch (error) { Toast.warning(error instanceof Error ? error.message : "水体参数无效"); }
  };
  const numeric = (label: string, key: keyof WaterConfig, min: number, max: number, step: number, suffix?: string) =>
    <Field label={label}><NumberInput size="small" aria-label={label} value={c[key] as number}
      min={min} max={max} step={step} suffix={suffix} disabled={node.locked}
      onChange={(v) => typeof v === "number" && patch({ [key]: v })} /></Field>;
  const size = node.boxSize ?? { x: 80, y: 2, z: 60 };
  const pathIndex = Math.min(selected, c.points.length - 1);
  const updatePoint = (index: number, point: WaterPoint) => patch({ points: c.points.map((p, i) => i === index ? point : p) });
  return <>
    <Panel itemKey="water" header="水体"><section className="property-section">
      <Field label="水体类型"><Select aria-label="水体类型" value={c.preset} disabled={node.locked}
        onValueChange={(value) => {
          if (typeof value !== "string") return;
          if (value === "shallow" && c.preset !== "shallow"
            && getState().scene.filter((n) => n.water?.preset === "shallow").length >= MAX_SHALLOW_WATERS) {
            Toast.info(`最多支持 ${MAX_SHALLOW_WATERS} 个浅水模拟`); return;
          }
          patch(waterNode(value as WaterPreset).water!);
        }}>
        <SelectTrigger size="sm" className="w-full" aria-label="水体类型"><SelectValue /></SelectTrigger>
        <SelectContent>{waterPresets.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
      </Select></Field>
      {([['宽度', 'x'], ['深度', 'z']] as const).map(([label, axis]) => <Field key={axis} label={label}>
        <NumberInput size="small" aria-label={`水体${label}`} min={.1} max={100_000} step={1}
          value={size[axis]} disabled={node.locked} suffix="m"
          onChange={(value) => typeof value === "number" && post({ type: "setAxis", id: node.id, property: "boxSize", axis, value })} />
      </Field>)}
      <Field label="水位"><NumberInput size="small" aria-label="水位" value={node.transform.position.y} step={.1}
        disabled={node.locked} suffix="m" onChange={(value) => typeof value === "number" && post({ type: "setAxis", id: node.id, property: "position", axis: "y", value })} /></Field>
      {numeric("波浪高度", "waveHeight", 0, 5, .01, "m")}
      {numeric("波长", "waveLength", 1, 200, 1, "m")}
      {numeric(c.preset === "river" ? "流动速度" : "波浪速度", "waveSpeed", 0, 10, .1)}
      {c.preset !== "river" && numeric("风向", "direction", -180, 180, 5, "°")}
    </section></Panel>
    <Panel itemKey="water-material" header="水面材质"><section className="property-section">
      <ColorField label="折射颜色" value={c.refractionColor} disabled={node.locked} onChange={(refractionColor) => patch({ refractionColor })} />
      <ColorField label="散射颜色" value={c.scatteringColor} disabled={node.locked} onChange={(scatteringColor) => patch({ scatteringColor })} />
      {numeric("最大透明深度", "transparencyDepth", .1, 100, .1, "m")}
      {numeric("不透明度", "opacity", 0, 1, .05)}
      {numeric("粗糙度", "roughness", .02, 1, .02)}
      {numeric("泡沫强度", "foam", 0, 1, .05)}
    </section></Panel>
    {c.preset === "river" && <Panel itemKey="water-path" header="河道路径"><section className="property-section">
      <Field label="河道宽度"><NumberInput size="small" aria-label="河道宽度" min={.01 * Math.min(size.x, size.z)}
        max={.8 * Math.min(size.x, size.z)} step={.1} value={c.riverWidth * Math.min(size.x, size.z)}
        disabled={node.locked} suffix="m" onChange={(v) => typeof v === "number" && patch({ riverWidth: v / Math.min(size.x, size.z) })} /></Field>
      <PointMap points={c.points} selected={pathIndex} disabled={node.locked} onSelect={setSelected} onMove={updatePoint} />
      <Field label="控制点"><Select aria-label="河道控制点" value={String(pathIndex)}
        onValueChange={(v) => typeof v === "string" && setSelected(Number(v))}>
        <SelectTrigger size="sm" className="w-full" aria-label="河道控制点"><SelectValue /></SelectTrigger>
        <SelectContent>{c.points.map((_, i) => <SelectItem key={i} value={String(i)}>{`控制点 ${i + 1}`}</SelectItem>)}</SelectContent>
      </Select></Field>
      {(["x", "z"] as const).map((axis) => <Field key={axis} label={`局部 ${axis.toUpperCase()}`}>
        <NumberInput size="small" aria-label={`河道控制点 ${axis.toUpperCase()}`} min={-size[axis] / 2} max={size[axis] / 2}
          step={.1} value={c.points[pathIndex][axis] * size[axis]} disabled={node.locked} suffix="m"
          onChange={(v) => typeof v === "number" && updatePoint(pathIndex, { ...c.points[pathIndex], [axis]: v / size[axis] })} />
      </Field>)}
      <div className="batch-actions"><Button variant="outline" size="sm" disabled={node.locked || c.points.length >= 32} onClick={() => {
        const index = Math.min(pathIndex, c.points.length - 2), a = c.points[index], b = c.points[index + 1];
        patch({ points: [...c.points.slice(0, index + 1), { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, ...c.points.slice(index + 1)] }); setSelected(index + 1);
      }}>插入控制点</Button><Button variant="outline" size="sm" disabled={node.locked || c.points.length <= 2}
        onClick={() => { patch({ points: c.points.filter((_, i) => i !== pathIndex) }); setSelected(Math.max(0, pathIndex - 1)); }}>删除控制点</Button></div>
      <p className="properties-note">拖动平面图中的点调整河道，水流沿控制点顺序前进。</p>
    </section></Panel>}
    {c.preset === "shallow" && <Panel itemKey="water-simulation" header="浅水模拟"><section className="property-section">
      <Field label="运行模拟"><Switch size="sm" aria-label="运行模拟" checked={c.running} disabled={node.locked} onCheckedChange={(running) => patch({ running })} /></Field>
      {numeric("初始水深", "initialDepth", 0, 5, .05, "m")}
      <Button variant="outline" size="sm" className="w-full" disabled={node.locked} onClick={() => patch({ resetVersion: (c.resetVersion + 1) % 1_000_001 })}>重置模拟</Button>
      {c.sources.length > 0 && <PointMap points={c.sources} selected={Math.min(selected, c.sources.length - 1)} disabled={node.locked}
        onSelect={setSelected} onMove={(index, point) => patch({ sources: c.sources.map((s, i) => i === index ? { ...s, ...point } : s) })} />}
      {c.sources.map((source, index) => <div key={index} className="mt-2 border-t pt-2">
        <Field label={`出水点 ${index + 1}`}><Button variant="ghost" size="sm" disabled={node.locked}
          aria-label={`删除出水点 ${index + 1}`} onClick={() => patch({ sources: c.sources.filter((_, i) => i !== index) })}>删除</Button></Field>
        {(["x", "z"] as const).map((axis) => <Field key={axis} label={`局部 ${axis.toUpperCase()}`}><NumberInput size="small"
          aria-label={`出水点 ${index + 1} ${axis.toUpperCase()}`} min={-size[axis] / 2} max={size[axis] / 2} step={.1}
          value={source[axis] * size[axis]} disabled={node.locked} suffix="m" onChange={(v) => typeof v === "number" && patch({ sources: c.sources.map((s, i) => i === index ? { ...s, [axis]: v / size[axis] } : s) })} /></Field>)}
        <Field label="流量"><NumberInput size="small" aria-label={`出水点 ${index + 1} 流量`} min={-20} max={20} step={.1}
          value={source.rate} disabled={node.locked} suffix="m³/s" onChange={(v) => typeof v === "number" && patch({ sources: c.sources.map((s, i) => i === index ? { ...s, rate: v } : s) })} /></Field>
        <Field label="半径"><NumberInput size="small" aria-label={`出水点 ${index + 1} 半径`} min={.02 * Math.min(size.x, size.z)} max={.25 * Math.min(size.x, size.z)}
          step={.1} value={source.radius * Math.min(size.x, size.z)} disabled={node.locked} suffix="m"
          onChange={(v) => typeof v === "number" && patch({ sources: c.sources.map((s, i) => i === index ? { ...s, radius: v / Math.min(size.x, size.z) } : s) })} /></Field>
      </div>)}
      <Button variant="outline" size="sm" className="w-full" disabled={node.locked || c.sources.length >= 8} onClick={() => patch({ sources: [...c.sources, { x: .2, z: .2, rate: 1, radius: .06 }] })}>添加出水点</Button>
      <p className="properties-note">正流量注水，负流量排水。地形变化后自动更新河床并重置；模拟状态不随项目保存，参数会保存。</p>
    </section></Panel>}
  </>;
}

function PointMap({ points, selected, disabled, onSelect, onMove }: {
  points: WaterPoint[]; selected: number; disabled: boolean;
  onSelect: (i: number) => void; onMove: (i: number, p: WaterPoint) => void;
}) {
  const [drag, setDrag] = useState<{ index: number; point: WaterPoint } | null>(null);
  const shown = points.map((p, i) => drag?.index === i ? drag.point : p);
  return <svg viewBox="0 0 200 160" role="group" aria-label="水体控制点平面图"
    className="w-full touch-none rounded-md bg-muted"
    onPointerMove={(event) => {
      if (!drag) return;
      const rect = event.currentTarget.getBoundingClientRect();
      setDrag({ index: drag.index, point: { x: Math.max(-.5, Math.min(.5, ((event.clientX - rect.left) / rect.width * 200 - 20) / 160 - .5)),
        z: Math.max(-.5, Math.min(.5, ((event.clientY - rect.top) / rect.height * 160 - 16) / 128 - .5)) } });
    }} onPointerUp={() => { if (drag) onMove(drag.index, drag.point); setDrag(null); }} onPointerCancel={() => setDrag(null)}>
    <path d="M20 16H180V144H20ZM100 16V144M20 80H180" fill="none" className="stroke-border" />
    <polyline points={shown.map((p) => `${20 + (p.x + .5) * 160},${16 + (p.z + .5) * 128}`).join(" ")}
      fill="none" stroke="#47bdd2" strokeWidth="6" strokeLinejoin="round" opacity=".6" />
    {shown.map((p, i) => <g key={i} onPointerDown={(event) => {
      if (disabled) return; onSelect(i); setDrag({ index: i, point: p }); event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
    }} style={{ cursor: disabled ? "default" : "grab" }}>
      <circle cx={20 + (p.x + .5) * 160} cy={16 + (p.z + .5) * 128} r="7" fill={selected === i ? "#e5faff" : "#368da7"} stroke="#70d6e8" />
      <text x={20 + (p.x + .5) * 160} y={19 + (p.z + .5) * 128} textAnchor="middle" fontSize="8" fill="#0b3546">{i + 1}</text>
    </g>)}
  </svg>;
}
