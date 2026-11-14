import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SceneNode } from "../types";
import { getState } from "../state/store";

/** 预览态相机巡游条:列出场景中的相机机位,点击平滑飞往,支持 8 秒自动轮播。 */
export default function TourBar() {
  const cameras = getState().scene.filter((node) => node.type === "camera");
  const [active, setActive] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const camerasRef = useRef(cameras);
  camerasRef.current = cameras;
  const indexRef = useRef(0);
  const flyTo = (node: SceneNode, index: number) => {
    indexRef.current = index;
    setActive(node.id);
    window.dispatchEvent(new CustomEvent("dw:camera", { detail: { cameraNode: node } }));
  };
  useEffect(() => {
    // 进入预览自动飞到首个机位;稍等引擎/渲染循环就绪,避免起飞过早被异步初始化吞掉
    const timer = window.setTimeout(() => {
      if (camerasRef.current.length) flyTo(camerasRef.current[0]!, 0);
    }, 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => {
      const list = camerasRef.current;
      if (!list.length) return;
      flyTo(list[indexRef.current % list.length]!, indexRef.current % list.length);
      indexRef.current = (indexRef.current + 1) % list.length;
    }, 8000);
    return () => window.clearInterval(timer);
  }, [auto]);
  if (!cameras.length) return null;
  return (
    <div role="toolbar" aria-label="园区巡游" style={{ position: "absolute", left: "50%", bottom: 20, transform: "translateX(-50%)", zIndex: 30,
      display: "flex", gap: 8, alignItems: "center", padding: "8px 14px", borderRadius: 999,
      background: "rgba(10, 15, 30, .72)", border: "1px solid rgba(75, 169, 255, .35)", backdropFilter: "blur(8px)" }}>
      <span style={{ color: "#8FC7FF", fontSize: 12, letterSpacing: 2 }}>巡游</span>
      {cameras.map((node, index) => (
        <Button key={node.id} size="sm" variant={active === node.id ? "default" : "ghost"}
          onClick={() => flyTo(node, index)}>{node.name}</Button>
      ))}
      <Button size="sm" variant={auto ? "default" : "ghost"} aria-pressed={auto}
        onClick={() => { setAuto(!auto); if (!auto && cameras.length) flyTo(cameras[0]!, 0); }}>自动巡游</Button>
    </div>
  );
}
