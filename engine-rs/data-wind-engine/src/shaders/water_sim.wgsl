// Conservative virtual pipes (height-field shallow water), two dispatches per substep.
struct WaterUniforms {
    info: vec4<u32>, waves: vec4<f32>, optics: vec4<f32>, refraction: vec4<f32>,
    scattering: vec4<f32>, shape: vec4<f32>, simulation: vec4<f32>,
    points: array<vec4<f32>, 32>, sources: array<vec4<f32>, 8>,
};
@group(0) @binding(0) var<uniform> water: WaterUniforms;
@group(0) @binding(1) var<storage, read> input_cells: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> output_cells: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> flux: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> rates: array<f32>;
@group(0) @binding(5) var<uniform> step: vec4<f32>;
const N: u32 = 64u;
fn timestep() -> f32 { return min(clamp(step.x * 0.25, 0.0, 0.025), min(water.simulation.x, water.simulation.y) * 0.02); }
@compute @workgroup_size(8, 8)
fn flow(@builtin(global_invocation_id) gid: vec3<u32>) {
    if any(gid.xy >= vec2<u32>(N)) { return; }
    let i = gid.y * N + gid.x;
    let cell = input_cells[i];
    let offsets = array<vec2<i32>, 4>(vec2(-1, 0), vec2(1, 0), vec2(0, -1), vec2(0, 1));
    let dt = timestep();
    var outflow = vec4(0.0);
    for (var d = 0u; d < 4u; d++) {
        let p = vec2<i32>(gid.xy) + offsets[d];
        if any(p < vec2(0)) || any(p >= vec2<i32>(i32(N))) { continue; }
        let other = input_cells[u32(p.y) * N + u32(p.x)];
        let ratio = select(water.simulation.x / water.simulation.y,
            water.simulation.y / water.simulation.x, d < 2u);
        let wet = max(0.0, cell.x + cell.y - max(cell.y, other.y));
        outflow[d] = max(0.0, flux[i][d] * exp(-dt * 0.8)
            + dt * 9.81 * wet * ratio * (cell.x + cell.y - other.x - other.y));
    }
    let total = dot(outflow, vec4(1.0));
    let scale = min(1.0, cell.x * water.simulation.x * water.simulation.y / max(dt * total, 0.0000001));
    flux[i] = outflow * scale;
}
@compute @workgroup_size(8, 8)
fn integrate(@builtin(global_invocation_id) gid: vec3<u32>) {
    if any(gid.xy >= vec2<u32>(N)) { return; }
    let x = gid.x; let z = gid.y; let i = z * N + x;
    var incoming = vec4(0.0);
    if x > 0u { incoming.x = flux[i - 1u].y; }
    if x + 1u < N { incoming.y = flux[i + 1u].x; }
    if z > 0u { incoming.z = flux[i - N].w; }
    if z + 1u < N { incoming.w = flux[i + N].z; }
    let outgoing = flux[i];
    let cell = input_cells[i];
    let h = max(0.0, cell.x + timestep() / (water.simulation.x * water.simulation.y)
        * (dot(incoming - outgoing, vec4(1.0)) + rates[i]));
    let velocity = vec2(incoming.x + outgoing.y - incoming.y - outgoing.x,
        incoming.z + outgoing.w - incoming.w - outgoing.z)
        / (water.simulation.yx * max(h, 0.01) * 2.0);
    output_cells[i] = vec4(h, cell.y, clamp(velocity, vec2(-20.0), vec2(20.0)));
}
