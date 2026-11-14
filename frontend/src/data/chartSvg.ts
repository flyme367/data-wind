import type { SceneNode } from "../types";

export interface ChartRow { name: string; value: number; value2?: number; value3?: number }

const escapeXml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);

/** 模板字符串里的数字统一保留 1 位小数，避免 path 膨胀。 */
const n1 = (value: number): number => Math.round(value * 10) / 10;

/** 编辑器与发布成品共用的图表数据规整：最多 30 行，数值截断到非负。value2 / value3 为可选的第二、三系列。 */
export function chartRows(node: SceneNode): ChartRow[] {
  const raw = node.data?.rows;
  const pick = (row: Record<string, unknown>, key: "value2" | "value3"): number | undefined => {
    const parsed = Number(row?.[key]);
    return row?.[key] === undefined ? undefined : Math.max(0, Number.isFinite(parsed) ? parsed : 0);
  };
  return (Array.isArray(raw) ? raw : []).slice(0, 30).map((row, index) => {
    const item = row as Record<string, unknown>;
    const value = Number(item?.value);
    return {
      name: String(item?.name ?? index + 1),
      value: Math.max(0, Number.isFinite(value) ? value : 0),
      value2: pick(item, "value2"),
      value3: pick(item, "value3"),
    };
  });
}

export interface ChartSeries { label: string; color: string; values: number[] }

const SERIES_COLORS = ["#3ddbb5", "#e8b04b", "#a78bfa", "#f472b6", "#67e0ff"];

/** 多系列拆分：rows 中出现 value2 / value3 即视为第二、三系列，首系列沿用组件颜色。 */
export function chartSeries(node: SceneNode): { names: string[]; series: ChartSeries[] } {
  const rows = chartRows(node);
  const keys: ("value" | "value2" | "value3")[] = ["value", "value2", "value3"];
  const used = keys.filter((key, index) => index === 0 || rows.some((row) => (row[key] ?? 0) > 0));
  const colors = [node.color, ...SERIES_COLORS];
  const series = used.map((key, index) => ({
    label: `值${index + 1}`,
    color: colors[index % colors.length],
    values: rows.map((row) => row[key] ?? 0),
  }));
  return { names: rows.map((row) => row.name), series };
}

// ── 共享几何：viewBox 0 0 400 190，绘图区 x 46~376 / y 30~150 ───────────────────────────

const frame = (max: number, suffix = ""): string =>
  [0, 1, 2, 3].map((index) =>
    `<line x1="42" x2="382" y1="${30 + index * 40}" y2="${30 + index * 40}" stroke="#a4c4e31e"/><text x="34" y="${34 + index * 40}" text-anchor="end" font-size="10" fill="#7c9eb7">${Math.round(max * (1 - index / 3))}${suffix}</text>`).join("");

const xLabels = (names: string[]): string => {
  const step = 330 / Math.max(1, names.length);
  return names.map((name, index) =>
    `<text x="${n1(46 + step * (index + .5))}" y="175" text-anchor="middle" fill="#90acc1" font-size="11">${escapeXml(name)}</text>`).join("");
};

const legend = (series: ChartSeries[]): string => {
  const item = 56;
  const startX = 396 - series.length * item;
  return series.map((entry, index) =>
    `<circle cx="${startX + index * item}" cy="14" r="4" fill="${entry.color}"/><text x="${startX + index * item + 9}" y="18" fill="#b8d3e8" font-size="11">${entry.label}</text>`).join("");
};

const smoothPath = (points: [number, number][]): string => {
  if (points.length < 3) return points.map((p, i) => `${i ? "L" : "M"}${n1(p[0])},${n1(p[1])}`).join("");
  let d = `M${n1(points[0][0])},${n1(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    d += `C${n1(p1[0] + (p2[0] - p0[0]) / 6)},${n1(p1[1] + (p2[1] - p0[1]) / 6)} ${n1(p2[0] - (p3[0] - p1[0]) / 6)},${n1(p2[1] - (p3[1] - p1[1]) / 6)} ${n1(p2[0])},${n1(p2[1])}`;
  }
  return d;
};

const polar = (cx: number, cy: number, r: number, degree: number): [number, number] => {
  const rad = degree * Math.PI / 180;
  return [n1(cx + r * Math.cos(rad)), n1(cy + r * Math.sin(rad))];
};

const arcPath = (cx: number, cy: number, r: number, start: number, end: number): string => {
  const [x1, y1] = polar(cx, cy, r, start), [x2, y2] = polar(cx, cy, r, end);
  return `M${x1},${y1} A${r},${r} 0 ${end - start > 180 ? 1 : 0} 1 ${x2},${y2}`;
};

const wedgePath = (cx: number, cy: number, r: number, start: number, end: number): string => {
  const [x1, y1] = polar(cx, cy, r, start), [x2, y2] = polar(cx, cy, r, end);
  return `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${end - start > 180 ? 1 : 0} 1 ${x2},${y2}Z`;
};

const gradientDef = (id: string, color: string, from: number, to: number): string =>
  `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="${from}"/><stop offset="1" stop-color="${color}" stop-opacity="${to}"/></linearGradient></defs>`;

const pieColors = (color: string): string[] => [color, ...SERIES_COLORS];

const pieLegend = (rows: ChartRow[], colors: string[]): string =>
  rows.slice(0, 6).map((row, index) =>
    `<circle cx="226" cy="${31 + index * 25}" r="4" fill="${colors[index % colors.length]}"/><text x="236" y="${35 + index * 25}" fill="#b8d3e8" font-size="13">${escapeXml(row.name)}　${row.value}</text>`).join("");

/** 特殊预设的素材卡预览；交互和最终画布仍由 Rust 绘制。 */
function variantSvg(node: SceneNode, rows: ChartRow[], variant: string, tint: string): string | undefined {
  const colors = pieColors(tint), max = Math.max(1, ...rows.map(row => row.value));
  const raw = (Array.isArray(node.data?.rows) ? node.data.rows : []) as Record<string, unknown>[];
  if (variant === "pathAnimation") return `<path d="M120,40 H280 V150 H120 Z" fill="none" stroke="${tint}" stroke-width="2"/><circle cx="120" cy="40" r="5" fill="${tint}"/>`;
  if (variant === "path") {
    const maxX = Math.max(1, ...raw.map(row => Number(row.x) || 0));
    const points = raw.map(row => `${n1(46 + (Number(row.x) || 0) / maxX * 330)},${n1(150 - (Number(row.value) || 0) / max * 118)}`).join(" ");
    return frame(max) + `<polyline points="${points}" fill="none" stroke="${tint}" stroke-width="2.5"/>`;
  }
  if (variant === "jade") return rows.slice(0, 5).map((row, i) => {
    const radius = 68 - i * 11;
    return `<path d="${arcPath(130, 100, radius, -225, 45)}" fill="none" stroke="#273e55" stroke-width="7"/><path d="${arcPath(130, 100, radius, -225, -225 + 270 * row.value / max)}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="7"/>`;
  }).join("") + pieLegend(rows, colors);
  if (variant === "sankey") {
    const sources = [...new Set(raw.map(row => String(row.source ?? row["节点1"] ?? "")))].filter(Boolean);
    const targets = [...new Set(raw.map(row => String(row.target ?? row["节点2"] ?? "")))].filter(Boolean);
    const nodes = [...new Set([...sources, ...targets])];
    const level = (name: string) => sources.includes(name) && !targets.includes(name) ? 0 : sources.includes(name) ? 1 : 2;
    const pos = (name: string): [number, number] => {
      const group = nodes.filter(item => level(item) === level(name));
      return [45 + level(name) * 145, 30 + (group.indexOf(name) + .5) * 125 / Math.max(1, group.length)];
    };
    const links = raw.map((row, i) => {
      const a = pos(String(row.source ?? row["节点1"] ?? "")), b = pos(String(row.target ?? row["节点2"] ?? ""));
      return `<path d="M${a[0]},${n1(a[1])} C${a[0] + 65},${n1(a[1])} ${b[0] - 65},${n1(b[1])} ${b[0]},${n1(b[1])}" fill="none" stroke="${colors[i % colors.length]}" opacity=".35" stroke-width="${n1(Math.max(2, (Number(row.value) || 0) / 4))}"/>`;
    }).join("");
    return links + nodes.map((name, i) => { const [x, y] = pos(name); return `<rect x="${x - 3}" y="${n1(y - 9)}" width="6" height="18" fill="${colors[i % colors.length]}"/><text x="${x + 6}" y="${n1(y + 3)}" fill="#b8d3e8" font-size="9">${escapeXml(name)}</text>`; }).join("");
  }
  if (variant === "boxplot") {
    const maxValue = Math.max(1, ...raw.map(row => Number(row.max) || 0)), step = 330 / Math.max(1, raw.length);
    return frame(maxValue) + raw.map((row, i) => {
      const x = 46 + step * (i + .5), y = (key: string) => 150 - (Number(row[key]) || 0) / maxValue * 118;
      return `<line x1="${n1(x)}" y1="${n1(y("max"))}" x2="${n1(x)}" y2="${n1(y("min"))}" stroke="${colors[i % colors.length]}"/><rect x="${n1(x - step * .22)}" y="${n1(y("q3"))}" width="${n1(step * .44)}" height="${n1(Math.max(0, y("q1") - y("q3")))}" fill="${colors[i % colors.length]}" opacity=".7"/><line x1="${n1(x - step * .22)}" y1="${n1(y("median"))}" x2="${n1(x + step * .22)}" y2="${n1(y("median"))}" stroke="#fff"/>`;
    }).join("");
  }
  if (variant === "bullet") return rows.map((row, i) => {
    const y = 28 + i * 32;
    return `<rect x="85" y="${y}" width="245" height="18" fill="#31485b"/><rect x="85" y="${y + 6}" width="${n1(245 * row.value / Math.max(max, row.value2 ?? 0))}" height="6" fill="${tint}"/><line x1="${n1(85 + 245 * (row.value2 ?? row.value) / Math.max(max, row.value2 ?? 0))}" y1="${y + 2}" x2="${n1(85 + 245 * (row.value2 ?? row.value) / Math.max(max, row.value2 ?? 0))}" y2="${y + 16}" stroke="#e8b04b" stroke-width="2"/>`;
  }).join("");
  if (variant === "pizza") return [1, 2, 3, 4].map(i => `<circle cx="200" cy="95" r="${i * 18}" fill="none" stroke="#6cbcff33"/>`).join("") + rows.map((row, i) => {
    const angle = -90 + i * 360 / Math.max(3, rows.length), [x, y] = polar(200, 95, 72 * row.value / max, angle), [ex, ey] = polar(200, 95, 72, angle);
    return `<line x1="200" y1="95" x2="${ex}" y2="${ey}" stroke="#6cbcff22"/><circle cx="${x}" cy="${y}" r="4" fill="${colors[i % colors.length]}"/>`;
  }).join("");
  if (variant === "polarBar" || variant === "colorRing") return rows.map((row, i) => {
    const start = -90 + i * 360 / rows.length, end = -90 + (i + 1) * 360 / rows.length;
    const radius = variant === "polarBar" ? 20 + row.value / max * 54 : 70;
    return `<path d="${wedgePath(125, 95, radius, start, end - 1)}" fill="${colors[i % colors.length]}"/>`;
  }).join("") + (variant === "colorRing" ? `<circle cx="125" cy="95" r="44" fill="#101216"/>` : "") + pieLegend(rows, colors);
  if (variant === "sunburst") return `<circle cx="200" cy="95" r="70" fill="none" stroke="${tint}" stroke-width="32" stroke-dasharray="220 220" transform="rotate(-90 200 95)"/><circle cx="200" cy="95" r="70" fill="none" stroke="#3ddbb5" stroke-width="32" stroke-dasharray="110 330" stroke-dashoffset="-220" transform="rotate(-90 200 95)"/><circle cx="200" cy="95" r="35" fill="${tint}"/><path d="${wedgePath(200, 95, 35, 126, 270)}" fill="#3ddbb5"/>`;
  if (variant === "waffle" || variant === "colorBlocks") return Array.from({ length: 70 }, (_, i) =>
    `<rect x="${48 + (i % 10) * 30}" y="${22 + Math.floor(i / 10) * 21}" width="25" height="16" fill="${colors[(variant === "waffle" ? Math.floor(i / 20) : i) % colors.length]}"/>`).join("");
  if (variant === "treemap") {
    const total = rows.reduce((sum, row) => sum + row.value, 0) || 1; let x = 40;
    return rows.map((row, i) => { const width = row.value / total * 320, part = `<rect x="${n1(x)}" y="30" width="${n1(Math.max(0, width - 3))}" height="120" fill="${colors[i % colors.length]}"/>`; x += width; return part; }).join("");
  }
  if (variant === "rangeBar" || variant === "horizontalRange" || variant === "rangeArea") {
    const limit = Math.max(max, ...rows.map(row => row.value2 ?? 0), 1), step = 330 / Math.max(1, rows.length);
    if (variant === "rangeArea") {
      const upper = rows.map((row, i) => `${n1(46 + step * (i + .5))},${n1(150 - Math.max(row.value, row.value2 ?? 0) / limit * 118)}`);
      const lower = rows.map((row, i) => `${n1(46 + step * (i + .5))},${n1(150 - Math.min(row.value, row.value2 ?? 0) / limit * 118)}`).reverse();
      return frame(limit) + `<polygon points="${[...upper, ...lower].join(" ")}" fill="${tint}" opacity=".35"/><polyline points="${upper.join(" ")}" fill="none" stroke="${tint}" stroke-width="2"/>` + xLabels(rows.map(row => row.name));
    }
    return rows.map((row, i) => {
      const low = Math.min(row.value, row.value2 ?? row.value), high = Math.max(row.value, row.value2 ?? row.value);
      return variant === "rangeBar"
        ? `<rect x="${n1(46 + step * (i + .25))}" y="${n1(150 - high / limit * 118)}" width="${n1(step * .5)}" height="${n1((high - low) / limit * 118)}" fill="${colors[i % colors.length]}"/>`
        : `<rect x="${n1(65 + low / limit * 290)}" y="${n1(30 + i * 118 / rows.length)}" width="${n1((high - low) / limit * 290)}" height="${n1(70 / rows.length)}" fill="${colors[i % colors.length]}"/>`;
    }).join("");
  }
  if (variant === "pictorial") return rows.map((row, i) => Array.from({ length: Math.ceil(row.value / max * 10) }, (_, j) =>
    `<circle cx="${n1(46 + 330 / rows.length * (i + .5))}" cy="${144 - j * 12}" r="4" fill="${tint}"/>`).join("")).join("");
  return undefined;
}

/**
 * 柱状 / 折线 / 环形等全部图表的共享几何，返回 `<svg viewBox="0 0 400 190">` 的内部标记。
 * 表格与文本类组件由各渲染器自行实现 DOM；新增图表种类在此分支，编辑器与发布端共用。
 */
export function chartSvg(node: SceneNode): string {
  const rows = chartRows(node);
  const color = escapeXml(node.color);
  const kind = node.widget?.kind;
  const max = Math.max(1, ...rows.map((row) => row.value));
  const step = 330 / Math.max(1, rows.length);
  const points = rows.map((row, index) => [n1(46 + step * (index + .5)), n1(150 - row.value / max * 118)] as [number, number]);
  const { names, series } = chartSeries(node);
  const chart = node.data?.chart as Record<string, unknown> | undefined;
  const special = variantSvg(node, rows, String(chart?.variant ?? ""), color);
  if (special !== undefined) return special;

  // ── 饼图家族 ──
  if (kind === "pie") {
    const sum = rows.reduce((total, row) => total + row.value, 0) || 1;
    let offset = 0;
    const rings = rows.map((row, index) => {
      const len = row.value / sum * 314, dashOffset = -offset;
      offset += len;
      return `<circle r="50" fill="none" stroke="${index % 2 ? "#4bdeb5" : color}" opacity="${1 - index * .08}" stroke-width="24" stroke-dasharray="${n1(len)} ${n1(314 - len)}" stroke-dashoffset="${n1(dashOffset)}"/>`;
    }).join("");
    return `<g transform="translate(130 94) rotate(-90)">${rings}</g>${pieLegend(rows, pieColors(color))}`;
  }
  if (kind === "pieBasic" || kind === "pieRose") {
    const sum = rows.reduce((total, row) => total + row.value, 0) || 1;
    const colors = pieColors(color);
    let start = -90;
    const wedges = rows.map((row, index) => {
      const sweep = row.value / sum * 360, end = start + sweep;
      const r = kind === "pieRose" ? 26 + row.value / max * 44 : 62;
      const path = wedgePath(120, 95, r, start, Math.max(end, start + .5));
      start = end;
      return `<path d="${path}" fill="${colors[index % colors.length]}" opacity="${kind === "pieRose" ? .9 : .95}" stroke="#101216" stroke-width="1.5"/>`;
    }).join("");
    return `${wedges}${pieLegend(rows, colors)}`;
  }

  // ── 雷达图 ──
  if (kind === "radar" || kind === "radarFilled") {
    const count = Math.max(3, rows.length);
    const cx = 190, cy = 100, R = 72, rMax = Math.max(1, ...rows.map((row) => row.value));
    const axis = (i: number) => -90 + i * 360 / count;
    const rings = [1, 2, 3, 4].map((level) =>
      `<polygon points="${Array.from({ length: count }, (_, i) => polar(cx, cy, R * level / 4, axis(i)).join(",")).join(" ")}" fill="none" stroke="#a4c4e326"/>`).join("");
    const spokes = rows.map((_, i) => {
      const [x, y] = polar(cx, cy, R, axis(i));
      const [lx, ly] = polar(cx, cy, R + 15, axis(i));
      return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#a4c4e31e"/><text x="${lx}" y="${n1(ly + 4)}" text-anchor="middle" fill="#90acc1" font-size="11">${escapeXml(rows[i].name)}</text>`;
    }).join("");
    const shape = rows.map((row, i) => polar(cx, cy, Math.max(2, row.value / rMax * R), axis(i)).join(",")).join(" ");
    const fill = kind === "radarFilled" ? `<polygon points="${shape}" fill="${color}" opacity=".28"/><polygon points="${shape}" fill="none" stroke="${color}" stroke-width="2"/>` : `<polygon points="${shape}" fill="none" stroke="${color}" stroke-width="2"/>${rows.map((row, i) => { const [x, y] = polar(cx, cy, Math.max(2, row.value / rMax * R), axis(i)); return `<circle cx="${x}" cy="${y}" r="3" fill="${color}"/>`; }).join("")}`;
    return `${rings}${spokes}${fill}`;
  }

  // ── 仪表盘 ──
  if (kind === "gauge") {
    const f = Math.min(1, Math.max(0, rows[0]?.value ?? 0) / 100);
    const cx = 200, cy = 106, r = 62;
    const start = 150, sweep = 240;
    return `<path d="${arcPath(cx, cy, r, start, start + sweep)}" stroke="#243244" stroke-width="13" fill="none" stroke-linecap="round"/>
      ${f > 0 ? `<path d="${arcPath(cx, cy, r, start, start + sweep * f)}" stroke="${color}" stroke-width="13" fill="none" stroke-linecap="round"/>` : ""}
      ${[0, .25, .5, .75, 1].map((t) => { const [x1, y1] = polar(cx, cy, r - 11, start + sweep * t), [x2, y2] = polar(cx, cy, r - 20, start + sweep * t); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#7c9eb7" stroke-width="2" opacity=".5"/>`; }).join("")}
      <text x="${cx}" y="${cy + 8}" text-anchor="middle" fill="#e8f2fb" font-size="30" font-weight="600">${Math.round((rows[0]?.value ?? 0) * 10) / 10}</text>
      <text x="${cx}" y="${cy + 34}" text-anchor="middle" fill="#90acc1" font-size="11">${escapeXml(rows[0]?.name ?? "")}</text>`.replace(/\n\s*/g, "");
  }

  // ── 水球图 ──
  if (kind === "waterball") {
    const f = Math.min(1, Math.max(0, rows[0]?.value ?? 0) / 100);
    const cx = 200, cy = 95, r = 62, waveY = n1(cy + r - 2 * r * f);
    return `<defs><clipPath id="dw-clip-waterball"><circle cx="${cx}" cy="${cy}" r="${r - 2}"/></clipPath></defs>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="#12253c" stroke="${color}" stroke-opacity=".55" stroke-width="2"/>
      <g clip-path="url(#dw-clip-waterball)">
        <path d="M${cx - r},${waveY} q${n1(r / 2)},-12 ${r},0 q${n1(r / 2)},12 ${r},0 L${cx + r},${cy + r} L${cx - r},${cy + r} Z" fill="${color}" opacity=".5"/>
        <path d="M${cx - r},${n1(waveY + 7)} q${n1(r / 3)},-9 ${n1(r * 2 / 3)},0 q${n1(r / 3)},9 ${n1(r * 4 / 3)},0 L${cx + r},${cy + r} L${cx - r},${cy + r} Z" fill="${color}" opacity=".3"/>
      </g>
      <text x="${cx}" y="${cy + 5}" text-anchor="middle" fill="#e8f2fb" font-size="26" font-weight="600">${Math.round(f * 100)}%</text>
      <text x="${cx}" y="${cy + 28}" text-anchor="middle" fill="#b8d3e8" font-size="11">${escapeXml(rows[0]?.name ?? "")}</text>`.replace(/\n\s*/g, "");
  }

  // ── 漏斗图 ──
  if (kind === "funnel") {
    const stepY = 118 / Math.max(1, rows.length);
    const layer = rows.map((row, index) => {
      const half = (value: number) => 24 + 96 * value / max;
      const y0 = 30 + index * stepY, y1 = y0 + stepY - 3;
      const w0 = n1(half(row.value)), w1 = n1(half(rows[index + 1]?.value ?? row.value * .72));
      return `<polygon points="${200 - w0},${n1(y0)} ${200 + w0},${n1(y0)} ${200 + w1},${n1(y1)} ${200 - w1},${n1(y1)}" fill="${color}" opacity="${n1(1 - index * .14)}"/>
        <text x="200" y="${n1(y0 + stepY / 2 + 3)}" text-anchor="middle" fill="#dceaf8" font-size="11">${escapeXml(row.name)} ${row.value}</text>`;
    }).join("");
    return layer;
  }

  // ── 热力图 ──
  if (kind === "heatmap") {
    const cols = 7, cellW = 330 / cols, cellH = 118 / Math.max(1, Math.ceil(rows.length / cols));
    const cells = rows.map((row, index) => {
      const c = index % cols, r = Math.floor(index / cols);
      return `<rect x="${n1(46 + c * cellW + 2)}" y="${n1(30 + r * cellH + 2)}" width="${n1(cellW - 4)}" height="${n1(cellH - 4)}" rx="3" fill="${color}" opacity="${n1(.1 + .85 * row.value / max)}"/>`;
    }).join("");
    const labels = names.slice(0, cols).map((name, c) =>
      `<text x="${n1(46 + c * cellW + cellW / 2)}" y="176" text-anchor="middle" fill="#7c9eb7" font-size="9">${escapeXml(name)}</text>`).join("");
    return cells + labels;
  }

  // ── 条形图（横向）──
  if (kind === "barHorizontal" || kind === "barHorizontalStacked") {
    const count = Math.max(1, rows.length);
    const band = 118 / count, barH = band * .6;
    const totals = rows.map((row) => (row.value ?? 0) + (row.value2 ?? 0));
    const totalMax = Math.max(1, ...totals);
    const bars = rows.map((row, index) => {
      const y = 30 + band * index + (band - barH) / 2;
      let cursor = 82;
      const segs = series.map((entry) => {
        const w = entry.values[index] / totalMax * 280;
        const rect = `<rect x="${n1(cursor)}" y="${n1(y)}" width="${n1(Math.max(0, w))}" height="${n1(barH)}" fill="${entry.color}" rx="2"/>`;
        cursor += w;
        return rect;
      }).join("");
      return `<text x="76" y="${n1(y + barH / 2 + 4)}" text-anchor="end" fill="#90acc1" font-size="11">${escapeXml(row.name)}</text>${segs}`;
    }).join("");
    const gridV = [0, 1, 2, 3].map((i) =>
      `<line x1="${82 + 280 * i / 3}" x2="${82 + 280 * i / 3}" y1="28" y2="152" stroke="#a4c4e31e"/><text x="${n1(82 + 280 * i / 3)}" y="166" text-anchor="middle" font-size="10" fill="#7c9eb7">${Math.round(totalMax * i / 3)}</text>`).join("");
    return gridV + bars + (series.length > 1 ? legend(series) : "");
  }

  // ── 双轴图：左轴柱（系列1）+ 右轴折线（系列2）──
  if (kind === "dualAxis") {
    const barMax = Math.max(1, ...series[0].values);
    const lineMax = Math.max(1, ...(series[1]?.values ?? []));
    const right = 352, band = (right - 46) / Math.max(1, names.length);
    const grid2 = [0, 1, 2, 3].map((i) =>
      `<line x1="42" x2="${right}" y1="${30 + i * 40}" y2="${30 + i * 40}" stroke="#a4c4e31e"/><text x="34" y="${34 + i * 40}" text-anchor="end" font-size="10" fill="#7c9eb7">${Math.round(barMax * (1 - i / 3))}</text><text x="${right + 6}" y="${34 + i * 40}" font-size="10" fill="#e8b04b">${Math.round(lineMax * (1 - i / 3))}</text>`).join("");
    const bars = series[0].values.map((v, i) => {
      const w = band * .48, h = v / barMax * 118;
      return `<rect x="${n1(46 + band * i + band * .26)}" y="${n1(150 - h)}" width="${n1(w)}" height="${n1(h)}" fill="${series[0].color}" opacity=".8" rx="2"/>`;
    }).join("");
    const linePts = (series[1]?.values ?? []).map((v, i) => `${n1(46 + band * (i + .5))},${n1(150 - v / lineMax * 118)}`).join(" ");
    const line = series[1] ? `<polyline points="${linePts}" fill="none" stroke="${series[1].color}" stroke-width="2.5"/>${series[1].values.map((v, i) => `<circle cx="${n1(46 + band * (i + .5))}" cy="${n1(150 - v / lineMax * 118)}" r="3.5" fill="#101216" stroke="${series[1].color}" stroke-width="2"/>`).join("")}` : "";
    return grid2 + bars + line + xLabels(names) + legend(series);
  }

  // ── 柱状家族：分组 / 堆叠 / 百分比堆叠 ──
  if (kind === "barGrouped" || kind === "barStacked" || kind === "barPercent") {
    const band = 330 / Math.max(1, names.length);
    const totals = names.map((_, i) => series.reduce((sum, s) => sum + s.values[i], 0));
    const yMax = kind === "barPercent" ? 100 : Math.max(1, ...totals);
    const bars = kind === "barGrouped"
      ? series.map((entry, si) => {
          const barW = band * .62 / series.length;
          return entry.values.map((v, i) => {
            const h = v / yMax * 118;
            return `<rect x="${n1(46 + band * i + band * .19 + barW * si)}" y="${n1(150 - h)}" width="${n1(barW - 2)}" height="${n1(h)}" fill="${entry.color}" rx="1.5"/>`;
          }).join("");
        }).join("")
      : series.map((entry) => {
          const tops = names.map((_, i) => series.slice(0, series.indexOf(entry) + 1).reduce((sum, s) => sum + s.values[i], 0));
          const bases = names.map((_, i) => series.slice(0, series.indexOf(entry)).reduce((sum, s) => sum + s.values[i], 0));
          return entry.values.map((v, i) => {
            const scale = kind === "barPercent" ? 100 / Math.max(1, totals[i]) : 1;
            const y1 = 150 - tops[i] / yMax * 118 * scale, h = Math.max(1, (tops[i] - bases[i]) / yMax * 118 * scale);
            return `<rect x="${n1(46 + band * i + band * .22)}" y="${n1(y1)}" width="${n1(band * .56)}" height="${n1(h)}" fill="${entry.color}"/>`;
          }).join("");
        }).join("");
    return frame(yMax, kind === "barPercent" ? "%" : "") + bars + xLabels(names) + (series.length > 1 ? legend(series) : "");
  }

  // ── 折线家族：平滑 / 多系列 ──
  if (kind === "lineSmooth") {
    return frame(max) + `<path d="M46,150 ${smoothPath(points)}" fill="none" stroke="${color}" stroke-width="3"/>`
      + points.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="#101216" stroke="${color}" stroke-width="2"/>`).join("") + xLabels(names);
  }
  if (kind === "lineMulti") {
    const allMax = Math.max(1, ...series.flatMap((entry) => entry.values));
    const lines = series.map((entry) => {
      const pts = entry.values.map((v, i) => [n1(46 + step * (i + .5)), n1(150 - v / allMax * 118)] as [number, number]);
      return `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${entry.color}" stroke-width="2.5"/>`
        + pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="#101216" stroke="${entry.color}" stroke-width="1.5"/>`).join("");
    }).join("");
    return frame(allMax) + lines + xLabels(names) + (series.length > 1 ? legend(series) : "");
  }

  // ── 面积家族 ──
  if (kind === "area" || kind === "areaGradient") {
    const fill = kind === "areaGradient" ? gradientDef("dw-grad-areaGradient", color, .55, .04) + `<polygon points="46,150 ${points.map((p) => p.join(",")).join(" ")} 376,150" fill="url(#dw-grad-areaGradient)"/>` : `<polygon points="46,150 ${points.map((p) => p.join(",")).join(" ")} 376,150" fill="${color}" opacity=".28"/>`;
    return frame(max) + fill + `<polyline points="${points.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${color}" stroke-width="2.5"/>` + xLabels(names);
  }
  if (kind === "areaStacked") {
    const totals = names.map((_, i) => series.reduce((sum, s) => sum + s.values[i], 0));
    const yMax = Math.max(1, ...totals);
    const areas = series.map((entry) => {
      const si = series.indexOf(entry);
      const tops = names.map((_, i) => series.slice(0, si + 1).reduce((sum, s) => sum + s.values[i], 0));
      const bases = names.map((_, i) => series.slice(0, si).reduce((sum, s) => sum + s.values[i], 0));
      const up = tops.map((v, i) => `${n1(46 + step * (i + .5))},${n1(150 - v / yMax * 118)}`).join(" ");
      const down = [...bases].map((v, i) => `${n1(46 + step * (bases.length - 1 - i + .5))},${n1(150 - v / yMax * 118)}`).join(" ");
      return `<polygon points="${up} ${down}" fill="${entry.color}" opacity=".32"/><polyline points="${up}" fill="none" stroke="${entry.color}" stroke-width="2"/>`;
    }).join("");
    return frame(yMax) + areas + xLabels(names) + (series.length > 1 ? legend(series) : "");
  }

  // ── 散点 / 气泡 ──
  if (kind === "scatter") {
    return frame(max) + rows.map((row, index) =>
      `<circle cx="${n1(46 + step * (index + .5))}" cy="${points[index][1]}" r="4.5" fill="${color}" opacity=".85"/>`).join("") + xLabels(names);
  }
  if (kind === "bubble") {
    const sizeMax = Math.max(1, ...rows.map((row) => row.value2 ?? row.value));
    return frame(max) + rows.map((row, index) => {
      const r = 5 + (row.value2 ?? row.value) / sizeMax * 11;
      return `<circle cx="${n1(46 + step * (index + .5))}" cy="${points[index][1]}" r="${n1(r)}" fill="${color}" opacity=".3" stroke="${color}" stroke-width="1.5"/>`;
    }).join("") + xLabels(names);
  }

  // ── 渐变柱状图 ──
  if (kind === "barGradient") {
    const bars = rows.map((row, index) => {
      const h = row.value / max * 118;
      return `<rect x="${n1(46 + step * index + step * .18)}" y="${n1(150 - h)}" width="${n1(step * .64)}" height="${n1(h)}" fill="url(#dw-grad-barGradient)" rx="3"/>
        <text x="${n1(46 + step * (index + .5))}" y="${n1(144 - h)}" text-anchor="middle" fill="#cfe3f5" font-size="10">${row.value}</text>`;
    }).join("");
    return gradientDef("dw-grad-barGradient", color, .95, .18) + frame(max) + bars + xLabels(names);
  }

  // ── 3D 图表家族：等轴测柱状 + 椭圆挤出饼 / 环 / 玫瑰 ──
  if (kind === "bar3dGrouped" || kind === "bar3dStacked") {
    const DX = 9, DY = 6;
    const shade = (hex: string, amount: number): string => {
      const raw = hex.replace("#", "");
      const channels = [0, 2, 4].map((offset) => parseInt(raw.slice(offset, offset + 2), 16) || 0);
      const target = amount >= 0 ? 255 : 0;
      return `#${channels.map((channel) => Math.round(channel + (target - channel) * Math.abs(amount)).toString(16).padStart(2, "0")).join("")}`;
    };
    const band = 330 / Math.max(1, names.length);
    const totals = names.map((_, i) => series.reduce((sum, s) => sum + s.values[i], 0));
    const yMax = Math.max(1, ...totals);
    const faces: string[] = [];
    // 深度向右上方退去：右边的柱更远，先画远处的柱（从右往左），左侧柱的顶/侧面才能正确遮挡
    const bar3d = (x: number, w: number, top: number, height: number, fill: string) => {
      if (height <= 0.5) return;
      const y = 150 - top / yMax * 118, hh = height / yMax * 118;
      faces.push(`<polygon points="${n1(x)},${n1(y)} ${n1(x + w)},${n1(y)} ${n1(x + w + DX)},${n1(y - DY)} ${n1(x + DX)},${n1(y - DY)}" fill="${shade(fill, .32)}"/>`);
      faces.push(`<polygon points="${n1(x + w)},${n1(y)} ${n1(x + w + DX)},${n1(y - DY)} ${n1(x + w + DX)},${n1(y + hh - DY)} ${n1(x + w)},${n1(y + hh)}" fill="${shade(fill, -.3)}"/>`);
      faces.push(`<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(hh)}" fill="${fill}"/>`);
    };
    if (kind === "bar3dGrouped") {
      const barW = band * .58 / series.length;
      for (let i = names.length - 1; i >= 0; i--) {
        for (let si = series.length - 1; si >= 0; si--) {
          bar3d(46 + band * i + band * .21 + barW * si, barW - 2, series[si].values[i], series[si].values[i], series[si].color);
        }
      }
    } else {
      for (let i = names.length - 1; i >= 0; i--) {
        for (let si = 0; si < series.length; si++) {
          const tops = series.slice(0, si + 1).reduce((sum, s) => sum + s.values[i], 0);
          const bases = series.slice(0, si).reduce((sum, s) => sum + s.values[i], 0);
          bar3d(46 + band * i + band * .22, band * .56, tops, tops - bases, series[si].color);
        }
      }
    }
    return frame(yMax) + faces.join("") + xLabels(names) + (series.length > 1 ? legend(series) : "");
  }
  if (kind === "pie3d" || kind === "donut3d" || kind === "rose3d" || kind === "roseRing3d") {
    const cx = 106, cy = 92, rx = 70, ry = 31, depth = 13;
    const squish = ry / rx;
    const innerScale = kind === "donut3d" || kind === "roseRing3d" ? .48 : 0;
    const sum = rows.reduce((total, row) => total + row.value, 0) || 1;
    const valueMax = Math.max(1, ...rows.map((row) => row.value));
    const colors = pieColors(color);
    const pointAt = (radius: number, deg: number, dy = 0): [number, number] => {
      const rad = deg * Math.PI / 180;
      return [n1(cx + radius * Math.cos(rad)), n1(cy + radius * squish * Math.sin(rad) + dy)];
    };
    const spanOf = (index: number): [number, number] => {
      if (kind === "rose3d" || kind === "roseRing3d") {
        const step = 360 / Math.max(1, rows.length);
        return [-90 + index * step, -90 + (index + 1) * step];
      }
      let cursor = -90;
      for (let i = 0; i < index; i++) cursor += rows[i].value / sum * 360;
      return [cursor, cursor + rows[index].value / sum * 360];
    };
    const outerOf = (index: number): number =>
      kind === "rose3d" || kind === "roseRing3d" ? rx * (.34 + rows[index].value / valueMax * .66) : rx;
    // 顶面楔形（内半径 > 0 时为环楔），large-arc 支持超过 180° 的扇区
    const topFace = (index: number): string => {
      const [start, end] = spanOf(index), outer = outerOf(index);
      const large = end - start > 180 ? 1 : 0;
      const [x1, y1] = pointAt(outer, start), [x2, y2] = pointAt(outer, end);
      if (!innerScale) return `<path d="M${cx},${cy} L${x1},${y1} A${rx},${ry} 0 ${large} 1 ${x2},${y2}Z" fill="${colors[index % colors.length]}"/>`;
      const [x3, y3] = pointAt(outer * innerScale, end), [x4, y4] = pointAt(outer * innerScale, start);
      return `<path d="M${x1},${y1} A${n1(outer)},${n1(outer * squish)} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${n1(outer * innerScale)},${n1(outer * innerScale * squish)} 0 ${large} 0 ${x4},${y4}Z" fill="${colors[index % colors.length]}"/>`;
    };
    // 侧壁带：只画正对观察者（sin>0）的外弧段；玫瑰环再补内孔上半段的内侧壁
    const wall = (index: number): string => {
      const [start, end] = spanOf(index), outer = outerOf(index);
      const a1 = Math.max(start, 0), a2 = Math.min(end, 180);
      if (a2 - a1 <= 0.01) return "";
      const [x1, y1] = pointAt(outer, a1), [x2, y2] = pointAt(outer, a2);
      const fill = colors[index % colors.length];
      return `<path d="M${x1},${y1} A${n1(outer)},${n1(outer * squish)} 0 0 1 ${x2},${y2} L${x2},${n1(y2 + depth)} A${n1(outer)},${n1(outer * squish)} 0 0 0 ${x1},${n1(y1 + depth)}Z" fill="${fill}" opacity=".55"/>`;
    };
    const innerWall = innerScale ? (() => {
      let out = "";
      for (let index = 0; index < rows.length; index++) {
        const [start, end] = spanOf(index), outer = outerOf(index) * innerScale;
        const a1 = Math.max(start, 180), a2 = Math.min(end, 360);
        if (a2 - a1 <= 0.01) continue;
        const [x1, y1] = pointAt(outer, a1), [x2, y2] = pointAt(outer, a2);
        out += `<path d="M${x1},${y1} A${n1(outer)},${n1(outer * squish)} 0 0 1 ${x2},${y2} L${x2},${n1(y2 + depth)} A${n1(outer)},${n1(outer * squish)} 0 0 0 ${x1},${n1(y1 + depth)}Z" fill="${colors[index % colors.length]}" opacity=".38"/>`;
      }
      return out;
    })() : "";
    const walls = rows.map((_, index) => wall(index)).join("");
    const tops = rows.map((_, index) => topFace(index)).join("");
    return `${innerWall}${walls}${tops}${pieLegend(rows, colors)}`;
  }

  // ── 基础柱状 / 折线（保留原版几何）──
  const grid = frame(max);
  const seriesSvg = kind === "line"
    ? `<polygon points="46,150 ${points.map((p) => p.join(",")).join(" ")} 376,150" fill="${color}" opacity=".12"/><polyline fill="none" stroke="${color}" stroke-width="3" points="${points.map((p) => p.join(",")).join(" ")}"/>`
    : rows.map((row, index) =>
        `<rect x="${n1(46 + step * index + step * .18)}" y="${points[index][1]}" width="${n1(step * .64)}" height="${n1(row.value / max * 118)}" fill="${color}" rx="2"/>`).join("");
  return `${grid}${seriesSvg}${xLabels(names)}`;
}
