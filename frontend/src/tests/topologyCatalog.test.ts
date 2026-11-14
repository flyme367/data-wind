import { describe, expect, it } from "vitest";
import { handle } from "../workers/sceneModel";
import { widgetNode } from "../data/editor";
import { topologyCatalog, topologyCategories, usedTopologyCategories } from "../data/topologyCatalog";
const open=()=>handle({type:"openProject",projectId:"topology",tree:[],template:"empty"})!;

describe("山海鲸拓扑分类",()=>{
  it("目录含拓扑图且 chips 完整",()=>{
    expect(topologyCatalog.length).toBeGreaterThan(0);
    expect(topologyCatalog.every(e=>e.kind==="topology"&&e.label)).toBe(true);
    expect(topologyCategories[0]).toBe("全部");
    expect(usedTopologyCategories).toContain("默认拓扑");
  });
  it("预设带节点与连线数据，插入后保留完整配置",()=>{
    open();
    const node=widgetNode("topology");
    const data=node.data as {nodes?:{id:string;x:number;y:number}[];edges?:{from:string;to:string}[]};
    expect((data.nodes?.length ?? 0)).toBeGreaterThan(2);
    expect((data.edges?.length ?? 0)).toBeGreaterThan(2);
    // 边引用的节点 id 必须存在
    const ids=new Set((data.nodes??[]).map(n=>n.id));
    expect((data.edges??[]).every(e=>ids.has(e.from)&&ids.has(e.to))).toBe(true);
    const added=handle({type:"add",node})!;
    expect(added.tree[0].widget!.kind).toBe("topology");
    expect((added.tree[0].data as {nodes:unknown[]}).nodes.length).toBe((data.nodes??[]).length);
  });
});

import { topologyAutoLayout } from "../data/editor";

describe("拓扑自动布局", () => {
  it("按连线 BFS 分层并水平均分", () => {
    const nodes = [
      { id: "a", name: "A", x: 0, y: 0 }, { id: "b", name: "B", x: 9, y: 9 },
      { id: "c", name: "C", x: 5, y: 5 }, { id: "d", name: "D", x: 1, y: 2 },
    ];
    const edges = [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "a", to: "d" }];
    const laid = topologyAutoLayout(nodes, edges, 520);
    // a 是唯一根 → 层 0；b/d 层 1；c 层 2；y 递增 110
    expect(laid.find(n => n.id === "a")!.y).toBe(40);
    expect(laid.find(n => n.id === "b")!.y).toBe(150);
    expect(laid.find(n => n.id === "c")!.y).toBe(260);
    // b、d 同层：均分 520/3 的槽位
    const bx = laid.find(n => n.id === "b")!.x, dx = laid.find(n => n.id === "d")!.x;
    expect(bx).toBe(Math.round(520 / 3 * 1 - 60));
    expect(dx).toBe(Math.round(520 / 3 * 2 - 60));
    // 成环/断开节点回退到后继层，不抛错
    expect(topologyAutoLayout(nodes, [{ from: "a", to: "a" }], 520).length).toBe(4);
  });
});
