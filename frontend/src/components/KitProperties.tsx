import { Children, cloneElement, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NumberInput } from "@/components/ui-ext/number-input";
import { Toast } from "@/lib/toast";
import {
  Close, DeleteTwo, Down, Drag, MoreOne, Plus, Search, Strikethrough, TextItalic, TextUnderline, Upload,
} from "@icon-park/react";
import type { SceneNode } from "../types";
import { KIT_CITY_GEOMETRY_OPTION, KIT_CITY_TYPE, KIT_CONDITION_STYLES, kitChoiceItems, kitChoiceTree, kitChoiceTreeItems, kitColor, kitFileUrl, kitMetadata, kitOptions,
  kitPrivateData, kitRecord, kitRows, type ReferenceKitPiece, type ReferenceKitWidget } from "../data/kitRuntime";
import { kitComponentInfo, kitOptionDefinition, kitOptionDefinitionsByType, kitPieceOptionDefinition, kitPieceOptionDefinitions,
  kitRankingKeys, kitRankingTypes, type KitOptionDefinition } from "../data/kitOptionSchema";
import { dataAt, widgetFontFamilies } from "../data/editor";
import { getSceneBridge } from "../workers/bridge";
import { useStore } from "../state/store";
import { BufferedInput, Field } from "./PropertyFields";
import { captureWidgetCover } from "../engine/exportBoard";
import { kitAdvancedRule, kitLinkReference, type KitLinkDirection, type KitLinkKind } from "../data/kitLinkage";
import { kitChoiceEditPatch } from "../data/kitChoices";
import { KIT_WEATHER_TYPE, kitWeatherCity, kitWeatherConditions, kitWeatherIconKey } from "../data/kitWeather";
import weatherCities from "../data/kitWeatherCities.json";
import KitModelPreview, { KitScenePreview } from "./KitModelPreview";

/** 属性面板折叠分区：受控 Collapsible，展开态由 Panels 的 Set 集中管理。 */
function Panel({ itemKey, header, open = false, onOpenChange, children }: {
  itemKey: string; header: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void; children?: ReactNode;
}) {
  return <Collapsible open={open} onOpenChange={onOpenChange} data-panel={itemKey}>
    <CollapsibleTrigger className="properties-collapse-header" aria-label={typeof header === "string" ? header : undefined}>
      <span className="flex-1 text-left">{header}</span>
      <Down theme="outline" size={12} className="shrink-0 transition-transform" style={{ transform: open ? undefined : "rotate(-90deg)" }}/>
    </CollapsibleTrigger>
    <CollapsibleContent className="properties-collapse-content">{children}</CollapsibleContent>
  </Collapsible>;
}
function Panels({ defaultKeys = [], className, children }: {
  defaultKeys?: string[]; className?: string; children?: ReactNode;
}) {
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set(defaultKeys));
  const toggle = (itemKey: string, next: boolean) => setOpenKeys(keys => {
    const update = new Set(keys); if (next) update.add(itemKey); else update.delete(itemKey); return update;
  });
  return <div className={className}>{Children.map(children, child => {
    if (!isValidElement(child)) return child;
    const itemKey = (child.props as { itemKey?: unknown }).itemKey;
    if (typeof itemKey !== "string") return child;
    return cloneElement(child as React.ReactElement<React.ComponentProps<typeof Panel>>, {
      open: openKeys.has(itemKey), onOpenChange: next => toggle(itemKey, next),
    });
  })}</div>;
}
/** Semi Select → shadcn Select：受控 value + onValueChange，optionList 展开成 SelectItem。 */
function SelectField({ label, value, options, disabled, placeholder, onChange }: {
  label?: string; value?: string | null; options: readonly { value: string; label: string }[];
  disabled?: boolean; placeholder?: string; onChange: (value: string) => void;
}) {
  return <Select value={value ?? undefined} onValueChange={value => typeof value === "string" && onChange(value)} disabled={disabled}>
    <SelectTrigger aria-label={label} size="sm" className="w-full"><SelectValue placeholder={placeholder}/></SelectTrigger>
    <SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </Select>;
}
/** Semi Select multiple → DropdownMenu + CheckboxItem 多选。 */
function MultiSelect({ label, value, options, disabled, placeholder, onChange }: {
  label?: string; value?: string[]; options: readonly { value: string; label: string }[];
  disabled?: boolean; placeholder?: string; onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (optionValue: string, checked: boolean) =>
    onChange(checked ? [...value ?? [], optionValue] : (value ?? []).filter(item => item !== optionValue));
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild disabled={disabled}><Button variant="outline" size="sm" className="w-full justify-between font-normal" aria-label={label}>
      <span className="truncate text-left text-xs">{value?.length
        ? value.map(item => options.find(option => option.value === item)?.label ?? item).join("、") : placeholder ?? "请选择"}</span>
      <Down theme="outline" size={12} className="shrink-0 opacity-60"/>
    </Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
      {options.map(option => <DropdownMenuCheckboxItem key={option.value} checked={value?.includes(option.value) ?? false}
        onCheckedChange={checked => toggle(option.value, checked === true)}>{option.label}</DropdownMenuCheckboxItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function JsonValueEditor({ label, value, disabled, onChange }: ValueProps) {
  const serialized = JSON.stringify(value, null, 2) ?? "null";
  const [draft, setDraft] = useState(serialized);
  const [error, setError] = useState("");
  useEffect(() => { setDraft(serialized); setError(""); }, [serialized]);
  return <div className="kit-json-field">
    <Textarea aria-label={label} value={draft} disabled={disabled} rows={6} spellCheck={false}
      onChange={event => setDraft(event.target.value)} onBlur={() => {
        try { const next: unknown = JSON.parse(draft); onChange(next); setError(""); }
        catch { setError("JSON 格式无效，请检查括号和逗号"); }
      }}/>
    {error && <span className="field-error" role="alert">{error}</span>}
  </div>;
}
interface ValueProps {
  label: string;
  optionKey?: string;
  value: unknown;
  definition?: KitOptionDefinition;
  widgetType?: string;
  disabled?: boolean;
  depth?: number;
  fields?: NonNullable<ReferenceKitWidget["privateData"]>["fields"];
  menuChoices?: { label: string; value: string }[];
  onChange: (value: unknown, edit?: { previousIndices: number[] }) => void;
}

function KitStringChoices({ label, value, disabled, emptyNewItem = false, onChange }: {
  label: string; value: string[]; disabled?: boolean; emptyNewItem?: boolean; onChange: ValueProps["onChange"];
}) {
  const dragging = useRef<number | null>(null);
  const handles = useRef<(HTMLButtonElement | null)[]>([]);
  const indices = () => value.map((_, index) => index);
  const move = (from: number, to: number) => {
    if (disabled || from === to || from < 0 || to < 0 || from >= value.length || to >= value.length) return;
    const order = indices(), [item] = order.splice(from, 1);
    order.splice(to, 0, item!);
    onChange(order.map(index => value[index]!), { previousIndices: order });
  };
  return <div className="kit-choice-list" aria-label={label}>
    {value.map((item, index) => <div className="kit-choice-row" key={index}
      onDragOver={event => { if (!disabled) event.preventDefault(); }} onDrop={event => {
        event.preventDefault(); if (dragging.current !== null) move(dragging.current, index); dragging.current = null;
      }}>
      <button type="button" className="kit-choice-drag" draggable={!disabled} disabled={disabled}
        ref={element => { handles.current[index] = element; }}
        aria-label={`调整${label}第${index + 1}项顺序`} title="拖动或使用上下方向键调整顺序"
        onDragStart={event => { dragging.current = index; event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(index)); }}
        onDragEnd={() => { dragging.current = null; }} onKeyDown={event => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const next = index + (event.key === "ArrowUp" ? -1 : 1);
            move(index, next); requestAnimationFrame(() => handles.current[next]?.focus());
          }
        }}><Drag size={14}/></button>
      <BufferedInput label={`${label}第${index + 1}项`} value={item} disabled={disabled}
        onChange={next => onChange(value.map((part, at) => at === index ? next : part), { previousIndices: indices() })}/>
      <button type="button" className="kit-choice-remove" disabled={disabled} aria-label={`删除${label}第${index + 1}项`}
        onClick={() => onChange(value.filter((_, at) => at !== index),
          { previousIndices: indices().filter(at => at !== index) })}><DeleteTwo size={14}/></button>
    </div>)}
    <Button size="sm" variant="ghost" disabled={disabled}
      onClick={() => onChange([...value, emptyNewItem ? "" : `选项${value.length + 1}`],
        { previousIndices: [...indices(), -1] })}><Plus size={12}/>添加一项</Button>
  </div>;
}

function KitColorEditor({ label, value, disabled, onChange }: ValueProps) {
  const css = kitColor(value, "#ffffff");
  const rgba = (color: unknown) => {
    const result = kitColor(color, "#ffffffff");
    if (result === "transparent") return "#00000000";
    if (/^#[\da-f]{8}$/i.test(result)) return result;
    if (/^#[\da-f]{6}$/i.test(result)) return `${result}ff`;
    return "#ffffffff";
  };
  const opacity = (color: unknown) => Math.round(parseInt(rgba(color).slice(7, 9), 16) / 255 * 100);
  const alpha = (color: unknown, percent: number) => `${rgba(color).slice(0, 7)}${Math.round(Math.min(100, Math.max(0, percent)) * 255 / 100).toString(16).padStart(2, "0")}`;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const gradient = value as { angle?: string | number; colors?: { color: string; position: number }[] };
    const stops = gradient.colors ?? [];
    return <div className="kit-color-stops">
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(css)}>切换为纯色</Button>
      <NumberInput size="small" hideButtons aria-label={`${label}渐变角度`} value={Number(gradient.angle ?? 0)} suffix="°"
        disabled={disabled} onChange={angle => typeof angle === "number" && onChange({ ...gradient, angle: String(angle) })}/>
      {stops.map((stop, index) => <div key={index} className="kit-color-stop-group">
        <div className="kit-color-stop">
          <input type="color" aria-label={`${label}色标${index + 1}`} disabled={disabled}
            value={rgba(stop.color).slice(0, 7)} onChange={event => onChange({ ...gradient,
              colors: stops.map((item, at) => at === index ? { ...item, color: `${event.target.value}${rgba(item.color).slice(7)}` } : item) })}/>
          <BufferedInput label={`${label}色标${index + 1}颜色`} value={stop.color} disabled={disabled} onChange={color => onChange({ ...gradient,
            colors: stops.map((item, at) => at === index ? { ...item, color } : item) })}/>
          <Button size="sm" variant="ghost" disabled={disabled || stops.length < 2}
            aria-label={`删除${label}色标${index + 1}`} onClick={() => onChange({ ...gradient, colors: stops.filter((_, at) => at !== index) })}><Close size={12}/></Button>
        </div>
        <div className="kit-color-stop">
          <span className="kit-stop-tag">位置</span>
          <NumberInput size="small" hideButtons aria-label={`${label}色标位置${index + 1}`} value={Number(stop.position)} disabled={disabled} suffix="%"
            onChange={position => typeof position === "number" && onChange({ ...gradient,
              colors: stops.map((item, at) => at === index ? { ...item, position } : item) })}/>
          <span className="kit-stop-tag">透明</span>
          <NumberInput size="small" hideButtons aria-label={`${label}色标透明度${index + 1}`} value={opacity(stop.color)} disabled={disabled} min={0} max={100} suffix="%"
            onChange={next => typeof next === "number" && onChange({ ...gradient,
              colors: stops.map((item, at) => at === index ? { ...item, color: alpha(item.color, next) } : item) })}/>
        </div>
      </div>)}
      <Button size="sm" variant="ghost" disabled={disabled}
        onClick={() => onChange({ ...gradient, colors: [...stops, { color: "#ffffff", position: 100 }] })}><Plus size={12}/>添加色标</Button>
    </div>;
  }
  return <div className="kit-color-stops"><div className="kit-color-input"><input type="color" aria-label={`${label}取色`} disabled={disabled}
    value={rgba(value).slice(0, 7)} onChange={event => onChange(`${event.target.value}${rgba(value).slice(7)}`)}/>
    <BufferedInput label={label} value={String(value ?? "transparent")} disabled={disabled} onChange={onChange}/></div>
    <NumberInput size="small" hideButtons aria-label={`${label}透明度`} value={opacity(value)} disabled={disabled} min={0} max={100} suffix="%"
      onChange={next => typeof next === "number" && onChange(alpha(value, next))}/>
    <Button size="sm" variant="ghost" disabled={disabled}
      onClick={() => onChange({ angle: "0", colors: [{ color: css, position: 0 }, { color: css, position: 100 }] })}>切换为渐变</Button>
  </div>;
}

function KitFontEditor({ label, value, disabled, onChange }: ValueProps) {
  const font = kitRecord(value);
  const family = String(font.family ?? ""), size = Number(font.size ?? 20);
  const weight = Number(font.weight ?? (font.bold === true ? 700 : 400));
  const weights = [
    { label: "Thin", value: 100 }, { label: "Extra Light", value: 200 }, { label: "Light", value: 300 },
    { label: "Regular", value: 400 }, { label: "Medium", value: 500 }, { label: "Semi Bold", value: 600 },
    { label: "Bold", value: 700 }, { label: "Extra Bold", value: 800 }, { label: "Black", value: 900 },
  ];
  if (Number.isFinite(weight) && !weights.some(item => item.value === weight)) weights.push({ label: String(weight), value: weight });
  const strikeKey = Object.hasOwn(font, "deleteline") ? "deleteline"
    : Object.hasOwn(font, "line-through") ? "line-through" : "deleteline";
  const update = (patch: Record<string, unknown>) => onChange({ ...font, ...patch });
  return <div className="kit-font-editor">
    <SelectField label={`${label}字体`} disabled={disabled} value={family}
      options={[{ value: family, label: family || "系统默认字体" }, ...widgetFontFamilies]}
      onChange={next => update({ family: next })}/>
    <div className="kit-font-size-row">
      <SelectField label={`${label}字重`} disabled={disabled} value={String(Number.isFinite(weight) ? weight : 400)}
        options={weights.map(item => ({ value: String(item.value), label: item.label }))}
        onChange={next => update({ weight: Number(next),
          ...(Object.hasOwn(font, "bold") ? { bold: Number(next) >= 600 } : {}) })}/>
      <NumberInput size="small" hideButtons aria-label={`${label}字号`} disabled={disabled} min={0} suffix="px"
        value={Number.isFinite(size) ? size : 20} onChange={next => typeof next === "number" && update({ size: next })}/>
    </div>
    <div className="kit-font-tools">
      <details className="kit-font-color">
        <summary aria-label={`${label}颜色`} title="字体颜色"><span style={{ background: kitColor(font.color, "#ffffff") }}/><b>▾</b></summary>
        <div className="kit-font-palette"><KitColorEditor label={`${label}颜色`} value={font.color ?? "#ffffff"}
          disabled={disabled} onChange={color => update({ color })}/></div>
      </details>
      {([ ["italic", "倾斜", TextItalic], ["underline", "下划线", TextUnderline], [strikeKey, "删除线", Strikethrough] ] as const)
        .map(([key, name, Icon]) => <button type="button" key={name} disabled={disabled} aria-label={`${label}${name}`}
          title={name} aria-pressed={font[key] === true} onClick={() => {
            const next = font[key] !== true;
            update({ [key]: next, ...(name === "删除线" && Object.hasOwn(font, "deleteline") && Object.hasOwn(font, "line-through")
              ? { deleteline: next, "line-through": next } : {}) });
          }}><Icon size={15}/></button>)}
    </div>
  </div>;
}

function KitFileEditor({ label, value, disabled, onChange }: ValueProps) {
  const input = useRef<HTMLInputElement>(null);
  const file = value && typeof value === "object" ? value as Record<string, unknown> : undefined;
  const url = kitFileUrl(value);
  const setUrl = (path: string) => onChange(typeof value === "string" ? path
    : { ...file, __opt_type: "file", relativePath: path });
  return <div className="kit-file-input">
    {url && /\.(png|webp|jpe?g|svg|gif|avif)(?:[?#]|$)|^data:image/i.test(url)
      && <img src={url} alt={`${label}预览`}/>}
    <BufferedInput label={label} value={file ? String(file.relativePath ?? "") : String(value ?? "")}
      disabled={disabled} onChange={setUrl} placeholder="图片地址或本地资源"/>
    <Button size="sm" variant="ghost" disabled={disabled}
      onClick={() => input.current?.click()}><Upload size={12}/>选择文件</Button>
    <input ref={input} hidden type="file" aria-label={`上传${label}`} accept="image/*,video/*,audio/*,.pdf,.hdr,.env,.dds,.glb,.gltf,.obj,.ktx2,.bin,.json" onChange={event => {
      const selected = event.target.files?.[0]; if (!selected) return;
      if (selected.size > 700_000) { Toast.warning("请选择小于 700 KB 的文件，较大文件可填写资源地址"); return; }
      const reader = new FileReader(); reader.onload = () => setUrl(String(reader.result));
      reader.readAsDataURL(selected); event.target.value = "";
    }}/>
  </div>;
}

// Prefecture codes from the 2025 areacodes dataset (CC0 1.0).
const weatherCityTree = (weatherCities as [number, string, [number, string][]][]).map(([code, label, cities]) => ({
  label, value: String(code),
  children: cities.length ? cities.map(([code, label]) => ({ label, value: String(code) })) : undefined,
}));

/** Semi Cascader → DropdownMenu 两级列表（省份子菜单悬停展开，对齐 showNext="hover"）。 */
function KitWeatherCityEditor({ label, value, disabled, onChange }: ValueProps) {
  const code = kitWeatherCity(value);
  const province = weatherCityTree.find(item => item.value.slice(0, 2) === code.slice(0, 2));
  const city = province?.children?.find(item => item.value === code);
  const unknown = code && !city && code !== province?.value;
  const tree = unknown ? [...weatherCityTree, { label: code, value: code, children: undefined }] : weatherCityTree;
  const [open, setOpen] = useState(false);
  const pick = (selected: string) => {
    const city = kitWeatherCity(selected);
    if (city) onChange(Number(city));
    setOpen(false);
  };
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild disabled={disabled}>
      <Button variant="outline" size="sm" className="w-full justify-between font-normal" aria-label={label}>
        <span className="truncate text-left text-xs">{city ? `${province?.label ?? ""} / ${city.label}` : code || "请选择省市"}</span>
        <Down theme="outline" size={12} className="shrink-0 opacity-60"/>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="max-h-72 w-52 overflow-y-auto">
      {tree.map(item => item.children?.length
        ? <DropdownMenuSub key={item.value}>
          <DropdownMenuSubTrigger className="text-xs">{item.label}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
            <DropdownMenuItem onClick={() => pick(item.value)}>{item.label}</DropdownMenuItem>
            {item.children.map(child => <DropdownMenuItem key={child.value} onClick={() => pick(child.value)}>{child.label}</DropdownMenuItem>)}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        : <DropdownMenuItem key={item.value} className="text-xs" onClick={() => pick(item.value)}>{item.label}</DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

function KitWeatherKeyInput({ label, value, disabled, onChange }: {
  label: string; value: string; disabled?: boolean; onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = () => { if (draft.trim() !== value) onChange(draft.trim()); };
  return <Input type="password" className="h-7 text-xs" aria-label={label} autoComplete="off" disabled={disabled}
    value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === "Enter") commit(); }}/>;
}

const weatherInfoTabs = [
  ["layout", "布局", ["weather-direction", "weather-align", "reverse"]],
  ["name", "天气名称", ["weather-name", "weather-text-font", "weather-text-offset"]],
  ["temperature", "温度", ["temperature", "connector", "weather-temperature-font", "suffix",
    "suffix-text-font", "temperature-text-offset"]],
  ["wind", "风向", ["wind", "wind-type", "wind-text-font", "wind-text-offset"]],
] as const;
const weatherIconFields = new Set(["icon", "icon-position", "image-size", "image-background", "image-offset"]);
const weatherInfoFields = new Set<string>(weatherInfoTabs.flatMap(([, , keys]) => [...keys]));

const summaries = [
  { label: "不汇总", value: "none" }, { label: "求和", value: "sum" },
  { label: "平均值", value: "mean" }, { label: "最大值", value: "max" },
  { label: "最小值", value: "min" }, { label: "计数", value: "count" },
];

function KitFieldEditor({ label, optionKey, value, definition, fields, disabled, onChange }: ValueProps) {
  const multiple = Array.isArray(value) || value == null;
  const bindings = (multiple ? value as unknown[] | undefined ?? [] : [value]).map(kitRecord);
  const choices = (fields ?? []).map(field => ({ label: field.alias || field.uid, value: field.uid }));
  const change = (next: Record<string, unknown>[]) => onChange(multiple ? next : next[0] ?? null);
  const select = (uid: unknown, binding: Record<string, unknown>, index: number) => {
    if (typeof uid !== "string") return;
    const path = Array.isArray(binding.uid) ? binding.uid.slice(0, -1) : ["c_private", "t_private"];
    const next = bindings.slice();
    next[index] = { __opt_type: "field", summary: "none", ...binding, uid: [...path, uid] };
    change(next);
  };
  return <div className="kit-array-input">
    {bindings.map((binding, index) => {
      const uid = Array.isArray(binding.uid) ? String(binding.uid.at(-1) ?? "") : "";
      const choicesForBinding = uid && !choices.some(choice => choice.value === uid) ? [{ label: uid, value: uid }, ...choices] : choices;
      const summary = binding.summary === "avg" ? "mean" : String(binding.summary || "none");
      return <div className="kit-field-picker" key={index}>
        <div>
          <SelectField label={`${label}第${index + 1}项`} value={uid} options={choicesForBinding}
            disabled={disabled} onChange={next => select(next, binding, index)}/>
          <Button size="sm" variant="ghost" aria-label={`删除${label}第${index + 1}项`}
            disabled={disabled || bindings.length <= (definition?.min ?? 0)} onClick={() => change(bindings.filter((_, at) => at !== index))}><Close size={12}/></Button>
        </div>
        {/^axis-(y|line|size|value|values)$/.test(optionKey ?? "") && <SelectField label={`${label}第${index + 1}项汇总`}
          disabled={disabled} value={summary} options={summaries.some(item => item.value === summary) ? summaries : [...summaries, { label: summary, value: summary }]}
          onChange={next => change(bindings.map((entry, at) => index === at ? { ...entry, summary: next } : entry))}/>}
      </div>;
    })}
    {bindings.length < (multiple ? definition?.max ?? Infinity : 1) &&
      <SelectField label={`添加${label}`} placeholder="选择数据字段" disabled={disabled}
        value={null} options={choices} onChange={next => select(next, {}, bindings.length)}/>}
  </div>;
}

function KitRelatedFields({ options, widgetType, fields, disabled, onChange }: {
  options: Record<string, unknown>; widgetType: string; fields: { uid: string; alias?: string }[];
  disabled?: boolean; onChange: (patch: Record<string, unknown>) => void;
}) {
  const mappings = kitRecord(options["related-fields"]);
  const declared = Array.isArray(options["related-entries"]) ? options["related-entries"].flatMap(item => {
    const entry = kitRecord(item);
    return typeof entry.name === "string" ? [{ ...entry, name: entry.name, alias: String(entry.alias ?? entry.name) }] : [];
  }) : [];
  const entries = [...declared];
  for (const name of Object.keys(mappings)) if (!entries.some(entry => entry.name === name)) {
    let key = name;
    try { const path: unknown = JSON.parse(name); if (Array.isArray(path)) key = String(path.at(-1) ?? name); } catch { /* retain the source name */ }
    entries.push({ name, alias: kitOptionDefinition(key, undefined, widgetType).label });
  }
  const definitions = kitOptionDefinitionsByType[widgetType] ?? {};
  const candidates = Object.entries(definitions).flatMap(([key, definition]) => {
    if (definition.hidden || definition.nested || definition.tab === "data" || key === "map-key"
        || !["text", "number", "boolean", "color", "file", "select"].includes(definition.type ?? "")) return [];
    const name = JSON.stringify([key]);
    if (entries.some(entry => entry.name === name)) return [];
    const resolved = kitOptionDefinition(key, options[key], widgetType);
    return [{ value: name, label: `${resolved.group} / ${resolved.label}`, alias: resolved.label }];
  });
  const save = (nextEntries: typeof entries, nextMappings: Record<string, unknown>) =>
    onChange({ "related-entries": nextEntries, "related-fields": nextMappings });
  return <div className="kit-array-input">
    {entries.map(entry => <div key={entry.name} className="kit-compound">
      <Field label={entry.alias}><KitFieldEditor label={entry.alias} optionKey="related-field"
        definition={{ label: entry.alias, group: "动态数据字段", type: "field", max: 1 }}
        value={kitRecord(mappings[entry.name])["related-field"] ?? []} fields={fields} disabled={disabled}
        onChange={next => save(entries, { ...mappings, [entry.name]: {
          ...kitRecord(mappings[entry.name]), "related-field": next,
        } })}/></Field>
      <Button size="sm" variant="ghost" disabled={disabled} aria-label={`删除${entry.alias}动态字段`}
        onClick={() => { const next = { ...mappings }; delete next[entry.name];
          save(entries.filter(item => item.name !== entry.name), next); }}>移除此绑定</Button>
    </div>)}
    {candidates.length > 0 && <SelectField label="添加动态数据字段"
      placeholder="选择要绑定数据的属性" disabled={disabled} options={candidates} value={null}
      onChange={value => {
        const chosen = candidates.find(item => item.value === String(value));
        if (chosen) save([...entries, { name: chosen.value, alias: chosen.alias }],
          { ...mappings, [chosen.value]: { "related-field": [] } });
      }}/>}
    {!entries.length && !candidates.length && <p className="properties-note">当前组件没有可绑定的属性。</p>}
  </div>;
}

function KitClusterEditor({ label, optionKey, value, definition, widgetType, fields, menuChoices, disabled, depth = 0, onChange }: ValueProps) {
  const cluster = kitRecord(value);
  const indexes = Array.isArray(cluster.indexes) ? cluster.indexes.map(String) : [];
  const declared = (definition?.children ?? []).map(key => [key, kitOptionDefinition(key, undefined, widgetType)] as const);
  const defaults = Object.fromEntries(declared.flatMap(([key, child]) => child.defaultValue === undefined ? [] : [[key, child.defaultValue]]));
  return <div className="kit-array-input">
    {indexes.map((index, offset) => {
      const item = kitRecord(cluster[index]);
      const values = { ...defaults, ...item };
      const keys = [...new Set([...declared.map(([key]) => key), ...Object.keys(item)])];
      const menuLabel = menuChoices?.find(choice => choice.value === item["item-key"])?.label;
      return <details key={index} open={indexes.length === 1}>
        <summary>{typeof item.name === "string" ? item.name : menuLabel
          ?? (optionKey === "item-style-cluster" && !item["item-key"] ? "默认样式" : `第 ${offset + 1} 项`)}</summary>
        <div className="kit-compound">
          {keys.map(key => {
            const original = kitOptionDefinition(key, values[key], widgetType);
            const child = key === "item-key" && menuChoices?.length ? { ...original, options: menuChoices } : original;
            if (child.hidden && !Object.hasOwn(item, key)) return null;
            return <Field key={key} label={child.label}>
              <KitOptionValue label={child.label} optionKey={key} value={values[key] ?? null} definition={child}
                widgetType={widgetType} fields={fields} menuChoices={menuChoices} disabled={disabled} depth={depth + 1}
                onChange={next => onChange({ ...cluster, [index]: { ...item, [key]: next } })}/>
            </Field>;
          })}
        </div>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => {
          const { [index]: _removed, ...rest } = cluster;
          onChange({ ...rest, indexes: indexes.filter(id => id !== index) });
        }}>删除此项</Button>
      </details>;
    })}
    <Button size="sm" variant="ghost" disabled={disabled} onClick={() => {
      const index = `idx-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
      onChange({ ...cluster, indexes: [...indexes, index], [index]: structuredClone(declared.length ? defaults : cluster[indexes.at(-1) ?? ""] ?? {}) });
    }}><Plus size={12}/>添加{label}</Button>
  </div>;
}

/** Recursively edit compound source values without flattening clusters, gradients or item states. */
export function KitOptionValue({ label, optionKey = "", value, definition, widgetType, disabled, depth = 0, fields, menuChoices, onChange }: ValueProps) {
  const def = definition ?? kitOptionDefinition(optionKey, value, widgetType);
  if (widgetType === KIT_WEATHER_TYPE && optionKey === "data-city")
    return <KitWeatherCityEditor label={label} value={value} disabled={disabled} onChange={onChange}/>;
  if (widgetType === KIT_WEATHER_TYPE && optionKey === "map-key") {
    const keys = Array.isArray(value) ? value.map(item => typeof item === "string" ? item : "")
      : [typeof value === "string" ? value : ""];
    return <div className="kit-choice-list" aria-label={label}>
      {keys.map((item, index) => <div className="kit-choice-row" key={index}>
        <KitWeatherKeyInput label={`${label}第${index + 1}项`} value={item} disabled={disabled}
          onChange={next => onChange(keys.map((part, at) => at === index ? next : part))}/>
        <button type="button" className="kit-choice-remove" disabled={disabled} aria-label={`删除${label}第${index + 1}项`}
          onClick={() => onChange(keys.filter((_, at) => at !== index))}><DeleteTwo size={14}/></button>
      </div>)}
      <Button size="sm" variant="ghost" disabled={disabled}
        onClick={() => onChange([...keys, ""])}><Plus size={12}/>添加{label}</Button>
    </div>;
  }
  if (widgetType === KIT_WEATHER_TYPE && optionKey === "icon-list") {
    const icons = kitRecord(value);
    const indexes = Array.isArray(icons.indexes) ? icons.indexes.map(String) : [];
    return <div className="kit-choice-list" aria-label={label}>
      {kitWeatherConditions.map(condition => {
        const index = kitWeatherIconKey(icons, condition);
        const icon = kitRecord(icons[index]);
        return <Field label={condition} key={condition}><KitFileEditor label={`${condition}图标`}
          value={icon["change-image"] ?? {}} disabled={disabled} onChange={next => onChange({
            ...icons, indexes: indexes.includes(index) ? indexes : [...indexes, index],
            [index]: { ...icon, weather: condition, "change-image": next },
          })}/></Field>;
      })}
    </div>;
  }
  if (["button-name-option", "dropdown-value-text-option", "json-node-linkage-fields", "json-node-selection-fields"].includes(optionKey) && Array.isArray(value)
      && value.every(item => typeof item === "string"))
    return <KitStringChoices label={label} value={value} disabled={disabled}
      emptyNewItem={optionKey.startsWith("json-node-")} onChange={onChange}/>;
  if (def.type === "field" && fields?.length) return <KitFieldEditor label={label} optionKey={optionKey}
    definition={def} value={value} fields={fields} disabled={disabled} onChange={onChange}/>;
  if (depth < 5 && (def.children?.length || Array.isArray(kitRecord(value).indexes)))
    return <KitClusterEditor label={label} optionKey={optionKey} value={value} definition={def} widgetType={widgetType} fields={fields} menuChoices={menuChoices}
      disabled={disabled} depth={depth} onChange={onChange}/>;
  if (def.type === "palette" || (def.type === "color" && Array.isArray(value))) {
    const colors = Array.isArray(value) ? value : [];
    return <div className="kit-array-input">
      {colors.map((color, index) => <details key={index} open={colors.length === 1}>
        <summary>{`颜色 ${index + 1}`}</summary>
        <KitColorEditor label={`${label}颜色${index + 1}`} value={color} disabled={disabled}
          onChange={next => onChange(colors.map((part, at) => at === index ? next : part))}/>
        <Button size="sm" variant="ghost" disabled={disabled}
          onClick={() => onChange(colors.filter((_, at) => at !== index))}>删除此颜色</Button>
      </details>)}
      <Button size="sm" variant="ghost" disabled={disabled}
        onClick={() => onChange([...colors, structuredClone(colors.at(-1) ?? "#ffffff")])}><Plus size={12}/>添加颜色</Button>
    </div>;
  }
  if (def.options?.length && Array.isArray(value) && value.every(item => typeof item === "string" || typeof item === "number")) {
    const options = [...def.options];
    for (const item of value) if (!options.some(option => option.value === item)) options.push({ label: String(item), value: item });
    return <MultiSelect label={label} disabled={disabled}
      value={value.map(String)} options={options.map(option => ({ ...option, value: String(option.value) }))}
      onChange={next => onChange(next.map(item => options.find(option => String(option.value) === item)?.value ?? item))}/>;
  }
  if (def.options?.length && (value == null || typeof value === "string" || typeof value === "number")) {
    const options = value == null || def.options.some(option => option.value === value) ? def.options
      : [{ label: String(value), value }, ...def.options];
    const change = (next: unknown) => onChange(options.find(option => String(option.value) === next)?.value ?? next);
    if (!["filter-condition-select", "selected-key", "dropdown-default-value"].includes(optionKey)
        && options.length <= 3 && options.every(option => option.label.length < 9))
      return <RadioGroup disabled={disabled} className="flex gap-3" aria-label={label}
        value={value == null ? null : String(value)} onValueChange={next => change(next)}>
        {options.map(option => <label key={option.value} className="flex items-center gap-1.5">
          <RadioGroupItem value={String(option.value)}/><span className="text-xs">{option.label}</span>
        </label>)}
      </RadioGroup>;
    return <SelectField label={label} disabled={disabled} value={value == null ? null : String(value)}
      options={options.map(option => ({ ...option, value: String(option.value) }))}
      onChange={change}/>;
  }
  if (optionKey === "opacity" && typeof value === "number") return <div className="kit-opacity-input">
    <Slider aria-label={label} value={[value]} min={0} max={100} disabled={disabled}
      onValueChange={next => { const nextValue = Array.isArray(next) ? next[0] : next; typeof nextValue === "number" && onChange(nextValue); }}/>
    <NumberInput size="small" hideButtons aria-label={`${label}百分比`} value={value} min={0} max={100} suffix="%"
      disabled={disabled} onChange={next => typeof next === "number" && onChange(next)}/>
  </div>;
  if (typeof value === "boolean" || def.type === "boolean") return <Switch size="sm" aria-label={label} disabled={disabled}
    checked={value === true} onCheckedChange={checked => onChange(checked)}/>;
  if (def.type === "file" || (value && typeof value === "object" && "relativePath" in value))
    return <KitFileEditor label={label} value={value} disabled={disabled} onChange={onChange}/>;
  if (def.type === "color" && !Array.isArray(value)) return <KitColorEditor label={label} value={value} disabled={disabled} onChange={onChange}/>;
  if (typeof value === "number" || (def.type === "number" && (value == null || typeof value === "string" && Number.isFinite(Number(value)))))
    return <NumberInput size="small" aria-label={label} disabled={disabled} value={value == null ? undefined : Number(value)}
      min={def.min} max={def.max} step={def.step ?? 1} onChange={next => typeof next === "number"
        && Number.isFinite(next) && onChange(typeof value === "string" ? String(next) : next)}/>;
  if (typeof value === "string" || (value == null && (def.type === "text" || def.type === "select")))
    return <BufferedInput label={label} value={String(value ?? "")} disabled={disabled} onChange={onChange}/>;
  if (Array.isArray(value) && value.length > 0 && value.length <= 4 && value.every(item => typeof item === "number")) {
    const names = optionKey === "layout" ? ["行", "列"]
      : ["size", "item-size", "text-tilt"].includes(optionKey) ? ["W", "H"]
      : value.length === 3 ? ["X", "Y", "Z"] : ["X", "Y", "Z", "W"];
    return <div className="kit-vector-input">{value.map((item, index) => <span key={index}><small>{names[index]}</small>
      <NumberInput size="small" hideButtons aria-label={`${label}${names[index]}`} disabled={disabled} value={item}
        min={optionKey === "size" ? 1 : undefined} onChange={next => typeof next === "number" && onChange(value.map((part, at) => at === index ? next : part))}/>
    </span>)}</div>;
  }
  if ((def.type === "font" || (value && typeof value === "object" && !Array.isArray(value))) && depth < 5) {
    const raw = (value ?? {}) as Record<string, unknown>;
    const isFont = def.type === "font" || ("family" in raw && "size" in raw);
    if (isFont) return <KitFontEditor label={label} value={raw} disabled={disabled} onChange={onChange}/>;
    return <div className="kit-compound">
      {Object.entries(raw).map(([key, part]) => {
        const childDef = kitOptionDefinition(key, part, widgetType);
        return <Field key={key} label={childDef.label}><KitOptionValue label={`${label}${childDef.label}`} optionKey={key}
          widgetType={widgetType} definition={childDef} value={part} depth={depth + 1} fields={fields} menuChoices={menuChoices}
          disabled={disabled} onChange={next => onChange({ ...raw, [key]: next })}/></Field>;
      })}
    </div>;
  }
  if (Array.isArray(value) && depth < 5 && value.length <= 64) return <div className="kit-array-input">
    {value.map((item, index) => <details key={index} open={value.length < 3}>
      <summary>{typeof item === "string" ? item : `第 ${index + 1} 项`}</summary>
      <KitOptionValue label={`${label}第${index + 1}项`} optionKey={optionKey} value={item} disabled={disabled}
        definition={{ ...def, type: undefined, options: undefined }} depth={depth + 1} fields={fields} menuChoices={menuChoices}
        onChange={next => onChange(value.map((part, at) => at === index ? next : part))}/>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(value.filter((_, at) => at !== index))}>删除此项</Button>
    </details>)}
    <Button size="sm" variant="ghost" disabled={disabled}
      onClick={() => onChange([...value, structuredClone(value.at(-1) ?? "")])}><Plus size={12}/>添加一项</Button>
  </div>;
  return <JsonValueEditor key={JSON.stringify(value)} label={label} value={value} disabled={disabled} onChange={onChange}/>;
}

const groupOrder = ["基本设置", "字体设置", "文本设置", "图片设置", "默认样式", "悬停样式", "按下样式", "选中样式",
  "菜单设置", "列表设置", "图表设置", "颜色", "数据颜色", "图形文本", "图形形状", "辅助线", "缩略轴", "轴", "图例", "提示信息",
  "展示设置", "内边距", "大小&位置", "响应式布局", "边框设置", "背景设置", "组件封面"];
const dataGroups = new Set(["数据字段", "数据筛选", "数据联动", "选中传递", "动态数据字段", "自定义数据字段", "数据条件字段"]);

export function KitPieceProperties({ node, pieces, section = "style" }: {
  node: SceneNode; pieces: ReferenceKitPiece[]; section?: "style" | "data" | "interaction";
}) {
  const [selectedPath, setSelectedPath] = useState("0");
  const [stateId, setStateId] = useState("");
  const [query, setQuery] = useState("");
  const entries = useMemo(() => {
    const result: { path: number[]; label: string; piece: ReferenceKitPiece }[] = [];
    const visit = (list: ReferenceKitPiece[], parent: number[], names: string[]) => {
      list.forEach((piece, index) => {
        const path = [...parent, index], name = piece.name || piece.uid || piece.type;
        const labels = [...names, name];
        result.push({ path, label: labels.join(" / "), piece });
        if (piece.pieces?.length) visit(piece.pieces, path, labels);
      });
    };
    visit(pieces, [], []);
    return result;
  }, [pieces]);
  const current = entries.find(entry => entry.path.join("/") === selectedPath) ?? entries[0];
  if (!current) return null;
  const piece = current.piece;
  const definitions = kitPieceOptionDefinitions[piece.type] ?? {};
  const values = { ...Object.fromEntries(Object.entries(definitions).filter(([, definition]) => !definition.nested)
    .map(([key, definition]) => [key, definition.defaultValue ?? (definition.type === "file" ? {} : null)])),
    ...piece.options, ...(stateId ? piece.statesOptions?.[stateId] : undefined) };
  const groups = new Map<string, [string, unknown, KitOptionDefinition][]>();
  for (const [key, value] of Object.entries(values)) {
    if (key === "interacts") continue;
    const definition = kitPieceOptionDefinition(piece.type, key, value);
    if (section === "interaction" || (section === "data") !== (definition.tab === "data")) continue;
    if (definition.nested && !Object.hasOwn(piece.options ?? {}, key)) continue;
    if (definition.hidden && !Object.hasOwn(piece.options ?? {}, key)) continue;
    if (definition.visibleWhen && !query) {
      const condition = definition.visibleWhen;
      if ("equals" in condition && values[condition.key] !== condition.equals) continue;
      if ("notEquals" in condition && values[condition.key] === condition.notEquals) continue;
    }
    if (query && !`${key} ${definition.label} ${definition.group}`.toLowerCase().includes(query.toLowerCase())) continue;
    const fields = groups.get(definition.group) ?? [];
    fields.push([key, value, definition]);
    groups.set(definition.group, fields);
  }
  const states = (piece.states ?? []).filter(state => state.uid);
  const patch = (key: string, value: unknown) => getSceneBridge().post({
    type: "patchKitPieceOptions", id: node.id, path: current.path, patch: { [key]: value }, stateId: stateId || undefined,
  });
  return <section className="kit-piece-properties">
    <div className="kit-children"><span>三维场景对象</span>
      <SelectField label="三维场景对象" value={current.path.join("/")}
        options={entries.map(entry => ({ label: entry.label, value: entry.path.join("/") }))}
        onChange={next => { setSelectedPath(String(next)); setStateId(""); }}/>
      {states.length > 0 && <SelectField label="三维对象状态" value={stateId}
        options={[{ label: "默认状态", value: "" }, ...states.map(state => ({ label: state.name, value: state.uid }))]}
        onChange={next => setStateId(String(next))}/>}
      {section === "style" && <KitScenePreview pieces={pieces} selected={current.path.join("/")}
        edit={stateId ? { path: current.path.join("/"), state: stateId } : undefined}
        onSelect={path => { setSelectedPath(path); setStateId(""); }}/>}
      {section === "style" && piece.type === "gltf" &&
        <KitModelPreview key={current.path.join("/")} label={piece.name || piece.type} source={values.model} pieces={piece.pieces}/>}
      <p className="properties-note">几何预览支持可读取的本地模型及材质贴图，包含法线、粗糙度和金属度。</p>
    </div>
    {section === "interaction" ? <section className="property-section">
      <Field label="对象交互配置"><JsonValueEditor key={`${node.id}-${selectedPath}-${stateId}`}
        label="三维对象交互配置" value={values.interacts ?? { version: 4 }} disabled={node.locked}
        onChange={value => {
          if (!value || typeof value !== "object" || Array.isArray(value)) { Toast.error("交互配置需要 JSON 对象"); return; }
          patch("interacts", value);
        }}/></Field>
    </section> : <>
    <div className="kit-property-search"><span className="relative block">
      <Search size={13} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground"/>
      <Input className="h-7 pl-7 text-xs" placeholder="搜索对象配置"
        aria-label="搜索三维对象配置" value={query} onChange={event => setQuery(event.target.value)}/>
      {query && <button type="button" aria-label="清空搜索" className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
        onClick={() => setQuery("")}><Close size={12}/></button>}
    </span></div>
    <Panels key={`${node.id}-${selectedPath}-${stateId}-${query ? "search" : "normal"}`}
      className="properties-collapse" defaultKeys={query ? [...groups.keys()] : ["基本设置", "基础设置"]}>
      {[...groups].map(([group, fields]) => <Panel key={group} header={group} itemKey={group}>
        <section className="property-section">{fields.map(([key, value, definition]) =>
          <div key={key} className="kit-option-row"><Field label={definition.label}>
            <KitOptionValue label={definition.label} optionKey={key} value={value} definition={definition}
              widgetType={piece.type} disabled={node.locked} onChange={next => patch(key, next)}/>
          </Field></div>)}</section>
      </Panel>)}
    </Panels>
    {!groups.size && <p className="properties-note">该对象没有匹配的配置项</p>}</>}
  </section>;
}

export default function KitProperties({ node, editStateId, section = "style" }:
  { node: SceneNode; editStateId?: string; section?: "style" | "data" }) {
  const state = useStore(), meta = kitMetadata(node)!;
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [axisTab, setAxisTab] = useState<"X" | "Y" | "right">("X");
  const [tooltipTab, setTooltipTab] = useState<"basic" | "format" | "text" | "unit" | "pointer">("basic");
  const [fontTab, setFontTab] = useState<"style" | "glow" | "shadow">("style");
  const [buttonStyleTab, setButtonStyleTab] = useState<"default" | "click" | "hover" | "select">("default");
  const [weatherInfoTab, setWeatherInfoTab] = useState<(typeof weatherInfoTabs)[number][0]>("layout");
  const [conditionStyle, setConditionStyle] = useState<{
    key: string; definition: KitOptionDefinition; base: unknown; otherwise: unknown;
    rules: { condition: string; value: unknown }[];
  } | null>(null);
  const [codeExample, setCodeExample] = useState("");
  const [linkageTab, setLinkageTab] = useState<KitLinkDirection>("out");
  const [selectionTab, setSelectionTab] = useState<KitLinkDirection>("out");
  const parentNode = state.scene.find(item => item.id === node.parentId);
  const parentMeta = parentNode && kitMetadata(parentNode);
  const parentIsFluid = parentMeta ? kitOptions(parentMeta.source)["container-layout"] === "fluid"
    : !parentNode && state.settings?.boardLayout === "flow";
  const options = useMemo(() => {
    const parent = state.scene.find(item => item.id === node.parentId);
    const declared = kitOptionDefinitionsByType[meta.source.type] ?? {};
    const missing = Object.fromEntries(Object.entries(declared).filter(([, def]) => !def.nested)
      .map(([key, def]) => [key, def.type === "file" ? {} : null]));
    return { ...missing, ...kitOptions(meta.source, editStateId),
      size: [node.boxSize?.x ?? 300, node.boxSize?.y ?? 64],
      position: [node.transform.position.x - (parent?.transform.position.x ?? 0), node.transform.position.y - (parent?.transform.position.y ?? 0)],
      rotate: [node.transform.rotation.x, node.transform.rotation.y, node.transform.rotation.z],
    } as Record<string, unknown>;
  }, [meta, node, editStateId, state.scene]);
  const shared = node.sharedDataSourceId ? state.liveData[node.sharedDataSourceId] : undefined;
  const available = { ...node.data, ...shared, ...state.liveData[node.id] };
  const liveChoiceRows = node.bindings?.rows ? dataAt(available, node.bindings.rows) : available.rows;
  const choiceRows = Array.isArray(liveChoiceRows)
    ? kitRows(liveChoiceRows, available.__kitImportedColumns ?? available.columns) : kitRows(kitPrivateData(meta.source)?.rows);
  const choices = kitChoiceItems(meta.source.type, options, choiceRows);
  const lastMenuItems = Array.isArray(options["last-button-list"]) ? options["last-button-list"].map(kitRecord) : [];
  const menuChoices = choices.map((label, index) => ({ label,
    value: lastMenuItems[index]?.label === label && typeof lastMenuItems[index]?.key === "string"
      ? String(lastMenuItems[index]!.key) : `${label}-${index}` }));
  const treeChoices = meta.source.type === "widget.basic.dropdown-v2" && options["use-json-type"] === true
    ? kitChoiceTreeItems(kitChoiceTree(options, choiceRows)) : [];
  const groups = new Map<string, [string, unknown, KitOptionDefinition][]>();
  for (const [key, value] of Object.entries(options)) {
    if ([KIT_CITY_GEOMETRY_OPTION, KIT_CONDITION_STYLES, "interacts", "related-entries", "related-fields", "related-field", "linkage-advanced-settings",
      "selection-advanced-settings", "linkage-mode", "linkage-elements", "selection-mode", "selection-elements"].includes(key)) continue;
    let definition = kitOptionDefinition(key, value, meta.source.type);
    if (key === "selected-key" && meta.source.type.startsWith("widget.group.buttons"))
      definition = { ...definition, options: menuChoices };
    if (key === "dropdown-default-value" && meta.source.type === "widget.basic.dropdown-v2")
      definition = { ...definition, options: [
        ...(options["show-default-option"] === true ? [{ label: String(options["dropdown-tip-text"] ?? "请选择"), value: "___default___" }] : []),
        ...(treeChoices.length ? treeChoices.map(({ label, value }) => ({ label, value }))
          : choices.map(label => ({ label, value: label }))),
      ] };
    if ((section === "data") !== (definition.tab === "data" || (!definition.tab && dataGroups.has(definition.group)))) continue;
    if (!showAll && definition.hidden) continue;
    if (!showAll && !query) {
      const isContainer = meta.source.type.startsWith("widget.group.");
      if (["", "diy-connection-field", "data-condition-fields"].includes(key) && value == null) continue;
      if (/^fluid-(?:width|height)-/.test(key) && !parentIsFluid) continue;
      if (["width-mode", "height-mode"].includes(key) && !parentIsFluid) continue;
      if (key === "container-layout" && !isContainer) continue;
      if (meta.source.type === "widget.basic.button-v2" && /^text-(default|click|hover|select)-indent$/.test(key)) continue;
      if (meta.source.type.startsWith("widget.group.buttons") && ["scrollbar-size", "scrollbar-color", "scrollbar-bg-color"].includes(key)
          && (options["layout-setting"] !== "scroll" || options["show-scrollbar"] !== true)) continue;
      if ((/^(?:flex-direction|fluid-(?:gap|align|justify)-)/.test(key) || key === "padding")
          && (!isContainer || options["container-layout"] !== "fluid")) continue;
      if (key === "linkage-advanced" && options["linkage-out"] !== true && options["linkage-in"] !== true) continue;
      if (key === "selection-advanced" && options["selection-out"] !== true && options["selection-in"] !== true) continue;
      if (key === "select-default-custom-type-value" && (options["select-default-type"] !== "custom"
          || options["select-default-custom-type"] !== "custom")) continue;
      if (key === "dropdown-default-value" && options["dropdown-default-type"] === "custom") continue;
      if (key === "dropdown-default-custom-type" && options["dropdown-default-type"] !== "custom") continue;
      if (key === "dropdown-default-custom-type-value" && (options["dropdown-default-type"] !== "custom"
          || options["dropdown-default-custom-type"] !== "custom")) continue;
      if (meta.source.type === "widget.basic.dropdown-v2") {
        const json = options["dropdown-option-setting"] === "data" && options["use-json-type"] === true;
        if (["use-json-node-linkage", "use-json-node-selection"].includes(key) && !json) continue;
        if (key === "json-node-linkage-fields" && (!json || options["use-json-node-linkage"] !== true)) continue;
        if (key === "json-node-selection-fields" && (!json || options["use-json-node-selection"] !== true)) continue;
      }
      if (key.startsWith("filter-") && options.filter !== true) continue;
      if (key === "filter-table-field-value" && (options["filter-condition"] !== "direct-judgment"
          || ["∅", "!∅"].includes(String(options["filter-table-field-condition"])))) continue;
    }
    if (!showAll && !query && kitRankingTypes.has(meta.source.type) && kitRankingKeys.has(key)
        && key !== "ranking-text" && options["ranking-text"] !== true) continue;
    const condition = definition.visibleWhen;
    if (!showAll && !query && condition && condition.key !== key) {
      // The reference lets users prepare a button state even before enabling it.
      const buttonSwitch = meta.source.type === "widget.basic.button-v2" && definition.group === "样式设置"
        && /^show-(click|hover|select)$/.test(condition.key);
      if (!buttonSwitch && "equals" in condition && options[condition.key] !== condition.equals) continue;
      if (!buttonSwitch && "notEquals" in condition && options[condition.key] === condition.notEquals) continue;
    }
    if (!showAll && !query && meta.source.type === KIT_WEATHER_TYPE
        && key === "connector" && options.temperature === false) continue;
    const weatherSection = meta.source.type === KIT_WEATHER_TYPE
      ? weatherInfoTabs.find(([, , keys]) => (keys as readonly string[]).includes(key))?.[1]
        ?? (weatherIconFields.has(key) ? "图标" : "") : "";
    if (query && !`${key} ${definition.label} ${definition.group} ${weatherSection}`.toLowerCase().includes(query.toLowerCase())) continue;
    const group = groups.get(definition.group) ?? [];
    group.push([key, value, definition]); groups.set(definition.group, group);
  }
  const children = state.scene.filter(item => item.parentId === node.id);
  const sorted = [...groups].sort(([a], [b]) => {
    const ai = groupOrder.indexOf(a), bi = groupOrder.indexOf(b);
    return (ai < 0 ? 11 : ai) - (bi < 0 ? 11 : bi);
  });
  const info = kitComponentInfo[meta.source.type];
  const dataFields = [...kitPrivateData(meta.source)?.fields ?? []];
  const rows = kitRows(node.bindings?.rows ? dataAt(available, node.bindings.rows) : available.rows, available.columns);
  for (const key of Object.keys(rows[0] ?? {})) if (!dataFields.some(field => field.uid === key)) dataFields.push({ uid: key, alias: key });
  const patchOptions = (changes: Record<string, unknown>, key: string) => getSceneBridge().post({
    type: "patchKitOptions", id: node.id, patch: changes,
    stateId: editStateId && !["position", "size", "rotate"].includes(key) ? editStateId : undefined,
  });
  const patch = (key: string, next: unknown) => patchOptions({ [key]: next }, key);
  const tooltipSection = (key: string) => {
    if (/^(?:show-)?cross-hairs-/.test(key)) return "pointer";
    if (/^tooltip-(?:right-)?(?:text-type|comma-display|decimal-places|complete-zero)$/.test(key)) return "format";
    if (/^tooltip-(?:name-font|value-font|title)/.test(key)) return "text";
    if (key.startsWith("tooltip-unit")) return "unit";
    return "basic";
  };
  const tooltipHasPointer = (groups.get("提示信息") ?? []).some(([key]) => tooltipSection(key) === "pointer");
  const activeTooltipTab = tooltipTab === "pointer" && !tooltipHasPointer ? "basic" : tooltipTab;
  const axisSection = (key: string): "X" | "Y" | "right" | undefined => {
    if (key.startsWith("y-polyline-") || key.startsWith("grid-y-polyline-")) return "right";
    if (key.startsWith("x-") || key.startsWith("grid-x-")) return "X";
    if (key.startsWith("y-") || key.startsWith("grid-y-")) return "Y";
    return undefined;
  };
  const axisHasRight = (groups.get("轴") ?? []).some(([key]) => axisSection(key) === "right");
  const activeAxisTab = axisTab === "right" && !axisHasRight ? "X" : axisTab;
  const fontSection = (key: string): "style" | "glow" | "shadow" =>
    key.startsWith("font-shadow-") ? "glow" : key.startsWith("shadow-") ? "shadow" : "style";
  const fontHasShadow = (groups.get("字体设置") ?? []).some(([key]) => fontSection(key) === "shadow");
  const activeFontTab = fontTab === "shadow" && !fontHasShadow ? "style" : fontTab;
  const buttonState = (key: string) => key.match(/(?:^|-)(default|click|hover|select)(?:-|$)/)?.[1];
  const buttonSection = (key: string) => {
    if (key.startsWith("animation-")) return "动画设置";
    if (key.startsWith("font-") && key.includes("-shadow-")) return "文字发光";
    if (key.startsWith("border-")) return "边框样式";
    if (/^(background-|use-nine-patch-|nine-patch-)/.test(key)) return "背景样式";
    return "文字样式";
  };
  const advancedEditor = (kind: KitLinkKind) => {
    const directions = (["out", "in"] as const).filter(direction => options[`${kind}-${direction}`] === true);
    if (!directions.length) return null;
    const selectedTab = kind === "linkage" ? linkageTab : selectionTab;
    const active = directions.includes(selectedTab) ? selectedTab : directions[0]!;
    const setTab = kind === "linkage" ? setLinkageTab : setSelectionTab;
    const labels = kind === "linkage" ? { out: "联动其他组件", in: "受其他组件联动" }
      : { out: "传递给其他组件", in: "接收其他组件传递" };
    const title = kind === "linkage" ? "联动组件选择" : "选中组件选择";
    const rule = kitAdvancedRule(options, kind, active);
    const targets = state.scene.filter(item => item.id !== node.id && kitMetadata(item));
    const chosen = rule.elements.map(kitLinkReference).filter(Boolean).map(id =>
      targets.find(item => item.id === id || kitMetadata(item)?.source.uid === id)?.id ?? id);
    const choices = targets.map(item => ({ label: item.name, value: item.id }));
    for (const id of chosen) if (!choices.some(item => item.value === id)) choices.push({ label: `未找到组件 (${id})`, value: id });
    const change = (key: string, value: unknown) => {
      const settingKey = `${kind}-advanced-settings`, directionKey = `${kind}-${active}`;
      const settings = kitRecord(options[settingKey]), previous = kitRecord(settings[directionKey]);
      patch(settingKey, { ...settings, [directionKey]: { ...previous, [`${kind}-mode`]: rule.mode,
        [`${kind}-elements`]: rule.elements, [key]: value } });
    };
    return <div className="kit-advanced-links" aria-label={title}>
      <div className="kit-advanced-title">{title}{directions.length === 1 ? ` - ${labels[active]}` : ""}</div>
      {directions.length > 1 && <div className="chart-label-tabs" role="tablist" aria-label={`${title}方向`}>
        {directions.map(direction => <button type="button" role="tab" key={direction} aria-selected={active === direction}
          onClick={() => setTab(direction)}>{labels[direction]}</button>)}
      </div>}
      <Field label="选择模式"><RadioGroup disabled={node.locked} className="flex gap-3" aria-label={`${title}选择模式`}
        value={rule.mode} onValueChange={value => change(`${kind}-mode`, value)}>
        <label className="flex items-center gap-1.5"><RadioGroupItem value="blacklist"/><span className="text-xs">黑名单模式</span></label>
        <label className="flex items-center gap-1.5"><RadioGroupItem value="whitelist"/><span className="text-xs">白名单模式</span></label>
      </RadioGroup></Field>
      <Field label="组件名单"><MultiSelect label={`${title}组件名单`} placeholder="请选择..."
        disabled={node.locked} value={chosen} options={choices}
        onChange={next => change(`${kind}-elements`, next)}/></Field>
    </div>;
  };
  const conditions = state.settings?.boardDataConditions ?? [];
  const conditionalStyles = kitRecord(options[KIT_CONDITION_STYLES]);
  const field = ([key, value, definition]: [string, unknown, KitOptionDefinition]) => {
    const settings = kitRecord(conditionalStyles[key]);
    const rules = Array.isArray(settings.rules) ? settings.rules : [];
    const path = JSON.stringify([key]);
    const dynamicFields = kitRecord(options["related-fields"]);
    const rowsForField = Array.isArray(options["related-entries"]) ? options["related-entries"] : [];
    const extensible = section === "style" && !definition.hidden && key !== "map-key" && key !== "cover-path"
      && !["size", "position", "rotate", "linkage-advanced", "selection-advanced"].includes(key)
      && ["boolean", "color", "number", "text", "select", "file", "font"].includes(definition.type ?? "");
    return <div key={`${node.id}-${editStateId ?? ""}-${key}`} className="kit-option-row" title={definition.label}>
      <Field label={definition.label}>{key === "cover-path" ? <Button size="sm" disabled={node.locked} onClick={() => {
        void captureWidgetCover(node.id).then(relativePath => patch(key, { relativePath, __opt_type: "file" }))
          .catch(error => Toast.error(String(error)));
      }}>截屏</Button> : <KitOptionValue label={definition.label} optionKey={key} widgetType={meta.source.type}
        value={value ?? (key === "text-font2" ? options["text-font"] : key === "font2" ? options.font
          : key === "unit-font2" ? options["unit-font"] : value)}
        definition={key === "filter-table-field" ? { ...definition, options: dataFields.map(field => ({
          value: field.uid, label: field.alias || field.uid,
        })) } : key === "filter-condition-select" ? { ...definition, options: (state.settings?.boardDataConditions ?? [])
          .map(condition => ({ value: condition.id, label: condition.name })) } : definition}
        fields={dataFields} menuChoices={menuChoices} disabled={node.locked} onChange={(next, edit) => {
          if (edit && Array.isArray(next) && (key === "button-name-option" || key === "dropdown-value-text-option"))
            patchOptions(kitChoiceEditPatch(options, key, next as string[], edit.previousIndices), key);
          else patch(key, next);
        }}/>}</Field>
      {extensible && <DropdownMenu>
        <DropdownMenuTrigger asChild><button type="button" className="kit-option-extension" disabled={node.locked}
          aria-label={`${definition.label}扩展设置`}><MoreOne size={14}/></button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setConditionStyle({ key, definition, base: value,
            otherwise: Object.hasOwn(settings, "otherwise") ? settings.otherwise : value,
            rules: rules.flatMap(item => {
              const rule = kitRecord(item);
              return typeof rule.condition === "string" ? [{ condition: rule.condition, value: rule.value }] : [];
            }) })}>条件样式</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setCodeExample(
            `function onEvent(payload, event, dw) {\n  dw.setOption(${JSON.stringify(node.id)}, ${JSON.stringify(key)}, ${JSON.stringify(value ?? null)});\n}`,
          )}>调用代码示例</DropdownMenuItem>
          <DropdownMenuItem disabled={Object.hasOwn(dynamicFields, path)} onClick={() => patchOptions({
            "related-entries": [...rowsForField, { name: path, alias: definition.label }],
            "related-fields": { ...dynamicFields, [path]: { "related-field": [] } },
          }, "related-fields")}>生成数据字段</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>}
      {extensible && rules.length > 0 && <span className="kit-condition-indicator">已启用条件样式</span>}
      {value === true && key === "linkage-advanced" ? advancedEditor("linkage") : null}
      {value === true && key === "selection-advanced" ? advancedEditor("selection") : null}
    </div>;
  };
  return <div className="kit-properties">
    {section === "style" && <div className="kit-property-heading">
      <span>{info?.name ?? meta.label}{info?.version ? `  |  v${info.version}` : ""}</span>
    </div>}
    {section === "style" && children.length > 0 && <div className="kit-children"><span>子组件</span>
      <SelectField label="选择套件子组件" placeholder={`包含 ${children.length} 个子组件`} value={null}
        options={children.map(child => ({ label: child.name, value: child.id }))}
        onChange={id => getSceneBridge().post({ type: "select", id: String(id) })}/>
    </div>}
    {section === "style" && meta.source.type === KIT_CITY_TYPE &&
      <section className="property-section"><Field label="画布显示几何">
        <Switch size="sm" aria-label="画布显示几何" disabled={node.locked}
          checked={options[KIT_CITY_GEOMETRY_OPTION] === true}
          onCheckedChange={value => patch(KIT_CITY_GEOMETRY_OPTION, value)}/>
      </Field></section>}
    <div className="kit-property-search"><span className="relative block">
      <Search size={13} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground"/>
      <Input className="h-7 pl-7 pr-7 text-xs" placeholder="搜索配置项"
        aria-label="搜索套件配置项" value={query} onChange={event => setQuery(event.target.value)}/>
      {query && <button type="button" aria-label="清空搜索" className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
        onClick={() => setQuery("")}><Close size={12}/></button>}
    </span>
      <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)} aria-pressed={showAll}>{showAll ? "常用" : "全部"}</Button>
    </div>
    {codeExample && <Dialog open onOpenChange={next => !next && setCodeExample("")}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>调用代码示例</DialogTitle></DialogHeader>
        <Textarea aria-label="调用代码示例" readOnly value={codeExample} rows={5} className="min-h-0 font-mono text-xs"/>
      </DialogContent>
    </Dialog>}
    {conditionStyle && <Dialog open onOpenChange={next => !next && setConditionStyle(null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{conditionStyle.definition.label} · 条件样式</DialogTitle></DialogHeader>
        {conditionStyle.rules.map((rule, index) => {
          const items = conditions.map(item => ({ label: item.name, value: item.id }));
          if (rule.condition && !items.some(item => item.value === rule.condition))
            items.push({ label: `未找到数据条件（${rule.condition}）`, value: rule.condition });
          const update = (rulePatch: Partial<typeof rule>) => setConditionStyle({ ...conditionStyle,
            rules: conditionStyle.rules.map((item, at) => at === index ? { ...item, ...rulePatch } : item) });
          return <div key={index} className="kit-condition-rule">
            <SelectField label={`数据条件${index + 1}`}
              value={rule.condition} placeholder="选择数据条件" options={items}
              onChange={value => update({ condition: String(value ?? "") })}/>
            <KitOptionValue value={rule.value} label={`条件${index + 1}样式`} optionKey={conditionStyle.key}
              definition={conditionStyle.definition} widgetType={meta.source.type} onChange={value => update({ value })}/>
            <Button size="sm" variant="ghost" aria-label={`删除条件样式${index + 1}`}
              onClick={() => setConditionStyle({ ...conditionStyle, rules: conditionStyle.rules.filter((_, at) => at !== index) })}><DeleteTwo size={12}/></Button>
          </div>;
        })}
        <Button size="sm" variant="ghost" disabled={conditions.length === 0}
          onClick={() => setConditionStyle({ ...conditionStyle,
            rules: [...conditionStyle.rules, { condition: "", value: conditionStyle.base }] })}><Plus size={12}/>添加条件样式</Button>
        {conditions.length === 0 && <p className="properties-note">请在「数据 → 数据条件」中创建条件。</p>}
        <Field label="当条件均不满足时"><KitOptionValue value={conditionStyle.otherwise} label="默认样式"
          definition={conditionStyle.definition} optionKey={conditionStyle.key} widgetType={meta.source.type}
          onChange={otherwise => setConditionStyle({ ...conditionStyle, otherwise })}/></Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConditionStyle(null)}>取消</Button>
          <Button onClick={() => {
            const rules = conditionStyle.rules.filter(rule => rule.condition);
            const next = { ...conditionalStyles };
            if (rules.length) next[conditionStyle.key] = { rules, otherwise: conditionStyle.otherwise };
            else delete next[conditionStyle.key];
            patch(KIT_CONDITION_STYLES, next);
            setConditionStyle(null);
          }}>确定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>}
    {section === "data" && options.filter === true && options["filter-condition"] === "data-condition"
      && typeof options["filter-condition-select"] === "string" && options["filter-condition-select"]
      && !(state.settings?.boardDataConditions ?? []).some(condition => condition.id === options["filter-condition-select"])
      ? <p className="properties-note">引用的数据条件未找到，可在“数据 → 数据条件”中重建后重新选择。</p> : null}
    <Panels key={`${node.id}-${query ? "search" : "normal"}-${showAll}`} className="properties-collapse"
      defaultKeys={query || section === "data" ? [...sorted.map(([name]) => name), "动态数据字段"] : ["基本设置", "大小&位置"]}>
      {section === "data" && (!query || "动态数据字段".includes(query)) &&
        <Panel key="动态数据字段" header="动态数据字段" itemKey="动态数据字段"><section className="property-section">
          <KitRelatedFields options={options} widgetType={meta.source.type} fields={dataFields} disabled={node.locked}
            onChange={next => getSceneBridge().post({ type: "patchKitOptions", id: node.id, patch: next })}/>
        </section></Panel>}
      {sorted.map(([group, fields]) => <Panel key={group} header={group} itemKey={group}>
        <section className="property-section">
          {group === "基本设置" && meta.source.type === KIT_WEATHER_TYPE && !query && !showAll ? <>
            {fields.filter(([key]) => !weatherIconFields.has(key) && !weatherInfoFields.has(key)).map(field)}
            <Panels className="properties-collapse chart-axis-subsections" defaultKeys={["图标", "天气信息"]}>
              <Panel itemKey="图标" header="图标">
                {fields.filter(([key]) => weatherIconFields.has(key)).map(field)}
              </Panel>
              <Panel itemKey="天气信息" header="天气信息">
                <div className="chart-label-tabs" role="tablist" aria-label="天气信息">
                  {weatherInfoTabs.map(([key, label]) =>
                    <button type="button" role="tab" key={key} aria-selected={weatherInfoTab === key}
                      onClick={() => setWeatherInfoTab(key)}>{label}</button>)}
                </div>
                {weatherInfoTabs.map(([key, label, keys]) => <div role="tabpanel" key={key} aria-label={label}
                  hidden={weatherInfoTab !== key}>
                  {fields.filter(([fieldKey]) => (keys as readonly string[]).includes(fieldKey)).map(field)}
                </div>)}
              </Panel>
            </Panels>
          </> : group === "样式设置" && meta.source.type === "widget.basic.button-v2" && !query && !showAll ? <>
            <div className="chart-label-tabs kit-button-state-tabs" role="tablist" aria-label="按钮样式状态">
              {([ ["default", "默认"], ["click", "点击时"], ["hover", "悬停时"], ["select", "选中后"] ] as const)
                .map(([key, label]) => <button type="button" role="tab" key={key} aria-selected={buttonStyleTab === key}
                  onClick={() => setButtonStyleTab(key)}>{label}</button>)}
            </div>
            <div role="tabpanel">
              {buttonStyleTab !== "default" && fields.filter(([key]) => key === `show-${buttonStyleTab}`).map(field)}
              <Panels key={buttonStyleTab} className="properties-collapse chart-axis-subsections">
                {(["文字样式", "文字发光", "边框样式", "背景样式",
                  ...(["click", "hover"].includes(buttonStyleTab) ? ["动画设置"] : [])])
                  .map(name => <Panel key={name} header={name} itemKey={name}>
                    <section className="property-section">{fields.filter(([key]) => !key.startsWith("show-")
                      && buttonState(key) === buttonStyleTab && buttonSection(key) === name).map(field)}</section>
                  </Panel>)}
              </Panels>
            </div>
          </> : group === "字体设置" && ["widget.basic.text", "widget.basic.paragraph"].includes(meta.source.type)
            && !query && !showAll ? <>
            <div className="chart-label-tabs" role="tablist" aria-label="字体设置类型">
              {([ ["style", "样式"], ["glow", "发光"],
                ...(fontHasShadow ? [["shadow", "投影"] as const] : []) ] as const)
                .map(([key, label]) => <button type="button" role="tab" key={key} aria-selected={activeFontTab === key}
                  onClick={() => setFontTab(key)}>{label}</button>)}
            </div>
            <div role="tabpanel">{fields.filter(([key]) => fontSection(key) === activeFontTab).map(field)}</div>
          </> : group === "轴" && meta.source.type.startsWith("widget.echarts.") && !query && !showAll ? <>
            <div className="chart-label-tabs" role="tablist" aria-label="坐标轴类型">
              {([ ["X", "X轴"], ["Y", "Y轴"], ...(axisHasRight
                ? [["right", "右侧Y轴"] as const] : []) ] as const).map(([key, label]) =>
                <button type="button" role="tab" key={key} aria-selected={activeAxisTab === key}
                  onClick={() => setAxisTab(key)}>{label}</button>)}
            </div>
            <div role="tabpanel">{fields.filter(([key]) => (!axisSection(key) || axisSection(key) === activeAxisTab)
              && (activeAxisTab !== "right" || key === "y-polyline-display" || options["y-polyline-display"] === true)).map(field)}</div>
          </> : group === "提示信息" && meta.source.type.startsWith("widget.echarts.") && !query && !showAll ? <>
            {fields.filter(([key]) => key === "tooltip").map(field)}
            {options.tooltip !== false && <>
              <div className="chart-label-tabs chart-tooltip-tabs" role="tablist" aria-label="提示信息设置">
                {([ ["basic", "基本样式"], ["format", "数据格式"], ["text", "文字样式"],
                  ["unit", "单位名称"], ...(tooltipHasPointer ? [["pointer", "辅助线设置"] as const] : []) ] as const)
                  .map(([key, label]) => <button type="button" role="tab" key={key} aria-selected={activeTooltipTab === key}
                    onClick={() => setTooltipTab(key)}>{label}</button>)}
              </div>
              <div role="tabpanel">{fields.filter(([key]) => key !== "tooltip" && tooltipSection(key) === activeTooltipTab
                && (!key.startsWith("tooltip-title-font") || options["tooltip-title"] === true)
                && (!key.startsWith("tooltip-unit-") || key === "tooltip-unit-name"
                  || options["tooltip-unit-name"] === true || options["tooltip-unit"] === true)
                && (!key.startsWith("cross-hairs-") && key !== "show-cross-hairs-label"
                  || options["show-cross-hairs-y"] === true || options["show-cross-hairs-x"] === true)
                && (!key.startsWith("cross-hairs-label-") || options["show-cross-hairs-label"] === true)).map(field)}</div>
            </>}
          </> : fields.map(field)}
        </section>
      </Panel>)}
    </Panels>
    {!sorted.length && !(section === "data" && (!query || "动态数据字段".includes(query)))
      && <p className="properties-note">没有找到匹配的配置项</p>}
    {meta.source.type === "widget.3d.city-builder" && meta.source.pieces?.length
      ? <KitPieceProperties key={`${node.id}-${section}`} node={node} pieces={meta.source.pieces} section={section}/> : null}
  </div>;
}
