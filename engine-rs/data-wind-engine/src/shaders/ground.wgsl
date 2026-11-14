// 地面：大面积柔和底面 + 中心光晕

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
    @location(1) light_pos: vec3<f32>,
};

@vertex
fn vs(@location(0) pos: vec3<f32>) -> VsOut {
    var out: VsOut;
    out.clip = frame.vp * vec4<f32>(pos, 1.0);
    out.world = pos;
    let lp = frame.light_vp * vec4<f32>(pos, 1.0);
    out.light_pos = lp.xyz / lp.w;
    return out;
}

@group(0) @binding(7) var shadow_tex: texture_depth_2d;
@group(0) @binding(8) var shadow_sampler: sampler_comparison;

fn shadow_factor(lp: vec3<f32>) -> f32 {
    if (frame.shadow.x < 0.5) { return 1.0; }
    let uv = lp.xy * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5, 0.5);
    let ref_depth = lp.z - frame.shadow.y;
    if (all(uv > vec2<f32>(0.004)) && all(uv < vec2<f32>(0.996)) && ref_depth > 0.0) {
        let texel = frame.shadow.z / 2048.0;
        var sum = 0.0;
        for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
                sum += textureSampleCompareLevel(shadow_tex, shadow_sampler,
                    uv + vec2<f32>(f32(dx), f32(dy)) * texel, ref_depth);
            }
        }
        return sum / 9.0;
    }
    return 1.0;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    let r2 = dot(in.world.xz, in.world.xz);
    if (frame.misc.y < 0.5) {
        if (frame.ground.w < 0.5) { discard; }
        // 编辑器：深色 GIS 底面（接收模型阴影）
        let s = shadow_factor(in.light_pos);
        let base = frame.ground.rgb * (0.25 + frame.misc2.z * 0.75) * mix(0.62, 1.0, s);
        let lift = base * 1.2;
        return vec4<f32>(mix(base, lift, exp(-r2 * 0.004)), 1.0);
    }
    // 登录页：白色展台底面 + 中心柔和阴影
    let base = vec3<f32>(0.955, 0.958, 0.972);
    let edge = vec3<f32>(0.90, 0.908, 0.935);
    let shadow = exp(-r2 * 0.012);
    let col = mix(base, edge, clamp(r2 / 3200.0, 0.0, 1.0));
    return vec4<f32>(mix(col, vec3<f32>(0.86, 0.865, 0.895), shadow * 0.55), 1.0);
}
