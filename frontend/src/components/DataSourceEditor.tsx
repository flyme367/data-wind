import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NumberInput } from "@/components/ui-ext/number-input";
import { Toast } from "@/lib/toast";
import { DATA_FILTER_OPS, DEFAULT_SOCKET_EVENT, DEFAULT_SOCKET_PATH, MAX_DATA_BYTES, defaultDataSource, parseDataFile, validateDataSource, type DataFilterOp, type DataSourceConfig, type DataSourceKind } from "../data/dataSources";
import { excelSheetData, readExcelWorkbook, type ExcelSheet } from "../data/excelData";
import { getState, useStore } from "../state/store";
import { validateScene } from "../state/projects";
import type { SceneNode } from "../types";
import { getSceneBridge } from "../workers/bridge";
import { Field } from "./PropertyFields";
import ApiRequestOptions from "./ApiRequestOptions";
import DatabaseSourceFields from "./DatabaseSourceFields";
import WebhookSourceFields from "./WebhookSourceFields";
import { DEFAULT_DB_GATEWAY } from "../data/localDatabase";
import { kitMetadata, mergeKitStaticData } from "../data/kitRuntime";

type DraftKind = DataSourceKind | "static" | "shared";
interface ImportTarget { projectId: string | null; nodeId: string; data: string; source: string; }
const kindOptions = [ { value: "static", label: "静态数据 / 文件" }, { value: "shared", label: "看板公共数据" }, { value: "api", label: "API 接口" },
  { value: "websocket", label: "WebSocket" }, { value: "socketio", label: "Socket.IO" }, { value: "message", label: "PostMessage" },
  { value: "database", label: "MySQL / PostgreSQL" }, { value: "webhook", label: "Webhook 推送" } ];

export default function DataSourceEditor({ node }: { node: SceneNode }) {
  const state = useStore(), fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DraftKind>(node.sharedDataSourceId ? "shared" : node.dataSource?.kind ?? "static");
  const [sharedId, setSharedId] = useState(node.sharedDataSourceId ?? "");
  const [draft, setDraft] = useState<DataSourceConfig>(() => node.dataSource ?? defaultDataSource());
  const [headers, setHeaders] = useState(() => JSON.stringify(node.dataSource?.headers ?? {}, null, 2));
  const [socketAuth, setSocketAuth] = useState(() => JSON.stringify(node.dataSource?.socketAuth ?? {}, null, 2));
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [workbook, setWorkbook] = useState<{ sheets: ExcelSheet[]; target: ImportTarget } | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const selectedSheetIndex = useRef(0);
  const importSequence = useRef(0);
  const sourceKey = JSON.stringify(node.dataSource ?? null);
  useEffect(() => {
    const source = node.dataSource;
    setKind(node.sharedDataSourceId ? "shared" : source?.kind ?? "static");
    setSharedId(node.sharedDataSourceId ?? "");
    setDraft(source ?? defaultDataSource());
    setHeaders(JSON.stringify(source?.headers ?? {}, null, 2));
    setSocketAuth(JSON.stringify(source?.socketAuth ?? {}, null, 2));
    setError("");
  }, [node.id, sourceKey, node.sharedDataSourceId]);
  useEffect(() => {
    importSequence.current += 1;
    setWorkbook(null);
    setImporting(false);
    return () => { importSequence.current += 1; };
  }, [node.id]);
  const update = (patch: Partial<DataSourceConfig>) => setDraft((current) => ({ ...current, ...patch }));
  const apply = () => {
    try {
      if (kind === "shared") {
        if (!state.settings.boardSharedData.some((item) => item.id === sharedId && item.enabled)) throw new Error("请选择一个已启用的看板公共数据源");
        getSceneBridge().post({ type: "setDataSource", id: node.id, source: null });
        getSceneBridge().post({ type: "patch", id: node.id, patch: { sharedDataSourceId: sharedId } });
      } else if (kind === "static") {
        getSceneBridge().post({ type: "setDataSource", id: node.id, source: null });
        getSceneBridge().post({ type: "patch", id: node.id, patch: { sharedDataSourceId: undefined } });
      }
      else {
        let parsedHeaders: unknown = {}, parsedAuth: unknown;
        if (kind === "api") {
          try { parsedHeaders = JSON.parse(headers); } catch { throw new Error("请求头须为 JSON 对象"); }
        }
        if (kind === "socketio") {
          try { parsedAuth = JSON.parse(socketAuth); } catch { throw new Error("Socket.IO 认证信息须为 JSON 对象"); }
        }
        const source = validateDataSource({ ...draft, kind, headers: parsedHeaders,
          body: kind === "api" ? draft.body : "", socketAuth: parsedAuth,
          ...(kind === "api" ? {} : { queryParams: undefined, auth: undefined, variables: undefined }),
          ...(kind === "database" ? {} : { database: undefined }), ...(kind === "webhook" ? {} : { webhook: undefined }) });
        getSceneBridge().post({ type: "setDataSource", id: node.id, source });
        getSceneBridge().post({ type: "patch", id: node.id, patch: { sharedDataSourceId: undefined } });
      }
      setError(""); Toast.success(kind === "static" ? "已切换为静态数据" : "数据连接已应用");
    } catch (exception) { setError(exception instanceof Error ? exception.message : "数据源配置无效"); }
  };
  const applyImportedData = (target: ImportTarget, data: Record<string, unknown>) => {
    const current = getState();
    if (current.projectId !== target.projectId) throw new Error("项目已切换，请重新导入文件");
    const latest = current.scene.find((item) => item.id === target.nodeId);
    if (!latest || latest.locked) throw new Error("对象已删除或锁定，请重新选择对象");
    if (JSON.stringify(latest.data ?? {}) !== target.data || JSON.stringify(latest.dataSource ?? null) !== target.source) {
      throw new Error("组件数据或连接已更改，请重新导入文件");
    }
    validateScene([{ ...latest, data: kitMetadata(latest) ? mergeKitStaticData(latest, data) : data, dataSource: undefined }]);
    if (!latest.dataSource && JSON.stringify(latest.data ?? {}) === JSON.stringify(data)) {
      Toast.info("文件数据与当前数据一致");
      return;
    }
    getSceneBridge().post({ type: "setStaticData", id: target.nodeId, data });
    Toast.success("文件数据已导入，可撤销");
  };
  const importFile = async (file: File) => {
    const projectId = getState().projectId, sequence = ++importSequence.current;
    const target: ImportTarget = { projectId, nodeId: node.id, data: JSON.stringify(node.data ?? {}), source: sourceKey };
    setImporting(true);
    try {
      if (file.size > MAX_DATA_BYTES) throw new Error("文件不能超过 1 MB");
      if (/\.xlsx$/i.test(file.name)) {
        const sheets = await readExcelWorkbook(file);
        if (sequence !== importSequence.current || getState().projectId !== projectId) return;
        if (sheets.length > 1) {
          selectedSheetIndex.current = 0;
          setSheetIndex(0);
          setWorkbook({ sheets, target });
        } else applyImportedData(target, excelSheetData(sheets[0]!));
      } else {
        const data = parseDataFile(file.name, await file.text());
        if (sequence === importSequence.current) applyImportedData(target, data);
      }
    } catch (exception) {
      if (sequence === importSequence.current) Toast.error(exception instanceof Error ? exception.message : "文件读取失败");
    } finally { if (sequence === importSequence.current) setImporting(false); }
  };
  const importSheet = () => {
    if (!workbook) return;
    try {
      applyImportedData(workbook.target, excelSheetData(workbook.sheets[selectedSheetIndex.current]!));
      setWorkbook(null);
    } catch (exception) { Toast.error(exception instanceof Error ? exception.message : "工作表数据无效"); }
  };
  const status = state.dataStatus[node.id];
  const sharedOptions = state.settings.boardSharedData.filter((item) => item.enabled).map((item) => ({ value: item.id, label: item.name }));
  const opOptions = DATA_FILTER_OPS.map((op) => ({ value: op, label: op }));
  const methodOptions = [ { value: "GET", label: "GET" }, { value: "POST", label: "POST" } ];
  const sheetOptions = (workbook?.sheets ?? []).map((sheet, index) => ({ value: String(index), label: sheet.sheet }));
  return <div className="data-source-editor">
    <h4>数据连接</h4>
    <Field label="来源类型"><Select value={kind} disabled={node.locked}
      onValueChange={(value) => { const next = value as DraftKind; if ((next === "database" || next === "webhook") && kind !== next) update({ url: DEFAULT_DB_GATEWAY }); setKind(next); setError(""); }}>
      <SelectTrigger className="w-full" size="sm" aria-label="来源类型"><SelectValue/></SelectTrigger>
      <SelectContent>{kindOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
    </Select></Field>
    {kind === "shared" && <>
      <Field label="公共数据源"><Select value={sharedId || undefined} disabled={node.locked} onValueChange={(value) => setSharedId(String(value))}>
        <SelectTrigger className="w-full" size="sm" aria-label="公共数据源"><SelectValue placeholder="选择看板公共数据"/></SelectTrigger>
        <SelectContent>{sharedOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
      </Select></Field>
      <p className="properties-note">组件将读取公共数据源的实时值，并按下方数据绑定字段映射到组件属性。</p>
    </>}
    {kind !== "static" && kind !== "shared" && <>
      <Field label="启用连接"><Switch size="sm" aria-label="启用数据连接" checked={draft.enabled} disabled={node.locked} onCheckedChange={(enabled) => update({ enabled })}/></Field>
      {kind !== "database" && kind !== "webhook" && <><Field label={kind === "message" ? "允许的来源" : "连接地址"}><Input className="h-7 text-xs" aria-label="数据连接地址" value={draft.url} disabled={node.locked}
        placeholder={kind === "websocket" ? "wss://…" : "https://example.com"} onChange={(event) => update({ url: event.target.value })}/></Field>
      <Field label="响应路径"><Input className="h-7 text-xs" aria-label="响应路径" value={draft.path} disabled={node.locked} placeholder="留空使用完整数据" onChange={(event) => update({ path: event.target.value })}/></Field></>}
      {kind === "database" && <><DatabaseSourceFields source={draft} disabled={node.locked} onChange={update}/>
        <Field label="轮询间隔"><NumberInput size="small" aria-label="数据库轮询间隔" min={0} max={3600000} step={1000} suffix="ms" value={draft.intervalMs} disabled={node.locked} onChange={(intervalMs) => { if (typeof intervalMs === "number") update({ intervalMs }); }}/></Field></>}
      {kind === "webhook" && <WebhookSourceFields source={draft} disabled={node.locked} onChange={update}/>}
      {/* 山海鲸「数据条件」：对归一化后的 rows 按字段过滤；三联编辑行独立成块（标签行 + 全宽行） */}
      <Field label="数据条件"/>
      <div className="data-filter-row">
        <Input className="h-7 text-xs" aria-label="条件字段" placeholder="字段，如 name" value={draft.filter?.field ?? ""} disabled={node.locked}
          onChange={(event) => { const field = event.target.value; update({ filter: field.trim() ? { field, op: draft.filter?.op ?? "==", value: draft.filter?.value ?? "" } : undefined }); }}/>
        <Select value={draft.filter?.op ?? "=="} disabled={node.locked || !draft.filter?.field}
          onValueChange={(op) => draft.filter && update({ filter: { ...draft.filter, op: op as DataFilterOp } })}>
          <SelectTrigger className="data-filter-op w-full" size="sm" aria-label="条件操作符"><SelectValue/></SelectTrigger>
          <SelectContent>{opOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
        </Select>
        <Input className="h-7 text-xs" aria-label="条件值" placeholder="比较值" value={draft.filter?.value ?? ""} disabled={node.locked || !draft.filter?.field}
          onChange={(event) => draft.filter && update({ filter: { ...draft.filter, value: event.target.value } })}/>
      </div>
      {kind === "api" && <>
        <Field label="请求方式"><Select value={draft.method} disabled={node.locked} onValueChange={(method) => update({ method: method as "GET" | "POST" })}>
          <SelectTrigger className="w-full" size="sm" aria-label="请求方式"><SelectValue/></SelectTrigger>
          <SelectContent>{methodOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
        </Select></Field>
        <ApiRequestOptions source={draft} disabled={node.locked} onChange={update}/>
        <Field label="轮询间隔"><NumberInput size="small" aria-label="轮询间隔毫秒" min={0} max={3600000} step={1000} suffix="ms" value={draft.intervalMs} disabled={node.locked} onChange={(intervalMs) => { if (typeof intervalMs === "number") update({ intervalMs }); }}/></Field>
        <p className="properties-note">0 表示只请求一次；轮询至少间隔 1000 ms。POST 轮询可能触发服务端操作。</p>
        <label className="data-source-label" htmlFor={`headers-${node.id}`}>请求头 JSON</label>
        <Textarea id={`headers-${node.id}`} aria-label="请求头 JSON" rows={3} value={headers} disabled={node.locked} onChange={(event) => setHeaders(event.target.value)} spellCheck={false}/>
        {draft.method === "POST" && <><label className="data-source-label" htmlFor={`body-${node.id}`}>请求体</label><Textarea id={`body-${node.id}`} aria-label="请求体" rows={3} value={draft.body} disabled={node.locked} onChange={(event) => update({ body: event.target.value })}/></>}
        <p className="properties-note">浏览器跨域规则适用，不自动携带 Cookie。地址、请求头和请求体会随项目及发布文件保存。</p>
      </>}
      {kind === "websocket" && <p className="properties-note">支持原生 WebSocket JSON 文本消息；Socket.io 使用不同协议。</p>}
      {kind === "socketio" && <>
        <Field label="事件名称"><Input className="h-7 text-xs" aria-label="Socket.IO 事件名称" value={draft.socketEvent ?? DEFAULT_SOCKET_EVENT} disabled={node.locked} onChange={(event) => update({ socketEvent: event.target.value })}/></Field>
        <Field label="传输路径"><Input className="h-7 text-xs" aria-label="Socket.IO 传输路径" value={draft.socketPath ?? DEFAULT_SOCKET_PATH} disabled={node.locked} onChange={(event) => update({ socketPath: event.target.value })}/></Field>
        <label className="data-source-label" htmlFor={`socket-auth-${node.id}`}>认证信息 JSON</label>
        <Textarea id={`socket-auth-${node.id}`} aria-label="Socket.IO 认证信息 JSON" rows={3} value={socketAuth} disabled={node.locked} onChange={(event) => setSocketAuth(event.target.value)} spellCheck={false}/>
        <p className="properties-note">地址中的路径表示命名空间；传输路径需与服务端一致。接收事件的第一个 JSON 参数；网络断线会自动重连，服务端主动断开需手动刷新。认证信息会随项目及发布文件保存。</p>
      </>}
      {kind === "message" && <p className="properties-note">只接收来自指定来源的 JSON 消息；请填写完整来源，例如 https://example.com。</p>}
    </>}
    {error && <div className="field-error" role="alert">{error}</div>}
    <Button className="w-full" size="sm" disabled={node.locked} onClick={apply}>{kind === "static" ? "使用静态数据" : "应用连接"}</Button>
    {node.dataSource?.enabled && <><Button className="w-full" size="sm" onClick={() => window.dispatchEvent(new CustomEvent("dw:refresh-data", { detail: { id: node.id } }))}>立即刷新</Button>
      <p className={`data-source-status ${status?.state ?? "connecting"}`} role="status">{status?.state === "error" ? "连接错误" : status?.state === "connected" ? "已连接" : "正在连接"}{status?.message ? `：${status.message}` : ""}{status?.updatedAt ? ` · ${new Date(status.updatedAt).toLocaleTimeString()}` : ""}</p></>}
    <Button className="w-full" size="sm" disabled={node.locked || importing} onClick={() => fileRef.current?.click()}>{importing ? "正在读取文件…" : "导入 JSON / CSV / XLSX 文件"}</Button>
    <input ref={fileRef} hidden type="file" accept=".json,.csv,.xlsx,application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file); }}/>
    <p className="properties-note">XLSX 首行作为表头，最多 5000 行、256 列；文件不超过 1 MB。</p>
    <Dialog open={Boolean(workbook)} onOpenChange={(open) => { if (!open) setWorkbook(null); }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader><DialogTitle>选择 Excel 工作表</DialogTitle></DialogHeader>
        <Field label="工作表"><Select value={String(sheetIndex)} disabled={!workbook}
          onValueChange={(value) => { selectedSheetIndex.current = Number(value); setSheetIndex(selectedSheetIndex.current); }}>
          <SelectTrigger className="w-full" size="sm" aria-label="Excel 工作表"><SelectValue/></SelectTrigger>
          <SelectContent>{sheetOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
        </Select></Field>
        <p className="properties-note">使用第一行作为表头，最多导入 5000 行；日期保存为 ISO 时间字符串。</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setWorkbook(null)}>取消</Button>
          <Button onClick={importSheet}>导入</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {state.liveData[node.id] && <details className="data-source-preview"><summary>查看最新数据</summary><pre>{JSON.stringify(state.liveData[node.id], null, 2)}</pre></details>}
  </div>;
}
