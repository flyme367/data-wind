import { useEffect, useState } from "react";
import { Button, Collapse, Input, TextArea, Toast } from "@douyinfe/semi-ui";
import type { SceneNode } from "../types";
import { isChartWidget } from "../data/editor";
import { useStore } from "../state/store";
import { validateScene } from "../state/projects";
import { getSceneBridge } from "../workers/bridge";
import { Field } from "./PropertyFields";
import DataSourceEditor from "./DataSourceEditor";
import BoardDataPanel from "./BoardDataPanel";
import BoardCodePanel from "./BoardCodePanel";
import InteractionEditor from "./InteractionEditor";
import KitProperties, { JsonValueEditor, KitPieceProperties } from "./KitProperties";
import { kitMetadata, kitPrivateData, kitRecord, type ReferenceKitWidget } from "../data/kitRuntime";
export default function MetadataPanel({tab,node}:{tab:string;node:SceneNode|null|undefined}) {
  const state=useStore(),[draft,setDraft]=useState(""),[error,setError]=useState("");
  useEffect(()=>{setDraft(JSON.stringify(tab==="数据"?(node?.data??{}):(node??{scene:state.scene,settings:state.settings}),null,2));setError("")},[tab,node?.id,node?.data,node?.bindings]);
  const patch=(value:Partial<SceneNode>)=>node&&getSceneBridge().post({type:"patch",id:node.id,patch:value});
  const kit = node && kitMetadata(node);
  const kitData = kit && kitPrivateData(kit.source);
  const post = getSceneBridge().post;
  if(tab==="交互")return <>
    <InteractionEditor node={node ?? null}/>
    {kit && node && <Collapse className="properties-collapse" expandIconPosition="left">
      <Collapse.Panel header="套件交互配置" itemKey="kit-interactions"><section className="property-section">
        <JsonValueEditor key={node.id} label="套件交互配置" value={kit.source.options?.interacts ?? { version: 4 }}
          disabled={node.locked} onChange={value => {
            if (!value || typeof value !== "object" || Array.isArray(value)) { Toast.error("交互配置需要 JSON 对象"); return; }
            post({ type: "patchKitOptions", id: node.id, patch: { interacts: value } });
          }}/>
      </section></Collapse.Panel>
    </Collapse>}
    {kit?.source.type === "widget.3d.city-builder" && kit.source.pieces?.length && node
      ? <KitPieceProperties key={node.id} node={node} pieces={kit.source.pieces} section="interaction"/> : null}
  </>;
  if(!node&&tab==="数据")return <BoardDataPanel/>;
  if(!node&&tab==="代码")return <BoardCodePanel/>;
  const save=()=>{try{const value=JSON.parse(draft);if(tab==="数据"){
    if(!node)throw new Error("请先选择对象");const next={...node,data:value};validateScene([next]);patch({data:value});
  }else if(node){if(value.id!==node.id||value.type!==node.type)throw new Error("对象 ID 和类型不能修改");validateScene(state.scene.map(n=>n.id===node.id?value:n));getSceneBridge().post({type:"replaceNode",node:value})}
  else throw new Error("请选择一个对象编辑其定义");setError("");Toast.success("已应用，可撤销")}catch(e){setError(e instanceof Error?e.message:"JSON 格式无效")}};
  const bindings: [string,string][] = node?.widget
    ? [["text","标题"],["value","数值"],["unit","单位"],["color","颜色"],["visible","显示"],
      ...(isChartWidget(node.widget.kind) || ["tableBasic","tableIndex","wordCloud","mapRegion","mapPoint","mapFlyline"].includes(node.widget.kind) ? [["rows","表格 / 图表数据"] as [string,string]] : []),
      ...(["table","tableBasic","tableIndex"].includes(node.widget.kind) ? [["columns","表头"] as [string,string]] : []),
      ...(["dropdown","timePicker","timeRange"].includes(node.widget.kind) ? [["options","下拉选项"] as [string,string]] : []),
      ...(["groupPanel","list","tabs","menuVertical","menuHorizontal","timeline"].includes(node.widget.kind) ? [["items","选项 / 行"] as [string,string]] : []),
      ...(node.widget.kind === "topology" ? [["nodes","拓扑节点数据"] as [string,string],["edges","拓扑连线数据"] as [string,string]] : []),
      ...(node.widget.kind === "carousel" ? [["urls","图片地址列表"] as [string,string]] : []),
      ...(["video","audio","monitor","pdf"].includes(node.widget.kind) ? [["src","媒体地址"] as [string,string]] : []),
      ...(node.widget.kind === "carouselVideo" ? [["urls","视频地址列表"] as [string,string]] : []),
      ...(node.widget.kind === "iframe" ? [["url","网页地址"] as [string,string]] : []),
      ...(node.widget.kind === "dataChange" ? [["change","变化幅度"] as [string,string]] : []),
      ...(node.widget.kind === "timeline" ? [["active","当前节点"] as [string,string]] : []),
      ...(node.widget.kind === "timer" ? [["startAt","开始时间戳"] as [string,string]] : []),
      ...(node.widget.kind === "mapFlyline" ? [["origin","飞线起点"] as [string,string]] : []),
      ...(node.widget.kind === "progress" ? [["percent","进度百分比"] as [string,string]] : [])]
    : [["x","位置 X"],["y","位置 Y"],["z","位置 Z"],["color","颜色"],["visible","显示"]];
  const bindingFields = node && <>
    <p className="properties-note">填写 JSON 字段路径，例如 rows.0.value。图表数据填写数组字段路径，例如 rows。</p>
    {bindings.map(([key, label]) => <Field key={key} label={label}>
      <Input size="small" aria-label={`绑定${label}`} placeholder="字段路径" disabled={node.locked}
        defaultValue={node.bindings?.[key] ?? ""} key={`${node.id}-${key}-${node.bindings?.[key]}`}
        onBlur={event => post({ type: "patchBindings", id: node.id, patch: { [key]: event.target.value.trim() } })}/>
    </Field>)}
  </>;
  if (tab === "数据" && kit && node) return <>
    <section className="property-section"><DataSourceEditor node={node}/></section>
    <Collapse className="properties-collapse" defaultActiveKey={kitData ? ["kit-data"] : []} expandIconPosition="left">
      {kitData && <Collapse.Panel header="组件数据" itemKey="kit-data"><section className="property-section">
        <JsonValueEditor key={node.id} label="套件组件数据" value={kitData} disabled={node.locked}
          onChange={value => {
            const data = kitRecord(value);
            if (!Array.isArray(data.fields) || !Array.isArray(data.rows)
              || !data.fields.every(field => typeof kitRecord(field).uid === "string")
              || !data.rows.every(row => row && typeof row === "object" && !Array.isArray(row))) {
              Toast.error("组件数据需要有效的 fields 和 rows 数组"); return;
            }
            if (JSON.stringify(data).length > 500_000) { Toast.error("组件数据不能超过 500 KB"); return; }
            post({ type: "patchKitData", id: node.id, data: data as NonNullable<ReferenceKitWidget["privateData"]> });
          }}/>
      </section></Collapse.Panel>}
      <Collapse.Panel header="数据绑定" itemKey="kit-bindings">
        <section className="property-section">{bindingFields}</section>
      </Collapse.Panel>
    </Collapse>
    <KitProperties key={node.id} node={node} section="data"/>
  </>;
  return <section className="property-section metadata-panel">{tab==="数据"&&node&&<DataSourceEditor node={node}/>}<h4>{tab==="数据"?"静态数据":"对象 JSON 定义"}</h4>
    {tab==="数据"&&<p className="properties-note">实时数据会覆盖同名静态字段，其余字段保留；切换为静态数据后恢复原值。</p>}
    <TextArea aria-label={tab==="数据"?"对象数据 JSON":"对象定义 JSON"} value={draft} onChange={setDraft} rows={14} spellCheck={false}/>
    {error&&<div className="field-error" role="alert">{error}</div>}<Button block theme="solid" size="small" disabled={!node||node.locked} onClick={save}>应用{tab==="数据"?"数据":"定义"}</Button>
    {tab==="数据"&&node&&<><h4>数据绑定</h4>{bindingFields}</>}
  </section>;
}
