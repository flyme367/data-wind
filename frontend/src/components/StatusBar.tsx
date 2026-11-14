import { Tag } from "@douyinfe/semi-ui";
import { useStore } from "../state/store";

export default function StatusBar() {
  const { stats, scene, selectedId, hud } = useStore();
  const selected = scene.find((n) => n.id === selectedId);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-[#E8EAF0] bg-white px-3 text-[11px] text-[#646A73]">
      <Tag size="small" color={stats.backend === "GPU" ? "green" : "grey"}>
        {stats.backend === "-" ? "引擎启动中…" : stats.backend}
      </Tag>
      <span>场景 · 数字孪生园区演示</span>
      <span>网格 {hud.grid ? "开" : "关"}</span>
      <span>飞线 {hud.flylines ? "开" : "关"}</span>

      <div className="ml-auto flex items-center gap-3">
        {selected && <span>选中: {selected.name}</span>}
        <span>FPS {stats.fps}</span>
        <span>
          实例 {stats.visible}/{stats.instances}
        </span>
        <span>粒子 {stats.particles}</span>
        <span>三角面 {stats.tris}</span>
      </div>
    </footer>
  );
}
