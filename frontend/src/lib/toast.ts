/**
 * Semi Toast/Notification → sonner 迁移 shim。
 * 保留 Semi 的调用签名（字符串或 { content, duration } 对象、Notification.open({ id, content })），
 * 让迁移点只需改 import。sonner 的 id 语义：重复弹同 id 会替换而非堆叠。
 */
import { toast as sonner } from "sonner";

type SemiToastInput = string | { content: string; duration?: number };

const DEFAULT_DURATION_MS = 3000;

function show(kind: "success" | "info" | "warning" | "error", input: SemiToastInput) {
  const message = typeof input === "string" ? input : input.content;
  const duration = typeof input === "string" ? DEFAULT_DURATION_MS : (input.duration ?? 3) * 1000;
  sonner[kind](message, { duration });
}

export const Toast = {
  success: (input: SemiToastInput) => show("success", input),
  info: (input: SemiToastInput) => show("info", input),
  warning: (input: SemiToastInput) => show("warning", input),
  error: (input: SemiToastInput) => show("error", input),
};

export const Notification = {
  /** 常驻提示（duration: Infinity）；带 id 的可被 close 关闭或被同 id 替换。 */
  open(options: { id?: string; content: string; duration?: number; [key: string]: unknown }) {
    const { id, content, duration } = options;
    sonner.message(content, {
      id,
      duration: duration === undefined ? Infinity : duration * 1000,
    });
  },
  close(id: string) {
    sonner.dismiss(id);
  },
};
