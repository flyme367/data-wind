import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Checkbox, Dropdown, Input, Modal, Tabs, Tooltip, Tree } from "@douyinfe/semi-ui";
import type { TreeNodeData } from "@douyinfe/semi-ui/lib/es/tree/interface";
import { Cube, Layers, Folder, Sun, Camera, PreviewOpen, PreviewClose, Lock, Unlock, Delete, Filter } from "@icon-park/react";
import { getSceneBridge, type SceneSnapshot } from "../workers/bridge";
import { openSceneContextMenu } from "../state/contextMenu";
import type { SceneNode } from "../types";
import { modelAssetById } from "../data/modelCatalog";
import { selection, copySelection, duplicateSelection, deleteSelection, focusSelection, deleteSceneObject } from "../state/sceneActions";
import { BACKGROUND_BOARD_PAGE_ID, descendants, widgetLabels } from "../data/editor";

export function SceneTreePanel({ snapshot, editing, setEditing, boardName, boardLayer, boardPageId, onSelectRoot }: {
  snapshot: SceneSnapshot | null; editing: boolean; setEditing: (value: boolean) => void; boardName: string;
  boardLayer: "page" | "background"; boardPageId: string; onSelectRoot: (id: "@board" | "@scene") => void;
}) {
  const [filterKinds, setFilterKinds] = useState<string[]>([]);
  const [tab, setTab] = useState("scene");
  const [rename, setRename] = useState<SceneNode | null>(null);
  const [draft, setDraft] = useState("");
  const modifier=useRef(false);
  const scene = snapshot?.tree ?? [];
  const [expanded, setExpanded] = useState<string[]>(["@scene", "@board"]);
  const isPlant = (n: SceneNode) => modelAssetById.get(n.modelId ?? "")?.category.startsWith("植被");
  // 过滤选项按节点类型（组件细分到 widgetLabels 类型名），山海鲸式漏斗下拉多选
  const typeLabelOf = (n: SceneNode) => {
    if (n.type === "group") return "分组";
    if (n.type === "widget") return (n.widget?.kind && widgetLabels[n.widget.kind]) || "组件";
    if (n.type === "model") return isPlant(n) ? "植被" : "模型";
    return { terrain: "地形", water: "水体", light: "灯光", camera: "相机", marker: "标记点", flyline: "飞线", fence: "电子围栏" }[n.type as "light"] ?? "其他";
  };
  const baseTree = useMemo<(TreeNodeData & { typeLabel?: string })[]>(() => {
    const currentWidgetIds = new Set(scene.filter((n) => n.type === "widget" && (boardLayer === "background"
      ? n.boardPageId === BACKGROUND_BOARD_PAGE_ID : !n.boardPageId || n.boardPageId === boardPageId)).map((n) => n.id));
    const byId = new Map(scene.map((node) => [node.id, node]));
    const currentGroupIds = new Set<string>();
    for (const widgetId of currentWidgetIds) {
      let parent = byId.get(widgetId)?.parentId;
      const seen = new Set<string>();
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        const node = byId.get(parent);
        if (node?.type === "group") currentGroupIds.add(node.id);
        parent = node?.parentId ?? null;
      }
    }
    const rows = (items: SceneNode[]): (TreeNodeData & { typeLabel?: string })[] => items.filter((n) => editing || (n.type !== "widget" || currentWidgetIds.has(n.id)) && (n.type !== "group" || currentGroupIds.has(n.id))).map((n) => ({
      key: n.id, value: n.id, label: n.name, icon: n.type === "group" ? <Folder /> : <Cube />,
      typeLabel: n.type === "group" ? "分组" : typeLabelOf(n),
      children: n.type === "group" ? rows(scene.filter((child) => child.parentId === n.id)) : undefined,
    }));
    const roots = scene.filter((n) => !scene.some((parent) => parent.id === n.parentId));
    if (!editing) return [{ key: "@board", value: "@board", label: boardName, icon: <Layers />, children: [
      ...rows(roots.filter((n) => n.type === "widget" || (n.type === "group" && currentGroupIds.has(n.id)))),
      { key: "@twin", value: "@twin", label: "数字孪生", icon: <Cube /> },
    ] }];
    const grouped = [
      { key: "@sky", label: "天空", icon: <Sun />, children: [] as (TreeNodeData & { typeLabel?: string })[] },
      { key: "@camera", label: "相机", icon: <Camera />, children: rows(roots.filter((n) => n.type === "camera")) },
      { key: "@models", label: "模型层", icon: <Folder />, children: rows(roots.filter((n) => (n.type === "model" || n.type === "group") && !isPlant(n)&&!scene.some(w=>w.type==="widget"&&descendants(scene,[n.id]).has(w.id)))) },
      { key: "@plants", label: "植被", icon: <Folder />, children: rows(roots.filter(isPlant)) },
      { key: "@terrain", label: "地表", icon: <Layers />, children: rows(roots.filter((n) => n.type === "terrain" || n.type === "water")) },
      { key: "@markers", label: "标绘层", icon: <Folder />, children: rows(roots.filter((n) => ["marker", "flyline", "fence"].includes(n.type))) },
      { key: "@shapes", label: "形状", icon: <Folder />, children: [] as (TreeNodeData & { typeLabel?: string })[] },
      { key: "@lights", label: "灯光", icon: <Sun />, children: rows(roots.filter((n) => n.type === "light")) },
    ];
    return [{ key: "@scene", value: "@scene", label: "场景", icon: <Folder />,
      children: tab === "helper" ? grouped.filter((n) => ["@camera", "@lights"].includes(n.key)) : grouped }];
  // 依赖 snapshot 本身而非 tree：worker 对部分 op 复用 tree 数组引用（原地改节点），只看 scene 会导致行内显隐/多选高亮陈旧
  }, [snapshot, editing, tab, boardName, boardLayer, boardPageId]);
  // 过滤类型选项：取未过滤全量树中真实叶子（组件/对象）的类型名，虚拟节点（@board/@scene/分层标题）不计
  const filterOptions = useMemo(() => {
    const labels = new Set<string>();
    const walk = (nodes: (TreeNodeData & { typeLabel?: string })[]) => {
      for (const node of nodes) {
        if (String(node.key).startsWith("@")) { if (node.children) walk(node.children); continue; }
        if (node.children) walk(node.children);
        else if (node.typeLabel) labels.add(node.typeLabel);
      }
    };
    walk(baseTree);
    return [...labels];
  }, [baseTree]);
  // 勾选后只保留命中的叶子分支；未勾选不过滤。分组/分层标题作为容器跟随命中子节点保留
  const data = useMemo<TreeNodeData[]>(() => {
    if (!filterKinds.length) return baseTree;
    const keep = (nodes: (TreeNodeData & { typeLabel?: string })[]): TreeNodeData[] => nodes
      .map((node) => node.children ? { ...node, children: keep(node.children) } : node)
      .filter((node) => node.children ? node.children.length > 0 : filterKinds.includes(node.typeLabel ?? "")) as TreeNodeData[];
    return keep(baseTree);
  }, [baseTree, filterKinds]);
  const toggleFilter = (label: string) => setFilterKinds((prev) => prev.includes(label) ? prev.filter((item) => item !== label) : [...prev, label]);
  const selected = scene.find((n) => n.id === snapshot?.selectedId);
  // 图层树右键：原生监听接管（React 19 委托下 Semi Tree 的 onContextMenu 不触发，onClick 正常——见 2026-11-08 批次记录）。
  // 真实节点不在多选中先补选中再弹菜单；虚拟根直接弹 root 专属菜单。节点 id 取 li 的 data-key。
  const treeRef = useRef<HTMLDivElement>(null);
  const selectedIdsRef = useRef<string[]>([]);
  selectedIdsRef.current = snapshot?.selectedIds ?? [];
  useEffect(() => {
    const container = treeRef.current;
    if (!container) return;
    const onContextMenu = (e: MouseEvent) => {
      const option = (e.target as HTMLElement)?.closest?.(".semi-tree-option");
      if (!option) return;
      e.preventDefault();
      const key = option.getAttribute("data-key") ?? "";
      if (!key.startsWith("@") && !selectedIdsRef.current.includes(key)) getSceneBridge().post({ type: "select", id: key });
      openSceneContextMenu(e.clientX, e.clientY, key);
    };
    container.addEventListener("contextmenu", onContextMenu);
    return () => container.removeEventListener("contextmenu", onContextMenu);
  }, []);
  return <>
    {/* 山海鲸式图层头部：左「图标｜文案」标题（3D 编辑态为组件图层），右过滤漏斗（收起走底栏，添加走素材库） */}
    <header className="scene-tree-heading">
      <Layers /><span className="scene-tree-title">{editing ? "组件图层" : "看板图层"}</span>
      <Dropdown trigger="click" clickToHide={false} position="bottomRight" className="scene-filter-dropdown"
        render={<Dropdown.Menu className="scene-filter-menu">
          {filterOptions.length ? filterOptions.map((label) => <Dropdown.Item key={label} onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={filterKinds.includes(label)} onChange={() => toggleFilter(label)}>{label}</Checkbox>
          </Dropdown.Item>) : <Dropdown.Item disabled>暂无可过滤类型</Dropdown.Item>}
        </Dropdown.Menu>}>
        <span><Tooltip content="过滤图层类型"><Button theme="borderless" size="small" icon={<Filter />} aria-label="过滤图层类型" /></Tooltip></span>
      </Dropdown>
    </header>
    {editing && <Tabs size="small" activeKey={tab} onChange={setTab} className="scene-tabs">
      <Tabs.TabPane tab="场景" itemKey="scene" /><Tabs.TabPane tab="材质" itemKey="materials" /><Tabs.TabPane tab="辅助" itemKey="helper" />
    </Tabs>}
    {tab === "materials" && editing ? <div className="tree-materials">{["#A4B7D8", "#CAD7C5", "#E1D3BE", "#64748B", "#409EFF", "#CE6A55"].map((color) =>
      <button key={color} style={{ background: color }} title={color} disabled={!selected} onClick={() => selected && getSceneBridge().post({ type: "color", id: selected.id, color })} />)}<p>选择对象后点击材质颜色应用</p></div> :
      <div className="scene-tree-content" ref={treeRef}><Tree treeData={data} blockNode draggable onDrop={({node,dragNode})=>{const target=scene.find(n=>n.id===node.key);const id=String(dragNode.key);if(!scene.some(n=>n.id===id))return;getSceneBridge().post({type:"reparent",ids:[id],parentId:target?.type==="group"?target.id:target?.parentId??null})}} expandedKeys={expanded}
        onExpand={setExpanded} value={snapshot?.selectedId ?? (editing ? "@scene" : "@board")}
        onSelect={(id) => { if (id === "@twin") { setEditing(true); onSelectRoot("@scene"); return; } if (id === "@board" || id === "@scene") { onSelectRoot(id); return; } getSceneBridge().post({ type: "select", id: id.startsWith("@") ? null : id, additive:modifier.current }); }}
        onDoubleClick={(_event, item) => { const node = scene.find((n) => n.id === item.key);
          if (node) { setRename(node); setDraft(node.name); } else if (item.key === "@twin") setEditing(true);
        }} renderLabel={(label, item) => { const node = scene.find((n) => n.id === item?.key);
          return <span onPointerDown={e=>{modifier.current=e.shiftKey}} className={`scene-node-label ${snapshot?.selectedIds.includes(String(item?.key))?"is-selected":""} ${node?.visible === false ? "is-hidden" : ""}`}>
            <span className="scene-node-name">{label}</span>
            {/* 山海鲸式行内快捷键：hover 显出 显隐/锁定 小按钮；虚拟根（无 node）不显示 */}
            {node && <span className="tree-row-actions" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
              <button type="button" aria-label={node.visible ? "隐藏对象" : "显示对象"} title={node.visible ? "隐藏" : "显示"}
                onClick={(e) => { e.stopPropagation(); getSceneBridge().post({ type: "toggleVisible", id: node.id }); }}>{node.visible ? <PreviewOpen /> : <PreviewClose />}</button>
              <button type="button" aria-label={node.locked ? "解锁对象" : "锁定对象"} title={node.locked ? "解锁" : "锁定"}
                onClick={(e) => { e.stopPropagation(); getSceneBridge().post({ type: "toggleLocked", id: node.id }); }}>{node.locked ? <Lock /> : <Unlock />}</button>
            </span>}
          </span>; }} /></div>}
    {selected && <div className="tree-selection-tools">
      <Dropdown trigger="click" render={<Dropdown.Menu><Dropdown.Item onClick={copySelection}>复制</Dropdown.Item><Dropdown.Item onClick={duplicateSelection}>复制副本</Dropdown.Item><Dropdown.Item onClick={()=>getSceneBridge().post({type:"group",ids:selection()})}>合并到分组</Dropdown.Item><Dropdown.Item onClick={()=>getSceneBridge().post({type:"ungroup",ids:selection()})}>取消分组</Dropdown.Item><Dropdown.Item onClick={()=>focusSelection()}>定位对象</Dropdown.Item><Dropdown.Item onClick={()=>deleteSelection()}>删除选中</Dropdown.Item></Dropdown.Menu>}><span><Button size="small" theme="borderless" aria-label="图层操作">⋯</Button></span></Dropdown>
      <Tooltip content={selected.visible ? "隐藏" : "显示"}><span><Button size="small" theme="borderless" icon={selected.visible ? <PreviewOpen /> : <PreviewClose />} aria-label="切换对象可见性" onClick={() => getSceneBridge().post({ type: "toggleVisible", id: selected.id })} /></span></Tooltip>
      <Tooltip content={selected.locked ? "解锁" : "锁定"}><span><Button size="small" theme="borderless" icon={selected.locked ? <Lock /> : <Unlock />} aria-label="切换对象锁定" onClick={() => getSceneBridge().post({ type: "toggleLocked", id: selected.id })} /></span></Tooltip>
      <Tooltip content={selected.locked ? "请先解锁对象" : "删除对象（可撤销）"}><span><Button size="small" theme="borderless" disabled={selected.locked} icon={<Delete />} aria-label="删除选中对象" onClick={() => deleteSceneObject(selected.id)} /></span></Tooltip>
    </div>}
    <Modal title="重命名对象" visible={Boolean(rename)} onCancel={() => setRename(null)} okText="确定" cancelText="取消" width={360}
      cancelButtonProps={{ autoFocus: false }} onOk={() => {
      if (rename && draft.trim()) getSceneBridge().post({ type: "rename", id: rename.id, name: draft.trim() }); setRename(null);
    }}><Input value={draft} onChange={setDraft} autoFocus aria-label="对象名称" /></Modal>
  </>;
}
