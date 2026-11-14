use egui::{Color32, Painter, Pos2, Rect, Shape, Stroke, pos2, vec2};
use serde_json::{Value, json};

use super::widgets::{centered, label, line};
use super::{BoardNode, BoardScene, Clock, MUTED, color, number, string};

pub(super) struct Country {
    name: String,
    name_zh: String,
    /// 数据来源（world/china/usa），山海鲸「地图区域」子集过滤用。
    dataset: String,
    polygons: Vec<(Vec<Pos2>, Vec<u32>)>,
    rings: Vec<Vec<Pos2>>,
    /// 原始经纬环（与 rings 一一对应），区域视图（中国/美国墨卡托）按需重投影。
    lonlat: Vec<Vec<(f32, f32)>>,
    /// 经纬空间三角剖分（顶点 = [lon, lat]，与 polygons 同一份索引），
    /// 山海鲸「轮廓/瓦片地图」的区域视图重投影无需重新 earcut。
    lonlat_triangles: Vec<(Vec<(f32, f32)>, Vec<u32>)>,
}

/// 把已验证的 wire::GeoJsonDocument 还原成 `set_geojson` 消费的 GeoJSON 形状。
/// 坐标永远是 `[lon, lat]` 对，规模受 TS 端编码约束（≤300 要素、≤20000 点/环）。
pub(crate) fn geojson_value_from_wire(
    payload: crate::protocol::wire::GeoJsonDocument<'_>,
) -> Value {
    let features: Vec<Value> = payload
        .features()
        .map(|features| {
            features
                .iter()
                .filter_map(|feature| {
                    let polygons: Vec<Value> = feature
                        .polygons()
                        .map(|polygons| {
                            polygons
                                .iter()
                                .filter_map(polygon_value_from_wire)
                                .collect()
                        })
                        .unwrap_or_default();
                    if polygons.is_empty() {
                        return None;
                    }
                    let (geometry_type, coordinates) = if polygons.len() == 1 {
                        ("Polygon", polygons.into_iter().next()?)
                    } else {
                        ("MultiPolygon", Value::Array(polygons))
                    };
                    let name = feature.name().unwrap_or_default();
                    let name_zh = feature.name_zh().unwrap_or_default();
                    let dataset = feature.dataset().unwrap_or_default();
                    Some(json!({
                        "geometry": {"type": geometry_type, "coordinates": coordinates},
                        "properties": {"NAME": name, "NAME_ZH": name_zh, "DATASET": dataset},
                    }))
                })
                .collect()
        })
        .unwrap_or_default();
    json!({"features": features})
}

fn polygon_value_from_wire(polygon: crate::protocol::wire::Polygon<'_>) -> Option<Value> {
    let rings: Vec<Value> = polygon
        .rings()?
        .iter()
        .filter_map(|ring| {
            let coords: Vec<f32> = ring.points()?.iter().collect();
            if coords.len() < 2 {
                return None;
            }
            Some(Value::Array(
                coords
                    .chunks_exact(2)
                    .map(|pair| json!([pair[0], pair[1]]))
                    .collect(),
            ))
        })
        .collect();
    (!rings.is_empty()).then_some(Value::Array(rings))
}

impl BoardScene {
    /// CommandRequest(GeoJsonDocument) 入口；内部还原成 GeoJSON 形状后走原消费路径。
    pub fn set_geojson_wire(
        &mut self,
        payload: crate::protocol::wire::GeoJsonDocument<'_>,
    ) -> Result<(), String> {
        self.set_geojson(geojson_value_from_wire(payload))
    }

    pub fn set_geojson(&mut self, data: Value) -> Result<(), String> {
        let features = data["features"].as_array().ok_or("地图数据缺少 features")?;
        let mut countries = Vec::new();
        for feature in features.iter().take(300) {
            let geometry = &feature["geometry"];
            let raw = &geometry["coordinates"];
            let polygons = if geometry["type"] == "Polygon" {
                vec![raw]
            } else if geometry["type"] == "MultiPolygon" {
                raw.as_array()
                    .map(|a| a.iter().collect())
                    .unwrap_or_default()
            } else {
                continue;
            };
            let mut country = Country {
                name: string(&feature["properties"]["NAME"]),
                name_zh: string(&feature["properties"]["NAME_ZH"]),
                dataset: string(&feature["properties"]["DATASET"]),
                polygons: Vec::new(),
                rings: Vec::new(),
                lonlat: Vec::new(),
                lonlat_triangles: Vec::new(),
            };
            for polygon in polygons {
                let Some(rings) = polygon.as_array() else {
                    continue;
                };
                let mut vertices: Vec<f64> = Vec::new();
                let mut holes = Vec::new();
                let mut lonlat_rings: Vec<Vec<(f32, f32)>> = Vec::new();
                for (index, ring) in rings.iter().enumerate() {
                    let Some(ring) = ring.as_array() else {
                        continue;
                    };
                    let mut lonlats: Vec<(f32, f32)> = Vec::new();
                    for p in ring.iter().take(20000) {
                        let (Some(lon), Some(lat)) = (p[0].as_f64(), p[1].as_f64()) else {
                            continue;
                        };
                        if !lon.is_finite() || !lat.is_finite() {
                            continue;
                        }
                        let (lon, lat) = (lon as f32, lat as f32);
                        if lonlats.last() == Some(&(lon, lat)) {
                            continue;
                        }
                        lonlats.push((lon, lat));
                    }
                    if lonlats.len() >= 2 && lonlats.first() == lonlats.last() {
                        lonlats.pop();
                    }
                    if lonlats.len() < 3 {
                        continue;
                    }
                    if index > 0 {
                        holes.push(vertices.len() / 2);
                    }
                    for (lon, lat) in &lonlats {
                        vertices.extend_from_slice(&[f64::from(*lon), f64::from(*lat)]);
                    }
                    lonlat_rings.push(lonlats);
                }
                // 经纬空间与等距圆柱投影只差一个线性变换，三角剖分结果一致：
                // 旧六类用投影顶点 + 同一份索引；区域视图用经纬顶点按需重投影。
                let triangles = earcutr::earcut(&vertices, &holes, 2).map_err(|e| e.to_string())?;
                let indices: Vec<u32> = triangles.into_iter().map(|i| i as u32).collect();
                country.polygons.push((
                    vertices
                        .chunks_exact(2)
                        .map(|v| project(v[0] as f32, v[1] as f32))
                        .collect(),
                    indices.clone(),
                ));
                for ring in &lonlat_rings {
                    country
                        .rings
                        .push(ring.iter().map(|(lon, lat)| project(*lon, *lat)).collect());
                }
                country.lonlat = lonlat_rings;
                country.lonlat_triangles.push((
                    vertices
                        .chunks_exact(2)
                        .map(|v| (v[0] as f32, v[1] as f32))
                        .collect(),
                    indices,
                ));
            }
            countries.push(country);
        }
        self.countries = countries;
        Ok(())
    }

    pub(super) fn paint_map(&self, p: &Painter, node: &BoardNode, bounds: Rect, clock: &Clock) {
        let fit = (bounds.width() / 720.0)
            .min(bounds.height() / 360.0)
            .max(0.0);
        let rect = Rect::from_center_size(bounds.center(), vec2(720.0, 360.0) * fit);
        p.rect_filled(rect, 0.0, color("#0d1c30"));
        if self.countries.is_empty() {
            centered(
                p,
                rect,
                13.0,
                self.statuses
                    .get(&node.id)
                    .map(String::as_str)
                    .unwrap_or("正在加载地图…"),
                MUTED,
            );
            return;
        }
        let at = |v: Pos2| rect.min + v.to_vec2() * fit;
        let rows: &[Value] = node.data["rows"].as_array().map_or(&[], Vec::as_slice);
        let maximum = rows
            .iter()
            .map(|r| number(&r["value"], 0.0))
            .fold(1.0_f32, f32::max);
        let tint = color(&node.color);
        for country in &self.countries {
            let value = rows
                .iter()
                .take(60)
                .find(|r| {
                    r["name"]
                        .as_str()
                        .is_some_and(|name| name == country.name || name == country.name_zh)
                })
                .map(|r| number(&r["value"], 0.0));
            let fill = if node.widget.kind == "mapRegion" {
                value.map_or(color("#1b3350"), |v| {
                    tint.gamma_multiply(0.25 + v / maximum * 0.75)
                })
            } else {
                color("#1b3350")
            };
            for (points, indices) in &country.polygons {
                let mut mesh = egui::Mesh::default();
                mesh.vertices
                    .extend(points.iter().map(|point| egui::epaint::Vertex {
                        pos: at(*point),
                        uv: egui::epaint::WHITE_UV,
                        color: fill,
                    }));
                mesh.indices.clone_from(indices);
                p.add(Shape::mesh(mesh));
            }
            for ring in &country.rings {
                for (a, b) in ring
                    .iter()
                    .zip(ring.iter().cycle().skip(1))
                    .take(ring.len())
                {
                    let (a, b) = (at(*a), at(*b));
                    // Tiny coast segments can collapse to identical screen pixels after scaling.
                    if a.distance_sq(b) > 0.01 {
                        line(p, a, b, 0.6, color("#2c4a6e"));
                    }
                }
            }
        }
        for longitude in (-150..=180).step_by(30) {
            line(
                p,
                at(project(longitude as f32, 90.0)),
                at(project(longitude as f32, -90.0)),
                0.6,
                color("#ffffff0c"),
            );
        }
        for latitude in (-60..=60).step_by(30) {
            line(
                p,
                at(project(-180.0, latitude as f32)),
                at(project(180.0, latitude as f32)),
                0.6,
                color("#ffffff0c"),
            );
        }
        let points: Vec<(&Value, Pos2)> = rows
            .iter()
            .take(60)
            .filter_map(|row| {
                let lon = number(&row["lon"], f32::NAN);
                let lat = number(&row["lat"], f32::NAN);
                if !lon.is_finite() || !lat.is_finite() {
                    return None;
                }
                Some((row, at(project(lon, lat))))
            })
            .collect();
        let kind = node.widget.kind.as_str();
        if kind == "mapFlyline" || kind == "mapTrack" {
            for i in 1..points.len() {
                let start = if kind == "mapFlyline" {
                    points[0].1
                } else {
                    points[i - 1].1
                };
                let end = points[i].1;
                let curve: Vec<Pos2> = (0..33)
                    .map(|j| {
                        let t = j as f32 / 32.0;
                        start.lerp(end, t)
                            - vec2(
                                0.0,
                                (std::f32::consts::PI * t).sin() * start.distance(end) * 0.2,
                            )
                    })
                    .collect();
                if kind == "mapTrack" {
                    p.extend(Shape::dashed_line_with_offset(
                        &curve,
                        Stroke::new(1.8, tint),
                        &[7.0],
                        &[5.0],
                        ((clock.now % 420.0) / 35.0) as f32,
                    ));
                } else {
                    p.add(Shape::line(curve, Stroke::new(1.2, tint)));
                }
            }
        }
        if kind != "mapRegion" {
            for (row, point) in points {
                let value = number(&row["value"], 0.0).max(0.0) / maximum;
                if kind == "mapHeat" {
                    for level in (1..=10).rev() {
                        p.circle_filled(
                            point,
                            (4.0 + value * 16.0) * level as f32 / 10.0,
                            Color32::from_rgba_unmultiplied(255, 120, 45, 12),
                        );
                    }
                } else if kind == "mapBar" {
                    p.rect_filled(
                        Rect::from_min_max(
                            point - vec2(3.0, 7.0 + value * 35.0),
                            point + vec2(3.0, 0.0),
                        ),
                        1.0,
                        tint,
                    );
                } else {
                    p.circle_filled(point, 6.0, tint.gamma_multiply(0.22));
                    p.circle_filled(point, 2.0 + value * 2.0, tint);
                    label(
                        p,
                        point + vec2(7.0, -6.0),
                        10.0,
                        string(&row["name"]),
                        MUTED,
                    );
                }
            }
        }
    }
}

fn project(lon: f32, lat: f32) -> Pos2 {
    pos2((lon + 180.0) * 2.0, (90.0 - lat) * 2.0)
}

// ---------------------------------------------------------------------------
// 山海鲸「轮廓地图 / 瓦片地图」：区域视图 + 内置主题（与 frontend mapSvg.ts 同参数同视觉）。
// ---------------------------------------------------------------------------

/// 墨卡托纬度 → 线性 y（与 TS mercatorY 一致）。
fn mercator_y(lat: f32) -> f32 {
    let clamped = lat.clamp(-85.0, 85.0);
    let rad = clamped.to_radians();
    (std::f32::consts::FRAC_PI_4 + rad / 2.0).tan().ln()
}

/// 区域视野：经纬范围与缺省投影（区域子集渲染）。
fn region_view(region: &str) -> (f32, f32, f32, f32, bool) {
    match region {
        // (lonMin, lonMax, latMin, latMax, mercator)
        "china" => (73.4, 135.2, 15.6, 54.3, true),
        "usa" => (-125.6, -65.4, 23.6, 50.6, true),
        _ => (-180.0, 180.0, -90.0, 90.0, false),
    }
}

/// 视野 → 投影闭包：zoom 语义同瓦片（每 +1 经度跨度减半），围绕 centerLon/centerLat 放大。
fn region_projector(
    view: (f32, f32, f32, f32, bool),
    center: Option<(f32, f32)>,
    zoom: f32,
) -> impl Fn(f32, f32) -> Pos2 {
    let (lon_min0, lon_max0, lat_min0, lat_max0, mercator) = view;
    let to_y = if mercator { mercator_y } else { |lat: f32| lat };
    let mut lon_min = lon_min0;
    let mut lon_max = lon_max0;
    let mut top = to_y(lat_max0);
    let mut bottom = to_y(lat_min0);
    let levels = (zoom.max(1.0) - 1.0).max(0.0);
    if levels > 0.0 {
        let factor = 2.0_f32.powf(levels);
        let span_lon = (lon_max - lon_min) / factor;
        let span_lat = (top - bottom) / factor;
        let (default_lon, default_lat) = ((lon_min0 + lon_max0) / 2.0, (lat_min0 + lat_max0) / 2.0);
        let (center_lon, center_lat) = center.unwrap_or((default_lon, default_lat));
        let center_y = to_y(center_lat);
        lon_min = center_lon - span_lon / 2.0;
        lon_max = center_lon + span_lon / 2.0;
        top = center_y + span_lat / 2.0;
        bottom = center_y - span_lat / 2.0;
    }
    let lon_span = (lon_max - lon_min).max(0.0001);
    let lat_span = (top - bottom).max(0.0001);
    move |lon, lat| {
        pos2(
            (lon - lon_min) / lon_span * 720.0,
            (top - to_y(lat)) / lat_span * 360.0,
        )
    }
}

/// 内置主题（瓦片地图变体只是外观不同）：(ocean, land, border, label, graticule, highlight, glow)
fn theme_palette(
    theme: &str,
) -> (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    Option<&'static str>,
) {
    match theme {
        "satellite" => (
            "#0a1a2f",
            "#3d5230",
            "#5d7a48",
            "#d7e6d0",
            "#ffffff08",
            "#ffd66b",
            None,
        ),
        "basic" => (
            "#a8d3e2",
            "#f4f1ea",
            "#c5c2b8",
            "#5a6b7a",
            "#0000000a",
            "#e8912d",
            None,
        ),
        "black-gold" => (
            "#0a0a0c",
            "#16171b",
            "#c9a227",
            "#e8d48b",
            "#c9a22714",
            "#ffd700",
            Some("#c9a227"),
        ),
        "blue-black" => (
            "#080f1e",
            "#0f1c31",
            "#2f5d8a",
            "#8fb8dd",
            "#3f8cff10",
            "#3f8cff",
            Some("#2b6cb0"),
        ),
        "grass-green" => (
            "#07211b",
            "#1d5c38",
            "#3aa065",
            "#bfe6cd",
            "#3aa06512",
            "#a3e635",
            Some("#3aa065"),
        ),
        "light-blue" => (
            "#cfe4f2",
            "#f0f7fc",
            "#8fbedd",
            "#4a6a85",
            "#8fbedd40",
            "#2f7fe8",
            None,
        ),
        "deep-blue" => (
            "#040a16",
            "#0c1a31",
            "#1f3c66",
            "#6d93c4",
            "#1f3c6620",
            "#4da3ff",
            Some("#16365c"),
        ),
        "gis3d-base" => (
            "#050b16",
            "#101d33",
            "#28486e",
            "#7fa8d4",
            "#28486e26",
            "#3f8cff",
            Some("#1d3a5f"),
        ),
        "tech-3d" => (
            "#030812",
            "#0a1830",
            "#19c2ff",
            "#9be4ff",
            "#19c2ff18",
            "#19e0ff",
            Some("#19c2ff"),
        ),
        "realistic-3d" => (
            "#0a1626",
            "#33452c",
            "#54683f",
            "#cfe0c0",
            "#ffffff07",
            "#ffd66b",
            None,
        ),
        _ => (
            "#0d1c30",
            "#1b3350",
            "#2c4a6e",
            "#9fc6e8",
            "#ffffff0d",
            "#6cbcff",
            None,
        ),
    }
}

fn data_group<'a>(node: &'a BoardNode, key: &str) -> &'a Value {
    node.data
        .get(key)
        .filter(|v| v.is_object())
        .unwrap_or(&Value::Null)
}

fn group_string(group: &Value, key: &str, fallback: &str) -> String {
    group[key]
        .as_str()
        .filter(|s| !s.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn group_number(group: &Value, key: &str, fallback: f32) -> f32 {
    number(&group[key], fallback)
}

/// 自定义地图（data.geojson 内嵌 GeoJSON）：解析成 (name, name_zh, lonlat 环) 列表。
fn custom_features(node: &BoardNode) -> Vec<(String, String, Vec<Vec<(f32, f32)>>)> {
    let Some(features) = node.data["geojson"]["features"].as_array() else {
        return Vec::new();
    };
    features
        .iter()
        .take(300)
        .filter_map(|feature| {
            let geometry = &feature["geometry"];
            let raw = &geometry["coordinates"];
            let rings: Vec<Value> = if geometry["type"] == "Polygon" {
                vec![raw.clone()]
            } else if geometry["type"] == "MultiPolygon" {
                raw.as_array()?.iter().cloned().collect()
            } else {
                return None;
            };
            let mut lonlat_rings = Vec::new();
            for polygon in rings {
                let Some(polygon) = polygon.as_array() else {
                    continue;
                };
                for ring in polygon {
                    let Some(ring) = ring.as_array() else {
                        continue;
                    };
                    let mut lonlats: Vec<(f32, f32)> = Vec::new();
                    for p in ring.iter().take(20000) {
                        let (Some(lon), Some(lat)) = (p[0].as_f64(), p[1].as_f64()) else {
                            continue;
                        };
                        if lon.is_finite() && lat.is_finite() {
                            let pair = (lon as f32, lat as f32);
                            if lonlats.last() != Some(&pair) {
                                lonlats.push(pair);
                            }
                        }
                    }
                    if lonlats.len() >= 2 && lonlats.first() == lonlats.last() {
                        lonlats.pop();
                    }
                    if lonlats.len() >= 3 {
                        lonlat_rings.push(lonlats);
                    }
                }
            }
            if lonlat_rings.is_empty() {
                return None;
            }
            let name = string(&feature["properties"]["NAME"]);
            let name_zh = if string(&feature["properties"]["NAME_ZH"]).is_empty() {
                string(&feature["properties"]["name"])
            } else {
                string(&feature["properties"]["NAME_ZH"])
            };
            let name = if name.is_empty() {
                string(&feature["properties"]["name"])
            } else {
                name
            };
            Some((name, name_zh, lonlat_rings))
        })
        .collect()
}

/// 最大子环的质心（鞋带公式，区域名称标注锚点；与 TS ringCentroid 同公式）。
fn ring_centroid(ring: &[(f32, f32)]) -> (f32, f32) {
    let mut sum_x = 0.0_f64;
    let mut sum_y = 0.0_f64;
    let mut sum = 0.0_f64;
    for pair in ring.windows(2) {
        let (x1, y1) = pair[0];
        let (x2, y2) = pair[1];
        let cross = f64::from(x1) * f64::from(y2) - f64::from(x2) * f64::from(y1);
        sum_x += (f64::from(x1) + f64::from(x2)) * cross;
        sum_y += (f64::from(y1) + f64::from(y2)) * cross;
        sum += cross;
    }
    if sum.abs() < 1e-9 {
        return ring.first().copied().unwrap_or((0.0, 0.0));
    }
    ((sum_x / (3.0 * sum)) as f32, (sum_y / (3.0 * sum)) as f32)
}

/// 最大子环（面积最大 = 标注锚点所在环）。
fn largest_ring<'a>(rings: &'a [Vec<(f32, f32)>]) -> &'a [(f32, f32)] {
    let best = rings.iter().max_by_key(|ring| {
        let area: f64 = ring
            .windows(2)
            .map(|pair| {
                f64::from(pair[0].0) * f64::from(pair[1].1)
                    - f64::from(pair[1].0) * f64::from(pair[0].1)
            })
            .sum();
        (area * 1000.0) as i64
    });
    best.map(|ring| ring.as_slice()).unwrap_or(&[])
}

/// 山海鲸「轮廓地图」配置（底图层 → 基本设置）的渲染所需子集。
struct RegionStyle {
    default_fill: Color32,
    highlight: Color32,
    selected: Color32,
    border: Color32,
    border_width: f32,
    border_dotted: bool,
    outline: Color32,
    outline_width: f32,
    glow: Color32,
    glow_strength: f32,
    show_names: bool,
    force_names: bool,
    font_size: f32,
}

/// 主题提供的覆盖（瓦片地图）：陆地填充 / 分界线 / 高亮。
type ThemeColors = (Color32, Color32, Color32);

fn region_style(node: &BoardNode, theme: Option<ThemeColors>) -> RegionStyle {
    let map = data_group(node, "map");
    let pick = |key: &str, fallback: Color32| -> Color32 {
        let value = group_string(map, key, "");
        if value.is_empty() {
            fallback
        } else {
            color(&value)
        }
    };
    RegionStyle {
        default_fill: theme.map(|t| t.0).unwrap_or_else(|| {
            let fallback = group_string(map, "defaultColor", "#1b3350");
            color(&fallback).gamma_multiply(0.45)
        }),
        highlight: pick(
            "highlightColor",
            theme.map(|t| t.2).unwrap_or_else(|| color("#6cbcff")),
        ),
        selected: pick("selectedColor", color("#2f7fe8")),
        border: pick(
            "borderColor",
            theme.map(|t| t.1).unwrap_or_else(|| color("#2c4a6e")),
        ),
        border_width: group_number(map, "borderWidth", 1.0).clamp(0.0, 20.0),
        border_dotted: group_string(map, "borderStyle", "dotted") == "dotted",
        outline: pick("outlineColor", color("#3d6a9e")),
        outline_width: group_number(map, "outlineWidth", 0.0).clamp(0.0, 20.0),
        glow: pick("glowColor", color("#4da3ff")),
        glow_strength: group_number(map, "outlineGlow", 0.0).clamp(0.0, 100.0) / 100.0,
        show_names: map["showRegionNames"].as_bool().unwrap_or(true),
        force_names: map["forceShowNames"].as_bool().unwrap_or(false),
        font_size: group_number(&map["nameFont"], "size", 12.0).clamp(6.0, 72.0),
    }
}

impl BoardScene {
    /// 山海鲸「轮廓地图 / 瓦片地图」：区域子集 + 主题配色 + 区域名称 + 呼吸点层。
    pub(super) fn paint_region(&self, p: &Painter, node: &BoardNode, bounds: Rect, clock: &Clock) {
        let fit = (bounds.width() / 720.0)
            .min(bounds.height() / 360.0)
            .max(0.0);
        let rect = Rect::from_center_size(bounds.center(), vec2(720.0, 360.0) * fit);
        let region = node.data["region"].as_str().unwrap_or("china").to_string();
        let is_tile = node.widget.kind == "mapTile";
        let theme_name = node.data["theme"]
            .as_str()
            .unwrap_or("black-gold")
            .to_string();
        let (ocean, land, border, _label_color, graticule, highlight, glow) =
            theme_palette(&theme_name);
        let projection = node.data["projection"]
            .as_str()
            .unwrap_or("mercator")
            .to_string();
        let view = region_view(&region);
        let mercator = if projection == "equirect" {
            false
        } else {
            view.4
        };
        let view = (view.0, view.1, view.2, view.3, mercator);
        let tile = data_group(node, "tile");
        let center = if tile.as_object().is_some() {
            Some((
                group_number(tile, "centerLon", 10.0),
                group_number(tile, "centerLat", 20.0),
            ))
        } else {
            None
        };
        let zoom = if tile.as_object().is_some() {
            group_number(tile, "zoom", 1.0)
        } else {
            1.0
        };
        let project = region_projector(view, center, zoom);
        let at = |v: Pos2| rect.min + v.to_vec2() * fit;
        let rows: &[Value] = node.data["rows"].as_array().map_or(&[], Vec::as_slice);
        let maximum = rows
            .iter()
            .map(|r| number(&r["value"], 0.0))
            .fold(1.0_f32, f32::max);

        // 背景：瓦片主题 = 主题海色 + 经纬网；轮廓 = defaultColor 压暗
        // 在线影像（JS 合成瓦片纹理 set_image）存在时铺底，跳过海色与经纬网，矢量只叠加边界/标注/高亮
        let imagery = is_tile && self.images.contains_key(&node.id);
        if let Some(texture) = self.images.get(&node.id).filter(|_| imagery) {
            p.image(
                texture.id(),
                rect,
                Rect::from_min_max(Pos2::ZERO, pos2(1.0, 1.0)),
                Color32::WHITE,
            );
        }
        if imagery {
            // 影像纹理已在上方铺底，无需任何整面填充
        } else if is_tile {
            p.rect_filled(rect, 0.0, color(ocean));
            for longitude in (-150..=180).step_by(30) {
                let a = at(project(longitude as f32, -90.0));
                let b = at(project(longitude as f32, 90.0));
                line(p, a, b, 0.6, color(graticule));
            }
            for latitude in (-60..=60).step_by(30) {
                let a = at(project(-180.0, latitude as f32));
                let b = at(project(180.0, latitude as f32));
                line(p, a, b, 0.6, color(graticule));
            }
        } else {
            let style = region_style(node, None);
            p.rect_filled(rect, 0.0, style.default_fill);
        }

        // 要素三角网：自定义地图逐帧解析（小数据量），区域视图重投影经纬顶点
        let custom = region == "custom";
        let customs = if custom {
            custom_features(node)
        } else {
            Vec::new()
        };
        if custom && customs.is_empty() {
            centered(p, rect, 13.0, "请在「地图设置」上传 GeoJSON 文件", MUTED);
            return;
        }
        if !custom && self.countries.is_empty() {
            centered(
                p,
                rect,
                13.0,
                self.statuses
                    .get(&node.id)
                    .map(String::as_str)
                    .unwrap_or("正在加载地图…"),
                MUTED,
            );
            return;
        }

        let style = region_style(
            node,
            is_tile.then(|| (color(land), color(border), color(highlight))),
        );
        let outline_glow_layers = style.outline_width > 0.0 && style.glow_strength > 0.0;

        let paint_feature = |p: &Painter,
                             name: &str,
                             name_zh: &str,
                             triangles: &[(Vec<(f32, f32)>, Vec<u32>)],
                             rings: &[Vec<(f32, f32)>]| {
            let row = rows.iter().take(60).find(|r| {
                r["name"]
                    .as_str()
                    .is_some_and(|n| n == name || n == name_zh)
            });
            let value = row.map(|r| number(&r["value"], 0.0));
            let fill = if imagery {
                // 影像底图：不遮盖影像；rows 命中区域叠半透明主题高亮
                if row.is_some() {
                    style.highlight.gamma_multiply(0.55)
                } else {
                    Color32::TRANSPARENT
                }
            } else if is_tile {
                // 瓦片主题：rows 命中的省/州用主题高亮色（对照山海鲸 GIS 卡片的首都高亮）
                if row.is_some() {
                    style.highlight
                } else {
                    style.default_fill
                }
            } else {
                value.map_or(style.default_fill, |v| {
                    let t = (v / maximum).clamp(0.0, 1.0);
                    mix_color(style.highlight, style.default_fill, 1.0 - t)
                })
            };
            for (vertices, indices) in triangles {
                if fill == Color32::TRANSPARENT {
                    break;
                }
                let mut mesh = egui::Mesh::default();
                mesh.vertices
                    .extend(vertices.iter().map(|(lon, lat)| egui::epaint::Vertex {
                        pos: at(project(*lon, *lat)),
                        uv: egui::epaint::WHITE_UV,
                        color: fill,
                    }));
                mesh.indices.clone_from(indices);
                p.add(Shape::mesh(mesh));
            }
            // 分界线（实线 / 点线）；瓦片主题叠加主题描边光晕
            let width = style.border_width.max(0.4) * fit.max(0.5);
            for ring in rings {
                let points: Vec<Pos2> = ring
                    .iter()
                    .map(|(lon, lat)| at(project(*lon, *lat)))
                    .collect();
                if style.border_dotted {
                    p.extend(Shape::dashed_line_with_offset(
                        &points,
                        Stroke::new(width, style.border),
                        &[2.0],
                        &[2.4],
                        0.0,
                    ));
                } else {
                    for pair in points.windows(2) {
                        line(p, pair[0], pair[1], width, style.border);
                    }
                }
                if let Some(glow_color) = glow.map(color) {
                    for pair in points.windows(2) {
                        line(
                            p,
                            pair[0],
                            pair[1],
                            width + 1.2 * fit.max(0.5),
                            glow_color.gamma_multiply(0.25),
                        );
                    }
                }
                // 「选中时的颜色」：有数据行的区域加一圈选中描边（与 TS 端一致）
                if !is_tile && row.is_some() {
                    let selected_width = style.border_width.max(1.2) * fit.max(0.5);
                    for pair in points.windows(2) {
                        line(
                            p,
                            pair[0],
                            pair[1],
                            selected_width,
                            style.selected.gamma_multiply(0.55),
                        );
                    }
                }
            }
        };

        if custom {
            for (name, name_zh, lonlat_rings) in &customs {
                let triangles = triangulate_lonlat(lonlat_rings);
                paint_feature(p, name, name_zh, &triangles, lonlat_rings);
            }
        } else {
            for country in &self.countries {
                if country.dataset != region {
                    continue;
                }
                paint_feature(
                    p,
                    &country.name,
                    &country.name_zh,
                    &country.lonlat_triangles,
                    &country.lonlat,
                );
            }
        }

        // 外轮廓线 + 发光（仅轮廓地图）
        if !is_tile && style.outline_width > 0.0 {
            let outline_pass = |p: &Painter, width: f32, tint: Color32| {
                if custom {
                    for (_, _, lonlat_rings) in &customs {
                        for ring in lonlat_rings {
                            let points: Vec<Pos2> = ring
                                .iter()
                                .map(|(lon, lat)| at(project(*lon, *lat)))
                                .collect();
                            for pair in points.windows(2) {
                                line(p, pair[0], pair[1], width, tint);
                            }
                        }
                    }
                } else {
                    for country in &self.countries {
                        if country.dataset != region {
                            continue;
                        }
                        for ring in &country.lonlat {
                            let points: Vec<Pos2> = ring
                                .iter()
                                .map(|(lon, lat)| at(project(*lon, *lat)))
                                .collect();
                            for pair in points.windows(2) {
                                line(p, pair[0], pair[1], width, tint);
                            }
                        }
                    }
                }
            };
            if outline_glow_layers {
                for spread in [3.0_f32, 2.0, 1.0] {
                    outline_pass(
                        p,
                        (style.outline_width + spread * 2.0) * fit.max(0.5),
                        style
                            .glow
                            .gamma_multiply(0.3 * style.glow_strength * spread / 3.0),
                    );
                }
            }
            outline_pass(p, style.outline_width * fit.max(0.5), style.outline);
        }

        // 区域名称（有数据行的区域；「强制显示所有区域名称」全量标注）
        if style.show_names {
            let font = style.font_size.max(6.0) * fit.max(0.4);
            let label_tint = mix_color(style.border, Color32::WHITE, 0.55);
            let draw_label = |p: &Painter, name: &str, name_zh: &str, rings: &[Vec<(f32, f32)>]| {
                if rings.is_empty() {
                    return;
                }
                if !style.force_names
                    && !rows.iter().any(|r| {
                        r["name"]
                            .as_str()
                            .is_some_and(|n| n == name || n == name_zh)
                    })
                {
                    return;
                }
                let (lon, lat) = ring_centroid(largest_ring(rings));
                let pos = at(project(lon, lat));
                let text = if name_zh.is_empty() { name } else { name_zh };
                if !text.is_empty() {
                    label(p, pos, font, text, label_tint);
                }
            };
            if custom {
                for (name, name_zh, lonlat_rings) in &customs {
                    draw_label(p, name, name_zh, lonlat_rings);
                }
            } else {
                for country in &self.countries {
                    if country.dataset == region {
                        draw_label(p, &country.name, &country.name_zh, &country.lonlat);
                    }
                }
            }
        }

        // 呼吸点层：rows 带 lon/lat 时渲染，clock 驱动脉冲
        let breath = data_group(node, "breath");
        if breath.as_object().is_some() {
            let breath_color = color(&group_string(breath, "color", "#ffd66b"));
            let min_r = group_number(breath, "minR", 5.0).max(1.0);
            let max_r = group_number(breath, "maxR", 15.0).max(min_r);
            let show_name = breath["showName"].as_bool().unwrap_or(false);
            let pulse = (((clock.now % 1800.0) / 1800.0) * std::f64::consts::TAU).sin() as f32;
            for row in rows.iter().take(60) {
                let (Some(lon), Some(lat)) = (
                    row["lon"].as_f64().map(|v| v as f32),
                    row["lat"].as_f64().map(|v| v as f32),
                ) else {
                    continue;
                };
                if !lon.is_finite() || !lat.is_finite() {
                    continue;
                }
                let point = at(project(lon, lat));
                if !rect.contains(point) {
                    continue;
                }
                let value = (number(&row["value"], 0.0) / maximum).clamp(0.0, 1.0);
                let r = (min_r + (max_r - min_r) * value) * fit.max(0.4);
                let halo = 0.14 + 0.12 * (pulse + 1.0) / 2.0;
                p.circle_filled(point, r * 1.9, breath_color.gamma_multiply(halo));
                p.circle_filled(point, r, breath_color.gamma_multiply(0.9));
                if show_name {
                    label(
                        p,
                        point - vec2(0.0, r + 8.0 * fit.max(0.4)),
                        11.0 * fit.max(0.4),
                        string(&row["name"]),
                        breath_color,
                    );
                }
            }
        }
    }
}

/// 经纬环 → 三角剖分（自定义地图逐帧路径；数据量受上传 1.5MB 约束）。
fn triangulate_lonlat(rings: &[Vec<(f32, f32)>]) -> Vec<(Vec<(f32, f32)>, Vec<u32>)> {
    let mut vertices: Vec<f64> = Vec::new();
    let mut holes = Vec::new();
    for (index, ring) in rings.iter().enumerate() {
        if index > 0 {
            holes.push(vertices.len() / 2);
        }
        for (lon, lat) in ring {
            vertices.extend_from_slice(&[f64::from(*lon), f64::from(*lat)]);
        }
    }
    match earcutr::earcut(&vertices, &holes, 2) {
        Ok(triangles) => vec![(
            vertices
                .chunks_exact(2)
                .map(|v| (v[0] as f32, v[1] as f32))
                .collect(),
            triangles.into_iter().map(|i| i as u32).collect(),
        )],
        Err(_) => Vec::new(),
    }
}

/// sRGB 十六进制线性插值（与 TS mixColor 一致，用于高亮→默认过渡）。
fn mix_color(from: Color32, to: Color32, t: f32) -> Color32 {
    let t = t.clamp(0.0, 1.0);
    let mix =
        |a: u8, b: u8| -> u8 { (f32::from(a) + (f32::from(b) - f32::from(a)) * t).round() as u8 };
    Color32::from_rgb(
        mix(from.r(), to.r()),
        mix(from.g(), to.g()),
        mix(from.b(), to.b()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::wire;

    #[test]
    fn wire_polygons_preserve_geometry_and_renderable_triangles() {
        let mut builder = flatbuffers::FlatBufferBuilder::new();
        let points = builder.create_vector(&[0.0_f32, 0.0, 10.0, 0.0, 0.0, 10.0, 0.0, 0.0]);
        let ring = wire::Ring::create(
            &mut builder,
            &wire::RingArgs {
                points: Some(points),
            },
        );
        let rings = builder.create_vector(&[ring]);
        let polygon =
            wire::Polygon::create(&mut builder, &wire::PolygonArgs { rings: Some(rings) });
        let single = builder.create_vector(&[polygon]);
        let single = wire::GeoFeature::create(
            &mut builder,
            &wire::GeoFeatureArgs {
                polygons: Some(single),
                ..Default::default()
            },
        );
        let multiple = builder.create_vector(&[polygon, polygon]);
        let multiple = wire::GeoFeature::create(
            &mut builder,
            &wire::GeoFeatureArgs {
                polygons: Some(multiple),
                ..Default::default()
            },
        );
        let features = builder.create_vector(&[single, multiple]);
        let document = wire::GeoJsonDocument::create(
            &mut builder,
            &wire::GeoJsonDocumentArgs {
                features: Some(features),
            },
        );
        builder.finish(document, None);
        let payload = flatbuffers::root::<wire::GeoJsonDocument<'_>>(builder.finished_data())
            .expect("valid GeoJSON document");
        let value = geojson_value_from_wire(payload);
        assert_eq!(value["features"][0]["geometry"]["type"], "Polygon");
        assert_eq!(value["features"][1]["geometry"]["type"], "MultiPolygon");
        let mut scene = BoardScene::default();
        scene.set_geojson(value).expect("valid decoded geometry");
        assert_eq!(scene.countries.len(), 2);
        assert_eq!(scene.countries[0].polygons.len(), 1);
        assert_eq!(scene.countries[1].polygons.len(), 2);
        for country in scene.countries {
            for (vertices, indices) in country.polygons {
                assert_eq!(vertices.len(), 3);
                assert_eq!(indices.len(), 3);
            }
        }
    }
}
