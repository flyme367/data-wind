import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../data/modelCatalog", () => ({
  modelAssetById: new Map(["a", "b", "c", "oversized"].map((id) => [id, { id, name: id, mesh: `/${id}` }])),
}));

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("model byte cache", () => {
  it("shares pending requests and retries after a failed fetch", async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn()
      .mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(new Response(new Uint8Array([7])));
    vi.stubGlobal("fetch", fetcher);
    const { loadModelBuffer } = await import("../engine/modelLibrary");
    const first = loadModelBuffer("a");
    const second = loadModelBuffer("a");
    expect(fetcher).toHaveBeenCalledTimes(1);
    finish(new Response(null, { status: 500 }));
    await expect(first).rejects.toThrow();
    await expect(second).rejects.toThrow();
    expect((await loadModelBuffer("a")).bytes[0]).toBe(7);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used bytes and does not retain oversized meshes", async () => {
    const fetcher = vi.fn(async (url: string) => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer((url.endsWith("oversized") ? 65 : 24) * 1024 * 1024),
    }));
    vi.stubGlobal("fetch", fetcher);
    const { loadModelBuffer } = await import("../engine/modelLibrary");
    await loadModelBuffer("a");
    await loadModelBuffer("b");
    await loadModelBuffer("a");
    await loadModelBuffer("c");
    await loadModelBuffer("a");
    expect(fetcher).toHaveBeenCalledTimes(3);
    await loadModelBuffer("b");
    expect(fetcher).toHaveBeenCalledTimes(4);
    await loadModelBuffer("oversized");
    await loadModelBuffer("oversized");
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
});
