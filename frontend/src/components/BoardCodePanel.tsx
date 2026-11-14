import { useEffect, useMemo, useState } from "react";
import { Button, Collapse, Input, Modal, Switch, TextArea, Toast, Upload } from "@douyinfe/semi-ui";
import type { BoardScript } from "../data/editor";
import { loadProjects, saveProjects } from "../state/projects";
import { getState, setState, useStore } from "../state/store";
import { getSceneBridge } from "../workers/bridge";
import { Field } from "./PropertyFields";
import { executeBoardScript } from "../data/scriptRuntime";

export default function BoardCodePanel() {
  const state = useStore();
  const scripts = state.settings.boardScripts;
  const [activeId, setActiveId] = useState("");
  const active = useMemo(() => scripts.find((item) => item.id === activeId) ?? scripts[0], [scripts, activeId]);
  const [code, setCode] = useState("");
  const [settingsJson, setSettingsJson] = useState("{}");
  const [metadataName, setMetadataName] = useState(() => loadProjects().find((item) => item.id === state.projectId)?.name ?? "看板");
  const updateScripts = (boardScripts: BoardScript[]) => getSceneBridge().post({ type: "configure", patch: { boardScripts } });
  const updateSettings = (patch: { boardVersion?: string; boardElementUid?: string }) => getSceneBridge().post({ type: "configure", patch });

  useEffect(() => {
    setCode(active?.code ?? "");
    setSettingsJson(active?.settingsJson ?? "{}");
  }, [active?.id, active?.code, active?.settingsJson]);

  const addScript = () => {
    if (scripts.length >= 20) { Toast.info("最多添加 20 个脚本"); return; }
    const item: BoardScript = { id: crypto.randomUUID(), name: `配置${scripts.length + 1}`, enabled: false, fileName: "", code: "", settingsJson: "{}" };
    updateScripts([...scripts, item]);
    setActiveId(item.id);
  };
  const applyScript = () => {
    try {
      const parsed: unknown = JSON.parse(settingsJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("自定义设置项须为 JSON 对象");
      if (!active) return;
      updateScripts(scripts.map((item) => item.id === active.id ? { ...item, code, settingsJson } : item));
      Toast.success("脚本已保存");
    } catch (exception) { Toast.error(exception instanceof Error ? exception.message : "设置项无效"); }
  };
  const removeScript = () => {
    if (!active) return;
    Modal.confirm({ title: "删除脚本", content: `确定删除「${active.name}」吗？`, okText: "删除", cancelText: "取消", onOk: () => {
      const next = scripts.filter((item) => item.id !== active.id);
      updateScripts(next);
      setActiveId(next[0]?.id ?? "");
    } });
  };
  const duplicateScript = () => {
    if (!active) { addScript(); return; }
    if (scripts.length >= 20) { Toast.info("最多添加 20 个脚本"); return; }
    const copy = { ...active, id: crypto.randomUUID(), name: `${active.name} 副本` };
    updateScripts([...scripts, copy]);
    setActiveId(copy.id);
  };
  const importScript = ({ fileInstance, onSuccess, onError }: { fileInstance: File; onSuccess: (value: unknown) => void; onError: (xhr: { status?: number }, error?: Event) => void }) => {
    if (!active) { onError({ status: 400 }, new Event("error")); return; }
    if (fileInstance.size > 100_000) { Toast.error("脚本文件不能超过 100 KB"); onError({ status: 400 }, new Event("error")); return; }
    void fileInstance.text().then((content) => {
      setCode(content);
      updateScripts(scripts.map((item) => item.id === active.id ? { ...item, code: content, fileName: fileInstance.name } : item));
      onSuccess({});
      Toast.success("脚本文件已载入");
    }).catch((exception: unknown) => {
      Toast.error(exception instanceof Error ? exception.message : "脚本文件读取失败");
      onError({ status: 400 }, new Event("error"));
    });
  };

  const saveName = () => {
    if (!state.projectId || !metadataName.trim()) return;
    const projects = loadProjects();
    saveProjects(projects.map((item) => item.id === state.projectId ? { ...item, name: metadataName.trim(), updatedAt: Date.now() } : item));
    window.dispatchEvent(new Event("dw:project-name"));
  };

  const testScript = () => {
    if (!active || !code.trim()) { Toast.info("先填写脚本代码"); return; }
    const draft = { ...active, code, settingsJson };
    executeBoardScript(draft, "custom", { test: true, projectId: state.projectId }, (message) => {
      const targetId = typeof message.targetId === "string" ? message.targetId : "";
      const current = getState();
      if (message.type === "event" && typeof message.name === "string")
        window.dispatchEvent(new CustomEvent("dw:dev-event", { detail: { name: message.name, payload: message.payload } }));
      else if (["text", "visible", "color"].includes(String(message.type)) && targetId && current.scene.some((item) => item.id === targetId)) {
        const runtime = { ...current.runtime };
        if (message.type === "text") runtime[targetId] = { ...runtime[targetId], text: String(message.text ?? "") };
        if (message.type === "visible") runtime[targetId] = { ...runtime[targetId], visible: Boolean(message.visible) };
        if (message.type === "color" && typeof message.color === "string" && /^#[0-9a-f]{6}$/i.test(message.color))
          runtime[targetId] = { ...runtime[targetId], color: message.color };
        setState({ runtime });
      } else if (message.type === "refresh") window.dispatchEvent(new Event("dw:refresh-data"));
      else if (message.type === "message") Toast.info(String(message.text ?? ""));
      else if (message.type === "navigate" && typeof message.target === "string")
        window.dispatchEvent(new CustomEvent("dw:navigate-board", { detail: { target: message.target } }));
    }, (message) => Toast.error(`脚本执行失败：${message}`));
  };

  return <div className="board-code-panel">
    <Collapse expandIconPosition="left" className="properties-collapse board-code-collapse" defaultActiveKey={["scripts", "more"]}>
      <Collapse.Panel header="二次开发" itemKey="scripts" extra={<span className="code-lock-icon" aria-label="本地脚本配置">⌑</span>}>
        <section className="property-section board-script-section">
          <div className="board-script-toolbar">
            <span>脚本</span>
            <Button size="small" theme="borderless" aria-label="上一脚本" disabled={scripts.length < 2} onClick={() => { const index = scripts.findIndex((item) => item.id === active?.id); setActiveId(scripts[(index - 1 + scripts.length) % scripts.length]!.id); }}>‹</Button>
            <Button size="small" theme="borderless" aria-label="下一脚本" disabled={scripts.length < 2} onClick={() => { const index = scripts.findIndex((item) => item.id === active?.id); setActiveId(scripts[(index + 1) % scripts.length]!.id); }}>›</Button>
            <Button size="small" theme="borderless" aria-label="添加脚本" disabled={scripts.length >= 20} onClick={addScript}>＋</Button>
            <Button size="small" theme="borderless" aria-label="复制脚本" disabled={!active} onClick={duplicateScript}>▣</Button>
            <Button size="small" theme="borderless" type="danger" aria-label="删除脚本" disabled={!active} onClick={removeScript}>⌫</Button>
          </div>
          {!active ? <p className="properties-note">未设置，请点击右上角加号添加。</p> : <>
            <div className="board-script-card">
              <div className="board-script-row"><strong>{active.name}</strong><Field label="是否启用"><Switch size="small" aria-label="是否启用脚本" checked={active.enabled} onChange={(enabled) => updateScripts(scripts.map((item) => item.id === active.id ? { ...item, enabled } : item))}/></Field></div>
              <Field label="脚本名称"><Input size="small" aria-label="脚本名称" value={active.name} maxLength={100} onChange={(name) => updateScripts(scripts.map((item) => item.id === active.id ? { ...item, name } : item))}/></Field>
              <Field label="代码文件"><div className="board-script-file"><span title={active.fileName}>{active.fileName || "未选择"}</span><Upload action="" accept=".js,.mjs" uploadTrigger="custom" showUploadList={false} customRequest={importScript}><Button size="small">选择文件</Button></Upload></div></Field>
              <TextArea aria-label="脚本代码" value={code} onChange={setCode} rows={8} spellCheck={false} placeholder="在这里编辑脚本内容"/>
              <h4>自定义设置项 (JSON)</h4>
              <TextArea aria-label="脚本自定义设置项" value={settingsJson} onChange={setSettingsJson} rows={3} spellCheck={false}/>
              <div className="board-script-actions"><Button size="small" theme="solid" onClick={applyScript}>保存脚本</Button>
                <Button size="small" disabled={!code.trim()} onClick={testScript}>测试脚本</Button></div>
              <p className="properties-note">脚本在隔离的 Worker 中运行。回调格式：<code>function onEvent(payload, event, dw) {'{'} ... {'}'}</code>；通过 <code>dw.emit</code>、<code>dw.setText</code> 等方法通知看板。</p>
            </div>
          </>}
        </section>
      </Collapse.Panel>
      <Collapse.Panel header="更多" itemKey="more"><section className="property-section board-meta-section">
        <Field label="名称"><Input size="small" aria-label="看板名称" value={metadataName} onChange={setMetadataName} onBlur={saveName} onEnterPress={(event) => event.currentTarget.blur()}/></Field>
        <Field label="版本"><Input size="small" aria-label="看板版本" value={state.settings.boardVersion} maxLength={32} onChange={(boardVersion) => updateSettings({ boardVersion })} onBlur={() => updateSettings({ boardVersion: state.settings.boardVersion.trim() || "0.0.1" })}/></Field>
        <Field label="elementUID"><Input size="small" aria-label="elementUID" value={state.settings.boardElementUid} maxLength={100} onChange={(boardElementUid) => updateSettings({ boardElementUid })}/></Field>
      </section></Collapse.Panel>
    </Collapse>
  </div>;
}
