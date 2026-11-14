import { useRef, useState } from "react";
import { Button, Collapse, InputNumber, Select, Switch, Toast } from "@douyinfe/semi-ui";
import { defaultTerrain, importHeightmap, terrainPresets, type TerrainConfig, type TerrainPreset } from "../data/terrain";
import type { SceneNode } from "../types";
import { getSceneBridge } from "../workers/bridge";
import { getState } from "../state/store";
import { ColorField, Field } from "./PropertyFields";

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
    <Collapse.Panel header="地形" itemKey="terrain"><section className="property-section">
      <Field label="地形预设"><Select size="small" aria-label="地形预设" value={config.preset} disabled={node.locked || busy}
        optionList={terrainPresets.map((item) => ({ value: item.id, label: item.name }))}
        onChange={(value) => patch({ preset: value as TerrainPreset, heightmap: undefined, snowLine: value === "snow" ? .62 : 1.1 })} /></Field>
      {([['宽度', 'x'], ['深度', 'z'], ['起伏高度', 'y']] as const).map(([label, axis]) => <Field key={axis} label={label}>
        <InputNumber size="small" aria-label={label} min={.1} max={100_000} step={axis === "y" ? 1 : 16}
          value={node.boxSize?.[axis]} disabled={node.locked} suffix="m"
          onChange={(value) => typeof value === "number" && post({ type: "setAxis", id: node.id, property: "boxSize", axis, value })} />
      </Field>)}
      <Field label="随机种子"><InputNumber size="small" aria-label="随机种子" min={0} max={1_000_000} step={1}
        value={config.seed} disabled={node.locked || !!config.heightmap}
        onChange={(value) => typeof value === "number" && patch({ seed: Math.round(value) })} /></Field>
      <Field label="高度图"><Button size="small" disabled={node.locked || busy} loading={busy} onClick={() => input.current?.click()}>导入高度图</Button></Field>
      <p className="properties-note">{config.heightmap ? `${config.heightmap.name} · ${config.heightmap.resolution} × ${config.heightmap.resolution}` : "支持 PNG / JPEG / WebP；黑色为低处，白色为高处。"}</p>
      {config.heightmap && <Button size="small" block disabled={node.locked || busy} onClick={() => patch({ heightmap: undefined })}>恢复预设地形</Button>}
      <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择高度图"
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
    </section></Collapse.Panel>
    <Collapse.Panel header="地表材质" itemKey="terrain-material"><section className="property-section">
      <ColorField label="岩石颜色" value={config.rockColor} disabled={node.locked} onChange={(rockColor) => patch({ rockColor })} />
      <Field label="纹理重复"><InputNumber size="small" aria-label="纹理重复" min={1} max={128} value={config.detailScale} disabled={node.locked}
        onChange={(value) => typeof value === "number" && patch({ detailScale: value })} /></Field>
      <Field label="山顶积雪"><Switch size="small" aria-label="山顶积雪" checked={config.snowLine <= 1} disabled={node.locked}
        onChange={(enabled) => patch({ snowLine: enabled ? .62 : 1.1 })} /></Field>
      {config.snowLine <= 1 && <>
        <Field label="雪线比例"><InputNumber size="small" aria-label="雪线比例" min={0} max={1} step={.05} value={config.snowLine} disabled={node.locked}
          onChange={(value) => typeof value === "number" && patch({ snowLine: value })} /></Field>
        <ColorField label="积雪颜色" value={config.snowColor} disabled={node.locked} onChange={(snowColor) => patch({ snowColor })} />
      </>}
    </section></Collapse.Panel>
    <Collapse.Panel header="地形精度" itemKey="terrain-lod"><section className="property-section">
      <Field label="地形碰撞"><Switch size="small" aria-label="地形碰撞" checked={config.collision} disabled={node.locked}
        onChange={(collision) => patch({ collision })} /></Field>
      <p className="properties-note">开启后，在相机关注点附近生成地形碰撞块，供物理对象使用。</p>
      <Field label="细节层级"><Select size="small" aria-label="细节层级" value={config.levels} disabled={node.locked}
        optionList={[3, 4, 5, 6, 7, 8].map((value) => ({ value, label: `${value} 级${value === 6 ? '（推荐）' : ''}` }))}
        onChange={(value) => patch({ levels: Number(value) })} /></Field>
      <p className="properties-note">提高层级可增加近处细节，远处自动降低精度。</p>
    </section></Collapse.Panel>
  </>;
}
