import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Cube, Layers, Folder, Sun, Camera, PreviewOpen, PreviewClose, Lock, Unlock, Delete, Filter } from "@icon-park/react";
import { getSceneBridge, type SceneSnapshot } from "../workers/bridge";
import { openSceneContextMenu } from "../state/contextMenu";
import type { SceneNode } from "../types";
import { modelAssetById } from "../data/modelCatalog";
import { selection, copySelection, duplicateSelection, deleteSelection, focusSelection, deleteSceneObject } from "../state/sceneActions";
import { BACKGROUND_BOARD_PAGE_ID, descendants, widgetLabels } from "../data/editor";

/** 场景树节点数据（原 Semi Tree 的 TreeNodeData，本地定义） */
type TreeNodeData = { key: string; label: ReactNode; icon?: ReactNode; children?: TreeNodeData[] };

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
  const dragId = useRef<string | null>(null);
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
      key: n.id, label: n.name, icon: n.type === "group" ? <Folder /> : <Cube />,
      typeLabel: n.type === "group" ? "分组" : typeLabelOf(n),
      children: n.type === "group" ? rows(scene.filter((child) => child.parentId === n.id)) : undefined,
    }));
    const roots = scene.filter((n) => !scene.some((parent) => parent.id === n.parentId));
    if (!editing) return [{ key: "@board", label: boardName, icon: <Layers />, children: [
      ...rows(roots.filter((n) => n.type === "widget" || (n.type === "group" && currentGroupIds.has(n.id)))),
      { key: "@twin", label: "数字孪生", icon: <Cube /> },
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
    return [{ key: "@scene", label: "场景", icon: <Folder />,
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
  // 图层树右键：原生监听接管（React 19 委托下树选项的 onContextMenu 不触发，onClick 正常——见 2026-11-08 批次记录）。
  // 真实节点不在多选中先补选中再弹菜单；虚拟根直接弹 root 专属菜单。节点 id 取行元素的 data-key。
  const treeRef = useRef<HTMLDivElement>(null);
  const selectedIdsRef = useRef<string[]>([]);
  selectedIdsRef.current = snapshot?.selectedIds ?? [];
  useEffect(() => {
    const container = treeRef.current;
    if (!container) return;
    const onContextMenu = (e: MouseEvent) => {
      const option = (e.target as HTMLElement)?.closest?.(".scene-tree-option");
      if (!option) return;
      e.preventDefault();
      const key = option.getAttribute("data-key") ?? "";
      if (!key.startsWith("@") && !selectedIdsRef.current.includes(key)) getSceneBridge().post({ type: "select", id: key });
      openSceneContextMenu(e.clientX, e.clientY, key);
    };
    container.addEventListener("contextmenu", onContextMenu);
    return () => container.removeEventListener("contextmenu", onContextMenu);
  }, []);
  const onSelect = (id: string) => { if (id === "@twin") { setEditing(true); onSelectRoot("@scene"); return; }
    if (id === "@board" || id === "@scene") { onSelectRoot(id); return; }
    getSceneBridge().post({ type: "select", id: id.startsWith("@") ? null : id, additive: modifier.current }); };
  const selectedValue = snapshot?.selectedId ?? (editing ? "@scene" : "@board");
  // 递归渲染树行（blockNode 整行可点）：缩进 12px/层，展开箭头 + 类型图标 + 标签（行内显隐/锁定快捷键），
  // HTML5 DnD 拖拽换父：drop 目标为分组时挂到分组下，否则挂到目标同级
  const renderRow = (item: TreeNodeData, depth: number): ReactNode => {
    const key = String(item.key);
    const node = scene.find((n) => n.id === key);
    const hasChildren = Boolean(item.children?.length);
    const isExpanded = expanded.includes(key);
    return <div key={key}>
      <div role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined} aria-selected={selectedValue === key || undefined}
        data-key={key} draggable style={{ paddingLeft: depth * 12 }}
        className={`scene-tree-option group/row flex min-h-7 items-center gap-1 pr-2 ${selectedValue === key ? "bg-[#3789f4] text-white" : ""}`}
        onDragStart={() => { dragId.current = key; }} onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const target = scene.find((n) => n.id === key); const id = String(dragId.current);
          if (!scene.some((n) => n.id === id)) return;
          getSceneBridge().post({ type: "reparent", ids: [id], parentId: target?.type === "group" ? target.id : target?.parentId ?? null }); }}
        onClick={() => onSelect(key)}
        onDoubleClick={() => { const target = scene.find((n) => n.id === key);
          if (target) { setRename(target); setDraft(target.name); } else if (key === "@twin") setEditing(true); }}>
        {hasChildren ? <button type="button" aria-label={isExpanded ? "收起" : "展开"} aria-expanded={isExpanded}
            className="flex size-3.5 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0"
            onClick={(e) => { e.stopPropagation(); setExpanded((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]); }}>
            <span aria-hidden className={`inline-block size-1.5 border-r border-b border-current transition-transform ${isExpanded ? "rotate-45" : "-rotate-45"}`} />
          </button>
          : <span className="size-3.5 shrink-0" />}
        <span className="flex shrink-0 text-[13px] text-[#a8a8a8]">{item.icon}</span>
        <span onPointerDown={(e) => { modifier.current = e.shiftKey; }}
          className={`scene-node-label ${snapshot?.selectedIds.includes(key) ? "is-selected" : ""} ${node?.visible === false ? "is-hidden" : ""}`}>
          <span className="scene-node-name">{item.label}</span>
          {/* 山海鲸式行内快捷键：hover 显出 显隐/锁定 小按钮；虚拟根（无 node）不显示 */}
          {node && <span className="tree-row-actions opacity-0 transition-opacity group-hover/row:opacity-100" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label={node.visible ? "隐藏对象" : "显示对象"} title={node.visible ? "隐藏" : "显示"}
              onClick={(e) => { e.stopPropagation(); getSceneBridge().post({ type: "toggleVisible", id: node.id }); }}>{node.visible ? <PreviewOpen /> : <PreviewClose />}</button>
            <button type="button" aria-label={node.locked ? "解锁对象" : "锁定对象"} title={node.locked ? "解锁" : "锁定"}
              onClick={(e) => { e.stopPropagation(); getSceneBridge().post({ type: "toggleLocked", id: node.id }); }}>{node.locked ? <Lock /> : <Unlock />}</button>
          </span>}
        </span>
      </div>
      {hasChildren && isExpanded && item.children?.map((child) => renderRow(child, depth + 1))}
    </div>;
  };
  return <>
    {/* 山海鲸式图层头部：左「图标｜文案」标题（3D 编辑态为组件图层），右过滤漏斗（收起走底栏，添加走素材库） */}
    <header className="scene-tree-heading">
      <Layers /><span className="scene-tree-title">{editing ? "组件图层" : "看板图层"}</span>
      <DropdownMenu>
        <DropdownMenuTrigger render={<span />}>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="过滤图层类型" />}><Filter /></TooltipTrigger>
            <TooltipContent>过滤图层类型</TooltipContent>
          </Tooltip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="scene-filter-dropdown scene-filter-menu w-auto">
          {filterOptions.length ? filterOptions.map((label) => <DropdownMenuItem key={label} closeOnClick={false}>
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox checked={filterKinds.includes(label)} onCheckedChange={() => toggleFilter(label)} />
              {label}
            </label>
          </DropdownMenuItem>) : <DropdownMenuItem disabled>暂无可过滤类型</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
    {editing && <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="scene-tabs">
      <TabsList><TabsTrigger value="scene">场景</TabsTrigger><TabsTrigger value="materials">材质</TabsTrigger><TabsTrigger value="helper">辅助</TabsTrigger></TabsList>
    </Tabs>}
    {tab === "materials" && editing ? <div className="tree-materials">{["#A4B7D8", "#CAD7C5", "#E1D3BE", "#64748B", "#409EFF", "#CE6A55"].map((color) =>
      <button key={color} style={{ background: color }} title={color} disabled={!selected} onClick={() => selected && getSceneBridge().post({ type: "color", id: selected.id, color })} />)}<p>选择对象后点击材质颜色应用</p></div> :
      <div className="scene-tree-content text-xs" role="tree" ref={treeRef}>{data.map((item) => renderRow(item, 0))}</div>}
    {selected && <div className="tree-selection-tools">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="sm" variant="ghost" aria-label="图层操作">⋯</Button>} />
        <DropdownMenuContent align="start" className="w-auto">
          <DropdownMenuItem onClick={copySelection}>复制</DropdownMenuItem>
          <DropdownMenuItem onClick={duplicateSelection}>复制副本</DropdownMenuItem>
          <DropdownMenuItem onClick={()=>getSceneBridge().post({type:"group",ids:selection()})}>合并到分组</DropdownMenuItem>
          <DropdownMenuItem onClick={()=>getSceneBridge().post({type:"ungroup",ids:selection()})}>取消分组</DropdownMenuItem>
          <DropdownMenuItem onClick={()=>focusSelection()}>定位对象</DropdownMenuItem>
          <DropdownMenuItem onClick={()=>deleteSelection()}>删除选中</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip><TooltipTrigger render={<Button size="sm" variant="ghost" aria-label="切换对象可见性" onClick={() => getSceneBridge().post({ type: "toggleVisible", id: selected.id })} />}>{selected.visible ? <PreviewOpen /> : <PreviewClose />}</TooltipTrigger><TooltipContent>{selected.visible ? "隐藏" : "显示"}</TooltipContent></Tooltip>
      <Tooltip><TooltipTrigger render={<Button size="sm" variant="ghost" aria-label="切换对象锁定" onClick={() => getSceneBridge().post({ type: "toggleLocked", id: selected.id })} />}>{selected.locked ? <Lock /> : <Unlock />}</TooltipTrigger><TooltipContent>{selected.locked ? "解锁" : "锁定"}</TooltipContent></Tooltip>
      <Tooltip><TooltipTrigger render={<Button size="sm" variant="ghost" disabled={selected.locked} aria-label="删除选中对象" onClick={() => deleteSceneObject(selected.id)} />}><Delete /></TooltipTrigger><TooltipContent>{selected.locked ? "请先解锁对象" : "删除对象（可撤销）"}</TooltipContent></Tooltip>
    </div>}
    <Dialog open={Boolean(rename)} onOpenChange={(open) => { if (!open) setRename(null); }}>
      <DialogContent className="sm:max-w-[360px]!">
        <DialogHeader><DialogTitle>重命名对象</DialogTitle></DialogHeader>
        <Input value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus aria-label="对象名称" />
        <DialogFooter>
          <Button variant="outline" onClick={() => setRename(null)}>取消</Button>
          <Button onClick={() => {
            if (rename && draft.trim()) getSceneBridge().post({ type: "rename", id: rename.id, name: draft.trim() }); setRename(null);
          }}>确定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
