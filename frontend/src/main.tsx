import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@icon-park/react/styles/index.css";
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
