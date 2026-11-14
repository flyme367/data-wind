import { Input, InputNumber, Select, Switch } from "@douyinfe/semi-ui";
import { chartItemValueOptions } from "../data/chartInteraction";
import { dataAt, type Interaction, type InteractionSettingSource } from "../data/editor";
import { currentSettingValue, resolveInteractionTargets, settingPatch, settingsForTargets } from "../data/interactionSettings";
import { asRecord } from "../data/runtimeScene";
import type { SceneNode } from "../types";
import { BufferedInput, ColorField, Field } from "./PropertyFields";

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
    <Field label="目标组件"><Select aria-label="目标组件范围" value={scope?.mode ?? "direct"} optionList={[
      { value: "direct", label: "指定组件" },
      { value: "children", label: "筛选指定组件的子组件" },
      ...(sourceId ? [{ value: "currentChildren", label: "筛选当前组件的子组件" }] : []),
    ]} onChange={mode => onChange({ ...clearSetting,
      targetScope: mode === "children" || mode === "currentChildren"
        ? { mode, query: "", recursive: false } : undefined,
      targetId: "", targetIds: [],
    })}/></Field>
    {scope?.mode !== "currentChildren" && <Field label="指定组件"><Select multiple filter aria-label="指定组件" value={ids} placeholder="请选择..."
      optionList={targets.map(target => ({ value: target.id,
        label: target.id === sourceId ? `当前组件 · ${target.name}` : target.name }))}
      onChange={(value) => {
        const targetIds = Array.isArray(value) ? value.map(String) : [];
        onChange({ ...clearSetting, targetIds, targetId: targetIds[0] ?? "" });
      }}/></Field>}
    {scope && <>
      <Field label="筛选词"><Input aria-label="子组件筛选词" value={scope.query} maxLength={300}
        onChange={query => onChange({ targetScope: { ...scope, query } })}/></Field>
      <Field label="多层筛选"><Switch aria-label="多层筛选" checked={scope.recursive}
        onChange={recursive => onChange({ targetScope: { ...scope, recursive } })}/></Field>
    </>}
    <Field label="设置项"><Select aria-label="设置项" value={rule.settingKey} disabled={!selected.length}
      placeholder="请选择..." onChange={(key) => {
        const setting = settings.find(item => item.key === key);
        onChange({ settingKey: String(key), settingSource: undefined, value: setting
          ? settingPatch(setting, currentSettingValue(selected[0], setting)) : "{}" });
      }}>
      {groups.map(group => <Select.OptGroup key={group} label={group}>
        {settings.filter(item => item.group === group).map(item =>
          <Select.Option key={item.key} value={item.key}>{item.label}</Select.Option>)}
      </Select.OptGroup>)}
      <Select.OptGroup label="高级"><Select.Option value="custom">自定义 JSON</Select.Option></Select.OptGroup>
    </Select></Field>
    {setting && <Field label="动态值"><Switch aria-label="使用动态值" checked={Boolean(source)}
      onChange={checked => onChange({ settingSource: checked ? chooseSource(canUseComponent ? "component" : "formula") : undefined })}/></Field>}
    {setting && source && <Field label="值来源"><Select aria-label="动态值来源" value={source.type}
      optionList={sourceOptions} onChange={type => onChange({ settingSource: chooseSource(type) })}/></Field>}
    {setting && source?.type === "component" && <Field label="组件值"><Select aria-label="当前组件值" filter allowCreate
      value={source.field} optionList={fields}
      onChange={value => onChange({ settingSource: { type: "component", field: String(value ?? "").slice(0, 300) } })}/></Field>}
    {setting && source?.type === "formula" && <Field label="公式"><Input aria-label="动态值公式" maxLength={1000}
      value={source.expression} placeholder={rule.event === "itemClick" ? "{:payload.value}" : "{:项目参数名}"}
      onChange={expression => onChange({ settingSource: { type: "formula", expression } })}/></Field>}
    {!source && setting?.type === "boolean" && <Field label="设置值"><Switch aria-label="设置值"
      checked={typeof value === "boolean" ? value : setting.initial} onChange={updateValue}/></Field>}
    {!source && setting?.type === "number" && <Field label="设置值"><InputNumber aria-label="设置值"
      min={setting.min} max={setting.max} step={setting.step ?? 1}
      value={typeof value === "number" ? value : setting.initial}
      onChange={value => typeof value === "number" && updateValue(value)}/></Field>}
    {!source && setting?.type === "text" && <Field label="设置值"><Input aria-label="设置值"
      value={String(value ?? "")} onChange={updateValue}/></Field>}
    {!source && setting?.type === "select" && <Field label="设置值"><Select aria-label="设置值"
      value={String(value ?? setting.initial)} optionList={setting.options} onChange={updateValue}/></Field>}
    {!source && setting?.type === "color" && <ColorField label="设置值" value={String(value ?? setting.initial)} onChange={updateValue}/>}
    {rule.settingKey === "custom" && <Field label="设置值"><BufferedInput label="设置 JSON" value={rule.value}
      placeholder={'{"visible":true,"data":{"chart":{"showLegend":false}}}'}
      onChange={value => onChange({ value })}/></Field>}
  </>;
}
