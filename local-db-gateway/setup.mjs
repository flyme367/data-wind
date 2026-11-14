import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const path = process.env.DATA_WIND_DB_CONFIG || fileURLToPath(new URL("./config.json", import.meta.url));
const token = randomBytes(32).toString("hex");
const config = {
  token,
  allowedOrigins: ["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:4173", "http://localhost:4173"],
  profiles: [],
  webhooks: [],
};
try {
  await writeFile(path, JSON.stringify(config, null, 2), { mode: 0o600, flag: "wx" });
  console.log(`配置已创建：${path}\n请从该文件复制 token 到编辑器的数据连接面板。`);
} catch (error) {
  if (error?.code === "EEXIST") console.error(`配置已存在，未覆盖：${path}`);
  else console.error(error instanceof Error ? error.message : "创建配置失败");
  process.exitCode = 1;
}
