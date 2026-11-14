import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { kitCatalog, kitFamilies, kitNodes, type KitCatalogEntry } from "../data/kitCatalog";
import { filterKitRows, KIT_CITY_GEOMETRY_OPTION, kitAssetPaths, kitMetadata, kitModelPreviewAsset, kitPieceAt, kitTexturePreviewAsset,
  resolveKitOptions, responsiveKitScene, type ReferenceKitWidget } from "../data/kitRuntime";
import { boardClock, boardHasMotion, boardNodes } from "../engine/boardScene";
import { RustBoardHost } from "../engine/boardCanvas";
import { advanceKitList, kitListInfo, kitListItem, kitListSelectionIndex, kitListSelectionMatch,
  type KitListTransition } from "../engine/kitList";
import { kitSelectionControlValue } from "../engine/kitSelection";
import { prepareKitMetricAnimations, prepareKitTextAnimations, type MetricAnimation, type TextAnimation } from "../engine/kitMetricAnimation";
import { decodeHitResult, encodeBoardClock, encodeBoardSync, encodeSetValue } from "../engine/commands";
import { dispatchCommandResponse } from "../engine/commandResponse";
import { BoardCanvas, initSync } from "../wasm/cpu/data_wind_cpu.js";
import { validateEditorSettings, validateScene } from "../state/projects";
import type { BoardDataCondition, DataConditionRule } from "../data/dataConditions";
import { decodeSnapshotScene, decodeSnapshotState, encodeProjectSnapshot } from "../state/snapshotCodec";
import { handle } from "../workers/sceneModel";
import { kitOptionDefinition, kitOptionDefinitionsByType, kitPieceOptionDefinition } from "../data/kitOptionSchema";
import { changeKitTab, resolveRuntimeScene } from "../data/runtimeScene";
import { updateKitLinkage, updateKitSelection } from "../data/kitLinkage";
import { kitChoiceEditPatch } from "../data/kitChoices";
import type { SceneNode } from "../types";
import { applyScriptKitOption } from "../data/interactionSettings";

function entry(label: string, familyId = "free"): KitCatalogEntry {
  return kitCatalog.find(item => item.label === label && item.familyId === familyId)!;
}
function readTemplate(item: KitCatalogEntry): ReferenceKitWidget {
  return JSON.parse(readFileSync(new URL(`../../public${item.template}`, import.meta.url), "utf8"));
}

describe("套件目录与真实模板", () => {
  it("包含 13 个主题、872 个有独立 ID 的条目，均可转换成可保存的场景", () => {
    expect(kitFamilies).toHaveLength(13);
    expect(kitCatalog).toHaveLength(872);
    expect(new Set(kitCatalog.map(item => item.id)).size).toBe(kitCatalog.length);
    for (const item of kitCatalog) {
      const source = readTemplate(item);
      const nodes = kitNodes(item, source);
      expect(nodes[0]?.name).toBe(item.label);
      expect(kitMetadata(nodes[0]!)?.source.options).toEqual(source.options);
      expect(() => validateScene(nodes)).not.toThrow();
      for (const node of nodes) expect(kitOptionDefinitionsByType[kitMetadata(node)!.source.type]).toBeDefined();
    }
  }, 20_000);

  it("原始组合的相对坐标、资源和父子关系被保留", () => {
    const item = entry("大标题(1920X1080）");
    const nodes = kitNodes(item, readTemplate(item), { x: 10, y: 20 });
    expect(nodes).toHaveLength(4);
    expect(nodes[0]).toMatchObject({ type: "group", boxSize: { x: 1918, y: 108 } });
    expect(nodes[1]!.parentId).toBe(nodes[0]!.id);
    expect(nodes[1]!.widget!.image).toMatch(/^\.\/kits\/assets\//);
    expect(nodes[3]).toMatchObject({ transform: { position: { x: 688, y: 27 } },
      widget: { text: "全球医疗可视化信息平台" } });
  });

  it("古镇的植被笔刷保留原始目录名及发布所需成员文件", () => {
    const item = entry("古镇", "spring-blue");
    const template = readTemplate(item);
    const nodes = kitNodes(item, template);
    const assets = kitAssetPaths(nodes);
    const city = nodes.find(node => kitMetadata(node)?.source.type === "widget.3d.city-builder")!;
    const contains = new Set<string>();
    const walk = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const item = value as Record<string, unknown>;
      if (typeof item.relativeDir === "string" && item.__kitDirectoryFiles) {
        contains.add(item.relativeDir.split("\\").at(-1)!);
        const files = item.__kitDirectoryFiles as Record<string, string>;
        expect(Object.keys(files)).toEqual(expect.arrayContaining(["index.json", "meta.json"]));
        expect(Object.keys(files).some(path => path.endsWith(".glbx"))).toBe(true);
        for (const path of Object.values(files)) expect(assets).toContain(path.slice(1));
      }
      Object.values(item).forEach(walk);
    };
    walk(kitMetadata(city)?.source.pieces);
    expect([...contains].sort()).toEqual(["垂柳", "柳树"]);
  });

  it("三维画布的几何选项携带发布资源，并在 WASM 同步时保留几何纹理", async () => {
    const item = kitCatalog.find(candidate => candidate.template.endsWith("/violet-046-705.json"))!;
    const [original] = kitNodes(item, readTemplate(item), { x: 0, y: 0 });
    const enabled = resolveKitOptions(original!, { [KIT_CITY_GEOMETRY_OPTION]: true });
    const source = "/kits/assets/3b40a83cc96a01e3e3fec13a9e851005151c13bc0bc04133bd421aec9d481b07.glb";
    const preview = kitModelPreviewAsset(source)!.slice(1);
    const texture = "/kits/assets/5edeaac15d21135d153c7858eb190a06d57591e3e01039f29a92c95306044a1e.webp";
    const texturePreview = kitTexturePreviewAsset(texture)!.slice(1);
    expect(kitAssetPaths([original!])).not.toContain(preview);
    expect(kitAssetPaths([original!])).not.toContain(texturePreview);
    expect(kitAssetPaths([enabled])).toEqual(expect.arrayContaining([source.slice(1), preview, texture.slice(1), texturePreview]));
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      const draw = (node: SceneNode) => {
        surface.sync_scene(encodeBoardSync({ width: 160, height: 90, preview: true,
          selected: [], nodes: boardNodes([node], true) }));
        return surface.snapshot(160, 90, encodeBoardClock(boardClock(new Date(0))));
      };
      const pixels = new Uint8Array([255, 0, 0, 255]);
      draw(enabled);
      surface.set_image(`\u001fcity:${enabled.id}`, 1, 1, pixels);
      const first = draw(enabled), cover = draw(original!), restored = draw(enabled);
      expect(first.some((value, index) => value !== cover[index])).toBe(true);
      expect(restored).toEqual(first);
    } finally { surface.free(); }
  });

  it("套件样式按数据条件和备用值即时更新，项目仍保留原始样式", () => {
    const item = entry("大标题(1920X1080）");
    const rules = [{ sourceId: "builtin:project-params", field: "warning", operator: "=",
      value: "yes", selector: "first", index: 1 }] satisfies DataConditionRule[];
    const condition: BoardDataCondition = { id: "alert", name: "告警", groups: [rules] };
    const [node] = kitNodes(item, { type: "widget.basic.text", options: {
      text: "常温", opacity: 100, __kitConditionStyles: {
        opacity: { rules: [{ condition: "alert", value: 70 }], otherwise: 30 },
        text: { rules: [{ condition: "alert", value: "高温" }], otherwise: "正常" },
        "map-key": { rules: [{ condition: "alert", value: ["ignored-key"] }] },
      },
    } }, { x: 0, y: 0 });
    const resolve = (warning: string) => resolveRuntimeScene([node!],
      { "builtin:project-params": { warning } }, {}, [condition])[0]!;
    expect(boardNodes([resolve("yes")])[0]!.widget).toMatchObject({ opacity: .7, text: "高温" });
    expect(boardNodes([resolve("no")])[0]!.widget).toMatchObject({ opacity: .3, text: "正常" });
    expect(boardNodes(resolveRuntimeScene([node!], {}, {}, []))[0]!.widget).toMatchObject({ opacity: 1, text: "常温" });
    expect(node!.widget!.text).toBe("常温");
  });

  it("调用代码示例使用的属性写入复用交互覆盖并传入 Rust 画布", () => {
    const [node] = kitNodes(entry("大标题(1920X1080）"), { type: "widget.basic.text", options: {
      text: "原文", opacity: 100,
    } });
    const runtime = {};
    expect(applyScriptKitOption(node, runtime, "text", "脚本设置")).toBe(true);
    expect(applyScriptKitOption(node, runtime, "opacity", 45)).toBe(true);
    expect(applyScriptKitOption(node, runtime, "map-key", ["hidden"])).toBe(false);
    expect(boardNodes(resolveRuntimeScene([node!], {}, runtime))[0]!.widget)
      .toMatchObject({ text: "脚本设置", opacity: .45 });
    expect(node!.widget!.text).toBe("原文");
  });

  it("琉光金真实模板的桑基图、箱型图、甘特图和河流图用各自的字段结构", async () => {
    const get = (prefix: string) => {
      const template = kitCatalog.find(item => item.id.startsWith(`glazed-gold-${prefix}-`))!;
      return kitNodes(template, readTemplate(template), { x: 0, y: 0 })[0]!;
    };
    const sankey = get("057"), box = get("059"), gantt = get("054"), river = get("036");
    expect(sankey.data?.rows).toContainEqual(expect.objectContaining({ source: "页面", target: "首页", value: 20 }));
    expect(box.data?.rows).toContainEqual(expect.objectContaining({ name: "500", min: 740, q1: 850,
      median: 900, q3: 980, max: 1000 }));
    expect((box.data?.rows as unknown[])).toHaveLength(5);
    expect(gantt.data?.rows).toContainEqual(expect.objectContaining({ name: "任务一",
      start: Date.UTC(2020, 4, 8), end: Date.UTC(2020, 4, 13), value: .5 }));
    expect(river.data?.chart).toMatchObject({ seriesLabels: ["示例一", "示例二", "示例三", "示例四"], seriesCount: 4 });
    expect((river.data?.rows as unknown[])).toHaveLength(3);
    const rebound = resolveRuntimeScene([sankey], { [sankey.id]: { rows: [
      { f_sample_source: "来水", f_sample_target: "供水", f_sample_value: 9 },
    ] } }, {});
    expect(rebound[0]!.data?.rows).toEqual([expect.objectContaining({ source: "来水", target: "供水", value: 9 })]);
    const legacy = { ...gantt, data: { ...gantt.data, chart: { variant: "horizontalRange" }, rows: [{ name: "任务一", value: .5 }] } };
    const reopened = resolveRuntimeScene([legacy], {}, {})[0]!;
    expect(reopened.data?.chart).toMatchObject({ variant: "gantt" });
    expect(reopened.data?.rows).toEqual(gantt.data?.rows);

    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      const draw = (node: SceneNode) => {
        surface.sync_scene(encodeBoardSync({ width: 460, height: 290, preview: true, selected: [], nodes: boardNodes([node], true) }));
        return surface.snapshot(460, 290, encodeBoardClock(boardClock(new Date(0))));
      };
      const pairs = [
        [sankey, { "link-opacity": 0 }],
        [box, { "boxDiagram-width": 12 }],
        [gantt, { "gantt-height": 24 }],
        [river, { "shape-top-space": 35, "shape-border-width": 2 }],
      ] as const;
      for (const [original, change] of pairs) {
        const first = draw(original), changed = draw(resolveKitOptions(original, change));
        expect(first.some((value, index) => value !== changed[index]), original.name).toBe(true);
      }
    } finally { surface.free(); }
  });

  it("套件图片尚未解码时不会在画布上闪现加载文字", async () => {
    const nodes = boardNodes(kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.basic.image", options: {
      size: [200, 40], image: { relativePath: "/kits/assets/pending.webp" }, background: false, border: false,
    } }, { x: 0, y: 0 }), true);
    expect(nodes[0]!.widget.image).toContain("pending.webp");
    expect(nodes[0]!.data.__kitQuietMedia).toBe(true);
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 200, height: 40, preview: true, selected: [], nodes }));
      const pixels = surface.snapshot(200, 40, encodeBoardClock(boardClock(new Date(0))));
      expect(Array.from(pixels.slice(8)).filter((_, index) => index % 4 === 3).every(alpha => alpha === 0)).toBe(true);
      nodes[0]!.data.__kitQuietMedia = false;
      surface.sync_scene(encodeBoardSync({ width: 200, height: 40, preview: true, selected: [], nodes }));
      const ordinary = surface.snapshot(200, 40, encodeBoardClock(boardClock(new Date(0))));
      expect(Array.from(ordinary.slice(8)).some((alpha, index) => index % 4 === 3 && alpha > 0)).toBe(true);
    } finally { surface.free(); }
  });

  it("列表新出现的图片复用已解码的相同资源", () => {
    const nodes = boardNodes(kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.group.list-v2", options: {
      size: [200, 80], "list-display-count": 2, "axis-fields": [{ uid: ["name"], summary: "none" }],
    }, privateData: { fields: [{ uid: "name" }], rows: [{ name: "甲" }, { name: "乙" }] }, widgets: [
      { type: "widget.basic.image", options: { size: [20, 20], image: { relativePath: "/kits/assets/icon.webp" } } },
    ] }, { x: 0, y: 0 }), true).filter(node => node.widget.kind === "image");
    expect(nodes).toHaveLength(2);
    class DecodedImage { naturalWidth = 20; }
    vi.stubGlobal("HTMLImageElement", DecodedImage);
    const image = new DecodedImage();
    const key = JSON.stringify(["image", nodes[0]!.widget.image, "", nodes[0]!.data.loop,
      nodes[0]!.data.muted, nodes[0]!.data.__kitImageFilter]);
    const resources = new Map([[nodes[0]!.id, { key, element: image, settled: true,
      createdAt: 0, pending: Promise.resolve(), dispose: vi.fn() }]]);
    const uploadPixels = vi.fn();
    const host = Object.assign(Object.create(RustBoardHost.prototype), { state: { preview: true }, nodes,
      surface: { clear_image: vi.fn() }, resources, uploadPixels, dirty: false,
    }) as { loadResources(): void };
    try {
      host.loadResources();
      expect(resources.get(nodes[1]!.id)?.element).toBe(image);
      expect(uploadPixels).toHaveBeenCalledWith(nodes[1]!.id, image);
    } finally { vi.unstubAllGlobals(); }
  });

  it("真实套件中的数据菜单和下拉框显示绑定字段的选项", () => {
    const read = (name: string): ReferenceKitWidget => JSON.parse(readFileSync(
      new URL(`../../public/kits/templates/${name}.json`, import.meta.url), "utf8"));
    const city = kitNodes(entry("模板布局3D(1920X1080)"), read("city-ioc-081-985856892ce42c266be72b3f64ba5bd6"));
    const menu = city.find(node => kitMetadata(node)?.source.name === "横向菜单分类2")!;
    expect(menu.data?.items).toEqual(["人员", "车辆", "物资", "医疗"]);
    const highway = kitNodes(entry("模板布局3D(1920X1080)"), read("highway-013-d9b83751619118902b3fd6244a93d567"));
    const dropdown = highway.find(node => kitMetadata(node)?.source.type === "widget.basic.dropdown-v2")!;
    expect(dropdown.data?.options).toContain("选项一");
    expect(dropdown.data?.options).toContain("选项六");
  });
});

describe("套件插入与配置编辑", () => {
  beforeEach(() => handle({ type: "openProject", projectId: "kit", tree: [], template: "empty" }));

  it("按钮各状态的文字对齐、偏移和边框设置进入实际画布", async () => {
    const nodes = boardNodes(kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.basic.button-v2", options: {
      size: [200, 80], text: "A", "background-default-color": "transparent", "border-default-style": "none",
      "border-default-width": 8, "text-default-font": { size: 20, color: "#ffffff" },
      "text-default-position": "left", "text-default-vertical": "top", "text-offset-default": [10, 10], padding: [3, 0, 0, 5],
      "show-hover": true, "text-hover-position": "right", "text-hover-vertical": "end", "text-offset-hover": [-5, -6],
      "text-hover-font": { size: 20, color: "#ffffff" }, "border-hover-style": "none", "background-hover-color": "transparent",
    } }, { x: 0, y: 0 }), true);
    expect(nodes[0]!.data.__kitButton).toMatchObject({ styles: {
      default: { align: "left", vertical: "top", offset: [10, 10], padding: [3, 0, 0, 5], borderWidth: 0 },
      hover: { align: "right", vertical: "end", offset: [-5, -6] },
    } });
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 200, height: 80, preview: true, selected: [], nodes }));
      const pixels = surface.snapshot(200, 80, encodeBoardClock(boardClock(new Date(0))));
      let left = 0, center = 0, beforePadding = 0;
      for (let y = 0; y < 50; y++) for (let x = 0; x < 200; x++) {
        if (pixels[8 + (y * 200 + x) * 4 + 3]! > 100) {
          if (x < 60) left++; else if (x > 70 && x < 130) center++;
          if (x < 15 || y < 13) beforePadding++;
        }
      }
      expect(left).toBeGreaterThan(5);
      expect(center).toBe(0);
      expect(beforePadding).toBe(0);
      surface.pointer("move", 100, 40);
      const hovered = surface.snapshot(200, 80, encodeBoardClock(boardClock(new Date(0))));
      let bottomRight = 0, topLeft = 0;
      for (let y = 0; y < 80; y++) for (let x = 0; x < 200; x++) {
        if (hovered[8 + (y * 200 + x) * 4 + 3]! > 100) {
          if (x > 150 && y > 40) bottomRight++;
          if (x < 60 && y < 50) topLeft++;
        }
      }
      expect(bottomRight).toBeGreaterThan(5);
      expect(topLeft).toBe(0);
    } finally { surface.free(); }
  });

  it("按钮字体间隔与文字发光会改变画布输出", async () => {
    const make = (spacing: number, glow = false) => boardNodes(kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.basic.button-v2", options: { size: [250, 70], text: "AAAA", "border-default-style": "none",
        "background-default-color": "transparent", "text-default-position": "left", "text-default-vertical": "start",
        "text-offset-default": [10, 0], "text-default-font": { family: "sans-serif", size: 20, color: "#ffffff" },
        "font-default-spacing": spacing, "font-default-shadow-color": "#ff0000",
        "font-default-shadow-blur": glow ? 0 : -1, "font-default-shadow-offset": [0, 25],
      },
    }, { x: 0, y: 0 }), true);
    const normal = make(0), spaced = make(8, true);
    expect(spaced[0]!.data.__kitButton).toMatchObject({ styles: { default: {
      letterSpacing: 8, glowColor: "#ff0000", glowBlur: 0, glowOffset: [0, 25],
    } } });
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      const snapshot = (nodes: typeof normal) => {
        surface.sync_scene(encodeBoardSync({ width: 250, height: 70, preview: true, selected: [], nodes }));
        return surface.snapshot(250, 70, encodeBoardClock(boardClock(new Date(0))));
      };
      const first = snapshot(normal), second = snapshot(spaced);
      const rightEdge = (pixels: Uint8Array) => {
        let max = 0;
        for (let y = 0; y < 24; y++) for (let x = 0; x < 250; x++)
          if (pixels[8 + (y * 250 + x) * 4 + 3]! > 100) max = Math.max(max, x);
        return max;
      };
      expect(rightEdge(second)).toBeGreaterThan(rightEdge(first) + 15);
      let red = 0;
      for (let y = 26; y < 55; y++) for (let x = 0; x < 250; x++) {
        const i = 8 + (y * 250 + x) * 4;
        if (second[i]! > 150 && second[i + 1]! < 20 && second[i + 3]! > 100) red++;
      }
      expect(red).toBeGreaterThan(5);
    } finally { surface.free(); }
  });

  it("按钮边框样式区分实线、虚线和无边框", async () => {
    const make = (borderStyle: string) => boardNodes(kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.basic.button-v2", options: { size: [100, 40], text: "", "background-default-color": "transparent",
        "border-default-style": borderStyle, "border-default-width": 2, "border-default-color": "#ff0000" },
    }, { x: 0, y: 0 }), true);
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      const count = (style: string) => {
        surface.sync_scene(encodeBoardSync({ width: 100, height: 40, preview: true, selected: [], nodes: make(style) }));
        const pixels = surface.snapshot(100, 40, encodeBoardClock(boardClock(new Date(0))));
        return Array.from({ length: 90 }, (_, index) => pixels[8 + (100 + index + 5) * 4 + 3]!).filter(alpha => alpha > 100).length;
      };
      const solid = count("solid"), dashed = count("dashed"), none = count("none");
      expect(solid).toBeGreaterThan(80);
      expect(dashed).toBeGreaterThan(20);
      expect(dashed).toBeLessThan(solid - 10);
      expect(none).toBe(0);
    } finally { surface.free(); }
  });

  it("按钮无填充背景按图片比例和位置绘制", async () => {
    const nodes = boardNodes(kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.basic.button-v2", options: { size: [100, 100], text: "", "border-default-style": "none",
        "background-default-color": "transparent", "background-default-image": { relativePath: "/kits/assets/test.webp" },
        "background-default-fill-type": "none", "background-image-scale-default": 50,
        "background-image-position-default": [10, -5] },
    }, { x: 0, y: 0 }), true);
    const texture = nodes.find(node => node.data.__kitResource)!;
    expect(nodes.find(node => node.widget.kind === "button")!.data.__kitButton).toMatchObject({ styles: {
      default: { fit: "none", imageScale: 50, imageOffset: [10, -5] },
    } });
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 100, height: 100, preview: true, selected: [], nodes }));
      const image = new Uint8Array(20 * 20 * 4);
      for (let index = 0; index < image.length; index += 4) { image[index] = 255; image[index + 3] = 255; }
      surface.set_image(texture.id, 20, 20, image);
      const pixels = surface.snapshot(100, 100, encodeBoardClock(boardClock(new Date(0))));
      const sample = (x: number, y: number) => Array.from(pixels.slice(8 + (y * 100 + x) * 4, 12 + (y * 100 + x) * 4));
      expect(sample(60, 45)).toEqual([255, 0, 0, 255]);
      expect(sample(50, 45)[3]).toBe(0);
      expect(sample(60, 55)[3]).toBe(0);
    } finally { surface.free(); }
  });

  it("按钮悬停与点击水波纹根据时长推进，指针移动不会重新开始", async () => {
    const nodes = boardNodes(kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.basic.button-v2", options: { size: [100, 50], text: "",
        "show-hover": true, "show-click": true, "animation-hover-show": true, "animation-click-show": true,
        "animation-hover-time": 0.4, "animation-click-time": 0.4,
        "background-default-color": "transparent", "background-hover-color": "transparent", "background-click-color": "transparent",
        "border-default-style": "none", "border-hover-style": "none", "border-click-style": "none",
      },
    }, { x: 0, y: 0 }), true);
    expect(nodes[0]!.data.__kitButton).toMatchObject({ hoverAnimation: true, clickAnimation: true,
      hoverDuration: 0.4, clickDuration: 0.4 });
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 100, height: 50, preview: true, selected: [], nodes }));
      const alpha = (time: number, x: number, y: number) => surface.snapshot(100, 50,
        encodeBoardClock(boardClock(new Date(time))))[8 + (y * 100 + x) * 4 + 3]!;
      expect(alpha(1000, 25, 25)).toBe(0);
      surface.pointer("move@1000", 25, 25);
      expect(alpha(1100, 25, 25)).toBeGreaterThan(0);
      surface.pointer("move@1100", 27, 25);
      expect(alpha(1500, 25, 25)).toBe(0);
      surface.pointer("leave", 0, 0);
      surface.pointer("down@2000", 75, 25);
      expect(alpha(2100, 75, 25)).toBeGreaterThan(0);
      expect(alpha(2500, 75, 25)).toBe(0);
    } finally { surface.free(); }
  });

  it("按钮动画在预览期间安排持续重绘", () => {
    const host = Object.assign(Object.create(RustBoardHost.prototype), { buttonRippleUntil: 0 }) as {
      buttonRippleUntil: number; animateKitButton(node: unknown, mode: "hover" | "click"): void;
    };
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    try {
      const node = { data: { __kitButton: { hover: true, hoverAnimation: true, hoverDuration: 0.4,
        click: true, clickAnimation: false, clickDuration: 2 } } };
      host.animateKitButton(node, "hover");
      expect(host.buttonRippleUntil).toBe(1450);
      host.animateKitButton(node, "click");
      expect(host.buttonRippleUntil).toBe(1450);
    } finally { now.mockRestore(); }
  });

  it("菜单按保存的选项键应用独立样式，保留文字和边框配置", async () => {
    const nodes = boardNodes(kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.group.buttons-v2", options: { size: [300, 40], layout: [1, 3],
        "button-name-option": ["甲", "乙", "丙"], "allow-unselected": true, "selected-key": "旧乙-1",
        "last-button-list": [{ label: "甲", key: "旧甲-0" }, { label: "乙", key: "旧乙-1" }, { label: "丙", key: "旧丙-2" }],
        "item-style-cluster": { indexes: ["base", "third", "second"],
          base: { "background-color-default": "#ff0000", "background-color-selected": "#ff0000",
            "border-size-default": 0, "border-size-selected": 0, "font-default": { size: 0 } },
          third: { "item-key": "旧丙-2", "background-color-default": "#00ff00" },
          second: { "item-key": "旧乙-1", "background-color-default": "#0000ff", "background-color-selected": "#0000ff",
            "text-align-default": "left", "text-offset-default": [3, 4], "text-spacing-default": 2,
            "border-style-default": "dashed", "font-shadow-blur-default": 5 },
        },
      },
    }, { x: 0, y: 0 }), true);
    const menu = nodes.find(node => node.data.__kitMenu)!;
    expect(menu.data.active).toBe(1);
    expect(menu.data.__kitMenu).toMatchObject({ styleIndexes: [0, 2, 1], styles: [
      {}, {}, { default: { align: "left", offset: [3, 4], letterSpacing: 2, borderStyle: "dashed", glowBlur: 5 } },
    ] });
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 300, height: 40, preview: true, selected: [], nodes }));
      const pixels = surface.snapshot(300, 40, encodeBoardClock(boardClock(new Date(0))));
      const sample = (x: number) => Array.from(pixels.slice(8 + (5 * 300 + x) * 4, 12 + (5 * 300 + x) * 4));
      expect(sample(25)).toEqual([255, 0, 0, 255]);
      expect(sample(125)).toEqual([0, 0, 255, 255]);
      expect(sample(225)).toEqual([0, 255, 0, 255]);
    } finally { surface.free(); }
  });

  it("菜单使用独立按钮尺寸、逐项偏移和旋转绘制及命中", async () => {
    const nodes = boardNodes(kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.group.buttons-v2", options: { size: [300, 100], layout: [1, 3], "item-size": [60, 20],
        "button-name-option": ["甲", "乙", "丙"], "allow-unselected": true, "selected-key": "",
        overflow: "visible", "layout-cluster": { indexes: ["one", "two", "three"],
          one: {}, two: { "offset-x": 10, "offset-y": 5, "item-rotation": 90 }, three: { "offset-x": 80 } },
        "item-style-cluster": { indexes: ["base", "second", "third"],
          base: { "background-color-default": "#ff0000", "border-size-default": 0, "font-default": { size: 0 } },
          second: { "item-key": "乙-1", "background-color-default": "#0000ff" },
          third: { "item-key": "丙-2", "background-color-default": "#00ff00" } },
      },
    }, { x: 0, y: 0 }), true);
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      const sync = (drawn: typeof nodes) => surface.sync_scene(encodeBoardSync({ width: 400, height: 100,
        preview: true, selected: [], nodes: drawn }));
      const clock = encodeBoardClock(boardClock(new Date(0)));
      sync(nodes);
      const pixels = surface.snapshot(400, 100, clock);
      const sample = (x: number, y: number) => Array.from(pixels.slice(8 + (y * 400 + x) * 4, 12 + (y * 400 + x) * 4));
      expect(sample(50, 50)).toEqual([255, 0, 0, 255]);
      expect(sample(5, 50)[3]).toBe(0);
      expect(sample(160, 30)).toEqual([0, 0, 255, 255]);
      expect(sample(135, 55)[3]).toBe(0);
      expect(sample(330, 50)).toEqual([0, 255, 0, 255]);
      surface.pointer("down", 160, 30); surface.pointer("up", 160, 30);
      const events: unknown[] = [];
      dispatchCommandResponse(surface.take_events(), { boardEvent: event => events.push(event.value) });
      expect(events).toContain("乙");
      expect(decodeHitResult(surface.hit_test(330, 50))?.id).toBe(nodes[0]!.id);
      const hidden = nodes.map(node => node.data.__kitMenu ? { ...node, data: { ...node.data,
        __kitMenu: { ...node.data.__kitMenu as Record<string, unknown>, overflow: "hidden" } } } : node);
      sync(hidden);
      expect(surface.snapshot(400, 100, clock)[8 + (50 * 400 + 330) * 4 + 3]).toBe(0);
      expect(decodeHitResult(surface.hit_test(330, 50))).toBeNull();
    } finally { surface.free(); }
  });

  it("菜单滚动布局按可见数量排布，滚轮与滚动条改变可点击项", async () => {
    const make = (vertical: boolean) => boardNodes(kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.group.buttons-v2", options: {
        size: vertical ? [50, 200] : [200, 50], "item-size": vertical ? [30, 60] : [60, 30],
        "button-name-option": ["甲", "乙", "丙", "丁"], "allow-unselected": true, "selected-key": "",
        "layout-setting": "scroll", "layout-scroll-count": 2, "layout-arrangement": vertical ? "vertical" : "horizontal",
        "layout-wheel-scroll": true, "show-scrollbar": true, "scrollbar-size": 6,
        "scrollbar-color": "#aaaaaa", "scrollbar-bg-color": "#333333", overflow: "visible",
        "item-style-cluster": { indexes: ["base", "two", "three", "four"],
          base: { "background-color-default": "#ff0000", "background-color-selected": "#ff0000",
            "border-size-default": 0, "font-default": { size: 0 }, "font-selected": { size: 0 }, "item-hover-enable": false },
          two: { "item-key": "乙-1", "background-color-default": "#0000ff", "background-color-selected": "#0000ff" },
          three: { "item-key": "丙-2", "background-color-default": "#00ff00", "background-color-selected": "#00ff00" },
          four: { "item-key": "丁-3", "background-color-default": "#ffff00", "background-color-selected": "#ffff00" } },
      },
    }, { x: 0, y: 0 }), true);
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      const clock = encodeBoardClock(boardClock(new Date(0)));
      const sync = (vertical: boolean) => {
        const width = vertical ? 50 : 200, height = vertical ? 200 : 50;
        surface.sync_scene(encodeBoardSync({ width, height, preview: true, selected: [], nodes: make(vertical) }));
        return { width, height };
      };
      let { width, height } = sync(false);
      const sample = (x: number, y: number) => Array.from(surface.snapshot(width, height, clock)
        .slice(8 + (y * width + x) * 4, 12 + (y * width + x) * 4));
      expect(sample(50, 20)).toEqual([255, 0, 0, 255]);
      expect(sample(150, 20)).toEqual([0, 0, 255, 255]);
      expect(sample(25, 47)).toEqual([170, 170, 170, 255]);
      expect(sample(175, 47)).toEqual([51, 51, 51, 255]);
      surface.pointer("wheel-down", 50, 20);
      expect(sample(50, 20)).toEqual([0, 0, 255, 255]);
      expect(sample(150, 20)).toEqual([0, 255, 0, 255]);
      surface.pointer("down", 150, 20); surface.pointer("up", 150, 20);
      const events: unknown[] = [];
      dispatchCommandResponse(surface.take_events(), { boardEvent: event => events.push(event.value) });
      expect(events).toContain("丙");
      surface.pointer("down", 100, 47); surface.pointer("move", 160, 47); surface.pointer("up", 160, 47);
      expect(sample(50, 20)).toEqual([0, 255, 0, 255]);
      expect(sample(150, 20)).toEqual([255, 255, 0, 255]);
      ({ width, height } = sync(true));
      expect(sample(20, 50)).toEqual([255, 0, 0, 255]);
      surface.pointer("wheel-down", 20, 50);
      expect(sample(20, 50)).toEqual([0, 0, 255, 255]);
      expect(sample(20, 150)).toEqual([0, 255, 0, 255]);
      expect(sample(47, 125)).toEqual([170, 170, 170, 255]);
    } finally { surface.free(); }
  });

  it("菜单文字过长策略可将长文本限制在按钮宽度内", async () => {
    const make = (overflow: string) => boardNodes(kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.group.buttons-v2", options: { size: [120, 50], layout: [1, 1], "item-size": [60, 40],
        "button-name-option": ["MMMMMMMMMMMM"], "allow-unselected": true, "selected-key": "",
        "text-overflow": overflow, overflow: "visible", "item-style-cluster": { indexes: ["base"], base: {
          "background-color-default": "transparent", "border-size-default": 0,
          "font-default": { size: 20, color: "#ffffff" }, "item-hover-enable": false,
        } },
      },
    }, { x: 0, y: 0 }), true);
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      const count = (overflow: string) => {
        surface.sync_scene(encodeBoardSync({ width: 120, height: 50, preview: true, selected: [], nodes: make(overflow) }));
        const pixels = surface.snapshot(120, 50, encodeBoardClock(boardClock(new Date(0))));
        let inside = 0, outside = 0;
        for (let y = 0; y < 50; y++) for (let x = 0; x < 120; x++) {
          if (pixels[8 + (y * 120 + x) * 4 + 3]! > 32) {
            if (x >= 30 && x < 90) inside++; else outside++;
          }
        }
        return { inside, outside };
      };
      const full = count("none"), abbreviated = count("ellipsis");
      expect(full.outside).toBeGreaterThan(10);
      expect(abbreviated.inside).toBeGreaterThan(10);
      expect(abbreviated.outside).toBe(0);
    } finally { surface.free(); }
  });

  it("菜单右键取消选中，重复左键只在允许重复触发时发送交互", async () => {
    const create = (repeat: boolean, unselect = true) => kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.group.buttons-v2", options: { size: [200, 50], layout: [1, 2], "item-size": [100, 50],
        "button-name-option": ["甲", "乙"], "selected-key": "甲-0", "allow-unselected": unselect,
        "allow-repeated-trigger": repeat, "item-style-cluster": { indexes: ["base"], base: {
          "background-color-default": "#ff0000", "background-color-selected": "#0000ff", "border-size-default": 0,
          "border-size-selected": 0, "font-default": { size: 0 }, "font-selected": { size: 0 }, "item-hover-enable": false,
        } },
      },
    }, { x: 0, y: 0 });
    const make = (repeat: boolean, unselect = true) => boardNodes(create(repeat, unselect), true);
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      const sync = (repeat: boolean, unselect = true) => surface.sync_scene(encodeBoardSync({ width: 200, height: 50,
        preview: true, selected: [], nodes: make(repeat, unselect) }));
      const pixels = (x: number) => Array.from(surface.snapshot(200, 50, encodeBoardClock(boardClock(new Date(0))))
        .slice(8 + (20 * 200 + x) * 4, 12 + (20 * 200 + x) * 4));
      const values = () => {
        const output: unknown[] = [];
        dispatchCommandResponse(surface.take_events(), { boardEvent: event => output.push(event.value) });
        return output;
      };
      const click = (x: number) => { surface.pointer("down", x, 20); surface.pointer("up", x, 20); };
      sync(false);
      expect(pixels(50)).toEqual([0, 0, 255, 255]);
      click(50);
      expect(values()).toEqual([]);
      expect(pixels(50)).toEqual([0, 0, 255, 255]);
      surface.pointer("context", 150, 20);
      expect(values()).toEqual([""]);
      expect(pixels(50)).toEqual([255, 0, 0, 255]);
      click(150);
      expect(values()).toEqual(["乙"]);
      click(150);
      expect(values()).toEqual([]);
      sync(true);
      click(50);
      expect(values()).toEqual([{ __kitMenuRepeat: true, value: "甲" }]);
      sync(false, false);
      surface.pointer("context", 150, 20);
      expect(values()).toEqual([]);
      expect(pixels(50)).toEqual([0, 0, 255, 255]);

      const scene = create(false), rendered = boardNodes(scene, true);
      surface.sync_scene(encodeBoardSync({ width: 200, height: 50, preview: true, selected: [], nodes: rendered }));
      const onComponentEvent = vi.fn(), onKitMenuClear = vi.fn();
      const host = Object.assign(Object.create(RustBoardHost.prototype), {
        state: { scene }, nodes: rendered, surface, selectedItemValues: new Map(),
        options: { onComponentEvent, onKitMenuClear }, layer: { dispatchEvent: vi.fn() },
      }) as { drainEvents(): boolean };
      click(150);
      host.drainEvents();
      expect(onComponentEvent.mock.calls.map(call => [call[1], call[2]]))
        .toEqual([["componentUnselected", "甲"], ["componentSelected", "乙"], ["itemClick", "乙"]]);
      onComponentEvent.mockClear();
      surface.pointer("context", 50, 20);
      host.drainEvents();
      expect(onComponentEvent.mock.calls.map(call => [call[1], call[2]])).toEqual([["componentUnselected", "乙"]]);
      expect(onKitMenuClear).toHaveBeenCalledOnce();
      expect(onKitMenuClear).toHaveBeenCalledWith(scene[0]);
      onComponentEvent.mockClear();
      click(50);
      host.drainEvents();
      expect(onComponentEvent.mock.calls.map(call => [call[1], call[2]]))
        .toEqual([["componentSelected", "甲"], ["itemClick", "甲"]]);
    } finally { surface.free(); }
  });

  it("编辑和排序菜单选项时保留默认项与对应联动值，且可撤销", () => {
    const options = { "button-name-option": ["甲", "乙", "丙"], "selected-key": "乙-1",
      "linkage-values": { "甲-0": "A", "乙-1": "B", "丙-2": "C" } };
    const patch = kitChoiceEditPatch(options, "button-name-option", ["丙", "甲", "乙"], [2, 0, 1]);
    expect(patch).toEqual({ "button-name-option": ["丙", "甲", "乙"], "selected-key": "乙-2",
      "linkage-values": { "丙-0": "C", "甲-1": "A", "乙-2": "B" } });
    const renamed = kitChoiceEditPatch(patch, "button-name-option", ["丙", "甲", "新乙"], [0, 1, 2]);
    expect(renamed["selected-key"]).toBe("新乙-2");
    expect(renamed["linkage-values"]).toMatchObject({ "新乙-2": "B" });
    const removed = kitChoiceEditPatch(renamed, "button-name-option", ["丙", "甲"], [0, 1]);
    expect(removed["selected-key"]).toBe("");
    expect(removed["linkage-values"]).toEqual({ "丙-0": "C", "甲-1": "A" });
    const dropdown = kitChoiceEditPatch({ "dropdown-value-text-option": ["一", "二"],
      "dropdown-default-value": "二", "show-default-option": true }, "dropdown-value-text-option", ["一"], [0]);
    expect(dropdown["dropdown-default-value"]).toBe("___default___");

    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.group.buttons-v2", options });
    const inserted = handle({ type: "insertKit", nodes })!, id = inserted.selectedId!;
    const changed = handle({ type: "patchKitOptions", id, patch })!;
    expect(kitMetadata(changed.tree.find(node => node.id === id)!)!.source.options).toMatchObject(patch);
    const undone = handle({ type: "undo" })!;
    expect(kitMetadata(undone.tree.find(node => node.id === id)!)!.source.options).toMatchObject(options);
  });

  it("菜单选项改名和排序时同步更新旧键与独立样式", () => {
    const options = { "button-name-option": ["甲", "乙"], "selected-key": "旧乙-1",
      "last-button-list": [{ label: "甲", key: "旧甲-0", value: "甲" }, { label: "乙", key: "旧乙-1", value: "乙" }],
      "item-style-cluster": { indexes: ["base", "custom"], base: {}, custom: { "item-key": "旧乙-1", color: "blue" } },
      "linkage-values": { "旧甲-0": "A", "旧乙-1": "B" },
    };
    const patch = kitChoiceEditPatch(options, "button-name-option", ["新乙", "甲"], [1, 0]);
    expect(patch).toMatchObject({ "selected-key": "新乙-0", "linkage-values": { "新乙-0": "B", "甲-1": "A" },
      "last-button-list": [{ label: "新乙", key: "新乙-0", value: "新乙" }, { label: "甲", key: "甲-1", value: "甲" }],
      "item-style-cluster": { custom: { "item-key": "新乙-0", color: "blue" } },
    });
    expect(options["item-style-cluster"].custom["item-key"]).toBe("旧乙-1");
    const deleted = kitChoiceEditPatch(options, "button-name-option", ["甲"], [0]);
    expect(deleted["item-style-cluster"]).toEqual({ indexes: ["base"], base: {} });
  });

  it("缩放套件容器时按各组件的响应式布局处理，并支持嵌套和撤销", () => {
    const child = (name: string, x: string, y: string): ReferenceKitWidget => ({
      name, type: "widget.basic.text", options: { position: [10, 10], size: [40, 20],
        "responsive-x": x, "responsive-y": y },
    });
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.group.panel", options: { size: [200, 100] }, widgets: [
        child("固定", "left", "top"), child("右下", "right", "bottom"),
        child("居中", "center", "middle"), child("双边", "left-right", "top-bottom"),
        child("缩放", "scale", "scale"),
        { name: "内层", type: "widget.group.panel", options: { position: [60, 20], size: [100, 50],
          "responsive-x": "scale", "responsive-y": "scale" }, widgets: [
          { name: "内层右下", type: "widget.basic.text", options: { position: [10, 10], size: [10, 10],
            "responsive-x": "right", "responsive-y": "bottom" } },
        ] },
      ],
    }, { x: 10, y: 20 });
    const inserted = handle({ type: "insertKit", nodes })!;
    const changed = handle({ type: "patchKitOptions", id: inserted.selectedId!,
      patch: { position: [30, 50], size: [400, 200] } })!;
    const rect = (name: string, tree = changed.tree) => {
      const item = tree.find(node => node.name === name)!;
      return [item.transform.position.x, item.transform.position.y, item.boxSize!.x, item.boxSize!.y];
    };
    expect(rect("固定")).toEqual([40, 60, 40, 20]);
    expect(rect("右下")).toEqual([240, 160, 40, 20]);
    expect(rect("居中")).toEqual([140, 110, 40, 20]);
    expect(rect("双边")).toEqual([40, 60, 240, 120]);
    expect(rect("缩放")).toEqual([50, 70, 80, 40]);
    expect(rect("内层")).toEqual([150, 90, 200, 100]);
    expect(rect("内层右下")).toEqual([260, 150, 10, 10]);
    const undone = handle({ type: "undo" })!;
    expect(rect("内层右下", undone.tree)).toEqual([80, 50, 10, 10]);
  });

  it("响应式预览按画布尺寸调整套件和嵌套组件，同时保留编辑坐标", () => {
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), {
      name: "面板", type: "widget.group.panel", options: { size: [200, 100],
        "responsive-x": "left-right", "responsive-y": "top-bottom" }, widgets: [
        { name: "右下", type: "widget.basic.text", options: { position: [10, 10], size: [40, 20],
          "responsive-x": "right", "responsive-y": "bottom" } },
        { name: "水平居中", type: "widget.basic.text", options: { position: [30, 20], size: [20, 10],
          "responsive-x": "center", "responsive-y": "middle" } },
      ],
    }, { x: 10, y: 10 });
    const resized = responsiveKitScene(nodes, { width: 400, height: 200 }, { width: 600, height: 300 });
    const rect = (tree: typeof nodes, name: string) => {
      const item = tree.find(node => node.name === name)!;
      return [item.transform.position.x, item.transform.position.y, item.boxSize!.x, item.boxSize!.y];
    };
    expect(rect(resized, nodes[0]!.name)).toEqual([10, 10, 400, 200]);
    expect(rect(resized, "右下")).toEqual([220, 120, 40, 20]);
    expect(rect(resized, "水平居中")).toEqual([140, 80, 20, 10]);
    expect(rect(nodes, nodes[0]!.name)).toEqual([10, 10, 200, 100]);
    expect(rect(nodes, "右下")).toEqual([20, 20, 40, 20]);
    expect(responsiveKitScene(nodes, { width: 400, height: 200 }, { width: 400, height: 200 })).toBe(nodes);
  });

  it("指标卡在预览中按配置递增，并在数据更新时从当前值继续", async () => {
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.basic.card-v2", options: {
      size: [200, 50], placeholder: 100, "decimal-places": 0, "animation-display": true,
      "animation-delay": 0, "animation-duration": 1, "animation-type": "update", "animation-loop": false,
    } }, { x: 0, y: 0 });
    const drawn = boardNodes(nodes, true), playback = new Map<string, MetricAnimation>();
    prepareKitMetricAnimations(drawn, playback, 1000, true);
    expect(drawn[0]!.data.__kitMetricAnimation).toMatchObject({ startAt: 1000, from: 0, target: 100 });
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    const frame = (scene: typeof drawn, now: number) => {
      surface.sync_scene(encodeBoardSync({ width: 200, height: 50, preview: true, selected: [], nodes: scene }));
      return surface.snapshot(200, 50, encodeBoardClock(boardClock(new Date(now))));
    };
    try {
      const staticNode = { ...drawn[0]!, widget: { ...drawn[0]!.widget, value: "50" },
        data: { ...drawn[0]!.data, __kitMetricAnimation: undefined } };
      expect(frame(drawn, 1500)).toEqual(frame([staticNode], 1500));
      staticNode.widget.value = "100";
      expect(frame(drawn, 2000)).toEqual(frame([staticNode], 2000));
      const updated = [{ ...drawn[0]!, data: { ...drawn[0]!.data,
        __kitMetricAnimation: { ...(drawn[0]!.data.__kitMetricAnimation as object), target: 200 } } }];
      prepareKitMetricAnimations(updated, playback, 1500, true);
      expect(updated[0]!.data.__kitMetricAnimation).toMatchObject({ startAt: 1500, from: 50, target: 200 });
    } finally { surface.free(); }
  });

  it("文本滚动与闪烁在预览中改变画面，并在内容变化时重新计时", async () => {
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.basic.paragraph", options: {
      size: [120, 30], text: "AAAA\nBBBB\nCCCC", font: { size: 20, color: "#ffffff" },
      "font-line-height": 20, "text-position": "left", "animation-display": true,
      "animation-delay": 0, "animation-duration": 1, "animation-loop": false,
    } }, { x: 0, y: 0 });
    const drawn = boardNodes(nodes, true), playback = new Map<string, TextAnimation>();
    prepareKitTextAnimations(drawn, playback, 1000, true);
    expect(drawn[0]!.data.__kitTextAnimation).toMatchObject({ mode: "scroll", startAt: 1000 });
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    const frame = (scene: typeof drawn, now: number) => {
      surface.sync_scene(encodeBoardSync({ width: 120, height: 30, preview: true, selected: [], nodes: scene }));
      return surface.snapshot(120, 30, encodeBoardClock(boardClock(new Date(now))));
    };
    try {
      const initial = frame(drawn, 1000), middle = frame(drawn, 1500), final = frame(drawn, 2000);
      expect(middle).not.toEqual(initial);
      expect(final).not.toEqual(middle);
      const unchanged = boardNodes(nodes, true);
      prepareKitTextAnimations(unchanged, playback, 1500, true);
      expect(unchanged[0]!.data.__kitTextAnimation).toMatchObject({ startAt: 1000 });
      unchanged[0]!.widget.text = "新的文本";
      prepareKitTextAnimations(unchanged, playback, 1500, true);
      expect(unchanged[0]!.data.__kitTextAnimation).toMatchObject({ startAt: 1500 });

      const blinking = [{ ...drawn[0]!, data: { ...drawn[0]!.data,
        __kitTextAnimation: { ...(drawn[0]!.data.__kitTextAnimation as object), mode: "blink" } } }];
      expect(frame(blinking, 1500)).not.toEqual(frame(blinking, 1000));
      expect(frame(blinking, 2000)).toEqual(frame(blinking, 1000));
      const clock = vi.spyOn(Date, "now");
      try {
        (blinking[0]!.data as Record<string, unknown>).__kitTextAnimation = {
          startAt: 1000, delay: 100, duration: 1000, loop: true, interval: 1000,
        };
        clock.mockReturnValue(1050); expect(boardHasMotion(blinking[0]!)).toBe(false);
        clock.mockReturnValue(1600); expect(boardHasMotion(blinking[0]!)).toBe(true);
        clock.mockReturnValue(2300); expect(boardHasMotion(blinking[0]!)).toBe(false);
        clock.mockReturnValue(3200); expect(boardHasMotion(blinking[0]!)).toBe(true);
      } finally { clock.mockRestore(); }
      prepareKitTextAnimations(drawn, playback, 2500, false);
      expect(playback.size).toBe(0);
    } finally { surface.free(); }
  });

  it("具名数据条件按组内与、组间或筛选静态与实时数据，并随项目保存", () => {
    const rule = (field: string, operator: DataConditionRule["operator"], value: string,
      sourceId = "$current"): DataConditionRule => ({ sourceId, field, operator, value, selector: "each", index: 1 });
    const condition: BoardDataCondition = { id: "condition-1", name: "重点数据", groups: [
      [rule("city", "=", "杭州"), rule("value", ">=", "10")],
      [rule("$reverse-row", "=", "1"), rule("enabled", "=", "1", "builtin:project-params")],
    ] };
    const binding = (uid: string) => ({ uid: ["c_private", "t_private", uid], summary: "none" });
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.echarts.column", options: {
      "axis-x": [binding("city")], "axis-y": [binding("value")], filter: true,
      "filter-condition": "data-condition", "filter-condition-select": condition.id,
    }, privateData: { fields: [{ uid: "city", type: "string" }, { uid: "value", type: "number" }], rows: [
      { city: "杭州", value: 5 }, { city: "杭州", value: 10 }, { city: "上海", value: 20 }, { city: "宁波", value: 1 },
    ] } });
    const params = { "builtin:project-params": { enabled: 1 } };
    const staticResult = resolveRuntimeScene(nodes, params, {}, [condition]);
    expect(staticResult[0]!.data!.rows).toMatchObject([{ name: "杭州", value: 10 }, { name: "宁波", value: 1 }]);
    const live = resolveRuntimeScene(nodes, { ...params, [nodes[0]!.id]: { rows: [
      { city: "杭州", value: 12 }, { city: "上海", value: 3 }, { city: "苏州", value: 4 },
    ] } }, {}, [condition]);
    expect(live[0]!.data!.rows).toMatchObject([{ name: "杭州", value: 12 }, { name: "苏州", value: 4 }]);
    expect(boardNodes(live)[0]!.data.__kitFilterContext).toBeUndefined();
    const settings = validateEditorSettings({ boardDataConditions: [condition] });
    expect(settings.boardDataConditions).toEqual([condition]);
    const bytes = encodeProjectSnapshot({ name: "数据条件", savedAt: 1, scene: nodes,
      boardSize: { width: 1920, height: 1080 }, settings, params: {} });
    expect(validateEditorSettings(decodeSnapshotState(bytes).settings).boardDataConditions).toEqual([condition]);
  });

  it("套件数据联动按字段别名筛选目标，并能切换选中值与应用白名单", () => {
    const binding = (uid: string) => ({ uid: ["c_private", "t_private", uid], summary: "none" });
    const source = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.echarts.column", options: {
      "axis-x": [binding("category")], "axis-y": [binding("amount")], "linkage-out": true,
    }, privateData: { fields: [{ uid: "category", alias: "城市" }, { uid: "amount", alias: "收入" }], rows: [
      { category: "杭州", amount: 1 }, { category: "上海", amount: 2 },
    ] } })[0]!;
    const target = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.echarts.column", options: {
      "axis-x": [binding("city")], "axis-y": [binding("total")], "linkage-in": true,
    }, privateData: { fields: [{ uid: "city", alias: "城市" }, { uid: "total", alias: "销售额" }], rows: [
      { city: "杭州", total: 10 }, { city: "上海", total: 20 }, { city: "杭州", total: 30 },
    ] } })[0]!;
    target.id = "linkage-target";
    const scene = [source, target];
    const first = updateKitLinkage(scene, {}, {}, source, { name: "杭州", row: { name: "杭州", value: 1 } });
    expect(resolveRuntimeScene(scene, {}, first)[1]!.data!.rows).toMatchObject([
      { name: "杭州", value: 10 }, { name: "杭州", value: 30 },
    ]);
    expect(resolveRuntimeScene(scene, { [target.id]: { columns: ["city", "total"], rows: [
      ["上海", 4], ["杭州", 12],
    ] } }, first)[1]!.data!.rows).toMatchObject([{ name: "杭州", value: 12 }]);
    expect(boardNodes(resolveRuntimeScene(scene, {}, first))[1]!.data.__kitDataLinkage).toBeUndefined();
    const second = updateKitLinkage(scene, {}, first, source, { name: "上海" });
    expect(resolveRuntimeScene(scene, {}, second)[1]!.data!.rows).toMatchObject([{ name: "上海", value: 20 }]);
    const cleared = updateKitLinkage(scene, {}, second, source, "", "");
    expect(resolveRuntimeScene(scene, {}, cleared)[1]!.data!.rows).toHaveLength(3);
    expect(resolveRuntimeScene(scene, {}, {})[1]!.data!.rows).toHaveLength(3);
    const sameSource = structuredClone(source), sameTarget = structuredClone(target);
    sameSource.sharedDataSourceId = "shared"; sameTarget.sharedDataSourceId = "shared";
    kitMetadata(sameTarget)!.source.privateData!.fields![0] = { uid: "category", alias: "地区" };
    kitMetadata(sameTarget)!.source.options!["axis-x"] = [binding("category")];
    const live = { shared: { rows: [{ category: "杭州", total: 8 }, { category: "上海", total: 9 }] } };
    const sharedRuntime = updateKitLinkage([sameSource, sameTarget], live, {}, sameSource, { name: "上海" });
    expect(resolveRuntimeScene([sameSource, sameTarget], live, sharedRuntime)[1]!.data!.rows)
      .toMatchObject([{ name: "上海", value: 9 }]);
    const dynamicSource = structuredClone(source), dynamicTarget = structuredClone(target);
    kitMetadata(dynamicSource)!.source.privateData = { fields: [], rows: [] };
    kitMetadata(dynamicTarget)!.source.privateData = { fields: [], rows: [] };
    kitMetadata(dynamicSource)!.source.options!["axis-x"] = [binding("region")];
    kitMetadata(dynamicTarget)!.source.options!["axis-x"] = [binding("region")];
    const dynamicLive = { [dynamicSource.id]: { rows: [{ region: "华东" }] },
      [dynamicTarget.id]: { rows: [{ region: "华东", total: 1 }, { region: "华北", total: 2 }] } };
    const dynamicRuntime = updateKitLinkage([dynamicSource, dynamicTarget], dynamicLive, {}, dynamicSource, { name: "华东" });
    expect(resolveRuntimeScene([dynamicSource, dynamicTarget], dynamicLive, dynamicRuntime)[1]!.data!.rows)
      .toMatchObject([{ name: "华东", value: 1 }]);
    const meta = kitMetadata(source)!;
    meta.source.options = { ...meta.source.options, "linkage-advanced": true, "linkage-mode": "whitelist", "linkage-elements": [] };
    const blocked = updateKitLinkage(scene, {}, second, source, { name: "杭州" });
    expect(resolveRuntimeScene(scene, {}, blocked)[1]!.data!.rows).toHaveLength(3);
    meta.source.options["linkage-elements"] = [target.id];
    const allowed = updateKitLinkage(scene, {}, blocked, source, { name: "杭州" });
    expect(resolveRuntimeScene(scene, {}, allowed)[1]!.data!.rows).toHaveLength(2);
    meta.source.options["linkage-advanced-settings"] = {
      "linkage-out": { "linkage-mode": "whitelist", "linkage-elements": [{ elementPath: ["root", target.id] }] },
      "linkage-in": { "linkage-mode": "whitelist", "linkage-elements": [] },
    };
    const targetOptions = kitMetadata(target)!.source.options!;
    targetOptions["linkage-advanced"] = true;
    targetOptions["linkage-advanced-settings"] = {
      "linkage-in": { "linkage-mode": "whitelist", "linkage-elements": [{ elementPath: ["root", source.id] }] },
      "linkage-out": { "linkage-mode": "whitelist", "linkage-elements": [] },
    };
    const nested = updateKitLinkage(scene, {}, {}, source, { name: "上海" });
    expect(resolveRuntimeScene(scene, {}, nested)[1]!.data!.rows).toHaveLength(1);
    (targetOptions["linkage-advanced-settings"] as Record<string, Record<string, unknown>>)["linkage-in"]!["linkage-elements"] = [];
    const denied = updateKitLinkage(scene, {}, nested, source, { name: "杭州" });
    expect(resolveRuntimeScene(scene, {}, denied)[1]!.data!.rows).toHaveLength(3);
  });

  it("菜单和下拉框从静态、实时及联动数据生成选项，并按指定字段发出联动", () => {
    const binding = (uid: string) => ({ uid: ["c_private", "t_private", uid], summary: "none" });
    const menu = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.group.buttons-v2", options: {
      "button-option-setting": "data", "axis-value": [binding("city")],
      "buttons-linkage-fields": [binding("code")], "linkage-out": true,
      "select-default-type": "custom", "select-default-custom-type": "last",
    }, privateData: { fields: [{ uid: "city", alias: "城市" }, { uid: "code", alias: "行政编码" }], rows: [
      { city: "杭州", code: "3301" }, { city: "上海", code: "3100" },
    ] } })[0]!;
    const dropdown = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.basic.dropdown-v2", options: {
      "dropdown-option-setting": "data", "dropdown-item-fields": [binding("district")], "linkage-in": true,
      "show-default-option": true, "dropdown-default-value": "___default___", "dropdown-tip-text": "选择区县",
    }, privateData: { fields: [{ uid: "district", alias: "区县" }, { uid: "region", alias: "行政编码" }], rows: [
      { district: "西湖", region: "3301" }, { district: "浦东", region: "3100" },
    ] } })[0]!;
    dropdown.id = "dynamic-dropdown";
    expect(menu.data?.items).toEqual(["杭州", "上海"]);
    expect(menu.data?.active).toBe(1);
    expect(dropdown.data?.options).toEqual(["选择区县", "西湖", "浦东"]);
    expect(dropdown.widget?.text).toBe("选择区县");

    const scene = [menu, dropdown];
    const linked = updateKitLinkage(scene, {}, {}, menu, "上海");
    expect(resolveRuntimeScene(scene, {}, linked)[1]!.data!.options).toEqual(["选择区县", "浦东"]);
    kitMetadata(dropdown)!.source.options!["select-item-after-linkage"] = true;
    const autoSelected = resolveRuntimeScene(scene, {}, linked)[1]!;
    expect(autoSelected.data!.__kitSelection).toMatchObject({ value: "浦东" });
    expect(kitSelectionControlValue(boardNodes([autoSelected], true)[0]!)).toBe("浦东");
    expect(resolveRuntimeScene(scene, {}, updateKitLinkage(scene, {}, linked, menu, ""))[1]!.data!.options)
      .toEqual(["选择区县", "西湖", "浦东"]);

    const live = { [menu.id]: { rows: [{ city: "北京", code: "1100" }, { city: "南京", code: "3201" }] },
      [dropdown.id]: { rows: [{ district: "海淀", region: "1100" }, { district: "鼓楼", region: "3201" }] } };
    const liveLinked = updateKitLinkage(scene, live, {}, menu, "南京");
    const resolved = resolveRuntimeScene(scene, live, liveLinked);
    expect(resolved[0]!.data!.items).toEqual(["北京", "南京"]);
    expect(resolved[1]!.data!.options).toEqual(["选择区县", "鼓楼"]);
    expect(menu.data?.items).toEqual(["杭州", "上海"]);

    const imported = structuredClone(menu);
    imported.data = { ...imported.data, __kitImportedData: true, __kitImportedColumns: ["city", "code"],
      rows: [["苏州", "3205"], ["无锡", "3202"]] };
    expect(resolveRuntimeScene([imported], {}, {})[0]!.data!.items).toEqual(["苏州", "无锡"]);
    const options = kitMetadata(imported)!.source.options!;
    Object.assign(options, { filter: true, "filter-condition": "data-row", "filter-data-row-num": 2 });
    expect(resolveRuntimeScene([imported], {}, {})[0]!.data!.items).toEqual(["无锡"]);
  });

  it("自定义菜单的联动值按配置映射到目标字段", () => {
    const binding = (uid: string) => ({ uid: ["c_private", "t_private", uid], summary: "none" });
    const menu = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.group.buttons-v2", options: {
      "button-name-option": ["一类", "二类"], "linkage-field": "分类编码",
      "linkage-values": { "一类-0": "A", "二类-1": "B" }, "linkage-out": true,
    } })[0]!;
    const chart = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.echarts.column", options: {
      "axis-x": [binding("category")], "axis-y": [binding("total")], "linkage-in": true,
    }, privateData: { fields: [{ uid: "category", alias: "分类编码" }, { uid: "total" }], rows: [
      { category: "A", total: 1 }, { category: "B", total: 2 },
    ] } })[0]!;
    chart.id = "custom-choice-target";
    const scene = [menu, chart], runtime = updateKitLinkage(scene, {}, {}, menu, "二类");
    expect(resolveRuntimeScene(scene, {}, runtime)[1]!.data!.rows).toMatchObject([{ name: "B", value: 2 }]);

    const dropdown = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.basic.dropdown-v2", options: {
      "dropdown-option-setting": "data", "dropdown-item-fields": [binding("label")],
      "dropdown-linkage-fields": [binding("code")], "linkage-out": true,
      "show-default-option": true, "dropdown-tip-text": "全部分类",
    }, privateData: { fields: [{ uid: "label", alias: "名称" }, { uid: "code", alias: "分类编码" }], rows: [
      { label: "一类", code: "A" }, { label: "二类", code: "B" },
    ] } })[0]!;
    const dropdownScene = [dropdown, chart], fromDropdown = updateKitLinkage(dropdownScene, {}, {}, dropdown, "二类");
    expect(resolveRuntimeScene(dropdownScene, {}, fromDropdown)[1]!.data!.rows).toMatchObject([{ name: "B", value: 2 }]);
    const all = updateKitLinkage(dropdownScene, {}, fromDropdown, dropdown, "全部分类");
    expect(resolveRuntimeScene(dropdownScene, {}, all)[1]!.data!.rows).toHaveLength(2);
    const multi = updateKitLinkage(dropdownScene, {}, {}, dropdown, ["一类", "二类"]);
    expect(resolveRuntimeScene(dropdownScene, {}, multi)[1]!.data!.rows).toHaveLength(2);
    const single = updateKitLinkage(dropdownScene, {}, multi, dropdown, ["二类"]);
    expect(resolveRuntimeScene(dropdownScene, {}, single)[1]!.data!.rows).toMatchObject([{ name: "B", value: 2 }]);
    expect(resolveRuntimeScene(dropdownScene, {}, updateKitLinkage(dropdownScene, {}, single, dropdown, []))[1]!.data!.rows)
      .toHaveLength(2);
    kitMetadata(dropdown)!.source.options!["selection-out"] = true;
    const target = structuredClone(dropdown);
    target.id = "multi-selection-target";
    Object.assign(kitMetadata(target)!.source.options!, { "selection-out": false, "selection-in": true, "use-multiple": true });
    const selected = updateKitSelection([dropdown, target], {}, dropdown, ["一类", "二类"]);
    const targetVisual = boardNodes(resolveRuntimeScene([dropdown, target], {}, selected), true)
      .find(node => node.id === target.id)!;
    expect(kitSelectionControlValue(targetVisual)).toEqual(["一类", "二类"]);
  });

  it("树形下拉框解析 JSON 层级并按节点值而非显示名称联动", () => {
    const binding = (uid: string) => ({ uid: ["c_private", "t_private", uid], summary: "none" });
    const tree = [{ label: "浙江", value: "ZJ", children: [
      { label: "杭州", value: "HZ" }, { label: "宁波", value: "NB" },
    ] }, { label: "上海", value: "SH" }];
    const dropdown = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.basic.dropdown-v2", options: {
      "dropdown-option-setting": "data", "use-json-type": true, "dropdown-item-fields": [binding("json")],
      "dropdown-linkage-fields": [binding("json")], "linkage-out": true, "selection-out": true,
      "show-default-option": true, "dropdown-tip-text": "请选择", "dropdown-default-value": "___default___",
      "json-node-linkage-fields": ["省份编码", "城市编码"], "json-node-selection-fields": ["城市编码", "城市编码"],
    }, privateData: { fields: [{ uid: "json", alias: "城市编码" }], rows: [{ json: JSON.stringify(tree) }] } })[0]!;
    const table = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.basic.table-v2", options: {
      "linkage-in": true,
    }, privateData: { fields: [{ uid: "city", alias: "城市编码" }, { uid: "province", alias: "省份编码" }], rows: [
      { city: "HZ", province: "ZJ" }, { city: "SH", province: "SH" },
    ] } })[0]!;
    table.id = "tree-table";
    expect(dropdown.data?.options).toEqual(["请选择", "ZJ", "HZ", "NB", "SH"]);
    expect(dropdown.data?.__kitChoiceTree).toEqual([
      { label: "浙江", value: "ZJ", children: [
        { label: "杭州", value: "HZ", children: [] }, { label: "宁波", value: "NB", children: [] },
      ] }, { label: "上海", value: "SH", children: [] },
    ]);
    const visual = boardNodes([dropdown], true)[0]!;
    expect((visual.data.__kitDropdown as Record<string, unknown>).tree).toEqual(dropdown.data?.__kitChoiceTree);
    const leaf = { __kitDropdownTree: true, name: "杭州", value: "HZ", depth: 1, isParent: false };
    expect(resolveRuntimeScene([dropdown, table], {}, updateKitLinkage([dropdown, table], {}, {}, dropdown, leaf))[1]!.data!.rows)
      .toMatchObject([{ city: "HZ", province: "ZJ" }]);
    const parent = { __kitDropdownTree: true, name: "浙江", value: "ZJ", depth: 0, isParent: true };
    expect(updateKitLinkage([dropdown, table], {}, {}, dropdown, parent)).toEqual({});
    kitMetadata(dropdown)!.source.options!["use-json-node-linkage"] = true;
    expect(resolveRuntimeScene([dropdown, table], {}, updateKitLinkage([dropdown, table], {}, {}, dropdown, parent))[1]!.data!.rows)
      .toMatchObject([{ city: "HZ", province: "ZJ" }]);
    const receiver = structuredClone(dropdown); receiver.id = "tree-selection-receiver";
    kitMetadata(receiver)!.source.options!["selection-in"] = true;
    expect(updateKitSelection([dropdown, receiver], {}, dropdown, parent)).toEqual({});
    kitMetadata(dropdown)!.source.options!["use-json-node-selection"] = true;
    expect(updateKitSelection([dropdown, receiver], {}, dropdown, parent)[receiver.id]!.dataPatch!.__kitSelection)
      .toMatchObject({ value: "ZJ", field: "json" });
    const invalid = resolveRuntimeScene([dropdown], { [dropdown.id]: { rows: [{ json: "[invalid" }] } }, {})[0]!;
    expect(invalid.data?.__kitChoiceTree).toEqual([]);
  });

  it("树形下拉框可展开节点并选择叶子，事件保留显示名和值", async () => {
    const binding = (uid: string) => ({ uid: ["c_private", "t_private", uid], summary: "none" });
    const dropdown = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.basic.dropdown-v2", options: {
      size: [160, 100], "dropdown-option-setting": "data", "use-json-type": true,
      "dropdown-item-fields": [binding("json")], "dropdown-selected-box-height": 25, "dropdown-option-height": 20,
      "dropdown-drop-options-number": 3, "dropdown-option-left-padding": 10,
    }, privateData: { fields: [{ uid: "json" }], rows: [{ json: JSON.stringify([
      { label: "浙江", value: "ZJ", children: [{ label: "杭州", value: "HZ" }] },
      { label: "上海", value: "SH" },
    ]) }] } }, { x: 0, y: 0 })[0]!;
    const [visual] = boardNodes([dropdown], true);
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 160, height: 100, preview: true, selected: [], nodes: [visual!] }));
      surface.pointer("down", 60, 10); surface.pointer("up", 60, 10);
      surface.pointer("down", 15, 35); surface.pointer("up", 15, 35);
      expect(dispatchCommandResponse(surface.take_events(), {})).toBeUndefined();
      surface.pointer("down", 60, 55); surface.pointer("up", 60, 55);
      const events: unknown[] = [];
      dispatchCommandResponse(surface.take_events(), { boardEvent: event => events.push(event.value) });
      expect(events).toContainEqual({ __kitDropdownTree: true, name: "杭州", value: "HZ", values: null,
        depth: 1, isParent: false });

      const multi = structuredClone(visual!); multi.id = "multi-tree";
      (multi.data.__kitDropdown as Record<string, unknown>).multiple = true;
      surface.sync_scene(encodeBoardSync({ width: 160, height: 100, preview: true, selected: [], nodes: [multi] }));
      surface.pointer("down", 60, 10); surface.pointer("up", 60, 10);
      surface.pointer("down", 15, 35); surface.pointer("up", 15, 35);
      surface.pointer("down", 60, 55); surface.pointer("up", 60, 55);
      surface.pointer("down", 60, 75); surface.pointer("up", 60, 75);
      const multiEvents: unknown[] = [];
      dispatchCommandResponse(surface.take_events(), { boardEvent: event => multiEvents.push(event.value) });
      expect(multiEvents).toContainEqual({ __kitDropdownTree: true, name: "上海", value: "SH",
        values: ["HZ", "SH"], depth: 0, isParent: false });

      const search = structuredClone(visual!); search.id = "search-tree";
      (search.data.__kitDropdown as Record<string, unknown>).search = true;
      surface.sync_scene(encodeBoardSync({ width: 160, height: 100, preview: true, selected: [], nodes: [search] }));
      surface.pointer("down", 60, 10); surface.pointer("up", 60, 10); surface.take_events();
      surface.set_value(encodeSetValue(search.id, { __kitDropdownSearch: "杭州" }));
      surface.pointer("down", 60, 35); surface.pointer("up", 60, 35);
      const searchEvents: unknown[] = [];
      dispatchCommandResponse(surface.take_events(), { boardEvent: event => searchEvents.push(event.value) });
      expect(searchEvents).toContainEqual({ __kitDropdownTree: true, name: "杭州", value: "HZ", values: null,
        depth: 1, isParent: false });
    } finally { surface.free(); }
  });

  it("列表动画更新裁剪区域时不重置下拉框的已选值", async () => {
    const dropdown = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.basic.dropdown-v2", options: {
      size: [100, 60], "dropdown-value-text-option": ["甲", "乙"], "use-search": false,
    } }, { x: 0, y: 0 })[0]!;
    const [visual] = boardNodes([dropdown], true);
    visual!.data.__kitListClip = { x: 0, y: 0, width: 100, height: 60 };
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      const sync = () => surface.sync_scene(encodeBoardSync({ width: 100, height: 60,
        preview: true, selected: [], nodes: [visual!] }));
      sync(); surface.set_value(encodeSetValue(visual!.id, "乙")); surface.take_events();
      visual!.data.__kitListClip = { x: 0, y: 10, width: 100, height: 50 };
      sync(); surface.set_value(encodeSetValue(visual!.id, "乙"));
      const events: unknown[] = [];
      dispatchCommandResponse(surface.take_events(), { boardEvent: event => events.push(event.value) });
      expect(events).toEqual([]);
    } finally { surface.free(); }
  });

  it("下拉框按配置绘制并滚动选项，点击使用滚动后的数据", async () => {
    const dropdown = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.basic.dropdown-v2", options: {
      size: [160, 100], "dropdown-value-text-option": ["甲", "乙", "丙"], "dropdown-default-value": "甲", "use-search": false,
      "dropdown-selected-box-height": 25, "dropdown-option-height": 20, "dropdown-drop-options-number": 2,
      "dropdown-background-color": "#ff0000", "dropdown-option-background-color": "#00ff00",
      "dropdown-hover-background-color": "#0000ff", "options-border-width": 0, "options-drop-border-width": 0,
      "top-fonts": { size: 0 }, "dropdown-font": { size: 0 }, "dropdown-selected-font": { size: 0 },
    } }, { x: 0, y: 0 })[0]!;
    const [visual] = boardNodes([dropdown], true);
    expect(visual!.data.__kitDropdown).toMatchObject({ headerHeight: 25, rowHeight: 20, maxOptions: 2 });
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 160, height: 100, preview: true, selected: [], nodes: [visual!] }));
      surface.pointer("down", 30, 10); surface.pointer("up", 30, 10);
      const pixels = surface.snapshot(160, 100, encodeBoardClock(boardClock(new Date(0))));
      const pixel = (x: number, y: number) => 8 + (y * 160 + x) * 4;
      expect(pixels[pixel(4, 5)]).toBeGreaterThan(200);
      expect(pixels[pixel(4, 30) + 2]).toBeGreaterThan(200);
      expect(pixels[pixel(4, 50) + 1]).toBeGreaterThan(200);
      surface.pointer("wheel-down", 30, 50);
      surface.pointer("down", 30, 55); surface.pointer("up", 30, 55);
      const events: unknown[] = [];
      dispatchCommandResponse(surface.take_events(), { boardEvent: event => events.push(event.value) });
      expect(events).toContain("丙");

      const multi = kitNodes(entry("模板布局3D(1920X1080)"), { uid: "multi", type: "widget.basic.dropdown-v2", options: {
        size: [160, 100], "dropdown-value-text-option": ["甲", "乙", "丙"], "use-multiple": true, "use-search": false,
        "dropdown-selected-box-height": 25, "dropdown-option-height": 20, "dropdown-drop-options-number": 2,
      } }, { x: 0, y: 0 })[0]!;
      const [multiVisual] = boardNodes([multi], true);
      surface.sync_scene(encodeBoardSync({ width: 160, height: 100, preview: true, selected: [], nodes: [multiVisual!] }));
      surface.pointer("down", 30, 10); surface.pointer("up", 30, 10);
      surface.pointer("down", 30, 35); surface.pointer("up", 30, 35);
      surface.pointer("down", 30, 55); surface.pointer("up", 30, 55);
      const multiEvents: unknown[] = [];
      dispatchCommandResponse(surface.take_events(), { boardEvent: event => multiEvents.push(event.value) });
      expect(multiEvents).toEqual([["甲"], ["甲", "乙"]]);

      const long = kitNodes(entry("模板布局3D(1920X1080)"), { uid: "long", type: "widget.basic.dropdown-v2", options: {
        size: [160, 100], "dropdown-value-text-option": Array.from({ length: 35 }, (_, index) => `选项${index + 1}`),
        "use-search": false,
        "dropdown-selected-box-height": 25, "dropdown-option-height": 20, "dropdown-drop-options-number": 2,
      } }, { x: 0, y: 0 })[0]!;
      const [longVisual] = boardNodes([long], true);
      surface.sync_scene(encodeBoardSync({ width: 160, height: 100, preview: true, selected: [], nodes: [longVisual!] }));
      surface.pointer("down", 30, 10); surface.pointer("up", 30, 10);
      for (let index = 0; index < 33; index += 1) surface.pointer("wheel-down", 30, 50);
      surface.pointer("down", 30, 55); surface.pointer("up", 30, 55);
      const longEvents: unknown[] = [];
      dispatchCommandResponse(surface.take_events(), { boardEvent: event => longEvents.push(event.value) });
      expect(longEvents).toContain("选项35");

      const searchable = kitNodes(entry("模板布局3D(1920X1080)"), { uid: "search", type: "widget.basic.dropdown-v2", options: {
        size: [160, 100], "dropdown-value-text-option": ["北京", "上海", "杭州"], "use-search": true,
        "dropdown-selected-box-height": 25, "dropdown-option-height": 20, "dropdown-drop-options-number": 2,
      } }, { x: 0, y: 0 })[0]!;
      const [searchVisual] = boardNodes([searchable], true);
      surface.sync_scene(encodeBoardSync({ width: 160, height: 100, preview: true, selected: [], nodes: [searchVisual!] }));
      surface.pointer("down", 30, 10); surface.pointer("up", 30, 10);
      const textInput = { value: "", setAttribute: vi.fn(), focus: vi.fn(), setSelectionRange: vi.fn() };
      const searchHost = Object.assign(Object.create(RustBoardHost.prototype), {
        surface, state: { scene: [searchable] }, nodes: [searchVisual], textInput,
      }) as { drainEvents(): boolean; dropdownSearchInput: boolean };
      searchHost.drainEvents();
      expect(searchHost.dropdownSearchInput).toBe(true);
      expect(textInput.focus).toHaveBeenCalledOnce();
      expect(textInput.setAttribute).toHaveBeenCalledWith("aria-label", "搜索下拉选项");
      surface.set_value(encodeSetValue(searchable.id, { __kitDropdownSearch: "海" }));
      const searchEvents: unknown[] = [];
      dispatchCommandResponse(surface.take_events(), { boardEvent: event => searchEvents.push(event.value) });
      expect(searchEvents).toEqual([]);
      surface.pointer("down", 30, 35); surface.pointer("up", 30, 35);
      dispatchCommandResponse(surface.take_events(), { boardEvent: event => searchEvents.push(event.value) });
      expect(searchEvents).toEqual(["上海"]);
    } finally { surface.free(); }
  });

  it("下拉菜单按仅选中时收起开关处理空白、重复点击和选择", async () => {
    const make = (id: string, onlyOnSelect: boolean) => kitNodes(entry("模板布局3D(1920X1080)"), {
      uid: id, type: "widget.basic.dropdown-v2", options: { size: [100, 25],
        "dropdown-value-text-option": ["甲", "乙"], "dropdown-selected-box-height": 25,
        "dropdown-option-height": 20, "close-only-on-select": onlyOnSelect, "use-search": false },
    }, { x: 0, y: 0 })[0]!;
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      const click = (x: number, y: number) => { surface.pointer("down", x, y); surface.pointer("up", x, y); };
      const sync = (node: SceneNode) => surface.sync_scene(encodeBoardSync({ width: 200, height: 100,
        preview: true, selected: [], nodes: boardNodes([node], true) }));
      sync(make("default-close", false));
      click(20, 10);
      expect(decodeHitResult(surface.hit_test(20, 35))).not.toBeNull();
      click(150, 80);
      expect(decodeHitResult(surface.hit_test(20, 35))).toBeNull();

      sync(make("select-close", true));
      click(20, 10); click(150, 80);
      expect(decodeHitResult(surface.hit_test(20, 35))).not.toBeNull();
      click(20, 10);
      expect(decodeHitResult(surface.hit_test(20, 35))).not.toBeNull();
      click(20, 35);
      expect(decodeHitResult(surface.hit_test(20, 35))).toBeNull();
    } finally { surface.free(); }
  });

  it("数据联动筛选列表时保留子组件的原始数据行", () => {
    const binding = (uid: string) => ({ uid: ["c_private", "t_private", uid], summary: "none" });
    const source = kitNodes(entry("模板布局3D(1920X1080)"), { uid: "source", type: "widget.echarts.column", options: {
      "axis-x": [binding("category")], "linkage-out": true,
    }, privateData: { fields: [{ uid: "category", alias: "城市" }], rows: [{ category: "上海" }] } })[0]!;
    const list = kitNodes(entry("模板布局3D(1920X1080)"), { uid: "list", type: "widget.group.list-v2", options: {
      "axis-fields": [binding("city")], "list-display-count": 3, "linkage-in": true,
    }, privateData: { fields: [{ uid: "city", alias: "城市" }], rows: [
      { city: "杭州" }, { city: "上海" }, { city: "北京" },
    ] }, widgets: [{ type: "widget.basic.text", options: {
      "related-fields": { '["text"]': { "related-field": [binding("label")] } },
    }, privateData: { fields: [{ uid: "city", alias: "城市" }, { uid: "label" }], rows: [
      { city: "杭州", label: "第一" }, { city: "上海", label: "第二" }, { city: "北京", label: "第三" },
    ] } }] });
    const scene = [source, ...list], runtime = updateKitLinkage(scene, {}, {}, source, { name: "上海" });
    const texts = boardNodes(resolveRuntimeScene(scene, {}, runtime), true).filter(node => node.widget.kind === "text");
    expect(texts.map(node => [node.widget.text, node.data.__kitListIndex])).toEqual([["第二", 1]]);
  });

  it("插入和复制套件时重映射联动名单到新组件", () => {
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), { uid: "root", type: "widget.group.panel", widgets: [
      { uid: "source", name: "发起", type: "widget.echarts.column", options: {
        "linkage-out": true, "linkage-advanced": true, "linkage-advanced-settings": {
          "linkage-out": { "linkage-mode": "whitelist", "linkage-elements": [{ elementPath: ["root", "target"] }] },
        },
      } },
      { uid: "target", name: "接收", type: "widget.echarts.column", options: { "linkage-in": true } },
    ] });
    const inserted = handle({ type: "insertKit", nodes })!;
    const rootId = inserted.selectedId!;
    const outgoing = inserted.tree.find(item => item.parentId === rootId && item.name === "发起")!;
    const incoming = inserted.tree.find(item => item.parentId === rootId && item.name === "接收")!;
    const references = (node: typeof outgoing) =>
      (kitMetadata(node)!.source.options!["linkage-advanced-settings"] as Record<string, Record<string, unknown>>)
        ["linkage-out"]!["linkage-elements"];
    expect(references(outgoing)).toEqual([{ elementPath: ["root", incoming.id] }]);
    const duplicated = handle({ type: "duplicate", id: rootId })!;
    const copy = duplicated.selectedId!;
    const copiedSource = duplicated.tree.find(item => item.parentId === copy && item.name === "发起")!;
    const copiedTarget = duplicated.tree.find(item => item.parentId === copy && item.name === "接收")!;
    expect(references(copiedSource)).toEqual([{ elementPath: ["root", copiedTarget.id] }]);
    expect(copiedTarget.id).not.toBe(incoming.id);
  });

  it("选中传递同步菜单、表格和列表，并在 Rust 画布中显示选中状态", async () => {
    const binding = (uid: string) => ({ uid: ["c_private", "t_private", uid], summary: "none" });
    const menu = (uid: string, outgoing: boolean) => kitNodes(entry("模板布局3D(1920X1080)"), {
      uid, type: "widget.group.buttons-v2", options: { size: [200, 50], layout: [1, 2],
        "button-name-option": ["甲", "乙"], "allow-unselected": true,
        [outgoing ? "selection-out" : "selection-in"]: true,
        "item-style-cluster": { indexes: ["a"], a: { "background-color-default": "#ff0000",
          "background-color-selected": "#00ff00", "font-default": { color: "#ffffff" },
          "font-selected": { color: "#ffffff" } } },
      },
    }, { x: 0, y: 0 })[0]!;
    const source = menu("source", true), destination = menu("destination", false);
    const table = kitNodes(entry("模板布局3D(1920X1080)"), { uid: "table", type: "widget.basic.table-v3", options: {
      "axis-fields": [binding("person")], "selection-in": true, "selection-fields": [binding("person")],
    }, privateData: { fields: [{ uid: "person", alias: "名称" }], rows: [{ person: "甲" }, { person: "乙" }] } })[0]!;
    const list = kitNodes(entry("模板布局3D(1920X1080)"), { uid: "list", type: "widget.group.list-v2", options: {
      "axis-fields": [binding("person")], "selection-in": true, "use-item-selected": true, "list-display-count": 1,
    }, privateData: { fields: [{ uid: "person" }], rows: [{ person: "甲" }, { person: "乙" }] },
    widgets: [{ type: "widget.basic.text", options: { text: "内容" } }] });
    const scene = [source, destination, table, ...list];
    const runtime = updateKitSelection(scene, {}, source, "乙");
    const resolved = resolveRuntimeScene(scene, {}, runtime);
    expect(kitListSelectionIndex(resolved[3]!, "乙")).toBe(1);
    expect(kitListSelectionMatch(resolved[3]!, "乙", undefined, 0)).toEqual({ index: 1, start: 1 });
    const paged = boardNodes(resolved, true, new Map([[list[0]!.id, 1]]), new Map([[list[0]!.id, 1]]));
    expect(paged.find(node => node.id === list[0]!.id)!.data.__kitListInfo)
      .toMatchObject({ start: 1, selected: 1, slots: [{ index: 1 }] });
    const visuals = boardNodes(resolved, true), menuNode = visuals.find(node => node.id === destination.id)!;
    const tableNode = visuals.find(node => node.id === table.id)!;
    expect(kitSelectionControlValue(menuNode)).toBe("乙");
    expect(kitSelectionControlValue(tableNode)).toEqual({ index: 1 });
    const cleared = updateKitSelection(scene, runtime, source, "");
    expect(cleared[destination.id]!.dataPatch!.__kitSelection)
      .toMatchObject({ value: "" });
    expect(kitSelectionControlValue(boardNodes(resolveRuntimeScene(scene, {}, cleared), true)
      .find(node => node.id === table.id)!)).toEqual({ index: 4_294_967_295 });
    const sourceOptions = kitMetadata(source)!.source.options!;
    sourceOptions["selection-advanced"] = true;
    sourceOptions["selection-advanced-settings"] = { "selection-out": {
      "selection-mode": "whitelist", "selection-elements": [{ elementPath: ["root", destination.id] }],
    }, "selection-in": { "selection-mode": "whitelist", "selection-elements": [] } };
    const restricted = updateKitSelection(scene, {}, source, "甲");
    expect(restricted[destination.id]!.dataPatch!.__kitSelection).toMatchObject({ value: "甲" });
    expect(restricted[table.id]).toBeUndefined();
    expect(restricted[list[0]!.id]).toBeUndefined();
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    const host = Object.assign(Object.create(RustBoardHost.prototype), {
      state: { preview: true, boardWidth: 200, boardHeight: 50 }, nodes: [menuNode], surface,
      drag: null, pendingVisual: null, kitSelectionApplied: new Map(), selectedItemValues: new Map(),
      syncSelection: vi.fn(),
    }) as { sync(): void };
    try {
      host.sync();
      const pixels = surface.snapshot(200, 50, encodeBoardClock(boardClock(new Date(0))));
      const pixel = (x: number) => 8 + (25 * 200 + x) * 4;
      expect(pixels[pixel(150) + 1]).toBeGreaterThan(pixels[pixel(150)]! + 100);
      expect(pixels[pixel(20)]).toBeGreaterThan(pixels[pixel(20) + 1]! + 100);
      const events: unknown[] = [];
      dispatchCommandResponse(surface.take_events(), { boardEvent: event => events.push(event) });
      expect(events).toEqual([]);
    } finally { surface.free(); }
  });

  it("数据条件可以判断其他数据源的指定行、任意行及全部行", () => {
    const rows = [{ name: "甲" }, { name: "乙" }];
    const rule: DataConditionRule = { sourceId: "other", field: "amount", operator: ">=", value: "8",
      selector: "first", index: 1 };
    const condition: BoardDataCondition = { id: "gate", name: "门槛", groups: [[rule]] };
    const context = { conditions: [condition], sources: { other: { columns: ["amount"], rows: [[3], [9]] } } };
    const options = { filter: true, "filter-condition": "data-condition", "filter-condition-select": "gate" };
    expect(filterKitRows(rows, options, context)).toEqual([]);
    rule.selector = "last";
    expect(filterKitRows(rows, options, context)).toEqual(rows);
    rule.selector = "any";
    expect(filterKitRows(rows, options, context)).toEqual(rows);
    rule.selector = "all";
    expect(filterKitRows(rows, options, context)).toEqual([]);
    rule.selector = "index"; rule.index = 2;
    expect(filterKitRows(rows, options, context)).toEqual(rows);
  });

  it("文本字段绑定随静态、导入和实时数据变化，并保留原始文本", () => {
    const binding = (uid: string) => ({ uid: ["c_private", "t_private", uid], summary: "none" });
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.basic.text", options: { text: "原始文本", filter: true, "filter-condition": "data-row",
        "filter-data-row-num": 2, "related-entries": [{ name: '["text"]', alias: "文本" }],
        "related-fields": { '["text"]': { "related-field": [binding("name")] } } },
      privateData: { fields: [{ uid: "name", alias: "名称" }], rows: [{ name: "静态甲" }, { name: "静态乙" }] },
    });
    expect(nodes[0]!.widget!.text).toBe("静态乙");
    const id = handle({ type: "insertKit", nodes })!.selectedId!;
    const changed = handle({ type: "patchKitOptions", id, patch: { "filter-data-row-num": 1 } })!;
    expect(changed.tree[0]!.widget!.text).toBe("静态甲");
    expect(kitMetadata(changed.tree[0]!)!.source.options!.text).toBe("原始文本");
    const imported = handle({ type: "setStaticData", id, data: { rows: [{ name: "导入甲" }, { name: "导入乙" }] } })!;
    expect(resolveRuntimeScene(imported.tree, {}, {})[0]!.widget!.text).toBe("导入甲");
    expect(resolveRuntimeScene(imported.tree, { [id]: { rows: [{ name: "实时甲" }, { name: "实时乙" }] } }, {})[0]!
      .widget!.text).toBe("实时甲");
    expect(resolveRuntimeScene(imported.tree, { [id]: { rows: [] } }, {})[0]!.widget!.text).toBe("原始文本");
    expect(resolveRuntimeScene(imported.tree, { [id]: { rows: [{ name: "实时甲" }] } }, { [id]: { text: "交互值" } })[0]!
      .widget!.text).toBe("交互值");
  });

  it("数据筛选先于字段读取，静态图表不会重复筛选", () => {
    const binding = (uid: string) => ({ uid: ["c_private", "t_private", uid], summary: "none" });
    const source: ReferenceKitWidget = { type: "widget.echarts.column", options: {
      "axis-x": [binding("name")], "axis-y": [binding("value")], filter: true,
      "filter-condition": "data-row", "filter-data-row-num": 2,
    }, privateData: { fields: [{ uid: "name", type: "string" }, { uid: "value", type: "number" }],
      rows: [{ name: "甲", value: 3 }, { name: "乙", value: 8 }, { name: "丙", value: 5 }] } };
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), source);
    const id = nodes[0]!.id;
    expect(nodes[0]!.data!.rows).toMatchObject([{ name: "乙", value: 8 }]);
    expect(resolveRuntimeScene(nodes, {}, {})[0]!.data!.rows).toMatchObject([{ name: "乙", value: 8 }]);
    expect(resolveRuntimeScene(nodes, { [id]: { rows: [{ name: "一", value: 10 }, { name: "二", value: 20 }] } }, {})[0]!
      .data!.rows).toMatchObject([{ name: "二", value: 20 }]);
    expect(resolveRuntimeScene(nodes, { [id]: { rows: [] } }, {})[0]!.data!.rows).toEqual([]);
    const raw = [{ city: "南京", amount: 5 }, { city: "上海", amount: 10 }, { city: "上海", amount: 20 }];
    expect(filterKitRows(raw, { filter: true, "filter-condition": "data-rows",
      "filter-data-start-rows-num": 2, "filter-data-rows": 2 })).toEqual(raw.slice(1));
    expect(filterKitRows(raw, { filter: true, "filter-condition": "direct-judgment", "filter-table-field": "amount",
      "filter-table-field-condition": ">=", "filter-table-field-value": "10" })).toEqual(raw.slice(1));
    expect(filterKitRows(raw, { filter: true, "filter-condition": "direct-judgment", "filter-table-field": "city",
      "filter-table-field-condition": "!⊃", "filter-table-field-value": "海" })).toEqual(raw.slice(0, 1));
    const mean = resolveKitOptions(nodes[0]!, { filter: false, "axis-y": [{ ...binding("value"), summary: "mean" }] });
    const duplicated = { ...mean, data: { ...mean.data, __kitImportedData: true,
      rows: [{ name: "同类", value: 4 }, { name: "同类", value: 8 }] } };
    expect(resolveRuntimeScene([duplicated], {}, {})[0]!.data!.rows).toMatchObject([{ name: "同类", value: 6 }]);
  });

  it("字段绑定可驱动按钮样式和嵌套属性而不改写源配置", () => {
    const binding = (uid: string) => ({ uid: ["c_private", "t_private", uid], summary: "none" });
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.basic.button-v2",
      options: { "background-default-color": "#000000", "text-default-font": { size: 12, color: "#ffffff" },
        "related-fields": { '["background-default-color"]': { "related-field": [binding("fill")] },
          '["text-default-font","size"]': { "related-field": [binding("size")] } } },
      privateData: { fields: [{ uid: "fill" }, { uid: "size" }], rows: [{ fill: "#ff0000", size: 22 }] } });
    const rendered = boardNodes(nodes)[0]!;
    expect(rendered.data.__kitButton).toMatchObject({ styles: { default: { fill: "#ff0000", fontSize: 22 } } });
    expect(kitMetadata(nodes[0]!)!.source.options!["text-default-font"]).toEqual({ size: 12, color: "#ffffff" });
  });

  it("文字使用当前字体设置，并在画布中按左右居中对齐和缩进", async () => {
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.basic.text", options: {
      size: [200, 60], text: "ABCD", background: false, border: false,
      "text-font": { size: 10, color: "#0000ff" },
      "text-font2": { size: 24, color: "#ff0000", weight: 700, "line-through": true },
      "text-position": "left", "text-vertical": "top",
    } }, { x: 0, y: 0 });
    const text = nodes[0]!;
    expect(text.widget).toMatchObject({ fontSize: 24, fontWeight: 700 });
    expect(boardNodes(nodes)[0]!.data.__kitText).toMatchObject({ strike: true, indent: 0 });
    const paragraph = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.basic.paragraph", options: {
      size: [200, 80], font: { size: 16 }, font2: { size: 20, weight: 600 }, "font-line-height": 30,
      "text-padding": [2, 3, 4, 5], text: "一\n二",
    } })[0]!;
    expect(paragraph.widget).toMatchObject({ fontSize: 20, fontWeight: 600, lineHeight: 1.5 });
    expect(boardNodes([paragraph])[0]!.data.__kitText).toMatchObject({ padding: [2, 3, 4, 5], vertical: "top" });
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      const box = (patch: Record<string, unknown>) => {
        surface.sync_scene(encodeBoardSync({ width: 200, height: 60, preview: true, selected: [],
          nodes: boardNodes([resolveKitOptions(text, patch)], true) }));
        const pixels = surface.snapshot(200, 60, encodeBoardClock(boardClock(new Date(0))));
        let min = 200, max = -1;
        for (let y = 0; y < 60; y++) for (let x = 0; x < 200; x++) {
          if (pixels[8 + (y * 200 + x) * 4 + 3]! > 16) { min = Math.min(min, x); max = Math.max(max, x); }
        }
        return { min, max };
      };
      const left = box({ "text-position": "left" }), center = box({ "text-position": "center" });
      const right = box({ "text-position": "right" }), indented = box({ "text-position": "left", "text-indent": 20 });
      expect(left.min).toBeLessThan(10);
      expect(center.min).toBeGreaterThan(left.min + 40);
      expect(Math.abs((center.min + center.max) / 2 - 100)).toBeLessThan(5);
      expect(right.max).toBeGreaterThan(190);
      expect(indented.min).toBeGreaterThan(left.min + 15);
    } finally { surface.free(); }
  });

  it("天气组件没有服务数据时显示原站提示而不是示例天气", async () => {
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.basic.weather-v2", options: {
      size: [240, 60], background: false, border: false, "map-key": [""],
    } }, { x: 0, y: 0 });
    expect(kitMetadata(nodes[0]!)?.source.type).toBe("widget.basic.weather-v2");
    const visuals = boardNodes(nodes, true);
    expect(visuals.find(node => node.id === nodes[0]!.id)!.widget)
      .toMatchObject({ kind: "text", text: "请到右侧窗口设置/更新Key" });
    expect(visuals.some(node => node.widget.text === "暂无数据")).toBe(true);
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 240, height: 60, preview: true, selected: [], nodes: visuals }));
      const pixels = surface.snapshot(240, 60, encodeBoardClock(boardClock(new Date(0))));
      expect(Array.from(pixels.slice(8, 12))).toEqual([8, 13, 22, 255]);
      expect(Array.from(pixels.slice(8)).filter((_, index) => index % 4 === 2).some(blue => blue > 100)).toBe(true);
    } finally { surface.free(); }
  });

  it("预报范围与独立单位字体、图标和文字偏移均进入 Rust 天气画布", async () => {
    const base = { size: [250, 65], background: false, border: false, "image-size": 30, wind: false,
      "map-key": ["must-stay-in-the-editor"], "data-city": 330100, suffix: "C", connector: " / ",
      "weather-text-font": { size: 24, color: "#00ff00" },
      "weather-temperature-font": { size: 22, color: "#ff0000" },
      "suffix-text-font": { size: 16, color: "#0000ff" },
      "icon-list": { indexes: ["晴"], 晴: { "change-image": { relativePath: "/test-icon.png" } } },
    };
    const [node] = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.basic.weather-v2", options: base }, { x: 0, y: 0 });
    const weather = () => ({ condition: "晴", temperature: "4", high: "12", wind: "北", power: "3" });
    const visual = (opts: Record<string, unknown>) => boardNodes(
      [resolveKitOptions(node!, opts)], true, undefined, undefined, undefined, weather);
    const colors = visual({});
    expect(colors.at(-1)!.widget.kind).toBe("weather");
    expect(colors.at(-1)!.data.__kitWeather).toMatchObject({
      name: { value: "晴" }, temperature: { value: "4 / 12", unit: "C", unitFont: { size: 16, color: "#0000ff" } },
      icon: { size: 30 }, wind: null,
    });
    expect(colors[0]?.data).toMatchObject({ src: "/test-icon.png", __kitResource: true });
    expect(JSON.stringify(colors)).not.toContain("must-stay-in-the-editor");
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      const draw = (patch: Record<string, unknown>) => {
        surface.sync_scene(encodeBoardSync({ width: 250, height: 65, preview: true, selected: [], nodes: visual(patch) }));
        return surface.snapshot(250, 65, encodeBoardClock(boardClock(new Date(0))));
      };
      const original = draw({});
      const shifted = draw({ "temperature-text-offset": [0, 12], reverse: true });
      const single = draw({ icon: false, "weather-name": false });
      const hasTint = (buffer: Uint8Array, channel: number) => {
        for (let i = 8; i < buffer.length; i += 4) {
          if (buffer[i + channel]! > 150 && buffer[i + (channel + 1) % 3]! < 20
              && buffer[i + (channel + 2) % 3]! < 20) return true;
        }
        return false;
      };
      for (const channel of [0, 1, 2]) expect(hasTint(original, channel)).toBe(true);
      expect(hasTint(single, 1)).toBe(false);
      expect(hasTint(single, 2)).toBe(true);
      expect(shifted).not.toEqual(original);
    } finally { surface.free(); }
  });

  it("时间组件提供原站格式选项，并将时区和自定义格式传给画布", async () => {
    const formats = kitOptionDefinition("time-format", "", "widget.basic.timer-v2").options!;
    expect(formats.map(option => option.value)).toEqual(["YYYY-MM-DD HH:mm:ss", "YYYY年MM月DD日", "YYYY年MM月",
      "YYYY年", "MM月", "DD日", "HH:mm:ss", "mm分ss秒", "ss秒", "customise"]);
    expect(formats.at(-1)?.label).toBe("自定义");
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.basic.timer-v2", options: {
      size: [300, 60], "time-format": "HH:mm:ss", "time-customise": "[保留]", "time-zone": "Etc/GMT+5",
      font: { size: 24, color: "#ffffff" }, "show-weekday": true,
    } }, { x: 0, y: 0 });
    const rendered = boardNodes(nodes, true);
    expect(rendered[0]!.data.__kitText).toMatchObject({ timeZone: "Etc/GMT+5", timeFormat: "HH:mm:ss",
      timeCustom: "[保留]", weekday: true });
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      const snapshot = (zone: string) => {
        const visual = boardNodes([resolveKitOptions(nodes[0]!, { "time-zone": zone })], true);
        surface.sync_scene(encodeBoardSync({ width: 300, height: 60, preview: true, selected: [], nodes: visual }));
        return surface.snapshot(300, 60, encodeBoardClock(boardClock(new Date("2024-02-29T23:30:00Z"))));
      };
      expect(snapshot("Etc/GMT+5")).not.toEqual(snapshot("Etc/GMT-8"));
    } finally { surface.free(); }
  });

  it("指标卡数字和单位分别使用配置的字体、颜色、偏移与固定位数", async () => {
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.basic.card-v2", options: {
      size: [260, 60], type: "normal", "text-align": "left", "font-spacing": 0,
      font: { size: 26, color: "#ff0000" }, "unit-text": "万", "unit-offsetX": 8, "unit-offsetY": 3,
      "unit-font": { size: 10, color: "#00ff00" }, "unit-font2": { size: 16, color: "#0000ff", weight: 700 },
      "integer-digits": "fixed", "fixed-digits": 6, "decimal-places": 2, "complete-zero": true,
      "font-shadow-blur": -1, "unit-shadow-blur": -1,
    }, privateData: { fields: [{ uid: "value", type: "number" }], rows: [{ value: 12.3 }] } }, { x: 0, y: 0 });
    expect(nodes[0]!.widget).toMatchObject({ value: "000012.30", unit: "万", fontSize: 26 });
    const rendered = boardNodes(nodes, true);
    expect(rendered[0]!.data.__kitText).toMatchObject({ unitX: 8, unitY: 3, unitColor: "#0000ff",
      unitFont: { size: 16, weight: 700 } });
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 260, height: 60, preview: true, selected: [], nodes: rendered }));
      const pixels = surface.snapshot(260, 60, encodeBoardClock(boardClock(new Date(0))));
      let valueMax = -1, unitMin = 260;
      for (let y = 0; y < 60; y++) for (let x = 0; x < 260; x++) {
        const offset = 8 + (y * 260 + x) * 4;
        if (pixels[offset]! > 80 && pixels[offset + 2]! < 30) valueMax = Math.max(valueMax, x);
        if (pixels[offset + 2]! > 80 && pixels[offset]! < 30) unitMin = Math.min(unitMin, x);
      }
      expect(valueMax).toBeGreaterThan(20);
      expect(unitMin).toBeGreaterThan(valueMax);
      expect(unitMin).toBeLessThan(260);
    } finally { surface.free(); }
  });

  it("将柱图和折线图的原始图形文本设置映射到实际图表", () => {
    const create = (type: string) => kitNodes(entry("模板布局3D(1920X1080)"), {
      type, options: { size: [300, 200] }, privateData: { fields: [], rows: [] },
    })[0]!;
    const bars = resolveKitOptions(create("widget.echarts.column"), {
      label: true, "label-position": "top", "label-shape-spacing": -13, "label-offset2": [8, -4],
      "y-scale-range": "custom", "y-scale-min": -50, "y-scale-max": 150,
      "y-scale-interval-way": "number", "y-scale-interval": 5,
      "label-vertical-offset": 3, "hide-zero-value": true, "label-x": true,
      "label-text-type": "percent", "label-color-type": "follow", "label-tilt": 45, "label-unit-value": "吨",
      "label-unit-font": { size: 18, color: "#ff0000" },
    });
    expect(bars.data!.chart).toMatchObject({ showLabels: true, labelPosition: "outside", labelSpacing: -13,
      labelOffsetX: 8, labelOffsetY: -4, labelVerticalOffset: 3, hideZeroLabels: true,
      labelShowCategory: true, labelFormat: "percent", labelColorMode: "follow", labelTilt: 45,
      unit: "吨", labelUnitSize: 18, labelUnitColor: "#ff0000",
      axisRangeModeY: "custom", axisMinY: -50, axisMaxY: 150, axisIntervalModeY: "number", axisIntervalY: 5 });
    const line = resolveKitOptions(create("widget.echarts.line"), {
      label: true, "label-text-offset": [-6, 12], "label-follow-graph": true,
    });
    expect(line.data!.chart).toMatchObject({ labelOffsetX: -6, labelOffsetY: 12, labelFollowDataColor: true });
    const horizontal = resolveKitOptions(create("widget.echarts.bar"), {
      "label-position": "top-align", "label-y": true,
      "x-scale-range": "custom", "x-scale-min": -25, "x-scale-max": 75, "x-scale-interval": 25,
    });
    expect(horizontal.data!.chart).toMatchObject({ labelPosition: "top-align", labelShowCategory: true,
      axisRangeModeX: "custom", axisMinX: -25, axisMaxX: 75, axisIntervalModeX: "value", axisIntervalX: 25 });
    const dual = resolveKitOptions(create("widget.echarts.biaxial"), {
      label: false, "polyline-label": true, "polyline-label-position": "top",
      "polyline-label-text-type": "percent", "polyline-decimal-places": 1,
      "polyline-label-font": { size: 18, color: "#00ff00" }, "polyline-label-unit-value": "%",
      "y-polyline-display": true, "y-polyline-unit": true, "y-polyline-unit-text": "万元",
      "grid-y-polyline-display": true, "grid-y-polyline-line-type": "dotted",
    });
    expect(dual.data!.chart).toMatchObject({ showLabels: false, showLineLabels: true, lineLabelPosition: "top",
      lineLabelFormat: "percent", lineLabelDecimals: 1, lineLabelSize: 18, lineLabelColor: "#00ff00", lineLabelUnit: "%",
      showRightAxis: true, showRightAxisName: true, rightAxisName: "万元", showRightGrid: true, rightGridStyle: "dotted",
      kitPadding: [34, 18, 50, 27] });
  });

  it("将套件排名文本配置映射到画布图表", () => {
    const node = kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.echarts.bar", options: { size: [300, 200] }, privateData: { fields: [], rows: [] },
    })[0]!;
    const edited = resolveKitOptions(node, {
      "ranking-text": true, "ranking-text-font": { size: 19, color: "#ff3300", family: "monospace",
        bold: true, italic: true, underline: true, deleteline: true },
      "ranking-text-distance": 25, "ranking-text-template": "第{}名", "show-text-type": "custom",
      "ranking-text-show-number": 2, "ranking-text-background": "image",
      "ranking-text-background-image": { url: "data:image/png;base64,AA==" },
      "ranking-text-background-color": "#22446680", "ranking-text-background-width": 70,
      "ranking-text-background-height": 40, "ranking-text-fommater-type": "value-template",
      "legend-type": "scroll", "legend-pageTextStyle": { size: 16, color: "#00ff00" },
      "legend-pageIconSize": 18, "legend-pageButtonItemGap": 5, "legend-pageButtonGap": 7,
      "legend-pageIconColor": "#ffcc00", "legend-pageIconInactiveColor": "#333333",
      "legend-page-leftBackground": { relativePath: "/kits/assets/previous.png" },
      "legend-page-rightBackground": { url: "data:image/png;base64,AA==" },
    });
    expect(edited.data!.chart).toMatchObject({ showRanking: true, rankingFontSize: 19, rankingColor: "#ff3300",
      rankingFontFamily: "monospace", rankingBold: true, rankingItalic: true, rankingUnderline: true, rankingStrike: true,
      rankingDistance: 25, rankingTemplate: "第{}名", rankingDisplay: "custom", rankingCount: 2,
      rankingBackground: "image", rankingBackgroundImage: "data:image/png;base64,AA==",
      rankingBackgroundColor: "#22446680", rankingBackgroundWidth: 70, rankingBackgroundHeight: 40,
      rankingFormat: "value-template", legendType: "scroll", legendPageTextSize: 16, legendPageTextColor: "#00ff00",
      legendPageIconSize: 18, legendPageItemGap: 5, legendPageGap: 7, legendPageIconColor: "#ffcc00",
      legendPageInactiveColor: "#333333", legendPageLeftImage: "./kits/assets/previous.png",
      legendPageRightImage: "data:image/png;base64,AA==" });
  });

  it("重映射图层 ID，选中套件根节点，并整组撤销", () => {
    const item = entry("菜单");
    const nodes = kitNodes(item, readTemplate(item));
    const snapshot = handle({ type: "insertKit", nodes })!;
    const [root, ...children] = snapshot.tree;
    expect(snapshot.selectedIds).toEqual([root!.id]);
    expect(root!.id).not.toBe(nodes[0]!.id);
    expect(children.every(child => child.parentId === root!.id)).toBe(true);
    expect(snapshot.undoLabels.at(-1)).toBe("插入套件");
    expect(handle({ type: "undo" })!.tree).toHaveLength(0);
  });

  it("三维对象的嵌套配置和状态可以修改、保存并撤销", () => {
    const item = kitCatalog.find(entry => entry.id.startsWith("china-red-101-"))!;
    const inserted = handle({ type: "insertKit", nodes: kitNodes(item, readTemplate(item)) })!;
    const id = inserted.selectedId!;
    const meta = kitMetadata(inserted.tree[0]!)!;
    const skyIndex = meta.source.pieces![0]!.pieces!.findIndex(piece => piece.type === "sky");
    const path = [0, skyIndex];
    const original = kitPieceAt(meta.source, path)!.options!["sun-intensity"];
    expect(kitPieceOptionDefinition("sky", "sun-intensity", original)).toMatchObject({ label: "太阳光强度", type: "number" });
    const updated = handle({ type: "patchKitPieceOptions", id, path, patch: { "sun-intensity": 2.25 } })!;
    expect(kitPieceAt(kitMetadata(updated.tree[0]!)!.source, path)?.options?.["sun-intensity"]).toBe(2.25);
    const state = handle({ type: "patchKitPieceOptions", id, path, stateId: "night", patch: { "sun-intensity": 0.4 } })!;
    expect(kitPieceAt(kitMetadata(state.tree[0]!)!.source, path)?.statesOptions?.night?.["sun-intensity"]).toBe(0.4);
    const bytes = encodeProjectSnapshot({ name: "三维套件", savedAt: 1, scene: state.tree,
      boardSize: { width: 1920, height: 1080 }, settings: state.settings, params: {} });
    expect(kitPieceAt(kitMetadata(decodeSnapshotScene(bytes)[0]!)!.source, path)?.statesOptions?.night?.["sun-intensity"]).toBe(0.4);
    const afterUndo = handle({ type: "undo" })!;
    expect(kitPieceAt(kitMetadata(afterUndo.tree[0]!)!.source, path)?.statesOptions?.night).toBeUndefined();
    const beforeEdit = handle({ type: "undo" })!;
    expect(kitPieceAt(kitMetadata(beforeEdit.tree[0]!)!.source, path)?.options?.["sun-intensity"]).toEqual(original);
  });

  it("文本和背景保留原始文件，同时更新实际画布并可撤销", () => {
    const item = entry("功能按钮");
    const inserted = handle({ type: "insertKit", nodes: kitNodes(item, readTemplate(item)) })!;
    const id = inserted.selectedId!;
    expect(boardNodes(inserted.tree).some(node => node.id === `${id}::kit-background`)).toBe(true);
    const after = handle({ type: "patchKitOptions", id, patch: { text: "查看详情", opacity: 65 } })!;
    const rendered = boardNodes(after.tree).find(node => node.id === id);
    expect(rendered?.widget).toMatchObject({ text: "查看详情", opacity: 0.65 });
    expect(kitMetadata(after.tree[0]!)?.source.options?.text).toBe("查看详情");
    const bytes = encodeProjectSnapshot({ name: "套件", savedAt: 1, scene: after.tree,
      boardSize: { width: 1920, height: 1080 }, settings: after.settings, params: {} });
    expect(kitMetadata(decodeSnapshotScene(bytes)[0]!)?.source.options?.text).toBe("查看详情");
    expect(handle({ type: "undo" })!.tree[0]!.widget!.text).toBe("功能按钮");
  });

  it("数据字段和汇总方式更新图表，显隐设置同步到场景", () => {
    const binding = (uid: string, summary = "none") => ({ uid: ["c_private", "t_private", uid], summary });
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.echarts.column", options: { "axis-x": [binding("category")], "axis-y": [binding("sales", "sum")] },
      privateData: { fields: [{ uid: "category", type: "string" }, { uid: "sales", alias: "销量", type: "number" }],
        rows: [{ category: "一月", sales: 12 }, { category: "一月", sales: 18 }] },
    });
    const inserted = handle({ type: "insertKit", nodes })!;
    const id = inserted.selectedId!;
    expect(boardNodes(inserted.tree)[0]?.data.rows).toMatchObject([{ name: "一月", value: 30 }]);
    const changed = handle({ type: "patchKitOptions", id, patch: { "axis-y": [binding("sales", "avg")] } })!;
    expect(boardNodes(changed.tree)[0]?.data.rows).toMatchObject([{ name: "一月", value: 15 }]);
    const hidden = handle({ type: "patchKitOptions", id, patch: { visible: false } })!;
    expect(boardNodes(hidden.tree)).toEqual([]);
  });

  it("将折线图的右轴字段和文本设置绑定到右轴系列", () => {
    const binding = (uid: string) => ({ uid: ["c_private", "t_private", uid], summary: "none" });
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.echarts.line", options: { "axis-x": [binding("name")], "axis-y": [binding("left")],
        "axis-line": [binding("right")], "y-polyline-display": true, "y-polyline-label": true,
        "x-rotate": "-45", "y-rotate": "90", "y-polyline-rotate": "45", boundaryGap: false,
        "y-scale-range": "custom", "y-scale-min": -200, "y-scale-max": 200,
        "y-polyline-scale-range": "custom", "y-polyline-scale-min": -1, "y-polyline-scale-max": 1,
        "y-polyline-scale-interval-way": "number", "y-polyline-scale-interval": 4,
        "y-polyline-font": { size: 16, color: "#00ff00" }, "polyline-label": true,
        "polyline-label-position": "top", "polyline-label-text-type": "percent",
        "y-polyline-unit": true, "y-polyline-unit-text": "万元", "y-polyline-nameGap": 18,
        "grid-y-polyline-display": true, "grid-y-polyline-line-color": "#ff0000",
        "grid-y-polyline-line-type": "dotted", "grid-y-polyline-line-dotted-width": 8 },
      privateData: { fields: [{ uid: "name", type: "string" }, { uid: "left" }, { uid: "right" }],
        rows: [{ name: "一月", left: 100, right: 0.5 }, { name: "二月", left: -100, right: -0.5 }] },
    });
    expect(nodes[0]!.data?.rows).toMatchObject([{ name: "一月", value: 100, value2: 0.5 },
      { name: "二月", value: -100, value2: -0.5 }]);
    expect(nodes[0]!.data?.chart).toMatchObject({ seriesCount: 2, rightAxisStart: 2, showRightAxis: true,
      kitPadding: [34, 18, 50, 27],
      showRightAxisLabel: true, rightAxisFontSize: 16, rightAxisColor: "#00ff00", showLineLabels: true,
      lineLabelPosition: "top", lineLabelFormat: "percent", showRightAxisName: true, rightAxisName: "万元",
      rightAxisNameGap: 18, showRightGrid: true, rightGridColor: "#ff0000", rightGridStyle: "dotted", rightGridDash: 8,
      axisLabelRotateX: -45, axisLabelRotateY: 90, rightAxisRotate: 45, boundaryGap: false,
      axisRangeModeY: "custom", axisMinY: -200, axisMaxY: 200,
      rightAxisRangeMode: "custom", rightAxisMin: -1, rightAxisMax: 1,
      rightAxisIntervalMode: "number", rightAxisInterval: 4 });
    const withoutRight = resolveKitOptions(nodes[0]!, { "axis-line": [] });
    expect(withoutRight.data?.chart).toMatchObject({ rightAxisStart: 0, seriesCount: 1 });
  });

  it("折线宽度、虚线和阴影配置改变真实图表画布", async () => {
    const binding = (uid: string) => ({ uid: ["c_private", "t_private", uid], summary: "none" });
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.echarts.line", options: { size: [200, 100], "axis-x": [binding("name")],
        "axis-y": [binding("value")], "x-display": false, "y-display": false, grid: false,
        "padding-left-diy": 0, "padding-right-diy": 0, "padding-top-diy": 0, "padding-bottom-diy": 0 },
      privateData: { fields: [{ uid: "name" }, { uid: "value" }],
        rows: [{ name: "甲", value: 2 }, { name: "乙", value: 7 }, { name: "丙", value: 4 }] },
    }, { x: 0, y: 0 });
    const changed = [resolveKitOptions(nodes[0]!, { "unified-shape-size": 5, "unified-shape-type": "dashed",
      "series-shape-shadow-color": "#00ff00", "series-shape-shadow-blur": 6, "series-shape-shadow-offset": [0, 5] })];
    expect(kitOptionDefinition("series-shape-shadow-offset", [0, 0], "widget.echarts.line").label).toBe("阴影偏移");
    expect(changed[0]!.data!.chart).toMatchObject({ lineWidth: 5, lineStyle: "dashed",
      lineShadowColor: "#00ff00", lineShadowBlur: 6, lineShadowOffset: [0, 5] });
    const individual = resolveKitOptions(nodes[0]!, { "series-shape-custom": true,
      "zero-removal": true, "zero-removal-mode": "segment",
      "series-shape-number-type": "custom", "shape-column-number": 1,
      "flow-light-show": true, "flow-light-cluster": { indexes: ["first"], first: { "flow-light": true,
        "flow-light-dot-shape-type": "diamond", "flow-light-color": "#ff0000", "flow-light-size": 12,
        "flow-light-trailLength": 30, "flow-light-time": 4 } },
      "unified-dot-shadowColor": "#123456", "unified-dot-shadowBlur": 4, "unified-dot-shadowOffset": [2, 3],
      "series-shape-cluster": { indexes: ["first", "second"],
        first: { "series-dot-shape-type": "image", "series-image-url": { relativePath: "/kits/assets/point.png" },
          "series-dot-size": 16, "series-shape-type": "dashed", "series-line-shadow-color": "#ff0000" },
        second: { "series-dot-shape-type": "gradientCircle", "series-shape-smooth": true,
          "series-dot-shadowColor": "#00ff00", "series-dot-shadowOffset": [4, 5] } } });
    expect(individual.data!.chart).toMatchObject({ seriesStyleEnabled: true, zeroRemoval: true, zeroRemovalMode: "segment",
      categoryVisibilityMode: "custom", visibleCategoryCount: 1,
      flowEnabled: true, flowStyles: [{ enabled: true, shape: "diamond", color: "#ff0000", size: 12, trailLength: 30, duration: 4 }],
      pointShadowColor: "#123456", pointShadowBlur: 4, pointShadowOffset: [2, 3], seriesStyles: [
        { pointShape: "image", pointImage: "./kits/assets/point.png", pointRadius: 8, lineStyle: "dashed", lineShadowColor: "#ff0000" },
        { pointShape: "gradientCircle", smooth: true, pointShadowColor: "#00ff00", pointShadowOffset: [4, 5] },
      ] });
    const annotationOptions = { "annotation-line": true, "annotation-line-array-cluster": {
      indexes: ["target", "default"], target: { "annotation-line-value": 5, "annotation-line-type": "dotted",
        "annotation-line-dotted-width": 9, "annotation-line-color": "#ff0000", "annotation-line-width": "2",
        "annotation-line-text": "目标", "annotation-line-text-color": "#00ff00", "annotation-line-text-position": [8, -6] },
      default: { "annotation-line-type": "polyline" },
    } };
    const annotated = resolveKitOptions(nodes[0]!, annotationOptions);
    expect(annotated.data!.chart).toMatchObject({ referenceLines: [
      { value: 5, style: "dashed", dash: 9, color: "#ff0000", width: 2, name: "目标", textColor: "#00ff00", textOffset: [8, -6] },
      { value: 0, style: "solid", dash: 4, color: "#ffffff", width: 1, name: "", textColor: "#ffffff", textOffset: [0, 0] },
    ] });
    expect(resolveKitOptions(annotated, { "annotation-line": false }).data!.chart).toMatchObject({ referenceLines: [] });
    expect(kitOptionDefinition("zero-removal", false, "widget.echarts.line"))
      .toMatchObject({ label: "去除零值", group: "图形形状", hidden: false });
    const configured = resolveKitOptions(nodes[0]!, { "unified-dot-shape-type": "emptyRect", "unified-dot-size": 12,
      "legend-position": "left", "legend-icon": "diamond", "legend-icon-size": 16, "legend-itemGap": 18,
      "legend-font": { family: "monospace", size: 15, color: "#abcdef", bold: true, italic: true, underline: true, deleteline: true },
      "legend-text": "custom", "legend-text-width": 35, "legend-text-padding": 3,
      "legend-text-shadowColor": "#ff00ff", "legend-text-shadowBlur": 4, "legend-text-shadowOffset": [2, -1],
      "legend-pageTextStyle": { family: "monospace", size: 16, color: "#00ff00", bold: true, italic: true, underline: true },
      "tooltip-background-color": "#123456", "tooltip-position": "center", "tooltip-icon": true,
      "tooltip-background-image": "data:image/png;base64,example", "tooltip-text-type": "percent",
      "tooltip-comma-display": true, "tooltip-decimal-places": 2, "tooltip-complete-zero": true,
      "tooltip-right-text-type": "normal", "tooltip-right-decimal-places": 3, "tooltip-right-complete-zero": true,
      "tooltip-name-font-color": "#00ff00", "tooltip-name-font-size": 13, "tooltip-value-font-color": "#ff0000",
      "tooltip-title": true, "tooltip-title-font-size": 18, "tooltip-unit-name": true,
      "tooltip-unit-y": "万元", "tooltip-unit-yRight": "%", "tooltip-unit-color": "#0000ff",
      "show-cross-hairs-y": true, "show-cross-hairs-x": true, "cross-hairs-line-type": "solid",
      "cross-hairs-line-color": "#ff00ff", "show-cross-hairs-label": true,
      "slider-display": true, "slider-height": 20, "slider-foreground-color": "#ff0000",
      "x-line": true, "x-line-type": "dottedLine", "x-dotted-line-width": [3, 9],
      "x-line-width": 3, "x-line-color": "#ff0000",
      "x-font": { family: "monospace", size: 13, bold: true, italic: true, underline: true, deleteline: true },
      "x-font-overflow": true, "x-font-max-width": 60, "x-display-shadow-color": "#ff00ff",
      "x-display-shadow-blur": 5, "x-display-shadow-offset-x": 3, "x-display-shadow-offset-y": -2,
      "x-label": false, "y-tickline": true, "y-tickline-length": 12,
      "grid-y-line-type": "dotted", "grid-y-line-width": 2, "grid-y-line-dotted-width": 8,
      "y-text-type": "percent", "y-decimal-places": 2, "y-complete-zero": true,
      "y-value-abbreviation": "4", "y-unit": true, "y-unit-text": "万元",
      "y-unit-font": { size: 16, color: "#00ff00" }, "y-nameGap": 23 });
    expect(configured.data!.chart).toMatchObject({ pointShape: "squareEmpty", pointRadius: 6,
      legendPosition: "left", legendMarker: "diamond", legendMarkerSize: 16, legendGap: 18,
      legendFontFamily: "monospace", legendFontSize: 15, legendColor: "#abcdef", legendBold: true,
      legendItalic: true, legendUnderline: true, legendStrike: true, legendTextMode: "custom", legendTextWidth: 35,
      legendTextSpacing: 3, legendShadowColor: "#ff00ff", legendShadowBlur: 4, legendShadowOffset: [2, -1],
      legendPageFontFamily: "monospace", legendPageTextSize: 16, legendPageTextColor: "#00ff00",
      legendPageBold: true, legendPageItalic: true, legendPageUnderline: true,
      tooltipBackground: "#123456", tooltipPosition: "center", tooltipShowIcon: true,
      tooltipBackgroundImage: "data:image/png;base64,example", tooltipFormat: "percent", tooltipComma: true,
      tooltipDecimals: 2, tooltipPadZeros: true, tooltipRightFormat: "normal", tooltipRightDecimals: 3,
      tooltipRightPadZeros: true, tooltipNameColor: "#00ff00", tooltipNameSize: 13, tooltipTextColor: "#ff0000",
      tooltipShowTitle: true, tooltipTitleSize: 18, tooltipShowUnitName: true, tooltipUnit: "万元",
      tooltipRightUnit: "%", tooltipUnitColor: "#0000ff", tooltipShowVerticalPointer: true,
      tooltipShowHorizontalPointer: true, tooltipPointerStyle: "solid", tooltipPointerColor: "#ff00ff",
      tooltipPointerLabel: true,
      showDataZoom: true, zoomHeight: 20, zoomForeground: "#ff0000",
      showAxisLineX: true, axisLineStyleX: "dottedLine", axisLineDashX: [3, 9],
      axisLineWidthX: 3, axisLineColorX: "#ff0000",
      axisFontFamilyX: "monospace", axisBoldX: true, axisItalicX: true, axisUnderlineX: true, axisStrikeX: true,
      axisLabelOverflowX: true, axisLabelMaxWidthX: 60, axisLabelShadowColorX: "#ff00ff",
      axisLabelShadowBlurX: 5, axisLabelShadowOffsetX: [3, -2],
      showAxisLabelX: false, showAxisTicksY: true, axisTickLengthY: 12,
      gridStyleY: "dotted", gridWidthY: 2, gridDashY: 8,
      axisValueFormatY: "percent", axisDecimalsY: 2, axisPadZerosY: true, axisValueScaleY: "4",
      showAxisNameY: true, axisNameY: "万元", axisNameFontSizeY: 16, axisNameColorY: "#00ff00", axisNameGapY: 23 });
    expect(kitOptionDefinition("tooltip-right-text-type", "normal", "widget.echarts.line"))
      .toMatchObject({ label: "右侧 Y 轴数据显示格式", group: "提示信息", hidden: false });
    expect(kitOptionDefinition("tooltip-unit-name", false, "widget.echarts.line"))
      .toMatchObject({ label: "显示单位名称", group: "提示信息", hidden: false });
    expect(kitOptionDefinition("tooltip-unit-yRight", "%", "widget.echarts.line"))
      .toMatchObject({ label: "右侧 Y 轴单位名称", group: "提示信息", hidden: false });
    expect(kitOptionDefinition("show-cross-hairs-y", true, "widget.echarts.line").group).toBe("提示信息");
    expect(kitOptionDefinition("y-polyline-font", {}, "widget.echarts.line"))
      .toMatchObject({ label: "轴刻度值字体", group: "轴", hidden: false });
    expect(kitOptionDefinition("y-polyline-scale-interval", 50, "widget.echarts.line").hidden).toBe(false);
    const legacyFont = resolveKitOptions(nodes[0]!, { "x-font": { "line-through": true },
      "ranking-text-font": { "line-through": true } });
    expect(legacyFont.data!.chart).toMatchObject({ axisStrikeX: true, rankingStrike: true });
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      const snapshot = (scene: typeof nodes) => {
        surface.sync_scene(encodeBoardSync({ width: 200, height: 100, preview: true, selected: [], nodes: boardNodes(scene, true) }));
        return surface.snapshot(200, 100, encodeBoardClock(boardClock(new Date(0))));
      };
      const before = snapshot(nodes), after = snapshot(changed);
      let differences = 0;
      for (let i = 8; i < before.length; i++) if (before[i] !== after[i]) differences++;
      expect(differences).toBeGreaterThan(100);
    } finally { surface.free(); }
  });

  it("列表按行重复真实子组件，并根据布局、排序和每个子组件的数据更新画布", async () => {
    const binding = (uid: string) => ({ uid: ["c_private", "t_private", uid], summary: "none" });
    const source: ReferenceKitWidget = {
      type: "widget.group.list-v2", options: { size: [200, 100], "list-page-direction": "grid",
        "list-display-count-grid": [2, 2], "list-row-direction": "vertical",
        "axis-fields": [binding("sort")], "axis-sort-fields": [binding("sort")], "sort-type": "DESC" },
      privateData: { fields: [{ uid: "sort" }], rows: [{ sort: 1 }, { sort: 2 }, { sort: 3 }] },
      widgets: [
        { type: "widget.basic.graphical", options: { size: [80, 30], graphicalColor: "#ff0000" } },
        { type: "widget.basic.text", options: { size: [80, 20], "related-fields": {
          '["text"]': { "related-field": [binding("label")] },
        } }, privateData: { fields: [{ uid: "sort" }, { uid: "label" }], rows: [
          { sort: 1, label: "一" }, { sort: 2, label: "二" }, { sort: 3, label: "三" },
        ] } },
      ],
    };
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), source, { x: 0, y: 0 });
    const drawn = boardNodes(nodes, true);
    const text = drawn.filter(node => node.widget.kind === "text");
    expect(text.map(node => [node.widget.text, node.x, node.y])).toEqual([
      ["三", 0, 0], ["二", 100, 0], ["一", 0, 50],
    ]);
    expect(text[1]!.data).toMatchObject({ __kitListClone: true, __kitListIndex: 1,
      __kitListOriginalId: nodes[2]!.id, __kitListRootId: nodes[0]!.id });
    expect(kitMetadata(nodes[2]!)!.source.privateData!.rows).toHaveLength(3);
    const live = resolveRuntimeScene(nodes, { [nodes[0]!.id]: { rows: [{ sort: 1 }, { sort: 2 }] } }, {});
    expect(boardNodes(live, true).filter(node => node.widget.kind === "text").map(node => node.widget.text))
      .toEqual(["二", "一"]);
    const empty = resolveRuntimeScene(nodes, { [nodes[0]!.id]: { rows: [] } }, {});
    expect(boardNodes(empty, true).filter(node => node.widget.kind === "text")).toHaveLength(0);
    expect(boardNodes(empty).filter(node => node.widget.kind === "text")).toHaveLength(1);

    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 200, height: 100, preview: true, selected: [], nodes: drawn }));
      const pixels = surface.snapshot(200, 100, encodeBoardClock(boardClock(new Date(0))));
      for (const [x, y] of [[40, 15], [140, 15], [40, 65]]) {
        const offset = 8 + (y! * 200 + x!) * 4;
        expect(pixels[offset]).toBeGreaterThan(pixels[offset + 1]! + 50);
      }
    } finally { surface.free(); }
  });

  it("列表翻页控件发出页面事件，循环和单条滚动遵循原始配置", async () => {
    const binding = (uid: string) => ({ uid: ["c_private", "t_private", uid], summary: "none" });
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.group.list-v2", options: { size: [200, 100], "list-page-direction": "vertical",
        "list-display-count": 2, "list-scroll-direction": "horizontal", "list-dot-size": [10, 10],
        "is-show-switch-button": true, "axis-fields": [binding("name")],
        "carousel-duration": 0.1, "first-carousel-duration": 0.1 },
      privateData: { fields: [{ uid: "name" }], rows: [{ name: "甲" }, { name: "乙" }, { name: "丙" }] },
      widgets: [{ type: "widget.basic.text", options: { text: "列表项" } }],
    }, { x: 0, y: 0 });
    const root = nodes[0]!;
    expect(advanceKitList(root, 0, 1)).toBe(2);
    expect(advanceKitList(root, 2, 1)).toBe(0);
    expect(kitListItem(root, { name: "丙" }, 2)).toEqual({ index: 2, name: "丙", value: "丙", row: { name: "丙" } });
    const first = boardNodes(nodes, true);
    const next = boardNodes(nodes, true, new Map([[root.id, 2]]));
    expect(first.filter(node => node.widget.kind === "text")).toHaveLength(2);
    expect(next.filter(node => node.widget.kind === "text")).toHaveLength(1);
    expect(next.find(node => node.widget.kind === "text")!.data.__kitListIndex).toBe(2);
    const control = first.find(node => node.data.__kitListControl)!;
    expect(control.data.items).toEqual(["1", "2"]);
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 200, height: 100, preview: true, selected: [], nodes: first }));
      surface.pointer("down", control.x + 20, control.y + 5);
      surface.pointer("up", control.x + 20, control.y + 5);
      const events: unknown[] = [];
      dispatchCommandResponse(surface.take_events(), { boardEvent: event => events.push({ id: event.id, value: event.value }) });
      expect(events).toContainEqual({ id: root.id, value: { __kitTabIndex: 1, name: "2" } });
    } finally { surface.free(); }
    const listOffsets = new Map<string, number>(), transitions = new Map(), render = vi.fn();
    const host = Object.assign(Object.create(RustBoardHost.prototype), { state: { scene: nodes }, nodes: [],
      listOffsets, listSelections: new Map(), listPlayback: new Map(), listTransitions: transitions,
      listPendingOffsets: new Map(), lastListTick: -Infinity, lastListFrame: -Infinity, render,
    }) as { tickKitLists(now: number): void };
    host.tickKitLists(0); host.tickKitLists(100);
    expect(listOffsets.get(root.id)).toBe(2);
    expect(transitions.get(root.id)).toMatchObject({ from: 0, to: 2, direction: 1, progress: 0 });
    host.tickKitLists(300);
    expect(transitions.get(root.id).progress).toBe(0.5);
    host.tickKitLists(500); host.tickKitLists(600);
    expect(listOffsets.get(root.id)).toBe(0);
    expect(transitions.get(root.id)).toMatchObject({ from: 2, to: 0, direction: 1 });
    expect(render).toHaveBeenCalledTimes(4);
  });

  it("原始智慧城市列表只按匹配字段分组，其余子组件使用各自完整数据", () => {
    const item = entry("列表-1", "city-ioc");
    const nodes = kitNodes(item, readTemplate(item), { x: 0, y: 0 });
    const rendered = boardNodes(nodes, true);
    const names = rendered.filter(node => node.name === "区域名称");
    expect(names.map(node => node.widget.text)).toEqual(["余杭区", "余杭区", "余杭区", "余杭区"]);
    expect(names.map(node => node.y)).toEqual([0, 35, 70, 105]);
    const indices = rendered.filter(node => node.name === "指标卡");
    expect(indices.map(node => node.widget.text)).toEqual(["01", "02", "03", "04"]);
    const progress = rendered.filter(node => node.name === "基础百分比图");
    expect(progress.map(node => node.data.percent)).toEqual([20, 20, 20, 20]);
    expect(progress[0]!.data.__kitProgress).toMatchObject({ gradient: { angle: 90, stops: [
      { position: 0, color: "#3c6486" }, { position: 100, color: "#90d6f5" },
    ] } });
  });

  it("百分比图使用首条数据并在画布中绘制渐变填充", async () => {
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.echarts.progress-v2", options: { size: [200, 20], shape: "rect", label: false,
        "fill-border-radius": 0, "shape-background": "#000000", "progress-color": { angle: 90,
          colors: [{ position: 0, color: "#ff0000" }, { position: 100, color: "#0000ff" }] },
        "axis-value": [{ uid: ["c_private", "t_private", "value"], summary: "sum" }] },
      privateData: { fields: [{ uid: "value", type: "number" }], rows: [{ value: 0.2 }, { value: 0.3 }] },
    }, { x: 0, y: 0 });
    const rendered = boardNodes(nodes, true);
    expect(rendered[0]!.data.percent).toBe(20);
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 200, height: 20, preview: true, selected: [], nodes: rendered }));
      const pixels = surface.snapshot(200, 20, encodeBoardClock(boardClock(new Date(0))));
      const sample = (x: number) => Array.from(pixels.slice(8 + (10 * 200 + x) * 4, 12 + (10 * 200 + x) * 4));
      const left = sample(5), right = sample(35), background = sample(100);
      expect(left[0]).toBeGreaterThan(right[0]!);
      expect(right[2]).toBeGreaterThan(left[2]!);
      expect(background).toEqual([0, 0, 0, 255]);
    } finally { surface.free(); }
  });

  it("百分比图支持柱形填充、环形角度及文本显示格式", async () => {
    const source: ReferenceKitWidget = { type: "widget.echarts.progress-v2", options: {
      size: [20, 100], shape: "column", label: false, "fill-border-radius": 0,
      "shape-background": "#000000", "progress-color": "#ff0000",
      "axis-value": [{ uid: ["c_private", "t_private", "value"], summary: "sum" }],
    }, privateData: { fields: [{ uid: "value", type: "number" }], rows: [{ value: 0.25 }] } };
    const column = boardNodes(kitNodes(entry("模板布局3D(1920X1080)"), source, { x: 0, y: 0 }), true);
    const labels = (options: Record<string, unknown>) => boardNodes(kitNodes(entry("模板布局3D(1920X1080)"),
      { ...source, options: { ...source.options, label: true, ...options } }, { x: 0, y: 0 }), true)[0]!.data.__kitProgress;
    expect(labels({ "label-text-type": "normal", "label-decimal-places": 3, "label-complete-zero": true }))
      .toMatchObject({ labelText: "0.250" });
    expect(labels({ "label-text-type": "percent", "label-decimal-places": 2, "label-complete-zero": true }))
      .toMatchObject({ labelText: "25.00%" });
    expect(labels({ "label-color-type": "follow" })).toMatchObject({ labelColor: "#ff0000" });
    const ring = boardNodes(kitNodes(entry("模板布局3D(1920X1080)"), { ...source,
      options: { ...source.options, size: [100, 100], shape: "ring", "ring-size": 10,
        "shape-background": "#ffffff", "data-start-angle": -90, "data-end-angle": 90 },
    }, { x: 0, y: 0 }), true);
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 20, height: 100, preview: true, selected: [], nodes: column }));
      const pixels = surface.snapshot(20, 100, encodeBoardClock(boardClock(new Date(0))));
      const sample = (x: number, y: number) => Array.from(pixels.slice(8 + (y * 20 + x) * 4, 12 + (y * 20 + x) * 4));
      expect(sample(10, 10)).toEqual([0, 0, 0, 255]);
      expect(sample(10, 90)).toEqual([255, 0, 0, 255]);
      surface.sync_scene(encodeBoardSync({ width: 100, height: 100, preview: true, selected: [], nodes: ring }));
      const ringPixels = surface.snapshot(100, 100, encodeBoardClock(boardClock(new Date(0))));
      expect(ringPixels[8 + (50 * 100 + 5) * 4 + 3]).toBe(0);
      expect(ringPixels[8 + (50 * 100 + 95) * 4 + 3]).toBeGreaterThan(0);
    } finally { surface.free(); }
  });

  it("百分比图的分片数量和间隔影响条形与环形的真实画布", async () => {
    const source: ReferenceKitWidget = { type: "widget.echarts.progress-v2", options: {
      size: [100, 20], shape: "rect", label: false, "fill-border-radius": 0,
      "bar-shape": "burst", "bar-shape_burst-number": 10, "bar-shape_burst-interval": 4,
      "background-shape_burst": true, "shape-background": "#444444", "progress-color": "#ff0000",
      "axis-value": [{ uid: ["c_private", "t_private", "value"], summary: "sum" }],
    }, privateData: { fields: [{ uid: "value", type: "number" }], rows: [{ value: 0.5 }] } };
    const rect = boardNodes(kitNodes(entry("模板布局3D(1920X1080)"), source, { x: 0, y: 0 }), true);
    const ring = boardNodes(kitNodes(entry("模板布局3D(1920X1080)"), { ...source, options: {
      ...source.options, size: [100, 100], shape: "ring", "ring-size": 10,
      "bar-shape_burst-number": 8, "bar-shape_burst-interval": 5,
      "data-start-angle": -90, "data-end-angle": 270,
    } }, { x: 0, y: 0 }), true);
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 100, height: 20, preview: true, selected: [], nodes: rect }));
      const pixels = surface.snapshot(100, 20, encodeBoardClock(boardClock(new Date(0))));
      const sample = (x: number, y: number) => Array.from(pixels.slice(8 + (y * 100 + x) * 4, 12 + (y * 100 + x) * 4));
      expect(sample(5, 10)).toEqual([255, 0, 0, 255]);
      expect(sample(10, 10)[3]).toBe(0);
      expect(sample(55, 10)).toEqual([68, 68, 68, 255]);
      surface.sync_scene(encodeBoardSync({ width: 100, height: 100, preview: true, selected: [], nodes: ring }));
      const ringPixels = surface.snapshot(100, 100, encodeBoardClock(boardClock(new Date(0))));
      const ringSample = (x: number, y: number) => Array.from(ringPixels.slice(8 + (y * 100 + x) * 4, 12 + (y * 100 + x) * 4));
      expect(ringSample(50, 5)[3]).toBe(0);
      expect(ringSample(67, 8)[0]).toBeGreaterThan(100);
      expect(ringSample(8, 67)[1]).toBeGreaterThan(0);
    } finally { surface.free(); }
  });

  it("环形百分比图渲染渐变，顶部标签留在组件内", async () => {
    const source: ReferenceKitWidget = { type: "widget.echarts.progress-v2", options: {
      size: [100, 100], shape: "ring", label: false, "ring-size": 10, "shape-background": "transparent",
      "progress-color": { angle: 90, colors: [{ position: 0, color: "#ff0000" },
        { position: 100, color: "#0000ff" }] },
      "axis-value": [{ uid: ["value"], summary: "none" }],
    }, privateData: { fields: [{ uid: "value", type: "number" }], rows: [{ value: 1 }] } };
    const ring = boardNodes(kitNodes(entry("模板布局3D(1920X1080)"), source, { x: 0, y: 0 }), true);
    const label = boardNodes(kitNodes(entry("模板布局3D(1920X1080)"), { ...source, options: {
      ...source.options, size: [200, 80], shape: "rect", label: true, "label-position": "top",
      "label-font": { size: 20, color: "#ffffff" }, "shape-background": "#000000", "progress-color": "#000000",
    } }, { x: 0, y: 0 }), true);
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 100, height: 100, preview: true, selected: [], nodes: ring }));
      const pixels = surface.snapshot(100, 100, encodeBoardClock(boardClock(new Date(0))));
      const sample = (x: number, y: number) => Array.from(pixels.slice(8 + (y * 100 + x) * 4, 12 + (y * 100 + x) * 4));
      expect(sample(5, 50)[0]).toBeGreaterThan(sample(5, 50)[2]!);
      expect(sample(95, 50)[2]).toBeGreaterThan(sample(95, 50)[0]!);
      surface.sync_scene(encodeBoardSync({ width: 200, height: 80, preview: true, selected: [], nodes: label }));
      const textPixels = surface.snapshot(200, 80, encodeBoardClock(boardClock(new Date(0))));
      expect(Array.from(textPixels.slice(8, 8 + 200 * 30 * 4))
        .filter((value, index) => index % 4 !== 3 && value > 200).length).toBeGreaterThan(5);
    } finally { surface.free(); }
  });

  it("列表筛选后使用原始行号读取子组件数据", () => {
    const binding = (uid: string) => ({ uid: ["c_private", "t_private", uid], summary: "none" });
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.group.list-v2", options: {
      "list-display-count": 2, filter: true, "filter-condition": "data-row", "filter-data-row-num": 2,
    }, privateData: { fields: [{ uid: "f_name" }], rows: [{ f_name: "甲" }, { f_name: "乙" }, { f_name: "丙" }] },
    widgets: [{ type: "widget.basic.text", options: {
      "related-fields": { '["text"]': { "related-field": [binding("label")] } },
    }, privateData: { fields: [{ uid: "f_name" }, { uid: "label" }], rows: [
      { f_name: "甲", label: "第一" }, { f_name: "乙", label: "第二" }, { f_name: "丙", label: "第三" },
    ] } }] });
    const text = boardNodes(nodes, true).filter(node => node.widget.kind === "text");
    expect(text.map(node => [node.widget.text, node.data.__kitListIndex])).toEqual([["第二", 1]]);
    const live = resolveRuntimeScene(nodes, { [nodes[1]!.id]: { rows: [
      { f_name: "甲", label: "实时第一" }, { f_name: "乙", label: "实时第二" }, { f_name: "丙", label: "实时第三" },
    ] } }, {});
    expect(boardNodes(live, true).filter(node => node.widget.kind === "text").map(node => node.widget.text))
      .toEqual(["实时第二"]);
  });

  it("列表的具名条件筛选保留原始行号，子组件继续读取对应行", () => {
    const binding = (uid: string) => ({ uid: ["c_private", "t_private", uid], summary: "none" });
    const condition: BoardDataCondition = { id: "list-condition", name: "后两行", groups: [[{
      sourceId: "$current", field: "$row", operator: ">=", value: "2", selector: "each", index: 1,
    }]] };
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.group.list-v2", options: {
      "axis-fields": [binding("name")], "list-display-count": 2, filter: true,
      "filter-condition": "data-condition", "filter-condition-select": condition.id,
    }, privateData: { fields: [{ uid: "name" }], rows: [{ name: "甲" }, { name: "乙" }, { name: "丙" }] },
    widgets: [{ type: "widget.basic.text", options: {
      "related-fields": { '["text"]': { "related-field": [binding("label")] } },
    }, privateData: { fields: [{ uid: "name" }, { uid: "label" }], rows: [
      { name: "甲", label: "第一" }, { name: "乙", label: "第二" }, { name: "丙", label: "第三" },
    ] } }] });
    const scene = resolveRuntimeScene(nodes, {}, {}, [condition]);
    expect(boardNodes(scene, true).filter(node => node.widget.kind === "text").map(node => node.widget.text))
      .toEqual(["第二", "第三"]);
  });

  it("列表项背景、选中状态、分割线和空白区域进入实际画布", async () => {
    const binding = (uid: string) => ({ uid: ["c_private", "t_private", uid], summary: "none" });
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.group.list-v2", options: { size: [200, 100], "axis-fields": [binding("name")],
        "list-display-count": 2, "use-item-selected": true, "item-default-color": "#ff0000",
        "item-selected-color": "#0000ff", "list-show-line": true, "line-border-color": "#00ff00",
        "line-border-width": 2 },
      privateData: { fields: [{ uid: "name" }], rows: [{ name: "甲" }, { name: "甲" }, { name: "乙" }] },
      widgets: [{ type: "widget.basic.text", options: { size: [50, 20], text: "标签" } }],
    }, { x: 0, y: 0 });
    const root = nodes[0]!;
    expect(kitOptionDefinition("carousel-type", "page", "widget.group.list-v2").label).toBe("切换方式");
    expect(kitOptionDefinition("item-selected-color", "", "widget.group.list-v2").label).toBe("背景颜色");
    const rendered = boardNodes(nodes, true, new Map(), new Map([[root.id, 2]]));
    expect(rendered.filter(node => node.widget.kind === "text")).toHaveLength(2);
    expect(rendered.filter(node => node.data.__kitListClone && node.data.__kitListOriginalId === root.id))
      .toHaveLength(2);
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 200, height: 100, preview: true, selected: [], nodes: rendered }));
      const pixels = surface.snapshot(200, 100, encodeBoardClock(boardClock(new Date(0))));
      const sample = (x: number, y: number) => Array.from(pixels.slice(8 + (y * 200 + x) * 4, 12 + (y * 200 + x) * 4));
      expect(sample(100, 20)).toEqual([255, 0, 0, 255]);
      expect(sample(100, 70)).toEqual([0, 0, 255, 255]);
      expect(sample(100, 50)[1]).toBeGreaterThan(200);
      expect(decodeHitResult(surface.hit_test(100, 70))?.id).toBe(`${root.id}::kit-list-hit-1`);
    } finally { surface.free(); }
    const onComponentEvent = vi.fn(), render = vi.fn(), listSelections = new Map<string, number>();
    const host = Object.assign(Object.create(RustBoardHost.prototype), {
      state: { scene: nodes }, nodes: rendered, options: { onComponentEvent }, render,
      listSelections, selectedItemValues: new Map(),
    }) as { emitKitListItem(id: string): void };
    host.emitKitListItem(`${root.id}::kit-list-hit-1`);
    expect(listSelections.get(root.id)).toBe(2);
    expect(onComponentEvent).toHaveBeenCalledWith(root, "itemClick", "乙",
      { index: 2, name: "乙", value: "乙", row: { name: "乙" } });
    expect(render).toHaveBeenCalledOnce();
  });

  it("列表单条滚动使用单条布局和无限循环配置", () => {
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.group.list-v2", options: { size: [100, 80], "carousel-type": "row",
        "list-row-direction": "vertical", "list-page-direction": "horizontal", "list-display-count": 2,
        "list-wheel-scroll": true, "carousel-loop": true, "carousel-loop-type": "infinite" },
      privateData: { fields: [{ uid: "f_name" }], rows: [{ f_name: "甲" }, { f_name: "乙" }, { f_name: "丙" }] },
      widgets: [{ type: "widget.basic.text", options: { text: "项" } }],
    }, { x: 0, y: 0 });
    const root = nodes[0]!;
    expect(kitListInfo(root)).toMatchObject({ total: 3, capacity: 2, rowMode: true, wheel: true, infinite: true });
    expect(advanceKitList(root, 1, 1)).toBe(2);
    expect(advanceKitList(root, 2, 1)).toBe(0);
    const rows = boardNodes(nodes, true, new Map([[root.id, 2]])).filter(node => node.widget.kind === "text");
    expect(rows.map(row => [row.y, row.data.__kitListIndex])).toEqual([[0, 2], [40, 0]]);
    const smaller = resolveRuntimeScene(nodes, { [root.id]: { rows: [{ f_name: "甲" }, { f_name: "乙" }] } }, {});
    expect(boardNodes(smaller, true, new Map([[root.id, 2]])).filter(node => node.widget.kind === "text")
      .map(row => row.data.__kitListIndex)).toEqual([0, 1]);
  });

  it("列表单条过渡保留重叠项并裁剪首尾，支持无限循环", () => {
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.group.list-v2", options: { size: [100, 80], "carousel-type": "row",
        "list-row-direction": "vertical", "list-display-count": 2, "carousel-loop-type": "infinite" },
      privateData: { fields: [{ uid: "f_name" }], rows: [{ f_name: "甲" }, { f_name: "乙" }, { f_name: "丙" }] },
      widgets: [{ type: "widget.basic.text", options: { text: "项" } }],
    }, { x: 10, y: 20 });
    const root = nodes[0]!;
    const transition = new Map<string, KitListTransition>([[root.id, { from: 0, to: 1, direction: 1, progress: 0.5 }]]);
    const rows = boardNodes(nodes, true, new Map([[root.id, 1]]), new Map(), transition)
      .filter(node => node.widget.kind === "text");
    expect(rows.map(row => [row.y, row.data.__kitListIndex])).toEqual([[0, 0], [40, 1], [80, 2]]);
    expect(rows.map(row => row.data.__kitListClip)).toEqual([
      { x: 10, y: 20, width: 100, height: 20 },
      { x: 10, y: 40, width: 100, height: 40 },
      { x: 10, y: 80, width: 100, height: 20 },
    ]);
    transition.set(root.id, { from: 2, to: 0, direction: 1, progress: 0.5 });
    const wrapped = boardNodes(nodes, true, new Map([[root.id, 0]]), new Map(), transition)
      .filter(node => node.widget.kind === "text");
    expect(wrapped.map(row => row.data.__kitListIndex)).toEqual([2, 0, 1]);
    transition.set(root.id, { from: 0, to: 2, direction: -1, progress: 0.5 });
    const reversed = boardNodes(nodes, true, new Map([[root.id, 2]]), new Map(), transition)
      .filter(node => node.widget.kind === "text");
    expect(reversed.map(row => [row.y, row.data.__kitListIndex])).toEqual([[40, 0], [80, 1], [0, 2]]);
  });

  it("列表过渡期间合并连续滚动，完成后继续到目标位置", () => {
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.group.list-v2", options: { size: [100, 80], "carousel-type": "row",
        "list-row-direction": "vertical", "list-display-count": 2, "carousel-display": false,
        "carousel-loop-type": "infinite" },
      privateData: { fields: [{ uid: "f_name" }], rows: [{ f_name: "甲" }, { f_name: "乙" },
        { f_name: "丙" }, { f_name: "丁" }] },
      widgets: [{ type: "widget.basic.text", options: { text: "项" } }],
    });
    const root = nodes[0]!, offsets = new Map<string, number>(), transitions = new Map(), pending = new Map();
    const host = Object.assign(Object.create(RustBoardHost.prototype), { state: { scene: nodes }, nodes: [],
      listOffsets: offsets, listSelections: new Map(), listPlayback: new Map(), listTransitions: transitions,
      listPendingOffsets: pending, lastListTick: -Infinity, lastListFrame: -Infinity, render: vi.fn(),
    }) as { setKitListOffset(node: typeof root, offset: number, direction: 1 | -1): void; tickKitLists(now: number): void };
    const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
    try {
      host.setKitListOffset(root, 1, 1);
      host.setKitListOffset(root, 2, 1);
      expect(offsets.get(root.id)).toBe(1);
      expect(pending.get(root.id)).toEqual({ offset: 2, direction: 1 });
      host.tickKitLists(1200);
      expect(transitions.get(root.id).progress).toBe(0.5);
      host.tickKitLists(1400);
      expect(offsets.get(root.id)).toBe(2);
      expect(transitions.get(root.id)).toMatchObject({ from: 1, to: 2, progress: 0 });
      expect(pending.has(root.id)).toBe(false);
      host.tickKitLists(1800);
      expect(transitions.has(root.id)).toBe(false);
    } finally { clock.mockRestore(); }
  });

  it("列表整页过渡使用独立的滚动方向并裁剪背景及命中区域", async () => {
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.group.list-v2", options: { size: [100, 80], "list-page-direction": "vertical",
        "list-display-count": 2, "list-scroll-direction": "horizontal", "is-show-switch-button": false,
        "item-default-color": "#ff0000" },
      privateData: { fields: [{ uid: "f_name" }], rows: [{ f_name: "甲" }, { f_name: "乙" }, { f_name: "丙" }] },
      widgets: [{ type: "widget.basic.graphical", options: { size: [100, 40],
        graphicalType: "rectangle", graphicalColor: "#ff0000" } }],
    }, { x: 30, y: 10 });
    const root = nodes[0]!;
    const transition = new Map([[root.id, { from: 0, to: 2, direction: 1 as const, progress: 0.5 }]]);
    const drawn = boardNodes(nodes, true, new Map([[root.id, 2]]), new Map(), transition);
    const rows = drawn.filter(node => node.name === nodes[1]!.name);
    expect(rows.map(row => [row.x, row.y, row.data.__kitListIndex])).toEqual([[-20, 10, 0], [-20, 50, 1], [80, 10, 2]]);
    expect(rows.map(row => row.data.__kitListClip)).toEqual([
      { x: 30, y: 10, width: 50, height: 40 }, { x: 30, y: 50, width: 50, height: 40 },
      { x: 80, y: 10, width: 50, height: 40 },
    ]);
    expect(drawn.filter(node => node.data.__kitListBackground && node.data.__kitListRootId)
      .every(node => node.data.__kitListClip)).toBe(true);
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 160, height: 100, preview: true, selected: [], nodes: drawn }));
      const pixels = surface.snapshot(160, 100, encodeBoardClock(boardClock(new Date(0))));
      expect(pixels[8 + (20 * 160 + 40) * 4]).toBe(255);
      expect(pixels[8 + (20 * 160 + 15) * 4 + 3]).toBe(0);
      expect(pixels[8 + (20 * 160 + 140) * 4 + 3]).toBe(0);
      expect(decodeHitResult(surface.hit_test(15, 20))).toBeNull();
      expect(decodeHitResult(surface.hit_test(140, 20))).toBeNull();
    } finally { surface.free(); }
  });

  it("列表轮播按选中设置逐项推进并在跨页时同步翻页", () => {
    const source: ReferenceKitWidget = {
      type: "widget.group.list-v2", options: { size: [100, 100], "list-display-count": 2,
        "use-item-selected": true, "carousel-auto-select": true, "carousel-duration": 0.1,
        "first-carousel-duration": 0.1 },
      privateData: { fields: [{ uid: "f_name" }], rows: [{ f_name: "甲" }, { f_name: "乙" }, { f_name: "丙" }] },
      widgets: [{ type: "widget.basic.text", options: { text: "项" } }],
    };
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), source);
    const root = nodes[0]!, selections = new Map<string, number>(), offsets = new Map<string, number>();
    const onComponentEvent = vi.fn(), render = vi.fn();
    const host = Object.assign(Object.create(RustBoardHost.prototype), { state: { scene: nodes }, nodes: [],
      listOffsets: offsets, listSelections: selections, listPlayback: new Map(), selectedItemValues: new Map(),
      listTransitions: new Map(), listPendingOffsets: new Map(), lastListFrame: -Infinity,
      lastListTick: -Infinity, render, options: { onComponentEvent },
    }) as { tickKitLists(now: number): void };
    host.tickKitLists(0); host.tickKitLists(100);
    expect(selections.get(root.id)).toBe(0);
    host.tickKitLists(200);
    expect(selections.get(root.id)).toBe(1);
    host.tickKitLists(300);
    expect(selections.get(root.id)).toBe(2);
    expect(offsets.get(root.id)).toBe(2);
    host.tickKitLists(700); host.tickKitLists(800);
    expect(selections.get(root.id)).toBe(0);
    expect(offsets.get(root.id)).toBe(0);
    expect(onComponentEvent).toHaveBeenCalledWith(root, "componentSelected", "丙",
      { index: 2, name: "丙", value: "丙", row: { f_name: "丙" } });
  });

  it("列表子项绘制和点击都裁剪在所属行内", async () => {
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.group.list-v2", options: { size: [100, 100], "list-display-count": 2 },
      privateData: { fields: [{ uid: "f_name" }], rows: [{ f_name: "甲" }] },
      widgets: [{ type: "widget.basic.graphical", options: { size: [100, 80],
        graphicalType: "rectangle", graphicalColor: "#ff0000" } }],
    }, { x: 0, y: 0 });
    const rendered = boardNodes(nodes, true);
    expect(rendered.find(node => node.id === nodes[1]!.id)?.data.__kitListClip)
      .toEqual({ x: 0, y: 0, width: 100, height: 50 });
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 100, height: 100, preview: true, selected: [], nodes: rendered }));
      const pixels = surface.snapshot(100, 100, encodeBoardClock(boardClock(new Date(0))));
      expect(pixels[8 + (20 * 100 + 2) * 4]).toBe(255);
      expect(pixels[8 + (60 * 100 + 20) * 4 + 3]).toBe(0);
      expect(decodeHitResult(surface.hit_test(20, 60))).toBeNull();
    } finally { surface.free(); }
  });

  it("原始图形的矩形和菱形使用完整组件尺寸", async () => {
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.group.panel", options: { size: [100, 40], "background-color": "transparent", border: false }, widgets: [
        { type: "widget.basic.graphical", options: { size: [40, 20], graphicalType: "rectangle", graphicalColor: "#ff0000" } },
        { type: "widget.basic.graphical", options: { size: [40, 20], position: [50, 0], graphicalType: "lozenge", graphicalColor: "#0000ff" } },
      ],
    }, { x: 0, y: 0 });
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 100, height: 40, preview: true, selected: [], nodes: boardNodes(nodes, true) }));
      const pixels = surface.snapshot(100, 40, encodeBoardClock(boardClock(new Date(0))));
      expect(pixels[8 + (2 * 100 + 2) * 4]).toBe(255);
      expect(pixels[8 + (10 * 100 + 70) * 4 + 2]).toBe(255);
      expect(pixels[8 + (2 * 100 + 52) * 4 + 3]).toBe(0);
    } finally { surface.free(); }
  });

  it("导入或接入数据后仍保留套件配置，并按所选字段更新图表", () => {
    const binding = (uid: string, summary = "none") => ({ uid: ["c_private", "t_private", uid], summary });
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.echarts.column", options: { "axis-x": [binding("f_name")], "axis-y": [binding("f_value")] },
      privateData: { fields: [{ uid: "f_name", type: "string" }, { uid: "f_value", type: "number" }],
        rows: [{ f_name: "原值", f_value: 1 }] },
    });
    const id = handle({ type: "insertKit", nodes })!.selectedId!;
    const imported = handle({ type: "setStaticData", id, data: { columns: ["city", "count"], rows: [
      { city: "上海", count: 3 }, { city: "上海", count: 7 },
    ] } })!;
    expect(kitMetadata(imported.tree[0]!)?.source.type).toBe("widget.echarts.column");
    const configured = handle({ type: "patchKitOptions", id, patch: {
      "axis-x": [binding("city")], "axis-y": [binding("count", "sum")],
    } })!;
    expect(resolveRuntimeScene(configured.tree, {}, {})[0]!.data?.rows).toMatchObject([{ name: "上海", value: 10 }]);
    expect(resolveRuntimeScene(configured.tree, { [id]: { rows: [
      { city: "深圳", count: 8 }, { city: "深圳", count: 4 },
    ] } }, {})[0]!.data?.rows).toMatchObject([{ name: "深圳", value: 12 }]);
    expect(kitMetadata(configured.tree[0]!)?.source.options?.["axis-y"]).toEqual([binding("count", "sum")]);
    const restored = handle({ type: "undo" })!;
    expect(kitMetadata(restored.tree[0]!)?.source.options?.["axis-y"]).toEqual([binding("f_value")]);
    const cleared = handle({ type: "undo" })!;
    expect(kitMetadata(cleared.tree[0]!)?.source.privateData?.rows).toEqual([{ f_name: "原值", f_value: 1 }]);
  });

  it("表格字段、行列样式、选中状态和行事件进入真实 WASM", async () => {
    const binding = (uid: string) => ({ uid: ["c_private", "t_private", uid], summary: "none" });
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.basic.table-v3", options: { size: [200, 100], "header-height": 20, "row-count": 2, autoWidth: true,
        "axis-fields": [binding("city"), binding("count")], "header-bg-color": "#202020",
        "table-cell-line-horizontal-width": 0, "table-cell-line-vertical-width": 0,
        "table-row-body-cluster": { indexes: ["a", "b"], a: { "row-bg-color": "#ff0000" },
          b: { "row-bg-color": "#0000ff", "row-selected-bg-color": "#00ff00" } },
        "table-col-body-cluster": { indexes: ["first", "second"], first: { "col-width-auto": 25 },
          second: { "col-width-auto": 75 } },
      }, privateData: { fields: [{ uid: "city", alias: "城市" }, { uid: "count", alias: "数量" }],
        rows: [{ city: "广州", count: 3 }, { city: "上海", count: 8 }] },
    }, { x: 0, y: 0 });
    const root = nodes[0]!;
    root.bindings = { rows: "rows" };
    const rendered = boardNodes(resolveRuntimeScene(nodes, { [root.id]: { rows: [
      { city: "深圳", count: 6 }, { city: "杭州", count: 9 },
    ] } }, {}));
    expect(rendered[0]!.data.columns).toEqual(["城市", "数量"]);
    expect(rendered[0]!.data.rows).toEqual([["深圳", 6], ["杭州", 9]]);
    expect(rendered[0]!.data.__kitTable).toMatchObject({ rowCount: 2, headerHeight: 20,
      columns: [{ widthAuto: 25 }, { widthAuto: 75 }] });
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 200, height: 100, preview: true, selected: [], nodes: rendered }));
      const clock = encodeBoardClock(boardClock(new Date(0)));
      const before = surface.snapshot(200, 100, clock);
      const first = 8 + (200 * 30 + 4) * 4, second = 8 + (200 * 70 + 4) * 4;
      expect(before[first]).toBeGreaterThan(before[first + 2]!);
      expect(before[second + 2]).toBeGreaterThan(before[second]!);
      surface.pointer("down", 10, 80);
      surface.pointer("up", 10, 80);
      const events: unknown[] = [];
      dispatchCommandResponse(surface.take_events(), { boardEvent: event => events.push(event.value) });
      expect(events).toContainEqual({ __kitTableRow: true, index: 1, name: "杭州", row: { city: "杭州", count: 9 } });
      const after = surface.snapshot(200, 100, clock);
      expect(after[second + 1]).toBeGreaterThan(after[second + 2]!);
    } finally {
      surface.free();
    }
  });

  it("表格导入文件后可以选择新字段，修改样式时保留导入内容", () => {
    const binding = (uid: string) => ({ uid: ["c_private", "t_private", uid], summary: "none" });
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.basic.table-v3", options: { "axis-fields": [binding("f_1"), binding("f_2")] },
      privateData: { fields: [{ uid: "f_1", alias: "旧字段一" }, { uid: "f_2", alias: "旧字段二" }],
        rows: [{ f_1: "旧数据", f_2: 1 }] },
    });
    const id = handle({ type: "insertKit", nodes })!.selectedId!;
    handle({ type: "setStaticData", id, data: { columns: ["名称", "数量"], rows: [{ 名称: "新数据", 数量: 20 }] } });
    const edited = handle({ type: "patchKitOptions", id, patch: {
      "axis-fields": [binding("数量"), binding("名称")], "header-height": 40,
    } })!;
    const board = boardNodes(resolveRuntimeScene(edited.tree, {}, {}))[0]!;
    expect(board.data.columns).toEqual(["数量", "名称"]);
    expect(board.data.rows).toEqual([[20, "新数据"]]);
    expect(kitMetadata(edited.tree[0]!)?.source.type).toBe("widget.basic.table-v3");
  });

  it("导入数组行后修改表格样式，原始列名仍用于字段映射", () => {
    const binding = (uid: string) => ({ uid: ["c_private", "t_private", uid], summary: "none" });
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), { type: "widget.basic.table-v3", options: {
      "axis-fields": [binding("code"), binding("amount")], filter: true,
      "filter-condition": "data-row", "filter-data-row-num": 2,
    }, privateData: { fields: [{ uid: "code", alias: "编号" }, { uid: "amount", alias: "金额" }], rows: [] } });
    const id = handle({ type: "insertKit", nodes })!.selectedId!;
    handle({ type: "setStaticData", id, data: { columns: ["code", "amount"], rows: [["A", 3], ["B", 7]] } });
    const edited = handle({ type: "patchKitOptions", id, patch: { "header-height": 40 } })!;
    const table = boardNodes(resolveRuntimeScene(edited.tree, {}, {}))[0]!;
    expect(table.data.columns).toEqual(["编号", "金额"]);
    expect(table.data.rows).toEqual([["B", 7]]);
    const live = resolveRuntimeScene(edited.tree, { [id]: { columns: ["code", "amount"], rows: [["C", 11], ["D", 12]] } }, {});
    expect(boardNodes(live)[0]!.data.rows).toEqual([["D", 12]]);
  });

  it("图表自定义边距会改变真实 WASM 绘图区域", async () => {
    const nodes = kitNodes(entry("模板布局3D(1920X1080)"), {
      type: "widget.echarts.column", options: { size: [200, 100], legend: false, "x-display": false, "y-display": false,
        "grid-x-display": false, "grid-y-display": false, "shape-column-width": 10,
        "padding-left": "diy", "padding-left-diy": 20, "padding-right": "diy", "padding-right-diy": 20,
        "padding-top": "diy", "padding-top-diy": 0, "padding-bottom": "diy", "padding-bottom-diy": 20,
        "axis-x": [{ uid: ["name"] }], "axis-y": [{ uid: ["amount"] }],
        "series-color-cluster": { indexes: ["one"], one: { "series-color": "#ff0000" } },
      }, privateData: { fields: [{ uid: "name", type: "string" }, { uid: "amount", type: "number" }],
        rows: [{ name: "一月", amount: 10 }] },
    }, { x: 0, y: 0 });
    const inserted = handle({ type: "insertKit", nodes })!;
    const id = inserted.selectedId!;
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      const clock = encodeBoardClock(boardClock(new Date(0)));
      const snapshot = (tree: typeof nodes) => {
        surface.sync_scene(encodeBoardSync({ width: 200, height: 100, preview: true, selected: [], nodes: boardNodes(tree) }));
        return surface.snapshot(200, 100, clock);
      };
      const before = snapshot(inserted.tree);
      const changed = handle({ type: "patchKitOptions", id, patch: { "padding-top-diy": 30 } })!;
      const after = snapshot(changed.tree);
      const pixel = 8 + (200 * 10 + 100) * 4;
      expect(before[pixel]).toBeGreaterThan(after[pixel]! + 100);
    } finally {
      surface.free();
    }
  });

  it("菜单的原始皮肤进入 WASM 画布，点击改变选中项与渲染像素", async () => {
    const item = entry("菜单");
    const nodes = boardNodes(kitNodes(item, readTemplate(item), { x: 0, y: 0 }));
    const menu = nodes.find(node => node.widget.kind === "menuHorizontal")!;
    const require = createRequire(import.meta.url);
    const { PNG } = require("pngjs") as { PNG: { sync: { read: (bytes: Uint8Array) => { width: number; height: number; data: Uint8Array } } } };
    const { decodeWebp } = await import("../../scripts/lib-webp.mjs");
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    // The software renderer returns pixels directly and never uses this canvas.
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 839, height: 88, preview: true, selected: [], nodes }));
      for (const node of nodes) {
        if (node.widget.kind !== "image" || !/\.(png|webp)$/.test(node.widget.image)) continue;
        const asset = new URL(`../../public/${node.widget.image.slice(2)}`, import.meta.url);
        const bytes = readFileSync(asset);
        const image = PNG.sync.read(node.widget.image.endsWith(".png") ? bytes : await decodeWebp(bytes));
        surface.set_image(node.id, image.width, image.height, image.data);
      }
      const clock = encodeBoardClock(boardClock(new Date(0)));
      const before = surface.snapshot(839, 88, clock);
      const x = menu.x + menu.width * .3, y = menu.y + menu.height / 2;
      surface.pointer("down", x, y);
      surface.pointer("up", x, y);
      const values: unknown[] = [];
      dispatchCommandResponse(surface.take_events(), { boardEvent: event => values.push(event.value) });
      expect(values).toContain("菜单2");
      expect(surface.snapshot(839, 88, clock)).not.toEqual(before);
    } finally {
      surface.free();
    }
  });

  it("选项卡命中原始面板，切换子图层并保留当前选中项", async () => {
    const item = kitCatalog.find(item => item.id.startsWith("spring-blue-017-"))!;
    const nodes = kitNodes(item, readTemplate(item), { x: 0, y: 0 });
    const root = nodes[0]!;
    const before = resolveRuntimeScene(nodes, {}, {});
    expect(before.filter(node => node.parentId === root.id && node.visible).map(node => node.name)).toEqual(["设备类型一"]);
    const canvasNodes = boardNodes(before);
    const tabs = canvasNodes.find(node => node.data.__kitPanelTab === root.id)!;
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 460, height: 250, preview: true, selected: [], nodes: canvasNodes }));
      const x = tabs.x + tabs.width / 2, y = tabs.y + tabs.height / 2;
      surface.pointer("down", x, y);
      surface.pointer("up", x, y);
      const events: unknown[] = [];
      dispatchCommandResponse(surface.take_events(), { boardEvent: event => events.push(event) });
      expect(events).toContainEqual(expect.objectContaining({ id: root.id, value: { __kitTabIndex: 1, name: "设备类型二" } }));
      const next = resolveRuntimeScene(nodes, {}, { [root.id]: changeKitTab(undefined, 1) });
      expect(next.filter(node => node.parentId === root.id && node.visible).map(node => node.name)).toEqual(["设备类型二"]);
      expect(boardNodes(next).find(node => node.data.__kitPanelTab === root.id)?.data.__kitMenu).toMatchObject({ active: 1 });
    } finally {
      surface.free();
    }
  });

  it("原始渐变色标进入 WASM，起点和终点分别绘制对应颜色", async () => {
    const nodes = boardNodes(kitNodes(entry("大标题(1920X1080）"), {
      type: "widget.group.panel", options: { size: [100, 40], background: true,
        "background-color": { angle: "90", colors: [{ position: 0, color: "#ff0000" }, { position: 100, color: "#0000ff" }] } },
    }, { x: 0, y: 0 }));
    initSync({ module: readFileSync(new URL("../wasm/cpu/data_wind_cpu_bg.wasm", import.meta.url)) });
    const surface = await BoardCanvas.create({} as HTMLCanvasElement, false);
    try {
      surface.sync_scene(encodeBoardSync({ width: 100, height: 40, preview: true, selected: [], nodes }));
      const rgba = surface.snapshot(100, 40, encodeBoardClock(boardClock(new Date(0))));
      const left = 8 + (100 * 20 + 10) * 4, right = 8 + (100 * 20 + 90) * 4;
      expect(rgba[left]).toBeGreaterThan(rgba[left + 2]!);
      expect(rgba[right + 2]).toBeGreaterThan(rgba[right]!);
    } finally {
      surface.free();
    }
  });
});
