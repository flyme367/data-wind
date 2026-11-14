import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

const originalSelf = globalThis.self;
const originalWorker = globalThis.Worker;
globalThis.self = new EventTarget();
const { startWorkers } = await import("./rayon-worker-helpers.js");

let workers = [];
let behavior = "ready";
class TestWorker extends EventTarget {
  terminated = false;
  constructor() { super(); workers.push(this); }
  postMessage(message) {
    this.message = message;
    if (behavior === "throw") throw new Error("Cannot clone memory");
    if (behavior === "silent") return;
    queueMicrotask(() => {
      const data = behavior === "ready"
        ? { type: "wasm_bindgen_worker_ready" }
        : { type: "wasm_bindgen_worker_error", error: "Worker could not load" };
      this.dispatchEvent(new MessageEvent("message", { data }));
    });
  }
  terminate() { this.terminated = true; }
}

beforeEach(() => { workers = []; behavior = "ready"; globalThis.Worker = TestWorker; });
after(() => {
  globalThis.self = originalSelf;
  globalThis.Worker = originalWorker;
  delete globalThis[Symbol.for("data-wind.rayon.workers")];
});

function builder() {
  return { built: false, numThreads: () => 3, receiver: () => 256, build() { this.built = true; } };
}

test("builds the pool only after all workers have the shared module and memory", async () => {
  const pool = builder();
  const module = {}, memory = {};
  const ready = startWorkers(module, memory, pool);
  assert.equal(pool.built, false);
  await ready;
  assert.equal(pool.built, true);
  assert.equal(workers.length, 3);
  const retained = globalThis[Symbol.for("data-wind.rayon.workers")];
  assert.equal(retained.length, workers.length);
  assert.ok(retained.every((worker, index) => worker === workers[index]));
  for (const worker of workers) {
    assert.equal(worker.message.init.module_or_path, module);
    assert.equal(worker.message.init.memory, memory);
    assert.equal(worker.terminated, false);
  }
});

for (const failure of ["error", "throw"]) {
  test(`terminates every partial worker when startup fails (${failure})`, async () => {
    behavior = failure;
    const pool = builder();
    await assert.rejects(startWorkers({}, {}, pool), /Worker could not load|Cannot clone memory/);
    assert.equal(pool.built, false);
    assert.ok(workers.every((worker) => worker.terminated));
  });
}

test("times out silent workers and releases the partial pool", async (context) => {
  behavior = "silent";
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const pool = builder();
  const rejected = assert.rejects(startWorkers({}, {}, pool), /timed out/);
  context.mock.timers.tick(15_000);
  await rejected;
  assert.equal(pool.built, false);
  assert.ok(workers.every((worker) => worker.terminated));
});
