import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import WidgetProperties from "../components/WidgetProperties";
import KitProperties, { KitOptionValue } from "../components/KitProperties";
import { kitCatalog, kitNodes } from "../data/kitCatalog";
import { kitOptionDefinition } from "../data/kitOptionSchema";
import { chartCatalog, chartPaletteNode } from "../data/chartCatalog";
import type { SceneNode } from "../types";

vi.mock("../state/store", () => ({ useStore: () => ({ scene: [], liveData: {} }) }));
vi.mock("../workers/bridge", () => ({ getSceneBridge: () => ({ post: vi.fn() }) }));
vi.mock("../engine/exportBoard", () => ({ captureWidgetCover: vi.fn() }));
vi.mock("@icon-park/react", () => ({ Camera: () => null, Delete: () => null, Lock: () => null, Unlock: () => null }));
vi.mock("@douyinfe/semi-ui", async () => {
  const { createElement } = await import("react");
  const element = ({ children }: { children?: React.ReactNode }) => createElement("div", null, children);
  const collapse = Object.assign(element, { Panel: ({ header, children }: {
    header: React.ReactNode; children?: React.ReactNode;
  }) => createElement("div", null, createElement("span", null, header), children) });
  const dropdown = Object.assign(element, { Menu: element, Item: element });
  const colorPicker = Object.assign(element, { colorStringToValue: (value: string) => ({ hex: value }) });
  return { Cascader: element, Collapse: collapse, Button: element, Input: element, InputNumber: element,
    Select: element, Switch: element, Tag: element, TextArea: element, Radio: element, RadioGroup: element,
    Dropdown: dropdown, Modal: element, Slider: element, ColorPicker: colorPicker,
    Toast: { info: vi.fn(), error: vi.fn(), warning: vi.fn() } };
});

describe("图表属性菜单", () => {
  it("天气选项关闭后仍能重新开启，Key 列表可逐项编辑", () => {
    const [node] = kitNodes(kitCatalog[0]!, { type: "widget.basic.weather-v2", options: {
      icon: false, temperature: false, wind: false, "weather-name": false, "map-key": [""],
    } });
    const html = renderToStaticMarkup(createElement(KitProperties, { node: node! }));
    expect(html.match(/>启用</g)).toHaveLength(4);
    expect(html).toContain('aria-label="删除Key第1项"');
    expect(html).toContain("添加Key");
    expect(html).toContain('aria-label="天气信息"');
    expect(html).toContain('aria-label="风向"');
    expect(html).toContain('aria-label="上传热带风暴图标"');
    const [search] = kitNodes(kitCatalog[0]!, { type: "widget.basic.search", options: { "text-arrangement": "horizontal" } });
    expect(renderToStaticMarkup(createElement(KitProperties, { node: search! }))).toContain("文本排列");
  });

  it("按钮样式按原站四种状态及文字、发光、边框、背景分组", () => {
    const [node] = kitNodes(kitCatalog[0]!, { type: "widget.basic.button-v2", options: { "show-hover": false } });
    const html = renderToStaticMarkup(createElement(KitProperties, { node: node! }));
    expect(html).toContain('role="tablist" aria-label="按钮样式状态"');
    for (const label of ["默认", "点击时", "悬停时", "选中后", "文字样式", "文字发光", "边框样式", "背景样式"])
      expect(html).toContain(`>${label}<`);
    expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>默认<\/button>/);
    expect(html).not.toContain("启用悬停");
    expect(kitOptionDefinition("text-hover-position", "left", "widget.basic.button-v2")).toMatchObject({
      type: "select", options: [{ value: "left" }, { value: "center" }, { value: "right" }],
    });
    expect(kitOptionDefinition("text-hover-vertical", "end", "widget.basic.button-v2").options?.map(option => option.value))
      .toEqual(["start", "center", "end"]);
  });
  it("空的层级字段配置仍可添加选项", () => {
    const html = renderToStaticMarkup(createElement(KitOptionValue, { label: "按层级设置联动字段名",
      optionKey: "json-node-linkage-fields", value: [],
      definition: { label: "按层级设置联动字段名", group: "字段设置", type: "text" },
      onChange: () => {} }));
    expect(html).toContain("添加一项");
    const populated = renderToStaticMarkup(createElement(KitOptionValue, { label: "按层级设置联动字段名",
      optionKey: "json-node-linkage-fields", value: ["省份", "城市"], onChange: () => {} }));
    expect(populated).toContain('aria-label="调整按层级设置联动字段名第1项顺序"');
    expect(populated).toContain('aria-label="删除按层级设置联动字段名第2项"');
  });
  it("树形字段仅在 JSON 与对应中间节点开关启用时出现", () => {
    const make = (options: Record<string, unknown>) => kitNodes(kitCatalog[0]!, {
      type: "widget.basic.dropdown-v2", options: { "dropdown-option-setting": "data", ...options },
    })[0]!;
    const render = (options: Record<string, unknown>) => renderToStaticMarkup(createElement(KitProperties,
      { node: make(options), section: "data" }));
    expect(render({})).not.toContain("允许中间节点联动");
    expect(render({ "use-json-type": true })).toContain("允许中间节点联动");
    expect(render({ "use-json-type": true })).not.toContain("按层级设置联动字段名");
    const enabled = render({ "use-json-type": true, "use-json-node-linkage": true,
      "use-json-node-selection": true });
    expect(enabled).toContain("按层级设置联动字段名");
    expect(enabled).toContain("按层级设置选中字段名");
  });
  it("菜单自定义选项以可直接编辑和排序的行展示", () => {
    const [node] = kitNodes(kitCatalog[0]!, { type: "widget.group.buttons-v2", options: {
      "button-option-setting": "custom", "button-name-option": ["甲", "乙", "丙"],
    } });
    const html = renderToStaticMarkup(createElement(KitProperties, { node: node! }));
    expect(html).toContain('class="kit-choice-list"');
    expect(html).toContain('aria-label="调整菜单选项第1项顺序"');
    expect(html).toContain('aria-label="删除菜单选项第3项"');
    expect(html).toContain('draggable="true"');
  });
  it("菜单滚动条样式仅在滚动布局并开启滚动条时显示", () => {
    const render = (options: Record<string, unknown>) => {
      const [node] = kitNodes(kitCatalog[0]!, { type: "widget.group.buttons-v2", options });
      return renderToStaticMarkup(createElement(KitProperties, { node: node! }));
    };
    expect(render({ "layout-setting": "classic" })).not.toContain("滚动条粗细");
    expect(render({ "layout-setting": "scroll", "show-scrollbar": false })).not.toContain("滚动条粗细");
    const shown = render({ "layout-setting": "scroll", "show-scrollbar": true });
    expect(shown).toContain("滚动条粗细");
    expect(shown).toContain("滚动条颜色");
    expect(shown).toContain("滚动条背景色");
  });
  it("按参考界面分隔文本字体设置并隐藏不适用的流式布局项", () => {
    const [node] = kitNodes(kitCatalog[0]!, { type: "widget.basic.text", options: {
      text: "示例", "text-font": { family: "sans-serif", size: 26, bold: true },
    } });
    const html = renderToStaticMarkup(createElement(KitProperties, { node: node! }));
    expect(html).toContain('role="tablist" aria-label="字体设置类型"');
    expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>样式<\/button>/);
    expect(html).toMatch(/role="tab" aria-selected="false"[^>]*>发光<\/button>/);
    expect(html).toMatch(/role="tab" aria-selected="false"[^>]*>投影<\/button>/);
    expect(html).toContain("文字缩进");
    expect(html).toContain('aria-label="字体颜色"');
    expect(html).toContain('aria-label="字体倾斜"');
    expect(html).toContain('aria-label="字体下划线"');
    expect(html).toContain('aria-label="字体删除线"');
    expect(html).not.toContain("外发光颜色");
    expect(html).not.toContain("投影颜色");
    expect(html).not.toContain("流式布局宽度");
    expect(html).not.toContain("内部组件布局");
  });

  it("在套件数据菜单中显示已有的动态字段绑定", () => {
    const binding = { uid: ["c_private", "t_private", "name"], summary: "none" };
    const [node] = kitNodes(kitCatalog[0]!, { type: "widget.basic.text", options: {
      text: "示例", "related-entries": [{ name: '["text"]', alias: "显示文本" }],
      "related-fields": { '["text"]': { "related-field": [binding] } },
    }, privateData: { fields: [{ uid: "name", alias: "名称" }], rows: [{ name: "示例" }] } });
    const html = renderToStaticMarkup(createElement(KitProperties, { node: node!, section: "data" }));
    expect(html).toContain("动态数据字段");
    expect(html).toContain("显示文本");
    expect(html).toContain("移除此绑定");
  });

  it("按原站分开显示发出和接收联动的高级名单", () => {
    const [node] = kitNodes(kitCatalog[0]!, { type: "widget.basic.text", options: {
      "linkage-out": true, "linkage-in": true, "linkage-advanced": true,
      "linkage-advanced-settings": {
        "linkage-out": { "linkage-mode": "whitelist", "linkage-elements": [] },
        "linkage-in": { "linkage-mode": "blacklist", "linkage-elements": [] },
      },
    } });
    const html = renderToStaticMarkup(createElement(KitProperties, { node: node!, section: "data" }));
    expect(html).toContain('role="tablist" aria-label="联动组件选择方向"');
    expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>联动其他组件<\/button>/);
    expect(html).toMatch(/role="tab" aria-selected="false"[^>]*>受其他组件联动<\/button>/);
    expect(html).toContain("白名单模式");
    expect(html).not.toContain("linkage-advanced-settings");
  });

  it("表格选中传递使用可操作的中文开关和字段设置", () => {
    const [node] = kitNodes(kitCatalog[0]!, { type: "widget.basic.table-v3", options: { "selection-in": true } });
    const html = renderToStaticMarkup(createElement(KitProperties, { node: node!, section: "data" }));
    expect(html).toContain("选中传递");
    expect(html).toContain("接收其他组件传递");
    expect(html).toContain("选中字段");
    expect(html).not.toContain("selection-in");
  });

  it("在属性面板直接显示图表分组，并按参考顺序排列", () => {
    const preset = chartPaletteNode(chartCatalog.find(item => item.label === "基础平滑折线图3")!);
    const node = { id: "chart", visible: true, locked: false, parentId: null, ...preset } as SceneNode;
    const html = renderToStaticMarkup(createElement(WidgetProperties, { node }));
    const groups = ["基本设置", "颜色", "图形文本", "图形形状", "辅助线", "缩略轴", "轴", "图例", "提示信息", "大小&位置"];
    const positions = groups.map(group => html.indexOf(`>${group.replace("&", "&amp;")}</span>`));
    expect(groups.filter((_, index) => positions[index] < 0)).toEqual([]);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html).not.toContain(">图表配置</span>");
    expect(html).not.toContain(">组件内容</span>");
    expect(html).toContain('role="tablist" aria-label="图形文本类型"');
    expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>折线文本<\/button>/);
    expect(html).toMatch(/role="tab" aria-selected="false"[^>]*>右轴折线文本<\/button>/);
    expect(html).toMatch(/role="tab" aria-selected="false"[^>]*>\s*排名文本<\/button>/);
    expect(html).toContain("两侧留白");
    expect(html).toContain("去除零值");
    expect(html).toContain("每条折线独立设置");
    expect(html).toContain("每条流光独立设置");
    expect(html).toContain("显示样式");
    expect(html).toContain("数据点阴影模糊程度");
    expect(html).toContain('role="tablist" aria-label="坐标轴类型"');
    expect(html).toContain('role="tablist" aria-label="提示信息设置"');
    expect(html).toContain("数据格式");
    expect(html).toContain("文字样式");
    expect(html).toContain("单位名称");
    expect(html).toContain("辅助线设置");
    expect(html).toContain("图例文字间距");
    expect(html).toContain("图例发光程度");
    expect(html).toContain("X 轴刻度字体");
    expect(html).toContain("X 轴字体过长策略");
    expect(html).toContain("X 轴外发光程度");
    expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>X轴<\/button>/);
    expect(html).toMatch(/role="tab" aria-selected="false"[^>]*>右侧Y轴<\/button>/);
    const axisGroups = ["轴线", "刻度线", "刻度值", "轴名称", "网格线"];
    const axisPositions = axisGroups.map(group => html.indexOf(`>${group}</span>`));
    expect(axisGroups.filter((_, index) => axisPositions[index] < 0)).toEqual([]);
    expect(axisPositions).toEqual([...axisPositions].sort((a, b) => a - b));
  });

  it("在普通条形图的数值轴中提供范围设置，区间图不显示未实现的范围", () => {
    const render = (label: string) => {
      const preset = chartPaletteNode(chartCatalog.find(item => item.label === label)!);
      const node = { id: label, visible: true, locked: false, parentId: null, ...preset } as SceneNode;
      return renderToStaticMarkup(createElement(WidgetProperties, { node }));
    };
    expect(render("T型分组条形图")).toContain("X 轴刻度范围");
    expect(render("基础区间条形图")).not.toContain("X 轴刻度范围");
    expect(render("T型分组条形图")).toContain("排名文本");
    expect(render("基础区间条形图")).not.toContain("排名文本");
  });

  it("在辅助线中显示虚线、文字颜色和文字偏移设置", () => {
    const preset = chartPaletteNode(chartCatalog.find(item => item.label === "基础折线图")!);
    const node = { id: "reference", visible: true, locked: false, parentId: null, ...preset,
      data: { ...preset.data, chart: { ...(preset.data?.chart as object), referenceLines: [
        { value: 5, style: "dashed", name: "目标", textOffset: [8, -6] },
      ] } } } as SceneNode;
    const html = renderToStaticMarkup(createElement(WidgetProperties, { node }));
    for (const label of ["虚线宽度", "文本颜色", "文本偏移 X", "文本偏移 Y"]) expect(html).toContain(label);
  });

  it("在自定义数值轴范围时提供刻度间隔设置", () => {
    const preset = chartPaletteNode(chartCatalog.find(item => item.label === "T型分组条形图")!);
    const node = { id: "interval", visible: true, locked: false, parentId: null, ...preset,
      data: { ...preset.data, chart: { ...(preset.data?.chart as object), axisRangeModeX: "custom",
        axisMinX: -50, axisMaxX: 100, axisIntervalModeX: "value", axisIntervalX: 25 } } } as SceneNode;
    const html = renderToStaticMarkup(createElement(WidgetProperties, { node }));
    expect(html).toContain("刻度间隔方式");
    expect(html).toContain("轴刻度间隔");
  });

  it("在套件图表中显示排名开关，并随开关展开其配置", () => {
    const preset = chartPaletteNode(chartCatalog.find(item => item.label === "基础折线图")!);
    const render = (enabled: boolean) => {
      const node = { id: "kit-chart", visible: true, locked: false, parentId: null, ...preset,
        data: { ...preset.data, __kit: { templateId: "kit", familyId: "chart", familyLabel: "图表", label: "折线图",
          source: { type: "widget.echarts.line", options: { "ranking-text": enabled } } } } } as SceneNode;
      return renderToStaticMarkup(createElement(KitProperties, { node }));
    };
    const disabled = render(false);
    expect(disabled).toContain("排名文本");
    expect(disabled).toContain('role="tablist" aria-label="提示信息设置"');
    expect(disabled).toContain('role="tablist" aria-label="坐标轴类型"');
    expect(disabled).toMatch(/role="tab" aria-selected="false"[^>]*>右侧Y轴<\/button>/);
    expect(disabled).not.toContain(">deleteline<");
    expect(disabled).not.toContain("距图形距离");
    const enabled = render(true);
    expect(enabled).toContain("距图形距离");
    expect(enabled).toContain("文本模板");
    expect(enabled).toContain("文字背景宽度");
    expect(enabled).not.toContain("文字背景图片");
  });

  it("在翻页图例模式下提供按钮外观设置", () => {
    const preset = chartPaletteNode(chartCatalog.find(item => item.label === "基础饼状图")!);
    const node = { id: "pie", visible: true, locked: false, parentId: null, ...preset,
      data: { ...preset.data, chart: { ...(preset.data?.chart as object), showLegend: true, legendType: "scroll" } } } as SceneNode;
    const html = renderToStaticMarkup(createElement(WidgetProperties, { node }));
    expect(html).toContain("图例类型");
    expect(html).toContain("翻页按钮大小");
    expect(html).toContain("翻页按钮文字字体");
    expect(html).toContain("按钮和文字间隔");
    expect(html).toContain("禁止翻页颜色");
    expect(html).toContain("左侧背景图片");
    expect(html).toContain("右侧背景图片");
  });
});
