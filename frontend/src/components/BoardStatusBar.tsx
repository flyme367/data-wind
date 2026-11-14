import { useEffect, useState } from "react";
import { useStore } from "../state/store";

/** Chromium 专有的 performance.memory（Safari / Firefox 无此 API，内存显示 "-"）。 */
interface ChromeMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

const toMb = (bytes: number) => Math.round(bytes / 1048576);

/** 底栏右段（对齐山海鲸 4.7.13 位置）：内存 / FPS / 组件数 / 渲染后端。 */
export default function BoardStatusBar() {
  const { stats, scene } = useStore();
  const [memory, setMemory] = useState("-");
  useEffect(() => {
    const tick = () => {
      const m = (performance as Performance & { memory?: ChromeMemory }).memory;
      setMemory(m ? `${toMb(m.usedJSHeapSize)} / ${toMb(m.totalJSHeapSize)} / ${toMb(m.jsHeapSizeLimit)} MB` : "-");
    };
    tick();
    const timer = window.setInterval(tick, 2000);
    return () => window.clearInterval(timer);
  }, []);
  const widgets = scene.filter((n) => n.type === "widget");
  const visibleWidgets = widgets.filter((n) => n.visible).length;
  return (
    <div className="board-statusbar" aria-label="性能状态栏">
      <div className="board-statusbar-row">
        <span>内存： {memory}</span>
        <span>FPS：{Math.round(stats.fps)}</span>
      </div>
      <div className="board-statusbar-row">
        <span>组件数: {visibleWidgets} / {widgets.length}</span>
        <span>{stats.backend}</span>
      </div>
    </div>
  );
}
