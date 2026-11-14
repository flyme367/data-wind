import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "data-wind-db-"));
const path = join(dir, "config.json");
const token = "local-test-token-at-least-24-characters";
process.env.DATA_WIND_DB_CONFIG = path;
const { createGateway, validQuery, runQuery } = await import("./server.mjs");
const server = createGateway();
let base;
before(async () => {
  await writeFile(path, JSON.stringify({ token, allowedOrigins: ["http://127.0.0.1:5173"], profiles: [], webhooks: [] }), { mode: 0o600 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });

test("accepts a single SELECT and rejects multiple statements or comments", () => {
  assert.equal(validQuery("SELECT * FROM example"), true);
  for (const sql of ["DELETE FROM example", "SELECT 1; DROP TABLE example", "SELECT 1 -- comment", "SELECT /* comment */ 1"]) assert.equal(validQuery(sql), false);
});

test("uses read-only transactions and rolls back for PostgreSQL and MySQL", async () => {
  for (const type of ["postgres", "mysql"]) {
    const calls = [];
    const client = { query: async (query) => {
      calls.push(query);
      if (typeof query === "object") return type === "postgres"
        ? { fields: [{ name: "value" }], rows: [[42]] }
        : [[[42]], [{ name: "value" }]];
      return undefined;
    } };
    const result = await runQuery({ type }, "SELECT 42 AS value", async (_profile, callback) => callback(type, client));
    assert.deepEqual(result, { columns: ["value"], rows: [[42]] });
    assert.equal(calls[0], type === "postgres" ? "BEGIN READ ONLY" : "SET TRANSACTION READ ONLY");
    assert.equal(calls.at(-1), "ROLLBACK");
    assert.match(calls.find((item) => typeof item === "object").text ?? calls.find((item) => typeof item === "object").sql, /LIMIT 1000$/);
    const failedCalls = [];
    const failed = { query: async (query) => { failedCalls.push(query); if (typeof query === "object") throw new Error("query failed"); } };
    await assert.rejects(runQuery({ type }, "SELECT 42", async (_profile, callback) => callback(type, failed)), /query failed/);
    assert.equal(failedCalls.at(-1), "ROLLBACK");
  }
});

test("requires the configured token and allowed origin", async () => {
  assert.equal((await fetch(`${base}/profiles`)).status, 401);
  assert.equal((await fetch(`${base}/profiles`, { headers: { Origin: "https://other.example", Authorization: `Bearer ${token}` } })).status, 403);
  const response = await fetch(`${base}/profiles`, { headers: { Origin: "http://127.0.0.1:5173", Authorization: `Bearer ${token}` } });
  assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");
  assert.deepEqual(await response.json(), { profiles: [] });
});

test("stores profiles locally without returning passwords and rejects unsafe queries", async () => {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const profile = { id: "demo", name: "本机", type: "mysql", host: "127.0.0.1", port: 3306, user: "reader", password: "private", database: "demo", ssl: false };
  assert.equal((await fetch(`${base}/profiles`, { method: "POST", headers, body: JSON.stringify(profile) })).status, 200);
  const listed = await (await fetch(`${base}/profiles`, { headers })).json();
  assert.deepEqual(listed.profiles, [{ id: "demo", name: "本机", type: "mysql", host: "127.0.0.1", port: 3306,
    user: "reader", database: "demo", ssl: false }]);
  assert.equal(JSON.stringify(listed).includes("private"), false);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(path, "utf8")).profiles[0].password, "private");
  const updated = { ...profile, name: "本机已改名", password: "" };
  assert.equal((await fetch(`${base}/profiles`, { method: "PUT", headers, body: JSON.stringify(updated) })).status, 200);
  const savedAfterUpdate = JSON.parse(await readFile(path, "utf8")).profiles[0];
  assert.equal(savedAfterUpdate.name, "本机已改名");
  assert.equal(savedAfterUpdate.password, "private", "an empty edit password leaves the saved password unchanged");
  const invalid = await fetch(`${base}/query`, { method: "POST", headers, body: JSON.stringify({ profile: "demo", sql: "SELECT 1; DELETE FROM t" }) });
  assert.equal(invalid.status, 400);
  const postgres = { ...profile, id: "pg-demo", type: "postgres", port: 5432 };
  assert.equal((await fetch(`${base}/profiles`, { method: "POST", headers, body: JSON.stringify(postgres) })).status, 200);
  const profiles = await (await fetch(`${base}/profiles`, { headers })).json();
  assert.deepEqual(profiles.profiles.map((item) => item.type), ["mysql", "postgres"]);
  assert.equal((await fetch(`${base}/profiles`, { method: "DELETE", headers, body: JSON.stringify({ id: "demo" }) })).status, 200);
  const remaining = await (await fetch(`${base}/profiles`, { headers })).json();
  assert.deepEqual(remaining.profiles.map((item) => item.id), ["pg-demo"]);
});

test("receives JSON and form Webhook pushes in latest and cumulative modes", async () => {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const webhook = { id: "sensor-push", name: "设备推送", mode: "latest", maxRows: 2 };
  assert.equal((await fetch(`${base}/webhooks`, { method: "POST", headers, body: JSON.stringify(webhook) })).status, 200);
  const listed = await (await fetch(`${base}/webhooks`, { headers })).json();
  assert.deepEqual(listed.webhooks[0], { ...webhook, url: `${base}/hook/sensor-push` });

  const preflight = await fetch(`${base}/hook/sensor-push`, { method: "OPTIONS", headers: { Origin: "https://sender.example" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  const push = (value) => fetch(`${base}/hook/sensor-push`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  assert.equal((await push({ event: "open", value: 1 })).status, 202);
  const read = async () => (await fetch(`${base}/webhooks/data`, { method: "POST", headers, body: JSON.stringify({ id: webhook.id }) })).json();
  assert.deepEqual(await read(), { columns: ["event", "value"], rows: [["open", 1]] });
  await push({ event: "closed", value: 2 });
  await fetch(`${base}/webhooks`, { method: "PUT", headers, body: JSON.stringify({ ...webhook, mode: "accumulate" }) });
  await push({ event: "open", value: 3 });
  await fetch(`${base}/hook/sensor-push`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "event=closed&value=4" });
  assert.deepEqual(await read(), { columns: ["event", "value"], rows: [["open", 3], ["closed", "4"]] });
  assert.equal((await fetch(`${base}/webhooks`, { method: "DELETE", headers, body: JSON.stringify({ id: webhook.id }) })).status, 200);
  assert.equal((await push({ event: "missing" })).status, 404);
});
