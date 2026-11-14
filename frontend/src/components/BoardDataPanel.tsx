import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NumberInput } from "@/components/ui-ext/number-input";
import { Toast } from "@/lib/toast";
import { defaultDataSource, validateDataSource, type DataSourceConfig, type DataSourceKind } from "../data/dataSources";
import { excelSheetData, readExcelWorkbook } from "../data/excelData";
import { LiveDataManager } from "../data/liveData";
import type { BoardSharedData } from "../data/editor";
import { getSceneBridge } from "../workers/bridge";
import { useStore } from "../state/store";
import { Field } from "./PropertyFields";
import ApiRequestOptions from "./ApiRequestOptions";
import DatabaseSourceFields from "./DatabaseSourceFields";
import WebhookSourceFields from "./WebhookSourceFields";
import { DEFAULT_DB_GATEWAY } from "../data/localDatabase";

type DataKind = "static" | DataSourceKind;
const kindOptions = [
  { value: "static", label: "静态数据 / 文件" }, { value: "api", label: "API" },
  { value: "websocket", label: "WebSocket" }, { value: "socketio", label: "Socket.IO" },
  { value: "message", label: "PostMessage" },
  { value: "database", label: "MySQL / PostgreSQL" },
  { value: "webhook", label: "Webhook 推送" },
];
const fileAccept = ".json,.csv,.tsv,.xlsx";

export default function BoardDataPanel() {
  const state = useStore();
  const sources = state.settings.boardSharedData;
  const [visible, setVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DataKind>("static");
  const [enabled, setEnabled] = useState(true);
  const [dataText, setDataText] = useState("{}");
  const [source, setSource] = useState<DataSourceConfig>(() => defaultDataSource());
  const [headersText, setHeadersText] = useState("{}");
  const [authText, setAuthText] = useState("{}");
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [testing, setTesting] = useState(false);
  const [responseText, setResponseText] = useState("");
  const [pendingDelete, setPendingDelete] = useState<BoardSharedData | null>(null);
  const listImportRef = useRef<HTMLInputElement>(null);
  const formImportRef = useRef<HTMLInputElement>(null);
  const previewManager = useRef<LiveDataManager | null>(null);

  const stopPreview = () => { previewManager.current?.dispose(); previewManager.current = null; setTesting(false); };
  useEffect(() => () => { previewManager.current?.dispose(); }, []);

  const updateSources = (next: BoardSharedData[]) => getSceneBridge().post({ type: "configure", patch: { boardSharedData: next } });
  const resetDraft = (item?: BoardSharedData) => {
    stopPreview(); setResponseText("");
    setEditingId(item?.id ?? null);
    setName(item?.name ?? "");
    setKind(item?.source?.kind ?? "static");
    setEnabled(item?.enabled ?? true);
    setDataText(JSON.stringify(item?.data ?? {}, null, 2));
    setSource(item?.source ?? defaultDataSource());
    setHeadersText(JSON.stringify(item?.source?.headers ?? {}, null, 2));
    setAuthText(JSON.stringify(item?.source?.socketAuth ?? {}, null, 2));
    setFileName(item?.fileName ?? "");
    setError("");
  };
  const openAdd = () => { resetDraft(); setVisible(true); };
  const openEdit = (item: BoardSharedData) => { resetDraft(item); setVisible(true); };

  const testApi = () => {
    stopPreview(); setResponseText(""); setError("");
    try {
      const headers: unknown = JSON.parse(headersText);
      if (!headers || typeof headers !== "object" || Array.isArray(headers) || Object.values(headers).some((value) => typeof value !== "string"))
        throw new Error("请求头须为字符串键值 JSON 对象");
      const config = validateDataSource({ ...source, kind: "api", enabled: true, intervalMs: 0, headers: headers as Record<string, string> });
      setTesting(true);
      const manager = new LiveDataManager((update) => {
        if (update.data) {
          setResponseText(JSON.stringify(update.data, null, 2));
          setTesting(false); manager.dispose(); previewManager.current = null;
        } else if (update.status?.state === "error") {
          setError(update.status.message || "请求失败");
          setTesting(false); manager.dispose(); previewManager.current = null;
        }
      });
      previewManager.current = manager;
      manager.sync([{ id: "preview", dataSource: config }]);
    } catch (exception) { setError(exception instanceof Error ? exception.message : "数据配置无效"); }
  };

  useEffect(() => {
    if (kind !== "static") return;
    setSource((current) => ({ ...current, kind: "api" }));
  }, [kind]);

  const save = () => {
    try {
      if (!name.trim()) throw new Error("请填写数据名称");
      let data: Record<string, unknown> | undefined;
      let nextSource: DataSourceConfig | undefined;
      if (kind === "static") {
        data = JSON.parse(dataText) as Record<string, unknown>;
        if (!data || typeof data !== "object" || Array.isArray(data) || JSON.stringify(data).length > 1_000_000) throw new Error("静态数据须是 JSON 对象，且小于 1 MB");
      } else {
        let headers: Record<string, string> = {};
        let socketAuth: Record<string, unknown> | undefined;
        if (kind === "api") {
          const parsed: unknown = JSON.parse(headersText);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== "string")) throw new Error("请求头须为字符串键值 JSON 对象");
          headers = parsed as Record<string, string>;
        }
        if (kind === "socketio") {
          const parsed: unknown = JSON.parse(authText);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Socket.IO 认证信息须为 JSON 对象");
          socketAuth = parsed as Record<string, unknown>;
        }
        nextSource = validateDataSource({ ...source, kind, enabled, headers, body: kind === "api" ? source.body : "", socketAuth,
          ...(kind === "api" ? {} : { queryParams: undefined, auth: undefined, variables: undefined }),
          ...(kind === "database" ? {} : { database: undefined }), ...(kind === "webhook" ? {} : { webhook: undefined }) });
      }
      const next: BoardSharedData = { id: editingId ?? `board-${crypto.randomUUID()}`, name: name.trim(), enabled,
        ...(nextSource ? { source: nextSource } : {}), ...(data ? { data } : {}), ...(fileName ? { fileName } : {}) };
      const nextList = editingId ? sources.map((item) => item.id === editingId ? next : item) : [...sources, next];
      updateSources(nextList);
      setVisible(false);
      Toast.success(editingId ? "公共数据已更新" : "公共数据已添加");
    } catch (exception) { setError(exception instanceof Error ? exception.message : "数据配置无效"); }
  };

  const readDataFile = async (file: File): Promise<Record<string, unknown>> => {
    if (file.size > 1_000_000) throw new Error("文件不能超过 1 MB");
    let data: Record<string, unknown>;
    if (/\.xlsx$/i.test(file.name)) {
      const sheets = await readExcelWorkbook(file);
      data = excelSheetData(sheets[0]!);
      if (sheets.length > 1) Toast.info(`已导入首个工作表「${sheets[0]!.sheet}」，共 ${sheets.length} 张`);
    } else {
      const { parseDataFile } = await import("../data/dataSources");
      data = parseDataFile(file.name, await file.text());
    }
    return data;
  };
  const importFile = async (file: File) => {
    const data = await readDataFile(file);
    const item: BoardSharedData = { id: `board-${crypto.randomUUID()}`, name: file.name.replace(/\.[^.]+$/, ""), fileName: file.name, enabled: true, data };
    updateSources([...sources, item]);
    Toast.success("文件数据已添加到看板公共数据");
  };
  const importFormFile = (file: File) => {
    void readDataFile(file).then((data) => { setDataText(JSON.stringify(data, null, 2)); setFileName(file.name); })
      .catch((exception: unknown) => setError(exception instanceof Error ? exception.message : "文件读取失败"));
  };
  const methodOptions = [ { value: "GET", label: "GET" }, { value: "POST", label: "POST" } ];

  return <section className="board-data-panel">
    <header className="board-data-heading"><h4>看板公共数据</h4></header>
    {!sources.length ? <div className="board-data-empty"><Button size="sm" variant="ghost" onClick={openAdd}>＋ 添加数据</Button></div> :
      <div className="board-data-list">{sources.map((item) => <article className="board-data-item" key={item.id}>
        <div className="board-data-item-main"><strong>{item.name}</strong><small>{item.fileName ?? (item.source?.kind.toUpperCase() ?? "静态数据")}</small></div>
        <Switch size="sm" aria-label={`启用${item.name}`} checked={item.enabled} onCheckedChange={(checked) => updateSources(sources.map((sourceItem) => sourceItem.id === item.id ? { ...sourceItem, enabled: checked, source: sourceItem.source ? { ...sourceItem.source, enabled: checked } : undefined } : sourceItem))}/>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm" variant="ghost" aria-label={`更多${item.name}操作`}/>}>⋮</DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => openEdit(item)}>编辑数据源</DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent("dw:refresh-data", { detail: { id: item.id } }))}>刷新数据</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setPendingDelete(item)}>删除</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </article>)}<Button size="sm" variant="ghost" onClick={openAdd}>＋ 添加数据</Button></div>}
    {sources.length > 0 && <div className="board-data-upload">
      <Button size="sm" onClick={() => listImportRef.current?.click()}>导入 JSON / CSV / TSV / XLSX</Button>
      <input ref={listImportRef} hidden type="file" accept={fileAccept} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; void importFile(file).catch((exception: unknown) => Toast.error(exception instanceof Error ? exception.message : "文件读取失败")); }}/>
      <span>最多 1 MB；XLSX 默认使用首个工作表</span></div>}

    <Dialog open={visible} onOpenChange={(open) => { if (!open) { stopPreview(); setVisible(false); } }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader><DialogTitle>{editingId ? "编辑公共数据" : "连接数据"}</DialogTitle></DialogHeader>
        <div className="board-data-form">
          <Field label="来源类型"><Select items={kindOptions} value={kind}
            onValueChange={(value) => { const next = value as DataKind; if ((next === "database" || next === "webhook") && kind !== next) setSource((current) => ({ ...current, url: DEFAULT_DB_GATEWAY })); setKind(next); }}>
            <SelectTrigger className="w-full" aria-label="来源类型"><SelectValue/></SelectTrigger>
            <SelectContent>{kindOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
          </Select></Field>
          <Field label="数据名称"><Input aria-label="数据名称" value={name} maxLength={100} placeholder="例如：设备运行数据" onChange={(event) => setName(event.target.value)}/></Field>
          <Field label="启用数据"><Switch aria-label="启用数据" checked={enabled} onCheckedChange={setEnabled}/></Field>
          {kind === "static" ? <>
            <Field label="数据内容"><Textarea aria-label="公共数据 JSON" value={dataText} onChange={(event) => setDataText(event.target.value)} rows={10} spellCheck={false}/></Field>
            <Button size="sm" onClick={() => formImportRef.current?.click()}>选择 JSON / CSV / TSV / XLSX</Button>
            <input ref={formImportRef} hidden type="file" accept={fileAccept} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) importFormFile(file); }}/>
          </> : <>
            {kind !== "database" && kind !== "webhook" && <><Field label="连接地址"><Input aria-label="连接地址" value={source.url} onChange={(event) => { const url = event.target.value; setSource((current) => ({ ...current, url })); }} placeholder={kind === "websocket" ? "wss://example.com/stream" : "https://example.com/api"}/></Field>
            <Field label="响应路径"><Input aria-label="响应路径" value={source.path} onChange={(event) => { const path = event.target.value; setSource((current) => ({ ...current, path })); }} placeholder="留空使用完整数据"/></Field></>}
            {kind === "database" && <><DatabaseSourceFields source={source} onChange={(patch) => setSource((current) => ({ ...current, ...patch }))}/>
              <Field label="轮询间隔"><NumberInput aria-label="数据库轮询间隔" min={0} max={3600000} step={1000} suffix="ms" value={source.intervalMs} onChange={(intervalMs) => typeof intervalMs === "number" && setSource((current) => ({ ...current, intervalMs }))}/></Field></>}
            {kind === "webhook" && <WebhookSourceFields source={source} onChange={(patch) => setSource((current) => ({ ...current, ...patch }))}/>}
            {kind === "api" && <>
              <Field label="请求方式"><Select items={methodOptions} value={source.method} onValueChange={(method) => setSource((current) => ({ ...current, method: method as "GET" | "POST" }))}>
                <SelectTrigger className="w-full" aria-label="请求方式"><SelectValue/></SelectTrigger>
                <SelectContent>{methodOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
              </Select></Field>
              <ApiRequestOptions source={source} onChange={(patch) => setSource((current) => ({ ...current, ...patch }))}/>
              <Field label="轮询间隔"><NumberInput aria-label="轮询间隔" min={0} max={3600000} step={1000} suffix="ms" value={source.intervalMs} onChange={(intervalMs) => typeof intervalMs === "number" && setSource((current) => ({ ...current, intervalMs }))}/></Field>
              <Field label="请求头 JSON"><Textarea aria-label="请求头 JSON" value={headersText} onChange={(event) => setHeadersText(event.target.value)} rows={3} spellCheck={false}/></Field>
              {source.method === "POST" && <Field label="请求体"><Textarea aria-label="请求体" value={source.body} onChange={(event) => { const body = event.target.value; setSource((current) => ({ ...current, body })); }} rows={3}/></Field>}
              <Field label="发送请求"><Button size="sm" disabled={testing} onClick={testApi}>发送</Button></Field>
              {responseText && <Field label="响应数据"><Textarea aria-label="API 响应数据" value={responseText} readOnly rows={6} spellCheck={false}/></Field>}
            </>}
            {kind === "socketio" && <>
              <Field label="事件名称"><Input aria-label="Socket.IO 事件名称" value={source.socketEvent ?? "message"} onChange={(event) => { const socketEvent = event.target.value; setSource((current) => ({ ...current, socketEvent })); }}/></Field>
              <Field label="传输路径"><Input aria-label="Socket.IO 传输路径" value={source.socketPath ?? "/socket.io/"} onChange={(event) => { const socketPath = event.target.value; setSource((current) => ({ ...current, socketPath })); }}/></Field>
              <Field label="认证信息 JSON"><Textarea aria-label="Socket.IO 认证信息 JSON" value={authText} onChange={(event) => setAuthText(event.target.value)} rows={3} spellCheck={false}/></Field>
            </>}
            {kind !== "database" && kind !== "webhook" && <p className="properties-note">浏览器跨域规则适用。HTTP 轮询间隔为 0 时只请求一次；Socket.IO 认证信息与数据连接配置会保存在项目中。</p>}
          </>}
          {error && <div role="alert" className="field-error">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { stopPreview(); setVisible(false); }}>取消</Button>
          <Button onClick={() => { stopPreview(); save(); }}>确定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除公共数据</AlertDialogTitle>
          <AlertDialogDescription>删除「{pendingDelete?.name}」后，使用它的组件将保留最后一次显示值。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={() => { if (pendingDelete) updateSources(sources.filter((sourceItem) => sourceItem.id !== pendingDelete.id)); setPendingDelete(null); }}>删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
