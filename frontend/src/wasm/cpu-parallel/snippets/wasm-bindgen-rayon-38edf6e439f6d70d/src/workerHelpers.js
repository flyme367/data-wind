/*
 * Adapted from wasm-bindgen-rayon. Copyright 2022 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Copied into wasm-bindgen's snippets/wasm-bindgen-rayon-*/ directory by build-engine.mjs.
// An explicit module path works in Vite and in the standalone production bindings.
self.addEventListener("message", async function initializeWorker({ data }) {
  if (data?.type !== "wasm_bindgen_worker_init") return;
  self.removeEventListener("message", initializeWorker);
  try {
    const pkg = await import("../../../data_wind_cpu.js");
    await pkg.default(data.init);
    self.postMessage({ type: "wasm_bindgen_worker_ready" });
    pkg.wbg_rayon_start_worker(data.receiver);
  } catch (error) {
    self.postMessage({ type: "wasm_bindgen_worker_error", error: String(error) });
  }
});

function waitForWorker(worker, signal, message) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve();
    };
    const onMessage = ({ data }) => {
      if (data?.type === "wasm_bindgen_worker_ready") finish();
      if (data?.type === "wasm_bindgen_worker_error") finish(new Error(data.error));
    };
    const onError = (event) => finish(new Error(event.message || "WASM worker failed"));
    const onAbort = () => finish(new Error("WASM worker initialization cancelled"));
    const timer = setTimeout(() => finish(new Error("WASM worker initialization timed out")), 15_000);
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
    try { worker.postMessage(message); } catch (error) { finish(error); }
  });
}

// A global root survives bundler tree shaking and keeps Firefox from collecting live workers.
const workersKey = Symbol.for("data-wind.rayon.workers");
export async function startWorkers(module, memory, builder) {
  const count = builder.numThreads();
  if (count < 1) throw new Error("WASM worker count must be positive");
  const pending = [];
  const controller = new AbortController();
  try {
    await Promise.all(Array.from({ length: count }, async () => {
      const worker = new Worker(new URL("./workerHelpers.js", import.meta.url), { type: "module" });
      pending.push(worker);
      await waitForWorker(worker, controller.signal, {
        type: "wasm_bindgen_worker_init", init: { module_or_path: module, memory },
        receiver: builder.receiver(),
      });
    }));
    builder.build();
    globalThis[workersKey] = pending;
  } catch (error) {
    controller.abort();
    for (const worker of pending) worker.terminate();
    throw error;
  }
}
