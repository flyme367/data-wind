import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { PNG } from "pngjs";
import { writeMinWebp } from "./lib-webp.mjs";
import { BoardCanvas, SoftwareCanvas, initSync } from "../src/wasm/cpu/data_wind_cpu.js";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "data-wind-board-"));
try {
  const fixture = join(temp, "fixture.ts");
  writeFileSync(fixture, `export { widgetNode, widgetLabels } from ${JSON.stringify(join(frontend,"src/data/editor.ts"))};\nexport { chartCatalog, chartPaletteNode } from ${JSON.stringify(join(frontend,"src/data/chartCatalog.ts"))};\nexport { chartItemNames } from ${JSON.stringify(join(frontend,"src/data/chartInteraction.ts"))};\nexport { applyInteractionSettings } from ${JSON.stringify(join(frontend,"src/data/interactionSettings.ts"))};\nexport { resolveRuntimeScene } from ${JSON.stringify(join(frontend,"src/data/runtimeScene.ts"))};\nexport { boardNodes, boardClock } from ${JSON.stringify(join(frontend,"src/engine/boardScene.ts"))};\nexport * from ${JSON.stringify(join(frontend,"src/engine/commands.ts"))};\nexport { dispatchCommandResponse } from ${JSON.stringify(join(frontend,"src/engine/commandResponse.ts"))};\nexport { BoardAction } from ${JSON.stringify(join(frontend,"src/protocol/generated/data-wind-protocol"))};\n`);
  await build({ configFile: false, root: frontend, logLevel: "error", build: { outDir: join(temp,"build"), minify: false,
    lib: { entry: fixture, formats: ["es"], fileName: () => "fixture.mjs" } } });
  const { widgetNode, widgetLabels, chartCatalog, chartPaletteNode, chartItemNames, applyInteractionSettings, resolveRuntimeScene,
    boardNodes, boardClock, encodeBoardClock, encodeBoardSync,
    encodeSetValue, encodeGeoJsonDocument, encodeSoftwareFrame, decodeStringList,
    dispatchCommandResponse, BoardAction } = await import(pathToFileURL(join(temp,"build/fixture.mjs")));
  initSync({ module: readFileSync(join(frontend,"src/wasm/cpu/data_wind_cpu_bg.wasm")) });
  assert.deepEqual(decodeStringList(BoardCanvas.supported_kinds()).sort(), Object.keys(widgetLabels).sort());
  const board = await BoardCanvas.create({}, false);
  const kinds = Object.keys(widgetLabels);
  const scene = kinds.flatMap((kind, index) => {
    const node = { id:kind, visible:true, locked:false, parentId:null, ...widgetNode(kind) };
    node.transform.position = { x:(index % 4) * 400 + 14, y:Math.floor(index / 4) * 300 + 45, z:0 };
    const scale = Math.min(370 / node.boxSize.x, 235 / node.boxSize.y, 1);
    node.boxSize = { x:node.boxSize.x * scale, y:node.boxSize.y * scale, z:1 };
    const title = { ...widgetNode("text"), id:`title-${kind}`, visible:true, locked:false, parentId:null };
    title.widget.text = `${index + 1}. ${widgetLabels[kind]}`; title.widget.fontSize = 15;
    title.boxSize = { x:370, y:30, z:1 };
    title.transform.position = { x:node.transform.position.x, y:node.transform.position.y - 38, z:0 };
    return [title,node];
  });
  const drainEvents = surface => {
    const events = [];
    dispatchCommandResponse(surface.take_events(), { boardEvent: event => events.push(event) });
    return events;
  };
  const width = 1600, height = Math.ceil(kinds.length / 4) * 300;
  try {
    board.sync_scene(encodeBoardSync({ width, height, preview:true, selected:[], nodes:boardNodes(scene) }));
    board.set_geojson(encodeGeoJsonDocument(JSON.parse(readFileSync(join(frontend,"public/gis/ne_110m_admin_0_countries.geojson"),"utf8"))));
    const result = board.snapshot(width,height,encodeBoardClock(boardClock()));
    assert.equal(new DataView(result.buffer,result.byteOffset,8).getUint32(0,true),width);
    assert.equal(result.byteLength,8+width*height*4);
    const output = new PNG({width,height}); output.data = Buffer.from(result.subarray(8));
    const artifacts = resolve(frontend,"../artifacts"); mkdirSync(artifacts,{recursive:true});
    await writeMinWebp(join(artifacts,"rust-board-components.webp"),PNG.sync.write(output));
    board.set_value(encodeSetValue("input","中文输入保留"));
    drainEvents(board); board.activate("input");
    assert.equal(drainEvents(board).find(event=>event.action===BoardAction.Focus).value,"中文输入保留");
    assert.throws(()=>board.snapshot(8192,8192,encodeBoardClock(boardClock())));
    // Exercise the real palette preset, FlatBuffers JSON boundary and CPU WASM pixels together.
    const renderPreset = (label, patch, rows) => {
      const entry = chartCatalog.find(item => item.label === label);
      assert.ok(entry, `missing chart preset: ${label}`);
      const preset = { ...chartPaletteNode(entry), id:`chart-test-${label}`, visible:true, locked:false, parentId:null };
      preset.transform.position = { x:10, y:10, z:0 };
      preset.boxSize = { x:360, y:220, z:1 };
      preset.data.chart = { ...preset.data.chart, ...patch };
      if (rows) preset.data.rows = rows;
      board.sync_scene(encodeBoardSync({ width:400, height:300, preview:true, selected:[], nodes:boardNodes([preset]) }));
      return board.snapshot(400,300,encodeBoardClock(boardClock()));
    };
    assert.notDeepEqual(renderPreset("T型分组柱状图", { barWidth:4 }), renderPreset("T型分组柱状图", { barWidth:24 }));
    assert.notDeepEqual(renderPreset("T型分组柱状图", {}), renderPreset("T型分组柱状图", {
      colorConditions:[{ field:"value", operator:"gte", value:"60", series:"1", color:"#ff0000" }],
    }));
    assert.notDeepEqual(renderPreset("基础折线图", { pointRadius:8, pointShape:"circle" }),
      renderPreset("基础折线图", { pointRadius:8, pointShape:"triangle" }));
    const reference = { value:20, name:"目标", color:"#ff0000", style:"dashed", dash:4,
      textColor:"#00ff00", textOffset:[0, 0] };
    assert.notDeepEqual(renderPreset("基础折线图", { referenceLines:[reference] }),
      renderPreset("基础折线图", { referenceLines:[{ ...reference, dash:12, textOffset:[20, -10] }] }),
      "reference line dash and text offset must affect the canvas");
    const styledLineRows = [{ name:"A", value:40, value2:20 }, { name:"B", value:30, value2:30 },
      { name:"C", value:20, value2:40 }];
    const independentLine = { seriesCount:2, showLegend:false, seriesStyleEnabled:true, seriesStyles:[
      { pointShape:"image", pointRadius:8, lineStyle:"dashed" },
      { pointShape:"diamond", pointRadius:9, lineWidth:4, pointShadowColor:"#ff0000", pointShadowBlur:5 },
    ] };
    const lineWithoutImage = renderPreset("基础折线图2", independentLine, styledLineRows);
    const seriesImage = "\u001fpoint:0:chart-test-基础折线图2";
    board.set_image(seriesImage, 1, 1, new Uint8Array([0, 255, 0, 255]));
    const lineWithImage = board.snapshot(400, 300, encodeBoardClock(boardClock()));
    assert.notDeepEqual(lineWithoutImage, lineWithImage, "the selected series must use its own point image");
    board.clear_image(seriesImage);
    renderPreset("基础折线图2", { seriesCount:2, showPoints:false, showLegend:false, flowEnabled:true,
      flowStyles:[{ enabled:true, shape:"diamond", color:"#ff0000", size:12, trailLength:30, duration:10 }] }, styledLineRows);
    const flowFirst = board.snapshot(400, 300, encodeBoardClock(boardClock(new Date(2500))));
    const flowSecond = board.snapshot(400, 300, encodeBoardClock(boardClock(new Date(7500))));
    assert.notDeepEqual(flowFirst, flowSecond, "flow marker must move in the browser engine");
    const zeroRows = [{ name:"A", value:40 }, { name:"B", value:0 }, { name:"C", value:40 }];
    const zeroLine = { seriesCount:1, showPoints:false, showLegend:false, zeroRemoval:true };
    assert.notDeepEqual(renderPreset("基础折线图", { ...zeroLine, zeroRemovalMode:"skip" }, zeroRows),
      renderPreset("基础折线图", { ...zeroLine, zeroRemovalMode:"segment" }, zeroRows),
      "zero removal must distinguish connecting from segmenting the line");
    const categorySettings = { seriesCount:2, showLegend:false, categoryVisibilityMode:"custom", visibleCategoryCount:2 };
    assert.deepEqual(renderPreset("基础折线图2", categorySettings, styledLineRows),
      renderPreset("基础折线图2", { ...categorySettings, categoryVisibilityMode:"all" }, styledLineRows.slice(0, 2)),
      "custom chart count must limit categories without removing series");
    assert.notDeepEqual(renderPreset("基础折线图", { boundaryGap:true }),
      renderPreset("基础折线图", { boundaryGap:false }));
    const signedRows = [{ name:"负值", value:-20 }, { name:"零", value:0 }, { name:"正值", value:40 }];
    assert.notDeepEqual(renderPreset("基础折线图", {}, signedRows),
      renderPreset("基础折线图", { axisRangeModeY:"custom", axisMinY:-40, axisMaxY:80 }, signedRows));
    const interval = { axisRangeModeY:"custom", axisMinY:-40, axisMaxY:80, axisIntervalModeY:"value" };
    assert.notDeepEqual(renderPreset("基础折线图", { ...interval, axisIntervalY:20 }, signedRows),
      renderPreset("基础折线图", { ...interval, axisIntervalY:40 }, signedRows),
      "numeric tick interval must change labels, grid and tick marks");
    assert.notDeepEqual(renderPreset("基础折线面积图", {}, signedRows),
      renderPreset("基础折线面积图", {}, signedRows.map(row => ({ ...row, value:Math.max(0, row.value) }))));
    const signedBars = [{ name:"一月", value:-30, value2:30 }, { name:"二月", value:-10, value2:20 }];
    assert.notDeepEqual(renderPreset("T型分组柱状图", {}, signedBars),
      renderPreset("T型分组柱状图", { axisRangeModeY:"custom", axisMinY:-60, axisMaxY:60 }, signedBars));
    assert.notDeepEqual(renderPreset("T型分组条形图", {}, signedBars),
      renderPreset("T型分组条形图", { axisRangeModeX:"custom", axisMinX:-60, axisMaxX:60 }, signedBars));
    const rankingRows = [{ name:"A", value:20, value2:2 }, { name:"B", value:8, value2:4 },
      { name:"C", value:30, value2:8 }];
    const ranking = { showRanking:true, rankingBackgroundColor:"#ff0000", rankingBackgroundWidth:28,
      rankingBackgroundHeight:18, rankingDistance:0, seriesCount:2, showLegend:false };
    for (const label of ["T型分组柱状图", "T型分组条形图", "基础折线图2", "基础分组双轴图"]) {
      assert.notDeepEqual(renderPreset(label, {}, rankingRows), renderPreset(label, ranking, rankingRows),
        `${label} must paint ranking labels`);
    }
    assert.notDeepEqual(renderPreset("T型分组柱状图", ranking, rankingRows),
      renderPreset("T型分组柱状图", { ...ranking, rankingDisplay:"max" }, rankingRows));
    assert.notDeepEqual(renderPreset("T型分组柱状图", ranking, rankingRows),
      renderPreset("T型分组柱状图", { ...ranking, rankingFormat:"value-template" }, rankingRows));
    assert.notDeepEqual(renderPreset("T型分组柱状图", ranking, rankingRows),
      renderPreset("T型分组柱状图", { ...ranking, rankingBold:true, rankingItalic:true,
        rankingUnderline:true, rankingStrike:true, rankingFontFamily:"monospace" }, rankingRows));
    assert.notDeepEqual(renderPreset("T型分组柱状图", ranking, rankingRows),
      renderPreset("T型分组柱状图", { ...ranking, rankingBackgroundShape:"down-arrow-rect" }, rankingRows));
    const imageRank = { ...ranking, rankingBackground:"image" };
    const emptyRankImage = renderPreset("T型分组柱状图", imageRank, rankingRows);
    board.set_image("chart-test-T型分组柱状图", 1, 1, new Uint8Array([15, 240, 120, 255]));
    const loadedRankImage = board.snapshot(400, 300, encodeBoardClock(boardClock()));
    assert.notDeepEqual(emptyRankImage, loadedRankImage, "ranking image must use the uploaded texture");
    board.clear_image("chart-test-T型分组柱状图");
    assert.notDeepEqual(renderPreset("基础区间面积图", { boundaryGap:true }),
      renderPreset("基础区间面积图", { boundaryGap:false }));
    assert.notDeepEqual(renderPreset("基础折线图", { showGrid:false, showAxisLineX:false }),
      renderPreset("基础折线图", { showGrid:false, showAxisLineX:true, axisLineWidthX:3,
        axisLineStyleX:"dottedLine", axisLineDashX:[3, 9], axisLineColorX:"#ff0000" }));
    assert.notDeepEqual(renderPreset("T型分组条形图", { showGrid:false, showAxisTicksY:false }),
      renderPreset("T型分组条形图", { showGrid:false, showAxisTicksY:true, axisTickLengthY:14 }));
    assert.notDeepEqual(renderPreset("基础折线图", { showGrid:false, axisDecimalsY:0 }),
      renderPreset("基础折线图", { showGrid:false, axisDecimalsY:2, axisPadZerosY:true,
        showAxisNameY:true, axisNameY:"单位", axisNameGapY:-10 }));
    assert.notDeepEqual(renderPreset("基础折线图", { axisLabelRotateX:0 }),
      renderPreset("基础折线图", { axisLabelRotateX:-45 }));
    assert.notDeepEqual(renderPreset("基础折线图", { axisLabelRotateX:-45 }),
      renderPreset("基础折线图", { axisLabelRotateX:-45, axisFontFamilyX:"monospace", axisBoldX:true,
        axisItalicX:true, axisUnderlineX:true, axisStrikeX:true, axisLabelOverflowX:true, axisLabelMaxWidthX:20,
        axisLabelShadowColorX:"#ff0000", axisLabelShadowBlurX:5, axisLabelShadowOffsetX:[2, -1] }));
    assert.notDeepEqual(renderPreset("T型分组条形图", { axisLabelRotateY:0 }),
      renderPreset("T型分组条形图", { axisLabelRotateY:-45 }));
    assert.notDeepEqual(renderPreset("T型分组条形图", { showLabels:true, labelPosition:"outside" }),
      renderPreset("T型分组条形图", { showLabels:true, labelPosition:"inside", labelShowCategory:true,
        labelOffsetX:4, labelTilt:20, unit:"万", labelUnitSize:18, labelUnitColor:"#ff0000" }));
    assert.notDeepEqual(renderPreset("基础分组双轴图", { showLabels:false, showLineLabels:false }),
      renderPreset("基础分组双轴图", { showLabels:false, showLineLabels:true, lineLabelPosition:"top",
        lineLabelColor:"#ff0000", lineLabelFormat:"percent" }));
    const rightRows = [{ name:"一月", value:100, value2:0.5 }, { name:"二月", value:100, value2:1 }];
    const rightSettings = { seriesCount:2, rightAxisStart:2, showRightAxis:false, showLabels:false };
    assert.notDeepEqual(renderPreset("基础平滑折线图3", { ...rightSettings, showLineLabels:false }, rightRows),
      renderPreset("基础平滑折线图3", { ...rightSettings, showLineLabels:true,
        lineLabelColor:"#ff0000", lineLabelFormat:"percent" }, rightRows));
    assert.notDeepEqual(renderPreset("基础平滑折线图3", rightSettings, rightRows),
      renderPreset("基础平滑折线图3", { ...rightSettings, showRightAxis:true, showRightGrid:true,
        rightGridStyle:"dotted", rightGridColor:"#ff0000", showRightAxisName:true, rightAxisName:"单位" }, rightRows));
    assert.notDeepEqual(renderPreset("基础平滑折线图3", { ...rightSettings, showRightAxis:true }, rightRows),
      renderPreset("基础平滑折线图3", { ...rightSettings, showRightAxis:true, rightAxisRotate:45 }, rightRows));
    assert.notDeepEqual(renderPreset("基础分组双轴图", { showRightAxis:false }),
      renderPreset("基础分组双轴图", { showRightAxis:true, showRightGrid:true, rightGridColor:"#00ff00" }));
    assert.notDeepEqual(renderPreset("基础折线图", { legendPosition:"top-left" }),
      renderPreset("基础折线图", { legendPosition:"bottom-right" }));
    assert.notDeepEqual(renderPreset("基础折线图2", { legendPosition:"top-left" }),
      renderPreset("基础折线图2", { legendPosition:"top-left", legendFontFamily:"monospace", legendBold:true,
        legendItalic:true, legendUnderline:true, legendStrike:true, legendTextSpacing:3, legendTextMode:"custom",
        legendTextWidth:30, legendShadowColor:"#ff0000", legendShadowBlur:6, legendShadowOffset:[2, 1] }),
      "legend text styling must affect browser pixels");
    const legendRows = Array.from({ length:12 }, (_, index) => ({ name:`Category ${index + 1} long label`, value:index + 1 }));
    const pagedLegend = renderPreset("基础饼状图", { showLegend:true, legendType:"scroll", legendPosition:"top-left",
      legendPageIconColor:"#ff0000", legendPageInactiveColor:"#00000000", legendPageIconSize:20,
      legendPageItemGap:0, legendPageGap:0, colors:["#007aff"], paletteCycle:true }, legendRows);
    const arrow = [];
    for (let y = 0; y < 100; y++) for (let x = 0; x < 400; x++) {
      const at = 8 + (y * 400 + x) * 4;
      if (pagedLegend[at] > 240 && pagedLegend[at + 1] < 20 && pagedLegend[at + 2] < 20) arrow.push([x, y]);
    }
    assert.ok(arrow.length > 0, "scrolling legend must show its next-page button");
    const arrowCenter = arrow.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0])
      .map(value => value / arrow.length);
    board.pointer("down", ...arrowCenter); board.pointer("up", ...arrowCenter);
    const secondLegendPage = board.snapshot(400, 300, encodeBoardClock(boardClock()));
    assert.notDeepEqual(pagedLegend, secondLegendPage,
      "next-page button must update the visible legend entries");
    const previousImage = "\u001flegend-left:chart-test-基础饼状图";
    const nextImage = "\u001flegend-right:chart-test-基础饼状图";
    board.set_image(previousImage, 1, 1, new Uint8Array([0, 255, 0, 255]));
    board.set_image(nextImage, 1, 1, new Uint8Array([0, 180, 255, 255]));
    const imageLegendPage = board.snapshot(400, 300, encodeBoardClock(boardClock()));
    assert.notDeepEqual(secondLegendPage, imageLegendPage, "legend buttons must draw the supplied image textures");
    board.clear_image(previousImage); board.clear_image(nextImage);
    assert.notDeepEqual(renderPreset("基础饼状图", { pieSize:100 }), renderPreset("基础饼状图", { pieSize:50 }));
    assert.notDeepEqual(renderPreset("基础饼状图", { colors:["#ff0000", "#00ff00"] }),
      renderPreset("基础饼状图", { colors:["#ff0000", "#00ff00"], paletteCycle:true }));
    assert.notDeepEqual(renderPreset("基础桑基图", { nodeWidth:5 }), renderPreset("基础桑基图", { nodeWidth:30 }));
    const clickItem = (x, y) => {
      board.pointer("down", x, y);
      board.pointer("up", x, y);
      return drainEvents(board).find(event => event.value?.__dwChartItem)?.value;
    };
    const signedSettings = { seriesCount:1, showLegend:false, showGrid:false, showXAxis:false,
      showYAxis:false, showPoints:true, pointRadius:8, axisRangeModeY:"custom", axisMinY:-40, axisMaxY:80 };
    renderPreset("基础折线图", signedSettings, signedRows);
    const negativeItem = clickItem(106, 165.83);
    assert.equal(negativeItem?.value, -20, "negative values must survive the browser click payload");
    assert.equal(negativeItem?.index, 0);
    board.pointer("move", 106, 165.83);
    const plainLineTooltip = board.snapshot(400, 300, encodeBoardClock(boardClock()));
    renderPreset("基础折线图", { ...signedSettings, tooltipShowVerticalPointer:true,
      tooltipShowHorizontalPointer:true, tooltipPointerStyle:"solid", tooltipPointerColor:"#ff00ff",
      tooltipPointerLabel:true, tooltipFormat:"percent", tooltipDecimals:2, tooltipPadZeros:true,
      tooltipNameColor:"#00ff00", tooltipTextColor:"#ffffff", tooltipShowTitle:false }, signedRows);
    board.pointer("move", 106, 165.83);
    const styledLineTooltip = board.snapshot(400, 300, encodeBoardClock(boardClock()));
    assert.notDeepEqual(plainLineTooltip, styledLineTooltip, "tooltip formatting and crosshairs must affect WASM pixels");
    const axisRows = [{ name:"A", value:40, value2:20 }, { name:"B", value:40, value2:20 },
      { name:"C", value:40, value2:20 }];
    const axisTooltip = { seriesCount:2, showPoints:false, showLegend:false, showGrid:false,
      showXAxis:false, showYAxis:false, tooltipBackground:"#ff0000", tooltipPosition:"center",
      tooltipShowTitle:false, tooltipAxisTrigger:true };
    renderPreset("基础折线图2", axisTooltip, axisRows);
    board.pointer("move", 106, 180);
    const groupedTooltip = board.snapshot(400, 300, encodeBoardClock(boardClock()));
    const countRed = pixels => {
      let count = 0;
      for (let i = 8; i < pixels.length; i += 4)
        if (pixels[i] > 245 && pixels[i + 1] < 10 && pixels[i + 2] < 10) count++;
      return count;
    };
    assert.ok(countRed(groupedTooltip) > 100, "axis tooltip must show while hovering empty plot space");
    renderPreset("基础折线图2", { ...axisTooltip, tooltipAxisTrigger:false }, axisRows);
    board.pointer("move", 106, 180);
    const noAxisTooltip = board.snapshot(400, 300, encodeBoardClock(boardClock()));
    assert.equal(countRed(noAxisTooltip), 0, "disabling the axis trigger must remove the empty-space tooltip");
    renderPreset("基础折线图", { ...signedSettings, axisMinY:0, axisMaxY:100 }, signedRows);
    assert.equal(clickItem(106, 221.2), undefined, "values outside custom bounds must not be clickable");
    const columnSettings = { seriesCount:2, showLegend:false, showGrid:false, showXAxis:false, showYAxis:false };
    renderPreset("T型分组柱状图", columnSettings, signedBars);
    const negativeColumn = clickItem(105, 150);
    assert.equal(negativeColumn?.value, -30, "negative column must preserve its data value");
    assert.equal(negativeColumn?.series, 1);
    renderPreset("T型分组条形图", columnSettings, [signedBars[0]]);
    const negativeBar = clickItem(110, 92);
    assert.equal(negativeBar?.value, -30, "negative bar must preserve its data value");
    assert.equal(negativeBar?.series, 1);
    const zoomRows = [10, 20, 30, 40, 50].map((value, index) => ({ name:`Z${index}`, value }));
    const zoomSettings = { showDataZoom:true, zoomStart:40, zoomEnd:80, showLegend:false, seriesCount:1 };
    renderPreset("T型分组柱状图", zoomSettings, zoomRows);
    let zoomItem = clickItem(130, 120);
    assert.equal(zoomItem?.index, 2, "zoomed click must retain the original row index");
    board.pointer("down", 231, 200);
    board.pointer("move", 289, 200);
    board.pointer("up", 289, 200);
    assert.equal(drainEvents(board).length, 0, "zoom drag must not emit a chart click");
    board.snapshot(400, 300, encodeBoardClock(boardClock()));
    zoomItem = clickItem(130, 120);
    assert.equal(zoomItem?.index, 3, "dragged zoom must reveal the next original row");
    const rows = [{ name:"温度", value:36, value2:24 }, { name:"压力", value:80, value2:42 },
      { name:"流量", value:60, value2:30 }];
    const before = renderPreset("T型分组条形图", {}, rows);
    board.pointer("move", 80, 70);
    const hover = board.snapshot(400, 300, encodeBoardClock(boardClock()));
    assert.notEqual(Buffer.compare(before, hover), 0, "hover paints the selected bar and tooltip");
    const tooltipImage = "\u001ftooltip:chart-test-T型分组条形图";
    board.set_image(tooltipImage, 1, 1, new Uint8Array([255, 0, 0, 255]));
    const imageTooltip = board.snapshot(400, 300, encodeBoardClock(boardClock()));
    assert.notDeepEqual(hover, imageTooltip, "tooltip background image must use the uploaded texture");
    board.clear_image(tooltipImage);
    const selected = clickItem(80, 70);
    assert.equal(selected.name, "温度");
    assert.equal(selected.value, 24);
    assert.equal(selected.series, 2);
    assert.deepEqual(selected.row, rows[0]);

    const barNode = { ...chartPaletteNode(chartCatalog.find(entry => entry.label === "T型分组条形图")),
      id:"linked-bars", visible:true, locked:false, parentId:null };
    barNode.data.rows = rows;
    barNode.transform.position = { x:10, y:10, z:0 };
    barNode.boxSize = { x:360, y:220, z:1 };
    const textNode = { ...widgetNode("text"), id:"linked-text", visible:true, locked:false, parentId:null };
    textNode.transform.position = { x:10, y:230, z:0 };
    textNode.boxSize = { x:360, y:60, z:1 };
    const linkRule = { id:"link", event:"itemClick", action:"modify", targetId:textNode.id, value:"{}",
      settingKey:"text", settingSource:{ type:"formula", expression:"{:payload.name}：{:payload.value}℃" } };
    const overrides = {};
    assert.equal(applyInteractionSettings(linkRule, barNode, [barNode, textNode], overrides, {}, selected), "changed");
    const linkedScene = resolveRuntimeScene([barNode, textNode], {}, overrides);
    assert.equal(linkedScene[1].widget.text, "温度：24℃");
    board.sync_scene(encodeBoardSync({ width:400, height:300, preview:true, selected:[], nodes:boardNodes([barNode, textNode]) }));
    const originalText = board.snapshot(400, 300, encodeBoardClock(boardClock()));
    board.sync_scene(encodeBoardSync({ width:400, height:300, preview:true, selected:[], nodes:boardNodes(linkedScene) }));
    const updatedText = board.snapshot(400, 300, encodeBoardClock(boardClock()));
    assert.notEqual(Buffer.compare(originalText, updatedText), 0, "clicked value changes the target's rendered text");
    const colorRule = { ...linkRule, targetId:barNode.id, settingKey:"data.chart.colors.1",
      settingSource:{ type:"formula", expression:"{:color}" } };
    assert.equal(applyInteractionSettings(colorRule, barNode, [barNode, textNode], overrides, {}, selected,
      { color:"#ff7744" }), "changed");
    const coloredScene = resolveRuntimeScene([barNode, textNode], {}, overrides);
    board.sync_scene(encodeBoardSync({ width:400, height:300, preview:true, selected:[], nodes:boardNodes(coloredScene) }));
    const updatedColor = board.snapshot(400, 300, encodeBoardClock(boardClock()));
    assert.notEqual(Buffer.compare(updatedText, updatedColor), 0, "interaction changes the chosen series color");
    renderPreset("T型分组条形图", {}, rows);
    assert.equal(clickItem(292, 27), undefined, "legend does not dispatch an item click");
    board.frame(400, 300, encodeBoardClock(boardClock()));
    assert.equal(clickItem(80, 70), undefined, "hidden series does not receive clicks");

    renderPreset("基础桑基图", {}, [{ source:"入口", target:"页面", value:24 }]);
    const link = clickItem(160, 110);
    assert.equal(link.name, "入口 → 页面");
    assert.deepEqual(link.row, { source:"入口", target:"页面", value:24 });

    const dialog = { ...widgetNode("dialog"), id:"dialog", visible:true, locked:false, parentId:null };
    dialog.transform.position = { x:10, y:10, z:0 };
    dialog.boxSize = { x:360, y:220, z:1 };
    board.sync_scene(encodeBoardSync({ width:400, height:300, preview:true, selected:[], nodes:boardNodes([dialog]) }));
    for (const [x, y, expected] of [[347, 30, "close"], [243, 202, "cancel"], [320, 202, "confirm"]]) {
      board.pointer("down", x, y);
      board.pointer("up", x, y);
      const event = drainEvents(board).find(item => item.action === BoardAction.Change);
      assert.equal(event?.value?.__dwDialogAction, expected);
    }

    // Every palette preset should expose an item at a visible point on its example data.
    for (const entry of chartCatalog) {
      renderPreset(entry.label, { showLegend:false, showTooltip:false, playAnimation:false });
      let item;
      for (let y = 27; y < 222 && !item; y += 5) {
        for (let x = 29; x < 353 && !item; x += 5) item = clickItem(x, y);
      }
      assert.ok(item && item.name, `no data item hit for ${entry.label}`);
      assert.ok(chartItemNames(chartPaletteNode(entry).data).includes(item.name),
        `clicked item "${item.name}" is missing from the ${entry.label} data selector`);
    }
    const software = new SoftwareCanvas();
    try {
      const camera = {target:[0,0,0],yaw:0.75,pitch:0.55,dist:15};
      const options = {grid:true,selectedId:null,time:1,background:"#101a2c",daylight:1};
      const pixels = software.frame(640,480,encodeSoftwareFrame(
        [{id:"cube",kind:"box",pos:[0,0,0],size:[5,5,5],rotY:0,color:[0.3,0.6,0.9]}], camera, options), false);
      assert.equal(software.pick(320,240),"cube");
      const png = new PNG({width:640,height:480}); png.data=Buffer.from(pixels.subarray(8));
      await writeMinWebp(join(artifacts,"rust-3d-software.webp"),PNG.sync.write(png));
      const mesh = new Uint8Array(8 + 3 * 9 * 4);
      mesh.set([68, 87, 77, 49]);
      const view = new DataView(mesh.buffer); view.setUint32(4, 3, true);
      [[-0.5,-0.5,0], [0.5,-0.5,0], [-0.5,0.5,0]].forEach((point, index) => {
        [...point,0,0,1,1,1,1].forEach((value, component) => view.setFloat32(8 + (index * 9 + component) * 4, value, true));
      });
      software.register_mesh("triangle", mesh);
      const front = {id:"front",kind:"mesh",modelId:"triangle",pos:[0,0,0],size:[4,4,2],rotY:0,color:[1,1,1]};
      const back = {id:"back",kind:"box",pos:[0,0,-2],size:[4,4,1],rotY:0,color:[1,1,1]};
      const scene = instances => encodeSoftwareFrame(instances,
        {target:[0,0,0],yaw:0,pitch:0,dist:10}, {grid:false,selectedId:null,time:0});
      software.frame(400,400,scene([front]),false);
      assert.equal(software.pick(152,248),"front");
      assert.equal(software.pick(248,152),undefined);
      software.frame(400,400,scene([front,back]),false);
      assert.equal(software.pick(248,152),"back");
      software.frame(400,400,scene([]),true);
      assert.equal(software.pick(248,152),"back");
    } finally { software.free(); }
    console.log(`Production WASM passed: ${kinds.length} component kinds, ${chartCatalog.length} interactive chart presets, CJK font, maps, runtime input, PNG pixels and Rust 3D fallback.`);
  } finally { board.free(); }
} finally { rmSync(temp,{recursive:true,force:true}); }
