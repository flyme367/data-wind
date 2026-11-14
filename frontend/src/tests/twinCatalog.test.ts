import { describe, expect, it } from "vitest";
import { templates, twinCatalog } from "../data/catalog";
import { createTemplateScene } from "../data/sceneTemplates";

describe("锦绣孪生目录（山海鲸鲸孪生同步）", () => {
  it("references valid templates with names, thumbnails and sizes", () => {
    expect(twinCatalog.length).toBeGreaterThanOrEqual(12);
    for (const entry of twinCatalog) {
      const template = templates.find((t) => t.id === entry.id);
      expect(template).toBe(entry);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.image).toMatch(/^\/(reference|models)\//);
      expect(entry.size).toMatch(/MB|KB|本地/);
    }
  });

  it("keeps template ids and labels unique", () => {
    expect(new Set(twinCatalog.map((entry) => entry.id)).size).toBe(twinCatalog.length);
    expect(new Set(twinCatalog.map((entry) => entry.name)).size).toBe(twinCatalog.length);
  });

  it("creates insertable scenes for every twin template", () => {
    for (const entry of twinCatalog) {
      expect(Array.isArray(createTemplateScene(entry.id))).toBe(true);
    }
    // 空场景与山海鲸「3D空场景」一致：插入后为空地面
    expect(createTemplateScene("empty")).toEqual([]);
  });
});
