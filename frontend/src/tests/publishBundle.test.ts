import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultEditorSettings, widgetNode } from "../data/editor";
import { primitiveNode } from "../engine/primitives";
import { handle } from "../workers/sceneModel";
import { buildPublishBundle } from "../publish/exportBundle";
import { kitCatalog, kitNodes } from "../data/kitCatalog";
import type { SceneNode } from "../types";

const fixture = vi.hoisted(() => ({ tree: [] as unknown[] }));
vi.mock("../state/projects", () => ({
  downloadFile: vi.fn(),
  readScene: () => fixture.tree,
  readBoardSize: () => ({ width: 1920, height: 1080 }),
  readProjectParams: () => ({ base: 100 }),
  // boardMedia 遍历 boardStates/boardPages 等完整字段，mock 必须返回带默认值的完整设置
  readEditorSettings: () => structuredClone(defaultEditorSettings),
}));

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("portable publishing", () => {
  it("leaves weather credentials out of public files by default and includes them on explicit selection", async () => {
    fixture.tree = kitNodes({ ...kitCatalog[0]!, thumbnail: "" }, { type: "widget.basic.weather-v2",
      options: { "map-key": ["weather-key"] }, statesOptions: { preview: { "map-key": ["state-key"] } } });
    vi.stubEnv("DEV", false);
    vi.stubGlobal("window", { location: new URL("https://example.test/editor.html") });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html></html>", { headers: { "content-type": "text/html" } })));
    const readProject = async (include?: boolean) => new TextDecoder().decode(
      (await buildPublishBundle("publish", "测试", include)).files["project.json"]);
    expect(await readProject()).not.toMatch(/weather-key|state-key/);
    expect(await readProject(true)).toMatch(/weather-key[\s\S]+state-key/);
    expect(JSON.stringify(fixture.tree)).toContain("weather-key");
  });

  it("collects both Wasm builds and the Rayon worker graph under a deployment subdirectory", async () => {
    fixture.tree = [];
    vi.stubEnv("DEV", false);
    vi.stubGlobal("window", { location: new URL("https://example.test/installation/index.html") });
    const assets: Record<string, [string, string]> = {
      "viewer.html": ['<script src="./assets/viewer.js"></script>', "text/html"],
      "assets/viewer.js": ['import "./portable.js"; import("./parallel.js");', "application/javascript"],
      "assets/portable.js": ['new URL("./portable.wasm", import.meta.url)', "application/javascript"],
      "assets/parallel.js": ['new URL("./parallel.wasm", import.meta.url); new Worker(new URL("./worker.js", import.meta.url))', "application/javascript"],
      "assets/worker.js": ['import "./parallel-worker.js"', "application/javascript"],
      "assets/parallel-worker.js": ['new URL("./parallel.wasm", import.meta.url)', "application/javascript"],
      "assets/portable.wasm": ["portable", "application/wasm"],
      "assets/parallel.wasm": ["parallel", "application/wasm"],
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const [text, type] = assets[new URL(url).pathname.replace("/installation/", "")] ?? ["missing", "text/html"];
      return new Response(text, { headers: { "content-type": type } });
    }));
    const { files } = await buildPublishBundle("publish", "Rayon");
    for (const path of Object.keys(assets).filter((path) => path !== "viewer.html")) {
      expect(files[path], path).toBeDefined();
    }
    expect(files["index.html"]).toBeDefined();
  });

  it("includes embedded meshes and map boundaries without requesting a catalog mesh", async () => {
    handle({ type: "openProject", projectId: "publish", tree: [], template: "empty" });
    handle({ type: "add", node: primitiveNode("sphere") });
    fixture.tree = handle({ type: "add", node: widgetNode("mapPoint") })!.tree;
    vi.stubEnv("DEV", false);
    vi.stubGlobal("window", { location: new URL("https://example.test/installation/editor.html") });
    const fetcher = vi.fn(async (url: string | URL) => {
      const path = new URL(url).pathname;
      if (path.endsWith("viewer.html")) return new Response("<html><body>viewer</body></html>", { headers: { "content-type": "text/html" } });
      if (path.endsWith("ne_110m_admin_0_countries.geojson")) return new Response('{"features":[]}', { headers: { "content-type": "application/json" } });
      return new Response("missing", { status: 404 });
    });
    vi.stubGlobal("fetch", fetcher);
    const bundle = await buildPublishBundle("publish", "测试");
    expect(bundle.files["gis/ne_110m_admin_0_countries.geojson"]).toBeDefined();
    const project = JSON.parse(new TextDecoder().decode(bundle.files["project.json"])) as {
      scene: SceneNode[]; params: Record<string, unknown>;
    };
    expect(project.scene.find((item) => item.type === "model")?.customMesh?.bytes).toBeTruthy();
    expect(project.params).toEqual({ base: 100 });
    expect(fetcher.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/installation/viewer.html", "/installation/gis/ne_110m_admin_0_countries.geojson",
    ]);
  });

  it("reports missing non-embedded model assets", async () => {
    handle({ type: "openProject", projectId: "publish", tree: [], template: "empty" });
    const invalid = handle({ type: "add", node: { type: "model" } })!.tree[0]!;
    fixture.tree = [{ ...invalid, modelId: "missing-test-model" }];
    vi.stubEnv("DEV", false);
    vi.stubGlobal("window", { location: new URL("https://example.test/editor.html") });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html></html>", { headers: { "content-type": "text/html" } })));
    await expect(buildPublishBundle("publish", "测试")).rejects.toThrow(/不在素材库/);
  });
});
