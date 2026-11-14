import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultEditorSettings, widgetNode, type Interaction } from "../data/editor";
import { handle } from "../workers/sceneModel";
import { createProject, loadProjects, parseProjectFile, persistBoardSize, persistEditorSettings, persistParams, persistScene, readBoardSize, readEditorSettings, readProjectParams, readScene, validateEditorSettings } from "../state/projects";
import { decodeProjectSnapshot, encodeProjectSnapshot } from "../state/snapshotCodec";
import { initMemoryProjectStore, readSnapshotBytes, readSnapshotMeta, readSnapshotState, resetProjectStore } from "../state/projectStore";
import type { SceneNode } from "../types";

const baseNode = (node: Partial<SceneNode> & { type: SceneNode["type"] }, id: string): SceneNode => ({
  visible: true, locked: false, parentId: null, ...node, id,
} as SceneNode);

const richScene = (): SceneNode[] => {
  const widget = baseNode(widgetNode("bar"), "widget-1");
  widget.boardPageId = "board-1"; // 读端归一化会给缺省组件补该值，fixture 预置保证无损比对
  widget.data = { rows: [{ name: "设备", value: 42 }] };
  widget.bindings = { value: "rows.0.value" };
  widget.interactions = [{ id: "rule", name: "告警规则", event: "custom", triggerValue: "incoming", action: "devEvent", actionEventName: "outgoing", targetId: "widget-1", value: "" } as Interaction];
  widget.widget!.states = [{ id: "state-1", name: "告警", patch: { text: "超限", background: "#ff0000" } }];
  const box = baseNode({
    type: "model", name: "设备", color: "#FFFFFF",
    transform: { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    boxSize: { x: 2, y: 3, z: 4 },
  }, "box-1");
  box.customMesh = { bytes: btoa("DWM-fake-mesh-bytes"), triangles: 12, sourceName: "设备.glb" };
  box.lightIntensity = 0; // 合法下界，不能与「未设置」混淆
  const group = baseNode({ name: "分组", type: "group", transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, color: "#6cbcff" }, "group-1");
  box.parentId = "group-1";
  return [group, box, widget];
};

const payload = (scene: SceneNode[]) => ({
  name: "测试项目", savedAt: 1700000000000, boardSize: { width: 2560, height: 1440 } as const,
  scene, settings: structuredClone(defaultEditorSettings), params: { area: "A区" },
});

beforeEach(() => {
  initMemoryProjectStore();
});
afterEach(() => {
  resetProjectStore();
});

describe("project snapshot codec", () => {
  it("preserves database references without service tokens or database passwords", () => {
    const project = payload(richScene());
    const source = { kind: "database" as const, enabled: true, url: "http://127.0.0.1:4319", path: "", method: "GET" as const,
      headers: {}, body: "", intervalMs: 5000, database: { profile: "local-pg", sql: "SELECT * FROM devices" } };
    project.scene[2].dataSource = source;
    project.settings.boardSharedData = [{ id: "db-shared", name: "数据库", enabled: true, source }];
    const decoded = decodeProjectSnapshot(encodeProjectSnapshot(project));
    expect(decoded.scene[2].dataSource).toEqual(source);
    expect((decoded.settings as typeof project.settings).boardSharedData[0].source).toEqual(source);
    expect(JSON.stringify(decoded)).not.toMatch(/session-token|password/);
  });

  it("preserves API parameters and authentication for component and shared sources", () => {
    const project = payload(richScene());
    const source = { kind: "api" as const, enabled: true, url: "https://example.com/api", path: "", method: "GET" as const,
      headers: {}, body: "", intervalMs: 0, queryParams: [{ key: "area", value: "一区", enabled: true }],
      auth: { type: "bearer" as const, token: "sample" }, variables: [{ name: "area", initialValue: "一区", currentValue: "二区" }] };
    project.scene[2].dataSource = source;
    project.settings.boardSharedData = [{ id: "shared", name: "公共接口", enabled: true, source }];
    const decoded = decodeProjectSnapshot(encodeProjectSnapshot(project));
    expect(decoded.scene[2].dataSource).toEqual(source);
    expect((decoded.settings as typeof project.settings).boardSharedData[0].source).toEqual(source);
  });

  it("round-trips nodes, widget states, custom meshes and JSON payloads losslessly", () => {
    const decoded = decodeProjectSnapshot(encodeProjectSnapshot(payload(richScene())));
    expect(decoded.name).toBe("测试项目");
    expect(decoded.savedAt).toBe(1700000000000);
    expect(decoded.boardSize).toEqual({ width: 2560, height: 1440 });
    expect(decoded.settings).toEqual(payload([]).settings);
    expect(decoded.params).toEqual({ area: "A区" });
    expect(decoded.scene).toEqual(richScene());
  });

  it("rewrites legacy kits png/jpg references to migrated webp paths when decoding", () => {
    const hashA = "b7c3f1e2d4a5968701234567890abcdef1234567890abcdef1234567890abcde";
    const hashB = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const node = baseNode({ type: "group", name: "套件旧引用",
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      data: { image: `/kits/assets/${hashA}.png`, rel: `./kits/assets/${hashA}.jpg`,
        list: [`/kits/thumbs/${hashB}.jpeg`], keep: "/kits/assets/notahash.png" },
    }, "legacy-1");
    const decoded = decodeProjectSnapshot(encodeProjectSnapshot(payload([node])));
    const data = decoded.scene[0].data as Record<string, unknown>;
    expect(data.image).toBe(`/kits/assets/${hashA}.webp`);
    expect(data.rel).toBe(`./kits/assets/${hashA}.webp`);
    expect(data.list).toEqual([`/kits/thumbs/${hashB}.webp`]);
    expect(data.keep).toBe("/kits/assets/notahash.png");
  });

  it("parseProjectFile migrates legacy kit image paths unless bundle mode opts out", () => {
    const hash = "e2d4".repeat(16);
    const raw = JSON.stringify({ name: "旧导出", scene: [baseNode({
      type: "group", name: "旧引用", color: "#6cbcff",
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      data: { image: `/kits/assets/${hash}.png` },
    }, "legacy-file")] });
    const migrated = parseProjectFile(raw);
    expect((migrated.scene[0]!.data as Record<string, unknown>).image).toBe(`/kits/assets/${hash}.webp`);
    const bundled = parseProjectFile(raw, { migrateKitImages: false });
    expect((bundled.scene[0]!.data as Record<string, unknown>).image).toBe(`/kits/assets/${hash}.png`);
  });

  it("keeps lightIntensity 0 distinct from unset and drops absent optionals", () => {
    const node = richScene()[1];
    const decoded = decodeProjectSnapshot(encodeProjectSnapshot({ ...payload([node]) }));
    expect(decoded.scene[0].lightIntensity).toBe(0);
    const bare = { ...node, lightIntensity: undefined, boxSize: undefined, customMesh: undefined, data: undefined, bindings: undefined, interactions: undefined };
    const decodedBare = decodeProjectSnapshot(encodeProjectSnapshot({ ...payload([bare]) }));
    expect("lightIntensity" in decodedBare.scene[0]).toBe(false);
    expect("boxSize" in decodedBare.scene[0]).toBe(false);
    expect("customMesh" in decodedBare.scene[0]).toBe(false);
  });

  it("rejects corrupt buffers instead of producing partial scenes", () => {
    const bytes = encodeProjectSnapshot(payload(richScene()));
    // 分层保证：魔数（DWPR）+ 版本号 + validateScene 域校验；flatbuffers JS 无完整
    // Verifier，位级损坏若恰好落在未用 slack 上本就无害，故只断言确定性损坏必被拒。
    const magicFlipped = bytes.slice();
    magicFlipped[4] ^= 0xff;
    expect(() => decodeProjectSnapshot(magicFlipped)).toThrow();
    expect(() => decodeProjectSnapshot(new Uint8Array(64))).toThrow();
    expect(() => decodeProjectSnapshot(new TextEncoder().encode('{"a":1}'))).toThrow(); // JSON 字节无魔数
  });
});

describe("memory-backed project store", () => {
  it("persists scenes, settings, board size and params through the snapshot path", () => {
    const project = createProject("快照项目");
    const scene = richScene();
    persistScene(project.id, scene);
    const boardRule: Interaction = { id: "board-rule", name: "转发事件", event: "custom", triggerValue: "incoming", action: "devEvent", actionEventName: "outgoing", targetId: "", value: "" };
    persistEditorSettings(project.id, { ...structuredClone(defaultEditorSettings), time: 21, boardInteractions: [boardRule] });
    persistBoardSize(project.id, { width: 2560, height: 1440 });
    persistParams(project.id, { area: "B区" });
    expect(readScene(project.id)).toEqual(scene);
    expect(readEditorSettings(project.id).time).toBe(21);
    expect(readEditorSettings(project.id).boardInteractions).toEqual([boardRule]);
    expect(readBoardSize(project.id)).toEqual({ width: 2560, height: 1440 });
    expect(readProjectParams(project.id)).toEqual({ area: "B区" });
    expect(loadProjects().find((item) => item.id === project.id)?.updatedAt).toBeTruthy();
  });

  it("returns null for unknown scenes and rejects corrupt stored scenes at the read boundary", () => {
    expect(readScene("missing-project")).toBeNull();
    const project = createProject("坏数据");
    const invalid = richScene();
    invalid[0].transform.position.x = Number.NaN;
    persistScene(project.id, invalid); // 写入不做校验（与 legacy 行为一致）
    expect(() => readScene(project.id)).toThrow();
  });

  it("exposes lazy field decoders and transfer-safe snapshot bytes", () => {
    const project = createProject("惰性");
    persistScene(project.id, richScene());
    const bytes = readSnapshotBytes(project.id);
    expect(bytes).not.toBeNull();
    expect(new TextDecoder().decode(bytes!.slice(4, 8))).toBe("DWPR");
    bytes![0] = 0; // transfer 副本改动不得影响缓存
    expect(readSnapshotMeta(project.id)?.name).toBe("惰性");
    expect(readSnapshotState(project.id)?.params).toBeNull();
    expect(readSnapshotBytes("missing")).toBeNull();
  });
});

describe("worker zero-copy load path", () => {
  /// builder.asUint8Array() 是构建缓冲上的视图，transfer 必须先 slice() 成紧凑 ArrayBuffer
  const compactBuffer = (payload: Parameters<typeof encodeProjectSnapshot>[0]) =>
    encodeProjectSnapshot(payload).slice().buffer as ArrayBuffer;

  it("builds the authoritative tree from snapshot bytes inside the worker model", () => {
    const scene = richScene();
    const data = compactBuffer({
      name: "零拷贝", savedAt: 1, boardSize: { width: 1920, height: 1080 },
      scene, settings: null, params: null,
    });
    const snapshot = handle({ type: "loadSnapshot", projectId: "zx", data, template: "empty" })!;
    expect(snapshot.projectId).toBe("zx");
    expect(snapshot.tree).toEqual(scene);
    expect(snapshot.canUndo).toBe(false);
  });

  it("reloads chart interactions with optional fields from old and new binary snapshots", () => {
    const chart = richScene()[2];
    const base = { id: "mark", name: "点选设备", event: "itemClick", action: "modify",
      targetId: chart.id, value: '{"text":""}', itemValue: "设备", settingKey: "text",
      settingSource: { type: "component", field: "value" } } satisfies Interaction;
    const old = { ...base, targetIds: null, actionEventName: null } as unknown as Interaction;
    const latest = { ...base, id: "new", targetIds: undefined, actionEventName: undefined };
    chart.interactions = [old, latest];
    const project = payload([chart]);
    project.settings.boardInteractions = [old];
    const raw = encodeProjectSnapshot(project);
    expect(decodeProjectSnapshot(raw).scene[0].interactions?.[1]).toEqual({ ...base, id: "new" });
    const snapshot = handle({ type: "loadSnapshot", projectId: "chart", data: raw.slice().buffer as ArrayBuffer,
      settings: validateEditorSettings(decodeProjectSnapshot(raw).settings), template: "empty" })!;
    expect(snapshot.tree[0]?.interactions).toEqual([base, { ...base, id: "new" }]);
    expect(snapshot.settings.boardInteractions).toEqual([base]);
  });

  it("falls back to the template scene when decode or validation fails", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // ① 魔数翻转 → 解码层拒绝
      const magic = new Uint8Array(compactBuffer({
        name: "坏", savedAt: 1, boardSize: { width: 1920, height: 1080 },
        scene: richScene(), settings: null, params: null,
      }));
      magic[4] ^= 0xff;
      const failed = handle({ type: "loadSnapshot", projectId: "zx2", data: magic.buffer as ArrayBuffer, template: "empty" })!;
      expect(failed.tree).toEqual([]);
      expect(failed.loadError).toMatch(/快照读取失败/);
      expect(handle({ type: "loadScene", tree: richScene() })!.loadError).toBeUndefined();
      expect(handle({ type: "undo" })!.loadError).toMatch(/快照读取失败/);
      expect(handle({ type: "redo" })!.loadError).toBeUndefined();
      // ② 结构合法但域非法（NaN 坐标）→ validateScene 拒绝
      const invalid = richScene();
      invalid[0].transform.position.x = Number.NaN;
      const nan = compactBuffer({
        name: "坏", savedAt: 1, boardSize: { width: 1920, height: 1080 },
        scene: invalid, settings: null, params: null,
      });
      const invalidScene = handle({ type: "loadSnapshot", projectId: "zx3", data: nan, template: "empty" })!;
      expect(invalidScene.tree).toEqual([]);
      expect(invalidScene.loadError).toMatch(/快照读取失败/);
    } finally {
      consoleError.mockRestore();
    }
  });
});
