import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const engine = resolve(frontend, "../engine-rs");
// bevy 0.20.1 要求 rustc ≥1.97.1，旧 pinned nightly 过老；跟踪最新 nightly
const nightly = "nightly";
const target = "wasm32-unknown-unknown";
const output = join(frontend, "src/wasm");

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: engine, stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function bindings(targetDir, outDir, crateName) {
  run("wasm-bindgen", ["--remove-name-section", "--out-dir", outDir, "--out-name", crateName.replaceAll("-", "_"), "--target", "web",
    join(targetDir, target, "release", `${crateName}.wasm`)]);
}

const argv = process.argv;
const wantSingle = argv.includes("--single");
const wantParallel = argv.includes("--parallel");

// Separate target directories keep shared-memory and portable artifacts independent.

// ---- 1) Bevy 引擎（3D GPU）：无 rayon，始终单线程 wasm（主线程专用） ----
if (!wantParallel) {
  const targetDir = join(engine, "target");
  run("cargo", ["build", "-p", "data-wind-engine", "--target", target, "--release",
    "--target-dir", targetDir]);
  bindings(targetDir, output, "data_wind_engine");
}

// ---- 2) CPU 渲染 portable（软渲 / 看板栅格化；主线程回退 + 单线程 Worker） ----
if (!wantParallel) {
  const targetDir = join(engine, "target");
  run("cargo", ["build", "-p", "data-wind-cpu", "--target", target, "--release",
    "--features", "wasm", "--target-dir", targetDir]);
  bindings(targetDir, join(output, "cpu"), "data_wind_cpu");
}

// ---- 3) CPU 渲染 parallel（atomics + rayon 线程池；渲染 Worker 专用） ----
// bevy_egui 在 wasm32-atomics 下与上游 egui 不兼容（DroppedFileHandle 无 Send），
// 因此并行构建只覆盖 data-wind-cpu，bevy 引擎保持非 atomic。
if (!wantSingle) {
  const targetDir = join(engine, "target/parallel");
  const outDir = join(output, "cpu-parallel");
  const flags = [
    process.env.RUSTFLAGS ?? "",
    "-C target-feature=+atomics,+bulk-memory",
    "-C link-arg=--shared-memory",
    "-C link-arg=--max-memory=1073741824",
    "-C link-arg=--import-memory",
    ...["__wasm_init_tls", "__tls_size", "__tls_align", "__tls_base"].map((name) => `-C link-arg=--export=${name}`),
  ].join(" ");
  run("cargo", [`+${nightly}`, "build", "-p", "data-wind-cpu", "--target", target, "--release",
    "--features", "wasm,parallel", "--target-dir", targetDir, "-Z", "build-std=panic_abort,std"],
  { ...process.env, RUSTFLAGS: flags });
  bindings(targetDir, outDir, "data_wind_cpu");
  // Surface worker startup failures so the client can fall back, and terminate partial pools.
  const snippets = join(outDir, "snippets");
  const helper = readdirSync(snippets).find((name) => name.startsWith("wasm-bindgen-rayon-"));
  if (!helper) throw new Error("wasm-bindgen-rayon worker snippet is missing");
  const helperPath = join(snippets, helper, "src/workerHelpers.js");
  if (!existsSync(helperPath)) throw new Error("Unexpected wasm-bindgen-rayon snippet layout");
  copyFileSync(join(frontend, "scripts/rayon-worker-helpers.js"), helperPath);
}
