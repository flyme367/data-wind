import type { WidgetKind } from "./editor";

export interface MediaCatalogEntry {
  kind: WidgetKind;
  label: string;
  category: string;
}

/** 山海鲸「媒体」分类的 chips，顺序即展示顺序，「全部」始终在首位。 */
export const mediaCategories = ["全部", "默认媒体"] as const;

/** 媒体素材目录：对齐山海鲸「媒体」分类全部 7 个组件（图片/视频/监控/轮播图/轮播视频/基础PDF/音频）。
 * 顺序即素材面板展示顺序；监控的 RTSP/RTMP 浏览器无法实播（HLS/FLV 可），见 docs/media-sync.md 已知边界。 */
export const mediaCatalog: MediaCatalogEntry[] = [
  { kind: "image", label: "图片", category: "默认媒体" },
  { kind: "video", label: "视频", category: "默认媒体" },
  { kind: "monitor", label: "监控", category: "默认媒体" },
  { kind: "carousel", label: "轮播图", category: "默认媒体" },
  { kind: "carouselVideo", label: "轮播视频", category: "默认媒体" },
  { kind: "pdf", label: "基础PDF", category: "默认媒体" },
  { kind: "audio", label: "音频", category: "默认媒体" },
];

/** 有素材的分类才会显示对应 chip。 */
export const usedMediaCategories = mediaCategories.filter((category) =>
  category === "全部" || mediaCatalog.some((entry) => entry.category === category));
