export const DEFAULT_DB_GATEWAY = "http://127.0.0.1:4319";
const TOKEN_PREFIX = "dw-local-db-token:";

export function databaseGatewayUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("本机数据库服务地址无效"); }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) throw new Error("数据库服务地址须为本机 HTTP 来源");
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.origin;
}

export function databaseToken(url: string): string { return sessionStorage.getItem(TOKEN_PREFIX + databaseGatewayUrl(url)) ?? ""; }
export function setDatabaseToken(url: string, token: string): void {
  const key = TOKEN_PREFIX + databaseGatewayUrl(url);
  if (token) sessionStorage.setItem(key, token); else sessionStorage.removeItem(key);
}

export async function databaseRequest<T>(
  url: string,
  path: "/profiles" | "/test-connection" | "/test" | "/tables" | "/query" | "/webhooks" | "/webhooks/data",
  body?: unknown,
  signal?: AbortSignal,
  method?: "GET" | "POST" | "PUT" | "DELETE",
): Promise<T> {
  const origin = databaseGatewayUrl(url), token = databaseToken(origin);
  if (!token) { window.dispatchEvent(new CustomEvent("dw:database-token-required", { detail: { url: origin } })); throw new Error("请填写本机数据库服务令牌"); }
  const requestMethod = method ?? (body === undefined ? "GET" : "POST");
  const response = await fetch(origin + path, { method: requestMethod, mode: "cors", credentials: "omit",
    headers: { Authorization: `Bearer ${token}`, ...(requestMethod === "GET" ? {} : { "Content-Type": "application/json" }) },
    body: requestMethod === "GET" ? undefined : JSON.stringify(body ?? {}), signal });
  const result: unknown = await response.json();
  if (response.status === 401) window.dispatchEvent(new CustomEvent("dw:database-token-required", { detail: { url: origin } }));
  if (!response.ok) throw new Error(result && typeof result === "object" && "error" in result ? String(result.error) : `数据库服务错误（${response.status}）`);
  return result as T;
}

export function normalizeDatabaseRows(result: { columns: string[]; rows: unknown[][] }): Record<string, unknown> {
  if (!Array.isArray(result.columns) || !Array.isArray(result.rows) || result.columns.some((name) => typeof name !== "string" || !name || ["__proto__", "constructor", "prototype"].includes(name)) ||
      new Set(result.columns).size !== result.columns.length || result.rows.some((row) => !Array.isArray(row) || row.length !== result.columns.length)) {
    throw new Error("查询列名为空、重复或无效，请使用 SQL 别名");
  }
  return { columns: result.columns, rows: result.rows.map((row) => Object.fromEntries(result.columns.map((name, i) => [name, row[i]]))) };
}
