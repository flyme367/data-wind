import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "cn";

/**
 * Semi InputNumber 的 shadcn 替代（ui-ext）。保持 Semi 原有 props 签名：
 * value/onChange(number|string)/min/max/step/precision/suffix/size/hideButtons/disabled。
 * 无可见步进按钮（等同 Semi 的 hideButtons），↑/↓ 方向键按 step 调整；失焦或回车时 clamp + precision 提交。
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  precision,
  suffix,
  size = "default",
  hideButtons,
  disabled,
  placeholder,
  className,
  "aria-label": ariaLabel,
}: {
  value?: number | string;
  onChange?: (value: number | string) => void;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  suffix?: string;
  size?: "small" | "default";
  hideButtons?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value : "";
  const [text, setText] = useState(numeric);
  const focused = useRef(false);

  useEffect(() => { if (!focused.current) setText(numeric); }, [numeric]);

  const clampRound = (raw: number): number => {
    let next = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, raw));
    if (precision !== undefined) next = Number(next.toFixed(precision));
    return next;
  };

  const commit = (draft: string) => {
    const trimmed = draft.trim();
    if (!trimmed || !Number.isFinite(Number(trimmed))) {
      if (trimmed !== "" && typeof value === "number") setText(String(value));
      onChange?.(trimmed === "" ? "" : Number(trimmed));
      return;
    }
    const next = clampRound(Number(trimmed));
    setText(String(next));
    onChange?.(next);
  };

  const nudge = (direction: 1 | -1) => {
    const base = Number(text) === Number(text) && text.trim() !== "" ? Number(text) : (typeof value === "number" ? value : 0);
    const next = clampRound(base + direction * step);
    setText(String(next));
    onChange?.(next);
  };

  return (
    <span className={cn("relative inline-flex w-full items-center", className)}>
      <Input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        className={cn(size === "small" && "h-7 text-xs", suffix && "pr-7")}
        onFocus={() => { focused.current = true; }}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => { focused.current = false; commit(text); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") { event.preventDefault(); nudge(1); }
          else if (event.key === "ArrowDown") { event.preventDefault(); nudge(-1); }
          else if (event.key === "Enter") { event.currentTarget.blur(); }
        }}
      />
      {suffix && <span className="pointer-events-none absolute right-2 text-xs text-muted-foreground">{suffix}</span>}
    </span>
  );
}
