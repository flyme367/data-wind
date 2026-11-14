import { useEffect, useState } from "react";
import { Button, Input, InputNumber, Modal, Select, Toast } from "@douyinfe/semi-ui";
import type { DataSourceConfig } from "../data/dataSources";
import { databaseRequest, databaseToken, DEFAULT_DB_GATEWAY, setDatabaseToken } from "../data/localDatabase";
import { Field } from "./PropertyFields";

type Webhook = { id: string; name: string; mode: "latest" | "accumulate"; maxRows: number; url: string };
type WebhookDraft = Omit<Webhook, "url">;
const newWebhook = (): WebhookDraft => ({ id: crypto.randomUUID(), name: "", mode: "latest", maxRows: 1000 });

export default function WebhookSourceFields({ source, disabled, onChange }: {
  source: DataSourceConfig; disabled?: boolean; onChange: (patch: Partial<DataSourceConfig>) => void;
}) {
  const [token, setToken] = useState("");
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [draft, setDraft] = useState<WebhookDraft>(newWebhook);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const config = source.webhook;
  const selected = webhooks.find((item) => item.id === config?.id);
  useEffect(() => {
    try { setToken(databaseToken(source.url)); } catch { setToken(""); }
    setWebhooks([]);
  }, [source.url]);

  const readWebhooks = async () => {
    setBusy(true); setMessage("");
    try {
      setDatabaseToken(source.url, token);
      const result = await databaseRequest<{ webhooks: Webhook[] }>(source.url, "/webhooks");
      setWebhooks(result.webhooks);
      setMessage(`已读取 ${result.webhooks.length} 个本机 Webhook`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "无法读取本机 Webhook"); }
    finally { setBusy(false); }
  };

  const openNew = () => { setDraft(newWebhook()); setVisible(true); };
  const openEdit = (webhook: Webhook) => {
    setDraft({ id: webhook.id, name: webhook.name, mode: webhook.mode, maxRows: webhook.maxRows });
    setVisible(true);
  };
  const save = async () => {
    if (!draft.name.trim()) { setMessage("请填写 Webhook 名称"); return; }
    setBusy(true); setMessage("");
    try {
      setDatabaseToken(source.url, token);
      const editing = webhooks.some((item) => item.id === draft.id);
      await databaseRequest(source.url, "/webhooks", draft, undefined, editing ? "PUT" : "POST");
      const result = await databaseRequest<{ webhooks: Webhook[] }>(source.url, "/webhooks");
      setWebhooks(result.webhooks);
      onChange({ url: source.url || DEFAULT_DB_GATEWAY, webhook: { id: draft.id, mode: draft.mode, maxRows: draft.maxRows } });
      setVisible(false);
      setMessage("Webhook 接收配置已保存到本机");
      Toast.success("Webhook 接收地址已保存");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存 Webhook 失败"); }
    finally { setBusy(false); }
  };
  const remove = (webhook: Webhook) => Modal.confirm({
    title: "删除 Webhook 接收地址",
    content: `确定删除「${webhook.name}」吗？外部推送地址将立即失效。`,
    okText: "删除", cancelText: "取消",
    onOk: async () => {
      setBusy(true);
      try {
        setDatabaseToken(source.url, token);
        await databaseRequest(source.url, "/webhooks", { id: webhook.id }, undefined, "DELETE");
        setWebhooks((items) => items.filter((item) => item.id !== webhook.id));
        if (config?.id === webhook.id) onChange({ webhook: undefined });
        setMessage(`已删除「${webhook.name}」`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "删除 Webhook 失败");
        throw error;
      } finally { setBusy(false); }
    },
  });
  const copyUrl = async () => {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selected.url); Toast.success("Webhook 接收地址已复制"); }
    catch { Toast.error("复制失败，请选中地址后手动复制"); }
  };
  const serviceUrl = selected?.url ?? (config?.id ? `${source.url.replace(/\/$/, "")}/hook/${config.id}` : "");
  const editing = webhooks.some((item) => item.id === draft.id);

  return <div className="webhook-source-fields">
    <Field label="本机服务"><Input size="small" aria-label="Webhook 服务地址" value={source.url} disabled={disabled} onChange={(url) => onChange({ url })}/></Field>
    <Field label="服务令牌"><Input size="small" mode="password" aria-label="Webhook 服务令牌" value={token} disabled={disabled}
      onChange={(value) => { setToken(value); try { setDatabaseToken(source.url, value); } catch { /* 等待地址输入完整 */ } }}/></Field>
    <div className="database-source-actions">
      <Button size="small" disabled={disabled || busy} onClick={() => void readWebhooks()}>读取接收地址</Button>
      <Button size="small" disabled={disabled || busy} onClick={openNew}>新建 Webhook</Button>
    </div>
    <Field label="Webhook 接收"><Select size="small" aria-label="Webhook 接收地址" value={config?.id ?? ""} disabled={disabled}
      placeholder="读取并选择接收地址"
      optionList={[...(config?.id && !webhooks.some((item) => item.id === config.id) ? [{ value: config.id, label: config.id }] : []),
        ...webhooks.map((item) => ({ value: item.id, label: `${item.name} · ${item.mode === "latest" ? "实时更新" : `累积 ${item.maxRows} 条`}` }))]}
      onChange={(id) => { const webhook = webhooks.find((item) => item.id === String(id)); if (webhook) onChange({ webhook: { id: webhook.id, mode: webhook.mode, maxRows: webhook.maxRows } }); }}/></Field>
    {selected && <>
      <div className="webhook-copy-row"><Input size="small" aria-label="Webhook 外部推送地址" value={serviceUrl} readOnly/><Button size="small" disabled={disabled} onClick={() => void copyUrl()}>复制地址</Button></div>
      <div className="database-source-actions">
        <Button size="small" disabled={disabled || busy} onClick={() => openEdit(selected)}>编辑接收规则</Button>
        <Button size="small" type="danger" disabled={disabled || busy} onClick={() => remove(selected)}>删除地址</Button>
      </div>
    </>}
    {message && <p role="status" className="properties-note">{message}</p>}
    <p className="properties-note">外部程序向该地址发送 HTTP POST（JSON 或表单）。实时更新会覆盖现有数据；累积更新最多保留设定条数。地址在本机运行，只能由当前电脑可访问的发送端推送。</p>
    <Modal title={editing ? "编辑 Webhook 接收规则" : "新建 Webhook 接收规则"} visible={visible}
      onCancel={() => setVisible(false)} onOk={() => void save()} okText={editing ? "更新规则" : "生成接收地址"} cancelText="取消" confirmLoading={busy}>
      <div className="webhook-source-fields">
        <Field label="连接名称"><Input aria-label="Webhook 连接名称" value={draft.name} maxLength={100} onChange={(name) => setDraft((current) => ({ ...current, name }))}/></Field>
        <Field label="数据响应"><Select aria-label="Webhook 数据响应" value={draft.mode}
          optionList={[{ value: "latest", label: "实时更新（覆盖旧数据）" }, { value: "accumulate", label: "累积更新（保留历史）" }]}
          onChange={(mode) => setDraft((current) => ({ ...current, mode: mode as WebhookDraft["mode"] }))}/></Field>
        {draft.mode === "accumulate" && <Field label="最大数据量"><InputNumber aria-label="Webhook 最大数据量" min={1} max={5000} step={100} value={draft.maxRows}
          onChange={(maxRows) => typeof maxRows === "number" && setDraft((current) => ({ ...current, maxRows }))}/></Field>}
        <p className="properties-note">数据以字段名合并为表格列。每个接收地址只保存最近 1 MB 数据；服务重启后接收数据会清空。</p>
      </div>
    </Modal>
  </div>;
}
