import { createServer, type Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { afterEach, describe, expect, it } from "vitest";
import { defaultDataSource, validateDataSource, type DataSourceConfig } from "../data/dataSources";
import { LiveDataManager, type LiveDataUpdate } from "../data/liveData";
import type { SceneNode } from "../types";

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Socket.IO integration timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("Socket.IO data source", () => {
  let manager: LiveDataManager | undefined;
  let io: Server | undefined;
  let http: HttpServer | undefined;
  afterEach(async () => {
    manager?.dispose();
    if (io) await new Promise<void>((resolve) => io!.close(() => resolve()));
    else if (http?.listening) await new Promise<void>((resolve) => http!.close(() => resolve()));
    manager = undefined; io = undefined; http = undefined;
  });

  it("validates custom paths, events, authentication and backward-compatible defaults", () => {
    const source = { ...defaultDataSource("socketio"), url: "https://example.com/metrics" };
    expect(validateDataSource(source)).toEqual(source);
    expect(() => validateDataSource({ ...source, socketEvent: "disconnect" })).toThrow(/保留/);
    expect(() => validateDataSource({ ...source, socketPath: "socket.io" })).toThrow(/路径/);
    expect(() => validateDataSource({ ...source, socketAuth: [] })).toThrow(/认证/);
    expect(() => validateDataSource({ ...source, url: "wss://example.com" })).toThrow(/HTTP/);
  });

  it("connects to a real server with namespace, transport path, auth and selected event", async () => {
    http = createServer();
    io = new Server(http, { path: "/custom/socket/" });
    const namespace = io.of("/metrics");
    let connections = 0;
    namespace.use((socket, next) => socket.handshake.auth.token === "secret" ? next() : next(new Error("unauthorized")));
    namespace.on("connection", (socket) => {
      connections += 1;
      socket.emit("other", { payload: [{ value: -1 }] });
      socket.emit("readings", { payload: [{ value: connections }] });
    });
    await new Promise<void>((resolve) => http!.listen(0, "127.0.0.1", resolve));
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("No test server address");
    const source: DataSourceConfig = { ...defaultDataSource("socketio"), url: `http://127.0.0.1:${address.port}/metrics`,
      path: "payload", socketPath: "/custom/socket/", socketEvent: "readings", socketAuth: { token: "secret" } };
    const item = { id: "socket-node", dataSource: source } as SceneNode;
    const updates: LiveDataUpdate[] = [];
    manager = new LiveDataManager((update) => updates.push(update));
    manager.sync([item]);
    await waitFor(() => updates.some((update) => update.data));
    expect(updates.filter((update) => update.data).map((update) => update.data)).toEqual([{ rows: [{ value: 1 }] }]);

    namespace.disconnectSockets();
    await waitFor(() => updates.some((update) => update.status?.message?.includes("手动刷新")));
    manager.refresh(item.id);
    await waitFor(() => updates.filter((update) => update.data).length === 2);
    expect(updates.at(-1)?.data).toEqual({ rows: [{ value: 2 }] });

    // A transport failure is different from a server-forced namespace disconnect:
    // the Socket.IO client must recover without a manual refresh.
    namespace.sockets.values().next().value!.conn.close();
    await waitFor(() => updates.filter((update) => update.data).length === 3);
    expect(updates.at(-1)?.data).toEqual({ rows: [{ value: 3 }] });
    manager.sync([]);
    expect(updates.at(-1)?.clear).toBe(true);
    await waitFor(() => namespace.sockets.size === 0);
    expect(connections).toBe(3);
  });
});
