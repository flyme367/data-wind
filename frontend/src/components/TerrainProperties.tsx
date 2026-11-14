import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { NumberInput } from "@/components/ui-ext/number-input";
import { Toast } from "@/lib/toast";
import { Down } from "@icon-park/react";
import { defaultTerrain, importHeightmap, terrainPresets, type TerrainConfig, type TerrainPreset } from "../data/terrain";
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

export default function TerrainProperties({ node }: { node: SceneNode }) {
  const config = node.terrain ?? defaultTerrain;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const post = getSceneBridge().post;
  const patch = (value: Partial<TerrainConfig>) => post({ type: "patch", id: node.id, patch: { terrain: { ...config, ...value } } });
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const heightmap = await importHeightmap(file);
      const current = getState().scene.find((item) => item.id === node.id);
      if (!current || current.locked) return;
      post({ type: "patch", id: node.id, patch: { terrain: { ...(current.terrain ?? defaultTerrain), heightmap } } });
      Toast.success("高度图已应用并随项目保存");
    } catch (error) { Toast.error(error instanceof Error ? error.message : "无法读取高度图"); }
    finally { setBusy(false); }
  };
  return <>
    <Panel itemKey="terrain" header="地形"><section className="property-section">
      <Field label="地形预设"><Select aria-label="地形预设" value={config.preset} disabled={node.locked || busy}
        onValueChange={(value) => typeof value === "string" && patch({ preset: value as TerrainPreset, heightmap: undefined, snowLine: value === "snow" ? .62 : 1.1 })}>
        <SelectTrigger size="sm" className="w-full" aria-label="地形预设"><SelectValue /></SelectTrigger>
        <SelectContent>{terrainPresets.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
      </Select></Field>
      {([['宽度', 'x'], ['深度', 'z'], ['起伏高度', 'y']] as const).map(([label, axis]) => <Field key={axis} label={label}>
        <NumberInput size="small" aria-label={label} min={.1} max={100_000} step={axis === "y" ? 1 : 16}
          value={node.boxSize?.[axis]} disabled={node.locked} suffix="m"
          onChange={(value) => typeof value === "number" && post({ type: "setAxis", id: node.id, property: "boxSize", axis, value })} />
      </Field>)}
      <Field label="随机种子"><NumberInput size="small" aria-label="随机种子" min={0} max={1_000_000} step={1}
        value={config.seed} disabled={node.locked || !!config.heightmap}
        onChange={(value) => typeof value === "number" && patch({ seed: Math.round(value) })} /></Field>
      <Field label="高度图"><Button variant="outline" size="sm" disabled={node.locked || busy} onClick={() => input.current?.click()}>
        {busy && <Spinner data-icon="inline-start" />}导入高度图</Button></Field>
      <p className="properties-note">{config.heightmap ? `${config.heightmap.name} · ${config.heightmap.resolution} × ${config.heightmap.resolution}` : "支持 PNG / JPEG / WebP；黑色为低处，白色为高处。"}</p>
      {config.heightmap && <Button variant="outline" size="sm" className="w-full" disabled={node.locked || busy} onClick={() => patch({ heightmap: undefined })}>恢复预设地形</Button>}
      <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择高度图"
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
    </section></Panel>
    <Panel itemKey="terrain-material" header="地表材质"><section className="property-section">
      <ColorField label="岩石颜色" value={config.rockColor} disabled={node.locked} onChange={(rockColor) => patch({ rockColor })} />
      <Field label="纹理重复"><NumberInput size="small" aria-label="纹理重复" min={1} max={128} value={config.detailScale} disabled={node.locked}
        onChange={(value) => typeof value === "number" && patch({ detailScale: value })} /></Field>
      <Field label="山顶积雪"><Switch size="sm" aria-label="山顶积雪" checked={config.snowLine <= 1} disabled={node.locked}
        onCheckedChange={(enabled) => patch({ snowLine: enabled ? .62 : 1.1 })} /></Field>
      {config.snowLine <= 1 && <>
        <Field label="雪线比例"><NumberInput size="small" aria-label="雪线比例" min={0} max={1} step={.05} value={config.snowLine} disabled={node.locked}
          onChange={(value) => typeof value === "number" && patch({ snowLine: value })} /></Field>
        <ColorField label="积雪颜色" value={config.snowColor} disabled={node.locked} onChange={(snowColor) => patch({ snowColor })} />
      </>}
    </section></Panel>
    <Panel itemKey="terrain-lod" header="地形精度"><section className="property-section">
      <Field label="地形碰撞"><Switch size="sm" aria-label="地形碰撞" checked={config.collision} disabled={node.locked}
        onCheckedChange={(collision) => patch({ collision })} /></Field>
      <p className="properties-note">开启后，在相机关注点附近生成地形碰撞块，供物理对象使用。</p>
      <Field label="细节层级"><Select aria-label="细节层级" value={String(config.levels)} disabled={node.locked}
        onValueChange={(value) => typeof value === "string" && patch({ levels: Number(value) })}>
        <SelectTrigger size="sm" className="w-full" aria-label="细节层级"><SelectValue /></SelectTrigger>
        <SelectContent>{[3, 4, 5, 6, 7, 8].map((value) =>
          <SelectItem key={value} value={String(value)}>{`${value} 级${value === 6 ? '（推荐）' : ''}`}</SelectItem>)}</SelectContent>
      </Select></Field>
      <p className="properties-note">提高层级可增加近处细节，远处自动降低精度。</p>
    </section></Panel>
  </>;
}
