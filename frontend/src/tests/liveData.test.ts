import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApiRequest, defaultDataSource, normalizeData, parseDataFile, validateDataSource, type DataSourceConfig } from "../data/dataSources";
import { LiveDataManager, type LiveDataUpdate } from "../data/liveData";
import { resolveRuntimeNode, resolveRuntimeScene } from "../data/runtimeScene";
import { tableGrid, widgetNode } from "../data/editor";
import { handle, flattenScene } from "../workers/sceneModel";
import { parseProjectFile } from "../state/projects";
import type { SceneNode } from "../types";

const config = (patch: Partial<DataSourceConfig> = {}): DataSourceConfig => ({
  ...defaultDataSource(), url: "https://api.example.com/metrics", intervalMs: 0, ...patch,
});
const response = (value: unknown, status = 200) => ({
  ok: status >= 200 && status < 300, status, headers: { get: () => null }, body: null,
  text: async () => JSON.stringify(value),
}) as unknown as Response;
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const node = (source: DataSourceConfig, kind: "metric" | "bar" = "metric"): SceneNode => {
  handle({ type: "openProject", projectId: "data", tree: [], template: "empty" });
  const created = handle({ type: "add", node: widgetNode(kind) })!.tree[0]!;
  return { ...created, dataSource: source };
};

describe("data sources and bindings", () => {
  it("parses nested JSON and quoted CSV without losing strings", () => {
    expect(normalizeData({ payload: { list: [{ value: 2 }] } }, "payload.list")).toEqual({ rows: [{ value: 2 }] });
    expect(normalizeData(42)).toEqual({ value: 42 });
    expect(() => normalizeData({ value: 1 }, "missing.field")).toThrow(/未找到/);
    expect(parseDataFile("data.csv", '\uFEFF名称,编号,说明\r\n"一,号",001,"跨\n行"\r\n二,002,"带""引号"""'))
      .toEqual({ columns: ["名称", "编号", "说明"], rows: [{ 名称: "一,号", 编号: "001", 说明: "跨\n行" }, { 名称: "二", 编号: "002", 说明: '带"引号"' }] });
    expect(() => parseDataFile("bad.csv", "a,a\n1,2")).toThrow(/表头/);
    expect(() => parseDataFile("bad.csv", '__proto__,v\nx,1')).toThrow(/表头/);
    expect(() => parseDataFile("bad.csv", 'a,b\n"未闭合,1')).toThrow(/引号/);
    expect(() => parseDataFile("bad.json", "[1,")).toThrow(/JSON/);
  });

  it("validates protocols, origin, headers and polling intervals", () => {
    expect(() => validateDataSource(config({ url: "javascript:alert(1)" }))).toThrow(/HTTP/);
    expect(() => validateDataSource(config({ kind: "websocket", url: "https://example.com" }))).toThrow(/ws/);
    expect(() => validateDataSource(config({ kind: "message", url: "https://example.com/path" }))).toThrow(/来源/);
    expect(() => validateDataSource(config({ intervalMs: 10 }))).toThrow(/参数/);
    expect(() => validateDataSource(config({ headers: { Example: "bad\nvalue" } }))).toThrow(/请求头/);
    expect(validateDataSource(config({ kind: "message", url: "https://example.com" })).kind).toBe("message");
  });

  it("validates API parameters and prevents conflicting authorization headers", () => {
    expect(() => validateDataSource(config({ queryParams: [{ key: "", value: "x", enabled: true }] }))).toThrow(/参数/);
    expect(buildApiRequest(config({ queryParams: [{ key: "", value: "", enabled: false }] })).url).toBe("https://api.example.com/metrics");
    expect(() => validateDataSource(config({ auth: { type: "bearer", token: "bad\nvalue" } }))).toThrow(/Token/);
    expect(() => validateDataSource(config({ headers: { authorization: "custom" }, auth: { type: "bearer", token: "abc" } }))).toThrow(/Authorization/);
    expect(buildApiRequest(config({ auth: { type: "basic", username: "用户", password: "密码" } })).headers.Authorization)
      .toBe(`Basic ${btoa(Array.from(new TextEncoder().encode("用户:密码"), (byte) => String.fromCharCode(byte)).join(""))}`);
  });

  it("resolves API variables without modifying saved values and reports missing names", () => {
    const source = config({ url: "https://api.example.com/{{path}}", headers: { "X-Region": "{{region}}" },
      queryParams: [{ key: "area", value: "{{region}}", enabled: true }], auth: { type: "bearer", token: "{{token}}" },
      variables: [{ name: "path", initialValue: "metrics" }, { name: "region", initialValue: "north", currentValue: "南区" }, { name: "token", initialValue: "secret" }] });
    const request = buildApiRequest(source);
    expect(request.url).toBe("https://api.example.com/metrics?area=%E5%8D%97%E5%8C%BA");
    expect(request.headers).toEqual({ "X-Region": "南区", Authorization: "Bearer secret" });
    expect(source.url).toBe("https://api.example.com/{{path}}");
    expect(() => validateDataSource(config({ url: "https://example.com/{{missing}}" }))).toThrow(/未定义变量/);
    expect(() => validateDataSource(config({ variables: [{ name: "a", initialValue: "1" }, { name: "a", initialValue: "2" }] }))).toThrow(/变量/);
  });

  it("renders CSV and nested API records in the new table components", () => {
    const table = { ...node(config()), ...widgetNode("tableBasic") } as SceneNode;
    const imported = parseDataFile("metrics.csv", "设备,数值\n机组A,007\n机组B,9");
    expect(tableGrid({ ...table, data: imported })).toEqual({ columns: ["设备", "数值"], rows: [["机组A", "007"], ["机组B", "9"]] });
    const nested = { ...table, data: { payload: { items: [{ name: "机组", value: 42 }] } }, bindings: { rows: "payload.items" } };
    expect(tableGrid(resolveRuntimeNode(nested, {}, {}))).toEqual({ columns: ["name", "value"], rows: [["机组", "42"]] });
    const fallback = resolveRuntimeNode(table, { [table.id]: { rows: [{ name: "实时", value: 8 }] } }, {});
    expect(tableGrid(fallback)).toEqual({ columns: ["name", "value"], rows: [["实时", "8"]] });
    expect(fallback.data?.columns).toEqual(["姓名", "年龄", "性别"]);
  });

  it("resolves data before interactive overrides, without modifying saved scene data", () => {
    const original = { ...node(config(), "bar"), data: { rows: [{ value: 1 }], show: false }, bindings: { rows: "metrics", visible: "show", unit: "" } };
    const live = { [original.id]: { metrics: [{ name: "实时", value: 9 }], show: false } };
    const overrides = { [original.id]: { visible: true, color: "#123456" } };
    const resolved = resolveRuntimeNode(original, live, overrides);
    expect(resolved.data?.rows).toEqual([{ name: "实时", value: 9 }]);
    expect(resolved.visible).toBe(true);
    expect(resolved.color).toBe("#123456");
    expect(resolved.widget!.unit).toBe(original.widget!.unit);
    expect(original.data?.rows).toEqual([{ value: 1 }]);
    const modified = resolveRuntimeNode(original, live, {
      [original.id]: { dataPatch: { rows: [{ name: "交互覆盖", value: 12 }] } },
    });
    expect(modified.data?.rows).toEqual([{ name: "交互覆盖", value: 12 }]);
    expect(original.data?.rows).toEqual([{ value: 1 }]);
    const model = { ...original, type: "model" as const, widget: undefined };
    expect(flattenScene(resolveRuntimeScene([model], live, overrides), true)).toHaveLength(1);
  });

  it("saves and undoes a source or imported static data as single operations", () => {
    const initial = node(config());
    const connected = handle({ type: "setDataSource", id: initial.id, source: initial.dataSource! })!;
    expect(parseProjectFile(JSON.stringify({ scene: connected.tree })).scene[0]!.dataSource).toEqual(initial.dataSource);
    const imported = handle({ type: "setStaticData", id: initial.id, data: { rows: [{ value: "3" }] } })!;
    expect(imported.tree[0]!.dataSource).toBeUndefined();
    expect(handle({ type: "undo" })!.tree[0]!.dataSource).toEqual(initial.dataSource);
    expect(handle({ type: "undo" })!.tree[0]!.dataSource).toBeUndefined();
  });
});

describe("live connection lifecycle", () => {
  let updates: LiveDataUpdate[], manager: LiveDataManager;
  beforeEach(() => { vi.useFakeTimers(); updates = []; manager = new LiveDataManager((update) => updates.push(update)); });
  afterEach(() => { manager.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("polls after completion, retains the last data on failure, and stops when removed", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ value: 1 })).mockResolvedValueOnce(response({}, 503));
    vi.stubGlobal("fetch", fetcher);
    manager.sync([node(config({ intervalMs: 1000 }))]);
    await flush();
    expect(updates.filter((u) => u.data).map((u) => u.data)).toEqual([{ value: 1 }]);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: "GET", credentials: "omit", mode: "cors" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(updates.at(-1)?.status).toMatchObject({ state: "error", message: expect.stringContaining("503") });
    expect(updates.filter((u) => u.data)).toHaveLength(1);
    manager.sync([]);
    expect(updates.at(-1)?.clear).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("sends enabled API query parameters and Bearer authentication on the real request", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ value: 1 }));
    vi.stubGlobal("fetch", fetcher);
    const source = config({ url: "https://api.example.com/metrics?existing=1", headers: { "X-Client": "demo" },
      queryParams: [{ key: "tag", value: "一 号", enabled: true }, { key: "tag", value: "two", enabled: true }, { key: "skip", value: "x", enabled: false }],
      auth: { type: "bearer", token: "secret" } });
    manager.sync([node(source)]);
    await flush();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![0]).toBe("https://api.example.com/metrics?existing=1&tag=%E4%B8%80+%E5%8F%B7&tag=two");
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ headers: { "X-Client": "demo", Authorization: "Bearer secret" } });
    expect(source.headers).toEqual({ "X-Client": "demo" });
  });

  it("substitutes variables in a POST body before sending", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ ok: true }));
    vi.stubGlobal("fetch", fetcher);
    manager.sync([node(config({ method: "POST", body: '{"region":"{{region}}"}', variables: [{ name: "region", initialValue: "east" }] }))]);
    await flush();
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ body: '{"region":"east"}' });
  });

  it("ignores an old response even if a cancelled request resolves later", async () => {
    const pending: ((response: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))));
    const item = node(config());
    manager.sync([item]);
    manager.refresh(item.id);
    pending[1]!(response({ value: 2 })); await flush();
    pending[0]!(response({ value: 1 })); await flush();
    expect(updates.filter((u) => u.data).map((u) => u.data)).toEqual([{ value: 2 }]);
  });

  it("reconnects native WebSockets and does not reconnect after disposal", async () => {
    class FakeSocket {
      static instances: FakeSocket[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor(public url: string) { FakeSocket.instances.push(this); }
      close() {}
    }
    vi.stubGlobal("WebSocket", FakeSocket);
    const item = node(config({ kind: "websocket", url: "wss://example.com/ws" }));
    manager.sync([item]);
    const first = FakeSocket.instances[0]!;
    first.onopen?.(); first.onmessage?.({ data: '{"value":7}' });
    expect(updates.at(-1)?.data).toEqual({ value: 7 });
    first.onclose?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.instances[1]!.onclose?.();
    manager.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("accepts PostMessage only from the configured origin and removes its listener", () => {
    const host = Object.assign(new EventTarget(), { location: { href: "https://viewer.example/" } });
    vi.stubGlobal("window", host);
    const item = node(config({ kind: "message", url: "https://trusted.example" }));
    manager.sync([item]);
    host.dispatchEvent(new MessageEvent("message", { origin: "https://other.example", data: { value: 1 } }));
    expect(updates.some((u) => u.data)).toBe(false);
    host.dispatchEvent(new MessageEvent("message", { origin: "https://trusted.example", data: { value: 2 } }));
    expect(updates.at(-1)?.data).toEqual({ value: 2 });
    manager.dispose();
    host.dispatchEvent(new MessageEvent("message", { origin: "https://trusted.example", data: { value: 3 } }));
    expect(updates.at(-1)?.data).toEqual({ value: 2 });
  });
});
