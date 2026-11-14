import { createServer } from "node:http";
import { readFile, writeFile, rename, unlink, chmod } from "node:fs/promises";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import pg from "pg";

const configPath = process.env.DATA_WIND_DB_CONFIG || fileURLToPath(new URL("./config.json", import.meta.url));
const port = Number(process.env.DATA_WIND_DB_PORT || 4319);
const MAX_BODY = 32_768;
const MAX_WEBHOOK_BODY = 1_000_000;
const MAX_RESULT = 1_000_000;
const webhookData = new Map();

export function validQuery(sql) {
  return typeof sql === "string" && sql.length <= 20_000 && /^\s*select\b/i.test(sql) &&
    !/[;\0]/.test(sql) && !/--|\/\*|\*\//.test(sql) &&
    !/\bINTO\s+(?:OUTFILE|DUMPFILE)\b|\bLOAD_FILE\s*\(/i.test(sql);
}

function equalToken(expected, actual) {
  const a = Buffer.from(expected), b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readConfig() {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (typeof config.token !== "string" || config.token.length < 24 || !Array.isArray(config.allowedOrigins) ||
      !Array.isArray(config.profiles) || (config.webhooks !== undefined && !Array.isArray(config.webhooks))) throw new Error("本机数据库服务配置无效");
  config.webhooks ??= [];
  return config;
}

function validateProfile(profile) {
  if (!profile || typeof profile !== "object" || typeof profile.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(profile.id) ||
      typeof profile.name !== "string" || !profile.name.trim() || profile.name.length > 100 ||
      !["mysql", "postgres"].includes(profile.type) || typeof profile.host !== "string" || !profile.host.trim() || profile.host.length > 255 ||
      !Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535 ||
      typeof profile.user !== "string" || !profile.user || profile.user.length > 255 ||
      typeof profile.password !== "string" || profile.password.length > 4096 ||
      typeof profile.database !== "string" || !profile.database || profile.database.length > 255 || typeof profile.ssl !== "boolean") {
    throw new Error("数据库连接配置无效");
  }
  return { id: profile.id, name: profile.name.trim(), type: profile.type, host: profile.host.trim(), port: profile.port,
    user: profile.user, password: profile.password, database: profile.database, ssl: profile.ssl };
}

let configWrite = Promise.resolve();
function updateConfig(mutate) {
  const task = configWrite.then(async () => {
    const config = await readConfig();
    mutate(config);
    const temporary = `${configPath}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(config, null, 2), { mode: 0o600, flag: "wx" }); await rename(temporary, configPath); }
    finally { await unlink(temporary).catch(() => {}); }
  });
  configWrite = task.catch(() => {});
  return task;
}

function saveProfile(profile) {
  return updateConfig(({ profiles }) => {
    if (profiles.some((item) => item.id === profile.id)) throw new Error("连接标识已存在");
    if (profiles.length >= 50) throw new Error("最多保存 50 个连接");
    profiles.push(profile);
  });
}

function replaceProfile(profile) {
  return updateConfig(({ profiles }) => {
    const index = profiles.findIndex((item) => item.id === profile.id);
    if (index < 0) throw new Error("找不到要更新的数据库连接");
    const saved = profiles[index];
    profiles[index] = { ...profile, password: profile.password || saved.password };
  });
}

function removeProfile(id) {
  return updateConfig(({ profiles }) => {
    const index = profiles.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("找不到要删除的数据库连接");
    profiles.splice(index, 1);
  });
}

function publicProfile({ id, name, type, host, port, user, database, ssl }) {
  return { id, name, type, host, port, user, database, ssl };
}

function validateWebhook(value) {
  if (!value || typeof value !== "object" || typeof value.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.id) ||
      typeof value.name !== "string" || !value.name.trim() || value.name.length > 100 ||
      !["latest", "accumulate"].includes(value.mode) || !Number.isInteger(value.maxRows) || value.maxRows < 1 || value.maxRows > 5000) {
    throw new Error("Webhook 配置无效");
  }
  return { id: value.id, name: value.name.trim(), mode: value.mode, maxRows: value.maxRows };
}

function saveWebhook(webhook) {
  return updateConfig(({ webhooks }) => {
    if (webhooks.some((item) => item.id === webhook.id)) throw new Error("Webhook 标识已存在");
    if (webhooks.length >= 50) throw new Error("最多保存 50 个 Webhook");
    webhooks.push(webhook);
  });
}

function replaceWebhook(webhook) {
  let clearData = false;
  let trimTo = null;
  const update = updateConfig(({ webhooks }) => {
    const index = webhooks.findIndex((item) => item.id === webhook.id);
    if (index < 0) throw new Error("找不到要更新的 Webhook");
    const previous = webhooks[index];
    webhooks[index] = webhook;
    clearData = previous.mode !== webhook.mode;
    if (!clearData && webhook.maxRows < previous.maxRows) trimTo = webhook.maxRows;
  });
  return update.then(() => {
    if (clearData) webhookData.delete(webhook.id);
    else if (trimTo) {
      const rows = webhookData.get(webhook.id);
      if (rows) webhookData.set(webhook.id, rows.slice(-trimTo));
    }
  });
}

function removeWebhook(id) {
  return updateConfig(({ webhooks }) => {
    const index = webhooks.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("找不到要删除的 Webhook");
    webhooks.splice(index, 1);
  }).then(() => webhookData.delete(id));
}

function webhookRows(payload) {
  const records = Array.isArray(payload) ? payload : [payload];
  return records.map((value) => value && typeof value === "object" && !Array.isArray(value) ? value : { value });
}

async function readIncomingBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_WEBHOOK_BODY) throw new Error("Webhook 数据超过 1 MB");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const contentType = String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType === "application/json") return JSON.parse(text);
  if (contentType === "application/x-www-form-urlencoded") return Object.fromEntries(new URLSearchParams(text));
  throw new Error("Webhook 仅接受 JSON 或表单数据");
}

function receiveWebhook(webhook, payload) {
  const incoming = webhookRows(payload);
  if (!incoming.length) throw new Error("Webhook 数据不能为空");
  const existing = webhook.mode === "accumulate" ? webhookData.get(webhook.id) ?? [] : [];
  const rows = [...existing, ...incoming].slice(-webhook.maxRows);
  while (rows.length && Buffer.byteLength(JSON.stringify(rows)) > MAX_RESULT) rows.shift();
  if (!rows.length) throw new Error("Webhook 数据超过 1 MB，无法保留");
  webhookData.set(webhook.id, rows);
  return rows.length;
}

function webhookResult(webhook) {
  const rows = webhookData.get(webhook.id) ?? [];
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return { columns, rows: rows.map((row) => columns.map((column) => row[column] ?? null)) };
}

function publicWebhook(webhook, actualPort = port) {
  return { ...webhook, url: `http://127.0.0.1:${actualPort}/hook/${webhook.id}` };
}

function send(res, status, data) {
  const json = JSON.stringify(data, (_key, value) => typeof value === "bigint" ? value.toString() : value);
  if (Buffer.byteLength(json) > MAX_RESULT) return send(res, 413, { error: "结果超过 1 MB，请缩小查询范围" });
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(json);
}

async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function withConnection(profile, operation) {
  const common = { host: profile.host, port: profile.port, user: profile.user, password: profile.password,
    database: profile.database, ssl: profile.ssl ? { rejectUnauthorized: true } : undefined };
  if (profile.type === "postgres") {
    const client = new pg.Client({ ...common, connectionTimeoutMillis: 8000, statement_timeout: 10000 });
    try { await client.connect(); return await operation("postgres", client); } finally { await client.end().catch(() => {}); }
  }
  if (profile.type === "mysql") {
    const client = await mysql.createConnection({ ...common, connectTimeout: 8000, rowsAsArray: true,
      supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, multipleStatements: false });
    try { return await operation("mysql", client); } finally { await client.end().catch(() => {}); }
  }
  throw new Error("不支持的数据库类型");
}

export async function runQuery(profile, sql, connect = withConnection) {
  if (!validQuery(sql)) throw new Error("仅支持单条 SELECT 查询，不能包含注释或分号");
  return connect(profile, async (type, client) => {
    if (type === "postgres") {
      await client.query("BEGIN READ ONLY");
      try {
        const result = await client.query({ text: `SELECT * FROM (${sql}) AS dw_source LIMIT 1000`, rowMode: "array" });
        return { columns: result.fields.map((field) => field.name), rows: result.rows };
      } finally { await client.query("ROLLBACK").catch(() => {}); }
    }
    await client.query("SET TRANSACTION READ ONLY");
    await client.query("START TRANSACTION");
    try {
      const [rows, fields] = await client.query({ sql: `SELECT * FROM (${sql}) AS dw_source LIMIT 1000`, timeout: 10000 });
      return { columns: fields.map((field) => field.name), rows };
    } finally { await client.query("ROLLBACK").catch(() => {}); }
  });
}

async function listTables(profile) {
  return withConnection(profile, async (type, client) => {
    if (type === "postgres") {
      const result = await client.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name LIMIT 1000");
      return result.rows.map((row) => ({ schema: row.table_schema, name: row.table_name }));
    }
    const [rows] = await client.execute("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name LIMIT 1000", [profile.database]);
    return rows.map((row) => ({ schema: row[0], name: row[1] }));
  });
}

export function createGateway() {
  let server;
  server = createServer(async (req, res) => {
    try {
      const config = await readConfig();
      const origin = req.headers.origin;
      const incomingWebhook = /^\/hook\/([a-zA-Z0-9_-]{1,64})$/.exec(new URL(req.url || "/", "http://127.0.0.1").pathname);
      if (incomingWebhook) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
        if (req.method !== "POST") return send(res, 405, { error: "Webhook 仅接受 POST" });
        const webhook = config.webhooks.find((item) => item.id === incomingWebhook[1]);
        if (!webhook) return send(res, 404, { error: "Webhook 地址不存在" });
        const payload = await readIncomingBody(req);
        const stored = receiveWebhook(webhook, payload);
        return send(res, 202, { ok: true, accepted: webhookRows(payload).length, stored });
      }
      if (origin && !config.allowedOrigins.includes(origin)) return send(res, 403, { error: "来源不允许访问本机数据库服务" });
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      }
      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
      const token = (req.headers.authorization || "").replace(/^Bearer /i, "");
      if (!equalToken(config.token, token)) return send(res, 401, { error: "本机服务令牌无效" });
      if (req.method === "GET" && req.url === "/profiles") {
        return send(res, 200, { profiles: config.profiles.map(publicProfile) });
      }
      if (req.method === "GET" && req.url === "/webhooks") {
        const address = server.address();
        const actualPort = address && typeof address !== "string" ? address.port : port;
        return send(res, 200, { webhooks: config.webhooks.map((item) => publicWebhook(item, actualPort)) });
      }
      const profileRoutes = ["/profiles", "/test-connection", "/test", "/tables", "/query"];
      const webhookRoutes = ["/webhooks", "/webhooks/data"];
      if (![...profileRoutes, ...webhookRoutes].includes(req.url || "") || !["POST", "PUT", "DELETE"].includes(req.method || "")) return send(res, 404, { error: "接口不存在" });
      if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) return send(res, 415, { error: "需要 JSON 请求" });
      const body = await readBody(req);
      if (req.url === "/profiles" && req.method === "POST") { await saveProfile(validateProfile(body)); return send(res, 200, { ok: true }); }
      if (req.url === "/profiles" && req.method === "PUT") { await replaceProfile(validateProfile(body)); return send(res, 200, { ok: true }); }
      if (req.url === "/profiles" && req.method === "DELETE") {
        if (!body || typeof body.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(body.id)) throw new Error("数据库连接标识无效");
        await removeProfile(body.id);
        return send(res, 200, { ok: true });
      }
      if (req.url === "/webhooks" && req.method === "POST") { await saveWebhook(validateWebhook(body)); return send(res, 200, { ok: true }); }
      if (req.url === "/webhooks" && req.method === "PUT") { await replaceWebhook(validateWebhook(body)); return send(res, 200, { ok: true }); }
      if (req.url === "/webhooks" && req.method === "DELETE") {
        if (!body || typeof body.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(body.id)) throw new Error("Webhook 标识无效");
        await removeWebhook(body.id);
        return send(res, 200, { ok: true });
      }
      if (req.url === "/webhooks/data" && req.method === "POST") {
        if (!body || typeof body.id !== "string") throw new Error("Webhook 标识无效");
        const webhook = config.webhooks.find((item) => item.id === body.id);
        if (!webhook) return send(res, 404, { error: "Webhook 地址不存在" });
        return send(res, 200, webhookResult(webhook));
      }
      if (req.url === "/test-connection") {
        const profile = validateProfile(body);
        const saved = config.profiles.find((item) => item.id === profile.id);
        return send(res, 200, await runQuery({ ...profile, password: profile.password || saved?.password || "" }, "SELECT 1 AS connected"));
      }
      if (req.method !== "POST") return send(res, 404, { error: "接口不存在" });
      const profile = config.profiles.find((item) => item.id === body.profile);
      if (!profile) return send(res, 404, { error: "找不到数据库连接" });
      if (req.url === "/test") return send(res, 200, await runQuery(profile, "SELECT 1 AS connected"));
      if (req.url === "/tables") return send(res, 200, { tables: await listTables(profile) });
      return send(res, 200, await runQuery(profile, body.sql));
    } catch (error) {
      const message = error instanceof Error ? error.message : "数据库连接失败";
      send(res, 400, { error: message.replace(/password\s*[=:]\s*\S+/gi, "password=<redacted>") });
    }
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口无效");
  await readConfig();
  await chmod(configPath, 0o600);
  createGateway().listen(port, "127.0.0.1", () => console.log(`本机数据库服务已启动：http://127.0.0.1:${port}`));
}
