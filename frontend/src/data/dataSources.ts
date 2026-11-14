import { dataAt } from "./editor";
import { databaseGatewayUrl } from "./localDatabase";

export type DataSourceKind = "api" | "websocket" | "socketio" | "message" | "database" | "webhook";

/** 山海鲸「数据条件」：对 rows 数组按字段过滤（响应路径归一化后应用）。 */
export type DataFilterOp = "==" | "!=" | ">" | "<" | ">=" | "<=" | "contains";
export interface DataFilter {
  field: string;
  op: DataFilterOp;
  value: string;
}
export const DATA_FILTER_OPS: DataFilterOp[] = ["==", "!=", ">", "<", ">=", "<=", "contains"];

export function sanitizeDataFilter(value: unknown): DataFilter | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as DataFilter;
  if (typeof candidate.field !== "string" || !candidate.field.trim() || candidate.field.length > 100 ||
      /(__proto__|constructor|prototype)/.test(candidate.field)) return undefined;
  if (!DATA_FILTER_OPS.includes(candidate.op)) return undefined;
  if (typeof candidate.value !== "string" || candidate.value.length > 300) return undefined;
  return { field: candidate.field.trim(), op: candidate.op, value: candidate.value };
}

/** 只过滤 rows 数组；其余数据结构原样保留。 */
export function applyDataFilter(data: Record<string, unknown>, filter: DataFilter | undefined): Record<string, unknown> {
  if (!filter || !Array.isArray(data.rows)) return data;
  const numeric = (input: unknown): number | null => {
    const parsed = typeof input === "number" ? input : typeof input === "string" && input.trim() !== "" ? Number(input) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  };
  const rows = (data.rows as unknown[]).filter((row) => {
    const actual = dataAt(row && typeof row === "object" ? row as Record<string, unknown> : { value: row }, filter.field);
    switch (filter.op) {
      case "==": return String(actual) === filter.value || (numeric(actual) !== null && numeric(actual) === numeric(filter.value));
      case "!=": return !(String(actual) === filter.value || (numeric(actual) !== null && numeric(actual) === numeric(filter.value)));
      case "contains": return String(actual ?? "").includes(filter.value);
      default: {
        const left = numeric(actual), right = numeric(filter.value);
        if (left === null || right === null) return false;
        return filter.op === ">" ? left > right : filter.op === "<" ? left < right : filter.op === ">=" ? left >= right : left <= right;
      }
    }
  });
  return { ...data, rows };
}

/** Saved configuration. Live responses are kept separately from the project. */
export interface DataSourceConfig {
  kind: DataSourceKind;
  enabled: boolean;
  url: string;
  path: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body: string;
  intervalMs: number;
  database?: { profile: string; sql: string };
  /** 本机网关上的入站 Webhook；外部系统推送，网关端负责覆盖或累积数据。 */
  webhook?: { id: string; mode: "latest" | "accumulate"; maxRows: number };
  /** API 请求参数允许重复键，按填写顺序追加到地址。 */
  queryParams?: Array<{ key: string; value: string; enabled: boolean }>;
  variables?: Array<{ name: string; initialValue: string; currentValue?: string }>;
  auth?: { type: "none" } | { type: "bearer"; token: string } | { type: "basic"; username: string; password: string };
  /** Socket.IO namespace is in url; socketPath is the server's transport path. */
  socketEvent?: string;
  socketPath?: string;
  socketAuth?: Record<string, unknown>;
  /** 山海鲸「数据条件」：字段 + 操作符 + 比较值，作用于归一化后的 rows */
  filter?: DataFilter;
}

export type DataSourceState = "connecting" | "connected" | "error";
export interface DataSourceStatus {
  state: DataSourceState;
  message?: string;
  updatedAt?: number;
}

export const MAX_DATA_BYTES = 1_000_000;
export const DEFAULT_SOCKET_EVENT = "message";
export const DEFAULT_SOCKET_PATH = "/socket.io/";
const RESERVED_SOCKET_EVENTS = ["connect", "connect_error", "disconnect", "disconnecting", "newListener", "removeListener"];

export function defaultDataSource(kind: DataSourceKind = "api"): DataSourceConfig {
  return { kind, enabled: true, url: "", path: "", method: "GET", headers: {}, body: "", intervalMs: 5000 };
}

/** Resolve API variables at request time without mutating the saved configuration. */
export function resolveApiVariables(source: DataSourceConfig): DataSourceConfig {
  const variables = source.variables ?? [];
  if (!Array.isArray(variables) || variables.length > 50) throw new Error("变量最多支持 50 项");
  const values = new Map<string, string>();
  for (const variable of variables) {
    if (!variable || typeof variable.name !== "string" || !/^[\w.-]{1,100}$/.test(variable.name) || values.has(variable.name) ||
      typeof variable.initialValue !== "string" || (variable.currentValue !== undefined && typeof variable.currentValue !== "string") ||
      variable.initialValue.length > 4096 || (variable.currentValue?.length ?? 0) > 4096) throw new Error("变量名称或值无效，且名称不能重复");
    values.set(variable.name, variable.currentValue ?? variable.initialValue);
  }
  const replace = (value: string) => value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, name: string) => {
    if (!values.has(name)) throw new Error(`未定义变量：${name}`);
    return values.get(name)!;
  });
  const auth = source.auth;
  return { ...source, url: replace(source.url), body: replace(source.body),
    headers: Object.fromEntries(Object.entries(source.headers).map(([key, value]) => [key, typeof value === "string" ? replace(value) : value])),
    queryParams: Array.isArray(source.queryParams) ? source.queryParams.map((param) => param && (param.enabled === false ? param : { ...param,
      key: typeof param.key === "string" ? replace(param.key) : param.key,
      value: typeof param.value === "string" ? replace(param.value) : param.value })) : source.queryParams,
    auth: auth?.type === "bearer" && typeof auth.token === "string" ? { ...auth, token: replace(auth.token) }
      : auth?.type === "basic" && typeof auth.username === "string" && typeof auth.password === "string"
        ? { ...auth, username: replace(auth.username), password: replace(auth.password) } : auth };
}

export function validateDataSource(value: unknown): DataSourceConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("数据源配置无效");
  const original = value as DataSourceConfig;
  const source = original;
  if (!["api", "websocket", "socketio", "message", "database", "webhook"].includes(source.kind) || typeof source.enabled !== "boolean" ||
      typeof source.url !== "string" || !source.url.trim() || source.url.length > 2048 ||
      typeof source.path !== "string" || source.path.length > 300 ||
      !["GET", "POST"].includes(source.method) || typeof source.body !== "string" || source.body.length > 100_000 ||
      !Number.isInteger(source.intervalMs) || source.intervalMs < 0 || source.intervalMs > 3_600_000 ||
      (source.intervalMs > 0 && source.intervalMs < 1000) || !source.headers ||
      typeof source.headers !== "object" || Array.isArray(source.headers)) {
    throw new Error("数据源参数格式无效");
  }
  const resolved = source.kind === "api" ? resolveApiVariables(source) : source;
  if (resolved.body.length > 100_000) throw new Error("替换变量后的请求体不能超过 100 KB");
  const headers = Object.entries(resolved.headers);
  if (headers.length > 30 || headers.some(([key, item]) =>
    !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(key) || typeof item !== "string" || item.length > 4096 || /[\r\n]/.test(item))) {
    throw new Error("请求头必须是键值均为字符串的 JSON 对象");
  }
  let url: URL;
  try { url = new URL(resolved.url, globalThis.location?.href ?? "http://localhost/"); }
  catch { throw new Error("数据源地址无效"); }
  if (url.username || url.password) throw new Error("请勿在数据源地址中填写用户名或密码");
  if (source.kind === "database") {
    databaseGatewayUrl(source.url);
    if (!source.database || typeof source.database.profile !== "string" || !source.database.profile.trim() || source.database.profile.length > 128 ||
        typeof source.database.sql !== "string" || source.database.sql.length > 20_000 || !/^\s*select\b/i.test(source.database.sql) || /[;\0]|--|\/\*|\*\//.test(source.database.sql)) {
      throw new Error("请选择数据库连接并填写单条 SELECT 查询");
    }
  }
  if (source.kind === "webhook") {
    databaseGatewayUrl(source.url);
    if (!source.webhook || typeof source.webhook.id !== "string" || !/^[\w-]{1,64}$/.test(source.webhook.id) ||
        !["latest", "accumulate"].includes(source.webhook.mode) || !Number.isInteger(source.webhook.maxRows) ||
        source.webhook.maxRows < 1 || source.webhook.maxRows > 5000) {
      throw new Error("请选择有效的本机 Webhook 接收地址");
    }
  }
  if (source.kind === "api" && !["http:", "https:"].includes(url.protocol)) throw new Error("API 地址仅支持 HTTP 或 HTTPS");
  if (source.kind === "api") {
    if (resolved.queryParams !== undefined && (!Array.isArray(resolved.queryParams) || resolved.queryParams.length > 30 ||
      resolved.queryParams.some((item) => !item || typeof item.key !== "string" || (item.enabled && !item.key.trim()) || item.key.length > 300 ||
        typeof item.value !== "string" || item.value.length > 2000 || typeof item.enabled !== "boolean"))) {
      throw new Error("请求参数无效：最多 30 项，参数名不能为空");
    }
    const auth = resolved.auth;
    if (auth !== undefined) {
      if (!auth || typeof auth !== "object" || !["none", "bearer", "basic"].includes(auth.type)) throw new Error("认证配置无效");
      if (auth.type === "bearer" && (typeof auth.token !== "string" || !auth.token.trim() || auth.token.length > 4096 || /[\r\n]/.test(auth.token))) throw new Error("Bearer Token 无效");
      if (auth.type === "basic" && (typeof auth.username !== "string" || !auth.username || auth.username.length > 1024 || /[:\r\n]/.test(auth.username) ||
        typeof auth.password !== "string" || auth.password.length > 2048 || /[\r\n]/.test(auth.password))) throw new Error("Basic 认证信息无效");
      if (auth.type !== "none" && headers.some(([key]) => key.toLowerCase() === "authorization")) throw new Error("认证与请求头中的 Authorization 不能同时设置");
    }
    for (const param of resolved.queryParams ?? []) if (param.enabled) url.searchParams.append(param.key, param.value);
    if (url.href.length > 8192) throw new Error("请求地址及参数不能超过 8192 字符");
  }
  if (source.kind === "websocket" && !["ws:", "wss:"].includes(url.protocol)) throw new Error("WebSocket 地址须以 ws:// 或 wss:// 开头");
  if (source.kind === "socketio") {
    if (!["http:", "https:"].includes(url.protocol) || url.hash) throw new Error("Socket.IO 地址仅支持 HTTP 或 HTTPS，不能包含片段");
    const event = source.socketEvent ?? DEFAULT_SOCKET_EVENT;
    const path = source.socketPath ?? DEFAULT_SOCKET_PATH;
    if (typeof event !== "string" || !event.trim() || event !== event.trim() || event.length > 128 || RESERVED_SOCKET_EVENTS.includes(event)) {
      throw new Error("Socket.IO 事件名无效或为系统保留名称");
    }
    if (typeof path !== "string" || path.length > 300 || !/^\/(?!\/)[^?#\s]*$/.test(path)) {
      throw new Error("Socket.IO 传输路径须以 / 开头，且不能包含查询或片段");
    }
    const auth = source.socketAuth;
    if (auth !== undefined) {
      if (!auth || typeof auth !== "object" || Array.isArray(auth)) throw new Error("Socket.IO 认证信息须为 JSON 对象");
      try {
        if (JSON.stringify(auth).length > 4096) throw new Error();
      } catch { throw new Error("Socket.IO 认证信息无效或超过 4 KB"); }
    }
  }
  if (source.kind === "message" && (!/^https?:\/\//i.test(source.url) || !["http:", "https:"].includes(url.protocol) || url.pathname !== "/" || url.search || url.hash)) {
    throw new Error("消息来源须是完整的 HTTP/HTTPS 来源，例如 https://example.com");
  }
  return { ...source, ...(source.filter ? { filter: sanitizeDataFilter(source.filter) } : {}) };
}

/** Build the actual browser request without changing the saved source configuration. */
export function buildApiRequest(source: DataSourceConfig): { url: string; headers: Record<string, string> } {
  const config = resolveApiVariables(validateDataSource(source));
  if (config.kind !== "api") throw new Error("数据源不是 API");
  let url = config.url;
  if (config.queryParams?.some((item) => item.enabled)) {
    const parsed = new URL(url, globalThis.location?.href ?? "http://localhost/");
    for (const param of config.queryParams) if (param.enabled) parsed.searchParams.append(param.key, param.value);
    url = parsed.href;
  }
  const headers = { ...config.headers };
  if (config.auth?.type === "bearer") headers.Authorization = `Bearer ${config.auth.token}`;
  if (config.auth?.type === "basic") {
    const bytes = new TextEncoder().encode(`${config.auth.username}:${config.auth.password}`);
    headers.Authorization = `Basic ${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))}`;
  }
  return { url, headers };
}

/** Arrays become chart rows; primitive JSON values remain bindable at `value`. */
export function normalizeData(value: unknown, path = ""): Record<string, unknown> {
  const selected = path.trim() ? dataAt({ root: value }, `root.${path.trim()}`) : value;
  if (selected === undefined) throw new Error(`响应中未找到字段路径：${path}`);
  if (Array.isArray(selected)) return { rows: selected };
  if (selected && typeof selected === "object") return selected as Record<string, unknown>;
  return { value: selected };
}

/** Parse UTF-8 CSV/TSV, including quoted delimiters, double quotes, and multiline cells. */
function parseDelimitedData(text: string, delimiter: "," | "\t", format: "CSV" | "TSV"): Record<string, unknown> {
  if (new TextEncoder().encode(text).byteLength > MAX_DATA_BYTES) throw new Error("文件不能超过 1 MB");
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closedQuote = false;
  const finishField = () => { row.push(field); field = ""; closedQuote = false; };
  const finishRow = () => { finishField(); rows.push(row); row = []; };
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else field += char;
    } else if (char === '"' && !field && !closedQuote) quoted = true;
    else if (char === delimiter) finishField();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      finishRow();
    } else if (closedQuote) throw new Error(`${format} 引号后包含无效字符`);
    else if (char === '"') throw new Error(`${format} 引号格式无效`);
    else field += char;
  }
  if (quoted) throw new Error(`${format} 包含未闭合的引号`);
  if (field || row.length || closedQuote) finishRow();
  while (rows.length && rows.at(-1)!.every((cell) => cell === "")) rows.pop();
  if (!rows.length || rows.length > 5001) throw new Error(`${format} 需要表头，且最多支持 5000 行数据`);
  const headers = rows[0]!.map((item) => item.trim());
  if (headers.some((key) => !key || ["__proto__", "constructor", "prototype"].includes(key)) || new Set(headers).size !== headers.length) {
    throw new Error(`${format} 表头不能为空、重复或使用保留字段`);
  }
  return { columns: headers, rows: rows.slice(1).map((cells) => {
    if (cells.length !== headers.length) throw new Error(`${format} 数据列数与表头不一致`);
    return Object.fromEntries(headers.map((key, index) => [key, cells[index] ?? ""]));
  }) };
}

export function parseCsvData(text: string): Record<string, unknown> {
  return parseDelimitedData(text, ",", "CSV");
}

export function parseTsvData(text: string): Record<string, unknown> {
  return parseDelimitedData(text, "\t", "TSV");
}

export function parseDataFile(name: string, text: string): Record<string, unknown> {
  if (new TextEncoder().encode(text).byteLength > MAX_DATA_BYTES) throw new Error("文件不能超过 1 MB");
  if (/\.csv$/i.test(name)) return parseCsvData(text);
  if (/\.tsv$/i.test(name)) return parseTsvData(text);
  if (/\.json$/i.test(name)) {
    try { return normalizeData(JSON.parse(text)); }
    catch { throw new Error("JSON 文件格式无效"); }
  }
  throw new Error("请选择 JSON、CSV、TSV 或 XLSX 文件");
}
