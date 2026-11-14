import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { initSync, SoftwareCanvas } from "../src/wasm/cpu/data_wind_cpu.js";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(join(tmpdir(), "data-wind-terrain-wasm-"));
try {
  const entry = join(temporary, "fixture.ts");
  writeFileSync(entry, `export { encodeSoftwareFrame } from ${JSON.stringify(join(frontend, "src/engine/commands.ts"))};\nexport { defaultTerrain } from ${JSON.stringify(join(frontend, "src/data/terrain.ts"))};\n`);
  await build({ configFile: false, root: frontend, logLevel: "error", build: {
    outDir: join(temporary, "build"), minify: false,
    lib: { entry, formats: ["es"], fileName: () => "fixture.mjs" },
  } });
  const { encodeSoftwareFrame, defaultTerrain } = await import(pathToFileURL(join(temporary, "build/fixture.mjs")));
  initSync({ module: readFileSync(join(frontend, "src/wasm/cpu/data_wind_cpu_bg.wasm")) });
  const canvas = new SoftwareCanvas();
  try {
    const width = 384, height = 256;
    const camera = { target: [0, 8, 0], yaw: .75, pitch: .55, dist: 72 };
    const options = { grid: false, selectedId: null, time: 0, background: "#101a2c", daylight: 1 };
    const terrain = {
      id: "terrain-wasm", kind: "terrain", pos: [0, 8, 0], size: [64, 16, 64], rotY: 0,
      color: [.35, .5, .25], terrain: { ...defaultTerrain, preset: "flat", heightmap: {
        name: "ramp.png", resolution: 33,
        samples: Array.from({ length: 33 * 33 }, (_, i) => Math.round((i % 33) / 32 * 65535)),
      } },
    };
    const ramp = canvas.frame(width, height, encodeSoftwareFrame([terrain], camera, options), false);
    assert.equal(ramp.length, 8 + width * height * 4);
    assert.equal(new DataView(ramp.buffer, ramp.byteOffset, 8).getUint32(0, true), width);
    assert.equal(canvas.pick(width / 2, height / 2), terrain.id);
    const flat = canvas.frame(width, height, encodeSoftwareFrame([
      { ...terrain, terrain: { ...defaultTerrain, preset: "flat" } },
    ], camera, options), true);
    let changed = 0;
    for (let i = 8; i < ramp.length; i += 4) {
      if (ramp[i] !== flat[i] || ramp[i + 1] !== flat[i + 1] || ramp[i + 2] !== flat[i + 2]) changed++;
    }
    assert.ok(changed > width * height / 10, "imported heights must change the rendered geometry");
    assert.equal(canvas.pick(width / 2, height / 2), terrain.id, "capture preserves live picking");
    console.log(`Production terrain WASM passed: heightmap wire decoding, ${changed} changed pixels and picking.`);
  } finally { canvas.free(); }
} finally { rmSync(temporary, { recursive: true, force: true }); }
