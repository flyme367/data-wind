import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { closeContextMenu, getContextMenu } from "../state/contextMenu";

export type ContextMenuItem =
  | { type: "item"; key: string; label: string; icon?: ReactNode; disabled?: boolean; danger?: boolean; action?: () => void }
  | { type: "sep"; key: string }
  | { type: "sub"; key: string; label: string; icon?: ReactNode; disabled?: boolean; items: ContextMenuItem[] };

/** 单层菜单列表；子菜单复用自身渲染，hover 展开，越界自动向左/向上翻转 */
function MenuList({ items }: { items: ContextMenuItem[] }) {
  const [openSub, setOpenSub] = useState<string | null>(null);
  const [flip, setFlip] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });
  const rowRef = useRef<HTMLDivElement | null>(null);
  const enterSub = (key: string, disabled?: boolean) => {
    if (disabled) return;
    setOpenSub(key);
    const rect = rowRef.current?.getBoundingClientRect();
    if (rect) setFlip({ x: rect.right + 208 > window.innerWidth && rect.left > 208, y: rect.bottom + 180 > window.innerHeight && rect.top > 180 });
  };
  const subStyle: CSSProperties = flip.x
    ? { right: "calc(100% + 2px)", ...(flip.y ? { bottom: 0 } : { top: -5 }) }
    : { left: "calc(100% + 2px)", ...(flip.y ? { bottom: 0 } : { top: -5 }) };
  return <div className="dw-context-menu" role="menu">
    {items.map((item) => {
      if (item.type === "sep") return <div key={item.key} className="dw-context-sep" role="separator" />;
      if (item.type === "sub") {
        return <div key={item.key} ref={openSub === item.key ? rowRef : undefined}
          className={`dw-context-item is-sub ${item.disabled ? "is-disabled" : ""}`}
          onMouseEnter={() => enterSub(item.key, item.disabled)}
          onClick={(event) => { event.stopPropagation(); if (!item.disabled) enterSub(item.key); }}>
          {item.icon && <span className="dw-context-icon">{item.icon}</span>}
          <span className="dw-context-label">{item.label}</span>
          <ChevronRight size={13} className="dw-context-arrow" />
          {openSub === item.key && item.items.length > 0 && <div className="dw-context-sub" style={subStyle}><MenuList items={item.items} /></div>}
        </div>;
      }
      return <button key={item.key} type="button" role="menuitem" disabled={item.disabled}
        className={`dw-context-item ${item.danger ? "is-danger" : ""} ${item.disabled ? "is-disabled" : ""}`}
        onClick={(event) => { event.stopPropagation(); if (item.disabled) return; closeContextMenu(); item.action?.(); }}>
        {item.icon && <span className="dw-context-icon">{item.icon}</span>}
        <span className="dw-context-label">{item.label}</span>
      </button>;
    })}
  </div>;
}

/** 固定定位在鼠标处的深色右键菜单；外点 / Escape / 滚动 / 缩放关闭，越界自动收进视口 */
export default function ContextMenu({ x, y, items }: { x: number; y: number; items: ContextMenuItem[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<CSSProperties>({ left: x, top: y, visibility: "hidden" });
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)),
    });
  }, [x, y, items]);
  useLayoutEffect(() => {
    // session 令牌：右键打开新菜单时旧菜单的关闭监听仍挂在 window 上，若不校验会把同一次右键里刚打开的菜单秒关。
    // 只有「自己仍是当前菜单」时才允许关闭；宿主按 session 作 key 重挂载，每次打开都是全新监听。
    const session = getContextMenu()?.session;
    const guarded = (closeFn: () => void) => () => { const cur = getContextMenu(); if (cur && cur.session === session) closeFn(); };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      guarded(closeContextMenu)();
    };
    const close = guarded(closeContextMenu);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") guarded(closeContextMenu)(); };
    // 延后到下一个 tick 再挂关闭监听：菜单常在 contextmenu 事件内同步打开，
    // 立即监听会把这次打开事件本身当成"外部右键"而立刻自关
    const timer = window.setTimeout(() => {
      window.addEventListener("pointerdown", outside, true);
      window.addEventListener("contextmenu", close);
      window.addEventListener("keydown", escape);
      window.addEventListener("resize", close);
      window.addEventListener("scroll", close, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, []);
  return <div ref={ref} className="dw-context-root" style={pos} onPointerDown={(event) => event.stopPropagation()}
    onContextMenu={(event) => event.preventDefault()}>
    <MenuList items={items} />
  </div>;
}
