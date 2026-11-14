import { useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Toast } from "@/lib/toast";
import { Plus, Search, Delete, More, Export, Folder, Computer, AllApplication, Box, Download,
  Right, Play, Send, Refresh, LinkOut, Edit } from "@icon-park/react";
import BrandLogo from "../components/BrandLogo";
import CreateProjectModal from "../components/CreateProjectModal";
import ModelAssetLibrary from "../components/ModelAssetLibrary";
import { exportPublishBundle } from "../publish/exportBundle";
import { templates } from "../data/catalog";
import { createTemplateScene, templateSettings } from "../data/sceneTemplates";
import { defaultEditorSettings } from "../data/editor";
import { exportBoardMedia, restoreBoardMedia } from "../state/boardMedia";
import { readEditorSettings,persistEditorSettings,readBoardSize,persistBoardSize,createProject, downloadFile, loadProjects, parseProjectFile, persistParams, persistScene, readProjectParams, readScene,
  saveProjects, type ProjectMeta } from "../state/projects";

export { loadProjects, saveProjects } from "../state/projects";
export type { ProjectMeta } from "../state/projects";

type Section = "projects" | "trash" | "assets" | "models";

/** 发布成品入口（viewer.html，独立构建产物，不含编辑器与 UI 框架） */
const viewerUrl = (id: string) => `viewer.html?projectId=${encodeURIComponent(id)}`;
const openViewer = (id: string) => window.open(viewerUrl(id), "_blank");

const sortOptions = [
  { value: "newest", label: "时间倒序" }, { value: "oldest", label: "时间正序" },
  { value: "opened", label: "最近打开" }, { value: "name", label: "名称排序" }];

/** 带 prefix 图标与 showClear 清除按钮的搜索框（Semi Input prefix/showClear → 相对定位包裹） */
function SearchInput({ icon, clearLabel, value, onValueChange, className, ...rest }: {
  icon: ReactNode; clearLabel: string; value: string; onValueChange: (value: string) => void;
} & Omit<ComponentProps<"input">, "value" | "onChange">) {
  return <InputGroup className={className}>
    <InputGroupAddon align="inline-start">{icon}</InputGroupAddon>
    <InputGroupInput {...rest} value={value} onChange={(event) => onValueChange(event.target.value)} />
    {value && <InputGroupAddon align="inline-end">
      <InputGroupButton variant="ghost" size="icon-xs" aria-label={clearLabel} onClick={() => onValueChange("")}>×</InputGroupButton>
    </InputGroupAddon>}
  </InputGroup>;
}

function initialProjects() {
  let projects = loadProjects();
  const initialized = localStorage.getItem("dw_initialized");
  if (!projects.length && initialized !== "2") {
    for (const id of ["car", "pipes", "campus", "smart-park"]) seedProject(id);
  } else if (initialized !== "2") {
    // 老用户升级:补建智慧园区示例(仅一次,删除后不再复活)
    seedProject("smart-park");
  }
  localStorage.setItem("dw_initialized", "2");
  return loadProjects();
}

/** 内置示例项目:按模板生成场景/环境设置并挂缩略图。 */
function seedProject(id: string) {
  const template = templates.find((item) => item.id === id)!;
  const project = createProject(`我的${template.name}`, "campus");
  persistScene(project.id, createTemplateScene(id));
  persistEditorSettings(project.id, { ...structuredClone(defaultEditorSettings), ...templateSettings(id) });
  const projects = loadProjects();
  const meta = projects.find((p) => p.id === project.id);
  if (meta) { meta.thumbnail = template.image; saveProjects(projects); }
}

export default function HomePage() {
  const [projects, setProjects] = useState(initialProjects);
  const [section, setSection] = useState<Section>("projects");
  const [query, setQuery] = useState("");
  const [templateQuery, setTemplateQuery] = useState("");
  const [sort, setSort] = useState("newest");
  const [creating, setCreating] = useState(false);
  const [templateId, setTemplateId] = useState("empty");
  const [folder, setFolder] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>(() => {
    try { const value = JSON.parse(localStorage.getItem("dw_folders") ?? "[]");
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    } catch { return []; }
  });
  const [dialog, setDialog] = useState<{ type: "rename" | "folder" | "move"; project?: ProjectMeta } | null>(null);
  const [draft, setDraft] = useState("");
  const [publishing, setPublishing] = useState<ProjectMeta | null>(null);
  const [workspaceInfo, setWorkspaceInfo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => setProjects(loadProjects());
  const update = (id: string, patch: Partial<ProjectMeta>) => {
    saveProjects(loadProjects().map((p) => p.id === id ? { ...p, ...patch } : p));
    refresh();
  };
  const openProject = (id: string, preview = false) => {
    update(id, { openedAt: Date.now() });
    window.location.hash = `#/project/layer?projectId=${encodeURIComponent(id)}${preview ? "&preview=1" : ""}`;
  };
  const newProject = (name: string, id: string) => {
    try {
      const template = templates.find((t) => t.id === id)!;
      const project = createProject(name, id === "empty" ? "empty" : "campus");
      persistScene(project.id, createTemplateScene(id));
      persistEditorSettings(project.id, { ...structuredClone(defaultEditorSettings), ...templateSettings(id) });
      update(project.id, { thumbnail: template.image, folder: folder ?? undefined });
      setCreating(false);
      openProject(project.id);
    } catch { Toast.error("创建失败，请检查浏览器存储空间"); }
  };
  const exportProject = async (project: ProjectMeta) => {
    try {
      const settings = readEditorSettings(project.id);
      const boardMedia = await exportBoardMedia(settings);
      downloadFile(`${project.name}.json`, JSON.stringify({ format: "data-wind", version: 2,
        name: project.name, scene: readScene(project.id) ?? [], settings, params: readProjectParams(project.id),
        boardSize: readBoardSize(project.id), boardMedia }, null, 2));
    } catch (error) { Toast.error(error instanceof Error ? error.message : "导出失败"); }
  };
  const exportPublish = async (project: ProjectMeta) => {
    try { await exportPublishBundle(project.id, project.name); }
    catch (error) { Toast.error(error instanceof Error ? error.message : "发布包导出失败"); }
  };
  const submitDialog = () => {
    if (!draft.trim() && dialog?.type !== "move") return;
    if (dialog?.type === "folder") {
      if (folders.includes(draft.trim())) { Toast.warning("文件夹已存在"); return; }
      const next = [...folders, draft.trim()]; localStorage.setItem("dw_folders", JSON.stringify(next)); setFolders(next);
    } else if (dialog?.project) update(dialog.project.id, dialog.type === "move" ? { folder: draft || undefined } : { name: draft.trim() });
    setDialog(null);
  };
  const filtered = useMemo(() => projects.filter((p) =>
    (section === "trash" ? Boolean(p.trashedAt) : !p.trashedAt) &&
    (!folder || p.folder === folder) && p.name.toLowerCase().includes(query.trim().toLowerCase()),
  ).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "zh-CN") :
    sort === "oldest" ? a.createdAt - b.createdAt : sort === "opened" ? b.openedAt - a.openedAt :
      b.createdAt - a.createdAt), [projects, section, folder, query, sort]);

  return <div className="workbench">
    <aside className="workbench-sidebar">
      <a className="workbench-brand" href="#/" aria-label="xx可视化工作台"><BrandLogo size={26} /></a>
      <nav className="workbench-nav" aria-label="工作台导航">
        <button className={section === "projects" ? "active" : ""} onClick={() => { setSection("projects"); setFolder(null); }}><Computer />我的项目</button>
        <button className={section === "trash" ? "active" : ""} onClick={() => { setSection("trash"); setFolder(null); }}><Delete />回收站</button>
        <div className="nav-divider" />
        <button className={section === "models" ? "active" : ""} onClick={() => { setSection("models"); setFolder(null); }}><Box />我的模型</button>
        <button className={section === "assets" ? "active" : ""} onClick={() => { setSection("assets"); setFolder(null); }}><AllApplication />素材广场</button>
      </nav>
    </aside>
    <div className="workbench-body">
      <header className="workbench-header">
        <SearchInput icon={<Search className="size-4 text-muted-foreground" />}
          clearLabel="清空模板搜索" className="relative min-w-[200px] flex-1" placeholder="输入关键词搜索模板" aria-label="搜索模板"
          value={templateQuery} onValueChange={setTemplateQuery}
          onKeyDown={(event) => event.key === "Enter" && setSection("assets")} />
        <DropdownMenu>
          <DropdownMenuTrigger render={<button className="workspace-account" />}>
            <Avatar size="sm"><AvatarImage src="/reference/default-avatar-classic-gray.92ab041c.svg" /><AvatarFallback>本</AvatarFallback></Avatar>
            <span>本地工作区<small>本地项目</small></span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => { window.location.hash = "#/login"; }}>短信登录</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setWorkspaceInfo(true)}>工作区说明</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <main className="workbench-content">
        {section === "models" ? <ModelAssetLibrary /> : section === "assets" ? <>
          <div className="content-title"><h1>素材广场</h1><span>选择模板，开始创建可视化项目</span></div>
          <div className="market-grid">{templates.filter((t) => t.name.includes(templateQuery)).map((t) =>
            <button className="market-card" key={t.id} onClick={() => { setTemplateId(t.id); setCreating(true); }}>
              <img src={t.image} alt="" /><h3>{t.name}</h3><p>{t.description}</p><span>使用模板 <Right /></span>
            </button>)}</div>
        </> : <>
          <div className="project-actions">
            {section === "projects" ? <><Button onClick={() => { setTemplateId("empty"); setCreating(true); }}><Plus />新建</Button>
              <Button variant="ghost" onClick={() => { setDraft(""); setDialog({ type: "folder" }); }}><Folder />新建文件夹</Button>
              <Tooltip><TooltipTrigger render={<Button className="import-project" variant="ghost"
                onClick={() => fileRef.current?.click()} />}><Download />导入项目</TooltipTrigger><TooltipContent>导入已导出的 JSON 项目</TooltipContent></Tooltip></>
              : <span className="trash-note">删除的项目保存在回收站中，可随时恢复</span>}
          </div>
          <div className="project-filter-row">
            <div className="project-breadcrumb"><button onClick={() => setFolder(null)} className={!folder ? "current" : ""}>{section === "trash" ? "回收站" : "我的项目"}</button>
              {folder && <><Right /><span className="current">{folder}</span></>}</div>
            <div className="project-filters"><Select value={sort} onValueChange={(value) => setSort(String(value))} items={sortOptions}>
              <SelectTrigger className="w-[128px] shrink-0" size="sm" aria-label="项目排序"><SelectValue /></SelectTrigger>
              <SelectContent>{sortOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
              <SearchInput icon={<Search className="size-4 text-muted-foreground" />}
                clearLabel="清空项目搜索" className="relative w-[310px]" placeholder="搜索项目" aria-label="搜索项目"
                value={query} onValueChange={setQuery} /></div>
          </div>
          <div className="project-grid">
            {section === "projects" && !folder && !query && folders.map((name) => <button className="folder-card" key={name} onClick={() => setFolder(name)}><Folder /><span>{name}</span><small>{projects.filter((p) => p.folder === name && !p.trashedAt).length} 个项目</small></button>)}
            {filtered.map((project) => <article className="project-card" key={project.id}>
              <header><button className="project-name" title={project.name} onClick={() => openProject(project.id)}>{project.name}</button>
                <div className="project-card-actions">
                  <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm"
                    aria-label={`${section === "trash" ? "恢复" : "删除"}${project.name}`}
                    onClick={() => update(project.id, { trashedAt: section === "trash" ? undefined : Date.now() })} />}>{section === "trash" ? <Refresh /> : <Delete />}</TooltipTrigger>
                    <TooltipContent>{section === "trash" ? "恢复" : "移入回收站"}</TooltipContent></Tooltip>
                  <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm"
                    aria-label={`导出${project.name}`} onClick={() => exportProject(project)} />}><Export /></TooltipTrigger><TooltipContent>导出</TooltipContent></Tooltip>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`${project.name}更多设置`} />}><More /></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openProject(project.id)}>打开项目</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setDraft(project.name); setDialog({ type: "rename", project }); }}>重命名</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setDraft(project.folder ?? ""); setDialog({ type: "move", project }); }}>移动到文件夹</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        try { const copy = createProject(`${project.name} 副本`, project.template);
                          persistScene(copy.id, readScene(project.id) ?? []);persistEditorSettings(copy.id,readEditorSettings(project.id));persistBoardSize(copy.id,readBoardSize(project.id)); update(copy.id, { thumbnail: project.thumbnail });
                        } catch { Toast.error("复制失败"); }
                      }}>复制项目</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </header>
              <div className={`project-thumbnail ${section !== "trash" ? "is-openable" : ""}`} role={section !== "trash" ? "button" : undefined}
                tabIndex={section !== "trash" ? 0 : undefined} aria-label={`打开${project.name}`}
                onClick={() => section !== "trash" && openProject(project.id)}
                onKeyDown={(event) => { if (section !== "trash" && event.key === "Enter") openProject(project.id); }}>
                <img src={project.thumbnail ?? templates[0].image} alt={project.name} />
                <span className="open-project-overlay">
                  {section !== "trash" ? <>
                    <button className="overlay-action primary" onClick={(event) => { event.stopPropagation(); openViewer(project.id); }}>
                      <Play />全屏查看
                    </button>
                    <button className="overlay-action" onClick={(event) => { event.stopPropagation(); openProject(project.id); }}>
                      <Edit />编辑
                    </button>
                  </> : <span className="overlay-hint">已移入回收站</span>}
                </span>
              </div>
              <footer><span className="project-card-tag">{project.folder || "+ 添加标签"}</span>
                <span className="project-footer-actions">
                  {project.publishedAt && <span className="published-badge" title={`发布于 ${new Date(project.publishedAt).toLocaleString("zh-CN")}`}><i aria-hidden="true" />已发布</span>}
                  <Button variant="ghost" onClick={() => setPublishing(project)}><Send />发布</Button>
                </span>
              </footer>
            </article>)}
          </div>
          {!filtered.length && (!folders.length || folder || query || section === "trash") && <div className="project-empty"><img src="/reference/empty-data.4599e693.webp" alt="" /><p>{query ? "没有找到匹配的项目" : section === "trash" ? "回收站为空" : "暂无项目，点击新建开始创作"}</p></div>}
        </>}
      </main>
    </div>
    {creating && <CreateProjectModal key={templateId} visible onClose={() => setCreating(false)} onCreate={newProject} initialTemplate={templateId} />}
    <Dialog open={Boolean(dialog)} onOpenChange={(open) => { if (!open) setDialog(null); }}>
      <DialogContent className="sm:max-w-[420px]!">
        <DialogHeader><DialogTitle>{dialog?.type === "folder" ? "新建文件夹" : dialog?.type === "move" ? "移动到文件夹" : "重命名项目"}</DialogTitle></DialogHeader>
        {dialog?.type === "move" ? <Select value={draft} items={[{ value: "", label: "我的项目（根目录）" }, ...folders.map((value) => ({ value, label: value }))]}
          onValueChange={(value) => setDraft(String(value))}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">我的项目（根目录）</SelectItem>
            {folders.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
          </SelectContent>
        </Select>
          : <Input autoFocus aria-label="名称" value={draft} maxLength={50} placeholder="请输入名称"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && submitDialog()} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialog(null)}>取消</Button>
          <Button onClick={submitDialog}>确定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(publishing)} onOpenChange={(open) => { if (!open) setPublishing(null); }}>
      <DialogContent className="sm:max-w-[440px]!">
        <DialogHeader><DialogTitle>发布项目</DialogTitle></DialogHeader>
        <p className="publish-description">当前项目保存在本地工作区。发布是本机标记，发布后可在项目卡片「全屏查看」打开发布成品；发布包可将成品部署到任意静态服务器。</p>
        <div className="publish-actions">
          <Button variant="ghost" onClick={() => publishing && exportProject(publishing)}><Export />导出项目文件</Button>
          <Button variant="ghost" onClick={() => publishing && exportPublish(publishing)}><Box />导出发布包</Button>
          <Button variant="ghost" onClick={() => publishing && openViewer(publishing.id)}><LinkOut />打开发布页</Button>
          {publishing && <Button onClick={() => {
            update(publishing.id, publishing.publishedAt ? { publishedAt: undefined } : { publishedAt: Date.now() });
            setPublishing(null);
          }}><Send />{publishing.publishedAt ? "取消发布" : "发布"}</Button>}
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={workspaceInfo} onOpenChange={setWorkspaceInfo}>
      <DialogContent className="sm:max-w-[400px]!">
        <DialogHeader><DialogTitle>本地工作区</DialogTitle></DialogHeader>
        <p className="text-sm leading-relaxed text-muted-foreground">项目与场景保存在当前浏览器，可导出 JSON 文件备份和迁移。</p>
      </DialogContent>
    </Dialog>
    <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={async (event) => {
      const file = event.target.files?.[0]; if (!file) return;
      try {
        const data = parseProjectFile(await file.text());
        const settings = await restoreBoardMedia(data.settings, data.boardMedia);
        const project = createProject(data.name, "empty");
        const activePage = settings.boardPages.find((page) => page.id === settings.boardActivePageId) ?? settings.boardPages[0]!;
        const boardSize = data.boardSize ?? { width: activePage.width, height: activePage.height };
        persistScene(project.id, data.scene); persistEditorSettings(project.id, settings); persistBoardSize(project.id, boardSize);
        if (data.params) persistParams(project.id, data.params);
        refresh(); Toast.success("项目已导入");
      } catch (error) { Toast.error(error instanceof Error ? error.message : "项目导入失败"); }
      event.target.value = "";
    }} />
  </div>;
}
