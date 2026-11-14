import { fileURLToPath } from "node:url";
import { version } from "./package.json" with { type: "json" };
import { defineConfig, type Plugin } from "vite";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** 智慧园区 demo 的本地模拟数据源:随机游走让指标/图表像真实传感数据一样缓慢变化(仅 dev)。 */
function parkMockPlugin(): Plugin {
  const walk = (value: number, step: number, min: number, max: number) =>
    Math.round(Math.min(max, Math.max(min, value + (Math.random() - .5) * 2 * step)) * 10) / 10;
  const state = { people: 1246, output: 862, devices: 128, warnings: 9 };
  const energy = Array.from({ length: 12 }, (_, i) =>
    ({ name: `${String(8 + i).padStart(2, "0")}:00`, value: 320 + Math.round(180 * Math.sin(i / 2.4) + 90 * Math.sin(i / 5)) }));
  const traffic = Array.from({ length: 8 }, (_, i) =>
    ({ name: `${String(8 + i).padStart(2, "0")}:00`, value: 40 + Math.round(50 * Math.sin(i / 2.6) + 30 * ((i * 7) % 5)) }));
  const security = {
    columns: ["时间", "区域", "事件"],
    rows: [["10:21", "南大门", "人员翻越预警"], ["09:58", "生产区", "温感报警恢复"], ["09:36", "物流区", "货车超速提醒"], ["09:12", "数据中芯", "门禁异常闯入"], ["08:47", "办公区", "消防通道占用"]],
  };
  const alarms = ["10:21 南大门 · 人员翻越预警", "10:07 生产区B · 温感报警恢复", "09:58 物流区 · 货车超速提醒", "09:36 数据中芯 · 门禁异常闯入", "09:12 办公区 · 消防通道占用"];
  return {
    name: "park-mock-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0]!;
        const send = (data: unknown) => {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(data));
        };
        switch (url) {
          case "/api/park/overview":
            state.people = walk(state.people, 8, 1100, 1400);
            state.output = walk(state.output, 2.4, 820, 910);
            return send({ people: state.people, output: state.output });
          case "/api/park/energy":
            for (const [index, row] of energy.entries()) energy[index] = { name: row.name, value: walk(row.value, 26, 160, 780) };
            return send(energy);
          case "/api/park/devices":
            state.devices = walk(state.devices, 2, 120, 134);
            state.warnings = walk(state.warnings, 1.4, 4, 16);
            return send([
              { name: "运行", value: state.devices },
              { name: "预警", value: state.warnings },
              { name: "离线", value: walk(4, 1, 2, 8) },
              { name: "检修", value: walk(3, 1, 1, 6) },
            ]);
          case "/api/park/traffic":
            for (const [index, row] of traffic.entries()) traffic[index] = { name: row.name, value: walk(row.value, 9, 12, 160) };
            return send(traffic);
          case "/api/park/security": return send(security);
          case "/api/park/alarms": return send(alarms);
          default: return next();
        }
      });
    },
  };
}

// 双入口 MPA：index.html = 编辑器（React + Semi）；viewer.html = 发布成品（零框架，只含画面代码）
export default defineConfig({
  // Relative runtime assets keep an exported viewer portable under a subdirectory.
  base: "./",
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  // 底部状态栏展示的应用版本（来自 package.json，编译期内联）
  define: { __DW_VERSION__: JSON.stringify(version) },
  plugins: [react(), tailwindcss(), parkMockPlugin()],
  server: {
    port: 5173,
    host: "127.0.0.1",
    strictPort: true,
    // Rayon / SharedArrayBuffer：跨源隔离；普通静态部署由加载器回退到单线程。
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    port: 4173,
    host: "127.0.0.1",
    // 生产构建预览（pnpm preview）沿用相同的跨源隔离要求
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  worker: {
    format: "es",
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        viewer: fileURLToPath(new URL("./viewer.html", import.meta.url)),
      },
    },
  },
});
