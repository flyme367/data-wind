let host: HTMLElement | null = null;

/** 成品内 message 交互的极简提示（无 UI 框架依赖） */
export function showToast(message: string): void {
  if (!host) {
    host = document.createElement("div");
    host.className = "viewer-toast-host";
    document.body.appendChild(host);
  }
  const item = document.createElement("div");
  item.className = "viewer-toast";
  item.textContent = message;
  host.appendChild(item);
  window.setTimeout(() => {
    item.classList.add("is-leaving");
    window.setTimeout(() => item.remove(), 300);
  }, 2600);
}
