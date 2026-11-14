import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Toast } from "@/lib/toast";
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, Box, CirclePlus, ClipboardPaste, Copy, Eye, EyeOff,
  FolderInput, Group, Layers, Lock, LockOpen, Merge, MousePointerClick, Paintbrush, PaintBucket, PenLine,
  RotateCw, Settings, Trash2, Ungroup } from "lucide-react";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import { useContextMenu } from "../state/contextMenu";
import { getSceneBridge } from "../workers/bridge";
import { getState } from "../state/store";
import { BACKGROUND_BOARD_PAGE_ID, FOREGROUND_BOARD_PAGE_ID, descendants, selectionRoots } from "../data/editor";
import { modelAssetById } from "../data/modelCatalog";
import { copyInteractions, copyNodesToClipboard, copyStyle, deleteSelection, hasInteractionClipboard,
  hasNodeClipboard, hasStyleClipboard, pasteInteractions, pasteSelection, pasteStyle, selectAll } from "../state/sceneActions";
import { saveUserAsset } from "../state/userAssets";
import type { SceneNode } from "../types";

const ic = (node: ReactNode) => <span className="dw-context-icon">{node}</span>;

/** root（虚拟根/固定分层）菜单动作：由 WorkspacePage 接线（子看板管理、3D 编辑切换、root 抽屉选中） */
export interface RootMenuActions {
  openRoot: (id: "@board" | "@scene") => void;
  edit3D: () => void;
  renamePage: (pageId?: string) => void;
  addPage: (duplicateCurrent: boolean) => void;
  deletePage: (pageId?: string) => void;
  canDeletePage: boolean;
}

const isPlantNode = (n: SceneNode) => modelAssetById.get(n.modelId ?? "")?.category.startsWith("植被") ?? false;

/** 3D 固定分层的成员节点 ids（与 LeftPanel 树的分桶过滤保持一致；@sky/@shapes 由场景设置与素材库配置，树中恒为空） */
export function layerBucketIds(scene: SceneNode[], key: string): string[] {
  const roots = scene.filter((n) => !scene.some((p) => p.id === n.parentId));
  const of = (predicate: (n: SceneNode) => boolean) => roots.filter(predicate).map((n) => n.id);
  switch (key) {
    case "@camera": return of((n) => n.type === "camera");
    case "@plants": return of(isPlantNode);
    case "@terrain": return of((n) => n.type === "terrain" || n.type === "water");
    case "@markers": return of((n) => ["marker", "flyline", "fence"].includes(n.type));
    case "@lights": return of((n) => n.type === "light");
    case "@models": {
      const widgetFree = (n: SceneNode) => !scene.some((w) => w.type === "widget" && descendants(scene, [n.id]).has(w.id));
      return of((n) => (n.type === "model" || n.type === "group") && !isPlantNode(n) && widgetFree(n));
    }
    default: return [];
  }
}

/** root 节点专属菜单（与子节点菜单 buildSceneContextMenu 有意不同）：页面/场景设置、子大屏管理、整层操作 */
export function buildRootContextMenu(targetId: string, actions: RootMenuActions | undefined): ContextMenuItem[] {
  const bridge = getSceneBridge();
  const { scene, settings, boardLayer } = getState();
  // 底栏子看板页签右键（山海鲸 4.7.13 实测仅两项）：重命名 / 删除
  if (targetId.startsWith("@pagetab:")) {
    const pageId = targetId.slice("@pagetab:".length);
    const page = settings.boardPages.find((item) => item.id === pageId);
    if (!page) return [];
    return [
      { type: "item", key: "rename-tab", label: "重命名", icon: ic(<PenLine size={15} />), action: () => actions?.renamePage(pageId) },
      { type: "item", key: "delete-tab", label: "删除", icon: ic(<Trash2 size={15} />), disabled: settings.boardPages.length <= 1, action: () => actions?.deletePage(pageId) },
    ];
  }
  if (targetId === "@twin") return [{ type: "item", key: "enter-3d", label: "进入 3D 编辑", icon: ic(<Box size={15} />), action: () => actions?.edit3D() }];
  if (targetId === "@board") {
    // 背景/前景是独立保留看板：重命名/增删的是子看板而非保留层，语义不匹配 → 隐藏页面管理项；全选按当前层取域（与图层树过滤一致）
    const isBackground = boardLayer === "background";
    const isForeground = boardLayer === "foreground";
    const layerWidgetIds = scene.filter((n) => n.type === "widget" && (isBackground
      ? n.boardPageId === BACKGROUND_BOARD_PAGE_ID
      : isForeground ? n.boardPageId === FOREGROUND_BOARD_PAGE_ID
      : !n.boardPageId || n.boardPageId === settings.boardActivePageId)).map((n) => n.id);
    return [
      { type: "item", key: "page-settings", label: "页面设置", icon: ic(<Settings size={15} />), action: () => actions?.openRoot("@board") },
      { type: "sep", key: "sep-page" },
      ...(isBackground || isForeground ? [] : [
        { type: "item" as const, key: "rename-page", label: "重命名子看板", icon: ic(<PenLine size={15} />), action: () => actions?.renamePage() },
        { type: "item" as const, key: "add-page", label: "添加空白子看板", icon: ic(<CirclePlus size={15} />), disabled: settings.boardPages.length >= 12, action: () => actions?.addPage(false) },
        { type: "item" as const, key: "duplicate-page", label: "复制当前子看板", icon: ic(<Copy size={15} />), disabled: settings.boardPages.length >= 12, action: () => actions?.addPage(true) },
        { type: "item" as const, key: "delete-page", label: "删除子看板", icon: ic(<Trash2 size={15} />), danger: true, disabled: !actions?.canDeletePage, action: () => actions?.deletePage() },
        { type: "sep" as const, key: "sep-select" },
      ]),
      { type: "item", key: "select-all", label: "全选组件", icon: ic(<Layers size={15} />), disabled: !layerWidgetIds.length, action: () => bridge.post({ type: "selectMany", ids: layerWidgetIds }) },
      { type: "item", key: "paste", label: "粘贴", icon: ic(<ClipboardPaste size={15} />), disabled: !hasNodeClipboard(), action: () => pasteSelection() },
    ];
  }
  if (targetId === "@scene") return [
    { type: "item", key: "scene-settings", label: "场景设置", icon: ic(<Settings size={15} />), action: () => actions?.openRoot("@scene") },
    { type: "sep", key: "sep-select" },
    { type: "item", key: "select-all", label: "全选对象", icon: ic(<Layers size={15} />), action: () => selectAll(true) },
    { type: "item", key: "paste", label: "粘贴", icon: ic(<ClipboardPaste size={15} />), disabled: !hasNodeClipboard(), action: () => pasteSelection() },
  ];
  if (targetId === "@sky" || targetId === "@shapes") {
    const bucketLabel = targetId === "@sky" ? "天空" : "形状";
    return [{ type: "item", key: `${targetId}-settings`, label: `${bucketLabel}设置`, icon: ic(<Settings size={15} />), action: () => actions?.openRoot("@scene") }];
  }
  const ids = layerBucketIds(scene, targetId);
  const allVisible = ids.length > 0 && ids.every((id) => scene.find((n) => n.id === id)?.visible !== false);
  return [
    { type: "item", key: "select-layer", label: "全选该层", icon: ic(<Layers size={15} />), disabled: !ids.length, action: () => bridge.post({ type: "selectMany", ids }) },
    { type: "item", key: "show-layer", label: "显示该层", icon: ic(<Eye size={15} />), disabled: !ids.length || allVisible, action: () => bridge.post({ type: "batch", action: "show", ids }) },
    { type: "item", key: "hide-layer", label: "隐藏该层", icon: ic(<EyeOff size={15} />), disabled: !ids.length || !allVisible, action: () => bridge.post({ type: "batch", action: "hide", ids }) },
  ];
}

/** 看板模式顶层可选项：根 widget 与包含 widget 的顶层分组 */
function widgetRoots(scene: SceneNode[]): { groups: SceneNode[]; widgets: SceneNode[] } {
  const roots = scene.filter((n) => !scene.some((p) => p.id === n.parentId));
  const hasWidget = (n: SceneNode) => n.type === "widget" || (n.type === "group" && scene.some((w) => w.type === "widget" && descendants(scene, [n.id]).has(w.id)));
  return { groups: roots.filter((n) => n.type === "group" && hasWidget(n)), widgets: roots.filter((n) => n.type === "widget") };
}

/** 依据右键目标构建菜单：虚拟根（@ 开头）走 root 专属菜单；目标已在多选中则作用于整个选中集合，否则临时单选目标 */
export function buildSceneContextMenu(targetId: string, openRename: (node: SceneNode) => void, rootActions?: RootMenuActions): ContextMenuItem[] {
  if (targetId.startsWith("@")) return buildRootContextMenu(targetId, rootActions);
  const { scene, selectedIds } = getState();
  const target = scene.find((n) => n.id === targetId);
  if (!target) return [];
  const ids = selectedIds.includes(targetId) && selectedIds.length > 1 ? [...selectedIds] : [targetId];
  const nodes = ids.map((id) => scene.find((n) => n.id === id)).filter((n): n is SceneNode => Boolean(n));
  if (!nodes.length) return [];
  const roots = selectionRoots(scene, ids);
  const covered = descendants(scene, ids);
  const bridge = getSceneBridge();
  const allVisible = nodes.every((n) => n.visible);
  const someLocked = nodes.some((n) => n.locked);
  const groups = scene.filter((n) => n.type === "group" && !covered.has(n.id));
  const ungroupIds = [...new Set(roots.flatMap((n) => n.type === "group" ? [n.id]
    : n.parentId && scene.find((p) => p.id === n.parentId)?.type === "group" ? [n.parentId] : []))];
  const layers = widgetRoots(scene);
  const selectLayer = (layerIds: string[]) => bridge.post({ type: "selectMany", ids: layerIds });
  const layerItems: ContextMenuItem[] = [
    ...(layers.widgets.length || layers.groups.length ? [{ type: "item" as const, key: "@all", label: "全部组件",
      action: () => selectLayer([...layers.widgets.map((n) => n.id), ...layers.groups.map((n) => n.id)]) }] : []),
    ...layers.groups.map((n) => ({ type: "item" as const, key: n.id, label: n.name, action: () => selectLayer([n.id]) })),
    ...layers.widgets.map((n) => ({ type: "item" as const, key: n.id, label: n.name, action: () => selectLayer([n.id]) })),
  ];
  const items: ContextMenuItem[] = [];
  if (nodes.some((n) => n.dataSource?.enabled)) items.push({ type: "item", key: "reload", label: "重新加载", icon: ic(<RotateCw size={15} />),
    action: () => { for (const n of nodes) if (n.dataSource?.enabled) window.dispatchEvent(new CustomEvent("dw:refresh-data", { detail: { id: n.id } })); Toast.success("已重新加载数据"); } });
  items.push(
    { type: "item", key: "rename", label: "重命名", icon: ic(<PenLine size={15} />), disabled: ids.length > 1 || target.locked, action: () => openRename(target) },
    { type: "item", key: "delete", label: "删除", icon: ic(<Trash2 size={15} />), action: () => deleteSelection(ids) },
    { type: "item", key: "visible", label: allVisible ? "隐藏" : "显示", icon: ic(allVisible ? <EyeOff size={15} /> : <Eye size={15} />),
      action: () => bridge.post({ type: "batch", action: allVisible ? "hide" : "show", ids }) },
    { type: "item", key: "lock", label: someLocked ? "解锁" : "锁定", icon: ic(someLocked ? <LockOpen size={15} /> : <Lock size={15} />),
      action: () => bridge.post({ type: "batch", action: someLocked ? "unlock" : "lock", ids }) },
    { type: "sep", key: "sep-copy" },
    { type: "item", key: "copy", label: "复制组件", icon: ic(<Copy size={15} />), action: () => copyNodesToClipboard(ids) },
    { type: "item", key: "copy-interactions", label: "复制交互", icon: ic(<MousePointerClick size={15} />), disabled: !target.interactions?.length, action: () => copyInteractions(targetId) },
  );
  if (hasInteractionClipboard()) items.push({ type: "item", key: "paste-interactions", label: "粘贴交互", icon: ic(<ClipboardPaste size={15} />), action: () => pasteInteractions(ids) });
  items.push({ type: "item", key: "copy-style", label: "复制样式", icon: ic(<Paintbrush size={15} />), disabled: !target.widget, action: () => copyStyle(targetId) });
  if (hasStyleClipboard()) items.push({ type: "item", key: "paste-style", label: "粘贴样式", icon: ic(<PaintBucket size={15} />), action: () => pasteStyle(ids) });
  items.push(
    { type: "item", key: "save-asset", label: "添加到资产库", icon: ic(<CirclePlus size={15} />),
      action: () => { saveUserAsset(target.name, scene, roots.map((n) => n.id)); Toast.success("已添加到资产库"); } },
    { type: "sep", key: "sep-group" },
    { type: "item", key: "group", label: "成组", icon: ic(<Group size={15} />),
      disabled: roots.length < 2 || (roots.some((n) => n.type === "widget") && !roots.every((n) => n.type === "widget")),
      action: () => bridge.post({ type: "group", ids }) },
    { type: "sub", key: "move-into-group", label: "移入到分组", icon: ic(<FolderInput size={15} />), disabled: !groups.length, items: [
      ...groups.map((n) => ({ type: "item" as const, key: n.id, label: n.name, action: () => bridge.post({ type: "reparent", ids, parentId: n.id }) })),
      { type: "item" as const, key: "@root", label: "根层级", action: () => bridge.post({ type: "reparent", ids, parentId: null }) },
    ] },
    { type: "sub", key: "merge-into-group", label: "合并到分组", icon: ic(<Merge size={15} />), disabled: !groups.length,
      items: groups.map((n) => ({ type: "item" as const, key: n.id, label: n.name, action: () => bridge.post({ type: "group", ids: [...ids, n.id] }) })) },
    { type: "item", key: "ungroup", label: "取消分组", icon: ic(<Ungroup size={15} />), disabled: !ungroupIds.length, action: () => bridge.post({ type: "ungroup", ids: ungroupIds }) },
    { type: "sep", key: "sep-layer" },
    { type: "sub", key: "select-layer", label: "选择图层", icon: ic(<Layers size={15} />), disabled: !layerItems.length, items: layerItems },
    { type: "item", key: "front", label: "置于顶层", icon: ic(<ArrowUpToLine size={15} />), action: () => bridge.post({ type: "reorder", ids, direction: "front" }) },
    { type: "item", key: "back", label: "置于底层", icon: ic(<ArrowDownToLine size={15} />), action: () => bridge.post({ type: "reorder", ids, direction: "back" }) },
    { type: "item", key: "forward", label: "上移一层", icon: ic(<ArrowUp size={15} />), action: () => bridge.post({ type: "reorder", ids, direction: "forward" }) },
    { type: "item", key: "backward", label: "下移一层", icon: ic(<ArrowDown size={15} />), action: () => bridge.post({ type: "reorder", ids, direction: "backward" }) },
  );
  return items;
}

/** 右键菜单宿主：挂载一次，负责构建菜单项（图层树与画布共用）与重命名弹窗 */
export default function SceneContextMenuHost({ rootActions }: { rootActions?: RootMenuActions }) {
  const menu = useContextMenu();
  const [rename, setRename] = useState<SceneNode | null>(null);
  const [draft, setDraft] = useState("");
  const openRename = (node: SceneNode) => { setRename(node); setDraft(node.name); };
  return <>
    {menu && <ContextMenu key={menu.session} x={menu.x} y={menu.y} items={buildSceneContextMenu(menu.targetId, openRename, rootActions)} />}
    <Dialog open={Boolean(rename)} onOpenChange={(open) => { if (!open) setRename(null); }}>
      <DialogContent className="sm:max-w-[360px]!">
        <DialogHeader><DialogTitle>重命名组件</DialogTitle></DialogHeader>
        <Input value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus aria-label="组件名称" />
        <DialogFooter>
          <Button variant="outline" onClick={() => setRename(null)}>取消</Button>
          <Button onClick={() => { if (rename && draft.trim()) getSceneBridge().post({ type: "rename", id: rename.id, name: draft.trim() }); setRename(null); }}>确定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
