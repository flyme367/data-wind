import { getState } from "../state/store";
import { getSceneBridge } from "../workers/bridge";
import { downloadFile } from "../state/projects";
import { canvasPng, captureSceneFrame } from "./captureFrame";
import { captureBoardWidgets } from "./boardCapture";

/** Rust 场景帧 + 看板组件快照合成到一张画布（含画板底色）。 */
async function composeBoardCanvas(width: number, height: number): Promise<HTMLCanvasElement> {
  const state = getState();
  const [scene, overlay] = await Promise.all([
    captureSceneFrame({ width, height }), captureBoardWidgets({ width, height }),
  ]);
  const output = document.createElement("canvas"); output.width = width; output.height = height;
  const context = output.getContext("2d");
  if (!context) throw new Error("当前浏览器无法创建导出画布");
  context.fillStyle = state.settings.boardColor;
  context.fillRect(0, 0, width, height);
  context.drawImage(scene, 0, 0, width, height);
  context.drawImage(overlay, 0, 0, width, height);
  return output;
}

/** Compose the scene with a Rust-rendered component snapshot, preserving live control values. */
export async function exportBoardPng(): Promise<{ embeddedPages: boolean }> {
  const projectId = getState().projectId;
  if (!projectId) throw new Error("项目尚未加载完成");
  await getSceneBridge().checkpoint(projectId);
  if (getState().projectId !== projectId) throw new Error("项目已切换，请重新导出");
  const { width, height } = getState().boardSize;
  if (width * height > 16_777_216) throw new Error("PNG 导出最多支持 1600 万像素，请缩小看板尺寸");
  const output = await composeBoardCanvas(width, height);
  downloadFile("可视化看板.png", await canvasPng(output), "image/png");
  return { embeddedPages: false };
}

/** 山海鲸「组件封面」：截取单个看板组件区域为封面 dataURL（等比缩到 maxWidth 内）。 */
export async function captureWidgetCover(nodeId: string, maxWidth = 320): Promise<string> {
  const projectId = getState().projectId;
  if (!projectId) throw new Error("项目尚未加载完成");
  const node = getState().scene.find((item) => item.id === nodeId);
  if (!node?.widget || !node.boxSize) throw new Error("请先选择看板组件");
  const { width, height } = getState().boardSize;
  const composed = await composeBoardCanvas(width, height);
  const sx = node.transform.position.x, sy = node.transform.position.y;
  const sw = node.boxSize.x, sh = node.boxSize.y;
  if (sw <= 0 || sh <= 0) throw new Error("组件尺寸无效");
  const scale = Math.min(1, maxWidth / sw);
  const thumb = document.createElement("canvas");
  thumb.width = Math.max(1, Math.round(sw * scale));
  thumb.height = Math.max(1, Math.round(sh * scale));
  const context = thumb.getContext("2d");
  if (!context) throw new Error("当前浏览器无法创建封面画布");
  context.drawImage(composed, sx, sy, sw, sh, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL("image/jpeg", 0.82);
}

/** 山海鲸「封面设置 › 截屏」：整块看板等比缩略为封面 dataURL（JPEG 压缩控制体积）。 */
export async function captureBoardCover(maxWidth = 480): Promise<string> {
  const projectId = getState().projectId;
  if (!projectId) throw new Error("项目尚未加载完成");
  await getSceneBridge().checkpoint(projectId);
  if (getState().projectId !== projectId) throw new Error("项目已切换，请重新截屏");
  const { width, height } = getState().boardSize;
  const composed = await composeBoardCanvas(width, height);
  const scale = Math.min(1, maxWidth / width);
  const thumb = document.createElement("canvas");
  thumb.width = Math.max(1, Math.round(width * scale));
  thumb.height = Math.max(1, Math.round(height * scale));
  const context = thumb.getContext("2d");
  if (!context) throw new Error("当前浏览器无法创建封面画布");
  context.drawImage(composed, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL("image/jpeg", 0.82);
}
