import { describe, expect, it } from "vitest";
import { templates } from "../data/catalog";
import { createTemplateScene, templateSettings } from "../data/sceneTemplates";
import { smartParkScene } from "../data/smartParkScene";
import { flattenScene } from "../workers/sceneModel";
import { defaultEditorSettings } from "../data/editor";

/** 引擎侧每类实例的池上限(scene.rs ScenePools)。 */
const ENGINE_LIMITS = { box: 1024, marker: 128, fence: 32, flyline: 64 } as const;

describe("smartParkScene", () => {
  const scene = smartParkScene();
  const flat = flattenScene(scene);

  it("注册在模板库且可由 createTemplateScene 构建", () => {
    expect(templates.some((t) => t.id === "smart-park")).toBe(true);
    expect(createTemplateScene("smart-park").length).toBe(scene.length);
  });

  it("节点 id 唯一且都有名称", () => {
    const ids = new Set(scene.map((n) => n.id));
    expect(ids.size).toBe(scene.length);
    expect(scene.every((n) => n.name.trim().length > 0)).toBe(true);
  });

  it("各类实例数量在引擎池上限内", () => {
    const count = (kind: string) => flat.filter((n) => n.kind === kind).length;
    expect(count("box")).toBeLessThanOrEqual(ENGINE_LIMITS.box);
    expect(count("marker")).toBeLessThanOrEqual(ENGINE_LIMITS.marker);
    expect(count("fence")).toBeLessThanOrEqual(ENGINE_LIMITS.fence);
    expect(count("flyline")).toBeLessThanOrEqual(ENGINE_LIMITS.flyline);
    expect(count("marker")).toBeGreaterThanOrEqual(6);
    expect(count("flyline")).toBeGreaterThanOrEqual(5);
  });

  it("提供巡游机位,相机节点都带注视点", () => {
    const cameras = scene.filter((n) => n.type === "camera");
    expect(cameras.length).toBeGreaterThanOrEqual(5);
    for (const camera of cameras) {
      expect(camera.to).toBeDefined();
      expect(Number.isFinite(camera.transform.position.x)).toBe(true);
    }
  });

  it("看板组件都在 1920×1080 画板内且带尺寸", () => {
    const widgets = scene.filter((n) => n.type === "widget");
    expect(widgets.length).toBeGreaterThanOrEqual(9);
    for (const widget of widgets) {
      const { x, y } = widget.transform.position;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + (widget.boxSize?.x ?? 0)).toBeLessThanOrEqual(1920);
      expect(y + (widget.boxSize?.y ?? 0)).toBeLessThanOrEqual(1080);
    }
  });

  it("数据面板挂了 api 数据源且绑定字段合法", () => {
    const sourced = scene.filter((n) => n.dataSource?.enabled);
    expect(sourced.length).toBeGreaterThanOrEqual(6);
    for (const node of sourced) {
      expect(node.dataSource!.url).toMatch(/^\/api\/park\//);
      expect(node.dataSource!.intervalMs).toBeGreaterThanOrEqual(1000);
    }
    const dialog = scene.find((n) => n.id === "smart-park-dialog");
    expect(dialog?.visible).toBe(false);
  });

  it("夜景环境预设只作用于 smart-park", () => {
    const night = templateSettings("smart-park");
    expect(night.background).toMatch(/^#0[A-F0-9]/i);
    expect(night.grid).toBe(false);
    expect(night.fog).toBe(true);
    expect(templateSettings("reference-campus")).toEqual({});
    expect({ ...defaultEditorSettings, ...night }).toMatchObject({ flylines: true });
  });
});
