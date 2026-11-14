import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NumberInput } from "@/components/ui-ext/number-input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Toast } from "@/lib/toast";
import type { DataSourceConfig } from "../data/dataSources";
import { databaseRequest, databaseToken, normalizeDatabaseRows, setDatabaseToken } from "../data/localDatabase";
import { downloadFile } from "../state/projects";
import { Field } from "./PropertyFields";

type Profile = { id: string; name: string; type: "mysql" | "postgres"; host: string; port: number; user: string; database: string; ssl: boolean };
type Table = { schema: string; name: string };
type ProfileDraft = Profile & { password: string };
const newProfile = (): ProfileDraft => ({ id: crypto.randomUUID(), name: "", type: "mysql", host: "127.0.0.1", port: 3306, user: "", password: "", database: "", ssl: false });
const PAGE_SIZE = 20;
const formatCell = (value: unknown) => value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);

function csvValue(value: unknown): string {
  const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export default function DatabaseSourceFields({ source, disabled, onChange }: {
  source: DataSourceConfig; disabled?: boolean; onChange: (patch: Partial<DataSourceConfig>) => void;
}) {
  const [token, setToken] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<{ columns: string[]; rows: unknown[][] } | null>(null);
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(newProfile);
  const [profileMessage, setProfileMessage] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Profile | null>(null);
  const db = source.database ?? { profile: "", sql: "" };
  const update = (patch: Partial<typeof db>) => onChange({ database: { ...db, ...patch } });
  const updateProfile = (patch: Partial<ProfileDraft>) => setProfileDraft((current) => ({ ...current, ...patch }));
  useEffect(() => { try { setToken(databaseToken(source.url)); } catch { setToken(""); } setProfiles([]); setTables([]); }, [source.url]);
  const run = async (action: "profiles" | "test" | "tables" | "query") => {
    setBusy(true); setMessage(""); setPreview(null); setPage(0);
    try {
      setDatabaseToken(source.url, token);
      if (action === "profiles") {
        const result = await databaseRequest<{ profiles: Profile[] }>(source.url, "/profiles");
        setProfiles(result.profiles); setMessage(`已找到 ${result.profiles.length} 个本机连接`);
      } else if (action === "tables") {
        const result = await databaseRequest<{ tables: Table[] }>(source.url, "/tables", { profile: db.profile });
        setTables(result.tables); setMessage(`已找到 ${result.tables.length} 个表或视图`);
      } else {
        const result = await databaseRequest<{ columns: string[]; rows: unknown[][] }>(source.url, action === "test" ? "/test" : "/query", action === "test" ? { profile: db.profile } : db);
        if (action === "query") { normalizeDatabaseRows(result); setPreview(result); }
        setMessage(action === "test" ? "数据库连接成功" : `查询成功：${result.rows.length} 行`);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "数据库服务不可用"); }
    finally { setBusy(false); }
  };
  const saveOrTestProfile = async (save: boolean) => {
    setBusy(true); setProfileMessage("");
    try {
      setDatabaseToken(source.url, token);
      const editing = profiles.some((profile) => profile.id === profileDraft.id);
      await databaseRequest(source.url, save ? "/profiles" : "/test-connection", profileDraft, undefined,
        save && editing ? "PUT" : "POST");
      if (!save) { setProfileMessage("数据库连接成功"); return; }
      const result = await databaseRequest<{ profiles: Profile[] }>(source.url, "/profiles");
      setProfiles(result.profiles); update({ profile: profileDraft.id }); setTables([]);
      setCreating(false); setProfileDraft(newProfile()); setMessage("连接已保存到本机服务");
    } catch (error) { setProfileMessage(error instanceof Error ? error.message : "数据库连接失败"); }
    finally { setBusy(false); }
  };
  const editProfile = (profile: Profile) => {
    setProfileDraft({ ...profile, password: "" });
    setProfileMessage("");
    setCreating(true);
  };
  const deleteProfile = async (profile: Profile) => {
    setBusy(true);
    try {
      await databaseRequest(source.url, "/profiles", { id: profile.id }, undefined, "DELETE");
      setProfiles((current) => current.filter((item) => item.id !== profile.id));
      if (db.profile === profile.id) update({ profile: "" });
      setTables([]);
      setMessage(`已删除连接「${profile.name}」`);
      setPendingDelete(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除连接失败");
    } finally { setBusy(false); }
  };
  const exportPreview = () => {
    if (!preview) return;
    const csv = [preview.columns, ...preview.rows].map((row) => row.map(csvValue).join(",")).join("\r\n");
    downloadFile("数据库查询结果.csv", `\uFEFF${csv}`, "text/csv;charset=utf-8");
    Toast.success("查询结果已导出");
  };
  const profileOptions = [...(db.profile && !profiles.some((item) => item.id === db.profile) ? [{ value: db.profile, label: db.profile }] : []), ...profiles.map((item) => ({ value: item.id, label: `${item.name} (${item.type})` }))];
  const tableOptions = tables.map((table, index) => ({ value: String(index), label: `${table.schema}.${table.name}` }));
  const typeOptions = [ { value: "mysql", label: "MySQL" }, { value: "postgres", label: "PostgreSQL" } ];
  const pageCount = preview ? Math.max(1, Math.ceil(preview.rows.length / PAGE_SIZE)) : 1;
  const pageRows = preview ? preview.rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE) : [];
  const editingProfile = profiles.some((profile) => profile.id === profileDraft.id);
  const selectedProfile = profiles.find((profile) => profile.id === db.profile);
  return <div className="database-source-fields">
    <Field label="本机服务"><Input className="h-7 text-xs" aria-label="数据库服务地址" value={source.url} disabled={disabled} onChange={(event) => onChange({ url: event.target.value })}/></Field>
    <Field label="服务令牌"><Input className="h-7 text-xs" type="password" aria-label="数据库服务令牌" value={token} disabled={disabled} onChange={(event) => { setToken(event.target.value); try { setDatabaseToken(source.url, event.target.value); } catch { /* 等待地址输入完整 */ } }}/></Field>
    <div className="database-source-actions"><Button size="sm" disabled={disabled || busy} onClick={() => void run("profiles")}>读取本机连接</Button>
      <Button size="sm" disabled={disabled || busy} onClick={() => { setProfileDraft(newProfile()); setProfileMessage(""); setCreating(true); }}>新建连接</Button></div>
    <Field label="数据库连接"><Select items={profileOptions} value={db.profile || null} disabled={disabled}
      onValueChange={(profile) => { update({ profile: String(profile) }); setTables([]); }}>
      <SelectTrigger className="w-full" size="sm" aria-label="数据库连接"><SelectValue placeholder="读取并选择连接"/></SelectTrigger>
      <SelectContent>{profileOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
    </Select></Field>
    {selectedProfile && <div className="database-source-actions">
      <Button size="sm" disabled={disabled || busy} onClick={() => editProfile(selectedProfile)}>编辑连接</Button>
      <Button size="sm" variant="destructive" disabled={disabled || busy} onClick={() => setPendingDelete(selectedProfile)}>删除连接</Button>
    </div>}
    <div className="database-source-actions"><Button size="sm" disabled={disabled || busy || !db.profile} onClick={() => void run("test")}>测试连接</Button>
      <Button size="sm" disabled={disabled || busy || !db.profile} onClick={() => void run("tables")}>读取表和视图</Button></div>
    {tables.length > 0 && <Field label="表或视图"><Select items={tableOptions} value={null} disabled={disabled}
      onValueChange={(value) => { const table = tables[Number(value)], profile = profiles.find((item) => item.id === db.profile); if (!table || !profile) return;
        const quote = (part: string) => profile.type === "mysql" ? `\`${part.replaceAll("`", "``")}\`` : `"${part.replaceAll('"', '""')}"`;
        update({ sql: `SELECT * FROM ${quote(table.schema)}.${quote(table.name)}` }); }}>
      <SelectTrigger className="w-full" size="sm" aria-label="数据库表"><SelectValue placeholder="选择表生成查询"/></SelectTrigger>
      <SelectContent>{tableOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
    </Select></Field>}
    <Field label="SQL 查询"><Textarea aria-label="数据库 SQL" rows={4} value={db.sql} disabled={disabled} placeholder="SELECT ..." onChange={(event) => update({ sql: event.target.value })}/></Field>
    <Button size="sm" disabled={disabled || busy || !db.profile || !db.sql.trim()} onClick={() => void run("query")}>预览查询</Button>
    {message && <p role="status" className="properties-note">{message}</p>}
    {preview && <section className="database-query-results" aria-label="数据库查询结果">
      <div className="database-query-results-heading"><strong>查询结果</strong><Button size="sm" onClick={exportPreview}>导出 CSV</Button></div>
      <div className="max-h-[260px] overflow-auto"><Table className="text-xs">
        <TableHeader><TableRow className="bg-muted/50 hover:bg-muted/50">{preview.columns.map((name) => <TableHead key={name}>{name}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{pageRows.map((cells, rowIndex) => <TableRow key={rowIndex}>{cells.map((value, index) => <TableCell key={index}>{formatCell(value)}</TableCell>)}</TableRow>)}</TableBody>
      </Table></div>
      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
        <Button size="xs" variant="outline" disabled={page <= 0} onClick={() => setPage((current) => current - 1)}>上一页</Button>
        <span>第 {page + 1} / {pageCount} 页</span>
        <Button size="xs" variant="outline" disabled={page >= pageCount - 1} onClick={() => setPage((current) => current + 1)}>下一页</Button>
      </div>
    </section>}
    <p className="properties-note">连接和密码配置在本机服务；令牌仅保存在当前浏览器会话。支持单条 SELECT，最多返回 1000 行。</p>
    <Dialog open={creating} onOpenChange={(open) => { if (!open) { setCreating(false); setProfileDraft(newProfile()); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{editingProfile ? "编辑数据库连接" : "新建数据库连接"}</DialogTitle></DialogHeader>
        <div className="database-source-fields">
          <Field label="连接名称"><Input aria-label="连接名称" value={profileDraft.name} onChange={(event) => updateProfile({ name: event.target.value })}/></Field>
          <Field label="数据库类型"><Select items={typeOptions} value={profileDraft.type}
            onValueChange={(value) => updateProfile({ type: value as ProfileDraft["type"], port: value === "mysql" ? 3306 : 5432 })}>
            <SelectTrigger className="w-full" aria-label="数据库类型"><SelectValue/></SelectTrigger>
            <SelectContent>{typeOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
          </Select></Field>
          <Field label="主机"><Input aria-label="数据库主机" value={profileDraft.host} onChange={(event) => updateProfile({ host: event.target.value })}/></Field>
          <Field label="端口"><NumberInput aria-label="数据库端口" min={1} max={65535} value={profileDraft.port} onChange={(port) => typeof port === "number" && updateProfile({ port })}/></Field>
          <Field label="用户名"><Input aria-label="数据库用户名" value={profileDraft.user} onChange={(event) => updateProfile({ user: event.target.value })}/></Field>
          <Field label={editingProfile ? "密码（留空保持不变）" : "密码"}><Input type="password" aria-label="数据库密码" placeholder={editingProfile ? "留空则保持当前密码" : "数据库账号密码"} value={profileDraft.password} onChange={(event) => updateProfile({ password: event.target.value })}/></Field>
          <Field label="数据库"><Input aria-label="数据库名称" value={profileDraft.database} onChange={(event) => updateProfile({ database: event.target.value })}/></Field>
          <Field label="SSL"><Switch aria-label="数据库 SSL" checked={profileDraft.ssl} onCheckedChange={(ssl) => updateProfile({ ssl })}/></Field>
          {profileMessage && <p role="status" className="properties-note">{profileMessage}</p>}
        </div>
        <DialogFooter className="database-source-actions">
          <Button variant="outline" disabled={busy} onClick={() => void saveOrTestProfile(false)}>测试连接</Button>
          <Button variant="outline" disabled={busy} onClick={() => { setCreating(false); setProfileDraft(newProfile()); }}>取消</Button>
          <Button disabled={busy} onClick={() => void saveOrTestProfile(true)}>{editingProfile ? "更新连接" : "保存连接"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除数据库连接</AlertDialogTitle>
          <AlertDialogDescription>确定删除「{pendingDelete?.name}」吗？使用该连接的数据源需要重新选择连接。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={() => { if (pendingDelete) void deleteProfile(pendingDelete); }}>删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
