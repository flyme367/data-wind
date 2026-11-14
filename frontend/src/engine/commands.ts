// Frontend -> engine command encoders and small outbound decoders (FlatBuffers).
// Every wasm command is one CommandRequest buffer; each method only accepts its own
// payload type, so a buffer routed to the wrong surface fails verification instead of
// being misread. Generic widget payloads (node data, set_value, board event values)
// travel through the recursive JsonValue union.
import * as flatbuffers from "flatbuffers";
import {
  BoardClock, BoardNodeWire, BoardSync, Camera, Color4, CommandPayload,
  CommandRequest, GeoFeature, GeoJsonDocument, HitResult, Instance, JsonArray, JsonBool,
  JsonEntry, JsonNull, JsonNumber, JsonObject, JsonPayload, JsonString, JsonValue,
  Polygon, RenderOptions, Ring, SceneUpdate, SetEnvironment, SetHud, SetMode,
  SetSelections, SetValue, SoftwareFrame, StringList, TerrainParams, WaterParams, WaterPoint, WaterSource, Vec3, WidgetStyle,
} from "../protocol/generated/data-wind-protocol";
import type { FlatInstance } from "../types";

export const COMMAND_VERSION = 1;

export interface BoardClockValue {
  time: string; year: number; month: number; day: number;
  firstWeekday: number; days: number; now: number;
}

export interface BoardNodeInput {
  id: string; name: string; x: number; y: number; width: number; height: number;
  rotation: number; color: string; locked: boolean;
  widget: object; data: unknown;
}

// ---------------------------------------------------------------------------
// Generic JSON-equivalent value codec (schema-less widget payloads).
// ---------------------------------------------------------------------------

export function writeJsonValue(builder: flatbuffers.Builder, value: unknown): flatbuffers.Offset {
  if (value == null) {
    return JsonValue.createJsonValue(builder, JsonPayload.JsonNull, JsonNull.createJsonNull(builder));
  }
  if (typeof value === "boolean") {
    return JsonValue.createJsonValue(builder, JsonPayload.JsonBool, JsonBool.createJsonBool(builder, value));
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return writeJsonValue(builder, null);
    // 整数标记保真：Rust 端渲染表格等场景需要区分 3 与 3.0 的字符串形态。
    return JsonValue.createJsonValue(builder, JsonPayload.JsonNumber,
      JsonNumber.createJsonNumber(builder, value, Number.isSafeInteger(value)));
  }
  if (typeof value === "string") {
    const text = builder.createString(value);
    return JsonValue.createJsonValue(builder, JsonPayload.JsonString,
      JsonString.createJsonString(builder, text));
  }
  if (Array.isArray(value)) {
    const items = value.map(item => writeJsonValue(builder, item));
    return JsonValue.createJsonValue(builder, JsonPayload.JsonArray,
      JsonArray.createJsonArray(builder, JsonArray.createItemsVector(builder, items)));
  }
  const entries = Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => {
    const keyOffset = builder.createString(key);
    const itemOffset = writeJsonValue(builder, item);
    JsonEntry.startJsonEntry(builder);
    JsonEntry.addKey(builder, keyOffset);
    JsonEntry.addValue(builder, itemOffset);
    return JsonEntry.endJsonEntry(builder);
  });
  return JsonValue.createJsonValue(builder, JsonPayload.JsonObject,
    JsonObject.createJsonObject(builder, JsonObject.createEntriesVector(builder, entries)));
}

export function readJsonValue(value: JsonValue): unknown {
  switch (value.payloadType()) {
    case JsonPayload.JsonBool: return value.payload(new JsonBool())?.value() === true;
    case JsonPayload.JsonNumber: return value.payload(new JsonNumber())?.value() ?? 0;
    case JsonPayload.JsonString: return value.payload(new JsonString())?.value() ?? "";
    case JsonPayload.JsonArray: {
      const payload = value.payload(new JsonArray());
      const items: unknown[] = [];
      for (let i = 0, count = payload?.itemsLength() ?? 0; i < count; i += 1) {
        const item = payload?.items(i, new JsonValue());
        if (item) items.push(readJsonValue(item));
      }
      return items;
    }
    case JsonPayload.JsonObject: {
      const payload = value.payload(new JsonObject());
      const entries: Record<string, unknown> = {};
      for (let i = 0, count = payload?.entriesLength() ?? 0; i < count; i += 1) {
        const entry = payload?.entries(i, new JsonEntry());
        const key = entry?.key();
        const child = entry?.value(new JsonValue());
        if (key != null && child) entries[key] = readJsonValue(child);
      }
      return entries;
    }
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// CommandRequest envelope.
// ---------------------------------------------------------------------------

function finishCommand(builder: flatbuffers.Builder,
  payloadType: CommandPayload, payload: flatbuffers.Offset): Uint8Array {
  const root = CommandRequest.createCommandRequest(builder, COMMAND_VERSION, payloadType, payload);
  builder.finish(root);
  return builder.asUint8Array();
}

// ---------------------------------------------------------------------------
// 3D engine commands.
// ---------------------------------------------------------------------------

export function encodeSetMode(mode: "login" | "editor"): Uint8Array {
  const builder = new flatbuffers.Builder(32);
  return finishCommand(builder, CommandPayload.SetMode,
    SetMode.createSetMode(builder, mode === "login" ? 1 : 0));
}

export function encodeSetHud(hud: { grid: boolean; flylines: boolean; stats: boolean }): Uint8Array {
  const builder = new flatbuffers.Builder(32);
  return finishCommand(builder, CommandPayload.SetHud,
    SetHud.createSetHud(builder, hud.grid, hud.flylines, hud.stats));
}

export function encodeSetSelections(ids: string[]): Uint8Array {
  const builder = new flatbuffers.Builder(64);
  const items = ids.map(id => builder.createString(id));
  return finishCommand(builder, CommandPayload.SetSelections,
    SetSelections.createSetSelections(builder, SetSelections.createIdsVector(builder, items)));
}

export function encodeSetEnvironment(
  environment: { background: number[]; ground: number[]; daylight: number; fogDistance: number },
): Uint8Array {
  const builder = new flatbuffers.Builder(96);
  SetEnvironment.startSetEnvironment(builder);
  // 结构体必须紧跟在写入位置内联序列化。
  SetEnvironment.addBackground(builder, Color4.createColor4(builder, environment.background[0],
    environment.background[1], environment.background[2], environment.background[3]));
  SetEnvironment.addGround(builder, Color4.createColor4(builder, environment.ground[0],
    environment.ground[1], environment.ground[2], environment.ground[3]));
  SetEnvironment.addDaylight(builder, environment.daylight);
  SetEnvironment.addFogDistance(builder, environment.fogDistance);
  return finishCommand(builder, CommandPayload.SetEnvironment,
    SetEnvironment.endSetEnvironment(builder));
}

function writeInstance(builder: flatbuffers.Builder, item: FlatInstance): flatbuffers.Offset {
  const id = builder.createString(item.id);
  const kind = builder.createString(item.kind);
  const modelId = item.modelId != null ? builder.createString(item.modelId) : null;
  const rotation = item.rotation ? Instance.createRotationVector(builder, item.rotation) : null;
  const to = item.to ? Instance.createToVector(builder, item.to) : null;
  let terrain: flatbuffers.Offset | undefined;
  if (item.terrain) {
    const config = item.terrain;
    const preset = builder.createString(config.preset);
    const heights = config.heightmap ? TerrainParams.createHeightsVector(builder, config.heightmap.samples) : undefined;
    const color = (hex: string) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const rock = color(config.rockColor), snow = color(config.snowColor);
    TerrainParams.startTerrainParams(builder);
    TerrainParams.addPreset(builder, preset);
    TerrainParams.addSeed(builder, config.seed);
    TerrainParams.addLevels(builder, config.levels);
    TerrainParams.addDetailScale(builder, config.detailScale);
    TerrainParams.addSnowLine(builder, config.snowLine);
    TerrainParams.addCollision(builder, config.collision);
    TerrainParams.addRockColor(builder, Vec3.createVec3(builder, rock[0], rock[1], rock[2]));
    TerrainParams.addSnowColor(builder, Vec3.createVec3(builder, snow[0], snow[1], snow[2]));
    if (heights !== undefined) TerrainParams.addHeights(builder, heights);
    if (config.heightmap) TerrainParams.addResolution(builder, config.heightmap.resolution);
    terrain = TerrainParams.endTerrainParams(builder);
  }
  let water: flatbuffers.Offset | undefined;
  if (item.water) {
    const c = item.water, preset = builder.createString(c.preset);
    WaterParams.startPointsVector(builder, c.points.length);
    for (let i = c.points.length - 1; i >= 0; i--) WaterPoint.createWaterPoint(builder, c.points[i].x, c.points[i].z);
    const points = builder.endVector();
    WaterParams.startSourcesVector(builder, c.sources.length);
    for (let i = c.sources.length - 1; i >= 0; i--) { const s = c.sources[i]; WaterSource.createWaterSource(builder, s.x, s.z, s.rate, s.radius); }
    const sources = builder.endVector();
    const color = (hex: string) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const refraction = color(c.refractionColor), scattering = color(c.scatteringColor);
    WaterParams.startWaterParams(builder);
    WaterParams.addPreset(builder, preset);
    WaterParams.addWaveHeight(builder, c.waveHeight); WaterParams.addWaveLength(builder, c.waveLength);
    WaterParams.addWaveSpeed(builder, c.waveSpeed); WaterParams.addDirection(builder, c.direction);
    WaterParams.addOpacity(builder, c.opacity); WaterParams.addTransparencyDepth(builder, c.transparencyDepth);
    WaterParams.addRoughness(builder, c.roughness); WaterParams.addFoam(builder, c.foam);
    WaterParams.addRiverWidth(builder, c.riverWidth); WaterParams.addPoints(builder, points);
    WaterParams.addRunning(builder, c.running); WaterParams.addInitialDepth(builder, c.initialDepth);
    WaterParams.addSources(builder, sources); WaterParams.addResetVersion(builder, c.resetVersion);
    WaterParams.addRefractionColor(builder, Vec3.createVec3(builder, ...refraction as [number, number, number]));
    WaterParams.addScatteringColor(builder, Vec3.createVec3(builder, ...scattering as [number, number, number]));
    water = WaterParams.endWaterParams(builder);
  }
  Instance.startInstance(builder);
  Instance.addId(builder, id);
  Instance.addKind(builder, kind);
  Instance.addRotY(builder, item.rotY);
  if (terrain !== undefined) Instance.addTerrain(builder, terrain);
  if (water !== undefined) Instance.addWater(builder, water);
  if (rotation != null) Instance.addRotation(builder, rotation);
  if (to != null) Instance.addTo(builder, to);
  if (modelId != null) Instance.addModelId(builder, modelId);
  // 结构体必须紧跟在写入位置内联序列化。
  Instance.addPos(builder, Vec3.createVec3(builder, item.pos[0], item.pos[1], item.pos[2]));
  Instance.addSize(builder, Vec3.createVec3(builder, item.size[0], item.size[1], item.size[2]));
  Instance.addColor(builder, Vec3.createVec3(builder, item.color[0], item.color[1], item.color[2]));
  if (item.locked != null) Instance.addLocked(builder, item.locked);
  if (to != null) Instance.addTo(builder, to);
  if (modelId != null) Instance.addModelId(builder, modelId);
  return Instance.endInstance(builder);
}

export function encodeSceneUpdate(instances: FlatInstance[]): Uint8Array {
  const builder = new flatbuffers.Builder(256);
  const items = instances.map(item => writeInstance(builder, item));
  return finishCommand(builder, CommandPayload.SceneUpdate,
    SceneUpdate.createSceneUpdate(builder, SceneUpdate.createInstancesVector(builder, items)));
}

export function encodeSoftwareFrame(
  instances: FlatInstance[],
  camera: { target: [number, number, number]; yaw: number; pitch: number; dist: number },
  options: {
    grid: boolean; selectedId: string | null; selectedIds?: string[]; time: number;
    background?: string; daylight?: number;
  },
): Uint8Array {
  const builder = new flatbuffers.Builder(256);
  const items = instances.map(item => writeInstance(builder, item));
  const instancesOffset = SoftwareFrame.createInstancesVector(builder, items);
  const cameraOffset = Camera.createCamera(builder,
    Vec3.createVec3(builder, camera.target[0], camera.target[1], camera.target[2]),
    camera.yaw, camera.pitch, camera.dist);
  const selectedId = options.selectedId ? builder.createString(options.selectedId) : 0;
  const selectedIds = options.selectedIds?.map(id => builder.createString(id)) ?? [];
  const selectedIdsOffset = RenderOptions.createSelectedIdsVector(builder, selectedIds);
  const background = options.background ? builder.createString(options.background) : 0;
  const optionsOffset = RenderOptions.createRenderOptions(builder, options.grid,
    selectedId, selectedIdsOffset, options.time, background, options.daylight ?? 0);
  SoftwareFrame.startSoftwareFrame(builder);
  SoftwareFrame.addInstances(builder, instancesOffset);
  SoftwareFrame.addCamera(builder, cameraOffset);
  SoftwareFrame.addOptions(builder, optionsOffset);
  return finishCommand(builder, CommandPayload.SoftwareFrame,
    SoftwareFrame.endSoftwareFrame(builder));
}

// ---------------------------------------------------------------------------
// Board (egui canvas) commands.
// ---------------------------------------------------------------------------

function writeWidgetStyle(builder: flatbuffers.Builder, widget: object): flatbuffers.Offset {
  const item = widget as Record<string, unknown>;
  const string = (key: string) => {
    const value = item[key];
    return typeof value === "string" && value !== "" ? builder.createString(value) : null;
  };
  const kind = builder.createString(typeof item.kind === "string" ? item.kind : "");
  const text = string("text");
  const value = string("value");
  const unit = string("unit");
  const background = string("background");
  const borderColor = string("borderColor");
  const image = string("image");
  const align = string("align");
  const fontFamily = string("fontFamily");
  const borderStyle = string("borderStyle");
  const shadowColor = string("shadowColor");
  const number = (key: string, fallback = 0) =>
    typeof item[key] === "number" && Number.isFinite(item[key]) ? item[key] as number : fallback;
  WidgetStyle.startWidgetStyle(builder);
  WidgetStyle.addKind(builder, kind);
  if (text != null) WidgetStyle.addText(builder, text);
  if (value != null) WidgetStyle.addValue(builder, value);
  if (unit != null) WidgetStyle.addUnit(builder, unit);
  WidgetStyle.addFontSize(builder, number("fontSize"));
  if (background != null) WidgetStyle.addBackground(builder, background);
  if (borderColor != null) WidgetStyle.addBorderColor(builder, borderColor);
  WidgetStyle.addOpacity(builder, number("opacity", 1));
  WidgetStyle.addRadius(builder, number("radius"));
  if (image != null) WidgetStyle.addImage(builder, image);
  if (align != null) WidgetStyle.addAlign(builder, align);
  if (fontFamily != null) WidgetStyle.addFontFamily(builder, fontFamily);
  WidgetStyle.addFontWeight(builder, number("fontWeight", 400));
  WidgetStyle.addItalic(builder, item.italic === true);
  WidgetStyle.addUnderline(builder, item.underline === true);
  WidgetStyle.addLineHeight(builder, number("lineHeight"));
  WidgetStyle.addLetterSpacing(builder, number("letterSpacing"));
  if (borderStyle != null) WidgetStyle.addBorderStyle(builder, borderStyle);
  WidgetStyle.addBorderWidth(builder, number("borderWidth", 1));
  if (shadowColor != null) WidgetStyle.addShadowColor(builder, shadowColor);
  WidgetStyle.addShadowBlur(builder, number("shadowBlur"));
  WidgetStyle.addShadowOffsetX(builder, number("shadowOffsetX"));
  WidgetStyle.addShadowOffsetY(builder, number("shadowOffsetY"));
  return WidgetStyle.endWidgetStyle(builder);
}

function writeBoardNode(builder: flatbuffers.Builder, node: BoardNodeInput): flatbuffers.Offset {
  const id = builder.createString(node.id);
  const name = node.name ? builder.createString(node.name) : null;
  const color = node.color ? builder.createString(node.color) : null;
  const widget = writeWidgetStyle(builder, node.widget);
  const data = writeJsonValue(builder, node.data);
  BoardNodeWire.startBoardNodeWire(builder);
  BoardNodeWire.addId(builder, id);
  if (name != null) BoardNodeWire.addName(builder, name);
  BoardNodeWire.addX(builder, node.x);
  BoardNodeWire.addY(builder, node.y);
  BoardNodeWire.addWidth(builder, node.width);
  BoardNodeWire.addHeight(builder, node.height);
  BoardNodeWire.addRotation(builder, node.rotation);
  if (color != null) BoardNodeWire.addColor(builder, color);
  BoardNodeWire.addLocked(builder, node.locked);
  BoardNodeWire.addWidget(builder, widget);
  BoardNodeWire.addData(builder, data);
  return BoardNodeWire.endBoardNodeWire(builder);
}

export function encodeBoardSync(document: {
  width: number; height: number; preview: boolean; selected: string[]; nodes: BoardNodeInput[];
}): Uint8Array {
  const builder = new flatbuffers.Builder(512);
  const nodes = document.nodes.map(node => writeBoardNode(builder, node));
  const nodesOffset = BoardSync.createNodesVector(builder, nodes);
  const selected = document.selected.map(id => builder.createString(id));
  const selectedOffset = BoardSync.createSelectedVector(builder, selected);
  return finishCommand(builder, CommandPayload.BoardSync,
    BoardSync.createBoardSync(builder, document.width, document.height,
      document.preview, selectedOffset, nodesOffset));
}

export function encodeSetValue(id: string, value: unknown): Uint8Array {
  const builder = new flatbuffers.Builder(64);
  const idOffset = builder.createString(id);
  const valueOffset = writeJsonValue(builder, value);
  SetValue.startSetValue(builder);
  SetValue.addId(builder, idOffset);
  SetValue.addValue(builder, valueOffset);
  return finishCommand(builder, CommandPayload.SetValue, SetValue.endSetValue(builder));
}

export function encodeBoardClock(clock: BoardClockValue): Uint8Array {
  const builder = new flatbuffers.Builder(96);
  const time = clock.time ? builder.createString(clock.time) : 0;
  return finishCommand(builder, CommandPayload.BoardClock,
    BoardClock.createBoardClock(builder, time, clock.year, clock.month, clock.day,
      clock.firstWeekday, clock.days, clock.now));
}

/** 把已 fetch 并 JSON.parse 的 GeoJSON 压成 Rust 消费的形状（Polygon/MultiPolygon + NAME/NAME_ZH + dataset）。 */
export function encodeGeoJsonDocument(document: {
  features?: { geometry?: { type?: unknown; coordinates?: unknown }; properties?: Record<string, unknown> }[];
}, dataset = ""): Uint8Array {
  const builder = new flatbuffers.Builder(8192);
  const features: flatbuffers.Offset[] = [];
  for (const feature of document.features ?? []) {
    const geometry = feature.geometry ?? {};
    const raw = geometry.coordinates;
    const type = geometry.type;
    if ((type !== "Polygon" && type !== "MultiPolygon") || !Array.isArray(raw)) continue;
    const polygons: unknown[] = type === "Polygon" ? [raw] : raw;
    const polygonOffsets: flatbuffers.Offset[] = [];
    for (const polygon of polygons) {
      if (!Array.isArray(polygon)) continue;
      const ringOffsets: flatbuffers.Offset[] = [];
      for (const ring of polygon) {
        if (!Array.isArray(ring)) continue;
        const points = ring.flatMap(point => Array.isArray(point) && point.length >= 2
          ? [Number(point[0]), Number(point[1])] : []);
        ringOffsets.push(Ring.createRing(builder, Ring.createPointsVector(builder, points)));
      }
      polygonOffsets.push(Polygon.createPolygon(builder,
        Polygon.createRingsVector(builder, ringOffsets)));
    }
    const name = builder.createString(String(feature.properties?.NAME ?? ""));
    const nameZh = builder.createString(String(feature.properties?.NAME_ZH ?? ""));
    const datasetName = builder.createString(String(feature.properties?.DATASET ?? dataset));
    features.push(GeoFeature.createGeoFeature(builder,
      GeoFeature.createPolygonsVector(builder, polygonOffsets), name, nameZh, datasetName));
  }
  return finishCommand(builder, CommandPayload.GeoJsonDocument,
    GeoJsonDocument.createGeoJsonDocument(builder,
      GeoJsonDocument.createFeaturesVector(builder, features)));
}

// ---------------------------------------------------------------------------
// Small standalone outbound decoders (not the DWCR drain queue).
// ---------------------------------------------------------------------------

/** 空缓冲表示无命中。 */
export function decodeHitResult(bytes: Uint8Array): {
  id: string; handle: string | null; control: boolean;
} | null {
  if (bytes.byteLength === 0) return null;
  const hit = HitResult.getRootAsHitResult(new flatbuffers.ByteBuffer(bytes));
  const id = hit.id();
  if (id == null) throw new Error("命中结果不完整");
  return { id, handle: hit.handle() ?? null, control: hit.control() };
}

export function decodeStringList(bytes: Uint8Array): string[] {
  const list = StringList.getRootAsStringList(new flatbuffers.ByteBuffer(bytes));
  const items: string[] = [];
  for (let i = 0, count = list.itemsLength(); i < count; i += 1) {
    const item = list.items(i);
    if (item != null) items.push(item);
  }
  return items;
}
