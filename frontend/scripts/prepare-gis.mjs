import { readFile, writeFile } from 'node:fs/promises';

// Retain the source coordinates locally; derive small, editable glTF outline models.
const root = new URL('../public/', import.meta.url);
const sources = [
  ['ne_110m_land', 'gis-world-land', [.27, .78, .65]],
  ['ne_110m_admin_0_countries', 'gis-world-boundaries', [.27, .62, .94]],
];

for (const [dataset, id, color] of sources) {
  const geojson = JSON.parse(await readFile(new URL(`gis/${dataset}.geojson`, root), 'utf8'));
  const positions = [], colors = [];
  const triangle = (a, b, c, rgb) => {
    positions.push(...a, ...b, ...c);
    colors.push(...rgb, ...rgb, ...rgb);
  };
  const quad = (a, b, c, d, rgb) => {
    triangle(a, b, c, rgb); triangle(a, c, d, rgb);
  };
  const line = (from, to, width, rgb) => {
    const dx = to[0] - from[0], dz = from[1] - to[1];
    const length = Math.hypot(dx, dz);
    if (length < .0001 || Math.abs(dx) > 180) return;
    const nx = -dz / length * width / 2, nz = dx / length * width / 2;
    const a = [from[0] + nx, 1, -from[1] + nz];
    const b = [to[0] + nx, 1, -to[1] + nz];
    const c = [to[0] - nx, 1, -to[1] - nz];
    const d = [from[0] - nx, 1, -from[1] - nz];
    quad(a, b, c, d, rgb);
  };
  const ring = (points, width, rgb) => {
    for (let index = 1; index < points.length; index++) line(points[index - 1], points[index], width, rgb);
  };
  for (const feature of geojson.features) {
    const geometry = feature.geometry;
    if (geometry?.type === 'Polygon') geometry.coordinates.forEach(points => ring(points, 2, color));
    if (geometry?.type === 'MultiPolygon') {
      geometry.coordinates.forEach(polygon => polygon.forEach(points => ring(points, 2, color)));
    }
  }
  const gridColor = [.08, .18, .27];
  for (let longitude = -180; longitude <= 180; longitude += 30) line([longitude, -90], [longitude, 90], .5, gridColor);
  for (let latitude = -90; latitude <= 90; latitude += 30) {
    line([-180, latitude], [0, latitude], .5, gridColor);
    line([0, latitude], [180, latitude], .5, gridColor);
  }
  const vertexCount = positions.length / 3;
  const bin = Buffer.alloc(positions.length * 8);
  positions.forEach((value, index) => bin.writeFloatLE(value, index * 4));
  colors.forEach((value, index) => bin.writeFloatLE(value, positions.length * 4 + index * 4));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  positions.forEach((value, index) => {
    const axis = index % 3;
    min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
  });
  const document = {
    asset: { version: '2.0', generator: 'Data Wind / Natural Earth outline preparation' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length * 4 },
      { buffer: 0, byteOffset: positions.length * 4, byteLength: colors.length * 4 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vertexCount, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: vertexCount, type: 'VEC3' },
    ],
  };
  const jsonText = JSON.stringify(document);
  const json = Buffer.from(jsonText.padEnd(Math.ceil(Buffer.byteLength(jsonText) / 4) * 4, ' '));
  const result = Buffer.alloc(28 + json.length + bin.length);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(json.length, 12); result.writeUInt32LE(0x4e4f534a, 16); json.copy(result, 20);
  result.writeUInt32LE(bin.length, 20 + json.length); result.writeUInt32LE(0x004e4942, 24 + json.length);
  bin.copy(result, 28 + json.length);
  await writeFile(new URL(`../model-sources/${id}.glb`, import.meta.url), result);
  process.stdout.write(`Prepared ${id}: ${vertexCount / 3} triangles\n`);
}
