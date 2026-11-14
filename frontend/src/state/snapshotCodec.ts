// 项目快照（ProjectSnapshot / ProjectIndex）与 FlatBuffers 二进制的互转。
// 纯格式层：不做业务校验——decode 产物交给 projects.ts 里既有的 validateScene /
// validateEditorSettings 守卫；JsonValue 编解码复用 engine/commands.ts 的实现。
import * as flatbuffers from "flatbuffers";
import {
  CustomMeshSnapshot, JsonValue, ProjectIndex, ProjectMetaSnapshot, ProjectSnapshot,
  SceneNodeSnapshot, SceneNodeType, SceneWidgetSnapshot, SnapshotVec3,
  WidgetStateSnapshot, WidgetStyle,
} from "../protocol/generated/data-wind-protocol";
import { readJsonValue, writeJsonValue } from "../engine/commands";
import type { ProjectMeta } from "./projects";
import type { WidgetConfig } from "../data/editor";
import type { SceneNode, Vec3 } from "../types";

export const SNAPSHOT_VERSION = 1;
const FILE_IDENTIFIER = "DWPR";

/// 与 schema 中 SceneNodeType 枚举顺序一一对应。
const SCENE_TYPES = ["group", "model", "marker", "flyline", "fence", "light", "camera", "widget", "terrain", "water"] as const;

export interface SnapshotPayload {
  name: string;
  savedAt: number;
  boardSize: { width: number; height: number };
  scene: SceneNode[];
  /** EditorSettings 的 JSON 形态；校验由读取端完成 */
  settings: unknown;
  params: unknown;
}

// ---------------------------------------------------------------- 编码 ----

function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function writeVec3(builder: flatbuffers.Builder, v: Vec3): flatbuffers.Offset {
  return SnapshotVec3.createSnapshotVec3(builder, v.x, v.y, v.z);
}

function writeCustomMesh(builder: flatbuffers.Builder, mesh: NonNullable<SceneNode["customMesh"]>): flatbuffers.Offset {
  const bytes = builder.createByteVector(base64ToBytes(mesh.bytes));
  const sourceName = builder.createString(mesh.sourceName);
  CustomMeshSnapshot.startCustomMeshSnapshot(builder);
  CustomMeshSnapshot.addBytes(builder, bytes);
  CustomMeshSnapshot.addTriangles(builder, mesh.triangles);
  CustomMeshSnapshot.addSourceName(builder, sourceName);
  return CustomMeshSnapshot.endCustomMeshSnapshot(builder);
}

function writeWidget(builder: flatbuffers.Builder, widget: WidgetConfig): flatbuffers.Offset {
  const strings = ["kind", "text", "value", "unit", "background", "borderColor", "image", "align",
    "fontFamily", "borderStyle", "shadowColor"] as const;
  const offsets = Object.fromEntries(strings.map((key) => [key, builder.createString(String(widget[key] ?? ""))]));
  const style = WidgetStyle.createWidgetStyle(builder,
    offsets.kind, offsets.text, offsets.value, offsets.unit, widget.fontSize, offsets.background,
    offsets.borderColor, widget.opacity, widget.radius, offsets.image, offsets.align, offsets.fontFamily,
    widget.fontWeight, widget.italic, widget.underline, widget.lineHeight, widget.letterSpacing,
    offsets.borderStyle, widget.borderWidth, offsets.shadowColor, widget.shadowBlur,
    widget.shadowOffsetX, widget.shadowOffsetY);
  const states = (widget.states ?? []).map((state) => {
    const id = builder.createString(state.id);
    const name = builder.createString(state.name);
    const patch = writeJsonValue(builder, state.patch ?? {});
    WidgetStateSnapshot.startWidgetStateSnapshot(builder);
    WidgetStateSnapshot.addId(builder, id);
    WidgetStateSnapshot.addName(builder, name);
    WidgetStateSnapshot.addPatch(builder, patch);
    return WidgetStateSnapshot.endWidgetStateSnapshot(builder);
  });
  const statesVector = states.length ? SceneWidgetSnapshot.createStatesVector(builder, states) : undefined;
  SceneWidgetSnapshot.startSceneWidgetSnapshot(builder);
  SceneWidgetSnapshot.addStyle(builder, style);
  if (statesVector !== undefined) SceneWidgetSnapshot.addStates(builder, statesVector);
  return SceneWidgetSnapshot.endSceneWidgetSnapshot(builder);
}

function writeSceneNode(builder: flatbuffers.Builder, node: SceneNode): flatbuffers.Offset {
  const id = builder.createString(node.id);
  const name = builder.createString(node.name);
  const parentId = builder.createString(node.parentId ?? "");
  const color = builder.createString(node.color);
  const position = writeVec3(builder, node.transform.position);
  const rotation = writeVec3(builder, node.transform.rotation);
  const scale = writeVec3(builder, node.transform.scale);
  const boxSize = node.boxSize ? writeVec3(builder, node.boxSize) : undefined;
  const to = node.to ? writeVec3(builder, node.to) : undefined;
  const modelId = node.modelId !== undefined ? builder.createString(node.modelId) : undefined;
  const customMesh = node.customMesh ? writeCustomMesh(builder, node.customMesh) : undefined;
  const boardPageId = node.boardPageId !== undefined ? builder.createString(node.boardPageId) : undefined;
  const widget = node.widget ? writeWidget(builder, node.widget) : undefined;
  const data = node.data !== undefined ? writeJsonValue(builder, node.data) : undefined;
  const dataSource = node.dataSource !== undefined ? writeJsonValue(builder, node.dataSource) : undefined;
  const sharedDataSourceId = node.sharedDataSourceId !== undefined ? builder.createString(node.sharedDataSourceId) : undefined;
  const bindings = node.bindings !== undefined ? writeJsonValue(builder, node.bindings) : undefined;
  const interactions = node.interactions !== undefined ? writeJsonValue(builder, node.interactions) : undefined;
  const terrain = node.terrain !== undefined ? writeJsonValue(builder, node.terrain) : undefined;
  const water = node.water !== undefined ? writeJsonValue(builder, node.water) : undefined;

  SceneNodeSnapshot.startSceneNodeSnapshot(builder);
  SceneNodeSnapshot.addId(builder, id);
  SceneNodeSnapshot.addName(builder, name);
  SceneNodeSnapshot.addType(builder, Math.max(0, SCENE_TYPES.indexOf(node.type)) as SceneNodeType);
  SceneNodeSnapshot.addVisible(builder, node.visible);
  SceneNodeSnapshot.addLocked(builder, node.locked);
  SceneNodeSnapshot.addParentId(builder, parentId);
  SceneNodeSnapshot.addColor(builder, color);
  SceneNodeSnapshot.addPosition(builder, position);
  SceneNodeSnapshot.addRotation(builder, rotation);
  SceneNodeSnapshot.addScale(builder, scale);
  if (boxSize !== undefined) SceneNodeSnapshot.addBoxSize(builder, boxSize);
  if (to !== undefined) SceneNodeSnapshot.addTo(builder, to);
  if (node.lightIntensity !== undefined) SceneNodeSnapshot.addLightIntensity(builder, node.lightIntensity);
  if (modelId !== undefined) SceneNodeSnapshot.addModelId(builder, modelId);
  if (customMesh !== undefined) SceneNodeSnapshot.addCustomMesh(builder, customMesh);
  if (boardPageId !== undefined) SceneNodeSnapshot.addBoardPageId(builder, boardPageId);
  if (widget !== undefined) SceneNodeSnapshot.addWidget(builder, widget);
  if (data !== undefined) SceneNodeSnapshot.addData(builder, data);
  if (dataSource !== undefined) SceneNodeSnapshot.addDataSource(builder, dataSource);
  if (sharedDataSourceId !== undefined) SceneNodeSnapshot.addSharedDataSourceId(builder, sharedDataSourceId);
  if (bindings !== undefined) SceneNodeSnapshot.addBindings(builder, bindings);
  if (interactions !== undefined) SceneNodeSnapshot.addInteractions(builder, interactions);
  if (terrain !== undefined) SceneNodeSnapshot.addTerrain(builder, terrain);
  if (water !== undefined) SceneNodeSnapshot.addWater(builder, water);
  return SceneNodeSnapshot.endSceneNodeSnapshot(builder);
}

export function encodeProjectSnapshot(payload: SnapshotPayload): Uint8Array {
  const builder = new flatbuffers.Builder(1024);
  const name = builder.createString(payload.name);
  const scene = ProjectSnapshot.createSceneVector(builder, payload.scene.map((node) => writeSceneNode(builder, node)));
  const settings = writeJsonValue(builder, payload.settings ?? null);
  const params = writeJsonValue(builder, payload.params ?? null);
  ProjectSnapshot.startProjectSnapshot(builder);
  ProjectSnapshot.addVersion(builder, SNAPSHOT_VERSION);
  ProjectSnapshot.addSavedAt(builder, BigInt(payload.savedAt));
  ProjectSnapshot.addName(builder, name);
  ProjectSnapshot.addBoardWidth(builder, payload.boardSize.width);
  ProjectSnapshot.addBoardHeight(builder, payload.boardSize.height);
  ProjectSnapshot.addScene(builder, scene);
  ProjectSnapshot.addSettings(builder, settings);
  ProjectSnapshot.addParams(builder, params);
  builder.finish(ProjectSnapshot.endProjectSnapshot(builder), FILE_IDENTIFIER);
  // asUint8Array() 是 builder 大缓冲上的视图，必须 compact：调用方会把 .buffer 直接 transfer/入库
  return builder.asUint8Array().slice();
}

function writeProjectMeta(builder: flatbuffers.Builder, project: ProjectMeta): flatbuffers.Offset {
  const optional = (value: string | undefined) => (value === undefined ? builder.createString("") : builder.createString(value));
  const id = builder.createString(project.id);
  const name = builder.createString(project.name);
  const template = optional(project.template);
  const folder = optional(project.folder);
  const thumbnail = optional(project.thumbnail);
  ProjectMetaSnapshot.startProjectMetaSnapshot(builder);
  ProjectMetaSnapshot.addId(builder, id);
  ProjectMetaSnapshot.addName(builder, name);
  ProjectMetaSnapshot.addCreatedAt(builder, BigInt(project.createdAt));
  ProjectMetaSnapshot.addOpenedAt(builder, BigInt(project.openedAt));
  if (project.updatedAt !== undefined) ProjectMetaSnapshot.addUpdatedAt(builder, BigInt(project.updatedAt));
  if (project.template !== undefined) ProjectMetaSnapshot.addTemplate(builder, template);
  if (project.folder !== undefined) ProjectMetaSnapshot.addFolder(builder, folder);
  if (project.thumbnail !== undefined) ProjectMetaSnapshot.addThumbnail(builder, thumbnail);
  if (project.trashedAt !== undefined) ProjectMetaSnapshot.addTrashedAt(builder, BigInt(project.trashedAt));
  if (project.publishedAt !== undefined) ProjectMetaSnapshot.addPublishedAt(builder, BigInt(project.publishedAt));
  return ProjectMetaSnapshot.endProjectMetaSnapshot(builder);
}

export function encodeProjectIndex(projects: ProjectMeta[]): Uint8Array {
  const builder = new flatbuffers.Builder(256);
  const items = ProjectIndex.createProjectsVector(builder, projects.map((project) => writeProjectMeta(builder, project)));
  ProjectIndex.startProjectIndex(builder);
  ProjectIndex.addVersion(builder, SNAPSHOT_VERSION);
  ProjectIndex.addProjects(builder, items);
  builder.finish(ProjectIndex.endProjectIndex(builder), FILE_IDENTIFIER);
  return builder.asUint8Array().slice();
}

// ---------------------------------------------------------------- 解码 ----

function readVec3(v: SnapshotVec3): Vec3 {
  return { x: v.x(), y: v.y(), z: v.z() };
}

function readWidget(widget: SceneWidgetSnapshot): WidgetConfig {
  const style = widget.style();
  if (!style) throw new Error("快照组件缺少样式表");
  const result = {
    kind: style.kind() as WidgetConfig["kind"], text: style.text() ?? "", value: style.value() ?? "",
    unit: style.unit() ?? "", fontSize: style.fontSize(), background: style.background() ?? "",
    borderColor: style.borderColor() ?? "", opacity: style.opacity(), radius: style.radius(),
    image: style.image() ?? "", align: (style.align() ?? "left") as WidgetConfig["align"],
    fontFamily: style.fontFamily() ?? "", fontWeight: style.fontWeight(), italic: style.italic(),
    underline: style.underline(), lineHeight: style.lineHeight(), letterSpacing: style.letterSpacing(),
    borderStyle: (style.borderStyle() ?? "none") as WidgetConfig["borderStyle"], borderWidth: style.borderWidth(),
    shadowColor: style.shadowColor() ?? "", shadowBlur: style.shadowBlur(),
    shadowOffsetX: style.shadowOffsetX(), shadowOffsetY: style.shadowOffsetY(),
  } as WidgetConfig;
  const states: WidgetConfig["states"] = [];
  for (let i = 0, count = widget.statesLength(); i < count; i += 1) {
    const state = widget.states(i, new WidgetStateSnapshot());
    if (!state?.id()) continue;
    states.push({ id: state.id()!, name: state.name() ?? "", patch: readJsonValue(state.patch(new JsonValue())!) as Partial<WidgetConfig> });
  }
  if (states.length) result.states = states;
  return result;
}

function readSceneNode(node: SceneNodeSnapshot): SceneNode {
  const position = node.position(new SnapshotVec3());
  const rotation = node.rotation(new SnapshotVec3());
  const scale = node.scale(new SnapshotVec3());
  if (!position || !rotation || !scale) throw new Error("快照节点缺少变换表");
  const result: SceneNode = {
    id: node.id()!, name: node.name() ?? "", type: SCENE_TYPES[node.type()] ?? "group",
    visible: node.visible(), locked: node.locked(),
    transform: { position: readVec3(position), rotation: readVec3(rotation), scale: readVec3(scale) },
    color: node.color() ?? "", parentId: node.parentId() || null,
  };
  const boxSize = node.boxSize(new SnapshotVec3());
  if (boxSize) result.boxSize = readVec3(boxSize);
  const to = node.to(new SnapshotVec3());
  if (to) result.to = readVec3(to);
  const lightIntensity = node.lightIntensity();
  if (lightIntensity >= 0) result.lightIntensity = lightIntensity;
  if (node.modelId()) result.modelId = node.modelId()!;
  const mesh = node.customMesh(new CustomMeshSnapshot());
  if (mesh) {
    result.customMesh = {
      bytes: bytesToBase64(mesh.bytesArray() ?? new Uint8Array()),
      triangles: mesh.triangles(), sourceName: mesh.sourceName() ?? "",
    };
  }
  if (node.boardPageId()) result.boardPageId = node.boardPageId()!;
  const widget = node.widget(new SceneWidgetSnapshot());
  if (widget) result.widget = readWidget(widget);
  const data = node.data(new JsonValue());
  if (data) result.data = readJsonValue(data) as Record<string, unknown>;
  const dataSource = node.dataSource(new JsonValue());
  if (dataSource) result.dataSource = readJsonValue(dataSource) as SceneNode["dataSource"];
  if (node.sharedDataSourceId()) result.sharedDataSourceId = node.sharedDataSourceId()!;
  const bindings = node.bindings(new JsonValue());
  if (bindings) result.bindings = readJsonValue(bindings) as Record<string, string>;
  const interactions = node.interactions(new JsonValue());
  if (interactions) result.interactions = readJsonValue(interactions) as SceneNode["interactions"];
  const terrain = node.terrain(new JsonValue());
  if (terrain) result.terrain = readJsonValue(terrain) as SceneNode["terrain"];
  const water = node.water(new JsonValue());
  if (water) result.water = readJsonValue(water) as SceneNode["water"];
  return result;
}

/** 校验 DWPR 魔数（finish 时写入的 file_identifier），快速拒绝异构/截穿缓冲。 */
function requireMagic(bytes: Uint8Array): void {
  if (bytes.length < 8 || new TextDecoder().decode(bytes.subarray(4, 8)) !== FILE_IDENTIFIER) {
    throw new Error("项目快照格式无效");
  }
}

function snapshotRoot(bytes: Uint8Array): ProjectSnapshot {
  requireMagic(bytes);
  const root = ProjectSnapshot.getRootAsProjectSnapshot(new flatbuffers.ByteBuffer(bytes));
  if (root.version() !== SNAPSHOT_VERSION) throw new Error(`不支持的快照版本 ${root.version()}`);
  return root;
}

export interface SnapshotHeader { name: string; savedAt: number; boardSize: { width: number; height: number } }

/** 只解码标量头（name/savedAt/boardSize）——FlatBuffers 随机访问，大字段零成本。 */
export function decodeSnapshotHeader(bytes: Uint8Array): SnapshotHeader {
  const root = snapshotRoot(bytes);
  return { name: root.name() ?? "", savedAt: Number(root.savedAt()), boardSize: { width: root.boardWidth(), height: root.boardHeight() } };
}

// 2026-11-14 kits 位图全量迁移 webp：老快照里的 /kits/(assets|thumbs)/<内容哈希>.png|.jpg
// 引用按同哈希改指 .webp（迁移脚本保留哈希只换扩展名，故可直接重写）。
const legacyKitImage = /^((?:\.{1,2})?\/)?(kits\/(?:assets|thumbs)\/[a-f0-9]{64})\.(?:png|jpe?g)$/;
/** 深度重写 kits 旧 png/jpg 引用为 webp（快照解码与 legacy 迁移共用）。 */
export const migrateLegacyKitImages = (value: unknown): unknown => {
  if (typeof value === "string") {
    const match = legacyKitImage.exec(value);
    return match ? `${match[1] ?? ""}${match[2]}.webp` : value;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = migrateLegacyKitImages(value[i]);
    return value;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      (value as Record<string, unknown>)[key] = migrateLegacyKitImages((value as Record<string, unknown>)[key]);
    }
    return value;
  }
  return value;
};

/** 只解码场景树；decode 不做业务校验，产物交 validateScene 把关。 */
export function decodeSnapshotScene(bytes: Uint8Array): SceneNode[] {
  const root = snapshotRoot(bytes);
  const scene: SceneNode[] = [];
  for (let i = 0, count = root.sceneLength(); i < count; i += 1) {
    const node = root.scene(i, new SceneNodeSnapshot());
    if (node) scene.push(migrateLegacyKitImages(readSceneNode(node)) as SceneNode);
  }
  return scene;
}

/** 只解码 settings/params 两个 JsonValue 字段。 */
export function decodeSnapshotState(bytes: Uint8Array): { settings: unknown; params: unknown } {
  const root = snapshotRoot(bytes);
  const settings = root.settings(new JsonValue());
  const params = root.params(new JsonValue());
  return {
    settings: settings ? migrateLegacyKitImages(readJsonValue(settings)) as Record<string, unknown> : null,
    params: params ? migrateLegacyKitImages(readJsonValue(params)) : null,
  };
}

/** 整包解码（组合上面三段）；加载热路径请用字段级解码器。 */
export function decodeProjectSnapshot(bytes: Uint8Array): SnapshotPayload {
  return {
    ...decodeSnapshotHeader(bytes),
    scene: decodeSnapshotScene(bytes),
    ...decodeSnapshotState(bytes),
  };
}

const timestamp = (value: bigint) => (value > 0n ? Number(value) : undefined);
const optionalText = (value: string | null) => (value ? value : undefined);

export function decodeProjectIndex(bytes: Uint8Array): ProjectMeta[] {
  requireMagic(bytes);
  const root = ProjectIndex.getRootAsProjectIndex(new flatbuffers.ByteBuffer(bytes));
  if (root.version() !== SNAPSHOT_VERSION) throw new Error(`不支持的索引版本 ${root.version()}`);
  const projects: ProjectMeta[] = [];
  for (let i = 0, count = root.projectsLength(); i < count; i += 1) {
    const meta = root.projects(i, new ProjectMetaSnapshot());
    if (!meta?.id()) continue;
    projects.push({
      id: meta.id()!, name: meta.name() ?? "",
      createdAt: Number(meta.createdAt()), openedAt: Number(meta.openedAt()),
      updatedAt: timestamp(meta.updatedAt()), template: optionalText(meta.template()) as ProjectMeta["template"],
      folder: optionalText(meta.folder()), thumbnail: optionalText(meta.thumbnail()),
      trashedAt: timestamp(meta.trashedAt()), publishedAt: timestamp(meta.publishedAt()),
    });
  }
  return projects;
}
