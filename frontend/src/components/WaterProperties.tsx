import { useState } from "react";
import { Button, Collapse, InputNumber, Select, Switch, Toast } from "@douyinfe/semi-ui";
import { defaultWater, MAX_SHALLOW_WATERS, validateWater, waterNode, waterPresets,
  type WaterConfig, type WaterPoint, type WaterPreset } from "../data/water";
import type { SceneNode } from "../types";
import { getSceneBridge } from "../workers/bridge";
import { getState } from "../state/store";
import { ColorField, Field } from "./PropertyFields";

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
    <Field label={label}><InputNumber size="small" aria-label={label} value={c[key] as number}
      min={min} max={max} step={step} suffix={suffix} disabled={node.locked}
      onChange={(v) => typeof v === "number" && patch({ [key]: v })} /></Field>;
  const size = node.boxSize ?? { x: 80, y: 2, z: 60 };
  const pathIndex = Math.min(selected, c.points.length - 1);
  const updatePoint = (index: number, point: WaterPoint) => patch({ points: c.points.map((p, i) => i === index ? point : p) });
  return <>
    <Collapse.Panel header="水体" itemKey="water"><section className="property-section">
      <Field label="水体类型"><Select size="small" aria-label="水体类型" value={c.preset} disabled={node.locked}
        optionList={waterPresets.map((p) => ({ value: p.id, label: p.name }))}
        onChange={(value) => {
          if (value === "shallow" && c.preset !== "shallow"
            && getState().scene.filter((n) => n.water?.preset === "shallow").length >= MAX_SHALLOW_WATERS) {
            Toast.info(`最多支持 ${MAX_SHALLOW_WATERS} 个浅水模拟`); return;
          }
          patch(waterNode(value as WaterPreset).water!);
        }} /></Field>
      {([['宽度', 'x'], ['深度', 'z']] as const).map(([label, axis]) => <Field key={axis} label={label}>
        <InputNumber size="small" aria-label={`水体${label}`} min={.1} max={100_000} step={1}
          value={size[axis]} disabled={node.locked} suffix="m"
          onChange={(value) => typeof value === "number" && post({ type: "setAxis", id: node.id, property: "boxSize", axis, value })} />
      </Field>)}
      <Field label="水位"><InputNumber size="small" aria-label="水位" value={node.transform.position.y} step={.1}
        disabled={node.locked} suffix="m" onChange={(value) => typeof value === "number" && post({ type: "setAxis", id: node.id, property: "position", axis: "y", value })} /></Field>
      {numeric("波浪高度", "waveHeight", 0, 5, .01, "m")}
      {numeric("波长", "waveLength", 1, 200, 1, "m")}
      {numeric(c.preset === "river" ? "流动速度" : "波浪速度", "waveSpeed", 0, 10, .1)}
      {c.preset !== "river" && numeric("风向", "direction", -180, 180, 5, "°")}
    </section></Collapse.Panel>
    <Collapse.Panel header="水面材质" itemKey="water-material"><section className="property-section">
      <ColorField label="折射颜色" value={c.refractionColor} disabled={node.locked} onChange={(refractionColor) => patch({ refractionColor })} />
      <ColorField label="散射颜色" value={c.scatteringColor} disabled={node.locked} onChange={(scatteringColor) => patch({ scatteringColor })} />
      {numeric("最大透明深度", "transparencyDepth", .1, 100, .1, "m")}
      {numeric("不透明度", "opacity", 0, 1, .05)}
      {numeric("粗糙度", "roughness", .02, 1, .02)}
      {numeric("泡沫强度", "foam", 0, 1, .05)}
    </section></Collapse.Panel>
    {c.preset === "river" && <Collapse.Panel header="河道路径" itemKey="water-path"><section className="property-section">
      <Field label="河道宽度"><InputNumber size="small" aria-label="河道宽度" min={.01 * Math.min(size.x, size.z)}
        max={.8 * Math.min(size.x, size.z)} step={.1} value={c.riverWidth * Math.min(size.x, size.z)}
        disabled={node.locked} suffix="m" onChange={(v) => typeof v === "number" && patch({ riverWidth: v / Math.min(size.x, size.z) })} /></Field>
      <PointMap points={c.points} selected={pathIndex} disabled={node.locked} onSelect={setSelected} onMove={updatePoint} />
      <Field label="控制点"><Select size="small" aria-label="河道控制点" value={pathIndex}
        optionList={c.points.map((_, i) => ({ label: `控制点 ${i + 1}`, value: i }))} onChange={(v) => setSelected(Number(v))} /></Field>
      {(["x", "z"] as const).map((axis) => <Field key={axis} label={`局部 ${axis.toUpperCase()}`}>
        <InputNumber size="small" aria-label={`河道控制点 ${axis.toUpperCase()}`} min={-size[axis] / 2} max={size[axis] / 2}
          step={.1} value={c.points[pathIndex][axis] * size[axis]} disabled={node.locked} suffix="m"
          onChange={(v) => typeof v === "number" && updatePoint(pathIndex, { ...c.points[pathIndex], [axis]: v / size[axis] })} />
      </Field>)}
      <div className="batch-actions"><Button size="small" disabled={node.locked || c.points.length >= 32} onClick={() => {
        const index = Math.min(pathIndex, c.points.length - 2), a = c.points[index], b = c.points[index + 1];
        patch({ points: [...c.points.slice(0, index + 1), { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, ...c.points.slice(index + 1)] }); setSelected(index + 1);
      }}>插入控制点</Button><Button size="small" disabled={node.locked || c.points.length <= 2}
        onClick={() => { patch({ points: c.points.filter((_, i) => i !== pathIndex) }); setSelected(Math.max(0, pathIndex - 1)); }}>删除控制点</Button></div>
      <p className="properties-note">拖动平面图中的点调整河道，水流沿控制点顺序前进。</p>
    </section></Collapse.Panel>}
    {c.preset === "shallow" && <Collapse.Panel header="浅水模拟" itemKey="water-simulation"><section className="property-section">
      <Field label="运行模拟"><Switch size="small" aria-label="运行模拟" checked={c.running} disabled={node.locked} onChange={(running) => patch({ running })} /></Field>
      {numeric("初始水深", "initialDepth", 0, 5, .05, "m")}
      <Button size="small" block disabled={node.locked} onClick={() => patch({ resetVersion: (c.resetVersion + 1) % 1_000_001 })}>重置模拟</Button>
      {c.sources.length > 0 && <PointMap points={c.sources} selected={Math.min(selected, c.sources.length - 1)} disabled={node.locked}
        onSelect={setSelected} onMove={(index, point) => patch({ sources: c.sources.map((s, i) => i === index ? { ...s, ...point } : s) })} />}
      {c.sources.map((source, index) => <div key={index} style={{ borderTop: "1px solid var(--semi-color-border)", paddingTop: 8, marginTop: 8 }}>
        <Field label={`出水点 ${index + 1}`}><Button size="small" theme="borderless" disabled={node.locked}
          aria-label={`删除出水点 ${index + 1}`} onClick={() => patch({ sources: c.sources.filter((_, i) => i !== index) })}>删除</Button></Field>
        {(["x", "z"] as const).map((axis) => <Field key={axis} label={`局部 ${axis.toUpperCase()}`}><InputNumber size="small"
          aria-label={`出水点 ${index + 1} ${axis.toUpperCase()}`} min={-size[axis] / 2} max={size[axis] / 2} step={.1}
          value={source[axis] * size[axis]} disabled={node.locked} suffix="m" onChange={(v) => typeof v === "number" && patch({ sources: c.sources.map((s, i) => i === index ? { ...s, [axis]: v / size[axis] } : s) })} /></Field>)}
        <Field label="流量"><InputNumber size="small" aria-label={`出水点 ${index + 1} 流量`} min={-20} max={20} step={.1}
          value={source.rate} disabled={node.locked} suffix="m³/s" onChange={(v) => typeof v === "number" && patch({ sources: c.sources.map((s, i) => i === index ? { ...s, rate: v } : s) })} /></Field>
        <Field label="半径"><InputNumber size="small" aria-label={`出水点 ${index + 1} 半径`} min={.02 * Math.min(size.x, size.z)} max={.25 * Math.min(size.x, size.z)}
          step={.1} value={source.radius * Math.min(size.x, size.z)} disabled={node.locked} suffix="m"
          onChange={(v) => typeof v === "number" && patch({ sources: c.sources.map((s, i) => i === index ? { ...s, radius: v / Math.min(size.x, size.z) } : s) })} /></Field>
      </div>)}
      <Button size="small" block disabled={node.locked || c.sources.length >= 8} onClick={() => patch({ sources: [...c.sources, { x: .2, z: .2, rate: 1, radius: .06 }] })}>添加出水点</Button>
      <p className="properties-note">正流量注水，负流量排水。地形变化后自动更新河床并重置；模拟状态不随项目保存，参数会保存。</p>
    </section></Collapse.Panel>}
  </>;
}

function PointMap({ points, selected, disabled, onSelect, onMove }: {
  points: WaterPoint[]; selected: number; disabled: boolean;
  onSelect: (i: number) => void; onMove: (i: number, p: WaterPoint) => void;
}) {
  const [drag, setDrag] = useState<{ index: number; point: WaterPoint } | null>(null);
  const shown = points.map((p, i) => drag?.index === i ? drag.point : p);
  return <svg viewBox="0 0 200 160" role="group" aria-label="水体控制点平面图"
    style={{ width: "100%", background: "var(--semi-color-fill-0)", borderRadius: 6, touchAction: "none" }}
    onPointerMove={(event) => {
      if (!drag) return;
      const rect = event.currentTarget.getBoundingClientRect();
      setDrag({ index: drag.index, point: { x: Math.max(-.5, Math.min(.5, ((event.clientX - rect.left) / rect.width * 200 - 20) / 160 - .5)),
        z: Math.max(-.5, Math.min(.5, ((event.clientY - rect.top) / rect.height * 160 - 16) / 128 - .5)) } });
    }} onPointerUp={() => { if (drag) onMove(drag.index, drag.point); setDrag(null); }} onPointerCancel={() => setDrag(null)}>
    <path d="M20 16H180V144H20ZM100 16V144M20 80H180" fill="none" stroke="var(--semi-color-border)" />
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
