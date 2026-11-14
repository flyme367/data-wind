// 阴影深度：从方向光视角渲染模型实例到深度贴图（仅深度，无片元输出）。

struct FrameParams {
    vp: mat4x4<f32>, view: mat4x4<f32>, proj: mat4x4<f32>,
    cam_pos: vec4<f32>, misc: vec4<f32>, misc2: vec4<f32>,
    background: vec4<f32>, ground: vec4<f32>,
    light: vec4<f32>, light_color: vec4<f32>,
    light_vp: mat4x4<f32>, shadow: vec4<f32>,
};
struct GInstance { center_rot: vec4<f32>, half_sel: vec4<f32>, color: vec4<f32>, rotation: vec4<f32> };
@group(0) @binding(0) var<uniform> frame: FrameParams;
@group(0) @binding(1) var<storage, read> instances: array<GInstance>;

@vertex fn vs(
    @location(0) position: vec3<f32>, @location(3) index: u32,
) -> @builtin(position) vec4<f32> {
    let instance = instances[index];
    let angle = instance.center_rot.w;
    let c = cos(angle); let s = sin(angle);
    let rotation = mat3x3<f32>(vec3<f32>(c,0.0,-s),vec3<f32>(0.0,1.0,0.0),vec3<f32>(s,0.0,c));
    let size = max(abs(instance.half_sel.xyz * 2.0), vec3<f32>(0.001));
    let world = instance.center_rot.xyz + rotate_quat(instance.rotation, position * size);
    return frame.light_vp * vec4<f32>(world,1.0);
}

fn rotate_quat(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
