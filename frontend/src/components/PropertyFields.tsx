import { ColorPicker, Input, InputNumber } from "@douyinfe/semi-ui";
import { useEffect, useRef, useState } from "react";
import type { Vec3 } from "../types";

/** 项目内颜色统一为 #RRGGBB / #RRGGBBAA；ColorPicker 只接受合法 hex，transparent 等回退为全透明。 */
function toPickerColor(value: string): string {
  return /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value) ? value : "#00000000";
}
export function Field({label,children}:{label:string;children?:React.ReactNode}) {return <div className="property-field"><label>{label}</label>{children}</div>}
/** 三维向量字段：每轴一行「标签 + 定宽输入框贴右」，与面板其它配置行同构（山海鲸式两栏）。 */
export function AxisRow({label,value,step=.5,disabled=false,onChange}:{label:string;value:Vec3;step?:number;disabled?:boolean;onChange:(axis:keyof Vec3,value:number)=>void}) {
  return <>{(["x","y","z"] as const).map(axis=><div className="property-field" key={axis}>
    <label>{label} {axis.toUpperCase()}</label>
    <InputNumber size="small" hideButtons aria-label={`${label}${axis.toUpperCase()}`} disabled={disabled} step={step} precision={2}
      value={value[axis]} onChange={next=>{if(typeof next==="number"&&Number.isFinite(next)&&Math.abs(next-value[axis])>=.005)onChange(axis,next)}}/>
  </div>)}</>;
}
/** Semi ColorPicker（官方组件）：棋盘格透明底触发器 + 弹出取色面板（含 Alpha 滑块），onChange 回吐 #RRGGBBAA。 */
export function ColorField({label,value,onChange,disabled=false}:{label:string;value:string;onChange:(value:string)=>void;disabled?:boolean}) {
  const swatch = value === "transparent" ? "transparent" : toPickerColor(value);
  return <Field label={label}><span className="property-color">
    <ColorPicker usePopover alpha disabled={disabled} defaultFormat="hex"
      value={ColorPicker.colorStringToValue(toPickerColor(value))}
      onChange={color => onChange(color.hex)}
      popoverProps={{ position: "bottomRight", showArrow: false, trigger: "click" }}>
      <span className="property-color-trigger" role="button" aria-label={label}>
        <span className="property-color-fill" style={{ background: swatch }}/>
      </span>
    </ColorPicker>
    <span className="property-color-value">{value}</span>
  </span></Field>
}
/** 山海鲸式单值数字字段（位置 X/Y、宽高、角度、阴影偏移等），min/max 省略时不限制。 */
export function NumberField({label,value,min,max,step=1,disabled=false,onChange}:{label:string;value:number;min?:number;max?:number;step?:number;disabled?:boolean;onChange:(value:number)=>void}) {
  return <Field label={label}><InputNumber size="small" hideButtons aria-label={label} min={min} max={max} step={step} disabled={disabled} value={value} onChange={next=>{if(typeof next==="number"&&Number.isFinite(next))onChange(next)}}/></Field>
}

/** Keep rapid text input responsive while worker snapshots arrive asynchronously. */
export function BufferedInput({ label, value, onChange, placeholder, disabled = false }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(value); }, [value]);
  return <Input size="small" aria-label={label} value={draft} placeholder={placeholder} disabled={disabled}
    onFocus={() => { focused.current = true; }}
    onChange={(next) => { setDraft(next); onChange(next); }}
    onBlur={() => { focused.current = false; if (draft !== value) onChange(draft); }} />;
}
