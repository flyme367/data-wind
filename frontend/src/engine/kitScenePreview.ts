import { kitColor, kitFileUrl, kitModelPreviewAsset, kitNumber, kitRecord, kitTexturePreviewAsset,
  type ReferenceKitPiece } from "../data/kitRuntime";
import type { FlatInstance } from "../types";
import { importModelFiles, modelAssetGeometry } from "./modelAsset";
import type { SoftCamera } from "./softwareRenderer";

type Vector = [number, number, number];
type Basis = [Vector, Vector, Vector];
type Transform = { origin: Vector; axes: Basis };
type PreviewMesh = ReturnType<typeof modelAssetGeometry>;

const MAX_INPUT_BYTES = 20_000_000;
const localModels = /^\.\/kits\/assets\/[a-f0-9]{64}\.(glb|obj3)$/;
const identity: Transform = { origin: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
const toRadians = Math.PI / 180;

export function previewModelUrl(source: unknown): string {
  const url = kitFileUrl(source);
  if (!localModels.test(url)) return "";
  const preview = kitModelPreviewAsset(url);
  return preview ? kitFileUrl(preview) : url.endsWith(".glb") ? url : "";
}

export async function loadPreviewGeometry(url: string, signal: AbortSignal): Promise<PreviewMesh> {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) throw new Error("读取模型资源失败");
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  const header = new Uint8Array(21);
  let size = 0;
  try {
    if (Number(response.headers.get("content-length")) > MAX_INPUT_BYTES) throw new Error("模型超过 20 MB");
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (size < header.length) {
        header.set(value.subarray(0, header.length - size), size);
        if (size + value.length >= header.length) {
          const bytes = new DataView(header.buffer);
          const firstJsonByte = header[20]!;
          if (bytes.getUint32(0) !== 0x676c5446 || bytes.getUint32(4, true) !== 2
              || bytes.getUint32(16) !== 0x4a534f4e || ![0x7b, 0x20, 0x09, 0x0a, 0x0d].includes(firstJsonByte)) {
            throw new Error("模型文件没有可读取的标准 GLB 数据");
          }
        }
      }
      size += value.byteLength;
      if (size > MAX_INPUT_BYTES) throw new Error("模型超过 20 MB");
      chunks.push(new Uint8Array(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (size < header.length) throw new Error("模型文件不完整");
  signal.throwIfAborted();
  const file = new File(chunks, url.split("/").at(-1) ?? "model.glb");
  const { bytes } = await importModelFiles([file]);
  signal.throwIfAborted();
  return modelAssetGeometry(bytes);
}

const vector = (value: unknown, fallback: Vector): Vector => Array.isArray(value)
  ? [kitNumber(value[0], fallback[0]), kitNumber(value[1], fallback[1]), kitNumber(value[2], fallback[2])] : fallback;
const add = (a: Vector, b: Vector): Vector => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const multiply = (a: Vector, b: number): Vector => [a[0] * b, a[1] * b, a[2] * b];
const cross = (a: Vector, b: Vector): Vector =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const linear = (m: Basis, v: number[]): Vector =>
  add(add(multiply(m[0], v[0]!), multiply(m[1], v[1]!)), multiply(m[2], v[2]!));
const point = (m: Transform, v: number[]) => add(m.origin, linear(m.axes, v));

function localTransform(parent: Transform, options: Record<string, unknown>): Transform {
  const [x, y, z] = vector(options.rotation, [0, 0, 0]).map(angle => angle * toRadians);
  const [cx, cy, cz] = [Math.cos(x), Math.cos(y), Math.cos(z)];
  const [sx, sy, sz] = [Math.sin(x), Math.sin(y), Math.sin(z)];
  const scale = vector(options.scaling, [1, 1, 1]);
  const axes: Basis = [
    [cy * cz + sy * sx * sz, cx * sz, -sy * cz + cy * sx * sz],
    [-cy * sz + sy * sx * cz, cx * cz, sy * sz + cy * sx * cz],
    [sy * cx, -sx, cy * cx],
  ];
  return { origin: point(parent, vector(options.position, [0, 0, 0])),
    axes: axes.map((axis, index) => linear(parent.axes, multiply(axis, scale[index]!))) as Basis };
}

const maps = [
  ["albedoMap", "albedo-texture", 3], ["opacityMap", "opacity-texture", 2],
  ["emissiveMap", "emissive-texture", 3], ["normalMap", "bump-texture", 1],
  ["metallicMap", "metallic-texture", 3],
] as const;
const imageSource = /^(?:data:image\/(?:png|webp|jpeg|gif|avif|apng);|https?:\/\/|\.?\/(?!\/))/i;
interface MaterialMap { url: string; uvSet: number; scale: [number, number]; offset: [number, number]; level: number }
interface MaterialOverride {
  color?: Vector; strength?: number; alpha?: number; alphaMode?: string; useTextureAlpha?: boolean;
  emissive?: Vector; emissiveStrength?: number; emissiveEnabled?: boolean;
  albedoMap?: MaterialMap; opacityMap?: MaterialMap; emissiveMap?: MaterialMap; opacityFromRgb?: boolean;
  normalMap?: MaterialMap; metallicMap?: MaterialMap; objectSpaceNormal?: boolean;
  roughness?: number; metallic?: number; f0?: number; unlit?: boolean;
  disableLighting?: boolean; backFaceCulling?: boolean;
}
interface PreviewObject {
  id: string; label: string; url: string; transform: Transform; materials: Record<string, MaterialOverride>;
}
interface PreviewCamera { name: string; pose: SoftCamera }
export interface KitSceneGeometry {
  objects: PreviewObject[];
  cameras: PreviewCamera[];
  background: string;
  daylight: number;
  otherModels: number;
  assetKey: string;
  textureKey: string;
}

function orbitCamera(options: Record<string, unknown>): SoftCamera | undefined {
  const preset = kitRecord(options["preset-perspectives"]);
  const indexes = Array.isArray(preset.indexes) ? preset.indexes : [];
  const initial = options["perspective-init"];
  const presetIndex = typeof initial === "string" && initial !== "" || typeof initial === "number";
  const selected = presetIndex ? indexes[Number(initial)] ?? initial : undefined;
  const saved = selected === undefined ? undefined : kitRecord(preset[String(selected)])["preset-perspective"];
  const hasFields = [options["camera-alpha"], options["camera-beta"], options["camera-radius"]]
    .every(value => typeof value === "number" && Number.isFinite(value));
  const current = options["perspective-vector"];
  const result = Array.isArray(saved) && saved.length >= 6 ? saved : hasFields
    ? [Number(options["camera-alpha"]) * toRadians, Number(options["camera-beta"]) * toRadians,
      options["camera-radius"], ...vector(options["camera-target"], [0, 0, 0])] : current;
  return orbitPose(result);
}

function orbitPose(value: unknown): SoftCamera | undefined {
  if (!Array.isArray(value) || value.length < 6 || !value.slice(0, 6).every(Number.isFinite) || value[2] <= 0) return;
  const [alpha, beta, dist, x, y, z] = value as [number, number, number, number, number, number];
  return { yaw: Math.PI / 2 - alpha, pitch: Math.PI / 2 - Math.max(.015, Math.min(Math.PI - .015, beta)),
    dist, target: [x, y, z] };
}

function linearColor(value: unknown): Vector | undefined {
  const hex = kitColor(value, "");
  if (!/^#[a-f\d]{6}/i.test(hex)) return;
  return [1, 3, 5].map(i => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  }) as Vector;
}

function previewMaterial(options: Record<string, unknown>, daytime: number): MaterialOverride {
  const result: MaterialOverride = {};
  const color = linearColor(options["albedo-color"]), emissive = linearColor(options["emissive-color"]);
  if (color) result.color = color;
  if (emissive) result.emissive = emissive;
  const strength = options["albedo-strength"], alpha = options["material-alpha"];
  if (typeof strength === "number" && Number.isFinite(strength)) result.strength = Math.min(50, Math.max(0, strength));
  if (typeof alpha === "number" && Number.isFinite(alpha)) result.alpha = Math.min(1, Math.max(0, alpha));
  const mode = options["opacity-texture-transparency-mode"];
  if (["0", "1", "2", "3"].includes(String(mode))) result.alphaMode = String(mode);
  if (typeof options["albedo-texture-has-alpha"] === "boolean") result.useTextureAlpha = options["albedo-texture-has-alpha"];
  const glow = options["glow-intensity"] ?? options["emissive-intensity"];
  if (typeof glow === "number" && Number.isFinite(glow)) result.emissiveStrength = Math.min(50, Math.max(0, glow));
  if (options["emissive-at-night"] === true) result.emissiveEnabled = daytime < 6 || daytime >= 18;
  const roughness = options.roughness, metallic = options.metallic, f0 = options["f0-factor"];
  if (typeof roughness === "number" && Number.isFinite(roughness)) result.roughness = Math.max(0, Math.min(1, roughness));
  if (typeof metallic === "number" && Number.isFinite(metallic)) result.metallic = Math.max(0, Math.min(1, metallic));
  if (typeof f0 === "number" && Number.isFinite(f0)) result.f0 = Math.max(0, Math.min(1, f0));
  if (typeof options.backFaceCulling === "boolean") result.backFaceCulling = options.backFaceCulling;
  if (options.disableLighting === true) result.disableLighting = true;
  if (options.unlit === true) result.unlit = true;
  if (options["bump-texture-space"] === "object") result.objectSpaceNormal = true;
  for (const [slot, prefix, maxLevel] of maps) {
    const source = kitFileUrl(options[prefix]);
    if (!imageSource.test(source)) continue;
    const url = source.startsWith("./kits/assets/") ? kitFileUrl(kitTexturePreviewAsset(source) ?? source) : source;
    const pair = (name: string, fallback: number): [number, number] => {
      const value = options[`${prefix}-${name}`];
      return Array.isArray(value) ? [kitNumber(value[0], fallback), kitNumber(value[1], fallback)] : [fallback, fallback];
    };
    const level = Math.min(maxLevel, Math.max(0, kitNumber(options[`${prefix}-level`], 1)));
    result[slot] = { url, uvSet: Math.max(0, Math.min(5, Math.trunc(kitNumber(options[`${prefix}-uvSet`])))),
      scale: pair("uvScale", 1), offset: pair("uvOffset", 0), level };
  }
  if (options["opacity-getAlphaFromRGB"] === true) result.opacityFromRgb = true;
  return result;
}

export function kitSceneGeometry(pieces: ReferenceKitPiece[], edit?: { path: string; state: string }): KitSceneGeometry {
  const result: KitSceneGeometry = {
    objects: [], cameras: [], background: "#101822", daylight: 1, otherModels: 0, assetKey: "", textureKey: "",
  };
  const effectiveOptions = (piece: ReferenceKitPiece, path: string) => ({
    ...piece.options, ...(edit?.path === path ? piece.statesOptions?.[edit.state] : undefined),
  });
  const walk = (items: ReferenceKitPiece[], parent: Transform, path: string, depth: number, daytime: number) => {
    if (depth > 32) return;
    items.forEach((piece, index) => {
      const id = path ? `${path}/${index}` : String(index);
      const options = effectiveOptions(piece, id);
      if (options.enable === false || options.visible === false) return;
      const transform = localTransform(parent, options);
      const label = piece.name || piece.type;
      if (piece.type === "gltf") {
        const url = previewModelUrl(options.model);
        if (url) {
          const materials = new Map<string, MaterialOverride>();
          const readMaterials = (children: ReferenceKitPiece[], parentPath: string, level: number) => {
            if (level > 32) return;
            children.forEach((child, at) => {
              const childPath = `${parentPath}/${at}`, materialOptions = effectiveOptions(child, childPath);
              if (materialOptions.enable === false || materialOptions.visible === false) return;
              if (child.type === "material-group") readMaterials(child.pieces ?? [], childPath, level + 1);
              if (child.type !== "pbr-material") return;
              const material = previewMaterial(materialOptions, daytime);
              if (Object.keys(material).length) materials.set(child.name?.replace(/\s*material\s*$/i, "") ?? "", material);
            });
          };
          readMaterials(piece.pieces ?? [], id, depth);
          result.objects.push({ id, label, url, transform, materials: Object.fromEntries(materials) });
        } else if (kitFileUrl(options.model)) result.otherModels++;
        return;
      }
      if (piece.type === "arc-rotate-camera") {
        const current = orbitCamera(options);
        if (current) result.cameras.push({ name: label, pose: current });
        const presets = kitRecord(options["preset-perspectives"]);
        for (const item of Array.isArray(presets.indexes) ? presets.indexes : []) {
          const preset = kitRecord(presets[String(item)]);
          const pose = orbitPose(preset["preset-perspective"]);
          if (pose) result.cameras.push({ name: String(preset["preset-perspective-name"] || label), pose });
        }
      }
      if (piece.type === "sky") result.background = kitColor(options["sky-color"], result.background);
      const hour = piece.type === "scene" ? kitNumber(options.daytime, 12) : daytime;
      if (piece.type === "scene") result.daylight = .24 + .76 * Math.max(0, Math.sin((hour - 6) * Math.PI / 12));
      if (piece.pieces) walk(piece.pieces, transform, id, depth + 1, hour);
    });
  };
  walk(pieces, identity, "", 0, 12);
  result.assetKey = JSON.stringify([...new Set(result.objects.map(item => item.url))]);
  const urls = new Set<string>();
  for (const object of result.objects) for (const material of Object.values(object.materials)) {
    for (const [slot] of maps) if (material[slot]) urls.add(material[slot]!.url);
  }
  result.textureKey = JSON.stringify([...urls]);
  return result;
}

export function previewSceneFrame(scene: KitSceneGeometry, models: ReadonlyMap<string, PreviewMesh>) {
  const min: Vector = [Infinity, Infinity, Infinity], max: Vector = [-Infinity, -Infinity, -Infinity];
  const instances: FlatInstance[] = [];
  for (const model of scene.objects) {
    const mesh = models.get(model.url);
    if (!mesh) continue;
    const { axes } = model.transform;
    const position = point(model.transform, mesh.center);
    const scale = axes.map(axis => Math.hypot(...axis));
    if (scale.some(value => !Number.isFinite(value) || value < 1e-9)
        || position.some(value => !Number.isFinite(value))) continue;
    const normalized = axes.map((axis, index) => multiply(axis, 1 / scale[index]!)) as Basis;
    const product = cross(normalized[0], normalized[1]);
    if (product.some((value, i) => Math.abs(value - normalized[2][i]!) > .001)
        && product.some((value, i) => Math.abs(value + normalized[2][i]!) > .001)) continue;
    const mirrored = product[0] * normalized[2][0] + product[1] * normalized[2][1] + product[2] * normalized[2][2] < 0;
    if (mirrored) {
      normalized[2] = multiply(normalized[2], -1);
      scale[2] = -scale[2]!;
    }
    const pitch = Math.asin(Math.min(1, Math.max(-1, -normalized[2][1])));
    const gimbal = Math.abs(Math.cos(pitch)) < 1e-6;
    const yaw = gimbal ? Math.atan2(-normalized[0][2], normalized[0][0])
      : Math.atan2(normalized[2][0], normalized[2][2]);
    const roll = gimbal ? 0 : Math.atan2(normalized[0][1], normalized[1][1]);
    const size = scale as Vector;
    instances.push({ id: model.id, kind: "mesh", modelId: model.url, pos: model.transform.origin, size, rotY: yaw,
      rotation: [pitch, yaw, roll], color: [1, 1, 1] });
    for (let i = 0; i < 3; i++) {
      const extent = axes.reduce((radius, axis, at) => radius + Math.abs(axis[i]!) * mesh.dimensions[at]! / 2, 0);
      min[i] = Math.min(min[i]!, position[i]! - extent);
      max[i] = Math.max(max[i]!, position[i]! + extent);
    }
  }
  if (!instances.length) return { instances, cameras: [] };
  const center = max.map((value, i) => value * .5 + min[i]! * .5) as Vector;
  const bounds = Math.max(...max.map((value, i) => value - min[i]!), .001);
  const maxDistance = Math.max(bounds, ...scene.cameras.map(item => item.pose.dist + Math.hypot(
    ...item.pose.target.map((value, index) => value - center[index]!))));
  const scale = 15 / maxDistance;
  const normalize = (value: Vector) => multiply(value.map((part, index) => part - center[index]!) as Vector, scale);
  const fit: SoftCamera = { target: [0, 0, 0], yaw: .65, pitch: .45, dist: Math.max(.45, bounds * scale * 2.2) };
  const cameras = [{ name: "适应模型", pose: fit }, ...scene.cameras.map(item => ({
    name: item.name, pose: { ...item.pose, target: normalize(item.pose.target), dist: Math.max(.25, item.pose.dist * scale) },
  }))];
  for (const instance of instances) {
    instance.pos = normalize(instance.pos);
    instance.size = multiply(instance.size, scale);
  }
  return { instances, cameras };
}

export async function loadKitSceneTextures(renderer: import("./softwareRenderer").SoftwareRenderer,
  textureKey: string, signal: AbortSignal) {
  const urls = JSON.parse(textureKey) as string[];
  const loaded = new Map<string, number>();
  if (!urls.length) return loaded;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return loaded;
  for (const [id, url] of urls.entries()) {
    signal.throwIfAborted();
    try {
      const request = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
      const response = await fetch(url, { signal: request });
      if (!response.ok) continue;
      if (Number(response.headers.get("content-length")) > MAX_INPUT_BYTES) {
        await response.body?.cancel();
        continue;
      }
      const blob = await response.blob();
      if (blob.size > MAX_INPUT_BYTES || !/^image\/(?:png|webp|jpeg|gif|avif|apng)$/i.test(blob.type)) continue;
      const image = await createImageBitmap(blob);
      try {
        signal.throwIfAborted();
        const scale = Math.min(1, 1536 / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
        renderer.setModelTexture(id, canvas.width, canvas.height, new Uint8Array(rgba.buffer));
        loaded.set(url, id);
      } finally { image.close(); }
    } catch { signal.throwIfAborted(); }
  }
  return loaded;
}

export function applyKitSceneMaterials(renderer: import("./softwareRenderer").SoftwareRenderer, scene: KitSceneGeometry,
  textures: ReadonlyMap<string, number>, models: ReadonlyMap<string, PreviewMesh>) {
  for (const object of scene.objects) {
    const names = models.get(object.url)?.names;
    const materials = Object.entries(object.materials).map(([name, original]) => {
      const { albedoMap: _albedo, opacityMap: _opacity, emissiveMap: _emissive,
        normalMap: _normal, metallicMap: _metallic, ...settings } = original;
      const bound = Object.fromEntries(maps.flatMap(([slot]) => {
        const map = original[slot];
        if (!map) return [];
        const { url, ...coordinates } = map;
        const id = textures.get(url);
        return id === undefined ? [] : [[slot, { ...coordinates, id }]];
      }));
      // gltfpack can merge source primitives that share a material into one named node.
      const nodeName = name.replace(/_primitive0$/, "");
      const target = names?.has(name) || !names?.has(nodeName) || Object.hasOwn(object.materials, nodeName)
        ? name : nodeName;
      return [target, { ...settings, ...bound }];
    });
    renderer.setModelMaterials(object.id, Object.fromEntries(materials));
  }
}

export async function drawKitScene(scene: KitSceneGeometry, size: { width: number; height: number }, signal: AbortSignal) {
  const models = new Map<string, PreviewMesh>();
  for (const url of new Set(scene.objects.map(model => model.url))) {
    try { models.set(url, await loadPreviewGeometry(url, signal)); }
    catch { signal.throwIfAborted(); }
  }
  const frame = previewSceneFrame(scene, models);
  if (!frame.instances.length) return;
  const { SoftwareRenderer } = await import("./softwareRenderer");
  signal.throwIfAborted();
  const canvas = document.createElement("canvas");
  const renderer = await SoftwareRenderer.create(canvas);
  try {
    signal.throwIfAborted();
    for (const [id, model] of models) renderer.registerModelAsset(id, model.bytes);
    const textures = await loadKitSceneTextures(renderer, scene.textureKey, signal);
    applyKitSceneMaterials(renderer, scene, textures, models);
    renderer.resize(size.width, size.height);
    renderer.render(frame.instances, (frame.cameras[1] ?? frame.cameras[0])!.pose, {
      grid: false, selectedId: null, time: 0, background: scene.background, daylight: scene.daylight,
    });
    return canvas;
  } finally {
    renderer.dispose();
  }
}
