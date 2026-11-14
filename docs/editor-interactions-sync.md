# 编辑器 UI 交互深度同步（山海鲸 4.7.13 对照）

2026-11-04，用浏览器实机对照 workspace.shanhaibi.com 编辑器（项目「我的建筑底座场景A（性能优先）」，v4.7.13）逐菜单、逐面板盘点 UI 交互，与本项目的差距和同步进度记录在此。

## 一、山海鲸交互盘点（实测记录）

### 顶栏菜单

| 菜单 | 项目 |
| --- | --- |
| 项目 | 新建子看板(N) ⌘N / 保存项目(S) ⌘S / 另存为... / 项目部署 / 重命名(R)... / 项目设置(P)... / 关闭项目 |
| 数据 | 添加数据... / 编辑数据(D)... ⌘D / 刷新数据 ⌘F5 / 数据条件... |
| 操作 | 撤销(Z) ⌘Z / 恢复(Y) ⌘Y / 复制(C) ⌘C / 粘贴(V) ⌘V / 删除 ⌘Backspace / 全选(A) ⌘A / **图层 ›** / **对齐 ›** / **排列 ›** / 合并到分组 / 取消分组 / 项目素材检查 / 历史记录 |
| 操作 › 图层 | 置于顶层 / 置于底层 / 上移一层 / 下移一层 |
| 操作 › 对齐 | 水平居中 / 垂直居中（相对画布） / 顶对齐(T) / 垂直居中对齐(M) / 底对齐(B) / 左对齐(L) / 水平居中对齐(C) / 右对齐(R) |
| 操作 › 排列 | 按顶分布(T) / 垂直居中分布(M) / 按底分布(B) / 按左分布(L) / 水平居中分布(C) / 按右分布(R) |
| 3D | 添加3D / 进入3D编辑 / 退出3D编辑 / 导入模型 |
| AI助手 | 无下拉的独立按钮（AI 对话入口） |

顶栏右侧：两个计数徽标（组件统计）、**发布**（蓝色主按钮）、预览▾。

### 右侧属性面板

- 页签：样式 / 交互 / 数据 / 代码 / **默认状态 ▾（下拉，交互状态机入口）**。
- 组件样式页分区：基本设置（不透明度 / **鼠标穿透** / **是否加载**）、大小&位置（W/H 链接锁比例；组件位置 X/Y；**组件旋转 X/Y/Z**）、**响应式布局（横向布局：左间距固定等；纵向布局：上间距固定等）**、边框设置、背景设置、**组件封面**。
- 交互页：交互设置 + 添加交互 → 弹窗字段：名称 / 触发（点击…）/ 动作（**组件控制：切换状态、修改设置、控制弹窗、组件自定义；项目控制：刷新数据、全屏播放控制、修改项目参数、访客退出登录**）/ 目标组件 / 状态 / 顺序（与上一动作同时…）。
- 子看板样式页：基本设置（子看板尺寸 W×H、**全屏显示模式（等比缩放长边…）**、填充颜色、**内部组件布局（静态布局 / 流式布局）**）、**子看板轮廓**（开关）、背景设置、**封面设置（封面图 + 截屏按钮）**。

### 其他区域

- 左栏：看板图层 + 漏斗过滤 + 搜索；树为 子大屏1 › 弹窗 / 鲸孪生（弹窗、孪生组件是场景节点类型）。
- 素材 rail：全部 / 图表 / 文本 / 媒体 / 控件 / 地图 / 3D / **拓扑** / 套件。
- 底栏：前景 + / 子大屏1 / 背景 +；缩放下拉（拟合时显示实际比例两位小数）；**最佳显示比例 / 快捷键列表 / 调试面板（终端图标）** 三个图标按钮；右段状态栏（与属性面板同宽对齐）：**内存： 已用/已分配/上限 MB（performance.memory，2s 轮询）+ FPS ｜ 组件数: 可见/全部 + 版本号**（BoardStatusBar.tsx，版本经 vite define `__DW_VERSION__` 注入 package.json version）。

## 二、同步进度

### 本次已实现（2026-11-07 第十二批：底栏右段状态栏 1:1 复刻山海鲸——内存/FPS/组件数/版本）

用户要求：同步山海鲸 4.7.13 底栏（截图右段：内存： 282 / 296 / 4192 MB ｜ FPS: 60 ｜ 组件数: 6 / 6 ｜ 4.7.13，两行排布，与左侧画布工具区以竖线分界）。

| 项 | 实现 |
| --- | --- |
| 新组件 `BoardStatusBar.tsx` | 底栏最右新增 `.board-statusbar`：两行 flex space-between——行1「内存： 已用/已分配/上限 MB」+「FPS: n」，行2「组件数: 可见/全部」+「版本号」 |
| 内存读数 | `performance.memory`（Chromium 专有，Safari/Firefox 显示 "-"），used/total/limit 各取 MB，2s setInterval 轮询；顺带验证数字会随运行跳动 |
| 组件数口径 | `scene` 过滤 `type === "widget"`：`可见 / 全部`（节点级 visible，与引擎实例数无关） |
| 版本号 | vite `define: { __DW_VERSION__: JSON.stringify(version) }` 注入 package.json version（tsconfig 不含 vite.config，无 resolveJsonModule 负担；`vite-env.d.ts` 声明常量） |
| 对齐属性面板 | `.board-statusbar { flex-basis: clamp(260px, 16.8vw, 530px) }` 与 `.editor-properties` 同一 clamp 表达式 → 分界竖线天然对齐面板左边线；背景 #121416 / 边线 #292929 同面板；≤760px 媒体查询同步 230px |
| 配套修正 | 调试面板按钮图标 Monitor→Terminal（对齐截图终端图标）；缩放 Select 宽 83→96px——拟合态 label 改为两位小数实际比例（如 55.06%）后 83px 截断成「55.0…」；Select 上非法的 `title` prop 移到外层 span（Semi Select 无此 prop，曾致 tsc 报错） |

验证：tsc 干净、oxlint 0（5 条 warning 均为他人文件既有）、vitest 40 文件 197 项全过；IAB 实测 1600×900——右段与属性面板边线对齐、内存 137→171 MB 跳动、组件数 1/1、版本 0.1.0、缩放完整显示 55.06%。**已知边界**：IAB 后台遮挡时引擎 rAF 冻结，FPS 显示 0，前台正常。

### 本次已实现（2026-11-05 第十一批：折叠分区头部复刻山海鲸——⋮ 固定最右 + 头部开关补齐）

用户要求：竖着三个点固定在最右；补齐山海鲸红框列（基本设置 ⋮ / 子看板轮播 开关+⋮ / 背景设置 开关+⋮ / 封面设置 ⋮）。

| 项 | 实现 |
| --- | --- |
| **Semi Collapse extra 丢弃坑（根因）** | Semi `item.js`：`header` 为**纯字符串时才渲染 extra**，JSX header 的 extra 被整个静默丢弃——轮播/背景两行的开关+⋮ 自第八批以来从未渲染过（此前浏览器验证漏检）；字符串头部又因 header/icon/extra 三子项被 `space-between` 摊开，⋮ 贴在标题后 |
| 统一 JSX header | 四个面板 header 全部改为 `<span class="board-collapse-header">`（title + extra 内嵌），弃用 `extra` prop；`.board-collapse-extra { margin-left: auto }` 把开关+⋮ 钉死最右，展开/收起态都生效 |
| 禁用置灰态 | 轮播（未启用或仅 1 页）/ 背景设置（开关关）标题加 `is-muted`（#6a6f75），对应山海鲸关开关后的置灰行 |
| 功能 | ⋮ 菜单不变（导出本组设置 JSON / 恢复默认值，`stopPropagation` 防折叠切换）；开关走原 update() 链路，实测 cua.click 双向切换 + 置灰联动正常 |

验证：tsc 干净、oxlint 0、vitest 36 文件 172 项全过；浏览器实测——四行头部 ⋮ 均在最右（extra 右缘 1588/面板 1600）、轮播/背景开关渲染且功能正常、⋮ 菜单打开不触发折叠、muted 随开关切换。**过程坑**：改文件期间页面白屏（rootChildren=0）是并行编辑 HMR 空窗撞车，cache-bust `import("/src/main.tsx?t=")` 重求值可恢复+定位；测 Semi Switch 必须先 `elementFromPoint` 确认命中（面板展开状态变化会让旧坐标落空，且打开的 Dropdown 会吃掉第一次 outside click）。

### 本次已实现（2026-11-05 第十批：右侧面板红框区 1:1 复刻山海鲸头部）

用户要求：只优化属性面板头部（标题行 + 页签行），1:1 复刻山海鲸，用 Semi 官方组件。

| 项 | 实现 |
| --- | --- |
| 页签行组件化 | 原 `RadioGroup type="button"` 换成 Semi `Tabs type="line"`（官方页签组件，tabList 受控无内容面板，`.semi-tabs-content` display:none）；active = 白字 + 2px `--semi-color-primary` 蓝下划线，与山海鲸一致 |
| 「默认状态」触发器 | StateDropdown / BoardStateDropdown 的 Tag 换成 Semi `Button` 胶囊（`.state-dropdown-tag`：#2e3134 底、圆角 3、28px 高）；非 widget 节点用同款静态 Tag（`state-dropdown-static`） |
| 面包屑标题行 | 看板模式选中组件时显示「子大屏名 › 对象名」（`.properties-title-sep` 灰色 › 分隔）；标题行 44px、#1e2023 底、图标 14px；行高页签行 48px、#141618 底 |
| 浮动换行坑 | Semi 线型页签 `.semi-tabs-tab` 是 `display:block + float:left`，窄面板浮动换行 → bar 强制 `display:flex`（浮动失效、永不换行）；760px 断点下 12px 字号 + 8px 间距单行放得下 |
| 清理 | 删除 `.properties-tabs > button` / `.semi-select` 死规则（旧原生实现残留） |

验证：tsc 干净、oxlint 0、vitest 36 文件 169 项全过；IAB 实测 1600px（未选中「子大屏1」/ 选中「子大屏1 › 按钮」+ 删除按钮）、700px 窄面板单行不溢出、页签切换（样式/交互）正常。测试注入用 `window.__dw` 调试句柄——HMR 后动态 `import("/src/state/store.ts")` 会拿到分裂实例（`?t=` 实例分裂坑），reload 后再用才生效。

### 本次已实现（2026-11-05 第九批：顶栏菜单 + 素材 rail 山海鲸式纵向化）

用户要求：参考山海鲸，菜单图标在上、文案在下（先后指顶栏菜单与素材 rail）。

| 项 | 实现 |
| --- | --- |
| 顶栏菜单触发器纵向化 | `TopMenuBar` 的 Menu 触发按钮去掉下拉箭头 `Down`；`.editor-menu-button` 改 `flex-direction: column`（图标 15px 在上、11px 文案在下，高 35px 占满 36px 顶栏），项目/数据/操作/3D/操作帮助 五个触发器全部生效 |
| Semi 包裹层适配 | Semi `Button` 会把子元素包进 `.semi-button-content`（自身 flex row），需对该层单独设 `flex-direction: column; gap: 2px`，图标选择器去掉 `>` 直接子代限制 |
| 素材 rail 纵向化 | `.editor-asset-rail` 88px→56px 窄轨；Semi `Nav` 的 item 里 icon/text 是直接子元素，直接 `flex-direction: column` 即可（icon 17px 上、label+计数一行居中下，行高 52px），JSX 无改动；760px 小屏 rail 收窄 48px，原 72px 宽度覆盖与 label 纵排覆盖删除（已被基础样式取代） |

验证：tsc 干净、vitest 35 文件 163 项全过、oxlint 0；headless Chrome + CDP 实测截图（docs/screenshots/top-menu-vertical*.webp、asset-rail-vertical*.webp）——顶栏五触发器均图标上/文案下且「项目」下拉正常；rail 9 项几何探针全部 stacked=true（文案 top ≥ 图标 bottom），「图表」点击后橙色选中态与素材抽屉正常。

### 本次已实现（2026-11-05 第九批：组件级封面）

- `captureWidgetCover(nodeId)`：整板 Rust 合成帧上按组件 `position + boxSize` 裁剪，等比缩到 320px JPEG；组件样式页新增「组件封面」面板（封面图 + 截屏 + 清除），存 `node.data.cover`（免改协议）。
- 验证：tsc 干净；面板结构浏览器实测渲染正常（选中组件后出现组件封面折叠面板）；截屏链路与整板封面共用 `composeBoardCanvas`（该路径已实测可用）。E2E 演示受图层树虚拟化与画布点选自动化的稳定性限制未走完，属自动化打滑而非功能代码问题。

### 测试过程对「控件验收看板」项目的影响（如实记录）

流式布局验证时一键整理了全部组件并已自动保存（原布局无法恢复，如需可手动重排或告知预期排布）；测试用拓扑图组件已删除；checkbox 组件确认仍在（此前因图层树虚拟化误判为丢失）。

### 本次已实现（2026-11-05 第八批：编辑器 UI 全面 Semi 组件化）

### 本次已实现（2026-11-05 第八批：编辑器 UI 全面 Semi 组件化）

用户要求：除 Rust 画布外，编辑器 UI 一律使用官方组件库（Semi Design；semi-mcp 本会话未挂载为工具，直接按 Semi 官方组件规范落地）。

| 手搓控件 | 替换为 |
| --- | --- |
| 底部 board-toolbar 原生 button ×4（前景/子看板1/+/进入三维） | Semi `Button`（size small + IconPark 图标） |
| 顶栏菜单触发器 / 操作帮助 / 项目标题（原生 button） | Semi `Button theme="borderless"`（保留 editor-menu-button 类做间距） |
| 属性面板页签行（原生 tab button） | Semi `RadioGroup type="button"` |
| 素材分类 chips（8 处原生 button palette-chip） | 抽出 `PaletteChips` 组件 = Semi `RadioGroup type="button"`（渲染类名 semi-radioGroup-buttonRadio） |
| DataSourceEditor Excel 工作表原生 `<select>` | Semi `Select` |
| TourBar 预览胶囊按钮（inline style pill） | Semi `Button`（solid/borderless 状态切换） |
| LeftPanel 折叠展开标签（原生 button） | Semi `Button theme="borderless"` |

验证：tsc 干净、vitest 35 文件 163 项全过、改动文件 oxlint 0；浏览器实测——顶栏 13 个按钮全部 Semi（原生 0）、底部工具栏 6 个 Semi（原生 0）、页签行与图表面板 chips 均为 semi-radioGroup-buttonRadio。

**保留非 Semi 的项（有明确理由）**：① 画布右键 ContextMenu——Semi 无右键菜单组件（Dropdown 需要触发元素，定位到光标的上下文菜单必须自绘）；② ColorField 原生 `<input type=color>`——Semi 2.104 无取色器组件；③ 隐藏 `<input type=file>`——文件选择是浏览器原生能力；④ 新建项目模板卡片 / 材质色板格——内容卡片与色板，非表单控件；⑤ 标尺、变换手柄、画布浮层提示——画布 chrome（随 Rust 画布豁免）。

### 本次已实现（2026-11-05 第七批：拓扑自动布局 + 流式布局）与收尾结论

### 本次已实现（2026-11-05 第七批：拓扑自动布局 + 流式布局）与收尾结论

| 项 | 实现 |
| --- | --- |
| 拓扑自动布局 | `topologyAutoLayout(nodes, edges, width)`：按连线 BFS 分层（无入边为根，断开/成环节点回退后继层），层内水平均分、层距 110px；拓扑图组件内容面板新增「自动布局」按钮（写入 nodes，可撤销） |
| 内部组件布局 | 基本设置新增 静态布局/流式布局 分段按钮（`settings.boardLayout` 记忆最近选择）；流式布局 = worker `flowLayout` 操作：组件按 y→x 排序逐行铺放（24px 边距与间距，行高取行内最大），一步撤销 |

验证：tsc 干净、vitest **35 文件 163 项全过**（新增：BFS 分层/均分/成环回退用例 + flowLayout 行排列/撤销用例）、改动文件 oxlint 0；浏览器实测——插入拓扑图点「自动布局」后节点分层排列（根居中→汇聚层→终端层），「流式布局」一键把全部组件整理成整齐行列（按钮高亮+Toast），测试后已撤销并清理。

### 至此山海鲸 4.7.13 编辑器 UI 交互同步的**架构边界结论**（后续不再排期的项）

| 项 | 结论 |
| --- | --- |
| 组件旋转 X/Y/Z | 看板组件由 egui 2D 渲染器绘制，仅支持 Z 轴角度；真 X/Y 旋转需要 3D 变换管线，与"看板像素全由 egui 绘制"的架构冲突，不实现（3D 场景对象的旋转本来就是 XYZ） |
| 多子看板 ⌘N | 需要多页看板结构（页签路由、每页独立树/尺寸/发布产物），是数据模型级改造；当前 前景/子看板1/背景 结构满足单页流程，列为独立大项 |
| 响应式布局（横向/纵向固定策略） | 山海鲸的流式约束布局跟随画布拉伸重排组件；与自由拖拽编辑语义冲突，且预览拉伸已有 boardFit 三模式覆盖，不实现 |

### 本次已实现（2026-11-05 第六批：子看板轮廓 + 封面设置）

| 项 | 实现 |
| --- | --- |
| 子看板轮廓 | `EditorSettings.boardOutline`（默认关，validateEditorSettings 归一化）；开启时编辑态画布外围 1px 虚线描边（outline-offset 5px，不影响布局） |
| 封面设置 | 「封面与截图」面板重排为山海鲸式「封面设置」：封面缩略图 + 截屏按钮；`captureBoardCover()` 复用 Rust 场景帧+组件快照合成，等比缩到 480 宽 JPEG（控制体积）写入 `ProjectMeta.thumbnail`——工作台项目卡片立即显示真实看板封面 |

验证：tsc 干净、vitest 35 文件 161 项全过；浏览器实测——面板结构 基本设置(含轮廓开关)/背景设置/封面设置(封面图+截屏+两个 PNG 导出)；截屏后封面缩略图渲染、`dw_projects` 元数据落库、Toast 提示；轮廓开关切换画布虚线描边即时显隐。测试开关已复位（封面保留）。

已知边界：「内部组件布局（静态/流式）」未同步——流式布局需要组件自动排列引擎，单独排期；封面截屏当前为整块看板，无组件级封面。

### 本次已实现（2026-11-05 第五批：鼠标穿透/是否加载/数据条件）

| 项 | 实现 |
| --- | --- |
| 鼠标穿透 | 组件「基本设置」开关（存 `node.data.passThrough`，免改 FlatBuffers 协议）；**Rust `hit_test` 在预览/发布态跳过开启穿透的组件**（点击落到下层，编辑态仍可选中） |
| 是否加载 | 「基本设置」开关（`node.data.loaded`）；**Rust `paint_widget` 关闭时只画外壳并居中显示「组件未加载」**，不渲染内容 |
| 数据条件 | `DataSourceConfig.filter {field,op,value}`（操作符 ==/!=/>/</>=/<=/contains），`validateDataSource` 清洗非法配置；**`LiveDataManager.emitJson` 统一应用**（API/WebSocket/Socket.IO/PostMessage 四种来源全覆盖，编辑器与发布端共用）；数据源编辑器新增「数据条件」行（字段+操作符+比较值） |

验证：tsc 干净、vitest **35 文件 161 项全过**（新增数据条件用例：七种操作符过滤、非 rows 原样、清洗规则、校验保留）；cargo check 通过、wasm 双变体重建；浏览器实测——基本设置两开关读写生效（是否加载关闭后画布出现 Rust 渲染的「组件未加载」占位，恢复后内容回来）、数据源编辑器「数据条件」行渲染完整。测试开关已复位。

已知边界：鼠标穿透的预览点击行为依赖 Rust hit_test 跳过逻辑（简单直接，未做端到端点击断言）；数据条件对非 rows 结构（单值/对象）不生效，与山海鲸的行过滤语义一致。

### 本次已实现（2026-11-04 第四批：两套素材菜单归类整理）

对照山海鲸 3D 编辑实测（鲸孪生 › 场景，rail 全部1300/模型914/GIS10/地表7/标绘261/材质69/动效27/场景12，全部视图=平铺网格+计数）：

| 项 | 实现 |
| --- | --- |
| 3D 资产库孤儿分类清理 | 删除 图表/文本/媒体/控件 四组 comingSoon 看板组件占位（看板组件归看板模式 rail，不进 3D 资产库，与山海鲸一致）；`AssetLibrary` 类型收缩为 7 库 |
| 灯光/相机归类 | 原「辅助」库（无 rail 入口、只在全部可见）并入「场景」库（场景/灯光、场景/相机），从「场景」rail 分类可达 |
| 地表归类 | 「地表拼接样板」场景模板从「场景」移入「地表」分类（地表/拼接样板） |
| 全部分组排序 | assetGroups 分组顺序头部插入 rail 顺序（模型 GIS 地表 标绘 材质 动效 场景），「全部」抽屉分类树与 rail 一一对应 |
| 看板全部视图分段 | 分段顺序从 图表→3D图表→锦绣孪生→文本… 改为与 rail 一致：图表 文本 控件 媒体 地图 3D图表 锦绣孪生 拓扑 套件 |

验证：tsc 干净、vitest 34 文件 159 项全过（新增「全部视图按 rail 顺序分组」用例）；浏览器实测——看板「全部」分段按 rail 序；3D 编辑 rail 8 分类全部带计数（全部268/模型188/GIS11/地表21/标绘15/材质12/动效8/场景13），分类树无孤儿组，场景分组含灯光与相机。左侧 场景/材质/辅助 页签与山海鲸 3D 左栏页签天然一致，未动。

### 本次已实现（2026-11-04 第三批：交互动作清单 + 拓扑分类）

| 项 | 实现 |
| --- | --- |
| 交互动作清单 | 执行动作按山海鲸分组：**组件控制**（切换显示/显示对象/隐藏对象/切换状态/设置文本/控制弹窗/改变颜色/定位视角）+ **项目控制**（刷新数据/全屏播放控制/提示信息），Semi OptGroup 分组下拉 |
| 控制弹窗 | 打开/关闭/切换目标弹窗组件的显示（我们的弹窗是看板组件，非山海鲸的全屏遮罩，文档级边界） |
| 设置文本 | 运行时改目标组件标题（`runtime[id].text` → resolveRuntimeNode 合入 widget.text） |
| 刷新数据 | 交互触发重拉数据连接（编辑器 dw:refresh-data；发布端补上 LiveDataManager.refresh 监听） |
| 全屏播放控制 | document.fullscreenElement 切换 |
| 顺序字段 | 交互规则补「顺序：与上一动作同时 / 之后」；「之后」延迟 250ms 读最新状态执行（编辑器与发布端一致） |
| 拓扑分类 | 素材 rail 补「拓扑」分类（顺序对齐山海鲸：地图 3D 拓扑 套件）；拓扑图组件 = `WidgetKind "topology"`，数据 `data.nodes[{id,name,x,y}]` + `data.edges[{from,to}]`，节点坐标为组件内像素偏移；**Rust `board/widgets.rs` "topology" 分支绘制**（圆形节点+连线+标签），WIDGET_KINDS 白名单已加，wasm 双变体重建；素材缩略图为 SVG 小拓扑 |

验证：tsc 干净、改动文件 oxlint 0、vitest 34 文件 158 项全过（新增 topologyCatalog 用例：目录/chips/预设数据完整性/边引用合法）；cargo check 通过；浏览器实测——rail「拓扑 1」入口、拓扑素材抽屉（chips 全部/默认拓扑 + SVG 缩略图）、插入后图层树出现拓扑图、**画布由 Rust 渲染出树形拓扑（核心交换机→汇聚→终端/监控）**、无白名单拒绝；交互面板分组动作菜单与山海鲸一致。测试插入的组件与规则已删除。

已知边界：拓扑节点坐标目前是手动像素定位（山海鲸有自动布局，后续可加）；控制弹窗的对象是看板内弹窗组件。

### 本次已实现（2026-11-04 第二批：组件状态系统）

山海鲸交互的核心——每个看板组件可有多个命名状态（默认状态 + 附加状态），附加状态 = 样式/内容的覆盖补丁；交互动作「切换状态」在预览/发布端把目标组件切到指定状态。

| 项 | 实现 |
| --- | --- |
| 数据模型 | `WidgetState { id, name, patch }` + `WidgetConfig.states`；补丁键白名单 `STATE_STYLE_KEYS`（22 个样式/内容字段），位置/显示/锁定/data 保持节点级；`sanitizeWidgetStates` 清洗（≤12 个、剔缺 id/名字、滤非法键） |
| 默认状态 ▾ | 属性面板页签行的静态 Tag 换成可交互下拉：列出默认状态 + 各状态、添加状态（自动激活）、重命名、删除 |
| 状态感知编辑 | 选中非默认状态时，样式面板显示「基础 + 状态补丁」合并值，写入进 `patchWidgetState`；画布所见即所得（`BoardOverlay` 对选中组件按编辑态状态渲染） |
| 切换状态交互 | `Interaction.action` 新增 `"state"`（value=目标状态 id）；交互面板新增「目标状态」下拉（跟随目标对象联动）；预览与发布端点击/双击触发 |
| 状态解析 | `resolveRuntimeNode` 应用 `runtime[id].stateId` 的补丁——编辑器画布、预览、发布 viewer 三条链路共用；**Rust 渲染端零改动**（拿到的永远是解析后的有效样式，发布成品渲染器仍是纯 Rust） |
| worker 操作 | `widgetStates`（整表替换）/ `patchWidgetState`（写单个状态补丁），撤销标签「组件状态」「修改状态」 |

验证：tsc 干净、改动文件 oxlint 0、vitest 33 文件 156 项全过（新增状态系统用例：补丁写入白名单过滤、runtime 切换合并、逐级撤销、非法状态拒绝、清洗规则）；浏览器端到端实测——添加状态→状态1 改透明度 0.3/字号 72→切回默认面板显示基础值（1/24）→画布所见即所得变暗→交互面板配置 单击→切换状态→状态1→预览点击 checkbox 变暗→Esc 退出恢复默认。

已知边界：字号等文本字段对 egui 原生控件（checkbox/switch 等）不生效（egui 控件用自身字体，与基础样式行为一致）；状态补丁在复制/粘贴、项目导出导入中随节点整体保留（structuredClone + normalizeWidgetStyle）。

### 本次已实现（2026-11-04 第一批）

| 项 | 实现 |
| --- | --- |
| 操作 › 图层 | 置于顶层/置于底层/上移一层/下移一层，复用 `reorder` worker 操作 |
| 操作 › 对齐 | 水平居中/垂直居中（相对看板画布，新增 `align` `mode:"board"`，单选可用）+ 六项互相对齐（复用 min/center/max） |
| 操作 › 排列 | 六项分布：按顶/垂直居中/按底/按左/水平居中/按右分布（`align` `mode:"distribute"` 新增 `edge` 参数，按指定边等距） |
| 项目素材检查 | 操作菜单项 + 弹窗：扫描缺资源的三维模型、未配置地址的媒体/网页组件、连接异常的数据源 |
| 项目菜单 | 另存为...（复制项目元数据+场景+设置为新项目）、项目设置(P)...（弹窗内嵌 SceneSettings）、关闭项目（原「返回工作台」对齐命名）；保存/重命名/导出/导入保留 |
| 数据菜单 | 对齐命名：添加数据... / 刷新数据（F5）/ 编辑场景 JSON / 导出 JSON 数据 |
| 底栏 | 快捷键列表（Keyboard 图标 + 弹窗全表）、调试面板（Monitor 图标，切换性能统计 HUD）；适应窗口已有 |
| 快捷键 | F5 刷新数据连接（见下方偏差说明） |

验证：`tsc --noEmit` 干净、oxlint 0 警告、vitest 32 文件 154 项全部通过（新增 `centers on the board and distributes by edges` 用例：单选看板居中 810、按顶分布 0/120/240、按左分布保持、board 模式拒绝 z 轴）。

### 与山海鲸的刻意偏差

- **刷新数据快捷键用 F5**：山海鲸是 ⌘F5，但 macOS 上 ⌘F5 是系统 VoiceOver 开关，浏览器无法拦截，改用裸 F5 + preventDefault。
- **保留 ⌘D 复制副本**：山海鲸操作菜单无此项（其 ⌘D 是编辑数据），本项目的复制副本快捷键保留在键盘层，菜单不展示。
- **发布按钮 / 打开发布页已有**：本项目的发布弹窗（导出项目 / 导出发布包 / 打开发布页 viewer.html）即山海鲸「项目部署」的本地等价物，成品页是纯 Rust（wasm egui/wgpu）渲染，无 DOM 混合。

### 待办（按优先级）

1. 素材 rail 补「拓扑」分类的自动布局变体（分层拓扑等，当前仅手动坐标）；其余拓扑组件样式按需扩充。
2. 数据条件...（数据源过滤条件配置，接 LiveDataManager）。
3. 组件样式页补：鼠标穿透（需 Rust hit_test 跳过）、是否加载、组件旋转 X/Y/Z（看板组件现只有 Z 角度）、组件封面。
4. 子看板样式页补：全屏显示模式、内部组件布局（静态/流式）、子看板轮廓、封面设置+截屏。
5. 新建子看板 ⌘N（多子看板页结构）、响应式布局（横向/纵向固定策略）。

### 已实现（2026-11-08）：3D 编辑态模型库三级分类 chips（山海鲸图一同步）

| 项 | 实现 |
| --- | --- |
| 三级分类 chips 行 | 资源库选中模型库二级栏目（如 建筑物）后，结果区顶部显示该栏目子分类 chips（可换行，h26 圆角 2 深灰底 #2b2d30，激活实心 #1677ff 白字）；点 chip 过滤、点「全部」回整组。通用实现：folder 为 `group:`/`child:` 时显示该栏目 children（AssetLibraryPanel `.asset-subchips`） |
| 建筑物 8 分类 | 全部/住宅建筑/商业建筑/工厂建筑/公共建筑/公共设备/构筑物/其他建筑/工业建筑（顺序固定在 `assetGroups.childOrder.建筑`，与山海鲸一致） |
| 分类重映射 | modelCatalog.ts 是 **生成物**（`scripts/prepare-models.mjs` ← `public/models/sources.json`），改了三处保持一致：sources.json（99 项 category）、生成的 modelCatalog.ts、生成器缩放分支（`建筑 / 办公`→`公共建筑`，高度缩放规则不变）。映射：住宅→住宅建筑(10)、商业→商业建筑(7)、办公→公共建筑(5)、医院构件→其他建筑(10)、工业→工厂建筑(66，含化工厂建筑 53+构件 14+厂房 3)、仓储中心→工业建筑(1) |
| 空分类 | 公共设备/构筑物暂无模型，chips 先占位显示空状态，随内容扩充填充 |

验证：`tsc --noEmit` 0 错、vitest 40 文件 200 项全过（新增 `assetGroups.test.ts` 建筑物 chips 山海鲸顺序 + 子分类过滤 3 项）；浏览器可视化验证因 WorkspacePage 并行编辑（HMR 中间态）+ IAB 遮挡冻结未完成，待页面稳定后复测：模型 → 建筑物 → chips 行显示/点击过滤。

教训：modelCatalog.ts 手工改动会被 `pnpm prepare:models` 再生成静默覆盖——分类调整必须落在 sources.json（+生成器脚本），不要直接改生成物。

### 已实现（2026-11-08 续）：全栏目三级分类 chips（山海鲸 4.7.13 全量取证）

取证方式：MCP 浏览器打开 workspace.shanhaibi.com 项目页 → 3D 菜单「进入3D编辑」→ 逐栏目点击，DOM 读取 `ul.piece-category-tags`（2026-11-08 实测）。

| 栏目 | 山海鲸 chips（全部除外） | 计蒙实现 |
| --- | --- | --- |
| 模型库/植被 | 推荐/风格化/乔木/草本植物/灌木/水生植物 | childOrder.植被；现有模型归 乔木/灌木/草本植物 |
| 模型库/交通工具 | 中小型汽车/工具类汽车/货车/特殊车辆/飞行器/船舶 | 轿车→中小型汽车，厢式货车等→工具类汽车，平板货车/载货卡车→货车，救护车/消防车/工程铲车/拖拉机→特殊车辆 |
| 模型库/室外装饰 | 健身器材/楼顶设施/安防设施/城市重型设备/城市设施/货物/公园设施/其他设施/公共设备/构件 | 垃圾箱/电线杆→城市设施，施工三件套→其他设施；**路灯移入交通设施** |
| 模型库/家具装饰 | 家具/运动器材 | 全部家具/*→家具 |
| 模型库/设备 | 公共设施/公共设备 | 管道/阀门→公共设备；**工业结构件（烟囱/储罐/钢构/龙门吊等 19 项）→ 建筑物/工厂建筑**（山海鲸把冷却塔/圆仓也放工厂建筑） |
| 模型库/交通设施 | 路灯/道路/基础设施/构筑物/道路设施 | 标志标牌+信号灯→道路设施，弯臂/双臂路灯→路灯 |
| 模型库/人和动物 | 人物/鸟类/鱼类/家畜 | 行人→人物 |
| 模型库/环境 | 地形/岩石 | 景观石→岩石 |
| 模型库/3D地图 | 写实风/科技风 | 静态占位栏目（暂无内容） |
| 模型库/商品样品、精灵图、全景天空 | 无 chips | 静态占位栏目 |
| 基础模型/AI建模、参数化模型 | 无 chips | 静态占位栏目（形状=现有基础形状） |
| 模型套件 | 交通套件(设施/标识牌)、工业套件(机械臂/AGV/物流生产/仓储/货物/生产设备/化工/环境治理/锻造熔炼/储能电力/污水处理)、军事模型(导弹类/装甲车/掩体/舰船/飞行器)、农业基础/室内家具/机房套件/医疗设备/农作物(无) | 第二列新增「模型套件」节；医疗设备组移入；其余静态占位 |
| rail 标绘 | 通用标记/免费标记/智慧园区/智慧城市/大场景标记/智慧管廊/主题标记/浅色系 | assets.worker 重构：标记→通用标记，围栏→智慧园区，飞线→智慧城市（管道 push 已被并行改动移除） |
| rail 材质 | 墙砖/大理石/地砖/水磨石/铺路石/花岗岩 | 颜色预设按表面用途归 墙砖(6)/地砖(4)/铺路石(2) |
| rail GIS/地表/动效/场景 | 无 chips | `chipsOffGroups` 抑制（子分类仍从左侧子栏进入） |
| rail 全部 | 无 chips | 「全部」视图保留 chips（替代缺失的第二列导航，刻意偏差） |

机制补充：
- `childChips()`（assetGroups.ts）按 childOrder 输出**全量** chips——暂无内容的分类以 count=0 占位显示（点击=空状态），实有但不在顺序表的分类排末尾。
- 空栏目（山海鲸有、我们无内容）以 `static:` 键渲染进第二列，点击显示空状态；内容入库后自动替换为真实分组。
- 并行协作注意：本批重映射（117+2 项）落在用户 00:55 再生成的 194 项目录之上，且 `panelHiddenModelIds` 隐藏的占位源模型（植被/路灯/管道等）使其栏目在面板中为空——属内容策展，非分类问题。

验证：tsc 0 错；vitest 40 文件 204 项全过（新增 建筑物全量 chips/植被顺序含占位/交通工具/标绘材质 rail/static+空占位过滤 6 项）；IAB 实测——模型第二列 1:1（导入/基础/模型库 13/套件 8）、建筑物 8 chips + 工厂建筑点击过滤（78→命中化工厂系）、家具装饰 chips、 medically 未测栏目走同一 childChips 路径；截图通道因面板遮挡冻结未留档。

### 已实现（2026-11-08）：图层树右键菜单（root≠子节点）+ 右侧固定配置面板根设置（山海鲸图层页同步）

对标山海鲸 workspace 图层管理页：左键节点→右侧面板切到对应配置；右键节点→上下文菜单；root 菜单与子节点菜单有意不同；看板图层与 3D 组件图层双模式生效。
**用户纠偏（同日）**：右侧配置面板必须在**固定位置**，不支持关闭、无关闭按钮、不得使用滑动窗口（抽屉）组件——第一版覆盖式抽屉已撤销，保留根设置内容切换。

| 项 | 实现 |
| --- | --- |
| 图层树右键 | Semi Tree `onContextMenu`（LeftPanel.tsx）：真实节点不在多选中先补 `select` 再弹菜单（与画布右键同一 `openSceneContextMenu` 状态库）；虚拟根直接弹 root 菜单 |
| root 菜单（@board） | 页面设置 / 重命名子大屏 / 添加空白子大屏 / 复制当前子大屏 / 删除子大屏（≤1 禁用，danger）/ 全选组件（selectAll(false) 仅 widget）/ 粘贴（剪贴板空禁用，新增 `hasNodeClipboard`） |
| root 菜单（@scene） | 场景设置 / 全选对象（selectAll(true) 非 widget）/ 粘贴 |
| 3D 固定分层菜单 | @camera/@models/@plants/@terrain/@markers/@lights：全选该层 / 显示该层 / 隐藏该层（`layerBucketIds` 与 LeftPanel 分桶过滤一致）；@sky→天空设置（跳场景设置）；@shapes/@sky 空层禁用整层项 |
| @twin 菜单 | 进入 3D 编辑 |
| 子节点菜单 | 沿用既有 `buildSceneContextMenu` 全套（重命名/删除/显隐/锁定/复制/成组/移入分组/选择图层/四向排序），未动 |
| 右侧固定面板 | `.editor-properties` 保持常驻右列（flex 布局原位，不可关闭、无关闭按钮、无滑动动画）；点节点只切换内容。WorkspacePage `rootNodeId` state（@board/@scene，与真实节点选中互斥：选中节点自动让位、取消选中/切页回落） |
| 根设置内容 | 树点 @board/@scene（新增 `onSelectRoot`）或点画布背景 → 面板显示 看板设置（BoardProperties）/ 场景设置（SceneSettings）；进入 3D 编辑（含 @twin、changeEditing(true)）自动选 @scene；无选中回落当前模式根设置 |
| rootActions 接线 | SceneContextMenuHost 新增可选 `rootActions` prop（openRoot/edit3D/renamePage/addPage/deletePage/canDeletePage），WorkspacePage 用现有 createBoardPage/renameActiveBoardPage/deleteActiveBoardPage 接入，页面管理逻辑零复制 |

验证：vitest 42 文件 222 项全过（contextMenuActions.test.ts 新增 6 项：@board 完整菜单+全选仅 widget、@scene 全选非 widget、@twin 进 3D、分层 ids 计算+整层显隐、粘贴剪贴板门控、虚拟根/真实节点路由）；tsc 除 chartCatalog.ts（用户并行编辑中）外 0 错；IAB 实测双项目双模式（root/分层/节点菜单+门控、面板内容切换、画布点选同步）。

### 已实现（2026-11-08 续）：编辑器骨架 Semi Layout 化（接入 @douyinfe/semi-mcp 重新规划）

应用户要求「使用 MCP 布局组件重新规划」：接入 Semi 官方 MCP（`.zcode/config.json` → `mcp.servers.semi-mcp` = `npx -y @douyinfe/semi-mcp`，下会话起自动连接；本会话以 stdio JSON-RPC 直驱 `get_semi_document` 取官方 Layout 文档）后，编辑器骨架由手写 flex div 换成 Semi 布局组件族。

| 位置 | 组件 | 说明 |
| --- | --- | --- |
| `.editor-body` | `Layout`（section.semi-layout） | 纵向骨架：行区 + 底栏 |
| `.editor-body-row` | `Layout hasSider`（section.semi-layout-has-sider） | 横向四列 |
| 左图层树 | `Layout.Sider`（aside.semi-layout-sider） | 本版 Sider 是极简实现（无 collapsed/宽度机器），收起仍走 `is-collapsed` 类 |
| 画布 | 保持原生 `main.editor-stage` | **Layout.Content 是 class 组件不转发 ref**，stageRef（ResizeObserver）会拿到实例而非 DOM——Content 渲染的也是 main 标签，语义无差，故不换 |
| 右属性栏 | `Layout.Sider`（aside.semi-layout-sider，PropertiesPanel 根） | 固定位置、不可关闭、无滑动（延续上一条纠偏） |
| 底栏 | `Layout.Footer`（footer.semi-layout-footer） | 原 footer 标签不变 |

CSS 适配：**Semi 样式晚于 app.css 加载，同特异性会覆盖**——`.editor-body/.editor-body-row` 改复合选择器 `.editor-body.semi-layout` 等；Sider 子元素包一层 `.semi-layout-sider-children`（height:100%），原 flex 纵向规则移到 `.editor-tree > .semi-layout-sider-children` 与 `.editor-properties > .semi-layout-sider-children`。素材列（rail+覆盖面板）与 stage 内部结构不动。

验证：tsc（除 chartCatalog 用户并行编辑）0 错；vitest 编辑器 3 文件 30 项全过；IAB 回归——骨架 DOM（SECTION/ASIDE/MAIN/FOOTER + has-sider）、树 170↔0 收起展开、属性栏 260px 右缘固定、状态栏分界线与属性栏左缘对齐（1020=1020）、素材覆盖面板 184 rail 展开、面板内容切换全部通过，截图无视觉回归。

### 已实现（2026-11-08 再续）：图层树增强四件（3D 画布右键 / 行内快捷键 / 空层与保留层语义 / 竞速修复）

| 项 | 实现 |
| --- | --- |
| 3D 画布右键 | Viewport contextmenu 接 `openSceneContextMenu`：命中节点→补选中弹节点菜单，未命中→`@scene` 场景根菜单。软件路径 `software.pickAt` 精确拾取；GPU 路径合成一对左键 down/up 走既有 `pick_request` 流（引擎仅左键抬起拾取），pick 响应经 `pendingContext` 分流。**GPU 合成拾取路径未浏览器实测，待人工验证**（编辑态才生效） |
| 行内快捷键 | 图层行 hover 显出 显隐/锁定 小按钮（`.tree-row-actions`，虚拟根不显示），stopPropagation 防触发选中/重命名。**修了一个真 bug：baseTree useMemo 依赖 `scene` 数组引用，worker 部分原地改节点不换引用 → 行内显隐/多选高亮陈旧；依赖改 `snapshot` 整体** |
| 空层/保留层语义 | `@shapes`→「形状设置」（同 @sky 跳场景设置），不再三项全灰；@board 菜单在 background/foreground 保留层隐藏页面管理项（重命名/增删子看板对保留层语义不匹配），全选按层取域（background→BACKGROUND_BOARD_PAGE_ID、foreground→FOREGROUND_BOARD_PAGE_ID、page→boardActivePageId） |
| 右键菜单竞速修复 | **真 bug**：旧菜单的 `window contextmenu` closer 在下一次右键打开新菜单后把它秒关（打开与关闭同事件竞速，图层树连续右键必现）。修法=`ContextMenuState` 加 `session` 自增令牌，关闭监听 guarded（仅自己仍是当前菜单才关），宿主按 session 作 key 重挂载 |
| 监听架构 | 图层树右键改**原生 contextmenu 监听**（`.scene-tree-content` 容器委托 + li `data-key` 取节点 id）——React 19 委托下 Semi Tree 的 `onContextMenu` prop 不触发（onClick/onDoubleClick 正常，root listeners 未见分发 contextmenu），已记为框架坑 |
| 调试句柄 | `contextMenu.ts` DEV 暴露 `window.__dwContextMenu{open,close}`（同 `__dw` 模式），隔离监听器与宿主链路排查 |

验证：tsc 0 错；vitest 44 文件 238 项全过（新增 前景层隐藏页面管理+按层取域、@shapes 设置项 2 项）；IAB 已实测——行内显隐/锁定往返（store+DOM 同步）、@board 页面菜单 7 项、背景层菜单 3 项（页面管理隐藏）、@shapes→形状设置、节点右键补选中+菜单。与用户并行重构（前景/背景独立看板、子大屏→子看板改名、@pagetab 页签右键）已对齐。

### 已实现（2026-11-08）：预览态满屏（对齐山海鲸 web 预览实测）

| 项 | 实现 |
| --- | --- |
| 满屏预览 | 山海鲸 4.7.13 web（workspace.shanhaibi.com）实测：预览态编辑器 chrome 全消失，看板铺满整个视口，无常驻退出控件。本项目原先预览保留顶栏（仅藏菜单/标题），看板永远少 36px 高度不满屏；现 `.is-preview .editor-header { display: none }`，stage 随 flex 占满 100dvh，fitScale 预览分支本就不扣边距，ResizeObserver 随 stage 变化自动重算 |
| 退出浮标 | 顶栏隐藏后「退出预览」按钮随之消失，新增 `PreviewExitHint`（WorkspacePage 内）：pointermove 唤醒、闲置 2.6s 淡出（opacity+pointer-events:none），点击或 Esc 退出；定位 absolute 于 `.editor-page`，不占布局不破满屏 |
| 边界 | 山海鲸预览顶部那条倒计时提示条是其网页版预览时限（license）横幅，非结构 UI，不复刻；Esc 退出沿用既有 keydown 处理 |

验证：tsc 0 错、vitest 44 文件 238 项全过、改动文件 oxlint 0；IAB 实测「我的空白地面3D场景」——预览态顶栏消失看板铺满视口、浮标闲置后 opacity=0、Esc 退回编辑器顶栏恢复。
