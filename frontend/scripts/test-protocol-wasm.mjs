import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const engine = resolve(frontend, "../engine-rs");
const temporary = mkdtempSync(join(tmpdir(), "data-wind-wasm-protocol-"));
try {
  // A separate crate avoids replacing the production engine artifact or requiring WebGPU.
  execFileSync("cargo", ["build", "--locked", "-p", "protocol-smoke", "--target", "wasm32-unknown-unknown", "--release"],
    { cwd: engine, stdio: "inherit" });
  const binding = join(temporary, "binding");
  execFileSync("wasm-bindgen", ["--target", "web", "--out-dir", binding, "--out-name", "protocol_smoke",
    join(engine, "target/wasm32-unknown-unknown/release/protocol_smoke.wasm")], { stdio: "inherit" });
  const entry = join(temporary, "reader-entry.ts");
  writeFileSync(entry, `export * from ${JSON.stringify(join(frontend, "src/engine/commandResponse.ts"))};\nexport * from ${JSON.stringify(join(frontend, "src/engine/commands.ts"))};\nexport { BoardAction, EventPayload } from ${JSON.stringify(join(frontend, "src/protocol/generated/data-wind-protocol"))};\n`);
  await build({
    configFile: false, root: frontend, logLevel: "error",
    build: { outDir: join(temporary, "reader"), minify: false,
      lib: { entry, formats: ["es"], fileName: () => "reader.mjs" } },
  });
  writeFileSync(join(binding, "package.json"), '{"type":"module"}\n');
  const { ProtocolHarness, initSync } = await import(pathToFileURL(join(binding, "protocol_smoke.js")));
  const wasm = initSync({ module: readFileSync(join(binding, "protocol_smoke_bg.wasm")) });
  const { readCommandResponse, dispatchCommandResponse, encodeSceneUpdate, encodeSetHud, BoardAction } =
    await import(pathToFileURL(join(temporary, "reader/reader.mjs")));
  const harness = new ProtocolHarness();
  let released = false;
  const release = () => { if (!released) { released = true; harness.free(); } };
  try {
    assert.equal(harness.take_response().byteLength, 0);
    harness.queue_sample();
    const bytes = harness.take_response();
    assert.ok(bytes instanceof Uint8Array);
    assert.deepEqual(Buffer.from(bytes), readFileSync(join(frontend, "src/tests/fixtures/command_response_v1.bin")));
    assert.equal(readCommandResponse(bytes).bb.bytes(), bytes);
    assert.equal(harness.take_response().byteLength, 0);
    harness.queue_sample();
    harness.take_response();
    // Memory growth detaches the old Wasm ArrayBuffer, but not the owned return packet.
    const oldMemory = wasm.memory.buffer;
    wasm.memory.grow(1);
    assert.notEqual(wasm.memory.buffer, oldMemory);
    assert.equal(oldMemory.byteLength, 0);
    assert.notEqual(bytes.buffer, oldMemory);
    // 看板事件走同一条 DWCR 队列。
    harness.queue_board_sample();
    const boardSeen = [];
    dispatchCommandResponse(harness.take_response(), {
      boardEvent: (event) => boardSeen.push(event),
    });
    assert.equal(boardSeen.length, 7);
    assert.deepEqual(boardSeen[0], { id: "btn-1", kind: "button", action: BoardAction.Change, value: "文本-β🙂" });
    assert.equal(boardSeen[2].action, BoardAction.Open);
    assert.equal(boardSeen[2].value, null);
    assert.deepEqual(boardSeen[4].value, ["a.csv", "数据-b.json"]);
    assert.deepEqual(boardSeen[6].value,
      { min: 0, max: 86399.5, labels: ["低", "高"], nested: { deep: [1, 2.5, null] } });
    // 前端编码的命令缓冲在 wasm 侧解码。
    assert.equal(harness.decode_set_hud(encodeSetHud({ grid: false, flylines: true, stats: false })), "false/true/false");
    assert.equal(harness.decode_set_hud(new Uint8Array([1, 2, 3])), "");
    assert.equal(harness.decode_scene_update_count(encodeSceneUpdate([
      { id: "box-α🙂", kind: "mesh", pos: [1.5, 2, -3.25], size: [4, 5, 6], rotY: 0.5,
        rotation: [0.1, 0.2, 0.3], color: [0.2, 0.4, 0.8], locked: true, modelId: "model-1" },
      { id: "b", kind: "box", pos: [0, 0, 0], size: [1, 1, 1], rotY: 0, color: [1, 1, 1] },
    ])), 2);
    assert.equal(harness.decode_scene_update_count(new Uint8Array([1, 2, 3])), 0);

    release();
    const seen = [];
    dispatchCommandResponse(bytes, {
      pick: (id) => seen.push(["pick", id]),
      transform: (id, position) => seen.push(["transform", id, position]),
      stats: (value) => seen.push(["stats", value]),
      hud: (value) => seen.push(["hud", value]),
      error: (message) => seen.push(["error", message]),
      probe: (rgba) => seen.push(["probe", rgba]),
    });
    assert.equal(seen.length, 7);
    assert.deepEqual(seen[0], ["pick", "模型-α🙂"]);
    assert.deepEqual(seen[2], ["transform", "model-2", [1.25, -2.5, 300000.125]]);
    assert.deepEqual(seen[6], ["probe", [0, 51, 204, 255]]);
    console.log(`Wasm ABI passed: ${bytes.byteLength} bytes, 7 events, 7 board events, request decode, stable after memory growth and free.`);
  } finally {
    release();
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
