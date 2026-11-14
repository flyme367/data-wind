import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { Slider } from "./ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { NumberInput } from "./ui-ext/number-input";
import { Toast } from "../lib/toast";
import { captureBoardCover } from "../engine/exportBoard";
import { BACKGROUND_BOARD_PAGE_ID, defaultEditorSettings, type BoardStateStyle, type EditorSettings } from "../data/editor";
import { saveBoardMedia } from "../state/boardMedia";
import { downloadFile, loadProjects, saveProjects } from "../state/projects";
import { setState, useStore } from "../state/store";
import { getSceneBridge } from "../workers/bridge";
import { ColorField, Field } from "./PropertyFields";
import { Down } from "@icon-park/react";
import { cn } from "cn";

/** Semi Collapse.Panel → Collapsible：右侧 extra 控件钉在 header 行最右（沿用 board-collapse-* 类名与点击拦截）。 */
function Panel({ itemKey, muted, header, children, defaultOpen = false }: {
  itemKey: string; muted?: boolean; header: React.ReactNode; children?: React.ReactNode; defaultOpen?: boolean;
}) {
  return <Collapsible defaultOpen={defaultOpen} data-panel={itemKey} className="board-properties-collapse">
    <CollapsibleTrigger className="flex min-h-[34px] w-full cursor-pointer items-center gap-1.5 px-3 py-2 text-left text-xs font-normal text-[#cecece] hover:text-foreground">
      <Down size={12} className="shrink-0 transition-transform data-[state=open]:rotate-0" />
      <span className={cn("board-collapse-header", muted && "is-muted")}>{header}</span>
    </CollapsibleTrigger>
    <CollapsibleContent><section className="property-section">{children}</section></CollapsibleContent>
  </Collapsible>;
}

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
  // Semi Upload → 隐藏 input[type=file] + 按钮触发（accept 与校验逻辑原样保留）
  const backgroundInput = useRef<HTMLInputElement>(null);
  const musicInput = useRef<HTMLInputElement>(null);
  const onPick = (kind: "background" | "music") => (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void saveUpload(file, kind).catch((exception: unknown) => {
      Toast.error(exception instanceof Error ? exception.message : "文件读取失败");
    });
  };

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

  return <>
    <Panel itemKey="basic" defaultOpen header={<span className="board-collapse-header"><span className="board-collapse-header-title">基本设置</span>
      <span className="board-collapse-extra" onClick={(event) => event.stopPropagation()}><SectionMenu name="基本设置" value={{ size: state.boardSize, boardFit: pageSettings.boardFit,
        boardFillColor: pageSettings.boardFillColor, boardLayout: settings.boardLayout, boardOutline: settings.boardOutline }} onReset={resetBasic}
        boardOutline={settings.boardOutline} onToggleOutline={() => update({ boardOutline: !settings.boardOutline })}/></span></span>}>
      <Field label="子看板尺寸"><div className="board-size-inputs">{(["width", "height"] as const).map((axis) => <NumberInput key={axis} size="small" min={100} max={8192} value={state.boardSize[axis]} suffix="px" aria-label={axis === "width" ? "看板宽度" : "看板高度"} onChange={(value) => typeof value === "number" && value >= 100 && value <= 8192 && setState({ boardSize: { ...state.boardSize, [axis]: value } })}/>)}</div></Field>
      <Field label="全屏显示模式"><SelectMode value={pageSettings.boardFit} onChange={(boardFit) => update({ boardFit: boardFit as EditorSettings["boardFit"] })}/></Field>
      <ColorField label="填充颜色" value={pageSettings.boardFillColor} onChange={(boardFillColor) => update({ boardFillColor })}/>
      <Field label="内部组件布局"><ToggleGroup type="single" className="board-segment-radio" value={settings.boardLayout} aria-label="内部组件布局"
        onValueChange={(mode) => {
          if (!mode) return;
          update({ boardLayout: mode as EditorSettings["boardLayout"] });
          if (mode === "flow") { getSceneBridge().post({ type: "flowLayout", board: state.boardSize,
            boardPageId: isBackgroundBoard ? BACKGROUND_BOARD_PAGE_ID : settings.boardActivePageId }); Toast.success("已按行列流式整理当前看板组件，可撤销"); }
        }}>
        <ToggleGroupItem className="h-7 text-xs" value="static">静态布局</ToggleGroupItem>
        <ToggleGroupItem className="h-7 text-xs" value="flow">流式布局</ToggleGroupItem>
      </ToggleGroup></Field>
    </Panel>

    {!isBackgroundBoard && <Panel itemKey="carousel" muted={!settings.boardCarouselEnabled || settings.boardPages.length < 2}
      header={<span className="board-collapse-header"><span className="board-collapse-header-title">子看板轮播</span>
        <span className="board-collapse-extra" onClick={(event) => event.stopPropagation()}><span className="collapse-extra-switch"><Switch aria-label="启用子看板轮播" disabled={settings.boardPages.length < 2} checked={settings.boardCarouselEnabled && settings.boardPages.length > 1} onCheckedChange={(boardCarouselEnabled) => update({ boardCarouselEnabled: boardCarouselEnabled === true })}/></span><SectionMenu name="子看板轮播" value={{ enabled: settings.boardCarouselEnabled,
          animation: settings.boardCarouselAnimation, duration: settings.boardCarouselDuration, pageDuration: settings.boardPageDuration }} onReset={resetCarousel}/></span></span>}>
      <Field label="轮播动画"><SelectMode disabled={!settings.boardCarouselEnabled || settings.boardPages.length < 2} value={settings.boardCarouselAnimation} options={[{ value: "none", label: "无动画" }, { value: "fade", label: "淡入淡出" }, { value: "slideX", label: "水平平移" }, { value: "slideY", label: "垂直平移" }]} onChange={(boardCarouselAnimation) => update({ boardCarouselAnimation: boardCarouselAnimation as EditorSettings["boardCarouselAnimation"] })}/></Field>
      <Field label="动画持续时间"><NumberInput disabled={!settings.boardCarouselEnabled || settings.boardPages.length < 2} size="small" min={0.1} max={60} step={0.1} precision={1} suffix="秒" aria-label="动画持续时间" value={settings.boardCarouselDuration} onChange={(boardCarouselDuration) => typeof boardCarouselDuration === "number" && update({ boardCarouselDuration })}/></Field>
      <Field label="页面停留时间"><NumberInput disabled={!settings.boardCarouselEnabled || settings.boardPages.length < 2} size="small" min={0.1} max={3600} step={0.5} precision={1} suffix="秒" aria-label="页面停留时间" value={settings.boardPageDuration} onChange={(boardPageDuration) => typeof boardPageDuration === "number" && update({ boardPageDuration })}/></Field>
      <p className="properties-note">按页面停留时间自动切换子看板；当前共 {settings.boardPages.length} 页。{settings.boardPages.length < 2 ? "先用画布底部 + 添加页面后即可开启轮播。" : ""}</p>
    </Panel>}

    <Panel itemKey="background" defaultOpen muted={!pageSettings.boardBackgroundEnabled}
      header={<span className="board-collapse-header"><span className="board-collapse-header-title">背景设置</span>
        <span className="board-collapse-extra" onClick={(event) => event.stopPropagation()}><span className="collapse-extra-switch"><Switch aria-label="启用背景设置" checked={pageSettings.boardBackgroundEnabled} onCheckedChange={(boardBackgroundEnabled) => update({ boardBackgroundEnabled: boardBackgroundEnabled === true })}/></span><SectionMenu name="背景设置" value={{ color: pageSettings.boardColor, enabled: pageSettings.boardBackgroundEnabled,
          media: pageSettings.boardBackgroundMediaName, fill: pageSettings.boardBackgroundFill, blur: pageSettings.boardBackgroundBlur,
          music: pageSettings.boardMusicName, musicEnabled: pageSettings.boardMusicEnabled, volume: pageSettings.boardMusicVolume }} onReset={resetBackground}/></span></span>}>
      <ColorField label="背景颜色" value={pageSettings.boardColor} onChange={(boardColor) => update({ boardColor })}/>
      <Field label="背景图/视频"><div className="board-media-field">
        <input hidden ref={backgroundInput} type="file" accept="image/*,video/*" aria-label="选择背景图或视频" onChange={onPick("background")} />
        <Button size="sm" onClick={() => backgroundInput.current?.click()}>{pageSettings.boardBackgroundMediaName || "点击选择文件"}</Button>
        {pageSettings.boardBackgroundMediaId && <Button size="sm" variant="ghost" aria-label="清除背景图或视频" onClick={() => update({ boardBackgroundMediaId: "", boardBackgroundMediaName: "" })}>清除</Button>}
      </div></Field>
      <Field label="填充方式"><ToggleGroup type="single" className="board-fill-radio board-segment-radio" value={pageSettings.boardBackgroundFill} aria-label="背景填充方式"
        onValueChange={(fill) => { if (typeof fill === "string" && fill) update({ boardBackgroundFill: fill as EditorSettings["boardBackgroundFill"] }); }}>
        <ToggleGroupItem className="h-7 text-xs" value="stretch">拉伸</ToggleGroupItem>
        <ToggleGroupItem className="h-7 text-xs" value="tile">平铺</ToggleGroupItem>
        <ToggleGroupItem className="h-7 text-xs" value="none">不填充</ToggleGroupItem>
      </ToggleGroup></Field>
      <Field label="背景模糊"><NumberInput size="small" min={0} max={80} suffix="px" aria-label="背景模糊" value={pageSettings.boardBackgroundBlur} onChange={(boardBackgroundBlur) => typeof boardBackgroundBlur === "number" && update({ boardBackgroundBlur })}/></Field>
      <div className="board-music-block">
        <div className="board-music-title"><strong>背景音乐</strong><Switch aria-label="启用背景音乐" checked={pageSettings.boardMusicEnabled} onCheckedChange={(boardMusicEnabled) => update({ boardMusicEnabled: boardMusicEnabled === true })}/></div>
        <Field label="音频文件"><div className="board-media-field">
          <input hidden ref={musicInput} type="file" accept="audio/*" aria-label="选择背景音乐" onChange={onPick("music")} />
          <Button size="sm" onClick={() => musicInput.current?.click()}>{pageSettings.boardMusicId.startsWith("http") ? "选择本地文件" : pageSettings.boardMusicName || "点击选择文件"}</Button>
          {pageSettings.boardMusicId && <Button size="sm" variant="ghost" aria-label="清除背景音乐" onClick={() => update({ boardMusicId: "", boardMusicName: "", boardMusicEnabled: false })}>清除</Button>}
        </div></Field>
        <Field label="网络地址"><div className="board-media-field"><Input className="h-7 text-xs" aria-label="背景音乐网络地址" value={musicUrlDraft} placeholder="https://example.com/music.mp3" onChange={(event) => setMusicUrlDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyMusicUrl(); }}/><Button size="sm" onClick={applyMusicUrl}>应用</Button></div></Field>
        <Field label="音量"><Slider aria-label="背景音乐音量" min={0} max={100} value={[pageSettings.boardMusicVolume]} onValueChange={(value) => update({ boardMusicVolume: Number(Array.isArray(value) ? value[0] : value) })}/></Field>
        {pageSettings.boardMusicId && <Button size="sm" onClick={() => window.dispatchEvent(new Event("dw:toggle-board-music"))}>试听 / 暂停</Button>}
        <p className="properties-note">背景音乐在预览时循环播放；浏览器可能要求先点击试听。</p>
      </div>
    </Panel>

    <Panel itemKey="cover" header={<span className="board-collapse-header"><span className="board-collapse-header-title">封面设置</span>
      <span className="board-collapse-extra" onClick={(event) => event.stopPropagation()}><SectionMenu name="封面设置" value={{ cover: Boolean(cover) }} onReset={resetCover}/></span></span>}>
      {cover ? <img className="board-cover" src={cover} alt="子看板封面"/> : <p className="properties-note">暂无封面，点击「截屏」生成当前子看板封面。</p>}
      <Button className="w-full" size="sm" onClick={() => void captureCover()}>截屏</Button>
    </Panel>
  </>;
}

function SectionMenu({ name, value, onReset, boardOutline, onToggleOutline }: {
  name: string; value: unknown; onReset: () => void; boardOutline?: boolean; onToggleOutline?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return <span className="board-section-menu" onClick={(event) => event.stopPropagation()}>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`${name}更多操作`}>⋮</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => downloadFile(`${name}设置.json`, JSON.stringify(value, null, 2))}>导出本组设置 JSON</DropdownMenuItem>
        {onToggleOutline && <DropdownMenuItem onClick={onToggleOutline}>{boardOutline ? "隐藏子看板轮廓" : "显示子看板轮廓"}</DropdownMenuItem>}
        <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>恢复默认值</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <AlertDialog open={confirming} onOpenChange={setConfirming}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>恢复{name}默认值</AlertDialogTitle></AlertDialogHeader>
        <p className="text-sm text-muted-foreground">将恢复「{name}」的默认设置。</p>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={() => { onReset(); setConfirming(false); }}>恢复</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
  return <Select disabled={disabled} aria-label={options ? "轮播动画" : "全屏显示模式"} value={value} onValueChange={(next) => { if (typeof next === "string") onChange(next); }}>
    <SelectTrigger aria-label={options ? "轮播动画" : "全屏显示模式"} size="sm" className="w-full"><SelectValue/></SelectTrigger>
    <SelectContent>{items.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </Select>;
}
