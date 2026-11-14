import { useEffect, useState } from "react";
import { Button, Collapse, Dropdown, Input, InputNumber, Layout, Modal, Select, Switch, Tag, Toast } from "@douyinfe/semi-ui";
import { Layers, Lock, Unlock, Delete } from "@icon-park/react";
import { setState, useStore } from "../state/store";
import { deleteSelection, focusSelection, selection } from "../state/sceneActions";
import { getSceneBridge } from "../workers/bridge";
import { NODE_TYPE_LABEL, type SceneNode, type Vec3 } from "../types";
import { nodeBounds, type WidgetState } from "../data/editor";
import { modelAssets, modelAssetById } from "../data/modelCatalog";
import { AxisRow, ColorField, Field } from "./PropertyFields";
import SceneSettings from "./SceneSettings";
import MetadataPanel from "./MetadataPanel";
import WidgetProperties from "./WidgetProperties";
import BoardProperties from "./BoardProperties";
import TerrainProperties from "./TerrainProperties";
import WaterProperties from "./WaterProperties";
import KitProperties from "./KitProperties";
import { kitMetadata } from "../data/kitRuntime";

/** 山海鲸「默认状态」下拉：切换样式面板编辑的状态；附加状态的样式写入状态补丁，预览时由交互「切换状态」触发。 */
function StateDropdown({ node }: { node: SceneNode }) {
  const state = useStore();
  const states = node.widget?.states ?? [];
  const activeId = state.editingStates[node.id] ?? "";
  const active = states.find((item) => item.id === activeId);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const setStates = (next: WidgetState[]) => getSceneBridge().post({ type: "widgetStates", id: node.id, states: next });
  const activate = (stateId: string) => setState({ editingStates: { ...state.editingStates, [node.id]: stateId } });
  return <>
    <Dropdown trigger="click" position="bottomRight" render={<Dropdown.Menu>
      <Dropdown.Item active={!activeId} onClick={() => activate("")}>默认状态</Dropdown.Item>
      {states.map((item) => <Dropdown.Item key={item.id} active={item.id === activeId} onClick={() => activate(item.id)}>{item.name}</Dropdown.Item>)}
      <Dropdown.Divider />
      <Dropdown.Item disabled={node.locked || states.length >= 12}
        onClick={() => { const created: WidgetState = { id: crypto.randomUUID(), name: `状态${states.length + 1}`, patch: {} }; setStates([...states, created]); activate(created.id); }}>＋ 添加状态</Dropdown.Item>
      {active && <Dropdown.Item disabled={node.locked} onClick={() => { setName(active.name); setRenaming(true); }}>重命名状态</Dropdown.Item>}
      {active && <Dropdown.Item disabled={node.locked} type="danger"
        onClick={() => { setStates(states.filter((item) => item.id !== active.id)); activate(""); }}>删除状态</Dropdown.Item>}
    </Dropdown.Menu>}>
      <Button size="small" className="state-dropdown-tag" aria-label="默认状态">{active?.name ?? "默认状态"} ▾</Button>
    </Dropdown>
    <Modal title="重命名状态" visible={renaming} onCancel={() => setRenaming(false)} okText="确定" cancelText="取消" width={320}
      onOk={() => { if (!name.trim() || !active) return; setStates(states.map((item) => item.id === active.id ? { ...item, name: name.trim() } : item)); setRenaming(false); }}>
      <Input aria-label="状态名称" value={name} onChange={setName} maxLength={30} />
    </Modal>
  </>;
}

function boardStyle(settings: ReturnType<typeof useStore>["settings"]): NonNullable<ReturnType<typeof useStore>["settings"]["boardDefaultState"]> {
  return {
    boardColor: settings.boardColor, boardFillColor: settings.boardFillColor, boardFit: settings.boardFit, boardBackgroundEnabled: settings.boardBackgroundEnabled,
    boardBackgroundMediaId: settings.boardBackgroundMediaId, boardBackgroundMediaName: settings.boardBackgroundMediaName,
    boardBackgroundFill: settings.boardBackgroundFill, boardBackgroundBlur: settings.boardBackgroundBlur,
    boardMusicEnabled: settings.boardMusicEnabled, boardMusicId: settings.boardMusicId,
    boardMusicName: settings.boardMusicName, boardMusicVolume: settings.boardMusicVolume,
  };
}

function BoardStateDropdown() {
  const state = useStore();
  const active = state.settings.boardStates.find((item) => item.id === state.settings.boardActiveStateId);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const apply = (id: string) => {
    const style = id ? state.settings.boardStates.find((item) => item.id === id)?.style : state.settings.boardDefaultState;
    if (style) getSceneBridge().post({ type: "configure", patch: { ...style, boardActiveStateId: id } });
  };
  const add = () => {
    if (state.settings.boardStates.length >= 12) { Toast.info("最多添加 12 个状态"); return; }
    const created = { id: crypto.randomUUID(), name: `状态${state.settings.boardStates.length + 1}`, style: boardStyle(state.settings) };
    getSceneBridge().post({ type: "configure", patch: { boardStates: [...state.settings.boardStates, created], boardActiveStateId: created.id } });
  };
  const remove = () => {
    if (!active) return;
    Modal.confirm({ title: "删除看板状态", content: `确定删除「${active.name}」吗？`, okText: "删除", cancelText: "取消", onOk: () => {
      const boardStates = state.settings.boardStates.filter((item) => item.id !== active.id);
      getSceneBridge().post({ type: "configure", patch: active.id === state.settings.boardActiveStateId
        ? { ...state.settings.boardDefaultState, boardStates, boardActiveStateId: "" }
        : { boardStates } });
    } });
  };
  return <>
    <Dropdown trigger="click" position="bottomRight" render={<Dropdown.Menu>
      <Dropdown.Item active={!active} onClick={() => apply("")}>默认状态</Dropdown.Item>
      {state.settings.boardStates.map((item) => <Dropdown.Item key={item.id} active={item.id === active?.id} onClick={() => apply(item.id)}>{item.name}</Dropdown.Item>)}
      <Dropdown.Divider />
      <Dropdown.Item disabled={state.settings.boardStates.length >= 12} onClick={add}>＋ 添加状态</Dropdown.Item>
      {active && <Dropdown.Item onClick={() => { setName(active.name); setRenaming(true); }}>重命名状态</Dropdown.Item>}
      {active && <Dropdown.Item type="danger" onClick={remove}>删除状态</Dropdown.Item>}
    </Dropdown.Menu>}>
      <Button size="small" className="state-dropdown-tag" aria-label="看板状态">{active?.name ?? "默认状态"} ▾</Button>
    </Dropdown>
    <Modal title="重命名状态" visible={renaming} onCancel={() => setRenaming(false)} okText="确定" cancelText="取消" width={320}
      onOk={() => { if (!active || !name.trim()) return; getSceneBridge().post({ type: "configure", patch: { boardStates: state.settings.boardStates.map((item) => item.id === active.id ? { ...item, name: name.trim() } : item) } }); setRenaming(false); }}>
      <Input aria-label="状态名称" value={name} onChange={setName} maxLength={30}/>
    </Modal>
  </>;
}

export default function PropertiesPanel({editing=true, rootNode=null}:{editing?:boolean; rootNode?: string | null}) {
  const state=useStore(),node=state.scene.find(n=>n.id===state.selectedId&&(editing||n.type==="widget"||n.type==="group")),ids=selection();
  const resource=modelAssetById.get(node?.modelId??""),[draft,setDraft]=useState(""),[tab,setTab]=useState("样式");
  const propertyTabs=["样式","交互","数据","代码"] as const;
  useEffect(()=>setDraft(node?.name??""),[node?.id,node?.name]);
  useEffect(()=>{const open=()=>setTab("数据");window.addEventListener("dw:open-data",open);return()=>window.removeEventListener("dw:open-data",open)},[]);
  useEffect(()=>{const open=()=>setTab("样式");window.addEventListener("dw:open-board-style",open);return()=>window.removeEventListener("dw:open-board-style",open)},[]);
  const post=getSceneBridge().post;
  // 山海鲸「封面设置」：封面缩略图 + 截屏（写入项目元数据，工作台卡片同步显示）
  const transform=(property:"position"|"rotation"|"scale",axis:keyof Vec3,value:number)=>node&&post({type:"setAxis",id:node.id,property,axis,value});
  const boardTitle=state.boardLayer === "background" ? "背景看板"
    : state.settings.boardPages.find((page)=>page.id===state.settings.boardActivePageId)?.name??"子大屏1";
  // 图层树根节点（@board/@scene）与画布背景选中都走「根设置」抽屉：看板设置/场景设置
  const rootTitle=rootNode==="@board"?"看板设置":rootNode==="@scene"?"场景设置":null;
  const title=rootTitle??(ids.length>1?`已选择 ${ids.length} 个对象`:node?node.name:editing?"数字孪生 > 场景":boardTitle);
  // 山海鲸式面包屑标题：看板模式下「子大屏名 › 对象名」
  const breadcrumb=!editing&&node&&ids.length<=1?<><span className="properties-title-breadcrumb">{boardTitle}</span><span className="properties-title-sep" aria-hidden="true">›</span><span className="properties-title-breadcrumb">{node.name}</span></>:title;
  const bound=nodeBounds(state.scene,ids);
  // 右侧配置栏 = Semi Layout.Sider（固定位置、不可关闭、无滑出动效，用户纠偏要求）
  return <Layout.Sider className="editor-properties" aria-label="属性面板"><header className="properties-title"><Layers size={14}/><span className="properties-title-name" title={title}>{breadcrumb}</span>{node&&<Button size="small" theme="borderless" type="danger" icon={<Delete/>} aria-label="删除当前对象" onClick={()=>deleteSelection()}>删除</Button>}</header>
    <div className="properties-tabs"><div className="properties-tab-list" role="tablist" aria-label="属性菜单" onKeyDown={(event)=>{
      if(event.key!=="ArrowLeft"&&event.key!=="ArrowRight")return;
      event.preventDefault();
      const current=propertyTabs.indexOf(tab as typeof propertyTabs[number]);
      const offset=event.key==="ArrowRight"?1:-1;
      const next=propertyTabs[(current+offset+propertyTabs.length)%propertyTabs.length]!;
      setTab(next);
      document.getElementById(`properties-tab-${next}`)?.focus();
    }}>{propertyTabs.map((name)=><button id={`properties-tab-${name}`} key={name} type="button" role="tab"
      aria-selected={tab===name} tabIndex={tab===name?0:-1} className={`properties-tab${tab===name?" is-active":""}`}
      onClick={()=>setTab(name)}>{name}</button>)}</div>{node?.widget?<StateDropdown node={node}/>:node?<Tag size="small" className="state-dropdown-tag state-dropdown-static">默认状态</Tag>:<BoardStateDropdown/>}</div>
    <div className="properties-body">{tab!=="样式"?<MetadataPanel tab={tab} node={node}/>:rootNode==="@board"?<BoardProperties/>:rootNode==="@scene"?<><div className="properties-intro"><h3>场景</h3><p>数字孪生 · GPU</p></div><SceneSettings/></>:ids.length>1?<section className="property-section"><h4>{ids.length} 个对象</h4><p className="properties-note">Shift 点击可多选。工具栏支持对齐、分组、复制和删除。</p><AxisRow label="选择中心" value={{x:bound.center[0],y:bound.center[1],z:bound.center[2]}} onChange={(axis,value)=>{const delta=[0,0,0];delta[["x","y","z"].indexOf(axis)]=value-bound.center[["x","y","z"].indexOf(axis)];post({type:"transformSelection",ids,property:"position",delta})}}/><Button block size="small" onClick={()=>post({type:"group",ids})}>合并到分组</Button><Button block size="small" onClick={()=>post({type:"ungroup",ids})}>取消分组</Button><div className="batch-actions">{(["hide","show","lock","unlock"] as const).map((action,i)=><Button size="small" key={action} onClick={()=>post({type:"batch",action,ids})}>{["隐藏","显示","锁定","解锁"][i]}</Button>)}</div></section>:node?<>
      <div className="property-section"><Input size="small" aria-label="对象名称" value={draft} onChange={setDraft} disabled={node.locked} onBlur={()=>{if(draft.trim()&&draft!==node.name)post({type:"rename",id:node.id,name:draft.trim()})}} onEnterPress={e=>(e.target as HTMLInputElement).blur()}/></div>
      {kitMetadata(node)?<KitProperties key={node.id} node={node} editStateId={state.editingStates[node.id]}/>:node.widget?<WidgetProperties node={node} editStateId={state.editingStates[node.id]}/>:<Collapse key={node.id} expandIconPosition="left" className="properties-collapse" defaultActiveKey={["object","transform","geometry","terrain","terrain-material","water","water-material","water-path","water-simulation"]}>
        <Collapse.Panel header="基础设置" itemKey="object"><section className="property-section"><Field label="对象类型"><Tag size="small">{NODE_TYPE_LABEL[node.type]}</Tag></Field>
          {node.type==="model"&&<><Field label="模型资源"><Select size="small" filter aria-label="模型资源" value={node.modelId} placeholder={node.customMesh?node.customMesh.sourceName:"基础立方体"} disabled={node.locked} optionList={[...(node.customMesh?[{value:node.modelId!,label:node.customMesh.sourceName}]:[]),...modelAssets.map(a=>({value:a.id,label:a.name}))]} onChange={v=>post({type:"replaceModel",id:node.id,modelId:String(v)})}/></Field>{resource&&<div className="selected-model-card"><img src={resource.thumbnail} alt="模型预览"/><div><span>{resource.triangles.toLocaleString()} 个三角面{resource.aiGenerated?" · AI 生成":""}</span><a href={resource.source} target="_blank" rel="noreferrer">{resource.author} · {resource.license==="CC0-1.0"?"CC0":"公有领域"}</a></div></div>}{node.customMesh&&<p className="properties-note">{node.customMesh.sourceName} · {node.customMesh.triangles.toLocaleString()} 个三角面</p>}</>}
          <Field label="显示对象"><Switch size="small" aria-label="显示对象" checked={node.visible} onChange={()=>post({type:"toggleVisible",id:node.id})}/></Field><Field label="锁定对象"><Button size="small" theme="borderless" aria-label="锁定对象" icon={node.locked?<Lock/>:<Unlock/>} onClick={()=>post({type:"toggleLocked",id:node.id})}/></Field>
          <ColorField label="材质颜色" value={node.color} disabled={node.locked} onChange={color=>post({type:"color",id:node.id,color})}/>
          {node.type==="camera"&&<Button block size="small" onClick={()=>window.dispatchEvent(new CustomEvent("dw:camera",{detail:{cameraNode:node}}))}>使用该相机</Button>}
          {node.type==="light"&&<Field label="光照强度"><InputNumber size="small" aria-label="光照强度" min={0} max={5} step={.1} value={node.lightIntensity??1} onChange={v=>typeof v==="number"&&post({type:"patch",id:node.id,patch:{lightIntensity:v}})}/></Field>}
          <Field label="所属分组"><Select size="small" aria-label="所属分组" value={state.scene.some(n=>n.id===node.parentId)?node.parentId:"@root"} optionList={[{value:"@root",label:"根图层"},...state.scene.filter(n=>n.type==="group"&&n.id!==node.id).map(n=>({value:n.id,label:n.name}))]} onChange={v=>post({type:"reparent",ids:[node.id],parentId:v==="@root"?null:String(v)})}/></Field>
        </section></Collapse.Panel>
        <Collapse.Panel header="变换" itemKey="transform"><section className="property-section"><AxisRow label="位置" value={node.transform.position} disabled={node.locked} onChange={(a,v)=>transform("position",a,v)}/><AxisRow label="旋转 (°)" value={node.transform.rotation} step={1} disabled={node.locked} onChange={(a,v)=>transform("rotation",a,v)}/><AxisRow label="缩放" value={node.transform.scale} step={.1} disabled={node.locked} onChange={(a,v)=>transform("scale",a,v)}/></section></Collapse.Panel>
        {node.type==="terrain"&&<TerrainProperties node={node}/>}{node.type==="water"&&<WaterProperties node={node}/>}
        {node.boxSize&&node.type!=="group"&&node.type!=="terrain"&&node.type!=="water"&&<Collapse.Panel header="几何尺寸" itemKey="geometry"><section className="property-section"><AxisRow label="尺寸" value={node.boxSize} step={1} disabled={node.locked} onChange={(axis,value)=>post({type:"setAxis",id:node.id,property:"boxSize",axis,value})}/></section></Collapse.Panel>}
        {node.type==="flyline"&&node.to&&<Collapse.Panel header="飞线终点" itemKey="endpoint"><section className="property-section"><AxisRow label="终点" value={node.to} onChange={(axis,value)=>post({type:"setAxis",id:node.id,property:"to",axis,value})}/></section></Collapse.Panel>}
      </Collapse>}{editing&&<div className="property-section"><Button block size="small" onClick={()=>focusSelection()}>定位选中对象 (F)</Button></div>}
    </>:editing?<><div className="properties-intro"><h3>场景</h3><p>数字孪生 · GPU</p></div><SceneSettings/></>:<BoardProperties/>}</div>
  </Layout.Sider>;
}
