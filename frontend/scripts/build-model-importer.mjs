import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const engine = resolve(frontend, "../engine-rs");
const target = "wasm32-unknown-unknown";
const output = join(frontend, "src/wasm/model-importer");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: engine, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("cargo", ["build", "-p", "data-wind-assets", "--target", target, "--release"]);
run("wasm-bindgen", ["--out-dir", output, "--out-name", "model_importer", "--target", "web",
  join(engine, "target", target, "release/data_wind_assets.wasm")]);
