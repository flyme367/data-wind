# 图元属性面板同步（山海鲸同类配置项）

2026-11-01，把所有图元组件（看板 47 类图表 / 文本 / 媒体 / 控件）右侧属性面板按山海鲸同类组件的分区与配置项重组，并把缺失的公共样式配置补齐到数据模型与三条渲染链路。

## 面板分区（对齐山海鲸）

选中任意图元后，「样式」页签自上而下：

| 分区 | 配置项 | 说明 |
| --- | --- | --- |
| 位置尺寸 (px) | 位置 X / 位置 Y / 宽度 / 高度 / 角度 (°) | 山海鲸式单值输入（替代原 XYZ 三轴行）；X/Y 写 `position`，宽/高走 `boxSize`，角度写 `rotation.z` |
| 基础设置 | 对象类型 / 显示对象 / 锁定对象 / 透明度 / 排列 / 所属分组 | 透明度从原「组件内容」移入；「排列」新增 置顶 / 上移 / 下移 / 置底 四按钮（复用 `reorder` 协议） |
| 组件内容 | 标题文本、数值 / 单位、正文内容（弹窗新增）、选项列表、进度百分比、图片、网页地址 | 按组件类别显示，纯内容字段 |
| 文本设置 | 文字颜色 / 字体 / 字号 / 字重 / 斜体 / 下划线 / 对齐方式 / 行高 / 字间距 | 新增分区；图片与基础图形不显示；图表类颜色标注「文字 / 图表颜色」 |
| 背景设置 | 组件背景 | 从原「组件内容」拆出 |
| 边框设置 | 边框样式（无 / 实线 / 虚线 / 点线）/ 边框颜色 / 边框宽度 / 圆角 | 新增分区 |
| 阴影设置 | 阴影效果开关 / 阴影颜色 / 阴影模糊 / 水平偏移 / 垂直偏移 | 新增分区；开关打开时给 `#000000b3` + 模糊 10 + Y 偏移 4 预设 |

非图元对象（模型 / 标记点 / 飞线 / 灯光 / 相机 / 分组）维持原「基础设置 / 变换 / 几何尺寸 / 飞线终点」三轴面板不变。

## 数据模型（`frontend/src/data/editor.ts`）

- `WidgetConfig` 新增字段：`fontFamily`（CSS font-family 栈，`""` 为默认）、`fontWeight`（300–700）、`italic`、`underline`、`lineHeight`（0 为默认）、`letterSpacing`（0 为默认）、`borderStyle`（none/solid/dashed/dotted）、`borderWidth`、`shadowColor`（`transparent` 为无阴影）、`shadowBlur`、`shadowOffsetX`、`shadowOffsetY`。
- `defaultWidgetStyle`：上述字段的缺省值，`widgetNode()` 创建图元时展开。
- `normalizeWidgetStyle()`：旧项目 / 导入文件缺字段或含脏值时补齐默认、收敛到合法区间。
- `widgetAppearanceStyle(w, color)`：组件外观内联样式的单源 helper（数值均带 px 单位），编辑器 `BoardOverlay`、发布端 `BoardRenderer`、PNG 导出 `exportBoard` 三处共用。
- 字体下拉 `widgetFontFamilies`（苹方 / 微软雅黑 / 黑体 / 宋体 / 楷体 / Arial 等 9 项）、字重 `widgetFontWeights`、边框样式 `widgetBorderStyles`。

## 其他接入点

- `frontend/src/state/projects.ts`：`validateScene` 在存储边界对 widget 执行 `normalizeWidgetStyle`，本地项目、项目文件导入、发布页读取统一补默认值。
- `frontend/src/components/WidgetProperties.tsx`（新增）：图元面板组件，PropertiesPanel 按 `node.widget` 路由。
- `frontend/src/components/PropertyFields.tsx`：新增 `NumberField` 单值数字字段。
- 边框由 CSS 兜底（`.board-widget { border: 1px solid }`），内联样式覆盖三者。

## 验证

- TypeScript 类型检查、Oxlint 0 警告、Vitest 78 项测试通过（新增 2 项：新图元缺省字段 + 外观样式/归一化断言、旧数据边界补默认值）。
- 浏览器实测（智慧园区示例项目）：
  - 选中「翻牌器」，面板出现全部 7 个新分区；旧数据图元直接可用（加载时归一化生效）。
  - 阴影开关 → 画布 `boxShadow: rgba(0,0,0,.7) 0px 4px 10px`；斜体 → `fontStyle: italic`；边框样式「虚线」→ `borderStyle: dashed`，均即时生效。
  - 编辑器画布、编辑器预览、发布页 `viewer.html` 三处样式一致。
  - 测试修改已全部撤销，示例项目恢复原状。

已知边界：字体下拉依赖本机安装的字体（Web 安全字体栈兜底）；图表类组件的字号 / 字重作用于容器继承（标题 CSS 固定 17px，图表内部几何由 chartSvg 单源绘制），逐图表的细粒度文本配置不在本次公共面板范围。
