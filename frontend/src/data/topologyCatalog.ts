import type { WidgetKind } from "./editor";

export interface TopologyCatalogEntry {
  kind: WidgetKind;
  label: string;
  category: string;
}

/** 山海鲸「拓扑」分类的 chips，顺序即展示顺序，「全部」始终在首位。 */
export const topologyCategories = ["全部", "默认拓扑"] as const;

/** 山海鲸「拓扑」分类：拓扑图组件（节点连线图）。节点与连线数据存于 data.nodes / data.edges，
 *  节点坐标为组件内的像素偏移；渲染由 Rust 引擎实现（board/widgets.rs "topology" 分支）。 */
export const topologyCatalog: TopologyCatalogEntry[] = [
  { kind: "topology", label: "拓扑图", category: "默认拓扑" },
];

/** 有素材的分类才会显示对应 chip。 */
export const usedTopologyCategories = topologyCategories.filter((category) =>
  category === "全部" || topologyCatalog.some((entry) => entry.category === category));
