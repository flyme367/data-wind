# 控件类看板组件同步

## 2026-11-01：素材面板重新对齐

对照山海鲸编辑器的默认控件目录，重新排列本项目已支持的 19 个控件，补齐「基础时间」「基础图形/形状」「可切换分组面板（选项卡）」等显示名称。原名称「时钟」仍可搜索到基础时间。控件卡片改为紧凑的自适应网格，使用按控件造型绘制的缩略图；控件分类和「全部」素材中的控件均采用相同样式。

## 补充非 AI 控件

新增二维孪生、复选框、输入框、开关、数值滑动条、时间进度条、颜色、上传和树形控件，素材目录现有 28 项。编辑器预览与发布页共享控件内容和交互实现，交互状态不修改项目默认数据；控件会发出可冒泡的 `dw:control-change` 事件（`detail` 包含 `id`、`kind` 和 `value`）。

- 复选框和开关可设置默认选中状态；输入框、滑动条和颜色可配置默认值，滑动条可设置范围和步长。时间进度条的数值单位为秒。
- 上传控件支持设置文件类型、多选及上传地址；配置地址后选择文件会以 `POST` 和 `files` 字段提交，未配置地址时只选择文件。跨域上传需要服务端允许跨域。
- 树形控件通过数据面板的 `items` 配置根节点和子节点；二维孪生通过 `zones` 配置矩形区域的名称、位置、尺寸和颜色，并支持选择区域。这是轻量二维场景，不包含山海鲸原版的地图编辑、热力图等完整能力。
- 鲸 AI 未加入。预览中的值为临时状态，刷新或退出预览后恢复默认值。

## 初次同步记录

2026-11-01，对照参考成品的“控件”分类，把前景组件面板从单一“按钮”扩展为 12 类控件。

## 控件清单

| 控件 | WidgetKind | 默认预设（数据在 `node.data`） |
| --- | --- | --- |
| 基础下拉菜单 | `dropdown` | `options` 选项数组，当前选中项存 `widget.text` |
| 分组面板 | `groupPanel` | 标题栏 + `items` 行 |
| 列表 | `list` | `items` 行，隔行底色 |
| 按钮 | `button` | 沿用原有交互规则（click/dblclick） |
| 弹窗 | `dialog` | 标题 + `widget.value` 正文 + 取消/确定占位 |
| 可切换分组面板 | `tabs` | `items` 页签，预览态可切换 |
| 纵向菜单 / 横向菜单 | `menuVertical` / `menuHorizontal` | `items` 菜单项，`widget.text` 为高亮项 |
| 搜索框 | `search` | `widget.text` 为占位提示 |
| 进度条 | `progress` | `data.percent`（0–100） |
| iframe | `iframe` | `data.url`，地址栏 + sandbox 嵌入页 |
| 天气 | `weather` | `widget.text` 城市与天气，`value`/`unit` 温度 |

主要实现：

- `frontend/src/data/editor.ts`：扩展 `WidgetKind` 与 `widgetLabels`，新增 `controlPresets` 默认外观和 `widgetOptions()` 选项读取（dropdown 用 `data.options`，其余用 `data.items`，上限 12 条）。
- `frontend/src/components/BoardComponents.tsx`：控件面板 12 个入口；`WidgetContent` 按类渲染；预览态下拉可展开选择、选项卡可切换（组件内部状态，不改场景数据）。
- `frontend/src/styles/board.css`：各控件看板样式（编辑器与发布成品共用）。
- `frontend/src/components/PropertiesPanel.tsx`：按控件显示“当前选中项 / 弹窗标题 / 占位提示 / 进度标签 / 城市与天气”等标题字段，选项列表（`、`/`，`/`,` 分隔）、进度百分比、网页地址；天气复用数值/单位字段。
- `frontend/src/workers/assets.worker.ts`：编辑态资产库“控件 / 交互控件”占位清单与上述 12 类对齐。
- 面板图标使用 `@icon-park/react`（官方 IconPark），`theme="outline"` 默认继承 `currentColor`。

## 验证

- TypeScript 类型检查、Oxlint、Vitest 60 项测试通过；Oxlint 仅剩既有的 6 条无关警告。
- 浏览器实测（智慧园区示例项目）：控件面板 12 个入口齐全；依次添加 12 类控件并摆放位置，预览模式下全部正确渲染；下拉展开选项并选中“西南区域”、选项卡切换到“统计分析”均生效；iframe 地址栏正确显示 `https://semi.design`。
- 属性面板确认：弹窗显示“弹窗标题”，下拉菜单显示“当前选中项”与“下拉选项”，位置与几何尺寸（如 220×46）符合预设。
- 测试添加的控件已全部删除，示例项目对象数恢复为 18。

已知边界：下拉与选项卡的预览交互是组件内部状态，刷新后回到 `widget.text` 预设；iframe 为只读嵌入展示（`sandbox=""`、指针事件关闭，不干扰画布拖动）；弹窗按钮是视觉占位，动作仍通过“交互”面板配置。
