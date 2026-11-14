/**
 * Semi Toast/Notification → shadcn(Base UI) toast 迁移 shim。
 * 保留 Semi 的调用签名（字符串或 { content, duration } 对象、Notification.open({ id, content })），
 * 让迁移点只需改 import；底层用 shadcn toast 组件的 Base UI toast manager（skill 规范：Base 项目用 toast 组件）。
 * 同 id 重复 add 会原地更新而非堆叠。
 */
import { toast as manager } from "@/components/ui/toast";

type SemiToastInput = string | { content: string; duration?: number };

const DEFAULT_TIMEOUT_MS = 3000;

function show(kind: "success" | "info" | "warning" | "error", input: SemiToastInput) {
  const title = typeof input === "string" ? input : input.content;
  const timeout = typeof input === "string" ? DEFAULT_TIMEOUT_MS : (input.duration ?? 3) * 1000;
  manager.add({ title, type: kind, timeout });
}

export const Toast = {
  success: (input: SemiToastInput) => show("success", input),
  info: (input: SemiToastInput) => show("info", input),
  warning: (input: SemiToastInput) => show("warning", input),
  error: (input: SemiToastInput) => show("error", input),
};

export const Notification = {
  /** 常驻提示（duration 缺省或 0 = 不自动消失）；带 id 的可被 close 关闭或被同 id 原地更新。 */
  open(options: { id?: string; content: string; duration?: number; [key: string]: unknown }) {
    const { id, content, duration } = options;
    manager.add({
      id,
      title: content,
      timeout: duration === undefined || duration === 0 ? 0 : duration * 1000,
    });
  },
  close(id: string) {
    manager.close(id);
  },
};
