import type { SceneNode } from "../types";
import { io, type Socket } from "socket.io-client";
import { databaseRequest, normalizeDatabaseRows } from "./localDatabase";
import { DEFAULT_SOCKET_EVENT, DEFAULT_SOCKET_PATH, MAX_DATA_BYTES, applyDataFilter, buildApiRequest, normalizeData, resolveApiVariables, validateDataSource, type DataSourceConfig, type DataSourceStatus } from "./dataSources";

export interface LiveDataUpdate {
  id: string;
  status?: DataSourceStatus;
  data?: Record<string, unknown>;
  clear?: boolean;
}

interface SyncSource {
  id: string;
  dataSource?: DataSourceConfig;
}

interface Connection {
  id: string;
  config: DataSourceConfig;
  signature: string;
  sequence: number;
  attempts: number;
  timer?: ReturnType<typeof setTimeout>;
  abort?: AbortController;
  socket?: WebSocket;
  socketIo?: Socket;
  listener?: (event: MessageEvent) => void;
}

async function readResponse(response: Response): Promise<string> {
  const size = Number(response.headers.get("content-length"));
  if (size > MAX_DATA_BYTES) throw new Error("响应数据超过 1 MB");
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_DATA_BYTES) throw new Error("响应数据超过 1 MB");
    return text;
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let total = 0, text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DATA_BYTES) { await reader.cancel(); throw new Error("响应数据超过 1 MB"); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

/** Owns per-object connections and cancels them on configuration change or disposal. */
export class LiveDataManager {
  private readonly active = new Map<string, Connection>();
  private disposed = false;

  constructor(private readonly notify: (update: LiveDataUpdate) => void) {}

  sync(scene: Array<Pick<SceneNode, "id" | "dataSource"> | SyncSource>): void {
    if (this.disposed) return;
    const desired = new Map(scene.filter((node) => node.dataSource?.enabled).map((node) => [node.id, node.dataSource!]));
    for (const [id, connection] of this.active) {
      const config = desired.get(id);
      if (!config || JSON.stringify(config) !== connection.signature) {
        this.stop(connection);
        this.active.delete(id);
        this.notify({ id, clear: true });
      }
    }
    for (const [id, source] of desired) {
      if (this.active.has(id)) continue;
      try {
        const config = validateDataSource(source);
        const connection: Connection = { id, config, signature: JSON.stringify(source), sequence: 0, attempts: 0 };
        this.active.set(id, connection);
        if (config.kind === "api" || config.kind === "database" || config.kind === "webhook") void this.request(connection);
        else if (config.kind === "websocket") this.connect(connection);
        else if (config.kind === "socketio") this.connectSocketIo(connection);
        else this.listen(connection);
      } catch (error) {
        this.notify({ id, status: { state: "error", message: error instanceof Error ? error.message : "数据源无效" } });
      }
    }
  }

  refresh(id?: string): void {
    for (const connection of this.active.values()) {
      if (id && connection.id !== id) continue;
      if (connection.config.kind === "api" || connection.config.kind === "database" || connection.config.kind === "webhook") {
        if (connection.timer) clearTimeout(connection.timer);
        connection.abort?.abort();
        void this.request(connection);
      } else if (connection.config.kind === "websocket") {
        if (connection.timer) clearTimeout(connection.timer);
        if (connection.socket) {
          connection.socket.onopen = connection.socket.onmessage = connection.socket.onerror = connection.socket.onclose = null;
          connection.socket.close();
        }
        this.connect(connection);
      } else if (connection.config.kind === "socketio") {
        this.closeSocketIo(connection);
        this.connectSocketIo(connection);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const connection of this.active.values()) this.stop(connection);
    this.active.clear();
  }

  private current(connection: Connection, sequence?: number): boolean {
    return !this.disposed && this.active.get(connection.id) === connection &&
      (sequence === undefined || connection.sequence === sequence);
  }

  private stop(connection: Connection): void {
    connection.sequence += 1;
    if (connection.timer) clearTimeout(connection.timer);
    connection.abort?.abort();
    if (connection.listener) window.removeEventListener("message", connection.listener);
    this.closeSocketIo(connection);
    if (connection.socket) {
      connection.socket.onopen = connection.socket.onmessage = connection.socket.onerror = connection.socket.onclose = null;
      connection.socket.close();
    }
  }

  private closeSocketIo(connection: Connection): void {
    if (!connection.socketIo) return;
    connection.socketIo.removeAllListeners();
    connection.socketIo.disconnect();
    connection.socketIo = undefined;
  }

  private emitJson(connection: Connection, text: string): void {
    if (new TextEncoder().encode(text).byteLength > MAX_DATA_BYTES) throw new Error("接收数据超过 1 MB");
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new Error("响应不是有效的 JSON"); }
    // 山海鲸「数据条件」：归一化后按配置过滤 rows
    const data = applyDataFilter(normalizeData(parsed, connection.config.path), connection.config.filter);
    this.notify({ id: connection.id, data, status: { state: "connected", updatedAt: Date.now() } });
  }

  private async request(connection: Connection): Promise<void> {
    if (!this.current(connection)) return;
    const sequence = ++connection.sequence, controller = new AbortController();
    connection.abort = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 10_000);
    this.notify({ id: connection.id, status: { state: "connecting", message: "正在请求数据" } });
    try {
      const config = connection.config;
      if (config.kind === "database") {
        const result = await databaseRequest<{ columns: string[]; rows: unknown[][] }>(config.url, "/query", config.database, controller.signal);
        if (this.current(connection, sequence)) this.notify({ id: connection.id, data: applyDataFilter(normalizeDatabaseRows(result), config.filter), status: { state: "connected", updatedAt: Date.now() } });
        return;
      }
      if (config.kind === "webhook") {
        const result = await databaseRequest<{ columns: string[]; rows: unknown[][] }>(config.url, "/webhooks/data", { id: config.webhook!.id }, controller.signal);
        if (this.current(connection, sequence)) this.notify({ id: connection.id, data: applyDataFilter(normalizeDatabaseRows(result), config.filter), status: { state: "connected", updatedAt: Date.now() } });
        return;
      }
      const request = buildApiRequest(config);
      const response = await fetch(request.url, { method: config.method, headers: request.headers,
        body: config.method === "POST" ? resolveApiVariables(config).body : undefined, mode: "cors", credentials: "omit", cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`);
      const text = await readResponse(response);
      if (this.current(connection, sequence)) this.emitJson(connection, text);
    } catch (error) {
      if (this.current(connection, sequence)) this.notify({ id: connection.id, status: {
        state: "error", message: timedOut ? "请求超时" : error instanceof TypeError ? "请求失败，请检查地址和服务端跨域设置" : error instanceof Error ? error.message : "请求失败",
      } });
    } finally {
      clearTimeout(timeout);
      if (this.current(connection, sequence)) {
        connection.abort = undefined;
        if (connection.config.intervalMs > 0) connection.timer = setTimeout(() => void this.request(connection), connection.config.intervalMs);
      }
    }
  }

  private connect(connection: Connection): void {
    if (!this.current(connection)) return;
    this.notify({ id: connection.id, status: { state: "connecting", message: "正在连接 WebSocket" } });
    let socket: WebSocket;
    try { socket = new WebSocket(connection.config.url); }
    catch (error) {
      this.notify({ id: connection.id, status: { state: "error", message: error instanceof Error ? error.message : "连接失败" } });
      this.reconnect(connection); return;
    }
    connection.socket = socket;
    socket.onopen = () => {
      if (!this.current(connection) || connection.socket !== socket) return;
      connection.attempts = 0;
      this.notify({ id: connection.id, status: { state: "connected", message: "已连接，等待数据" } });
    };
    socket.onmessage = (event) => {
      if (!this.current(connection) || connection.socket !== socket) return;
      try {
        if (typeof event.data !== "string") throw new Error("WebSocket 仅支持 JSON 文本消息");
        this.emitJson(connection, event.data);
      } catch (error) { this.notify({ id: connection.id, status: { state: "error", message: error instanceof Error ? error.message : "消息无效" } }); }
    };
    socket.onerror = () => {
      if (this.current(connection) && connection.socket === socket) this.notify({ id: connection.id, status: { state: "error", message: "WebSocket 连接失败" } });
    };
    socket.onclose = () => {
      if (!this.current(connection) || connection.socket !== socket) return;
      connection.socket = undefined;
      this.notify({ id: connection.id, status: { state: "error", message: "连接已断开，正在重试" } });
      this.reconnect(connection);
    };
  }

  private reconnect(connection: Connection): void {
    if (!this.current(connection)) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(connection.attempts++, 5));
    connection.timer = setTimeout(() => this.connect(connection), delay);
  }

  private connectSocketIo(connection: Connection): void {
    if (!this.current(connection)) return;
    this.notify({ id: connection.id, status: { state: "connecting", message: "正在连接 Socket.IO" } });
    const config = connection.config;
    const url = new URL(config.url, globalThis.location?.href ?? "http://localhost/").href;
    const socket = io(url, { path: config.socketPath ?? DEFAULT_SOCKET_PATH, auth: config.socketAuth,
      autoConnect: false, forceNew: true, withCredentials: false, timeout: 10_000 });
    connection.socketIo = socket;
    const current = () => this.current(connection) && connection.socketIo === socket;
    socket.on("connect", () => {
      if (current()) this.notify({ id: connection.id, status: { state: "connected", message: "已连接，等待数据" } });
    });
    socket.on("connect_error", () => {
      if (current()) this.notify({ id: connection.id, status: { state: "error", message: socket.active ? "Socket.IO 连接失败，正在重试" : "Socket.IO 连接被拒绝，请检查配置" } });
    });
    socket.on("disconnect", () => {
      if (current()) this.notify({ id: connection.id, status: { state: "error", message: socket.active ? "连接已断开，正在重试" : "连接已断开，请手动刷新" } });
    });
    socket.on(config.socketEvent ?? DEFAULT_SOCKET_EVENT, (value: unknown) => {
      if (!current()) return;
      try {
        let text: string | undefined;
        if (typeof value === "string") {
          try { JSON.parse(value); text = value; } catch { text = JSON.stringify(value); }
        } else {
          text = JSON.stringify(value, (_key, item: unknown) => {
            if (item instanceof ArrayBuffer || ArrayBuffer.isView(item) ||
              (typeof Blob !== "undefined" && item instanceof Blob)) throw new Error("Socket.IO 暂不支持二进制消息");
            return item;
          });
        }
        if (typeof text !== "string") throw new Error("消息不是有效的 JSON 数据");
        this.emitJson(connection, text);
      } catch (error) {
        this.notify({ id: connection.id, status: { state: "error", message: error instanceof Error ? error.message : "消息无效" } });
      }
    });
    socket.connect();
  }

  private listen(connection: Connection): void {
    const origin = new URL(connection.config.url, window.location.href).origin;
    connection.listener = (event) => {
      if (!this.current(connection) || event.origin !== origin) return;
      try {
        const text = typeof event.data === "string" ? event.data : JSON.stringify(event.data);
        if (typeof text !== "string") throw new Error("消息不是有效的 JSON");
        this.emitJson(connection, text);
      } catch (error) { this.notify({ id: connection.id, status: { state: "error", message: error instanceof Error ? error.message : "消息无效" } }); }
    };
    window.addEventListener("message", connection.listener);
    this.notify({ id: connection.id, status: { state: "connected", message: `等待来自 ${origin} 的消息` } });
  }
}
