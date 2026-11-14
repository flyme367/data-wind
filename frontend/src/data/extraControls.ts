import type { SceneNode } from "../types";
import type { WidgetKind } from "./editor";

export const extraControlKinds: WidgetKind[] = ["twin2d", "checkbox", "input", "switch", "slider", "timeProgress", "colorPicker", "upload", "tree"];
export const isExtraControl = (kind: WidgetKind) => extraControlKinds.includes(kind);
const esc = (v: unknown) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const num = (v: unknown, fallback: number) => typeof v === "number" && Number.isFinite(v) ? v : fallback;
const color = (v: unknown) => /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : "#4b9eff";
const time = (v: number) => `${String(Math.floor(v / 3600)).padStart(2, "0")}:${String(Math.floor(v % 3600 / 60)).padStart(2, "0")}`;

/** Shared markup for the editor, image export and framework-free published viewer. */
export function extraControlMarkup(node: SceneNode): string {
  const w = node.widget!, d = node.data ?? {}, label = esc(w.text);
  if (w.kind === "checkbox" || w.kind === "switch") return `<label class="extra-toggle ${w.kind}"><input type="checkbox" ${d.checked === true ? "checked" : ""} ${w.kind === "switch" ? 'role="switch"' : ""} aria-label="${label}"><span class="extra-toggle-indicator"></span><span>${label}</span></label>`;
  if (w.kind === "input") return `<input class="extra-input" type="text" aria-label="${label}" placeholder="${label}" value="${esc(d.value)}">`;
  if (w.kind === "slider" || w.kind === "timeProgress") {
    const min = num(d.min, 0), max = Math.max(min + 1, num(d.max, w.kind === "slider" ? 100 : 86400));
    const value = Math.min(max, Math.max(min, num(d.value, w.kind === "slider" ? 50 : 43200)));
    const step = Math.max(.001, num(d.step, w.kind === "slider" ? 1 : 60));
    return `<div class="extra-slider"><input type="range" aria-label="${label}" min="${min}" max="${max}" step="${step}" value="${value}"><output>${w.kind === "timeProgress" ? time(value) : value}</output></div>`;
  }
  if (w.kind === "colorPicker") return `<div class="extra-color"><input type="color" aria-label="${label}" value="${color(d.value)}"><output>${color(d.value)}</output></div>`;
  if (w.kind === "upload") return `<label class="extra-upload"><span>↑ ${label}</span><input type="file" aria-label="${label}" ${d.multiple === true ? "multiple" : ""} accept="${esc(d.accept)}"><output>未选择文件</output></label>`;
  if (w.kind === "tree") {
    const items = Array.isArray(d.items) ? d.items.slice(0, 30) : [];
    const rows = (items as unknown[]).map(item => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : { label: item };
      const children = Array.isArray(row.children) ? row.children.slice(0, 30) : [];
      return `<li><details open><summary>${esc(row.label)}</summary><ul>${children.map(child => `<li><button type="button" data-choice="${esc(typeof child === "object" && child ? (child as Record<string, unknown>).label : child)}">${esc(typeof child === "object" && child ? (child as Record<string, unknown>).label : child)}</button></li>`).join("")}</ul></details></li>`;
    }).join("");
    return `<ul class="extra-tree" aria-label="${label}">${rows}</ul>`;
  }
  if (w.kind === "twin2d") {
    const zones = Array.isArray(d.zones) ? d.zones.slice(0, 50) : [];
    return `<div class="extra-twin" aria-label="${label}"><svg viewBox="0 0 600 360" preserveAspectRatio="xMidYMid meet" role="group" aria-label="${label}"><rect width="600" height="360" fill="#101f30"/><path d="M20 20h560v320H20z" fill="none" stroke="#59728d" stroke-width="2"/>${zones.map((item, i) => {
      const z = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const x = Math.max(0, Math.min(580, num(z.x, 30))), y = Math.max(0, Math.min(340, num(z.y, 30)));
      const width = Math.max(10, Math.min(600 - x, num(z.width, 100))), height = Math.max(10, Math.min(360 - y, num(z.height, 80)));
      return `<g data-choice="${esc(z.label ?? `区域${i + 1}`)}" tabindex="0" role="button" aria-label="${esc(z.label)}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="3" fill="${color(z.color)}" fill-opacity=".45" stroke="${color(z.color)}"/><text x="${x + width / 2}" y="${y + height / 2}" text-anchor="middle" fill="#e3f0ff" font-size="16">${esc(z.label)}</text></g>`;
    }).join("")}</svg><output>点击区域查看</output></div>`;
  }
  return "";
}

/** Native controls remain usable in both rendering paths. Values are runtime-only. */
export function bindExtraControl(root: HTMLElement, node: SceneNode): () => void {
  const handler = (event: Event) => {
    const target = event.target as HTMLInputElement | HTMLElement;
    if (event.type === "click" || event.type === "keydown") event.stopPropagation();
    if (event.type === "keydown" && target.hasAttribute("data-choice") && !["Enter", " "].includes((event as KeyboardEvent).key)) return;
    let value: unknown;
    if (target instanceof HTMLInputElement) {
      value = target.type === "checkbox" ? target.checked : target.type === "file" ? Array.from(target.files ?? []).map(file => file.name) : target.value;
      const output = root.querySelector("output");
      if (output && target.type === "range") output.textContent = node.widget?.kind === "timeProgress" ? time(Number(target.value)) : target.value;
      if (output && target.type === "color") output.textContent = target.value;
      if (output && target.type === "file") output.textContent = (value as string[]).join("、") || "未选择文件";
      if (event.type === "change" && target.type === "file" && target.files?.length && node.data?.uploadUrl) {
        try {
          const url = new URL(String(node.data.uploadUrl), document.baseURI);
          if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("上传地址无效");
          const body = new FormData();
          for (const file of target.files) body.append("files", file);
          if (output) output.textContent = "正在上传…";
          void fetch(url, { method: "POST", body, credentials: "omit" }).then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            if (output) output.textContent = "上传成功";
          }).catch(() => { if (output) output.textContent = "上传失败，请检查地址与跨域设置"; });
        } catch { if (output) output.textContent = "上传地址无效"; }
      }
    } else {
      const choice = target.closest<HTMLElement>("[data-choice]");
      if (!choice || (event.type !== "click" && event.type !== "keydown")) return;
      value = choice.dataset.choice;
      root.querySelectorAll("[data-choice].active").forEach(el => el.classList.remove("active"));
      choice.classList.add("active");
      if (node.widget?.kind === "twin2d") { const output = root.querySelector("output"); if (output) output.textContent = String(value); }
    }
    if (event.type === "input" || event.type === "change" || !(target instanceof HTMLInputElement)) {
      root.dispatchEvent(new CustomEvent("dw:control-change", { bubbles: true, detail: { id: node.id, kind: node.widget?.kind, value } }));
    }
  };
  for (const type of ["click", "keydown", "input", "change"]) root.addEventListener(type, handler);
  return () => { for (const type of ["click", "keydown", "input", "change"]) root.removeEventListener(type, handler); };
}
