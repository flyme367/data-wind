import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Semi React 19 适配：必须位于任何 Semi 组件 import 之前
// https://semi.design/zh-CN/ecosystem/react19
import "@douyinfe/semi-ui/react19-adapter";
import "@icon-park/react/styles/index.css";
/* 顺序关键：semi-layer 必须在 tailwind.css 与任何 Semi 组件 import 之前 */
import "./styles/semi-layer.css";
import "./styles/tailwind.css";
import "./styles/app.css";
import App from "./App";
import { initProjectStore } from "./state/projectStore";

// 项目存储（IndexedDB + FlatBuffers 快照）先预热缓存并迁移 legacy 数据；
// 初始化失败（隐私模式/配额等）自动回退 projects.ts 的 legacy localStorage 路径。
const root = createRoot(document.getElementById("root")!);
initProjectStore()
  .catch((error: unknown) => console.warn("[projectStore] 初始化失败，回退 localStorage", error))
  .finally(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
