import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { initSync, SoftwareCanvas } from "../src/wasm/cpu/data_wind_cpu.js";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(join(tmpdir(), "data-wind-water-wasm-"));
try {
  const entry = join(temporary, "fixture.ts");
  writeFileSync(entry, `export { encodeSoftwareFrame } from ${JSON.stringify(join(frontend, "src/engine/commands.ts"))};\nexport { waterNode, waterPresets } from ${JSON.stringify(join(frontend, "src/data/water.ts"))};\n`);
  await build({ configFile: false, root: frontend, logLevel: "error", build: {
    outDir: join(temporary, "build"), minify: false,
    lib: { entry, formats: ["es"], fileName: () => "fixture.mjs" },
  } });
  const { encodeSoftwareFrame, waterNode, waterPresets } = await import(pathToFileURL(join(temporary, "build/fixture.mjs")));
  initSync({ module: readFileSync(join(frontend, "src/wasm/cpu/data_wind_cpu_bg.wasm")) });
  const canvas = new SoftwareCanvas();
  try {
    const width = 384, height = 256;
    const camera = { target: [0, .3, 0], yaw: .65, pitch: .65, dist: 48 };
    const options = { grid: false, selectedId: null, time: 0, background: "#101a2c", daylight: 1 };
    for (const preset of waterPresets) {
      const body = { id: `water-${preset.id}`, kind: "water", pos: [0, .3, 0], size: [32, 2, 32], rotY: 0,
        color: [.1, .5, .65], water: waterNode(preset.id).water };
      const empty = canvas.frame(width, height, encodeSoftwareFrame([], camera, options), true).slice();
      const pixels = canvas.frame(width, height, encodeSoftwareFrame([body], camera, options), false).slice();
      assert.equal(pixels.length, 8 + width * height * 4);
      let changed = 0;
      for (let i = 8; i < pixels.length; i += 4) {
        if (pixels[i] !== empty[i] || pixels[i + 1] !== empty[i + 1] || pixels[i + 2] !== empty[i + 2]) changed++;
      }
      assert.ok(changed > 500, `${preset.name} must render through the production WASM (${changed} pixels)`);
      assert.equal(canvas.pick(width / 2, height / 2), body.id, `${preset.name} picking`);
      const later = canvas.frame(width, height, encodeSoftwareFrame([body], camera, { ...options, time: 2 }), false).slice();
      assert.notDeepEqual(later, pixels, `${preset.name} animated surface`);
      canvas.frame(width, height, encodeSoftwareFrame([], camera, options), true);
      assert.equal(canvas.pick(width / 2, height / 2), body.id, "capture preserves live hit state");
      console.log(`${preset.name}: ${changed} water pixels, animation, picking and capture verified.`);
    }
  } finally { canvas.free(); }
} finally { rmSync(temporary, { recursive: true, force: true }); }
