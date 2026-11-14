struct Camera { vp: mat4x4<f32> };
@group(0) @binding(0) var<uniform> camera: Camera;
struct Out { @builtin(position) position: vec4<f32>, @location(0) xz: vec2<f32>, @location(1) @interpolate(flat) raised: u32 };
@vertex fn vs(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Out {
    let corners = array<vec2<f32>, 6>(vec2(-1.0,-1.0),vec2(-1.0,1.0),vec2(1.0,-1.0),vec2(1.0,-1.0),vec2(-1.0,1.0),vec2(1.0,1.0));
    let xz = corners[vertex] * select(23.0, 3.0, instance == 1u) + select(vec2(0.0), vec2(4.0, 0.0), instance == 1u);
    var out: Out; out.position = camera.vp * vec4(xz.x, select(0.0, 2.0, instance == 1u), xz.y, 1.0);
    out.xz = xz; out.raised = instance; return out;
}
@fragment fn fs(in: Out) -> @location(0) vec4<f32> {
    if in.raised == 1u { return vec4(0.65, 0.18, 0.04, 1.0); }
    let tile = (i32(floor(in.xz.x * 0.3)) + i32(floor(in.xz.y * 0.3))) & 1;
    return vec4(mix(vec3(0.15, 0.18, 0.16), vec3(0.27, 0.30, 0.26), f32(tile)), 1.0);
}
