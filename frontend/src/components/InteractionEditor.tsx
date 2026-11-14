import { useMemo, useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NumberInput } from "@/components/ui-ext/number-input";
import { Toast } from "@/lib/toast";
import { chartItemNames } from "../data/chartInteraction";
import { DATA_FILTER_OPS, type DataFilterOp } from "../data/dataSources";
import { isChartWidget, isValidSettingSource, type Interaction } from "../data/editor";
import { resolveInteractionTargets, settingsForTargets } from "../data/interactionSettings";
import { resolveRuntimeNode } from "../data/runtimeScene";
import type { SceneNode } from "../types";
import { downloadFile } from "../state/projects";
import { useStore } from "../state/store";
import { getSceneBridge } from "../workers/bridge";
import { BufferedInput, Field } from "./PropertyFields";
import InteractionSettingFields from "./InteractionSettingFields";

const boardEventOptions = [
  { value: "click", label: "单击看板空白处" }, { value: "dblclick", label: "双击看板空白处" },
  { value: "data", label: "满足数据条件时" }, { value: "boardActive", label: "全屏播放 / 切到当前看板时" },
  { value: "custom", label: "接收到二次开发中的事件" },
];
const componentEventOptions = [
  { value: "click", label: "单击组件时" }, { value: "dblclick", label: "双击组件时" },
  { value: "mouseenter", label: "鼠标移入组件时" }, { value: "mouseleave", label: "鼠标移出组件时" },
  { value: "componentEnter", label: "组件入场时" }, { value: "componentLeave", label: "组件离场时" },
  { value: "componentSelected", label: "组件选中时" }, { value: "componentUnselected", label: "组件取消选中时" },
  { value: "itemClick", label: "点击组件内元素时" }, { value: "custom", label: "接收到二次开发中的事件" },
];
const chartEventOptions = [
  { value: "click", label: "点击" }, { value: "mouseenter", label: "鼠标移入时" },
  { value: "mouseleave", label: "鼠标移出时" }, { value: "componentEnter", label: "入场" },
  { value: "componentLeave", label: "离场" }, { value: "itemClick", label: "点击元素" },
  { value: "custom", label: "接收到二次开发中的事件" },
];
const actionGroups: [string, { value: Interaction["action"]; label: string }[]][] = [
  ["组件控制", [
    { value: "message", label: "提示消息" },
    { value: "state", label: "切换状态" }, { value: "modify", label: "修改设置" }, { value: "dialog", label: "控制弹窗" },
    { value: "componentCustom", label: "组件自定义" }, { value: "toggle", label: "切换显示" }, { value: "show", label: "显示对象" },
    { value: "hide", label: "隐藏对象" }, { value: "text", label: "设置文本" }, { value: "color", label: "改变颜色" }, { value: "focus", label: "定位视角" },
  ]],
  ["项目控制", [
    { value: "refresh", label: "刷新数据" }, { value: "fullscreen", label: "全屏播放控制" }, { value: "projectParams", label: "修改项目参数" },
    { value: "logout", label: "访客退出登录" }, { value: "payload", label: "Payload 写入内置数据源" },
    { value: "boardState", label: "切换看板状态" },
  ]],
  ["导航跳转", [{ value: "navigateBoard", label: "子看板跳转" }, { value: "openUrl", label: "打开链接" }]],
  ["事件与开发", [
    { value: "passEvent", label: "传递事件" }, { value: "devEvent", label: "触发二次开发中的事件" }, { value: "script", label: "执行脚本" },
  ]],
  ["动画效果", [{ value: "playEntrance", label: "播放入场动画" }]],
  ["高级 / 其他", [{ value: "none", label: "空动作" }]],
];
const actionsWithTarget = new Set<Interaction["action"]>(["focus", "color", "state", "text", "dialog", "componentCustom", "toggle", "show", "hide", "playEntrance"]);

const actionLabel = (action: Interaction["action"]) =>
  actionGroups.flatMap(([, items]) => items).find(item => item.value === action)?.label ?? "交互";

function defaultRule(node: SceneNode | null): Interaction {
  return { id: crypto.randomUUID(), name: "", event: node ? "click" : "data", action: "state", targetId: node?.id ?? "",
    value: node?.widget?.states?.[0]?.id ?? "", sequence: "with" };
}

/** Semi Select → shadcn Select：受控 value + onValueChange，optionList 展开成 SelectItem。 */
function SelectField({ label, value, placeholder, options, onChange }: {
  label: string; value?: string; placeholder?: string; options: readonly { value: string; label: string }[]; onChange: (value: string) => void;
}) {
  return <Select aria-label={label} value={value} onValueChange={next => typeof next === "string" && onChange(next)}>
    <SelectTrigger className="w-full"><SelectValue placeholder={placeholder} /></SelectTrigger>
    <SelectContent>{options.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
  </Select>;
}

export default function InteractionEditor({ node }: { node: SceneNode | null }) {
  const state = useStore();
  const isBoard = !node;
  const isChart = Boolean(node?.widget && node.widget.kind !== "table" && isChartWidget(node.widget.kind));
  const rules = isBoard ? state.settings.boardInteractions : node.interactions ?? [];
  const availableEventOptions = isBoard ? boardEventOptions : isChart ? [...chartEventOptions,
    ...componentEventOptions.filter(item => !chartEventOptions.some(option => option.value === item.value)
      && rules.some(rule => rule.event === item.value))] : componentEventOptions;
  const locked = node?.locked ?? false;
  const [visible, setVisible] = useState(false);
  const [conditionVisible, setConditionVisible] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "clear" } | { kind: "delete"; rule: Interaction } | null>(null);
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState<Interaction>(() => defaultRule(node));
  const [conditionDraft, setConditionDraft] = useState<NonNullable<Interaction["condition"]>>({ sourceId: "", field: "", op: "==", value: "" });
  const chartData = useMemo(() => isChart && node ? resolveRuntimeNode(node, state.liveData, {}).data
    : undefined, [isChart, node, state.liveData]);
  const itemNames = useMemo(() => chartItemNames(chartData), [chartData]);
  const itemOptions = [
    { value: "@", label: "所有项" },
    ...itemNames.map(name => ({ value: name, label: name })),
    ...(draft.itemValue && !itemNames.includes(draft.itemValue)
      ? [{ value: draft.itemValue, label: draft.itemValue }] : []),
  ];
  const dataSources = useMemo(() => [
    ...state.settings.boardSharedData.filter((item) => item.enabled).map((item) => ({ value: item.id, label: item.name })),
    ...state.scene.filter((item) => item.dataSource?.enabled).map((item) => ({ value: item.id, label: item.name })),
    { value: "builtin:payload", label: "内置数据 · Payload" },
    { value: "builtin:project-params", label: "内置数据 · 项目参数" },
  ], [state.settings.boardSharedData, state.scene]);
  const targets = state.scene.filter((item) => item.type !== "group");
  const dialogTargets = targets.filter(item => item.widget?.kind === "dialog"
    || (editingId && item.id === draft.targetId));
  const target = targets.find((item) => item.id === draft.targetId);
  const targetStates = target?.widget?.states ?? [];
  const updateDraft = (patch: Partial<Interaction>) => setDraft(current => ({ ...current, ...patch }));
  const saveRules = (next: Interaction[]) => {
    if (isBoard) getSceneBridge().post({ type: "configure", patch: { boardInteractions: next } });
    else if (node) getSceneBridge().post({ type: "patch", id: node.id, patch: { interactions: next.length ? next : undefined } });
  };
  const openAdd = () => { setEditingId(""); setDraft(defaultRule(node)); setVisible(true); };
  const openEdit = (rule: Interaction) => {
    setEditingId(rule.id);
    setDraft({ ...rule, actionEventName: rule.actionEventName ?? rule.triggerValue,
      ...(rule.action === "modify" ? { settingKey: rule.settingKey ?? "custom" } : {}) });
    setVisible(true);
  };
  const saveDraft = () => {
    const draftName = draft.name?.trim() || actionLabel(draft.action);
    if (actionsWithTarget.has(draft.action) && !(draft.targetId || node?.id)) { Toast.error("请先选择目标组件"); return; }
    if (draft.action === "modify") {
      const selected = resolveInteractionTargets(draft, node?.id, state.scene);
      if (!selected.length) { Toast.error(draft.targetScope ? "没有匹配的子组件" : "请先指定组件"); return; }
      if (draft.settingKey !== "custom" && !settingsForTargets(selected).some(item => item.key === draft.settingKey)) {
        Toast.error("请选择适用的设置项");
        return;
      }
      if (draft.settingSource && !isValidSettingSource(draft.settingSource)) {
        Toast.error(draft.settingSource.type === "formula" ? "请填写动态值公式" : "请选择动态值字段");
        return;
      }
    }
    if (draft.action === "dialog" && !dialogTargets.some(item => item.id === draft.targetId)) {
      Toast.error("请选择目标弹窗");
      return;
    }
    if (draft.action === "fullscreen" && !draft.value && !editingId) {
      Toast.error("请选择全屏操作");
      return;
    }
    if (draft.event === "data" && (!draft.condition?.sourceId || !draft.condition.field.trim())) { Toast.error("请配置数据源和数据字段"); return; }
    if (draft.event === "custom" && !draft.triggerValue?.trim()) { Toast.error("请填写二次开发事件名称"); return; }
    if (["componentCustom", "passEvent", "devEvent"].includes(draft.action) && !draft.actionEventName?.trim()) { Toast.error("请填写动作事件名称"); return; }
    if (draft.action === "state" && (!target?.widget
      || (draft.value && !targetStates.some((item) => item.id === draft.value)))) {
      Toast.error("请为目标组件选择一个状态"); return;
    }
    if (draft.action === "color" && !/^#[0-9a-f]{6}$/i.test(draft.value)) { Toast.error("颜色须为 #RRGGBB 格式"); return; }
    if (draft.action === "openUrl") {
      try { const url = new URL(draft.value); if (!["http:", "https:"].includes(url.protocol)) throw new Error(); }
      catch { Toast.error("请输入有效的 HTTP 或 HTTPS 链接"); return; }
    }
    if (draft.action === "navigateBoard" && !draft.value.trim()) { Toast.error("请填写目标看板"); return; }
    if (draft.action === "script" && !state.settings.boardScripts.some((item) => item.id === draft.value && item.enabled)) {
      Toast.error("请选择一个已启用的脚本"); return;
    }
    if ((draft.action === "modify" && !draft.settingSource) || draft.action === "projectParams") {
      try {
        const parsed: unknown = JSON.parse(draft.value);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      } catch { Toast.error(draft.action === "modify" ? "修改设置需要 JSON 对象" : "项目参数需要 JSON 对象"); return; }
    }
    const nextRule = { ...draft, name: draftName, targetId: draft.targetId || node?.id || "" };
    saveRules(editingId ? rules.map((rule) => rule.id === editingId ? nextRule : rule) : [...rules, nextRule]);
    setVisible(false);
    Toast.success(editingId ? "交互已更新" : "交互已添加");
  };
  const deleteRule = (id: string) => saveRules(rules.filter((rule) => rule.id !== id));
  const editCondition = () => {
    setConditionDraft(draft.condition ?? { sourceId: dataSources[0]?.value ?? "", field: "", op: "==", value: "" });
    setConditionVisible(true);
  };
  const saveCondition = () => {
    setDraft((current) => ({ ...current, condition: { ...conditionDraft, field: conditionDraft.field.trim() } }));
    setConditionVisible(false);
  };

  return <section className="property-section metadata-panel interaction-editor">
    <div className="interaction-heading"><h4>交互设置</h4>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="交互设置更多操作">⋮</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!rules.length}
            onClick={() => downloadFile("看板交互规则.json", JSON.stringify(rules, null, 2))}>导出交互规则 JSON</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" disabled={!rules.length || locked} onClick={() => setConfirm({ kind: "clear" })}>清空全部规则</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    {rules.length === 0 ? <p className="properties-note">{isBoard ? "为看板添加事件规则，在预览或播放时执行。" : "在预览中触发组件规则；编辑状态不会写入场景。"}</p> :
      <div className="interaction-list">{rules.map((rule) => <article className="interaction-rule-card" key={rule.id}>
        <div className="interaction-rule-summary"><strong>{rule.name || "未命名交互"}</strong><span>{availableEventOptions.find((item) => item.value === rule.event)?.label ?? "未知事件"} · {actionLabel(rule.action)}</span></div>
        <div className="interaction-rule-actions"><Button variant="ghost" size="sm" disabled={locked} onClick={() => openEdit(rule)}>编辑</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`更多${rule.name}操作`}>⋮</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={locked} onClick={() => { const copy = { ...rule, id: crypto.randomUUID(), name: `${rule.name || "交互"} 副本` }; saveRules([...rules, copy]); }}>复制</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" disabled={locked}
                onClick={() => setConfirm({ kind: "delete", rule })}>删除</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </article>)}</div>}
    <Button className="w-full" size="sm" disabled={locked} onClick={openAdd}>＋ 添加交互</Button>

    <Dialog open={visible} onOpenChange={(open) => { if (!open) setVisible(false); }}>
      <DialogContent showCloseButton={false} className="interaction-rule-layer interaction-rule-modal sm:max-w-[380px]">
        <DialogHeader><DialogTitle>{editingId ? "编辑交互" : "添加交互"}</DialogTitle></DialogHeader>
      <div className="interaction-form">
        <section className="interaction-form-section">
          <h4><span aria-hidden="true">◇</span> 名称</h4>
          <Field label="名称"><Input aria-label="交互名称" value={draft.name} maxLength={100} placeholder={actionLabel(draft.action)}
            onChange={(event) => updateDraft({ name: event.target.value })}/></Field>
        </section>
        <section className="interaction-form-section">
          <h4><span aria-hidden="true">⚡</span> 事件</h4>
          <Field label="触发"><Select aria-label="触发事件" value={draft.event}
            onValueChange={(event) => setDraft((current) => ({ ...current, event: event as Interaction["event"], ...(event === "data" && !current.condition ? { condition: { sourceId: "", field: "", op: "==", value: "" } } : {}) }))}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{availableEventOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
          </Select></Field>
          {draft.event === "data" && <Field label="数据条件"><div className="interaction-condition-row">
            <SelectField label="交互数据源" value={draft.condition?.sourceId} placeholder="请选择..." options={dataSources}
              onChange={(sourceId) => setDraft((current) => ({ ...current, condition: { ...(current.condition ?? { field: "", op: "==", value: "" }), sourceId } }))}/>
            <Button variant="outline" size="sm" aria-label="配置数据条件" disabled={!draft.condition?.sourceId} onClick={editCondition}>⌕＋</Button>
          </div></Field>}
          {draft.event === "custom" && <Field label="事件名称"><Input aria-label="二次开发事件名称" value={draft.triggerValue ?? ""} placeholder="例如：device-alert"
            onChange={(event) => setDraft((current) => ({ ...current, triggerValue: event.target.value }))}/></Field>}
          {isChart && draft.event === "itemClick"
            ? <Field label="数据项"><Select aria-label="点击的数据项"
              value={draft.itemValue || "@"} onValueChange={value => updateDraft({ itemValue: (value === "@" ? "" : value).slice(0, 300) })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{itemOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select></Field>
            : ["itemClick", "componentSelected", "componentUnselected"].includes(draft.event)
              && <Field label="选项值"><Input aria-label="组件内选项值"
                value={draft.itemValue ?? ""} placeholder="留空表示所有选项" maxLength={300}
                onChange={(event) => updateDraft({ itemValue: event.target.value })}/></Field>}
        </section>
        <section className="interaction-form-section">
          <h4><span aria-hidden="true">☆</span> 动作</h4>
        <Field label="动作"><Select aria-label="交互动作" value={draft.action} onValueChange={(action) => setDraft((current) => ({ ...current,
          action: action as Interaction["action"],
          value: "", settingKey: undefined, settingSource: undefined, targetIds: undefined, targetScope: undefined,
          ...(action === "state" ? { value: state.scene.find((item) => item.id === current.targetId)?.widget?.states?.[0]?.id ?? "" } : {}),
          ...(action === "boardState" ? { value: state.settings.boardStates[0]?.id ?? "" } : {}),
          ...(action === "dialog" ? { value: "toggle", targetId: node?.widget?.kind === "dialog" ? node.id : "" } : {}) }))}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {actionGroups.map(([group, items]) => {
              const available = items.filter((item) => item.value !== "boardState" || isBoard);
              return available.length ? <SelectGroup key={group}>
                <SelectLabel>{group}</SelectLabel>
                {available.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
              </SelectGroup> : null;
            })}
          </SelectContent>
        </Select></Field>
        {draft.action === "boardState" && <Field label="看板状态"><SelectField label="目标看板状态" value={draft.value || "@"} options={[{ value: "@", label: "默认状态" }, ...state.settings.boardStates.map((item) => ({ value: item.id, label: item.name }))]}
          onChange={(value) => setDraft((current) => ({ ...current, value: value === "@" ? "" : value }))}/></Field>}
        {actionsWithTarget.has(draft.action) && (draft.action !== "playEntrance" || isBoard || (draft.targetId && draft.targetId !== node?.id))
          && <Field label="目标组件"><SelectField label="目标组件" value={draft.targetId} placeholder="请选择..."
          options={(draft.action === "dialog" ? dialogTargets : targets).map((item) => ({ value: item.id, label: item.name }))}
          onChange={(targetId) => setDraft((current) => ({ ...current, targetId, ...(current.action === "state" ? { value: state.scene.find((item) => item.id === targetId)?.widget?.states?.[0]?.id ?? "" } : {}) }))}/></Field>}
        {draft.action === "state" && <Field label="状态"><SelectField label="目标状态" value={draft.value || "@"} placeholder="选择状态"
          options={[{ value: "@", label: "默认状态" }, ...targetStates.map(item => ({ value: item.id, label: item.name }))]}
          onChange={value => setDraft(current => ({ ...current, value: value === "@" ? "" : value }))}/></Field>}
        {draft.action === "dialog" && <Field label="弹窗动作"><SelectField label="弹窗动作" value={draft.value || "toggle"}
          options={[{ value: "open", label: "打开弹窗" }, { value: "close", label: "关闭弹窗" }, { value: "toggle", label: "切换显示" }]}
          onChange={(value) => setDraft((current) => ({ ...current, value }))}/></Field>}
        {draft.action === "fullscreen" && <Field label="操作"><SelectField label="全屏操作"
          value={draft.value || (editingId ? "toggle" : undefined)} placeholder="请选择..." options={[
            { value: "enter", label: "进入全屏" }, { value: "exit", label: "退出全屏" },
            ...(editingId && (!draft.value || draft.value === "toggle") ? [{ value: "toggle", label: "切换全屏" }] : []),
          ]} onChange={value => updateDraft({ value })}/></Field>}
        {draft.action === "modify" && <InteractionSettingFields rule={draft} scene={state.scene}
          sourceId={node?.id} chartData={chartData} onChange={updateDraft}/>}
        {draft.action === "navigateBoard" && <Field label="目标子看板"><SelectField label="目标子看板" placeholder="请选择..."
          value={state.settings.boardPages.find(page => page.id === draft.value || page.name === draft.value)?.id ?? draft.value}
          options={state.settings.boardPages.map(page => ({ value: page.id, label: page.name }))}
          onChange={value => updateDraft({ value })}/></Field>}
        {draft.action === "script" && <Field label="脚本"><SelectField label="执行脚本" value={draft.value} placeholder="选择启用的脚本"
          options={state.settings.boardScripts.filter((item) => item.enabled).map((item) => ({ value: item.id, label: item.name }))}
          onChange={(value) => setDraft((current) => ({ ...current, value }))}/></Field>}
        {["componentCustom", "passEvent", "devEvent"].includes(draft.action) && <Field label="事件名称"><Input aria-label="动作事件名称" value={draft.actionEventName ?? ""} placeholder="例如：device-alert"
          onChange={(event) => setDraft((current) => ({ ...current, actionEventName: event.target.value }))}/></Field>}
        {!["state", "boardState", "dialog", "logout", "refresh", "fullscreen", "focus", "toggle", "show", "hide", "none", "script", "playEntrance", "modify", "navigateBoard"].includes(draft.action) && <Field label={draft.action === "openUrl" ? "链接" : "参数"}><BufferedInput label="动作参数" value={draft.value} placeholder={draft.action === "color" ? "#5B7CFA" : draft.action === "openUrl" ? "https://example.com" : "留空使用触发数据"} onChange={(value) => updateDraft({ value })}/></Field>}
        {draft.action === "playEntrance" && <>
          <Field label="动画"><SelectField label="入场动画" value={draft.animation ?? "fade"} options={[
            { value: "fade", label: "淡入" }, { value: "slideLeft", label: "从左进入" }, { value: "slideRight", label: "从右进入" },
            { value: "slideUp", label: "从上进入" }, { value: "slideDown", label: "从下进入" }, { value: "zoom", label: "缩放进入" },
          ]} onChange={(animation) => setDraft((current) => ({ ...current, animation: animation as Interaction["animation"] }))}/></Field>
          <Field label="动画叠加"><SelectField label="动画叠加" value={draft.animationStack ? "stack" : "replace"}
            options={[{ value: "replace", label: "不叠加" }, { value: "stack", label: "叠加" }]}
            onChange={(value) => setDraft((current) => ({ ...current, animationStack: value === "stack" }))}/></Field>
          <Field label="缓动方式"><SelectField label="动画缓动方式" value={draft.easing ?? "exponentialIn"} options={[
            { value: "exponentialIn", label: "指数进入" }, { value: "exponentialOut", label: "指数退出" },
            { value: "linear", label: "线性" }, { value: "easeInOut", label: "平滑进出" },
          ]} onChange={(easing) => setDraft((current) => ({ ...current, easing: easing as Interaction["easing"] }))}/></Field>
        </>}
        <Field label="顺序"><SelectField label="执行顺序" value={draft.sequence ?? "with"}
          options={[{ value: "with", label: "与上一动作同时" }, { value: "after", label: "之后" }]}
          onChange={(sequence) => setDraft((current) => ({ ...current, sequence: sequence as Interaction["sequence"] }))}/></Field>
        <Field label="延时 (ms)"><NumberInput aria-label="交互延时毫秒" min={0} max={120000} step={100} value={draft.delayMs ?? 0}
          onChange={(delayMs) => typeof delayMs === "number" && setDraft((current) => ({ ...current, delayMs }))}/></Field>
        {draft.action === "playEntrance" && <Field label="时长 (ms)"><NumberInput aria-label="动画时长毫秒" min={0} max={120000} step={100} value={draft.durationMs ?? 1000}
          onChange={(durationMs) => typeof durationMs === "number" && setDraft((current) => ({ ...current, durationMs }))}/></Field>}
        </section>
      </div>
        <DialogFooter>
          <Button variant="outline" className="flex-1" onClick={() => setVisible(false)}>取消</Button>
          <Button className="flex-1" onClick={saveDraft}>确认</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={conditionVisible} onOpenChange={(open) => { if (!open) setConditionVisible(false); }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader><DialogTitle>数据条件</DialogTitle></DialogHeader>
        <div className="interaction-form">
          <Field label="数据源"><SelectField label="条件数据源" value={conditionDraft.sourceId} options={dataSources}
            onChange={(sourceId) => setConditionDraft((current) => ({ ...current, sourceId }))}/></Field>
          <Field label="字段路径"><Input aria-label="数据字段路径" value={conditionDraft.field} placeholder="例如 rows.0.value"
            onChange={(event) => setConditionDraft((current) => ({ ...current, field: event.target.value }))}/></Field>
          <Field label="比较方式"><SelectField label="数据比较方式" value={conditionDraft.op}
            options={DATA_FILTER_OPS.map((op) => ({ value: op, label: op }))}
            onChange={(op) => setConditionDraft((current) => ({ ...current, op: op as DataFilterOp }))}/></Field>
          <Field label="比较值"><Input aria-label="数据比较值" value={conditionDraft.value}
            onChange={(event) => setConditionDraft((current) => ({ ...current, value: event.target.value }))}/></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConditionVisible(false)}>取消</Button>
          <Button onClick={saveCondition}>确认</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm?.kind === "delete" ? "删除交互" : "清空交互规则"}</AlertDialogTitle>
          <AlertDialogDescription>
            {confirm?.kind === "delete" ? `确定删除「${confirm.rule.name || "未命名交互"}」吗？` : `将删除 ${rules.length} 条规则。`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => {
            if (confirm?.kind === "delete") deleteRule(confirm.rule.id); else if (confirm?.kind === "clear") saveRules([]);
            setConfirm(null);
          }}>{confirm?.kind === "delete" ? "删除" : "清空"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
