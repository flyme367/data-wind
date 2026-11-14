import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { NumberInput } from "@/components/ui-ext/number-input";
import { Down } from "@icon-park/react";
import { chartItemValueOptions } from "../data/chartInteraction";
import { dataAt, type Interaction, type InteractionSettingSource } from "../data/editor";
import { currentSettingValue, resolveInteractionTargets, settingPatch, settingsForTargets } from "../data/interactionSettings";
import { asRecord } from "../data/runtimeScene";
import type { SceneNode } from "../types";
import { BufferedInput, ColorField, Field } from "./PropertyFields";

/** Semi Select multiple filter → DropdownMenu + CheckboxItem 多选（触发器显示已选标签）。 */
function MultiSelectField({ label, value, placeholder, options, onChange }: {
  label: string; value: string[]; placeholder?: string; options: readonly { value: string; label: string }[]; onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (optionValue: string, checked: boolean) =>
    onChange(checked ? [...value, optionValue] : value.filter(item => item !== optionValue));
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild><Button variant="outline" className="w-full justify-between font-normal" aria-label={label}>
      <span className="truncate text-left text-xs">{value.length
        ? value.map(item => options.find(option => option.value === item)?.label ?? item).join("、") : placeholder ?? "请选择"}</span>
      <Down theme="outline" size={12} className="shrink-0 opacity-60"/>
    </Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
      {options.map(option => <DropdownMenuCheckboxItem key={option.value} checked={value.includes(option.value)}
        onCheckedChange={checked => toggle(option.value, checked === true)}>{option.label}</DropdownMenuCheckboxItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export default function InteractionSettingFields({ rule, scene, sourceId, chartData, onChange }: {
  rule: Interaction;
  scene: SceneNode[];
  sourceId?: string;
  chartData?: Record<string, unknown>;
  onChange: (patch: Partial<Interaction>) => void;
}) {
  const scope = rule.targetScope;
  const ids = rule.targetIds ?? (rule.targetId ? [rule.targetId] : []);
  const parents = new Set(scene.flatMap(node => node.parentId ? [node.parentId] : []));
  const targets = scene.filter(node => scope ? parents.has(node.id) : node.type !== "group");
  const selected = resolveInteractionTargets(rule, sourceId, scene);
  const settings = settingsForTargets(selected);
  const setting = settings.find(item => item.key === rule.settingKey);
  const groups = Array.from(new Set(settings.map(item => item.group)));
  let stored: unknown;
  if (setting) {
    try { stored = dataAt(asRecord(JSON.parse(rule.value)), setting.key); }
    catch { /* Invalid imported settings are replaced when the user edits the value. */ }
  }
  const value = setting ? stored ?? currentSettingValue(selected[0], setting) : undefined;
  const source = rule.settingSource;
  const canUseComponent = rule.event === "itemClick" || rule.event === "custom" || source?.type === "component";
  const sourceOptions = [
    { value: "keep", label: "保持不变" },
    { value: "formula", label: "自定义公式" },
    ...(canUseComponent ? [{ value: "component", label: "当前组件值" }] : []),
  ];
  const fields = chartItemValueOptions(chartData);
  if (source?.type === "component" && !fields.some(field => field.value === source.field)) {
    fields.push({ value: source.field, label: source.field });
  }
  const chooseSource = (type: unknown): InteractionSettingSource => {
    if (type === "keep") return { type };
    if (type === "component") return { type, field: "value" };
    return { type: "formula", expression: "" };
  };
  const updateValue = (value: unknown) => {
    if (setting) onChange({ value: settingPatch(setting, value) });
  };
  const clearSetting = { settingKey: undefined, settingSource: undefined, value: "" };

  return <>
    <Field label="目标组件"><Select aria-label="目标组件范围" value={scope?.mode ?? "direct"}
      onValueChange={mode => typeof mode === "string" && onChange({ ...clearSetting,
        targetScope: mode === "children" || mode === "currentChildren"
          ? { mode, query: "", recursive: false } : undefined,
        targetId: "", targetIds: [],
      })}>
      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{[
        { value: "direct", label: "指定组件" },
        { value: "children", label: "筛选指定组件的子组件" },
        ...(sourceId ? [{ value: "currentChildren", label: "筛选当前组件的子组件" }] : []),
      ].map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
    </Select></Field>
    {scope?.mode !== "currentChildren" && <Field label="指定组件"><MultiSelectField label="指定组件" value={ids} placeholder="请选择..."
      options={targets.map(target => ({ value: target.id,
        label: target.id === sourceId ? `当前组件 · ${target.name}` : target.name }))}
      onChange={(targetIds) => onChange({ ...clearSetting, targetIds, targetId: targetIds[0] ?? "" })}/></Field>}
    {scope && <>
      <Field label="筛选词"><Input aria-label="子组件筛选词" value={scope.query} maxLength={300}
        onChange={(event) => onChange({ targetScope: { ...scope, query: event.target.value } })}/></Field>
      <Field label="多层筛选"><Switch aria-label="多层筛选" checked={scope.recursive}
        onCheckedChange={recursive => onChange({ targetScope: { ...scope, recursive } })}/></Field>
    </>}
    <Field label="设置项"><Select aria-label="设置项" value={rule.settingKey} disabled={!selected.length}
      onValueChange={(key) => {
        if (typeof key !== "string") return;
        const setting = settings.find(item => item.key === key);
        onChange({ settingKey: key, settingSource: undefined, value: setting
          ? settingPatch(setting, currentSettingValue(selected[0], setting)) : "{}" });
      }}>
      <SelectTrigger className="w-full"><SelectValue placeholder="请选择..." /></SelectTrigger>
      <SelectContent>
        {groups.map(group => <SelectGroup key={group}>
          <SelectLabel>{group}</SelectLabel>
          {settings.filter(item => item.group === group).map(item =>
            <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}
        </SelectGroup>)}
        <SelectGroup><SelectLabel>高级</SelectLabel><SelectItem value="custom">自定义 JSON</SelectItem></SelectGroup>
      </SelectContent>
    </Select></Field>
    {setting && <Field label="动态值"><Switch aria-label="使用动态值" checked={Boolean(source)}
      onCheckedChange={checked => onChange({ settingSource: checked ? chooseSource(canUseComponent ? "component" : "formula") : undefined })}/></Field>}
    {setting && source && <Field label="值来源"><Select aria-label="动态值来源" value={source.type}
      onValueChange={type => typeof type === "string" && onChange({ settingSource: chooseSource(type) })}>
      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{sourceOptions.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
    </Select></Field>}
    {setting && source?.type === "component" && <Field label="组件值"><Select aria-label="当前组件值"
      value={source.field} onValueChange={field => typeof field === "string" && onChange({ settingSource: { type: "component", field: field.slice(0, 300) } })}>
      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{fields.map(field => <SelectItem key={field.value} value={field.value}>{field.label}</SelectItem>)}</SelectContent>
    </Select></Field>}
    {setting && source?.type === "formula" && <Field label="公式"><Input aria-label="动态值公式" maxLength={1000}
      value={source.expression} placeholder={rule.event === "itemClick" ? "{:payload.value}" : "{:项目参数名}"}
      onChange={(event) => onChange({ settingSource: { type: "formula", expression: event.target.value } })}/></Field>}
    {!source && setting?.type === "boolean" && <Field label="设置值"><Switch aria-label="设置值"
      checked={typeof value === "boolean" ? value : setting.initial} onCheckedChange={updateValue}/></Field>}
    {!source && setting?.type === "number" && <Field label="设置值"><NumberInput aria-label="设置值"
      min={setting.min} max={setting.max} step={setting.step ?? 1}
      value={typeof value === "number" ? value : setting.initial}
      onChange={value => typeof value === "number" && updateValue(value)}/></Field>}
    {!source && setting?.type === "text" && <Field label="设置值"><Input aria-label="设置值"
      value={String(value ?? "")} onChange={(event) => updateValue(event.target.value)}/></Field>}
    {!source && setting?.type === "select" && <Field label="设置值"><Select aria-label="设置值"
      value={String(value ?? setting.initial)} onValueChange={updateValue}>
      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{setting.options.map(item =>
        <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
    </Select></Field>}
    {!source && setting?.type === "color" && <ColorField label="设置值" value={String(value ?? setting.initial)} onChange={updateValue}/>}
    {rule.settingKey === "custom" && <Field label="设置值"><BufferedInput label="设置 JSON" value={rule.value}
      placeholder={'{"visible":true,"data":{"chart":{"showLegend":false}}}'}
      onChange={value => onChange({ value })}/></Field>}
  </>;
}
