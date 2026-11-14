import type { SceneNode } from "../types";

/** 用户素材（右键「添加到资产库」保存），localStorage 全局持久化，与项目无关 */
export interface UserAsset {
  id: string;
  name: string;
  savedAt: number;
  /** 完整子树（选中根 + 后代），顶层 parentId 已置空 */
  tree: SceneNode[];
}

const KEY = "dw_user_assets";
export const USER_ASSETS_EVENT = "dw:user-assets";
const CHANGE_EVENT = USER_ASSETS_EVENT;

export function readUserAssets(): UserAsset[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is UserAsset =>
      Boolean(item) && typeof (item as UserAsset).id === "string" && Array.isArray((item as UserAsset).tree));
  } catch {
    return [];
  }
}

function writeUserAssets(assets: UserAsset[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(assets));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch (error) {
    throw error instanceof Error ? error : new Error("素材保存失败");
  }
}

/** 保存选中子树为素材：roots 取选中根，保存树之外的上层引用置空 */
export function saveUserAsset(name: string, tree: SceneNode[], roots: string[]): UserAsset {
  const covered = new Set<string>();
  const collect = (id: string) => {
    if (covered.has(id)) return;
    covered.add(id);
    for (const n of tree) if (n.parentId === id) collect(n.id);
  };
  roots.forEach(collect);
  const nodes = structuredClone(tree.filter((n) => covered.has(n.id)));
  const savedIds = new Set(nodes.map((n) => n.id));
  for (const n of nodes) if (n.parentId && !savedIds.has(n.parentId)) n.parentId = null;
  const asset: UserAsset = { id: `user-asset-${crypto.randomUUID()}`, name, savedAt: Date.now(), tree: nodes };
  writeUserAssets([asset, ...readUserAssets()].slice(0, 200));
  return asset;
}

export function deleteUserAsset(id: string): void {
  writeUserAssets(readUserAssets().filter((asset) => asset.id !== id));
}
