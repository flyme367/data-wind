import { useState } from "react";
import { Button, Input, InputNumber, Modal, Select, Toast } from "@douyinfe/semi-ui";
import { Plus, Trash2 } from "lucide-react";
import { kitMetadata, kitPrivateData, kitRows } from "../data/kitRuntime";
import { sanitizeDataConditions, type BoardDataCondition, type DataConditionRule } from "../data/dataConditions";
import { useStore } from "../state/store";
import { getSceneBridge } from "../workers/bridge";

const newRule = (): DataConditionRule => ({ sourceId: "$current", field: "", operator: "=", value: "", selector: "each", index: 1 });
const operators = [ ["=", "等于"], ["!=", "不等于"], [">", "大于"], ["<", "小于"], [">=", "大于等于"],
  ["<=", "小于等于"], ["⊃", "包含"], ["!⊃", "不包含"], ["∅", "为空"], ["!∅", "不为空"] ]
  .map(([value, label]) => ({ value, label }));
const selectors = [ ["each", "当前行"], ["first", "第一条数据"], ["last", "最后一条数据"], ["any", "任一条数据"],
  ["all", "每一条数据"], ["index", "自定义第几条数据"] ].map(([value, label]) => ({ value, label }));

export default function DataConditionsEditor({ onClose }: { onClose: () => void }) {
  const state = useStore();
  const [conditions, setConditions] = useState<BoardDataCondition[]>(() => structuredClone(state.settings.boardDataConditions ?? []));
  const [selectedId, setSelectedId] = useState(conditions[0]?.id ?? "");
  const current = conditions.find(item => item.id === selectedId);
  const selectedNode = state.scene.find(node => node.id === state.selectedId);
  const meta = selectedNode && kitMetadata(selectedNode);
  const ownFields = meta ? kitPrivateData(meta.source)?.fields ?? [] : [];
  const sourceChoices = [{ label: "当前组件数据", value: "$current" }, { label: "项目参数", value: "builtin:project-params" },
    ...state.settings.boardSharedData.map(source => ({ label: source.name, value: source.id }))];
  const patchCurrent = (patch: Partial<BoardDataCondition>) => setConditions(items => items.map(item =>
    item.id === selectedId ? { ...item, ...patch } : item));
  const patchRule = (group: number, index: number, patch: Partial<DataConditionRule>) => {
    if (!current) return;
    patchCurrent({ groups: current.groups.map((items, at) => at === group
      ? items.map((rule, position) => position === index ? { ...rule, ...patch } : rule) : items) });
  };
  const fieldsFor = (sourceId: string) => {
    const data = sourceId === "$current" ? selectedNode?.data : state.liveData[sourceId]
      ?? state.settings.boardSharedData.find(item => item.id === sourceId)?.data;
    const rows = kitRows(data?.rows, data?.columns);
    const keys = sourceId === "builtin:project-params" ? Object.keys(data ?? {}) : Object.keys(rows[0] ?? {});
    const options = sourceId === "$current" ? ownFields.map(field => ({ value: field.uid, label: field.alias || field.uid })) : [];
    for (const key of keys) if (!options.some(item => item.value === key)) options.push({ value: key, label: key });
    if (sourceId !== "builtin:project-params") options.push({ value: "$row", label: "行号" },
      { value: "$reverse-row", label: "倒数行号" }, { value: "$count", label: "数据条数" });
    return options;
  };
  return <Modal title="数据条件" visible onCancel={onClose} okText="确认" cancelText="取消" width={1040}
    onOk={() => {
      if (conditions.some(item => !item.name.trim())) { Toast.warning("请填写数据条件名称"); return; }
      getSceneBridge().post({ type: "configure", patch: { boardDataConditions: sanitizeDataConditions(conditions) } }); onClose();
    }}>
    <div className="data-conditions-editor">
      <aside>
        <Button block icon={<Plus size={14}/>} onClick={() => {
          const condition = { id: crypto.randomUUID(), name: `条件${conditions.length + 1}`, groups: [[newRule()]] };
          setConditions(items => [...items, condition]); setSelectedId(condition.id);
        }}>添加条件</Button>
        {conditions.map(condition => <div className="data-condition-item" key={condition.id}>
          <button type="button" aria-pressed={selectedId === condition.id} onClick={() => setSelectedId(condition.id)}>{condition.name}</button>
          <Button size="small" theme="borderless" aria-label={`删除${condition.name}`} icon={<Trash2 size={13}/>}
            onClick={() => { const next = conditions.filter(item => item.id !== condition.id); setConditions(next);
              if (selectedId === condition.id) setSelectedId(next[0]?.id ?? ""); }}/>
        </div>)}
      </aside>
      <section>
        {!current ? <p>添加条件后，可设置多组筛选规则。</p> : <>
          <div className="data-condition-heading"><label>条件名称</label><Input size="small" aria-label="条件名称" value={current.name}
            onChange={name => patchCurrent({ name })}/>
            <Button size="small" icon={<Plus size={13}/>} onClick={() => patchCurrent({ groups: [...current.groups, [newRule()]] })}>新建分组</Button>
          </div>
          <p className="properties-note">组内条件同时满足；任一组满足即可。数据字段可使用行号、倒数行号或数据条数。</p>
          {current.groups.map((group, groupIndex) => <div className="data-condition-group" key={groupIndex}>
            <div className="data-condition-group-heading"><span>{groupIndex ? "或 · " : ""}分组 {groupIndex + 1}</span>
              <Button size="small" theme="borderless" icon={<Plus size={13}/>} onClick={() => patchCurrent({
                groups: current.groups.map((items, at) => at === groupIndex ? [...items, newRule()] : items) })}>新建条件</Button>
              <Button size="small" theme="borderless" aria-label={`删除分组${groupIndex + 1}`} icon={<Trash2 size={13}/>}
                onClick={() => patchCurrent({ groups: current.groups.filter((_, at) => at !== groupIndex) })}/>
            </div>
            {group.map((rule, index) => <div className="data-condition-rule" key={index}>
              <span>{index ? "且" : ""}</span>
              <Select size="small" aria-label={`第${groupIndex + 1}组第${index + 1}项数据源`} value={rule.sourceId}
                optionList={sourceChoices} onChange={value => patchRule(groupIndex, index, { sourceId: String(value), field: "",
                  selector: value === "$current" ? "each" : "any" })}/>
              <Select size="small" filter allowCreate aria-label={`第${groupIndex + 1}组第${index + 1}项字段`} value={rule.field || undefined}
                placeholder="字段/参数" optionList={fieldsFor(rule.sourceId)} onChange={field => patchRule(groupIndex, index, { field: String(field) })}/>
              {rule.sourceId !== "builtin:project-params" && <Select size="small" aria-label={`第${groupIndex + 1}组第${index + 1}项判断方式`}
                value={rule.selector} optionList={selectors} onChange={selector => patchRule(groupIndex, index, { selector: selector as DataConditionRule["selector"] })}/>}
              {rule.selector === "index" && rule.sourceId !== "builtin:project-params" && <InputNumber size="small" min={1}
                aria-label={`第${groupIndex + 1}组第${index + 1}项行号`} value={rule.index}
                onChange={value => typeof value === "number" && patchRule(groupIndex, index, { index: value })}/>}
              <Select size="small" aria-label={`第${groupIndex + 1}组第${index + 1}项条件`} value={rule.operator}
                optionList={operators} onChange={operator => patchRule(groupIndex, index, { operator: operator as DataConditionRule["operator"] })}/>
              {!['∅', '!∅'].includes(rule.operator) && <Input size="small" aria-label={`第${groupIndex + 1}组第${index + 1}项值`}
                value={rule.value} onChange={value => patchRule(groupIndex, index, { value })}/>}
              <Button size="small" theme="borderless" aria-label={`删除第${groupIndex + 1}组第${index + 1}项`} icon={<Trash2 size={13}/>}
                onClick={() => patchCurrent({ groups: current.groups.map((items, at) => at === groupIndex
                  ? items.filter((_, position) => position !== index) : items) })}/>
            </div>)}
          </div>)}
        </>}
      </section>
    </div>
  </Modal>;
}
