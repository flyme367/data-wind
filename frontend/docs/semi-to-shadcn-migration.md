# Semi → shadcn 迁移规范（唯一权威）

> 本分支（shadcn-ui）目标：**全面移除 @douyinfe/semi-ui**。所有 UI 改用 shadcn 组件（Base UI 1.9 底层，style=base-nova，Tailwind v4）。
> 每改完一个文件必须保证 `pnpm exec tsc --noEmit` 中**自己改的文件无新增报错**（engineClient.ts 有既有噪音报 wasm 找不到，与迁移无关，忽略）。

## 组件映射表

| Semi | shadcn 替代 | 说明 |
|---|---|---|
| `Button` | `@/components/ui/button` | variant: primary→`default`、borderless/light→`ghost`、outline/tertiary→`outline`、danger→`destructive`、warning→`destructive`；size: small→`sm`、large→`lg`；`block` 用 `className="w-full"`；`theme="borderless"`+仅图标→`variant="ghost" size="icon-sm"` |
| `Input` | `@/components/ui/input` | Semi `onChange(value:string)` → React 原生 `onChange(event)` 取 `event.target.value`；`size="small"` 用 `className="h-7 text-xs"`；`prefix/suffix` 用相对定位包裹 span |
| `TextArea` | `@/components/ui/textarea` | 同上，onChange 是 event |
| `InputNumber` | `@/components/ui-ext/number-input` `NumberInput` | **props 与 Semi 相同**（value/onChange(number\|string)/min/max/step/precision/suffix/size="small"/hideButtons/disabled/aria-label），调用方 `typeof v==="number"` 守卫照旧 |
| `Select` | `@/components/ui/select` | 受控：`<Select value={v} onValueChange={(val)=>set(val)}><SelectTrigger className="w-full" size="sm"/><SelectValue/><SelectContent><SelectItem value="x">…</SelectItem></SelectContent></Select>`。Semi `optionList={arr}` → 手写 SelectItem 列表；`showClear` → 加个清除小按钮或省略；多选 multiple → 见"多选"节 |
| `Modal` | `@/components/ui/dialog` | `<Dialog open onOpenChange={(o)=>!o&&close()}><DialogContent className="max-w-…"><DialogHeader><DialogTitle>…</DialogTitle></DialogHeader>…<DialogFooter><Button onClick={close}>取消</Button>…</DialogFooter></DialogContent></Dialog>`；确认型危险操作用 `alert-dialog` |
| `Toast` | `@/lib/toast` 的 `Toast` | **签名与 Semi 完全相同**（`Toast.error("msg")` / `Toast.error({content, duration:2})`），只改 import。测试里 `vi.mock("@douyinfe/semi-ui")` 的改为 mock `@/lib/toast` |
| `Notification` | `@/lib/toast` 的 `Notification` | `Notification.open({id, content, duration})` / `Notification.close(id)` 签名相同（常驻提示 duration 默认 Infinity） |
| `Switch` | `@/components/ui/switch` | `checked` + `onCheckedChange(checked:boolean)`；`size="small"` 用 `className="scale-90"` 或默认尺寸 |
| `Checkbox` | `@/components/ui/checkbox` | `checked` + `onCheckedChange(checked:boolean|'indeterminate')`，一般接 `(v)=>set(v===true)` |
| `Radio/RadioGroup` | `@/components/ui/radio-group` | `<RadioGroup value onValueChange className="flex gap-3"><Radio value="a"/>…` 或 `<label className="flex items-center gap-1.5"><Radio/><span>文字</span></label>` |
| `Slider` | `@/components/ui/slider` | value 是**数组**：`value={[v]} onValueChange={(arr)=>set(arr[0])}`；`min/max/step` 相同 |
| `Tabs` | `@/components/ui/tabs` | `<Tabs value onValueChange><TabsList><TabsTrigger value="a">…</TabsTrigger></TabsList><TabsContent value="a">…`；Semi 的 `tabBar`/`tabPaneMotion` 等装饰性 props 直接丢弃 |
| `Collapse` | `@/components/ui/collapsible` | Semi `<Collapse><Collapse.Panel header itemKey>` → 每组一个受控 `<Collapsible open onOpenChange><CollapsibleTrigger>header+chevron</CollapsibleTrigger><CollapsibleContent>children</CollapsibleContent></Collapsible>`；展开态用父级 `useState<Set<string>>` 管理。默认全展开的照旧初始全开 |
| `Dropdown` | `@/components/ui/dropdown-menu` | `<DropdownMenu><DropdownMenuTrigger render={<span/>}><DropdownMenuContent align="end"><DropdownMenuItem onClick={…}>…`；Base UI **没有 asChild，一律用 `render={<X/>}`**；Item 用 `onClick` 不是 onSelect |
| `Popover` | `@/components/ui/popover` | trigger 组合同上用 `render`；`position="bottomRight"` → `align="end"` |
| `Tooltip` | `@/components/ui/tooltip` | `<Tooltip content="…"><TooltipTrigger render={<X/>}/></Tooltip>`（app 根已有 TooltipProvider） |
| `Tag` | `@/components/ui/badge` | variant 按语义 default/secondary/destructive/outline；色彩微调用 className |
| `Table` (SemiTable) | `@/components/ui/table` | 只用 Table/TableHeader/TableBody/TableRow/TableHead/TableCell 手写；分页等 Semi 功能手工实现或省略 |
| `Skeleton` | `@/components/ui/skeleton` | `<Skeleton className="h-… w-…"/>` 替代 `<Skeleton.Image/Placeholder>` |
| `Empty` | `@/components/ui-ext/empty` | 只用 description |
| `Avatar` | `@/components/ui/avatar` | |
| `Layout`/`Nav` | 原生 div + tailwind | Layout/Nav 在本项目只是布局壳，直接换语义化 div（`<aside>`/`<nav>`/`<header>`），类名沿用原有 |
| `Tree` (LeftPanel 场景树) | 自实现 | 不引第三方；用递归 div + Collapsible/chevron 实现，保留 drag-reparent（HTML5 DnD）与右键 |
| `Upload` | 原生实现 | `<input type="file" hidden ref>` + Button 触发 `ref.current.click()`，onChange 读 `event.target.files` |
| `Cascader` | DropdownMenu/Popover 手写 | 按实际数据层级用 DropdownMenuSub 或 Popover 两级列表 |
| `Progress` | `@/components/ui/progress` | `value` 是 0–100 数字 |

## 硬性约定

1. **Base UI 而非 Radix**：组合/替换元素一律 `render={<X/>}`（无 asChild）；回调名以各 ui/*.tsx 实际签名为准（select/slider/radio/tabs 用 `onValueChange`，switch/checkbox 用 `onCheckedChange`，dialog/popover/dropdown 用 `onOpenChange`，menu item 用 `onClick`）。
2. **弹层宽度**：Semi 默认撑满父宽的下拉，迁移后给 SelectTrigger/弹层显式 `className="w-full"`。
3. **Toast 顶部偏移**：Toaster 已在 App 根挂载（WorkspacePage 顶部居中提示也走 sonner）。
4. **保留业务类名**：`property-field`、`property-color-trigger` 等项目既有 CSS 钩子类名一律保留（app.css 依赖）。
5. **不要**引任何新第三方依赖；图标继续用 @icon-park/react，不用 lucide（lucide 仅限 ui/ 内部）。
6. **import 路径**：ui 组件 `@/components/ui/xxx`；扩展组件 `@/components/ui-ext/xxx`；toast shim `@/lib/toast`。
7. `cn()` 从 `"cn"` 包 import（utils.ts 已 re-export），与 ui/ 内部一致。
