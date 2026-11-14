import { useEffect, useRef, useState } from "react";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Slider } from "./ui/slider";
import { NumberInput } from "./ui-ext/number-input";
import { cn } from "cn";
import type { Vec3 } from "../types";

export function Field({label,children}:{label:string;children?:React.ReactNode}) {return <div className="property-field"><label>{label}</label>{children}</div>}
/** 三维向量字段：每轴一行「标签 + 定宽输入框贴右」，与面板其它配置行同构（山海鲸式两栏）。 */
export function AxisRow({label,value,step=.5,disabled=false,onChange}:{label:string;value:Vec3;step?:number;disabled?:boolean;onChange:(axis:keyof Vec3,value:number)=>void}) {
  return <>{(["x","y","z"] as const).map(axis=><div className="property-field" key={axis}>
    <label>{label} {axis.toUpperCase()}</label>
    <NumberInput size="small" aria-label={`${label}${axis.toUpperCase()}`} disabled={disabled} step={step} precision={2}
      value={value[axis]} onChange={next=>{if(typeof next==="number"&&Number.isFinite(next)&&Math.abs(next-value[axis])>=.005)onChange(axis,next)}}/>
  </div>)}</>;
}

/** 项目内颜色统一为 #RRGGBB / #RRGGBBAA；非法值（transparent 等）回退为全透明。 */
function toHex8(value: string): string {
  return /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value) ? value : "#00000000";
}
function hex8Parts(hex: string): { rgb: string; alpha: number } {
  const body = hex.slice(1);
  return { rgb: `#${body.slice(0, 6)}`, alpha: body.length === 8 ? parseInt(body.slice(6, 8), 16) / 255 : 1 };
}
function withAlpha(rgb: string, alpha: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, "0");
  return `${rgb}${byte}`;
}
/** 颜色字段：棋盘格透明底触发器 + 弹出取色面板（原生取色器 + Alpha 滑块），onChange 回吐 #RRGGBBAA。 */
export function ColorField({label,value,onChange,disabled=false}:{label:string;value:string;onChange:(value:string)=>void;disabled?:boolean}) {
  const hex = toHex8(value);
  const { rgb, alpha } = hex8Parts(hex);
  const [draftRgb, setDraftRgb] = useState(rgb);
  useEffect(() => setDraftRgb(rgb), [rgb]);
  const swatch = value === "transparent" ? "transparent" : hex;
  return <Field label={label}><span className="property-color">
    <Popover>
      <PopoverTrigger asChild disabled={disabled}>
        <span className="property-color-trigger" role="button" aria-label={label}>
          <span className="property-color-fill" style={{ background: swatch }}/>
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 space-y-2">
        <div className="flex items-center gap-2">
          <input type="color" aria-label={`${label} 取色`} className="size-8 shrink-0 cursor-pointer rounded border border-border bg-transparent"
            value={/^#[0-9a-f]{6}$/i.test(draftRgb) ? draftRgb : "#000000"}
            onChange={event => { setDraftRgb(event.target.value); onChange(withAlpha(event.target.value, alpha)); }} />
          <Input aria-label={`${label} Hex`} className="h-7 font-mono text-xs" value={draftRgb}
            onChange={event => setDraftRgb(event.target.value)}
            onBlur={() => { if (/^#[0-9a-f]{6}$/i.test(draftRgb)) onChange(withAlpha(draftRgb, alpha)); else setDraftRgb(rgb); }}
            onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">透明度</span>
          <Slider aria-label={`${label} 透明度`} className="flex-1" min={0} max={100} step={1}
            value={[Math.round(alpha * 100)]}
            onValueChange={values => { const next = Array.isArray(values) ? values[0] : values; onChange(withAlpha(/^#[0-9a-f]{6}$/i.test(draftRgb) ? draftRgb : rgb, next / 100)); }} />
          <span className="w-9 text-right font-mono text-xs">{Math.round(alpha * 100)}%</span>
        </div>
      </PopoverContent>
    </Popover>
    <span className="property-color-value">{value}</span>
  </span></Field>;
}
/** 山海鲸式单值数字字段（位置 X/Y、宽高、角度、阴影偏移等），min/max 省略时不限制。 */
export function NumberField({label,value,min,max,step=1,disabled=false,onChange}:{label:string;value:number;min?:number;max?:number;step?:number;disabled?:boolean;onChange:(value:number)=>void}) {
  return <Field label={label}><NumberInput size="small" aria-label={label} min={min} max={max} step={step} disabled={disabled} value={value} onChange={next=>{if(typeof next==="number"&&Number.isFinite(next))onChange(next)}}/></Field>
}

/** Keep rapid text input responsive while worker snapshots arrive asynchronously. */
export function BufferedInput({ label, value, onChange, placeholder, disabled = false }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(value); }, [value]);
  return <Input aria-label={label} value={draft} placeholder={placeholder} disabled={disabled}
    onFocus={() => { focused.current = true; }}
    onChange={(event) => { setDraft(event.target.value); onChange(event.target.value); }}
    onBlur={() => { focused.current = false; if (draft !== value) onChange(draft); }} />;
}
