import { afterEach, describe, expect, it, vi } from "vitest";
import { kitCatalog, kitNodes } from "../data/kitCatalog";
import { RustBoardHost } from "../engine/boardCanvas";
import { boardNodes, type RustBoardNode } from "../engine/boardScene";

afterEach(() => vi.unstubAllGlobals());

describe("套件图片展示动画", () => {
  it("在延迟后播放逆时针动画，循环间隔恢复原图并再次播放", () => {
    class ImageStub { naturalWidth = 100; naturalHeight = 100; }
    vi.stubGlobal("HTMLImageElement", ImageStub);
    const rotate = vi.fn(), upload = vi.fn(), setImage = vi.fn();
    const context = { clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate,
      drawImage: vi.fn(), getImageData: () => ({ width: 100, height: 100, data: new Uint8ClampedArray(4) }), filter: "" };
    const host = Object.assign(Object.create(RustBoardHost.prototype), {
      decodeCanvas: { width: 0, height: 0, getContext: () => context },
      surface: { set_image: setImage }, uploadPixels: upload, dirty: false,
    }) as { compositeImageAnimation(node: RustBoardNode, resource: object, now: number): void };
    const [source] = kitNodes(kitCatalog[0]!, { type: "widget.basic.image", options: {
      size: [100, 100], "animation-display": true, "animation-type": "anti-clockwise",
      "animation-delay": 1, "animation-duration": 1, "animation-loop": true,
      "animation-interval": 0.5, "animation-easing": "none", contrast: 1.5,
    } });
    const node = boardNodes([source!], true)[0]!;
    expect(node.data).toMatchObject({ playAnimation: true, animType: "rotateReverse",
      animDelay: 1, animDuration: 1, animLoop: true, animInterval: 0.5, easing: "none" });
    const resource = { element: new ImageStub(), settled: true };
    host.compositeImageAnimation(node, resource, 0);
    host.compositeImageAnimation(node, resource, 500);
    expect(setImage).not.toHaveBeenCalled();
    host.compositeImageAnimation(node, resource, 1500);
    expect(rotate).toHaveBeenLastCalledWith(-Math.PI);
    expect(context.filter).toContain("contrast(1.5)");
    expect(setImage).toHaveBeenCalledTimes(1);
    host.compositeImageAnimation(node, resource, 2100);
    expect(upload).toHaveBeenCalledTimes(1);
    host.compositeImageAnimation(node, resource, 2600);
    expect(setImage).toHaveBeenCalledTimes(2);
  });
});
