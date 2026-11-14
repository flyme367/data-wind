import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, loadProjects, parseProjectFile, persistScene, readScene, validateScene } from "../state/projects";
import { defaultScene } from "../workers/sceneModel";
import { referenceCampus } from "../data/referenceScene";
import { gisReference, terrainReference } from "../data/referenceLandscapes";
import { defaultEditorSettings, widgetNode, type Interaction } from "../data/editor";
import type { SceneNode } from "../types";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
describe("local projects and file boundaries", () => {
  it("round-trips empty scenes independently for two projects", () => {
    const a = createProject("A"), b = createProject("B");
    persistScene(a.id, defaultScene());
    persistScene(b.id, []);
    expect(readScene(a.id)!.length).toBeGreaterThan(0);
    expect(readScene(b.id)).toEqual([]);
    expect(loadProjects()).toHaveLength(2);
  });
  it("rejects corrupt data rather than passing invalid geometry to WASM", () => {
    const invalid = defaultScene();
    invalid[0].transform.position.x = Number.NaN;
    expect(() => validateScene(invalid)).toThrow();
    expect(() => parseProjectFile('{"scene":[{}]}')).toThrow();
  });
  it("rejects duplicate identifiers and cyclic parent references", () => {
    const scene = defaultScene();
    expect(() => validateScene([scene[0], scene[0]])).toThrow();
    scene[0].parentId = scene[1].id;
    scene[1].parentId = scene[0].id;
    expect(() => validateScene(scene)).toThrow(/循环/);
  });
  it("accepts exported projects and legacy scene arrays", () => {
    const scene = defaultScene();
    expect(parseProjectFile(JSON.stringify({ name: "园区", scene })).name).toBe("园区");
    expect(parseProjectFile(JSON.stringify(scene)).scene).toEqual(scene);
  });
  it("preserves official component and board interaction triggers in project files", () => {
    const componentRule: Interaction = {
      id: "hover-rule", name: "悬停", event: "mouseenter", action: "none", targetId: "", value: "",
    };
    const selectedItemRule: Interaction = {
      id: "item-rule", name: "选中项", event: "itemClick", itemValue: "华东",
      action: "none", targetId: "", value: "",
    };
    const entranceRule: Interaction = { id: "entrance", name: "入场动画", event: "componentEnter", action: "playEntrance",
      targetId: "dropdown-1", value: "", delayMs: 200, durationMs: 1000, animation: "fade",
      easing: "exponentialIn", animationStack: false, sequence: "with" };
    const component = {
      ...widgetNode("dropdown"), id: "dropdown-1", name: "区域选择",
      visible: true, locked: false, parentId: null,
      interactions: [componentRule, selectedItemRule, entranceRule],
    } as SceneNode;
    const boardRule: Interaction = {
      id: "data-rule", name: "数据触发", event: "data", action: "none", targetId: "", value: "",
      condition: { sourceId: "metrics", field: "count", op: ">", value: "10" },
    };
    const imported = parseProjectFile(JSON.stringify({
      name: "交互项目", scene: [component], params: { area: "华东", count: 12 },
      settings: { ...defaultEditorSettings, boardInteractions: [boardRule] },
    }));
    expect(imported.scene[0]?.interactions).toEqual([componentRule, selectedItemRule, entranceRule]);
    expect(imported.settings.boardInteractions).toMatchObject([boardRule]);
    expect(imported.params).toEqual({ area: "华东", count: 12 });
  });
  it("为缺少样式字段的旧图元补齐山海鲸同款默认值", () => {
    const legacy = {
      id: "legacy-widget", name: "文本", type: "widget", visible: true, locked: false, color: "#6cbcff", parentId: null,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      widget: { kind: "text", text: "旧数据", value: "", unit: "", fontSize: 24, background: "transparent", borderColor: "transparent", opacity: 1, radius: 6, image: "", align: "left" },
    };
    const widget = validateScene([legacy])[0]!.widget!;
    expect(widget).toMatchObject({ fontFamily: "", fontWeight: 400, italic: false, underline: false, lineHeight: 0, letterSpacing: 0, borderStyle: "solid", borderWidth: 1, shadowColor: "transparent", shadowBlur: 0 });
  });
  it("saves and imports an entire campus with real resource IDs", () => {
    const campus=referenceCampus();
    const id=createProject("参考园区").id;
    persistScene(id,campus);
    expect(validateScene(campus)).toEqual(campus);
    expect(parseProjectFile(JSON.stringify({name:"参考园区",scene:readScene(id)})).scene).toEqual(campus);
    expect(campus.filter(n=>n.modelId).length).toBeGreaterThan(40);
    campus[0].modelId="../../unknown-model";
    expect(()=>validateScene(campus)).toThrow();
  });
  it("round-trips the GIS and terrain reference scenes with their actual resources", () => {
    for (const scene of [gisReference(), terrainReference()]) {
      const project = createProject("素材参考");
      persistScene(project.id, scene);
      expect(readScene(project.id)).toEqual(scene);
      expect(scene.some((node) => node.modelId?.startsWith("gis-") || node.modelId?.startsWith("terrain-"))).toBe(true);
    }
  });
});
