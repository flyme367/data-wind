import { ByteBuffer } from "flatbuffers";
import { ModelAsset } from "../model-protocol/generated/data-wind/model/model-asset";
import { meshNode } from "./importGlb";

let runtime: Promise<typeof import("../wasm/model-importer/model_importer")> | undefined;
async function loadImporter() {
  runtime ??= import("../wasm/model-importer/model_importer").then(async (module) => {
    await module.default();
    return module;
  }).catch((error: unknown) => { runtime = undefined; throw error; });
  return runtime;
}

/** Convert exactly one model and its explicitly selected companion files in WebAssembly. */
export async function importModelFiles(files: File[]): Promise<{ bytes: Uint8Array; sourceName: string }> {
  const models = files.filter((file) => /\.(glb|gltf|obj|dwasset)$/i.test(file.name));
  if (models.length !== 1) throw new Error("请选择一个模型文件及其关联资源（或单独选择一个 .dwasset 文件）");
  const model = models[0];
  if (/\.dwasset$/i.test(model.name)) {
    if (files.length !== 1 || model.size > 80 * 1024 * 1024) throw new Error("请选择单个不超过 80 MiB 的资产文件");
    const bytes = new Uint8Array(await model.arrayBuffer());
    (await loadImporter()).validate_model_asset(bytes);
    return { bytes, sourceName: model.name };
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > 20_000_000) throw new Error("所选文件总大小不能超过 20 MB");
  const { ModelImporter } = await loadImporter();
  const importer = new ModelImporter();
  try {
    for (const file of files) importer.add_file(file.webkitRelativePath || file.name, new Uint8Array(await file.arrayBuffer()));
    const bytes = importer.convert(model.webkitRelativePath || model.name);
    return { bytes, sourceName: model.name };
  } finally { importer.free(); }
}

export async function verifyModelAsset(bytes: Uint8Array): Promise<void> {
  (await loadImporter()).validate_model_asset(bytes);
}

/** Call only after Rust has verified the buffer. */
export function modelAssetInfo(bytes: Uint8Array) {
  const root = ModelAsset.getRootAsModelAsset(new ByteBuffer(bytes));
  let triangles = 0;
  for (let i = 0; i < root.primitivesLength(); i++) triangles += (root.primitives(i)?.indicesLength() ?? 0) / 3;
  return { name: root.name() || "未命名模型", triangles, textures: root.texturesLength() };
}

const srgbToLinear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

function modelVertices(bytes: Uint8Array): number[] {
  const root = ModelAsset.getRootAsModelAsset(new ByteBuffer(bytes));
  const vertices: number[] = [];
  for (let i = 0; i < root.primitivesLength(); i++) {
    const primitive = root.primitives(i)!;
    const positions = primitive.positionsArray()!;
    const normals = primitive.normalsArray()!;
    const uv = primitive.texcoordsArray();
    const colors = primitive.colorsArray();
    const indices = primitive.indicesArray()!;
    const base = primitive.baseColorArray()!;
    const texture = primitive.textureIndex() < 0 ? null : root.textures(primitive.textureIndex());
    const pixels = texture?.rgbaArray();
    for (const index of indices) {
      const color = [base[0], base[1], base[2]];
      if (colors?.length) for (let channel = 0; channel < 3; channel++) color[channel] *= colors[index * 4 + channel];
      if (pixels && uv?.length && texture) {
        const u = ((uv[index * 2] % 1) + 1) % 1;
        const v = ((uv[index * 2 + 1] % 1) + 1) % 1;
        const x = Math.min(texture.width() - 1, Math.floor(u * texture.width()));
        const y = Math.min(texture.height() - 1, Math.floor(v * texture.height()));
        const offset = (y * texture.width() + x) * 4;
        for (let channel = 0; channel < 3; channel++) color[channel] *= srgbToLinear(pixels[offset + channel] / 255);
      }
      vertices.push(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2],
        normals[index * 3], normals[index * 3 + 1], normals[index * 3 + 2], ...color);
    }
  }
  return vertices;
}

/** Convert stored indexed geometry into the current editor's vertex-color renderer format. */
export function modelAssetSceneNode(bytes: Uint8Array, name: string) {
  return meshNode(name, modelVertices(bytes));
}

/** Retain bounds in source units for rendering multiple models in one scene. */
export function modelAssetGeometry(bytes: Uint8Array) {
  const root = ModelAsset.getRootAsModelAsset(new ByteBuffer(bytes));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  const names = new Set<string>();
  for (let i = 0; i < root.primitivesLength(); i++) {
    const primitive = root.primitives(i)!;
    const name = primitive.name();
    if (name) names.add(name);
    const positions = primitive.positionsArray()!;
    triangles += primitive.indicesLength() / 3;
    for (const index of primitive.indicesArray()!) for (let axis = 0; axis < 3; axis++) {
      const value = positions[index * 3 + axis]!;
      min[axis] = Math.min(min[axis]!, value);
      max[axis] = Math.max(max[axis]!, value);
    }
  }
  return { bytes, triangles, names, dimensions: max.map((value, i) => value - min[i]!),
    center: max.map((value, i) => (value + min[i]!) / 2) };
}
