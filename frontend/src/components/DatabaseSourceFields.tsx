import { useEffect, useState } from "react";
import { Button, Input, InputNumber, Modal, Select, Switch, Table as SemiTable, TextArea, Toast } from "@douyinfe/semi-ui";
import type { DataSourceConfig } from "../data/dataSources";
import { databaseRequest, databaseToken, normalizeDatabaseRows, setDatabaseToken } from "../data/localDatabase";
import { downloadFile } from "../state/projects";
import { Field } from "./PropertyFields";

type Profile = { id: string; name: string; type: "mysql" | "postgres"; host: string; port: number; user: string; database: string; ssl: boolean };
type Table = { schema: string; name: string };
type ProfileDraft = Profile & { password: string };
const newProfile = (): ProfileDraft => ({ id: crypto.randomUUID(), name: "", type: "mysql", host: "127.0.0.1", port: 3306, user: "", password: "", database: "", ssl: false });

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
  const [creating, setCreating] = useState(false);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(newProfile);
  const [profileMessage, setProfileMessage] = useState("");
  const db = source.database ?? { profile: "", sql: "" };
  const update = (patch: Partial<typeof db>) => onChange({ database: { ...db, ...patch } });
  const updateProfile = (patch: Partial<ProfileDraft>) => setProfileDraft((current) => ({ ...current, ...patch }));
  useEffect(() => { try { setToken(databaseToken(source.url)); } catch { setToken(""); } setProfiles([]); setTables([]); }, [source.url]);
  const run = async (action: "profiles" | "test" | "tables" | "query") => {
    setBusy(true); setMessage(""); setPreview(null);
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
  const deleteProfile = (profile: Profile) => Modal.confirm({
    title: "删除数据库连接",
    content: `确定删除「${profile.name}」吗？使用该连接的数据源需要重新选择连接。`,
    okText: "删除", cancelText: "取消",
    onOk: async () => {
      setBusy(true);
      try {
        await databaseRequest(source.url, "/profiles", { id: profile.id }, undefined, "DELETE");
        setProfiles((current) => current.filter((item) => item.id !== profile.id));
        if (db.profile === profile.id) update({ profile: "" });
        setTables([]);
        setMessage(`已删除连接「${profile.name}」`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "删除连接失败");
        throw error;
      } finally { setBusy(false); }
    },
  });
  const exportPreview = () => {
    if (!preview) return;
    const csv = [preview.columns, ...preview.rows].map((row) => row.map(csvValue).join(",")).join("\r\n");
    downloadFile("数据库查询结果.csv", `\uFEFF${csv}`, "text/csv;charset=utf-8");
    Toast.success("查询结果已导出");
  };
  const tableRows = preview?.rows.map((cells, rowIndex) => ({ rowIndex, cells })) ?? [];
  const tableColumns = preview?.columns.map((name, index) => ({
    key: name,
    title: name,
    render: (_value: unknown, record: (typeof tableRows)[number]) => {
      const value = record.cells[index];
      return value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    },
  })) ?? [];
  const editingProfile = profiles.some((profile) => profile.id === profileDraft.id);
  const selectedProfile = profiles.find((profile) => profile.id === db.profile);
  return <div className="database-source-fields">
    <Field label="本机服务"><Input size="small" aria-label="数据库服务地址" value={source.url} disabled={disabled} onChange={(url) => onChange({ url })}/></Field>
    <Field label="服务令牌"><Input size="small" mode="password" aria-label="数据库服务令牌" value={token} disabled={disabled} onChange={(value) => { setToken(value); try { setDatabaseToken(source.url, value); } catch { /* 等待地址输入完整 */ } }}/></Field>
    <div className="database-source-actions"><Button size="small" disabled={disabled || busy} onClick={() => void run("profiles")}>读取本机连接</Button>
      <Button size="small" disabled={disabled || busy} onClick={() => { setProfileDraft(newProfile()); setProfileMessage(""); setCreating(true); }}>新建连接</Button></div>
    <Field label="数据库连接"><Select size="small" aria-label="数据库连接" value={db.profile} disabled={disabled}
      placeholder="读取并选择连接" optionList={[...(db.profile && !profiles.some((item) => item.id === db.profile) ? [{ value: db.profile, label: db.profile }] : []), ...profiles.map((item) => ({ value: item.id, label: `${item.name} (${item.type})` }))]}
      onChange={(profile) => { update({ profile: String(profile) }); setTables([]); }}/></Field>
    {selectedProfile && <div className="database-source-actions">
      <Button size="small" disabled={disabled || busy} onClick={() => editProfile(selectedProfile)}>编辑连接</Button>
      <Button size="small" type="danger" disabled={disabled || busy} onClick={() => deleteProfile(selectedProfile)}>删除连接</Button>
    </div>}
    <div className="database-source-actions"><Button size="small" disabled={disabled || busy || !db.profile} onClick={() => void run("test")}>测试连接</Button>
      <Button size="small" disabled={disabled || busy || !db.profile} onClick={() => void run("tables")}>读取表和视图</Button></div>
    {tables.length > 0 && <Field label="表或视图"><Select size="small" aria-label="数据库表" filter disabled={disabled}
      placeholder="选择表生成查询" optionList={tables.map((table, index) => ({ value: String(index), label: `${table.schema}.${table.name}` }))}
      onChange={(value) => { const table = tables[Number(value)], profile = profiles.find((item) => item.id === db.profile); if (!table || !profile) return;
        const quote = (part: string) => profile.type === "mysql" ? `\`${part.replaceAll("`", "``")}\`` : `"${part.replaceAll('"', '""')}"`;
        update({ sql: `SELECT * FROM ${quote(table.schema)}.${quote(table.name)}` }); }}/></Field>}
    <Field label="SQL 查询"><TextArea aria-label="数据库 SQL" rows={4} value={db.sql} disabled={disabled} placeholder="SELECT ..." onChange={(sql) => update({ sql })}/></Field>
    <Button size="small" disabled={disabled || busy || !db.profile || !db.sql.trim()} onClick={() => void run("query")}>预览查询</Button>
    {message && <p role="status" className="properties-note">{message}</p>}
    {preview && <section className="database-query-results" aria-label="数据库查询结果">
      <div className="database-query-results-heading"><strong>查询结果</strong><Button size="small" onClick={exportPreview}>导出 CSV</Button></div>
      <SemiTable size="small" bordered dataSource={tableRows} columns={tableColumns} rowKey="rowIndex" pagination={{ pageSize: 20, size: "small" }} scroll={{ x: "max-content", y: 260 }}/>
    </section>}
    <p className="properties-note">连接和密码配置在本机服务；令牌仅保存在当前浏览器会话。支持单条 SELECT，最多返回 1000 行。</p>
    <Modal title={editingProfile ? "编辑数据库连接" : "新建数据库连接"} visible={creating} onCancel={() => { setCreating(false); setProfileDraft(newProfile()); }}
      footer={<div className="database-source-actions"><Button disabled={busy} onClick={() => void saveOrTestProfile(false)}>测试连接</Button>
        <Button disabled={busy} onClick={() => { setCreating(false); setProfileDraft(newProfile()); }}>取消</Button>
        <Button theme="solid" loading={busy} onClick={() => void saveOrTestProfile(true)}>{editingProfile ? "更新连接" : "保存连接"}</Button></div>}>
      <div className="database-source-fields">
        <Field label="连接名称"><Input aria-label="连接名称" value={profileDraft.name} onChange={(name) => updateProfile({ name })}/></Field>
        <Field label="数据库类型"><Select aria-label="数据库类型" value={profileDraft.type} optionList={[{ value: "mysql", label: "MySQL" }, { value: "postgres", label: "PostgreSQL" }]}
          onChange={(value) => updateProfile({ type: value as ProfileDraft["type"], port: value === "mysql" ? 3306 : 5432 })}/></Field>
        <Field label="主机"><Input aria-label="数据库主机" value={profileDraft.host} onChange={(host) => updateProfile({ host })}/></Field>
        <Field label="端口"><InputNumber aria-label="数据库端口" min={1} max={65535} value={profileDraft.port} onChange={(port) => typeof port === "number" && updateProfile({ port })}/></Field>
        <Field label="用户名"><Input aria-label="数据库用户名" value={profileDraft.user} onChange={(user) => updateProfile({ user })}/></Field>
        <Field label={editingProfile ? "密码（留空保持不变）" : "密码"}><Input mode="password" aria-label="数据库密码" placeholder={editingProfile ? "留空则保持当前密码" : "数据库账号密码"} value={profileDraft.password} onChange={(password) => updateProfile({ password })}/></Field>
        <Field label="数据库"><Input aria-label="数据库名称" value={profileDraft.database} onChange={(database) => updateProfile({ database })}/></Field>
        <Field label="SSL"><Switch aria-label="数据库 SSL" checked={profileDraft.ssl} onChange={(ssl) => updateProfile({ ssl })}/></Field>
        {profileMessage && <p role="status" className="properties-note">{profileMessage}</p>}
      </div>
    </Modal>
  </div>;
}
