import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseGatewayUrl, databaseRequest, normalizeDatabaseRows, setDatabaseToken } from "../data/localDatabase";
import { defaultDataSource, validateDataSource } from "../data/dataSources";
import { LiveDataManager } from "../data/liveData";

afterEach(() => vi.unstubAllGlobals());

describe("local database sources", () => {
  it("accepts only local service origins and validates saved SQL", () => {
    expect(databaseGatewayUrl("http://127.0.0.1:4319")).toBe("http://127.0.0.1:4319");
    expect(databaseGatewayUrl("http://localhost:4319")).toBe("http://127.0.0.1:4319");
    expect(() => databaseGatewayUrl("https://remote.example")).toThrow(/本机/);
    const source = { ...defaultDataSource("database"), url: "http://127.0.0.1:4319", database: { profile: "demo", sql: "SELECT * FROM example" } };
    expect(validateDataSource(source)).toEqual(source);
    expect(() => validateDataSource({ ...source, database: { ...source.database, sql: "SELECT 1; DROP TABLE t" } })).toThrow(/SELECT/);
    const webhook = { ...defaultDataSource("webhook"), url: "http://127.0.0.1:4319", webhook: { id: "stream-1", mode: "accumulate" as const, maxRows: 250 } };
    expect(validateDataSource(webhook)).toEqual(webhook);
    expect(() => validateDataSource({ ...webhook, webhook: undefined })).toThrow(/Webhook/);
  });

  it("uses a session-only token and converts result rows for component bindings", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ columns: ["name", "value"], rows: [["A", 3]] }) });
    vi.stubGlobal("fetch", fetcher);
    setDatabaseToken("http://127.0.0.1:4319", "session-token");
    const result = await databaseRequest<{ columns: string[]; rows: unknown[][] }>("http://127.0.0.1:4319", "/query", { profile: "demo", sql: "SELECT 1" });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer session-token" } });
    expect(normalizeDatabaseRows(result)).toEqual({ columns: ["name", "value"], rows: [{ name: "A", value: 3 }] });
    await databaseRequest("http://127.0.0.1:4319", "/profiles", { id: "demo", name: "renamed" }, undefined, "PUT");
    await databaseRequest("http://127.0.0.1:4319", "/profiles", { id: "demo" }, undefined, "DELETE");
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: "PUT", body: JSON.stringify({ id: "demo", name: "renamed" }) });
    expect(fetcher.mock.calls[2][1]).toMatchObject({ method: "DELETE", body: JSON.stringify({ id: "demo" }) });
    expect(() => normalizeDatabaseRows({ columns: ["value", "value"], rows: [[1, 2]] })).toThrow(/重复/);
  });

  it("loads a database source through the live data manager", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ columns: ["name", "value"], rows: [["device", 42]] }) });
    vi.stubGlobal("fetch", fetcher);
    setDatabaseToken("http://127.0.0.1:4319", "session-token");
    const updates: unknown[] = [];
    const manager = new LiveDataManager((update) => updates.push(update));
    manager.sync([{ id: "db", dataSource: { ...defaultDataSource("database"), url: "http://127.0.0.1:4319", intervalMs: 0, database: { profile: "local-pg", sql: "SELECT * FROM devices" } } }]);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:4319/query", expect.objectContaining({ method: "POST", body: JSON.stringify({ profile: "local-pg", sql: "SELECT * FROM devices" }) }));
    expect(updates).toContainEqual(expect.objectContaining({ id: "db", data: { columns: ["name", "value"], rows: [{ name: "device", value: 42 }] } }));
    manager.dispose();
  });

  it("polls inbound Webhook rows through the local gateway", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ columns: ["event", "value"], rows: [["alert", 1]] }) });
    vi.stubGlobal("fetch", fetcher);
    setDatabaseToken("http://127.0.0.1:4319", "session-token");
    const updates: unknown[] = [];
    const manager = new LiveDataManager((update) => updates.push(update));
    manager.sync([{ id: "hook", dataSource: { ...defaultDataSource("webhook"), url: "http://127.0.0.1:4319", intervalMs: 0,
      webhook: { id: "stream-1", mode: "latest", maxRows: 1 } } }]);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:4319/webhooks/data", expect.objectContaining({ method: "POST", body: JSON.stringify({ id: "stream-1" }) }));
    expect(updates).toContainEqual(expect.objectContaining({ id: "hook", data: { columns: ["event", "value"], rows: [{ event: "alert", value: 1 }] } }));
    manager.dispose();
  });
});
