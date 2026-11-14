# 模型分类与资源扩展验证

2026-10-31：增加 158 个本地模型资源，其中 76 个来自 3D Assets 的医院主题 CC0 素材包，82 个来自 Kenney CC0 素材包。加上已有资源，现有 205 个本地模型（含地表和 GIS 轮廓）。医院素材由 AI 生成，目录中保留标识与逐项来源。

模型素材面板使用 Semi Design 的导航、树、输入框与按钮；按医疗、植被、建筑、交通、家具等分级浏览，并根据真实目录统计数量。医院模型可进一步筛选病房护理、影像诊疗、手术设备等分类。模型网格在场景实际使用时才从本地加载，失败后可以重试。

验证结果：

- `pnpm test`：28 项通过，包含分类层级和按需加载、请求去重与失败重试。
- `pnpm build`：TypeScript 检查和生产构建通过。
- `cargo test -p native-probe --tests`：9 项通过，包含全部 205 份模型网格、预览和源 GLB 对应关系及有限顶点检查。
- `cargo fmt --all -- --check`：通过。
- 浏览器实测：展开和筛选医疗设备，搜索“核磁”和“医疗设备”，点击添加核磁模型；拖入病床后删除，再撤销恢复，WebGPU 渲染正常。

资源来源、授权和重新生成方式见 [`frontend/public/models/ATTRIBUTION.md`](../frontend/public/models/ATTRIBUTION.md)。预览见 [`artifacts/model-library-categories.webp`](../artifacts/model-library-categories.webp)。
