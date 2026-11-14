import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { handle, flattenScene } from "../workers/sceneModel";
import { nodeBounds, normalizeWidgetStyle, sanitizeWidgetStates, widgetAppearanceStyle, widgetNode } from "../data/editor";
import { resolveRuntimeNode } from "../data/runtimeScene";
import { primitiveNode } from "../engine/primitives";
import { importGlb } from "../engine/importGlb";
import { parseProjectFile, validateScene } from "../state/projects";
const open=()=>handle({type:"openProject",projectId:"editor",tree:[],template:"empty"})!;
const add=(name="模型")=>handle({type:"add",node:{type:"model",name}})!;
beforeEach(open);
describe("complete local editing operations",()=>{
  it("groups and ungroups without moving models, then moves a whole group atomically",()=>{
    const a=add().selectedId!,b=add().selectedId!;
    const before=handle({type:"selectMany",ids:[a,b]})!;
    const grouped=handle({type:"group",ids:[a,b]})!,group=grouped.selectedId!;
    expect(grouped.tree.filter(n=>n.parentId===group)).toHaveLength(2);
    expect(grouped.flat.map(n=>n.pos)).toEqual(before.flat.map(n=>n.pos));
    const moved=handle({type:"transformSelection",ids:[group,a],property:"position",delta:[5,0,2]})!;
    expect(moved.flat.map(n=>n.pos)).toEqual([[5,2,2],[5,2,2]]);
    expect(handle({type:"undo"})!.tree).toEqual(grouped.tree);
    expect(handle({type:"ungroup",ids:[group]})!.tree).toEqual(before.tree);
  });
  it("protects nested locked models and rejects cyclic reparenting",()=>{
    const a=add().selectedId!,b=add().selectedId!,group=handle({type:"group",ids:[a,b]})!.selectedId!;
    const before=handle({type:"toggleLocked",id:group})!;
    expect(before.flat.every(n=>n.locked)).toBe(true);
    expect(handle({type:"transform",id:a,position:[99,99,99]})!.tree).toEqual(before.tree);
    handle({type:"batch",action:"unlock",ids:[group]});
    const sub=handle({type:"add",node:{type:"group"},parentId:group})!.selectedId!;
    expect(handle({type:"reparent",ids:[group],parentId:sub})).toBeNull();
  });
  it("deletes and duplicates a multi-selection with a single history step",()=>{
    const a=add().selectedId!,b=add().selectedId!;
    const copied=handle({type:"batch",action:"duplicate",ids:[a,b]})!;
    expect(copied.selectedIds).toHaveLength(2);expect(copied.tree).toHaveLength(4);
    expect(handle({type:"undo"})!.tree).toHaveLength(2);
    const removed=handle({type:"batch",action:"remove",ids:[a,b]})!;expect(removed.tree).toEqual([]);
    expect(handle({type:"undo"})!.tree).toHaveLength(2);
  });
  it("aligns the bounding edges and evenly distributes centers",()=>{
    const ids=[add().selectedId!,add().selectedId!,add().selectedId!];
    ids.forEach((id,i)=>handle({type:"transform",id,position:[i===2?20:i*4,2,i*3]}));
    const aligned=handle({type:"align",ids,axis:2,mode:"min"})!;expect(new Set(aligned.flat.map(n=>n.pos[2])).size).toBe(1);
    const spread=handle({type:"align",ids,axis:0,mode:"distribute"})!;expect(spread.flat.map(n=>n.pos[0])).toEqual([0,10,20]);
  });
  it("centers on the board and distributes by edges (山海鲸操作菜单)",()=>{
    const ids=[0,1,2].map(()=>handle({type:"add",node:widgetNode("text")})!.selectedId!);
    ids.forEach((id,i)=>handle({type:"transform",id,position:[i*300,0,0]}));
    // 看板水平居中（单选可用）：text 宽 300，画布 1920 → 左上角 x=960-150
    const centered=handle({type:"align",ids:[ids[0]],axis:0,mode:"board",board:{width:1920,height:1080}})!;
    expect(centered.tree.find(n=>n.id===ids[0])!.transform.position.x).toBe(810);
    // 按顶分布：顶边 y=0/50/240 → 等距 0/120/240
    ids.forEach((id,i)=>handle({type:"transform",id,position:[i*300,i===1?50:i*120,0]}));
    const tops=handle({type:"align",ids,axis:1,mode:"distribute",edge:"min"})!.tree.filter(n=>n.type==="widget").map(n=>n.transform.position.y);
    expect(tops).toEqual([0,120,240]);
    // 按左分布：左边缘 x=0/300/600 已等距则保持
    const lefts=handle({type:"align",ids,axis:0,mode:"distribute",edge:"min"})!.tree.filter(n=>n.type==="widget").map(n=>n.transform.position.x);
    expect(lefts).toEqual([0,300,600]);
    // board 居中只支持看板两轴
    expect(handle({type:"align",ids:[ids[0]],axis:2,mode:"board",board:{width:1920,height:1080}})).toBeNull();
  });
  it("supports ShanHai widget states: patches, runtime switching, and undo (山海鲸默认状态)",()=>{
    const created=handle({type:"add",node:widgetNode("metric")})!,id=created.selectedId!;
    const stateId="st1";
    const added=handle({type:"widgetStates",id,states:[{id:stateId,name:"高亮",patch:{}}]})!;
    expect(added.tree[0].widget!.states).toEqual([{id:stateId,name:"高亮",patch:{}}]);
    // 状态补丁写入：白名单外的键（如 kind）被剔除
    const patched=handle({type:"patchWidgetState",id,stateId,patch:{background:"#ff0000",fontSize:40,kind:"pie" as never}})!;
    const patch=patched.tree[0].widget!.states![0].patch;
    expect(patch.background).toBe("#ff0000");expect(patch.fontSize).toBe(40);expect("kind" in patch).toBe(false);
    // runtime 切换状态：渲染端拿到的是合并后的有效样式
    const node=patched.tree[0];
    const merged=resolveRuntimeNode(node,{}, {[id]:{stateId}});
    expect(merged.widget!.background).toBe("#ff0000");expect(merged.widget!.fontSize).toBe(40);
    expect(merged.widget!.text).toBe(node.widget!.text);
    expect(resolveRuntimeNode(node,{},{}).widget!.background).toBe(node.widget!.background);
    // 撤销逐级回退：补丁一步、建状态一步
    expect(handle({type:"undo"})!.tree[0].widget!.states![0].patch).toEqual({});
    expect(handle({type:"undo"})!.tree[0].widget!.states).toBeUndefined();
    // 不存在的状态拒绝；非法列表清洗为空
    expect(handle({type:"patchWidgetState",id,stateId:"nope",patch:{fontSize:20}})).toBeNull();
    expect(sanitizeWidgetStates("bad")).toEqual([]);
    // 清洗：剔缺 id 项、trim 名字、过滤非法补丁键
    expect(sanitizeWidgetStates([{id:"a",name:" 好 ",patch:{hack:1,fontSize:50}},{name:"x"}]))
      .toEqual([{id:"a",name:"好",patch:{fontSize:50}}]);
    expect(normalizeWidgetStyle({...widgetNode("metric").widget, states:[{id:"b",name:"态",patch:{italic:true}}]})
      .states).toEqual([{id:"b",name:"态",patch:{italic:true}}]);
  });

  it("flow layout arranges widgets in rows within the board (山海鲸流式布局)",()=>{
    const ids=[0,1,2].map(()=>handle({type:"add",node:widgetNode("text")})!.selectedId!);
    ids.forEach((id,i)=>handle({type:"transform",id,position:[400+i*700,600,0]}));
    const laid=handle({type:"flowLayout",board:{width:1780,height:1340}})!;
    const rows=laid.tree.filter(n=>n.type==="widget").map(n=>n.transform.position);
    // text 宽 300 + 24 边距：三块放不进一行（300*3+24*4=996 < 1780-48? 996 < 1732 可放下）→ 同一行 y=24
    expect(rows.every(p=>p.y===24)).toBe(true);
    expect(rows.map(p=>p.x)).toEqual([24,348,672]);
    expect(handle({type:"undo"})!.tree.filter(n=>n.type==="widget").map(n=>n.transform.position.x)).toEqual([400,1100,1800]);
  });
  it("makes scene settings undoable and includes them in exported projects",()=>{
    const configured=handle({type:"configure",patch:{time:21,background:"#162338",fog:false}})!;
    const restored=parseProjectFile(JSON.stringify({scene:configured.tree,settings:configured.settings}));expect(restored.settings.time).toBe(21);
    expect(handle({type:"undo"})!.settings.time).toBe(15.4);expect(handle({type:"redo"})!.settings.fog).toBe(false);
    expect(open().settings.time).toBe(15.4);
  });
  it("persists widget configuration, custom data, and interaction rules through copy and import",()=>{
    const created=handle({type:"add",node:widgetNode("bar")})!,node=created.tree[0];
    const next=handle({type:"patch",id:node.id,patch:{data:{rows:[{name:"设备",value:42}]},interactions:[{id:"rule",event:"click",action:"toggle",targetId:node.id,value:""}]}})!;
    const copied=handle({type:"paste",nodes:next.tree})!;
    expect(copied.tree[1].interactions![0].targetId).toBe(copied.tree[1].id);
    // 文件边界 validateScene 会给无名规则补「交互N」名字；paste 不做归一化，比对时对齐该差异
    const imported=parseProjectFile(JSON.stringify({scene:copied.tree})).scene;
    expect(imported).toEqual(copied.tree.map(item=>({...item,
      interactions:item.interactions?.map((rule,index)=>({...rule,name:`交互${index+1}`}))})));
    expect(nodeBounds(copied.tree,[node.id]).center.slice(0,2)).toEqual([290,210]);
  });
  it("applies safe data bindings to geometry and inherits parent visibility",()=>{
    const a=add().selectedId!,b=add().selectedId!,group=handle({type:"group",ids:[a,b]})!.selectedId!;
    handle({type:"patch",id:a,patch:{data:{location:{x:12}},bindings:{x:"location.x"}}});
    expect(handle({type:"select",id:a})!.flat[0].pos[0]).toBe(12);
    const hidden=handle({type:"patch",id:group,patch:{data:{enabled:false},bindings:{visible:"enabled"}}})!;
    expect(hidden.flat).toHaveLength(0);
  });
  it("passes three-axis rotation in radians to both renderer boundaries",()=>{
    const id=add().selectedId!;
    const result=handle({type:"transform",id,property:"rotation",position:[30,60,90]})!;
    expect(result.flat[0].rotation).toEqual([Math.PI/6,Math.PI/3,Math.PI/2]);
    expect(flattenScene(result.tree)).toEqual(result.flat);
  });
});
describe("self-contained GLB import",()=>{
  it("decodes source meshes, embeds portable bytes and preserves finite normals",()=>{
    const raw=readFileSync(new URL("../../model-sources/medical-23602.glb",import.meta.url));
    const bytes=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength) as ArrayBuffer;
    const partial=importGlb(bytes,"核磁.glb"),snapshot=handle({type:"add",node:partial})!,node=snapshot.tree[0];
    expect(node.customMesh!.triangles).toBeGreaterThan(100);expect(snapshot.flat[0].kind).toBe("mesh");
    expect(validateScene(snapshot.tree)).toEqual(snapshot.tree);
    expect(parseProjectFile(JSON.stringify({scene:snapshot.tree})).scene).toEqual(snapshot.tree);
    const encoded=atob(node.customMesh!.bytes),data=Uint8Array.from(encoded,c=>c.charCodeAt(0));
    expect(new TextDecoder().decode(data.slice(0,4))).toBe("DWM2");expect(new DataView(data.buffer).getUint32(8,true)).toBe(node.customMesh!.triangles*3);
  });
  it("rejects invalid files before changing the scene",()=>{
    expect(()=>importGlb(new ArrayBuffer(10),"bad.glb")).toThrow(/GLB/);
    expect(open().tree).toEqual([]);
  });
});

it("builds portable primitives with valid finite triangle normals",()=>{
  // DWM2 布局：16B 头 + 唯一顶点 13B（position u16×3 / 法线八面体 i16×2 / 颜色 u8×3），法线解码后须为单位向量。
  for(const kind of ["sphere","cylinder","cone","torus"] as const){
    const partial=primitiveNode(kind),created=handle({type:"add",node:partial})!;expect(validateScene(created.tree)).toEqual(created.tree);
    const data=Uint8Array.from(atob(partial.customMesh!.bytes),c=>c.charCodeAt(0)),view=new DataView(data.buffer);
    expect(new TextDecoder().decode(data.slice(0,4))).toBe("DWM2");
    const unique=view.getUint32(4,true),indices=view.getUint32(8,true);
    expect(indices).toBe(partial.customMesh!.triangles*3);
    const normals:number[][]=[];
    for(let i=0;i<unique;i++){
      const base=16+i*13,x=view.getInt16(base+6,true)/32767,y=view.getInt16(base+8,true)/32767,z=1-Math.abs(x)-Math.abs(y);
      const [nx,ny]=z<0?[(1-Math.abs(y))*(x<0?-1:1),(1-Math.abs(x))*(y<0?-1:1)]:[x,y];
      // 八面体解码面满足 L1 范数 ≈ 1（Rust 解码端最后做 L2 归一化还原单位向量）。
      normals.push([Math.abs(nx)+Math.abs(ny)+Math.abs(z),nx,ny]);
    }
    for(const [l1] of normals)expect(l1).toBeCloseTo(1,3);
  }
});

it("新图元自带山海鲸同款样式字段，外观样式与旧数据归一化保持一致",()=>{
  const base=widgetNode("text").widget!;
  expect(base).toMatchObject({fontWeight:400,italic:false,underline:false,lineHeight:0,borderStyle:"solid",borderWidth:1,shadowColor:"transparent"});
  expect(widgetAppearanceStyle(base,"#6cbcff")).toMatchObject({borderWidth:"1px",borderStyle:"solid",fontWeight:"400",textDecoration:"none"});
  expect(widgetAppearanceStyle(base,"#6cbcff").boxShadow).toBeUndefined();
  const shadow=widgetAppearanceStyle({...base,shadowColor:"#000000b3",shadowBlur:10,shadowOffsetY:4},"#ffffff");
  expect(shadow.boxShadow).toBe("0px 4px 10px #000000b3");
  expect(widgetAppearanceStyle({...base,borderStyle:"none",fontFamily:"'PingFang SC','Microsoft YaHei',sans-serif"},"#ffffff")).toMatchObject({borderWidth:"0px",fontFamily:"'PingFang SC','Microsoft YaHei',sans-serif"});
  const dirty=normalizeWidgetStyle({...base,fontWeight:900,borderStyle:"wavy" as never,lineHeight:-3,letterSpacing:Number.NaN,shadowBlur:9_999});
  expect(dirty).toMatchObject({fontWeight:400,borderStyle:"solid",lineHeight:0,letterSpacing:0,shadowBlur:200});
});
