import type { AssetItem } from "../workers/assets.worker";

export interface AssetFolder {
  key: string;
  label: string;
  count: number;
  children: AssetFolder[];
}

const labels: Record<string, string> = {
  医疗: "医疗设备", 建筑: "建筑物", 交通: "交通工具", 家具: "家具装饰",
  人物: "人和动物", 设备: "设备", 植被: "植被", 环境: "环境",
};
/** 三级分类 chips 顺序（山海鲸 3D 编辑 4.7.13 实测：各栏目 chips 与其一致，缺内容时占位显示空状态） */
const childOrder: Record<string, string[]> = {
  建筑: ["住宅建筑", "商业建筑", "工厂建筑", "公共建筑", "公共设备", "构筑物", "其他建筑", "工业建筑"],
  植被: ["推荐", "风格化", "乔木", "草本植物", "灌木", "水生植物"],
  交通: ["中小型汽车", "工具类汽车", "货车", "特殊车辆", "飞行器", "船舶"],
  室外装饰: ["健身器材", "楼顶设施", "安防设施", "城市重型设备", "城市设施", "货物", "公园设施", "其他设施", "公共设备", "构件"],
  家具: ["家具", "运动器材"],
  设备: ["公共设施", "公共设备"],
  交通设施: ["路灯", "道路", "基础设施", "构筑物", "道路设施"],
  人物: ["人物", "鸟类", "鱼类", "家畜"],
  环境: ["地形", "岩石"],
  标绘: ["通用标记", "免费标记", "智慧园区", "智慧城市", "大场景标记", "智慧管廊", "主题标记", "浅色系"],
  材质: ["墙砖", "大理石", "地砖", "水磨石", "铺路石", "花岗岩"],
};
/** 「全部」视图按素材 rail 顺序分组（山海鲸 3D 编辑同款），库内前缀组按常用度排序 */
const order = ["模型", "GIS", "地表", "标绘", "材质", "动效", "场景",
  "医疗", "植被", "建筑", "交通", "室外装饰", "家具", "设备", "交通设施", "人物", "环境", "基础形状"];
const groupKey = (group: string) => `group:${encodeURIComponent(group)}`;
const childKey = (group: string, child: string) => `child:${encodeURIComponent(group)}:${encodeURIComponent(child)}`;

function parts(item: AssetItem, scoped: boolean): [string, string] {
  const [group, ...rest] = item.category.split(" / ");
  return scoped ? [group, rest.join(" / ")] : [item.library, item.category];
}

const inScope = (item: AssetItem, libraries: string[] | null) =>
  libraries === null || libraries.includes(item.library);

/** libraries 为 null 表示「全部」：文件夹按素材库分组；否则按素材分类的前缀分组 */
export function buildAssetFolders(items: AssetItem[], scope: string | string[] | null): AssetFolder[] {
  const libraries = typeof scope === "string" ? scope === "全部" ? null : [scope] : scope;
  const scoped = libraries !== null;
  const groups = new Map<string, { count: number; children: Map<string, number> }>();
  for (const item of items) {
    if (!inScope(item, libraries)) continue;
    const [group, child] = parts(item, scoped);
    const entry = groups.get(group) ?? { count: 0, children: new Map<string, number>() };
    entry.count += 1;
    if (child) entry.children.set(child, (entry.children.get(child) ?? 0) + 1);
    groups.set(group, entry);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    const aIndex = order.indexOf(a), bIndex = order.indexOf(b);
    return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex) || a.localeCompare(b, "zh-CN");
  }).map(([group, value]) => ({
    key: groupKey(group), label: labels[group] ?? group, count: value.count,
    children: [...value.children.entries()]
      .sort(([a], [b]) => {
        const rank = childOrder[group];
        if (rank) {
          const aIndex = rank.indexOf(a), bIndex = rank.indexOf(b);
          if ((aIndex < 0 ? 999 : aIndex) !== (bIndex < 0 ? 999 : bIndex))
            return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex);
        }
        return a.localeCompare(b, "zh-CN");
      })
      .map(([child, count]) => ({
        key: childKey(group, child), label: child, count, children: [],
      })),
  }));
}

export function matchesAssetFolder(item: AssetItem, scope: string | string[] | null, folder: string): boolean {
  if (folder.startsWith("static:")) return false; // 山海鲸占位栏目（暂无内容）
  const libraries = typeof scope === "string" ? scope === "全部" ? null : [scope] : scope;
  if (!inScope(item, libraries)) return false;
  if (folder === "all") return true;
  const [group, child] = parts(item, libraries !== null);
  return folder === groupKey(group) || folder === childKey(group, child);
}

/** 三级分类 chips：按山海鲸固定顺序输出全部子分类（含暂无内容的占位，count=0），多出的实有分类排在末尾 */
export function childChips(folder: AssetFolder): AssetFolder[] {
  const group = decodeURIComponent(folder.key.startsWith("group:") ? folder.key.slice("group:".length) : "");
  const rank = childOrder[group];
  if (!rank) return folder.children;
  const byLabel = new Map(folder.children.map((child) => [child.label, child]));
  const merged = rank.map((label) => byLabel.get(label)
    ?? { key: childKey(group, label), label, count: 0, children: [] });
  const extras = folder.children.filter((child) => !rank.includes(child.label));
  return [...merged, ...extras];
}
