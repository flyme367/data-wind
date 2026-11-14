import { Button, Collapse, Dropdown, Input, InputNumber, Modal, RadioGroup, Select, Slider, Switch, Toast, Upload } from "@douyinfe/semi-ui";
import { useEffect, useState } from "react";
import { captureBoardCover } from "../engine/exportBoard";
import { BACKGROUND_BOARD_PAGE_ID, defaultEditorSettings, type BoardStateStyle, type EditorSettings } from "../data/editor";
import { saveBoardMedia } from "../state/boardMedia";
import { downloadFile, loadProjects, saveProjects } from "../state/projects";
import { setState, useStore } from "../state/store";
import { getSceneBridge } from "../workers/bridge";
import { ColorField, Field } from "./PropertyFields";

export default function BoardProperties() {
  const state = useStore();
  const settings = state.settings;
  const isBackgroundBoard = state.boardLayer === "background";
  const page = isBackgroundBoard ? settings.boardBackgroundPage
    : settings.boardPages.find((item) => item.id === settings.boardActivePageId) ?? settings.boardPages[0];
  // 活跃状态已经合并进 settings；再次套用 page.style 会遮住状态中的值。
  // 背景看板使用独立样式，普通子看板则直接读取当前页面/状态的生效样式。
  const pageSettings = isBackgroundBoard && page ? { ...settings, ...page.style } : settings;
  const [coverTick, setCoverTick] = useState(0);
  const [musicUrlDraft, setMusicUrlDraft] = useState("");
  const projectThumbnail = state.projectId ? loadProjects().find((project) => project.id === state.projectId)?.thumbnail ?? null : null;
  const cover = page?.cover ?? (!isBackgroundBoard && page?.id === settings.boardPages[0]?.id ? projectThumbnail : null);
  void coverTick;
  useEffect(() => setMusicUrlDraft(/^https?:\/\//i.test(pageSettings.boardMusicId) ? pageSettings.boardMusicId : ""), [pageSettings.boardMusicId]);
  const update = (patch: Partial<EditorSettings>) => {
    const styleKeys = ["boardColor", "boardFillColor", "boardFit", "boardBackgroundEnabled", "boardBackgroundMediaId", "boardBackgroundMediaName",
      "boardBackgroundFill", "boardBackgroundBlur", "boardMusicEnabled", "boardMusicId", "boardMusicName", "boardMusicVolume"] as const;
    const stylePatch = Object.fromEntries(styleKeys.flatMap((key) => key in patch ? [[key, patch[key]]] : [])) as BoardStateStyle;
    if (!Object.keys(stylePatch).length) { getSceneBridge().post({ type: "configure", patch }); return; }
    if (isBackgroundBoard) {
      const nonStylePatch = Object.fromEntries(Object.entries(patch).filter(([key]) => !styleKeys.includes(key as typeof styleKeys[number]))) as Partial<EditorSettings>;
      getSceneBridge().post({ type: "configure", patch: { ...nonStylePatch, boardBackgroundPage: {
        ...settings.boardBackgroundPage,
        style: { ...settings.boardBackgroundPage.style, ...stylePatch },
      } } });
      return;
    }
    const activeId = settings.boardActiveStateId;
    const activePageId = settings.boardActivePageId;
    const pagePatch = !activeId && activePageId ? { boardPages: settings.boardPages.map((page) =>
      page.id === activePageId ? { ...page, style: { ...page.style, ...stylePatch } } : page) } : {};
    if (activeId) {
      getSceneBridge().post({ type: "configure", patch: { ...patch,
        boardStates: settings.boardStates.map((item) => item.id === activeId ? { ...item, style: { ...item.style, ...stylePatch } } : item) } });
    } else {
      getSceneBridge().post({ type: "configure", patch: { ...patch, ...pagePatch,
        boardDefaultState: { ...settings.boardDefaultState, ...stylePatch } } });
    }
  };

  const saveUpload = async (file: File, kind: "background" | "music") => {
    if (file.size > 100_000_000) throw new Error("文件不能超过 100 MB");
    const type = file.type.toLowerCase();
    if (kind === "background" && !type.startsWith("image/") && !type.startsWith("video/")) throw new Error("请选择图片或视频文件");
    if (kind === "music" && !type.startsWith("audio/")) throw new Error("请选择音频文件");
    const record = await saveBoardMedia(file);
    if (kind === "background") update({ boardBackgroundMediaId: record.id, boardBackgroundMediaName: record.name, boardBackgroundEnabled: true });
    else update({ boardMusicId: record.id, boardMusicName: record.name, boardMusicEnabled: true });
    // A prior ID may still be used by another named state or board page.
    Toast.success(kind === "background" ? "背景媒体已添加" : "背景音乐已添加");
  };
  const upload = (kind: "background" | "music") => ({
    action: "",
    accept: kind === "background" ? "image/*,video/*" : "audio/*",
    uploadTrigger: "custom" as const,
    showUploadList: false,
    customRequest: ({ fileInstance, onSuccess, onError }: { fileInstance: File; onSuccess: (value: unknown) => void; onError: (xhr: { status?: number }, error?: Event) => void }) => {
      void saveUpload(fileInstance, kind).then(() => onSuccess({})).catch((exception: unknown) => {
        Toast.error(exception instanceof Error ? exception.message : "文件读取失败");
        onError({ status: 400 }, new Event("error"));
      });
    },
  });

  const captureCover = async () => {
    try {
      const thumbnail = await captureBoardCover();
      if (!state.projectId) return;
      if (isBackgroundBoard) {
        getSceneBridge().post({ type: "configure", patch: { boardBackgroundPage: { ...settings.boardBackgroundPage, cover: thumbnail } } });
      } else {
        const boardPages = settings.boardPages.map((item) => item.id === settings.boardActivePageId ? { ...item, cover: thumbnail } : item);
        getSceneBridge().post({ type: "configure", patch: { boardPages } });
      }
      if (!isBackgroundBoard && settings.boardPages[0]?.id === settings.boardActivePageId)
        saveProjects(loadProjects().map((project) => project.id === state.projectId ? { ...project, thumbnail } : project));
      setCoverTick((tick) => tick + 1);
      Toast.success("封面已更新，工作台卡片同步显示");
    } catch (exception) { Toast.error(exception instanceof Error ? exception.message : "截屏失败"); }
  };
  const applyMusicUrl = () => {
    try {
      const url = new URL(musicUrlDraft.trim());
      if (!(["http:", "https:"].includes(url.protocol))) throw new Error("仅支持 HTTP 或 HTTPS 音频地址");
      update({ boardMusicId: url.href, boardMusicName: "网络音频", boardMusicEnabled: true });
      Toast.success("网络背景音乐已连接");
    } catch (error) { Toast.error(error instanceof Error ? error.message : "音频地址无效"); }
  };

  const resetBasic = () => {
    setState({ boardSize: { width: 1920, height: 1080 } });
    update({ boardFit: "contain", boardFillColor: "#000000", boardLayout: "static", boardOutline: false });
  };
  const resetCarousel = () => update({ boardCarouselEnabled: false, boardCarouselAnimation: "none", boardCarouselDuration: 1, boardPageDuration: 3 });
  const resetBackground = () => {
    const defaults = isBackgroundBoard ? defaultEditorSettings.boardBackgroundPage.style : defaultEditorSettings.boardDefaultState;
    update({ boardColor: defaults.boardColor, boardBackgroundEnabled: defaults.boardBackgroundEnabled,
      boardBackgroundMediaId: defaults.boardBackgroundMediaId, boardBackgroundMediaName: defaults.boardBackgroundMediaName,
      boardBackgroundFill: defaults.boardBackgroundFill, boardBackgroundBlur: defaults.boardBackgroundBlur,
      boardMusicEnabled: defaults.boardMusicEnabled, boardMusicId: defaults.boardMusicId,
      boardMusicName: defaults.boardMusicName, boardMusicVolume: defaults.boardMusicVolume });
  };
  const resetCover = () => {
    if (isBackgroundBoard) {
      const boardBackgroundPage = { ...settings.boardBackgroundPage };
      delete boardBackgroundPage.cover;
      getSceneBridge().post({ type: "configure", patch: { boardBackgroundPage } });
    } else {
      const boardPages = settings.boardPages.map((item) => item.id === settings.boardActivePageId ? { ...item, cover: undefined } : item);
      getSceneBridge().post({ type: "configure", patch: { boardPages } });
    }
    if (!isBackgroundBoard && settings.boardPages[0]?.id === settings.boardActivePageId)
      saveProjects(loadProjects().map((project) => project.id === state.projectId ? { ...project, thumbnail: undefined } : project));
  };

  return <Collapse expandIconPosition="left" className="properties-collapse board-properties-collapse" defaultActiveKey={["basic", "background"]}>
    {/* Semi Collapse 只在 header 为纯字符串时渲染 extra（JSX header 会被丢弃），右侧控件统一放进 header 内部 margin-left:auto 钉在最右 */}
    <Collapse.Panel itemKey="basic" header={<span className="board-collapse-header"><span className="board-collapse-header-title">基本设置</span>
      <span className="board-collapse-extra" onClick={(event) => event.stopPropagation()}><SectionMenu name="基本设置" value={{ size: state.boardSize, boardFit: pageSettings.boardFit,
        boardFillColor: pageSettings.boardFillColor, boardLayout: settings.boardLayout, boardOutline: settings.boardOutline }} onReset={resetBasic}
        boardOutline={settings.boardOutline} onToggleOutline={() => update({ boardOutline: !settings.boardOutline })}/></span></span>}><section className="property-section">
      <Field label="子看板尺寸"><div className="board-size-inputs">{(["width", "height"] as const).map((axis) => <InputNumber key={axis} size="small" hideButtons min={100} max={8192} value={state.boardSize[axis]} suffix="px" aria-label={axis === "width" ? "看板宽度" : "看板高度"} onChange={(value) => typeof value === "number" && value >= 100 && value <= 8192 && setState({ boardSize: { ...state.boardSize, [axis]: value } })}/>)}</div></Field>
      <Field label="全屏显示模式"><SelectMode value={pageSettings.boardFit} onChange={(boardFit) => update({ boardFit: boardFit as EditorSettings["boardFit"] })}/></Field>
      <ColorField label="填充颜色" value={pageSettings.boardFillColor} onChange={(boardFillColor) => update({ boardFillColor })}/>
      <Field label="内部组件布局"><RadioGroup type="button" buttonSize="small" className="board-segment-radio" value={settings.boardLayout} aria-label="内部组件布局"
        options={[{ value: "static", label: "静态布局" }, { value: "flow", label: "流式布局" }]}
        onChange={(event) => {
          const mode = String(event.target.value) as EditorSettings["boardLayout"];
          update({ boardLayout: mode });
          if (mode === "flow") { getSceneBridge().post({ type: "flowLayout", board: state.boardSize,
            boardPageId: isBackgroundBoard ? BACKGROUND_BOARD_PAGE_ID : settings.boardActivePageId }); Toast.success("已按行列流式整理当前看板组件，可撤销"); }
        }}/></Field>
    </section></Collapse.Panel>

    {!isBackgroundBoard && <Collapse.Panel itemKey="carousel"
      header={<span className={"board-collapse-header" + (!settings.boardCarouselEnabled || settings.boardPages.length < 2 ? " is-muted" : "")}><span className="board-collapse-header-title">子看板轮播</span>
        <span className="board-collapse-extra" onClick={(event) => event.stopPropagation()}><span className="collapse-extra-switch"><Switch size="small" aria-label="启用子看板轮播" disabled={settings.boardPages.length < 2} checked={settings.boardCarouselEnabled && settings.boardPages.length > 1} onChange={(boardCarouselEnabled) => update({ boardCarouselEnabled })}/></span><SectionMenu name="子看板轮播" value={{ enabled: settings.boardCarouselEnabled,
          animation: settings.boardCarouselAnimation, duration: settings.boardCarouselDuration, pageDuration: settings.boardPageDuration }} onReset={resetCarousel}/></span></span>}>
      <section className="property-section">
        <Field label="轮播动画"><SelectMode disabled={!settings.boardCarouselEnabled || settings.boardPages.length < 2} value={settings.boardCarouselAnimation} options={[{ value: "none", label: "无动画" }, { value: "fade", label: "淡入淡出" }, { value: "slideX", label: "水平平移" }, { value: "slideY", label: "垂直平移" }]} onChange={(boardCarouselAnimation) => update({ boardCarouselAnimation: boardCarouselAnimation as EditorSettings["boardCarouselAnimation"] })}/></Field>
        <Field label="动画持续时间"><InputNumber disabled={!settings.boardCarouselEnabled || settings.boardPages.length < 2} size="small" min={0.1} max={60} step={0.1} precision={1} suffix="秒" aria-label="动画持续时间" value={settings.boardCarouselDuration} onChange={(boardCarouselDuration) => typeof boardCarouselDuration === "number" && update({ boardCarouselDuration })}/></Field>
        <Field label="页面停留时间"><InputNumber disabled={!settings.boardCarouselEnabled || settings.boardPages.length < 2} size="small" min={0.1} max={3600} step={0.5} precision={1} suffix="秒" aria-label="页面停留时间" value={settings.boardPageDuration} onChange={(boardPageDuration) => typeof boardPageDuration === "number" && update({ boardPageDuration })}/></Field>
        <p className="properties-note">按页面停留时间自动切换子看板；当前共 {settings.boardPages.length} 页。{settings.boardPages.length < 2 ? "先用画布底部 + 添加页面后即可开启轮播。" : ""}</p>
      </section>
    </Collapse.Panel>}

    <Collapse.Panel itemKey="background"
      header={<span className={"board-collapse-header" + (!pageSettings.boardBackgroundEnabled ? " is-muted" : "")}><span className="board-collapse-header-title">背景设置</span>
        <span className="board-collapse-extra" onClick={(event) => event.stopPropagation()}><span className="collapse-extra-switch"><Switch size="small" aria-label="启用背景设置" checked={pageSettings.boardBackgroundEnabled} onChange={(boardBackgroundEnabled) => update({ boardBackgroundEnabled })}/></span><SectionMenu name="背景设置" value={{ color: pageSettings.boardColor, enabled: pageSettings.boardBackgroundEnabled,
          media: pageSettings.boardBackgroundMediaName, fill: pageSettings.boardBackgroundFill, blur: pageSettings.boardBackgroundBlur,
          music: pageSettings.boardMusicName, musicEnabled: pageSettings.boardMusicEnabled, volume: pageSettings.boardMusicVolume }} onReset={resetBackground}/></span></span>}>
      <section className="property-section">
        <ColorField label="背景颜色" value={pageSettings.boardColor} onChange={(boardColor) => update({ boardColor })}/>
        <Field label="背景图/视频"><div className="board-media-field">
          <Upload {...upload("background")}><Button size="small">{pageSettings.boardBackgroundMediaName || "点击选择文件"}</Button></Upload>
          {pageSettings.boardBackgroundMediaId && <Button size="small" theme="borderless" aria-label="清除背景图或视频" onClick={() => update({ boardBackgroundMediaId: "", boardBackgroundMediaName: "" })}>清除</Button>}
        </div></Field>
        <Field label="填充方式"><RadioGroup type="button" buttonSize="small" className="board-fill-radio board-segment-radio" value={pageSettings.boardBackgroundFill} aria-label="背景填充方式"
          options={[{ value: "stretch", label: "拉伸" }, { value: "tile", label: "平铺" }, { value: "none", label: "不填充" }]}
          onChange={(event) => update({ boardBackgroundFill: String(event.target.value) as EditorSettings["boardBackgroundFill"] })}/></Field>
        <Field label="背景模糊"><InputNumber size="small" min={0} max={80} suffix="px" aria-label="背景模糊" value={pageSettings.boardBackgroundBlur} onChange={(boardBackgroundBlur) => typeof boardBackgroundBlur === "number" && update({ boardBackgroundBlur })}/></Field>
        <div className="board-music-block">
          <div className="board-music-title"><strong>背景音乐</strong><Switch size="small" aria-label="启用背景音乐" checked={pageSettings.boardMusicEnabled} onChange={(boardMusicEnabled) => update({ boardMusicEnabled })}/></div>
          <Field label="音频文件"><div className="board-media-field">
            <Upload {...upload("music")}><Button size="small">{pageSettings.boardMusicId.startsWith("http") ? "选择本地文件" : pageSettings.boardMusicName || "点击选择文件"}</Button></Upload>
            {pageSettings.boardMusicId && <Button size="small" theme="borderless" aria-label="清除背景音乐" onClick={() => update({ boardMusicId: "", boardMusicName: "", boardMusicEnabled: false })}>清除</Button>}
          </div></Field>
          <Field label="网络地址"><div className="board-media-field"><Input size="small" aria-label="背景音乐网络地址" value={musicUrlDraft} placeholder="https://example.com/music.mp3" onChange={setMusicUrlDraft} onEnterPress={applyMusicUrl}/><Button size="small" onClick={applyMusicUrl}>应用</Button></div></Field>
          <Field label="音量"><Slider aria-label="背景音乐音量" min={0} max={100} value={pageSettings.boardMusicVolume} onChange={(value) => update({ boardMusicVolume: Array.isArray(value) ? Number(value[0]) : Number(value) })}/></Field>
          {pageSettings.boardMusicId && <Button size="small" onClick={() => window.dispatchEvent(new Event("dw:toggle-board-music"))}>试听 / 暂停</Button>}
          <p className="properties-note">背景音乐在预览时循环播放；浏览器可能要求先点击试听。</p>
        </div>
      </section>
    </Collapse.Panel>

    <Collapse.Panel itemKey="cover" header={<span className="board-collapse-header"><span className="board-collapse-header-title">封面设置</span>
      <span className="board-collapse-extra" onClick={(event) => event.stopPropagation()}><SectionMenu name="封面设置" value={{ cover: Boolean(cover) }} onReset={resetCover}/></span></span>}><section className="property-section">
      {cover ? <img className="board-cover" src={cover} alt="子看板封面"/> : <p className="properties-note">暂无封面，点击「截屏」生成当前子看板封面。</p>}
      <Button block size="small" onClick={() => void captureCover()}>截屏</Button>
    </section></Collapse.Panel>
  </Collapse>;
}

function SectionMenu({ name, value, onReset, boardOutline, onToggleOutline }: {
  name: string; value: unknown; onReset: () => void; boardOutline?: boolean; onToggleOutline?: () => void;
}) {
  return <span className="board-section-menu" onClick={(event) => event.stopPropagation()}>
    <Dropdown trigger="click" position="bottomRight" render={<Dropdown.Menu>
      <Dropdown.Item onClick={() => downloadFile(`${name}设置.json`, JSON.stringify(value, null, 2))}>导出本组设置 JSON</Dropdown.Item>
      {onToggleOutline && <Dropdown.Item onClick={onToggleOutline}>{boardOutline ? "隐藏子看板轮廓" : "显示子看板轮廓"}</Dropdown.Item>}
      <Dropdown.Item type="danger" onClick={() => Modal.confirm({ title: `恢复${name}默认值`, content: `将恢复「${name}」的默认设置。`,
        okText: "恢复", cancelText: "取消", onOk: onReset })}>恢复默认值</Dropdown.Item>
    </Dropdown.Menu>}><Button size="small" theme="borderless" aria-label={`${name}更多操作`}>⋮</Button></Dropdown>
  </span>;
}

function SelectMode({ value, options, disabled, onChange }: {
  value: string;
  options?: { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const items = options ?? [
    { value: "contain", label: "等比缩放（长边填充，短边留空）" },
    { value: "cover", label: "等比缩放（短边填充，长边滚动）" },
    { value: "responsive", label: "响应式自适应" },
    { value: "original", label: "原始尺寸" },
    { value: "stretch", label: "拉伸填充" },
  ];
  return <Select disabled={disabled} size="small" aria-label={options ? "轮播动画" : "全屏显示模式"} value={value} optionList={items} onChange={(next) => onChange(String(next))}/>;
}
