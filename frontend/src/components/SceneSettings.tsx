import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { NumberInput } from "@/components/ui-ext/number-input";
import { Down } from "@icon-park/react";
import { defaultEditorSettings, type EditorSettings } from "../data/editor";
import { useStore } from "../state/store";
import { getSceneBridge } from "../workers/bridge";
import { ColorField, Field } from "./PropertyFields";

/** 属性面板折叠分区：受控 Collapsible，展开态由 openKeys 的 Set 集中管理（替代 Semi Collapse.Panel）。 */
function Panel({ itemKey, header, open, onOpenChange, children }: {
  itemKey: string; header: string; open: boolean; onOpenChange: (open: boolean) => void; children?: ReactNode;
}) {
  return <Collapsible open={open} onOpenChange={onOpenChange} data-panel={itemKey}>
    <CollapsibleTrigger className="properties-collapse-header" aria-label={header}>
      <span className="flex-1 text-left">{header}</span>
      <Down theme="outline" size={12} className="shrink-0 transition-transform" style={{ transform: open ? undefined : "rotate(-90deg)" }}/>
    </CollapsibleTrigger>
    <CollapsibleContent className="properties-collapse-content">{children}</CollapsibleContent>
  </Collapsible>;
}

export default function SceneSettings(){
  const state=useStore(),s=state.settings;
  const [openKeys,setOpenKeys]=useState(()=>new Set(["basic","day"]));
  const togglePanel=(itemKey:string,next:boolean)=>setOpenKeys(keys=>{const update=new Set(keys);if(next)update.add(itemKey);else update.delete(itemKey);return update;});
  const patch=(patch:Partial<EditorSettings>)=>getSceneBridge().post({type:"configure",patch});
  return <div className="properties-collapse">
    <Panel itemKey="basic" header="基础设置" open={openKeys.has("basic")} onOpenChange={next=>togglePanel("basic",next)}><section className="property-section"><ColorField label="天空背景" value={s.background} onChange={background=>patch({background})}/><ColorField label="地面颜色" value={s.groundColor} onChange={groundColor=>patch({groundColor})}/>
      <Field label="显示地面"><Switch size="sm" aria-label="显示地面" checked={s.ground} onCheckedChange={ground=>patch({ground})}/></Field>
      <Field label="显示网格"><Switch size="sm" aria-label="显示网格" checked={state.hud.grid} onCheckedChange={grid=>window.dispatchEvent(new CustomEvent("dw:hud",{detail:{grid}}))}/></Field>
      <Field label="视角预设"><Select aria-label="视角预设" onValueChange={preset=>typeof preset==="string"&&window.dispatchEvent(new CustomEvent("dw:camera",{detail:{preset}}))}>
        <SelectTrigger size="sm" className="w-full" aria-label="视角预设"><SelectValue placeholder="切换视角"/></SelectTrigger>
        <SelectContent>{[{value:"orbit",label:"鸟瞰"},{value:"top",label:"俯视"},{value:"front",label:"前视"},{value:"right",label:"右视"}].map(item=><SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
      </Select></Field></section></Panel>
    <Panel itemKey="day" header="昼夜切换" open={openKeys.has("day")} onOpenChange={next=>togglePanel("day",next)}><section className="property-section"><div className="day-dial" style={{filter:`brightness(${.45+Math.max(0,Math.sin((s.time-6)/12*Math.PI))*.55})`}}/><div className="day-time">{String(Math.floor(s.time)).padStart(2,"0")}:{String(Math.floor(s.time%1*60)).padStart(2,"0")}</div><Slider aria-label="一天时间" min={0} max={23.99} step={.25} value={[s.time]} onValueChange={v=>patch({time:Number(Array.isArray(v)?v[0]:v)})}/><div className="day-presets"><Button variant="outline" size="sm" onClick={()=>patch({time:8})}>早晨</Button><Button variant="outline" size="sm" onClick={()=>patch({time:14})}>白天</Button><Button variant="outline" size="sm" onClick={()=>patch({time:21})}>夜间</Button></div></section></Panel>
    <Panel itemKey="render" header="渲染与后期" open={openKeys.has("render")} onOpenChange={next=>togglePanel("render",next)}><section className="property-section">{(["exposure","contrast","saturation"] as const).map((key,i)=><Field key={key} label={["曝光","对比度","饱和度"][i]}><NumberInput size="small" min={key==="saturation"?0:.1} max={3} step={.1} precision={2} aria-label={["曝光","对比度","饱和度"][i]} value={s[key]} onChange={v=>typeof v==="number"&&patch({[key]:v})}/></Field>)}<Field label="距离雾效"><Switch size="sm" aria-label="距离雾效" checked={s.fog} onCheckedChange={fog=>patch({fog})}/></Field><Field label="雾效距离"><NumberInput size="small" min={20} max={600} value={s.fogDistance} aria-label="雾效距离" onChange={v=>typeof v==="number"&&patch({fogDistance:v})}/></Field><Button variant="outline" size="sm" className="w-full" onClick={()=>patch({exposure:1,contrast:1,saturation:1,time:defaultEditorSettings.time})}>恢复默认渲染设置</Button></section></Panel>
    <Panel itemKey="views" header="预设视角" open={openKeys.has("views")} onOpenChange={next=>togglePanel("views",next)}><section className="property-section"><Button variant="outline" size="sm" className="w-full" onClick={()=>window.dispatchEvent(new Event("dw:save-view"))}>保存当前视角</Button>{s.bookmarks.map(b=><div className="saved-view" key={b.id}><Button variant="ghost" size="sm" onClick={()=>window.dispatchEvent(new CustomEvent("dw:camera",{detail:{bookmark:b}}))}>{b.name}</Button><Button variant="ghost" size="sm" aria-label={`删除${b.name}`} onClick={()=>patch({bookmarks:s.bookmarks.filter(v=>v.id!==b.id)})}>×</Button></div>)}</section></Panel>
    <Panel itemKey="stats" header="渲染统计" open={openKeys.has("stats")} onOpenChange={next=>togglePanel("stats",next)}><section className="property-section"><Field label="渲染后端"><span>{state.stats.backend}</span></Field><Field label="三角面数"><span>{state.stats.tris.toLocaleString()}</span></Field><Field label="可见对象"><span>{state.stats.visible} / {state.stats.instances}</span></Field></section></Panel>
  </div>;
}
