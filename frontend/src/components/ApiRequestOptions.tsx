import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { DataSourceConfig } from "../data/dataSources";
import { Field } from "./PropertyFields";

export default function ApiRequestOptions({ source, disabled, onChange }: {
  source: DataSourceConfig;
  disabled?: boolean;
  onChange: (patch: Partial<DataSourceConfig>) => void;
}) {
  const params = source.queryParams ?? [];
  const auth = source.auth ?? { type: "none" as const };
  const variables = source.variables ?? [];
  const updateParam = (index: number, patch: Partial<(typeof params)[number]>) =>
    onChange({ queryParams: params.map((item, i) => i === index ? { ...item, ...patch } : item) });
  return <div className="api-request-options">
    <div className="api-query-heading"><span>请求参数</span>
      <Button size="sm" variant="ghost" disabled={disabled || params.length >= 30}
        onClick={() => onChange({ queryParams: [...params, { key: "", value: "", enabled: true }] })}>＋ 添加参数</Button>
    </div>
    {params.map((param, index) => <div className="api-query-row" key={index}>
      <Switch size="sm" aria-label={`启用参数 ${index + 1}`} checked={param.enabled} disabled={disabled}
        onCheckedChange={(enabled) => updateParam(index, { enabled })}/>
      <Input className="h-7 text-xs" aria-label={`参数名 ${index + 1}`} placeholder="参数名" value={param.key} disabled={disabled}
        onChange={(event) => updateParam(index, { key: event.target.value })}/>
      <Input className="h-7 text-xs" aria-label={`参数值 ${index + 1}`} placeholder="参数值" value={param.value} disabled={disabled}
        onChange={(event) => updateParam(index, { value: event.target.value })}/>
      <Button size="sm" variant="ghost" aria-label={`删除参数 ${index + 1}`} disabled={disabled}
        onClick={() => onChange({ queryParams: params.filter((_, i) => i !== index) })}>×</Button>
    </div>)}
    <Field label="认证方式"><Select value={auth.type} disabled={disabled}
      onValueChange={(type) => onChange({ auth: type === "bearer" ? { type: "bearer", token: "" }
        : type === "basic" ? { type: "basic", username: "", password: "" } : { type: "none" } })}>
      <SelectTrigger className="w-full" size="sm" aria-label="API 认证方式"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">无认证</SelectItem>
        <SelectItem value="bearer">Bearer Token</SelectItem>
        <SelectItem value="basic">Basic 认证</SelectItem>
      </SelectContent>
    </Select></Field>
    {auth.type === "bearer" && <Field label="Token"><Input className="h-7 text-xs" type="password" aria-label="Bearer Token"
      value={auth.token} disabled={disabled} onChange={(event) => onChange({ auth: { ...auth, token: event.target.value } })}/></Field>}
    {auth.type === "basic" && <>
      <Field label="用户名"><Input className="h-7 text-xs" aria-label="认证用户名" value={auth.username} disabled={disabled}
        onChange={(event) => onChange({ auth: { ...auth, username: event.target.value } })}/></Field>
      <Field label="密码"><Input className="h-7 text-xs" type="password" aria-label="认证密码" value={auth.password} disabled={disabled}
        onChange={(event) => onChange({ auth: { ...auth, password: event.target.value } })}/></Field>
    </>}
    {auth.type !== "none" && <p className="properties-note">认证信息会保存在项目和发布文件中。</p>}
    <div className="api-query-heading"><span>变量</span>
      <Button size="sm" variant="ghost" disabled={disabled || variables.length >= 50}
        onClick={() => onChange({ variables: [...variables, { name: "", initialValue: "" }] })}>＋ 添加变量</Button>
    </div>
    {variables.map((variable, index) => <div className="api-query-row" key={index}>
      <Input className="h-7 text-xs" aria-label={`变量名 ${index + 1}`} placeholder="变量名" value={variable.name} disabled={disabled}
        onChange={(event) => onChange({ variables: variables.map((item, i) => i === index ? { ...item, name: event.target.value } : item) })}/>
      <Input className="h-7 text-xs" aria-label={`变量初始值 ${index + 1}`} placeholder="初始值" value={variable.initialValue} disabled={disabled}
        onChange={(event) => onChange({ variables: variables.map((item, i) => i === index ? { ...item, initialValue: event.target.value } : item) })}/>
      <Input className="h-7 text-xs" aria-label={`变量当前值 ${index + 1}`} placeholder="当前值" value={variable.currentValue ?? ""} disabled={disabled}
        onChange={(event) => onChange({ variables: variables.map((item, i) => i === index ? { ...item, currentValue: event.target.value || undefined } : item) })}/>
      <Button size="sm" variant="ghost" aria-label={`删除变量 ${index + 1}`} disabled={disabled}
        onClick={() => onChange({ variables: variables.filter((_, i) => i !== index) })}>×</Button>
    </div>)}
    {variables.length > 0 && <p className="properties-note">在地址、参数、请求头、请求体和认证中使用 {"{{变量名}}"}。未填写当前值时使用初始值。</p>}
  </div>;
}
