import { exportBoardPng } from "../engine/exportBoard";
import { canvasPng, captureSceneFrame } from "../engine/captureFrame";
import { useRef, useState, type ReactNode } from "react";
import { Button, Checkbox, Dropdown, Modal, Select, TextArea, Input, Toast, Tooltip } from "@douyinfe/semi-ui";
import { AdjacentItem, Data, Click, Cube, Send, FullScreen, Left, Helpcenter } from "@icon-park/react";
import { getState, setState, useStore } from "../state/store";
import { copySelection, pasteSelection, deleteSelection, selectAll, selection, focusSelection } from "../state/sceneActions";
import { importGlb } from "../engine/importGlb";
import { exportPublishBundle } from "../publish/exportBundle";
import SceneSettings from "./SceneSettings";
import DataConditionsEditor from "./DataConditionsEditor";
import { getSceneBridge } from "../workers/bridge";
import { downloadFile, parseProjectFile, persistScene, persistEditorSettings, persistBoardSize, readProjectParams, loadProjects, saveProjects } from "../state/projects";
import { exportBoardMedia, restoreBoardMedia } from "../state/boardMedia";
import { kitMetadata } from "../data/kitRuntime";
import { KIT_WEATHER_TYPE } from "../data/kitWeather";

export async function saveCurrentScene() {
  const projectId = getState().projectId;
  if (!projectId) throw new Error("项目尚未加载完成");
  const snapshot = await getSceneBridge().checkpoint(projectId);
  if (getState().projectId !== projectId) throw new Error("项目已切换，请重新保存");
  persistScene(projectId, snapshot.tree);
  persistEditorSettings(projectId,snapshot.settings);persistBoardSize(projectId,getState().boardSize);
  setState({ lastSavedAt: Date.now(), saveError: null });
  return snapshot;
}

export async function captureViewport() {
  const canvas = await captureSceneFrame();
  downloadFile("三维场景.png", await canvasPng(canvas), "image/png");
}

// 对齐山海鲸顶栏菜单：图标在左、文案在后的横向触发器（带下拉箭头）
function Menu({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return <Dropdown trigger="click" position="bottomLeft" render={<Dropdown.Menu>{children}</Dropdown.Menu>}>
    <Button className="editor-menu-button" theme="borderless" size="small">{icon}{label}<span className="menu-caret" aria-hidden /></Button>
  </Dropdown>;
}

export default function TopMenuBar({ projectName, projectId, editing, setEditing, preview, setPreview }: {
  projectName: string; projectId: string; editing: boolean; setEditing: (value: boolean) => void;
  preview: boolean; setPreview: (value: boolean) => void;
}) {
  const state = useStore();
  const [history,setHistory]=useState(false);
  const [renaming,setRenaming]=useState(false);
  const [name,setName]=useState(projectName);
  const [importing,setImporting]=useState(false);
  const [sourceDraft,setSourceDraft]=useState("");
  const glbRef=useRef<HTMLInputElement>(null);
  const [sharing, setSharing] = useState(false);
  const [includeWeatherKeys, setIncludeWeatherKeys] = useState(false);
  const [dataVisible, setDataVisible] = useState(false);
  const [conditionsVisible, setConditionsVisible] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [pointA, setPointA] = useState("");
  const [pointB, setPointB] = useState("");
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [audit, setAudit] = useState<{ group: string; items: string[] }[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const action = (type: "undo" | "redo") => getSceneBridge().post({ type });
  const save = async () => { try { await saveCurrentScene(); Toast.success("项目已保存到本地"); }
    catch (error) { Toast.error(error instanceof Error ? error.message : "保存失败，请导出项目文件备份"); } };
  const goHome = async () => { try { await saveCurrentScene(); window.location.hash = "#/"; }
    catch (error) { Toast.error(error instanceof Error ? error.message : "保存失败，请重试"); } };
  const exportScene = async () => {
    try {
      const snapshot = await getSceneBridge().checkpoint(projectId);
      if (getState().projectId !== projectId) throw new Error("项目已切换，请重新导出");
      const boardMedia = await exportBoardMedia(snapshot.settings);
      downloadFile(`${projectName}.json`, JSON.stringify({ format: "data-wind", version: 2, name: projectName,
        scene: snapshot.tree, settings: snapshot.settings, params: readProjectParams(projectId),
        boardSize: getState().boardSize, boardMedia }, null, 2));
    } catch (error) { Toast.error(error instanceof Error ? error.message : "项目导出失败"); }
  };
  const exportPublish = async () => {
    try { await saveCurrentScene(); await exportPublishBundle(projectId, projectName, includeWeatherKeys); Toast.success("发布包已导出"); }
    catch (error) { Toast.error(error instanceof Error ? error.message : "发布包导出失败"); }
  };
  const openPublish = async () => {
    const tab = window.open("about:blank", "_blank");
    if (!tab) { Toast.error("浏览器阻止了新页面，请允许弹出窗口后重试"); return; }
    try {
      await saveCurrentScene();
      tab.location.href = `viewer.html?projectId=${encodeURIComponent(projectId)}`;
      setSharing(false);
    } catch (error) { tab.close(); Toast.error(error instanceof Error ? error.message : "保存失败"); }
  };
  const a = state.scene.find((n) => n.id === pointA)?.transform.position;
  const b = state.scene.find((n) => n.id === pointB)?.transform.position;
  const distance = a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : null;
  // 另存为：复制项目元数据与场景数据为新项目，不切换当前编辑页
  const saveAs = async () => {
    try {
      const snapshot = await saveCurrentScene();
      const newId = crypto.randomUUID();
      const base = loadProjects().find((p) => p.id === projectId);
      const name = `${projectName} 副本`;
      saveProjects([...loadProjects(), { ...(base ?? { template: "empty" as const, folder: undefined }), id: newId, name, createdAt: Date.now(), openedAt: Date.now(), updatedAt: Date.now() }]);
      persistScene(newId, snapshot.tree);
      persistEditorSettings(newId, snapshot.settings);
      persistBoardSize(newId, getState().boardSize);
      Toast.success(`已另存为「${name}」，可在工作台打开`);
    } catch (error) { Toast.error(error instanceof Error ? error.message : "另存为失败"); }
  };
  // 项目素材检查：对齐山海鲸「操作 → 项目素材检查」，扫描缺失资源与异常数据连接
  const runAudit = () => {
    const missingModels: string[] = [], missingMedia: string[] = [], brokenData: string[] = [];
    for (const n of state.scene) {
      if (n.type === "model" && !n.modelId && !n.customMesh) missingModels.push(n.name);
      if (n.widget) {
        const kind = n.widget.kind, data = n.data ?? {};
        if ((kind === "iframe" || kind === "video" || kind === "audio" || kind === "monitor"
          || kind === "carouselVideo" || kind === "pdf") && !data.url && !data.src) missingMedia.push(n.name);
        else if (kind === "image" && !n.widget.image) missingMedia.push(n.name);
        else if ((kind === "carousel" || kind === "carouselVideo") && !(Array.isArray(data.urls) && data.urls.length)) missingMedia.push(n.name);
      }
      if (n.dataSource && state.dataStatus[n.id]?.state === "error") brokenData.push(n.name);
    }
    setAudit([
      { group: "三维模型缺少资源", items: missingModels },
      { group: "媒体 / 网页地址未配置", items: missingMedia },
      { group: "数据连接异常", items: brokenData },
    ].filter((group) => group.items.length));
  };
  // 操作 → 图层 / 对齐 / 排列 子菜单（对齐山海鲸主菜单结构）
  const ids = selection();
  const postAlign = (axis: 0 | 1 | 2, mode: "min" | "center" | "max" | "board" | "distribute", edge?: "min" | "center" | "max") =>
    getSceneBridge().post({ type: "align", ids, axis, mode, edge, board: { width: state.boardSize.width, height: state.boardSize.height } });
  const submenu = (label: string, disabled: boolean,
    items: { label: string; disabled?: boolean; onClick: () => void }[]) =>
    <Dropdown trigger="hover" position="rightTop" render={<Dropdown.Menu>
      {items.map((item) => <Dropdown.Item key={item.label} disabled={item.disabled} onClick={item.onClick}>{item.label}</Dropdown.Item>)}
    </Dropdown.Menu>}>
      <Dropdown.Item disabled={disabled}>{label}<span className="menu-sub-arrow">›</span></Dropdown.Item>
    </Dropdown>;

  return <header className="editor-header">
    <Tooltip content="返回工作台"><span><Button theme="borderless" icon={<Left />} aria-label="返回工作台" onClick={goHome} /></span></Tooltip>
    <Menu label="项目" icon={<AdjacentItem />}>
      <Dropdown.Item onClick={save}>保存项目 <kbd>⌘ S</kbd></Dropdown.Item>
      <Dropdown.Item onClick={saveAs}>另存为...</Dropdown.Item>
      <Dropdown.Item onClick={()=>{setName(projectName);setRenaming(true)}}>重命名 <kbd>R</kbd></Dropdown.Item>
      <Dropdown.Divider />
      <Dropdown.Item onClick={exportScene}>导出项目文件</Dropdown.Item>
      <Dropdown.Item onClick={()=>exportBoardPng().then(({embeddedPages})=>{if(embeddedPages)Toast.info("内嵌网页在图片中显示为占位卡片")}).catch((error:unknown)=>{console.error("看板导出失败",error);Toast.error(error instanceof Error?error.message:String(error))})}>导出完整看板 PNG</Dropdown.Item>
      <Dropdown.Item onClick={() => fileRef.current?.click()}>导入场景 JSON</Dropdown.Item>
      <Dropdown.Divider />
      <Dropdown.Item onClick={() => setSettingsVisible(true)}>项目设置(P)...</Dropdown.Item>
      <Dropdown.Item onClick={goHome}>关闭项目</Dropdown.Item>
    </Menu>
    <Menu label="数据" icon={<Data />}>
      <Dropdown.Item onClick={() => { if (!state.selectedId) Toast.info("请先选择一个组件"); else window.dispatchEvent(new Event("dw:open-data")); }}>添加数据...</Dropdown.Item>
      <Dropdown.Item onClick={() => { window.dispatchEvent(new Event("dw:refresh-data")); Toast.info("已刷新数据连接"); }}>刷新数据 <kbd>F5</kbd></Dropdown.Item>
      <Dropdown.Item onClick={() => setConditionsVisible(true)}>数据条件...</Dropdown.Item>
      <Dropdown.Divider />
      <Dropdown.Item onClick={() => {setSourceDraft(JSON.stringify({scene:state.scene,settings:state.settings,boardSize:state.boardSize},null,2));setDataVisible(true)}}>编辑场景 JSON</Dropdown.Item>
      <Dropdown.Item onClick={exportScene}>导出 JSON 数据</Dropdown.Item>
    </Menu>
    <Menu label="操作" icon={<Click />}>
      <Dropdown.Item disabled={!state.canUndo} onClick={() => action("undo")}>撤销 <kbd>⌘ Z</kbd></Dropdown.Item>
      <Dropdown.Item disabled={!state.canRedo} onClick={() => action("redo")}>恢复 <kbd>⌘ Y</kbd></Dropdown.Item>
      <Dropdown.Item disabled={!state.selectedId} onClick={copySelection}>复制 <kbd>⌘ C</kbd></Dropdown.Item>
      <Dropdown.Item onClick={pasteSelection}>粘贴 <kbd>⌘ V</kbd></Dropdown.Item>
      <Dropdown.Item disabled={!state.selectedId} onClick={()=>deleteSelection()}>删除 <kbd>⌘ Backspace</kbd></Dropdown.Item>
      <Dropdown.Item onClick={()=>selectAll(editing)}>全选 <kbd>⌘ A</kbd></Dropdown.Item>
      {submenu("图层", !ids.length, [
        { label: "置于顶层", disabled: !ids.length, onClick: () => getSceneBridge().post({ type: "reorder", ids, direction: "front" }) },
        { label: "置于底层", disabled: !ids.length, onClick: () => getSceneBridge().post({ type: "reorder", ids, direction: "back" }) },
        { label: "上移一层", disabled: !ids.length, onClick: () => getSceneBridge().post({ type: "reorder", ids, direction: "forward" }) },
        { label: "下移一层", disabled: !ids.length, onClick: () => getSceneBridge().post({ type: "reorder", ids, direction: "backward" }) },
      ])}
      {submenu("对齐", !ids.length, [
        { label: "水平居中", disabled: !ids.length, onClick: () => postAlign(0, "board") },
        { label: "垂直居中", disabled: !ids.length, onClick: () => postAlign(1, "board") },
        { label: "顶对齐(T)", disabled: ids.length < 2, onClick: () => postAlign(1, "min") },
        { label: "垂直居中对齐(M)", disabled: ids.length < 2, onClick: () => postAlign(1, "center") },
        { label: "底对齐(B)", disabled: ids.length < 2, onClick: () => postAlign(1, "max") },
        { label: "左对齐(L)", disabled: ids.length < 2, onClick: () => postAlign(0, "min") },
        { label: "水平居中对齐(C)", disabled: ids.length < 2, onClick: () => postAlign(0, "center") },
        { label: "右对齐(R)", disabled: ids.length < 2, onClick: () => postAlign(0, "max") },
      ])}
      {submenu("排列", ids.length < 3, [
        { label: "按顶分布(T)", disabled: ids.length < 3, onClick: () => postAlign(1, "distribute", "min") },
        { label: "垂直居中分布(M)", disabled: ids.length < 3, onClick: () => postAlign(1, "distribute", "center") },
        { label: "按底分布(B)", disabled: ids.length < 3, onClick: () => postAlign(1, "distribute", "max") },
        { label: "按左分布(L)", disabled: ids.length < 3, onClick: () => postAlign(0, "distribute", "min") },
        { label: "水平居中分布(C)", disabled: ids.length < 3, onClick: () => postAlign(0, "distribute", "center") },
        { label: "按右分布(R)", disabled: ids.length < 3, onClick: () => postAlign(0, "distribute", "max") },
      ])}
      <Dropdown.Item disabled={state.selectedIds.length<2} onClick={()=>getSceneBridge().post({type:"group",ids:selection()})}>合并到分组 <kbd>⌘ G</kbd></Dropdown.Item>
      <Dropdown.Item disabled={!state.selectedId} onClick={()=>getSceneBridge().post({type:"ungroup",ids:selection()})}>取消分组 <kbd>⌘ ⇧ G</kbd></Dropdown.Item>
      <Dropdown.Item onClick={runAudit}>项目素材检查</Dropdown.Item>
      <Dropdown.Item onClick={()=>setHistory(true)}>历史记录</Dropdown.Item>
      <Dropdown.Divider />
      <Dropdown.Item onClick={() => setMeasuring(true)}>测量对象距离</Dropdown.Item>
      <Dropdown.Item onClick={() => captureViewport().catch((error: unknown) => Toast.error(error instanceof Error ? error.message : "三维截图失败"))}>视口截图</Dropdown.Item>
    </Menu>
    <Menu label="3D" icon={<Cube />}>
      <Dropdown.Item onClick={() => { setEditing(true); getSceneBridge().post({ type: "add", node: { type: "model", name: "模型", color: "#A4B7D8" } }); }}>添加3D</Dropdown.Item>
      <Dropdown.Item onClick={() => setEditing(true)}>进入3D编辑</Dropdown.Item>
      <Dropdown.Item onClick={() => setEditing(false)}>退出3D编辑</Dropdown.Item>
      <Dropdown.Item onClick={()=>glbRef.current?.click()}>{importing?"正在导入…":"导入 GLB 模型"}</Dropdown.Item>
      <Dropdown.Item onClick={()=>focusSelection()}>定位选中对象 <kbd>F</kbd></Dropdown.Item>
      <Dropdown.Item onClick={() => window.dispatchEvent(new Event("dw:reset-camera"))}>重置视角</Dropdown.Item>
      <Dropdown.Divider />
      {(["grid", "flylines", "stats"] as const).map((key, index) => <Dropdown.Item key={key}
        onClick={() => getSceneBridge().post({type:"configure",patch:{[key]:!state.hud[key]}})}>
        {state.hud[key] ? "✓ " : "　"}{["显示网格", "飞线动效", "性能统计"][index]}</Dropdown.Item>)}
    </Menu>
    <Button className="editor-menu-button editor-help" theme="borderless" size="small" icon={<Helpcenter />} onClick={() => Modal.info({ title: "操作帮助", content: "Shift 点击多选；W/E/R 切换移动、旋转和缩放，拖动彩色轴修改。F 定位对象；左键空白旋转，右键平移。鼠标滚轮或触控板双指捏合缩放画布。⌘/Ctrl+C/V 复制粘贴，⌘/Ctrl+G 分组，⌘/Ctrl+Shift+G 取消分组，Delete 删除，⌘/Ctrl+Z 撤销。看板组件支持拖动及尺寸调整。" })}>操作帮助</Button>
    <Button className="editor-title" theme="borderless" size="small" title="重命名项目" onClick={()=>{setName(projectName);setRenaming(true)}}>{projectName}</Button>
    <div className="editor-header-actions">
      <Button size="small" theme="solid" icon={<Send />} onClick={() => { setIncludeWeatherKeys(false); setSharing(true); }}>发布</Button>
      <Button theme="borderless" size="small" icon={<FullScreen />} onClick={() => setPreview(!preview)}>{preview ? "退出预览" : "预览"}</Button>
    </div>
    <Modal title="发布项目" visible={sharing} footer={null} onCancel={() => setSharing(false)} width={440}>
      <p className="publish-description">当前项目使用浏览器本地存储。可导出项目文件，或导出发布包将成品部署到任意静态服务器。</p>
      {sharing && state.scene.some(node => kitMetadata(node)?.source.type === KIT_WEATHER_TYPE) &&
        <Checkbox checked={includeWeatherKeys} onChange={event => setIncludeWeatherKeys(!!event.target.checked)}>
          发布包包含天气 Key。页面访问者可读取该 Key。
        </Checkbox>}
      <div className="publish-actions"><Button onClick={exportScene}>导出项目</Button>
        <Button onClick={exportPublish}>导出发布包</Button>
        <Button theme="solid" onClick={openPublish}>打开发布页</Button></div>
    </Modal>
    <Modal title="场景数据" visible={dataVisible} onCancel={() => setDataVisible(false)} okText="应用场景" cancelText="取消" width={640} onOk={async()=>{try{const data=parseProjectFile(sourceDraft);const settings=await restoreBoardMedia(data.settings,data.boardMedia);getSceneBridge().post({type:"loadScene",tree:data.scene,settings});const activePage=settings.boardPages.find((page)=>page.id===settings.boardActivePageId)??settings.boardPages[0]!;setState({boardSize:data.boardSize??{width:activePage.width,height:activePage.height}});setDataVisible(false);Toast.success("已应用场景，可撤销")}catch(e){Toast.error(e instanceof Error?e.message:"场景格式无效")}}}>
      <TextArea value={sourceDraft} onChange={setSourceDraft} rows={18} aria-label="场景 JSON 数据" spellCheck={false}/>
    </Modal>
    <Modal title="测量对象距离" visible={measuring} onCancel={() => setMeasuring(false)} footer={null} width={440}>
      <div className="measure-form">{[pointA, pointB].map((value, index) => <label key={index}>{index ? "终点对象" : "起点对象"}
        <Select value={value || undefined} placeholder="选择对象" style={{ width: "100%" }} optionList={state.scene.filter((n) => n.type !== "group").map((n) => ({ value: n.id, label: n.name }))}
          onChange={(next) => (index ? setPointB : setPointA)(String(next))} /></label>)}
        <output>{distance === null ? "选择两个对象进行测量" : `${distance.toFixed(2)} 米`}</output></div>
    </Modal>
    <Modal title="项目素材检查" visible={audit !== null} footer={null} onCancel={() => setAudit(null)} width={440}>
      {audit?.length ? <ul className="audit-list">{audit.map((group) => <li key={group.group}>
        <strong>{group.group}（{group.items.length}）</strong>
        <p>{group.items.join("、")}</p></li>)}</ul>
        : <p className="properties-note">检查通过：未发现缺失资源或异常数据连接。</p>}
    </Modal>
    <Modal title="项目设置" visible={settingsVisible} footer={null} onCancel={() => setSettingsVisible(false)} width={420}>
      <SceneSettings />
    </Modal>
    <Modal title="重命名项目" visible={renaming} onCancel={()=>setRenaming(false)} okText="确定" cancelText="取消" width={360} onOk={()=>{if(!name.trim())return;saveProjects(loadProjects().map(p=>p.id===projectId?{...p,name:name.trim()}:p));window.dispatchEvent(new Event("dw:project-name"));setRenaming(false)}}><Input aria-label="项目名称" value={name} onChange={setName} maxLength={80}/></Modal>
    <Modal title="历史记录" visible={history} footer={null} onCancel={()=>setHistory(false)} width={380}><div className="history-actions"><Button disabled={!state.canUndo} onClick={()=>action("undo")}>撤销上一步</Button><Button disabled={!state.canRedo} onClick={()=>action("redo")}>重做下一步</Button></div><ol className="history-list">{(getSceneBridge().snapshot()?.undoLabels??[]).map((label,index)=><li key={index}>{index+1}. {label}<span>已应用</span></li>)}{[...(getSceneBridge().snapshot()?.redoLabels??[])].reverse().map((label,index)=><li className="undone" key={`redo-${index}`}>{label}<span>已撤销</span></li>)}</ol></Modal>
    <input hidden ref={glbRef} type="file" accept=".glb,model/gltf-binary" aria-label="导入 GLB 文件" onChange={async event=>{const file=event.target.files?.[0];if(!file)return;setImporting(true);try{if(file.size>20_000_000)throw new Error("请选择小于 20 MB 的 GLB");const node=importGlb(await file.arrayBuffer(),file.name);setEditing(true);getSceneBridge().post({type:"add",node});Toast.success("GLB 已导入，支持随项目导出")}catch(e){Toast.error(e instanceof Error?e.message:"模型导入失败")}finally{setImporting(false);event.target.value=""}}}/>
    <input hidden ref={fileRef} type="file" accept=".json,application/json" onChange={async (event) => {
      const file = event.target.files?.[0]; if (!file) return;
      try {
        const imported = parseProjectFile(await file.text());
        const settings = await restoreBoardMedia(imported.settings, imported.boardMedia);
        getSceneBridge().post({ type: "loadScene", tree: imported.scene, settings });
        const activePage = settings.boardPages.find((page) => page.id === settings.boardActivePageId) ?? settings.boardPages[0]!;
        setState({ boardSize: imported.boardSize ?? { width: activePage.width, height: activePage.height } });
        Toast.success("场景已导入，可撤销恢复");
      }
      catch (error) { Toast.error(error instanceof Error ? error.message : "文件无效"); }
      event.target.value = "";
    }} />
    {conditionsVisible && <DataConditionsEditor onClose={() => setConditionsVisible(false)}/>}
    <span hidden>{projectId}{editing}</span>
  </header>;
}
