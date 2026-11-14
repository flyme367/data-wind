// 网格线：距离渐隐，X/Z 轴高亮

struct FrameParams {
    vp: mat4x4<f32>, view: mat4x4<f32>, proj: mat4x4<f32>,
    cam_pos: vec4<f32>, misc: vec4<f32>, misc2: vec4<f32>,
    background: vec4<f32>, ground: vec4<f32>,
    light: vec4<f32>, light_color: vec4<f32>,
    light_vp: mat4x4<f32>, shadow: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: FrameParams;

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) world: vec3<f32>,
};

@vertex
fn vs(@location(0) pos: vec3<f32>) -> VsOut {
    var out: VsOut;
    out.clip = frame.vp * vec4<f32>(pos, 1.0);
    out.world = pos;
    return out;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    let r = length(in.world.xz - frame.cam_pos.xz);
    let fade = 1.0 - clamp(r / 140.0, 0.0, 1.0);
    if (abs(in.world.x) < 0.02) {
        return vec4<f32>(0.95, 0.36, 0.36, 0.5 * fade);
    }
    if (abs(in.world.z) < 0.02) {
        return vec4<f32>(0.36, 0.58, 0.95, 0.5 * fade);
    }
    return vec4<f32>(0.62, 0.66, 0.78, 0.16 * fade);
}
