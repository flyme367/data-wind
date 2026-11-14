import "fake-indexeddb/auto";
import { File as NodeFile } from "node:buffer";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initSync } from "../wasm/model-importer/model_importer";
import { initSync as initCpuSync, SoftwareCanvas } from "../wasm/cpu/data_wind_cpu.js";
import { importModelFiles, modelAssetGeometry, modelAssetInfo, modelAssetSceneNode } from "../engine/modelAsset";
import { applyKitSceneMaterials, kitSceneGeometry, loadPreviewGeometry, previewSceneFrame } from "../engine/kitScenePreview";
import { encodeSoftwareFrame } from "../engine/commands";
import type { SoftwareRenderer } from "../engine/softwareRenderer";
import { kitTexturePreviewAsset, type ReferenceKitPiece, type ReferenceKitWidget } from "../data/kitRuntime";
import { deleteModelAsset, getModelAsset, listModelAssets, saveModelAsset } from "../state/modelAssets";

beforeAll(() => {
  initSync({ module: readFileSync(new URL("../wasm/model-importer/model_importer_bg.wasm", import.meta.url)) });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("crypto", webcrypto);
});

function file(contents: Uint8Array | string, name: string): File {
  const data = typeof contents === "string" ? contents : Uint8Array.from(contents);
  return new NodeFile([data], name) as unknown as File;
}

describe("model import and asset library", () => {
  it("converts a real GLB in Wasm, stores and reopens it, and creates editor geometry", async () => {
    const input = readFileSync(new URL("../../model-sources/terrain-grass.glb", import.meta.url));
    const { bytes, sourceName } = await importModelFiles([file(input, "terrain-grass.glb")]);
    const info = modelAssetInfo(bytes);
    expect(info.name).toBe("terrain-grass");
    expect(info.triangles).toBeGreaterThan(0);
    const events = vi.fn();
    window.addEventListener("dw:model-assets", events);
    const saved = await saveModelAsset(bytes, sourceName);
    expect((await listModelAssets()).some((asset) => asset.id === saved.id)).toBe(true);
    const restored = await getModelAsset(saved.id);
    expect(restored).toEqual(bytes);
    const node = modelAssetSceneNode(restored, saved.name);
    expect(node.customMesh?.triangles).toBe(info.triangles);
    expect(atob(node.customMesh!.bytes).slice(0, 4)).toBe("DWM2");
    await deleteModelAsset(saved.id);
    expect((await listModelAssets()).some((asset) => asset.id === saved.id)).toBe(false);
    expect(events).toHaveBeenCalledTimes(2);
    window.removeEventListener("dw:model-assets", events);
  });

  it("imports indexed OBJ and rejects missing dependencies and corrupt assets", async () => {
    const obj = "v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nf 1/1 2/2 3/3\n";
    const { bytes } = await importModelFiles([file(obj, "triangle.obj")]);
    expect(modelAssetInfo(bytes).triangles).toBe(1);
    expect(modelAssetSceneNode(bytes, "triangle").customMesh?.triangles).toBe(1);
    await expect(importModelFiles([file(`mtllib missing.mtl\n${obj}`, "broken.obj")])).rejects.toBeTruthy();
    await expect(importModelFiles([file(new Uint8Array([1, 2, 3]), "bad.dwasset")])).rejects.toBeTruthy();
    await expect(saveModelAsset(new Uint8Array([1, 2, 3]), "bad.dwasset")).rejects.toBeTruthy();
  });

  it("loads the enabled models and saved cameras from the actual violet city template", async () => {
    const publicRoot = new URL("../../public/", import.meta.url);
    const source: ReferenceKitWidget = JSON.parse(
      readFileSync(new URL("kits/templates/violet-046-705.json", publicRoot), "utf8"),
    );
    const scene = kitSceneGeometry(source.pieces!);
    expect(scene.objects.map(item => item.label)).toEqual(["四川省修改尺寸3", "标记3"]);
    expect(scene.objects[0]!.url).not.toContain("3b40a83cc96a01e3e3fec13a9");
    expect(scene.otherModels).toBe(0);
    vi.stubGlobal("File", NodeFile);
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const data = readFileSync(new URL(String(input), publicRoot));
      return new Response(Uint8Array.from(data));
    });
    try {
      const models = await Promise.all(scene.objects.map(async ({ url }) =>
        [url, await loadPreviewGeometry(url, new AbortController().signal)] as const));
      const frame = previewSceneFrame(scene, new Map(models));
      expect(models.map(([, mesh]) => mesh.triangles)).toEqual([14885, 52]);
      expect(frame.instances).toHaveLength(2);
      expect(frame.instances[0]!.pos).not.toEqual(frame.instances[1]!.pos);
      expect(frame.cameras[0]?.name).toBe("适应模型");
      expect(frame.cameras.length).toBeGreaterThanOrEqual(4);
      const province = scene.objects[0]!.materials;
      expect(province["四川省_阿坝藏族羌族自治州边界线"]).toMatchObject({ emissive: [1, 0, 0], emissiveStrength: 0 });
      const albedo = "/kits/assets/5edeaac15d21135d153c7858eb190a06d57591e3e01039f29a92c95306044a1e.webp";
      expect(province["平面"]).toMatchObject({
        albedoMap: { url: `.${kitTexturePreviewAsset(albedo)}`, uvSet: 0, scale: [1, 1], level: 1.5 },
        opacityMap: { url: expect.stringContaining("5ada060b47"), uvSet: 0 },
      });
      expect(province["四川省_阿坝藏族羌族自治州"]).toMatchObject({
        normalMap: { url: expect.stringContaining("251992b34c"), uvSet: 0, level: .19 },
      });
      const materialPath = [0, 3, 0];
      const model = materialPath.reduce<ReferenceKitPiece>((piece, i) => piece.pieces![i]!, { type: "root", pieces: source.pieces });
      const groupIndex = model.pieces!.findIndex(piece => piece.type === "material-group");
      const group = model.pieces![groupIndex]!;
      const edgeIndex = group.pieces!.findIndex(piece => piece.name === "四川省_阿坝藏族羌族自治州边界线material");
      group.pieces![edgeIndex]!.statesOptions = { demo: { "material-alpha": .35, "albedo-color": "#0000ff" } };
      const changed = kitSceneGeometry(source.pieces!, { path: [...materialPath, groupIndex, edgeIndex].join("/"), state: "demo" });
      expect(changed.objects[0]!.materials["四川省_阿坝藏族羌族自治州边界线"])
        .toMatchObject({ alpha: .35, color: [0, 0, 1], emissive: [1, 0, 0] });
    } finally {
      fetch.mockRestore();
    }
  });

  it("renders the original Zhoushan model through its normalized OBJ3 preview", async () => {
    const publicRoot = new URL("../../public/", import.meta.url);
    const source: ReferenceKitWidget = JSON.parse(readFileSync(new URL(
      "kits/templates/spring-blue-007-7f1eef7d7542f8ec338f4e6dab1abd6e.json", publicRoot), "utf8"));
    const scene = kitSceneGeometry(source.pieces!);
    expect(scene.objects.map(item => item.label)).toEqual(["舟山模型"]);
    const { url } = scene.objects[0]!;
    expect(url.endsWith(".glb")).toBe(true);
    const { bytes } = await importModelFiles([file(readFileSync(new URL(url, publicRoot)), "zhoushan.glb")]);
    expect(modelAssetInfo(bytes).triangles).toBeGreaterThan(10_000);
    const model = modelAssetGeometry(bytes);
    expect(model.names.has("舟山平面")).toBe(true);
    const map = scene.objects[0]!.materials["舟山平面_primitive0"]?.albedoMap;
    expect(map).toBeDefined();
    const setModelMaterials = vi.fn();
    applyKitSceneMaterials({ setModelMaterials } as unknown as SoftwareRenderer, scene, new Map([[map!.url, 3]]), new Map([[url, model]]));
    expect(setModelMaterials.mock.calls[0]?.[1]).toMatchObject({ 舟山平面: { albedoMap: { id: 3, uvSet: 0 } } });
  });

  it("applies a kit material's replacement texture and UV offset, and picks through a black mask", async () => {
    const obj = "v -1 -1 0\nv 1 -1 0\nv 1 1 0\nv -1 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nf 1/1 2/2 3/3 4/4\n";
    const { bytes } = await importModelFiles([file(obj, "square.obj")]);
    initCpuSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const renderer = new SoftwareCanvas();
    try {
      renderer.register_model_asset("asset", bytes);
      const frame = encodeSoftwareFrame([{ id: "square", kind: "mesh", modelId: "asset", pos: [0, 0, 0],
        size: [1, 1, 1], rotY: 0, color: [1, 1, 1] }], { dist: 4, pitch: 0, yaw: 0, target: [0, 0, 0] },
      { grid: false, selectedId: null, time: 0 });
      const opaque = renderer.frame(96, 96, frame, false);
      expect(renderer.pick(48, 48)).toBe("square");
      const pixel = 8 + (48 * 96 + 48) * 4;
      const surface = { uvSet: 0, scale: [1, 1], offset: [0, 0], level: 1 };
      renderer.set_model_texture(2, 1, 1, new Uint8Array([0, 128, 128, 255]));
      renderer.set_model_materials("square", JSON.stringify({ "": { normalMap: { ...surface, id: 2 } } }));
      const mapped = renderer.frame(96, 96, frame, false);
      expect(mapped[pixel]).toBeLessThan(opaque[pixel]! - 5);
      renderer.set_model_materials("square", JSON.stringify({ "": { normalMap: { ...surface, id: 2, level: 0 } } }));
      expect(renderer.frame(96, 96, frame, false).slice(pixel, pixel + 4)).toEqual(opaque.slice(pixel, pixel + 4));
      renderer.set_model_materials("square", JSON.stringify({ "": { metallic: 1, roughness: 1 } }));
      const metal = renderer.frame(96, 96, frame, false);
      expect(metal[pixel]).toBeLessThan(opaque[pixel]! - 10);
      renderer.set_model_materials("square", JSON.stringify({ "": { metallic: 1, roughness: .25 } }));
      const polished = renderer.frame(96, 96, frame, false);
      expect(polished.slice(pixel, pixel + 4)).not.toEqual(metal.slice(pixel, pixel + 4));
      renderer.set_model_texture(3, 1, 1, new Uint8Array([255, 255, 0, 255]));
      renderer.set_model_materials("square", JSON.stringify({ "": { metallic: 1, roughness: 1, metallicMap: { ...surface, id: 3 } } }));
      expect(renderer.frame(96, 96, frame, false).slice(pixel, pixel + 4)).toEqual(opaque.slice(pixel, pixel + 4));
      renderer.set_model_texture(7, 2, 1, new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]));
      const map = { id: 7, uvSet: 0, scale: [1, 1], offset: [0.25, 0], level: 1 };
      renderer.set_model_materials("square", JSON.stringify({ "": { albedoMap: map } }));
      const green = renderer.frame(96, 96, frame, false);
      expect(green[pixel + 1]).toBeGreaterThan(100);
      expect(green[pixel]).toBeLessThan(60);
      renderer.set_model_texture(9, 1, 1, new Uint8Array([0, 0, 255, 255]));
      renderer.set_model_materials("square", JSON.stringify({ "": {
        strength: 0, disableLighting: true, emissiveMap: { ...map, id: 9 },
      } }));
      const emitted = renderer.frame(96, 96, frame, false);
      expect(emitted.slice(pixel, pixel + 4)).toEqual(new Uint8Array([0, 0, 255, 255]));
      renderer.set_model_texture(8, 1, 1, new Uint8Array([0, 0, 0, 255]));
      renderer.set_model_materials("square", JSON.stringify({ "": { opacityMap: { ...map, id: 8 }, opacityFromRgb: true } }));
      const masked = renderer.frame(96, 96, frame, false);
      expect(renderer.pick(48, 48)).toBeUndefined();
      renderer.set_model_materials("square", JSON.stringify({ "": { alpha: 0 } }));
      const transparent = renderer.frame(96, 96, frame, false);
      expect(renderer.pick(48, 48)).toBeUndefined();
      expect(masked.slice(pixel, pixel + 4)).toEqual(transparent.slice(pixel, pixel + 4));
      expect(transparent.slice(pixel, pixel + 4)).not.toEqual(opaque.slice(pixel, pixel + 4));
    } finally { renderer.free(); }
  });
});
