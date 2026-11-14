import { beforeEach, describe, expect, it } from "vitest";
import { chartCatalog, chartPaletteNode } from "../data/chartCatalog";
import { widgetNode } from "../data/editor";
import { chartSvg } from "../data/chartSvg";
import type { SceneNode } from "../types";
import { boardHasMotion, boardNodes } from "../engine/boardScene";
import { handle } from "../workers/sceneModel";
import { parseProjectFile } from "../state/projects";
import { resolveRuntimeNode } from "../data/runtimeScene";
import { applyInteractionSettings, currentSettingValue, settingsForTargets } from "../data/interactionSettings";

beforeEach(() => handle({ type: "openProject", projectId: "chart-test", tree: [], template: "empty" }));

describe("chart presets and per-instance configuration", () => {
  it("keeps palette names unique and inserts the requested series preset", () => {
    expect(chartCatalog).toHaveLength(85);
    expect(new Set(chartCatalog.map(entry => entry.label)).size).toBe(chartCatalog.length);
    const entry = chartCatalog.find(item => item.label === "基础平滑折线图3")!;
    const node = chartPaletteNode(entry);
    expect(node.name).toBe(entry.label);
    expect(node.data?.chart).toMatchObject({ seriesCount: 3 });
    const rows = node.data?.rows;
    expect(Array.isArray(rows) && rows.every(row => "value2" in row && "value3" in row)).toBe(true);
  });

  it("creates usable previews for every preset and schedules only enabled animated charts", () => {
    for (const entry of chartCatalog) {
      const node = chartPaletteNode(entry) as SceneNode;
      const svg = chartSvg(node);
      expect(svg, entry.label).not.toMatch(/NaN|Infinity/);
      expect(svg.length, entry.label).toBeGreaterThan(0);
    }
    for (const label of ["动态条形图", "路径动画"]) {
      const node = { id: label, visible: true, locked: false, parentId: null,
        ...chartPaletteNode(chartCatalog.find(entry => entry.label === label)!) } as SceneNode;
      const [rendered] = boardNodes([node]);
      expect(boardHasMotion(rendered)).toBe(true);
      rendered.data = { ...rendered.data, chart: { ...(rendered.data.chart as object), playAnimation: false } };
      expect(boardHasMotion(rendered)).toBe(false);
    }
    const flow = { id: "flow", visible: true, locked: false, parentId: null,
      ...chartPaletteNode(chartCatalog.find(entry => entry.label === "基础折线图2")!) } as SceneNode;
    const [rendered] = boardNodes([flow]);
    rendered.data = { ...rendered.data, chart: { ...(rendered.data.chart as object), flowEnabled: true,
      flowStyles: [{ enabled: true, duration: 10 }] } };
    expect(boardHasMotion(rendered)).toBe(true);
    Object.assign(rendered.data.chart as object, { categoryVisibilityMode: "custom", visibleCategoryCount: 0 });
    expect(boardHasMotion(rendered)).toBe(false);
    (rendered.data.chart as Record<string, unknown>).visibleCategoryCount = 2;
    expect(boardHasMotion(rendered)).toBe(true);
    (rendered.data.chart as Record<string, unknown>).playAnimation = false;
    expect(boardHasMotion(rendered)).toBe(false);
  });

  it("merges quick edits, isolates charts, and preserves options through undo and export", () => {
    const first = handle({ type: "add", node: chartPaletteNode(chartCatalog[0]) })!.selectedId!;
    const second = handle({ type: "add", node: chartPaletteNode(chartCatalog[0]) })!.selectedId!;
    handle({ type: "patchChart", id: first, patch: { showGrid: false } });
    const updated = handle({ type: "patchChart", id: first, patch: { barWidth: 20 } })!;
    expect(updated.tree.find(node => node.id === first)?.data?.chart).toMatchObject({ showGrid: false, barWidth: 20 });
    expect(updated.tree.find(node => node.id === second)?.data?.chart).not.toHaveProperty("barWidth");
    const imported = parseProjectFile(JSON.stringify({ scene: updated.tree })).scene;
    expect(imported.find(node => node.id === first)?.data?.chart).toMatchObject({ showGrid: false, barWidth: 20 });
    const undone = handle({ type: "undo" })!;
    expect(undone.tree.find(node => node.id === first)?.data?.chart).toMatchObject({ showGrid: false });
    expect(undone.tree.find(node => node.id === first)?.data?.chart).not.toHaveProperty("barWidth");
  });

  it("preserves independent grids and reference lines through export and undo", () => {
    const id = handle({ type: "add", node: chartPaletteNode(chartCatalog[0]) })!.selectedId!;
    const lines = [{ name: "目标", value: 20, color: "#ff0000", width: 2, style: "dashed" }];
    const conditions = [{ field: "value", operator: "gte", value: "60", series: "1", color: "#ff0000" }];
    handle({ type: "patchChart", id, patch: { showGridX: true, showGridY: false, colorConditions: conditions } });
    const updated = handle({ type: "patchChart", id, patch: { referenceLines: lines } })!;
    const imported = parseProjectFile(JSON.stringify({ scene: updated.tree })).scene;
    expect(imported.find(node => node.id === id)?.data?.chart).toMatchObject({
      showGridX: true, showGridY: false, referenceLines: lines, colorConditions: conditions,
    });
    const undone = handle({ type: "undo" })!;
    expect(undone.tree.find(node => node.id === id)?.data?.chart).toMatchObject({ showGridX: true, showGridY: false, colorConditions: conditions });
    expect(undone.tree.find(node => node.id === id)?.data?.chart).not.toHaveProperty("referenceLines");
  });

  it("stores the initial data zoom range per chart through export, state and undo", () => {
    const id = handle({ type: "add", node: chartPaletteNode(chartCatalog[0]) })!.selectedId!;
    handle({ type: "patchChart", id, patch: { showDataZoom: true, zoomStart: 20, zoomEnd: 80 } });
    const edited = handle({ type: "patchChart", id, patch: { zoomHeight: 22 } })!;
    const restored = parseProjectFile(JSON.stringify({ scene: edited.tree })).scene[0];
    expect(restored.data?.chart).toMatchObject({ showDataZoom: true, zoomStart: 20, zoomEnd: 80, zoomHeight: 22 });
    const options = settingsForTargets([restored]).map(item => item.key);
    expect(options).toEqual(expect.arrayContaining(["data.chart.showDataZoom", "data.chart.zoomStart", "data.chart.zoomEnd"]));
    handle({ type: "widgetStates", id, states: [{ id: "small", name: "局部", patch: {} }] });
    const state = handle({ type: "patchChartState", id, stateId: "small", patch: { zoomStart: 40 } })!.tree[0];
    expect(resolveRuntimeNode(state, {}, { [id]: { stateId: "small" } }).data?.chart)
      .toMatchObject({ showDataZoom: true, zoomStart: 40, zoomEnd: 80 });
    expect(handle({ type: "undo" })!.tree[0].data?.chartStates).not.toMatchObject({ small: { zoomStart: 40 } });
  });

  it("preserves graphic text settings through export and undo", () => {
    const entry = chartCatalog.find(item => item.label === "T型分组条形图")!;
    const id = handle({ type: "add", node: chartPaletteNode(entry) })!.selectedId!;
    handle({ type: "patchChart", id, patch: { showLabels: true, labelPosition: "inside",
      labelOffsetX: 8, labelSpacing: -10, labelShowCategory: true, labelFormat: "percent" } });
    const edited = handle({ type: "patchChart", id, patch: { labelTilt: 45 } })!;
    const restored = parseProjectFile(JSON.stringify({ scene: edited.tree })).scene[0];
    expect(restored.data?.chart).toMatchObject({ showLabels: true, labelPosition: "inside", labelOffsetX: 8,
      labelSpacing: -10, labelShowCategory: true, labelFormat: "percent", labelTilt: 45 });
    const undone = handle({ type: "undo" })!.tree[0];
    expect(undone.data?.chart).not.toHaveProperty("labelTilt");
    expect(undone.data?.chart).toMatchObject({ labelPosition: "inside", labelOffsetX: 8, labelSpacing: -10 });
  });

  it("preserves ranking options and exposes them only on supported charts", () => {
    const entry = chartCatalog.find(item => item.label === "T型分组条形图")!;
    const id = handle({ type: "add", node: chartPaletteNode(entry) })!.selectedId!;
    const ranking = { showRanking: true, rankingDisplay: "custom", rankingCount: 2,
      rankingBackground: "image", rankingBackgroundImage: "data:image/png;base64,AA==", rankingTemplate: "第{}名" };
    const edited = handle({ type: "patchChart", id, patch: ranking })!;
    const restored = parseProjectFile(JSON.stringify({ scene: edited.tree })).scene[0];
    expect(restored.data?.chart).toMatchObject(ranking);
    expect(settingsForTargets([restored]).map(item => item.key)).toEqual(expect.arrayContaining([
      "data.chart.showRanking", "data.chart.rankingDisplay", "data.chart.rankingBackgroundImage",
    ]));
    const unsupported = { id: "range", visible: true, locked: false, parentId: null,
      ...chartPaletteNode(chartCatalog.find(item => item.label === "基础区间条形图")!) } as SceneNode;
    expect(settingsForTargets([unsupported]).map(item => item.key)).not.toContain("data.chart.showRanking");
    expect(handle({ type: "undo" })!.tree[0].data?.chart).not.toHaveProperty("showRanking");
  });

  it("persists independent signed-axis ranges through export, state and undo", () => {
    const entry = chartCatalog.find(item => item.label === "基础平滑折线图3")!;
    const id = handle({ type: "add", node: chartPaletteNode(entry) })!.selectedId!;
    const patch = { rightAxisStart: 2, axisRangeModeY: "custom", axisMinY: -40, axisMaxY: 80,
      rightAxisRangeMode: "custom", rightAxisMin: -1, rightAxisMax: 1 };
    const configured = handle({ type: "patchChart", id, patch })!;
    const restored = parseProjectFile(JSON.stringify({ scene: configured.tree })).scene[0];
    expect(restored.data?.chart).toMatchObject(patch);
    handle({ type: "widgetStates", id, states: [{ id: "expanded", name: "放大", patch: {} }] });
    const state = handle({ type: "patchChartState", id, stateId: "expanded", patch: { axisMinY: -80 } })!.tree[0];
    expect(resolveRuntimeNode(state, {}, { [id]: { stateId: "expanded" } }).data?.chart)
      .toMatchObject({ ...patch, axisMinY: -80 });
    expect(handle({ type: "undo" })!.tree[0].data?.chartStates).not.toMatchObject({ expanded: { axisMinY: -80 } });
    expect(handle({ type: "undo" })!.tree[0].data?.chart).toMatchObject(patch);
  });

  it("keeps dual-axis line text independent from column text", () => {
    const entry = chartCatalog.find(item => item.label === "基础分组双轴图")!;
    const id = handle({ type: "add", node: chartPaletteNode(entry) })!.selectedId!;
    const configured = handle({ type: "patchChart", id, patch: {
      showLabels: true, showLineLabels: false, lineLabelSize: 18, lineLabelPosition: "top",
    } })!.tree[0];
    const options = settingsForTargets([configured]);
    expect(currentSettingValue(configured, options.find(item => item.key === "data.chart.showLineLabels")!)).toBe(false);
    const runtime = {};
    const rule = { id: "line-label", event: "itemClick", action: "modify", targetId: id, value: "{}",
      settingKey: "data.chart.showLineLabels", settingSource: { type: "component", field: "enabled" } } as const;
    expect(applyInteractionSettings(rule, configured, [configured], runtime, {}, { enabled: true })).toBe("changed");
    expect(resolveRuntimeNode(configured, {}, runtime).data?.chart).toMatchObject({
      showLabels: true, showLineLabels: true, lineLabelSize: 18, lineLabelPosition: "top",
    });
    expect(configured.data?.chart).toMatchObject({ showLabels: true, showLineLabels: false });
  });

  it("keeps chart style when static or live data is replaced", () => {
    const id = handle({ type: "add", node: chartPaletteNode(chartCatalog[0]) })!.selectedId!;
    handle({ type: "patchChart", id, patch: { barWidth: 17 } });
    const node = handle({ type: "setStaticData", id, data: { rows: [{ name: "A", value: 9 }] } })!.tree[0];
    expect(node.data?.chart).toMatchObject({ barWidth: 17 });
    const live = resolveRuntimeNode(node, { [id]: { rows: [{ name: "B", value: 5 }], chart: { barWidth: 90 } } }, {});
    expect(live.data?.chart).toMatchObject({ barWidth: 17 });
    expect(live.data?.rows).toEqual([{ name: "B", value: 5 }]);
  });

  it("applies bound and interactive colors over an explicit series palette", () => {
    const id = handle({ type: "add", node: chartPaletteNode(chartCatalog[0]) })!.selectedId!;
    handle({ type: "patchChart", id, patch: { colors: ["#123456", "#abcdef"] } });
    const node = handle({ type: "patch", id, patch: { bindings: { color: "statusColor" } } })!.tree[0];
    const bound = resolveRuntimeNode(node, { [id]: { statusColor: "#ff0000" } }, {});
    expect(bound.data?.chart).toMatchObject({ colors: ["#ff0000", "#abcdef"] });
    const interactive = resolveRuntimeNode(node, { [id]: { statusColor: "#ff0000" } }, { [id]: { color: "#00ff00" } });
    expect(interactive.data?.chart).toMatchObject({ colors: ["#00ff00", "#abcdef"] });
    expect(node.data?.chart).toMatchObject({ colors: ["#123456", "#abcdef"] });
    const changed = handle({ type: "color", id, color: "#0000ff" })!.tree[0];
    expect(changed.data?.chart).toMatchObject({ colors: ["#0000ff", "#abcdef"] });
  });

  it("offers chart-specific settings and applies click values without changing the source scene", () => {
    const makeChart = (label: string): SceneNode => ({
      id: label, visible: true, locked: false, parentId: null,
      ...chartPaletteNode(chartCatalog.find(entry => entry.label === label)!),
    }) as SceneNode;
    const bars = makeChart("T型分组条形图");
    bars.data!.chart = { ...(bars.data!.chart as object), colors: ["#123456", "#6789ab", "#abcdef", "#fedcba"] };
    const gauge = makeChart("基础仪表盘");
    const flow = makeChart("基础桑基图");
    const dual = makeChart("基础分组双轴图");
    const line = makeChart("基础平滑折线图3");
    const pie = makeChart("基础饼状图");
    const scatter = makeChart("基础散点图");
    const barSettings = settingsForTargets([bars]);
    const gaugeSettings = settingsForTargets([gauge]);
    const flowSettings = settingsForTargets([flow]);
    expect(barSettings.map(item => item.key)).toContain("data.chart.barWidth");
    expect(barSettings.map(item => item.key)).toContain("data.chart.colors.1");
    expect(barSettings.map(item => item.key)).toEqual(expect.arrayContaining([
      "data.chart.showAxisLabelX", "data.chart.showAxisLineX", "data.chart.axisLineStyleX",
      "data.chart.showAxisTicksY", "data.chart.axisTickLengthY", "data.chart.gridStyleY",
      "data.chart.axisValueFormatX", "data.chart.axisDecimalsX", "data.chart.showAxisNameY",
      "data.chart.labelPosition", "data.chart.labelSpacing", "data.chart.hideZeroLabels",
      "data.chart.labelFormat", "data.chart.labelOffsetX", "data.chart.labelUnitSize",
      "data.chart.axisRangeModeX", "data.chart.axisMinX", "data.chart.axisMaxX",
    ]));
    expect(barSettings.map(item => item.key)).not.toContain("data.chart.axisValueFormatY");
    expect(barSettings.map(item => item.key)).not.toContain("data.chart.colors.2");
    expect(barSettings.map(item => item.key)).not.toContain("data.chart.gaugeWidth");
    expect(gaugeSettings.map(item => item.key)).toContain("data.chart.gaugeWidth");
    expect(flowSettings.map(item => item.key)).toContain("data.chart.linkOpacity");
    expect(settingsForTargets([dual]).map(item => item.key)).toEqual(expect.arrayContaining([
      "data.chart.showLineLabels", "data.chart.lineLabelPosition", "data.chart.lineLabelColor", "data.chart.lineLabelUnit",
      "data.chart.showRightAxis", "data.chart.showRightAxisName", "data.chart.showRightGrid",
    ]));
    expect(settingsForTargets([dual]).map(item => item.key)).not.toContain("data.chart.rightAxisStart");
    expect(barSettings.map(item => item.key)).not.toContain("data.chart.showLineLabels");
    expect(settingsForTargets([line]).map(item => item.key)).toEqual(expect.arrayContaining([
      "data.chart.rightAxisStart", "data.chart.showRightAxis", "data.chart.showLineLabels", "data.chart.lineLabelPosition",
      "data.chart.showRightAxisName", "data.chart.rightAxisName", "data.chart.showRightGrid", "data.chart.rightGridStyle",
      "data.chart.boundaryGap", "data.chart.axisRangeModeY", "data.chart.axisMinY", "data.chart.axisMaxY",
      "data.chart.rightAxisRangeMode", "data.chart.rightAxisMin", "data.chart.rightAxisMax",
      "data.chart.tooltipRightFormat", "data.chart.tooltipRightDecimals", "data.chart.tooltipRightUnit",
      "data.chart.tooltipShowVerticalPointer", "data.chart.tooltipPointerLabel", "data.chart.tooltipBackgroundImage",
    ]));
    expect(barSettings.map(item => item.key)).not.toContain("data.chart.boundaryGap");
    expect(settingsForTargets([dual]).map(item => item.key)).not.toContain("data.chart.boundaryGap");
    const lineRuntime = {};
    const boundaryRule = { id: "boundary", event: "itemClick", action: "modify", targetId: line.id, value: "{}",
      settingKey: "data.chart.boundaryGap", settingSource: { type: "component", field: "enabled" } } as const;
    expect(applyInteractionSettings(boundaryRule, line, [line], lineRuntime, {}, { enabled: false })).toBe("changed");
    expect(resolveRuntimeNode(line, {}, lineRuntime).data?.chart).toMatchObject({ boundaryGap: false });
    expect(line.data?.chart).not.toHaveProperty("boundaryGap");
    const axisRule = { ...boundaryRule, id: "axis-min", settingKey: "data.chart.axisMinY",
      settingSource: { type: "component", field: "minimum" } } as const;
    expect(applyInteractionSettings(axisRule, line, [line], lineRuntime, {}, { minimum: -40 })).toBe("changed");
    expect(resolveRuntimeNode(line, {}, lineRuntime).data?.chart).toMatchObject({ axisMinY: -40 });
    expect(barSettings.map(item => item.key)).not.toContain("data.chart.axisRangeModeY");
    expect(settingsForTargets([pie]).map(item => item.key)).toEqual(expect.arrayContaining([
      "data.chart.pieSize", "data.chart.labelFormat", "data.chart.legendPosition", "data.chart.tooltipPosition",
    ]));
    expect(settingsForTargets([pie]).map(item => item.key)).not.toContain("data.chart.tooltipShowVerticalPointer");
    expect(settingsForTargets([scatter]).map(item => item.key)).not.toContain("data.chart.xAxisFontSize");
    expect(settingsForTargets([scatter]).map(item => item.key)).not.toContain("data.chart.showAxisLineX");
    expect(currentSettingValue(gauge, gaugeSettings.find(item => item.key === "data.chart.startAngle")!)).toBe(135);
    const runtime = {};
    const rule = { id: "width", event: "itemClick", action: "modify", targetId: bars.id, value: "{}",
      settingKey: "data.chart.barWidth", settingSource: { type: "component", field: "value" } } as const;
    expect(applyInteractionSettings(rule, bars, [bars], runtime, {}, { value: 24 })).toBe("changed");
    expect(resolveRuntimeNode(bars, {}, runtime).data?.chart).toMatchObject({ barWidth: 24 });
    expect(bars.data?.chart).not.toHaveProperty("barWidth");
    const recolor = { ...rule, id: "color", settingKey: "data.chart.colors.1",
      settingSource: { type: "component", field: "color" } } as const;
    expect(applyInteractionSettings(recolor, bars, [bars], runtime, {}, { color: "#abcdef" })).toBe("changed");
    expect(resolveRuntimeNode(bars, {}, runtime).data?.chart).toMatchObject({
      barWidth: 24, colors: ["#123456", "#abcdef", "#abcdef", "#fedcba"],
    });
    const firstColor = { ...recolor, id: "color-first", settingKey: "data.chart.colors.0" };
    expect(applyInteractionSettings(firstColor, bars, [bars], runtime, {}, { color: "#ff0033" })).toBe("changed");
    bars.bindings = { color: "statusColor" };
    expect(resolveRuntimeNode(bars, { [bars.id]: { statusColor: "#000000" } }, runtime).data?.chart).toMatchObject({
      colors: ["#ff0033", "#abcdef", "#abcdef", "#fedcba"],
    });
  });

  it("keeps duplicated chart interactions pointed at the duplicate and retains external targets", () => {
    const id = handle({ type: "add", node: chartPaletteNode(chartCatalog[0]) })!.selectedId!;
    const external = handle({ type: "add", node: widgetNode("text") })!.selectedId!;
    handle({ type: "patch", id, patch: { interactions: [{
      id: "rule", event: "itemClick", action: "modify", targetId: id, targetIds: [id, external],
      settingKey: "text", value: '{"text":"已点击"}',
    }] } });
    const duplicated = handle({ type: "duplicate", id })!;
    const copy = duplicated.tree.find(node => node.id === duplicated.selectedId)!;
    expect(copy.id).not.toBe(id);
    expect(copy.interactions?.[0]).toMatchObject({ targetId: copy.id, targetIds: [copy.id, external] });
    expect(duplicated.tree.find(node => node.id === id)?.interactions?.[0].targetId).toBe(id);
  });

  it("keeps chart options independent for each state through data replacement and snapshot reload", async () => {
    const { decodeProjectSnapshot, encodeProjectSnapshot } = await import("../state/snapshotCodec");
    const id = handle({ type: "add", node: chartPaletteNode(chartCatalog[0]) })!.selectedId!;
    handle({ type: "patchChart", id, patch: { barWidth: 10, colors: ["#123456", "#abcdef"] } });
    handle({ type: "widgetStates", id, states: [{ id: "alert", name: "告警", patch: {} }] });
    const configured = handle({ type: "patchChartState", id, stateId: "alert",
      patch: { barWidth: 24, colors: ["#ff0000", "#00ff00"] } })!.tree[0];
    expect(configured.data?.chart).toMatchObject({ barWidth: 10, colors: ["#123456", "#abcdef"] });
    expect(resolveRuntimeNode(configured, {}, { [id]: { stateId: "alert" } }).data?.chart)
      .toMatchObject({ barWidth: 24, colors: ["#ff0000", "#00ff00"] });
    const runtime = { [id]: { stateId: "alert" } };
    const colorRule = { id: "color", event: "click", action: "modify", targetId: id,
      settingKey: "data.chart.colors.1", value: "{}", settingSource: { type: "formula", expression: "{:color}" } } as const;
    expect(applyInteractionSettings(colorRule, configured, [configured], runtime, {}, undefined, { color: "#aabbcc" })).toBe("changed");
    expect(resolveRuntimeNode(configured, {}, runtime).data?.chart)
      .toMatchObject({ colors: ["#ff0000", "#aabbcc", "#e8b04b"] });
    const replaced = handle({ type: "setStaticData", id, data: { rows: [{ name: "实时", value: 12 }] } })!.tree[0];
    expect(replaced.data?.chartStates).toMatchObject({ alert: { barWidth: 24 } });
    const decoded = decodeProjectSnapshot(encodeProjectSnapshot({ name: "状态", savedAt: 1,
      boardSize: { width: 1920, height: 1080 }, scene: [replaced], settings: null, params: null }));
    expect(resolveRuntimeNode(decoded.scene[0], {}, { [id]: { stateId: "alert" } }).data?.chart)
      .toMatchObject({ barWidth: 24, colors: ["#ff0000", "#00ff00"] });
    handle({ type: "widgetStates", id, states: [] });
    expect(handle({ type: "undo" })!.tree[0].data?.chartStates).toMatchObject({ alert: { barWidth: 24 } });
  });
});
