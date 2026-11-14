import { describe, expect, it } from "vitest";
import { widgetLabels, widgetNode } from "../data/editor";
import { mediaCatalog, mediaCategories, usedMediaCategories } from "../data/mediaCatalog";

describe("山海鲸「媒体」组件目录", () => {
  it("覆盖全部 7 个组件且顺序对齐山海鲸素材面板", () => {
    expect(mediaCatalog.map((entry) => entry.kind)).toEqual([
      "image", "video", "monitor", "carousel", "carouselVideo", "pdf", "audio",
    ]);
    expect(usedMediaCategories).toEqual(mediaCategories);
    for (const entry of mediaCatalog) expect(widgetLabels[entry.kind]).toBeTruthy();
  });

  it("视频 / 轮播视频 / 监控 / PDF 预设面向大屏播放", () => {
    const video = widgetNode("video");
    expect(video.data).toMatchObject({ autoplay: true, loop: true, muted: true, playbackRate: 1, hideControls: false });
    expect(video.boxSize).toMatchObject({ x: 480, y: 270 });
    expect(widgetNode("carouselVideo").data).toMatchObject({ urls: [], autoplay: true, loop: true, playMode: "pauseResume" });
    expect(widgetNode("monitor").data).toMatchObject({ src: "", protocol: "hls", showControls: true, destroyDelay: 10, muted: true });
    expect(widgetNode("pdf").data).toMatchObject({ src: "", clickNext: false, buttonSize: 28 });
  });

  it("轮播图默认对齐山海鲸（停留 3 秒 / 平移动画 / 常显示箭头）", () => {
    const carousel = widgetNode("carousel");
    expect(carousel.data).toMatchObject({ interval: 3, objectFit: "stretch", playAnimation: true, animType: "slide", arrows: "always" });
    expect(carousel.boxSize).toMatchObject({ x: 480, y: 270 });
    expect(widgetNode("audio").data).toMatchObject({ volume: 100, loop: true, autoplay: false });
    expect(widgetNode("audio").boxSize).toMatchObject({ x: 360, y: 72 });
  });
});
