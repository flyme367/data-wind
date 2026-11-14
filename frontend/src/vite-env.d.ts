/// <reference types="vite/client" />

/** 底部状态栏展示的应用版本（vite define 注入，见 vite.config.ts）。 */
declare const __DW_VERSION__: string;

/** frontend/scripts/lib-webp.mjs（webp 最小压缩编码规范，见 dw-images-webp-policy）。 */
declare module "*/lib-webp.mjs" {
  /** PNG 字节 → 最小体积 webp 字节（q60 有损/无损取小者）。 */
  export function encodeMinWebp(png: Uint8Array): Promise<Uint8Array>;
  /** 在 path 处写入最小压缩 webp。 */
  export function writeMinWebp(path: string, png: Uint8Array): Promise<void>;
  /** webp 字节 → PNG 文件字节（dwebp 解码，供 pngjs 等消费）。 */
  export function decodeWebp(webp: Uint8Array): Promise<Uint8Array>;
  /** 无扩展名路径读源图：webp 优先，兼容遗留 png 直读。 */
  export function readImagePng(stem: string): Promise<Uint8Array>;
}
