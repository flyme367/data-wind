# 3D 分类同步（锦绣孪生）

## 2026-11-02：从山海鲸同步「3D → 鲸孪生」子页签

对照山海鲸编辑器「3D」素材分类的子页签（全部 / 鲸孪生 / 3D图表），在看板组件库「3D」分类补齐中间的孪生子库。「鲸孪生」为山海鲸自有品牌名，本地按用户定名改为**锦绣孪生**。

## 交互设计

- 「3D」面板 chips 顺序对齐山海鲸：全部 / 锦绣孪生 / 3D图表；「全部」按 锦绣孪生 → 3D图表 两区块展示。
- 锦绣孪生收录项目已有的孪生场景模板（`data/catalog.ts` 的 `twinCatalog`，引用 `templates` 数据）：空白地面3D场景、参考 GIS · 地理图层、建筑底座场景A/B、工厂底座场景、科技风3D城市、产品展示3D场景、产品展示示例、管道3D场景示例、楼层分层动画示例、二维孪生示例，另附本地自研的智慧园区 / 参考模型 · 智慧园区 / 参考地表样板。
- 卡片用模板预览图（object-fit: cover），点击走既有 `appendScene` worker 操作整组插入画布（与「场景」素材库一致，可撤销）；空场景插入后为空地面。非 WidgetKind，无需 Rust 侧改动。
- 侧栏「3D」与「全部」计数纳入锦绣孪生条目（`boardCategoryCounts`）。

## 主要实现

- `frontend/src/data/catalog.ts`：新增 `twinCatalog`（按模板 id 从 `templates` 取数据）。
- `frontend/src/components/BoardComponents.tsx`：`TwinCard`、`Chart3dPalette` 三页签改造、「全部」视图加锦绣孪生区块、计数更新。
- `frontend/src/styles/app.css`：`.twin-thumb-img`。
- `frontend/src/tests/twinCatalog.test.ts`：目录有效性、id/名称唯一、每个模板可 `createTemplateScene`。
