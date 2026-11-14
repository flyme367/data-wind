// 天空：全屏三角形 + Nishita 大气散射（移植自 bevy_atmosphere 的思路）
// 太阳方向/颜色/强度复用帧 uniform 里的方向光（场景光源节点驱动），
// 编辑器「时间」经 daylight 缩放日光；登录页保留原浅色渐变。

struct FrameParams {
    vp: mat4x4<f32>, view: mat4x4<f32>, proj: mat4x4<f32>,
    cam_pos: vec4<f32>, misc: vec4<f32>, misc2: vec4<f32>,
    background: vec4<f32>, ground: vec4<f32>,
    light: vec4<f32>, light_color: vec4<f32>,
    light_vp: mat4x4<f32>, shadow: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: FrameParams;

struct VsOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) ndc: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
    var p = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0),
    );
    var out: VsOut;
    out.pos = vec4<f32>(p[vi], 1.0, 1.0);
    out.ndc = p[vi];
    return out;
}

// ---------------------------------------------------------------- 常量
const RE: f32 = 6360e3;          // 地球半径
const RA: f32 = 6420e3;          // 大气层顶
const HR: f32 = 7994.0;          // Rayleigh 标高
const HM: f32 = 1200.0;          // Mie 标高
const PI: f32 = 3.14159265;
const BETA_R = vec3<f32>(5.8e-6, 13.5e-6, 33.1e-6);
const BETA_M = vec3<f32>(21e-6, 21e-6, 21e-6);

// ---------------------------------------------------------------- mat4 求逆
fn mat4_inverse(m: mat4x4<f32>) -> mat4x4<f32> {
    let a00 = m[0][0]; let a01 = m[0][1]; let a02 = m[0][2]; let a03 = m[0][3];
    let a10 = m[1][0]; let a11 = m[1][1]; let a12 = m[1][2]; let a13 = m[1][3];
    let a20 = m[2][0]; let a21 = m[2][1]; let a22 = m[2][2]; let a23 = m[2][3];
    let a30 = m[3][0]; let a31 = m[3][1]; let a32 = m[3][2]; let a33 = m[3][3];

    let b00 = a00 * a11 - a01 * a10;
    let b01 = a00 * a12 - a02 * a10;
    let b02 = a00 * a13 - a03 * a10;
    let b03 = a01 * a12 - a02 * a11;
    let b04 = a01 * a13 - a03 * a11;
    let b05 = a02 * a13 - a03 * a12;
    let b06 = a20 * a31 - a21 * a30;
    let b07 = a20 * a32 - a22 * a30;
    let b08 = a20 * a33 - a23 * a30;
    let b09 = a21 * a32 - a22 * a31;
    let b10 = a21 * a33 - a23 * a31;
    let b11 = a22 * a33 - a23 * a32;

    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    let inv = 1.0 / det;

    return mat4x4<f32>(
        (a11 * b11 - a12 * b10 + a13 * b09) * inv,
        (a02 * b10 - a01 * b11 - a03 * b09) * inv,
        (a31 * b05 - a32 * b04 + a33 * b03) * inv,
        (a22 * b04 - a21 * b05 - a23 * b03) * inv,
        (a12 * b08 - a10 * b11 - a13 * b07) * inv,
        (a00 * b11 - a02 * b08 + a03 * b07) * inv,
        (a32 * b02 - a30 * b05 - a33 * b01) * inv,
        (a20 * b05 - a22 * b02 + a23 * b01) * inv,
        (a10 * b10 - a11 * b08 + a13 * b06) * inv,
        (a01 * b08 - a00 * b10 - a03 * b06) * inv,
        (a30 * b04 - a31 * b02 + a33 * b00) * inv,
        (a21 * b02 - a20 * b04 - a23 * b00) * inv,
        (a11 * b07 - a10 * b09 - a12 * b06) * inv,
        (a00 * b09 - a01 * b07 + a02 * b06) * inv,
        (a31 * b01 - a30 * b03 - a32 * b00) * inv,
        (a20 * b03 - a21 * b01 + a22 * b00) * inv,
    );
}

// ---------------------------------------------------------------- Nishita 散射
// dir 与射线同向; nearest=false 时从大气层内侧出发取远端交点
fn ray_sphere(nearest: bool, orig: vec3<f32>, dir: vec3<f32>, radius: f32) -> vec2<f32> {
    let b = 2.0 * dot(dir, orig);
    let c = dot(orig, orig) - radius * radius;
    let d = b * b - 4.0 * c;
    if (d < 0.0) { return vec2<f32>(1e5, -1e5); }
    let sq = sqrt(d);
    let t0 = (-b - sq) / 2.0;
    let t1 = (-b + sq) / 2.0;
    if (nearest) { return vec2<f32>(t0, t1); }
    if (t0 > 0.0) { return vec2<f32>(t0, t1); }
    return vec2<f32>(t1, t1);
}

// 朝太阳方向的 Rayleigh/Mie 光学深度; 被地球遮挡时返回超大值
fn optical_depth(orig: vec3<f32>, sun: vec3<f32>, steps: i32) -> vec2<f32> {
    let shadow = ray_sphere(true, orig, sun, RE);
    if (shadow.x < shadow.y && shadow.y > 0.0) {
        return vec2<f32>(1e9, 1e9);
    }
    let t = ray_sphere(false, orig, sun, RA).y;
    var rayleigh = 0.0;
    var mie = 0.0;
    let step_size = t / f32(steps);
    var pos = orig + sun * (step_size * 0.5);
    for (var i = 0; i < steps; i++) {
        let h = length(pos) - RE;
        rayleigh += exp(-h / HR) * step_size;
        mie += exp(-h / HM) * step_size;
        pos += sun * step_size;
    }
    return vec2<f32>(rayleigh, mie);
}

fn phase_rayleigh(cos: f32) -> f32 {
    return 3.0 / (16.0 * PI) * (1.0 + cos * cos);
}

fn phase_mie(cos: f32) -> f32 {
    let g = 0.76;
    let g2 = g * g;
    return 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + cos * cos))
        / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * cos, 1.5));
}

// dir: 已归一化的世界空间视线方向
fn atmosphere(dir: vec3<f32>, sun: vec3<f32>, sun_color: vec3<f32>) -> vec3<f32> {
    let origin = vec3<f32>(0.0, RE + 2.0, 0.0);
    let t = ray_sphere(false, origin, dir, RA).y;

    let primary_steps = 16;
    let step_size = (t - 2.0) / f32(primary_steps);
    var pos = origin + dir * 2.0;

    var total_r = vec3<f32>(0.0);
    var total_m = 0.0;
    var od_r = 0.0;
    var od_m = 0.0;

    let cos_theta = dot(dir, sun);
    let mu_r = phase_rayleigh(cos_theta);
    let mu_m = phase_mie(cos_theta);

    for (var i = 0; i < primary_steps; i++) {
        let h = length(pos) - RE;
        let hr = exp(-h / HR) * step_size;
        let hm = exp(-h / HM) * step_size;
        od_r += hr;
        od_m += hm;

        let light_od = optical_depth(pos, sun, 6);
        if (light_od.x < 1e8) {
            let tau = BETA_R * (od_r + light_od.x) + BETA_M * 1.1 * (od_m + light_od.y);
            let attenuation = vec3<f32>(exp(-tau.x), exp(-tau.y), exp(-tau.z));
            total_r += attenuation * hr;
            total_m += attenuation.x * hm;
        }
        pos += dir * step_size;
    }

    return sun_color * (total_r * BETA_R * mu_r + vec3<f32>(total_m * BETA_M.x * mu_m));
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    let t = clamp(in.ndc.y * 0.5 + 0.5, 0.0, 1.0);
    if (frame.misc.y >= 0.5) {
        // 登录页：浅灰白渐变（偏冷）——保持原样
        let top = vec3<f32>(0.955, 0.958, 0.972);
        let bottom = vec3<f32>(0.885, 0.892, 0.925);
        return vec4<f32>(mix(bottom, top, t), 1.0);
    }

    // 编辑器：Nishita 大气天空。从 NDC 重建世界射线
    let inv_vp = mat4_inverse(frame.vp);
    let p_near = inv_vp * vec4<f32>(in.ndc, -1.0, 1.0);
    let p_far = inv_vp * vec4<f32>(in.ndc, 1.0, 1.0);
    let dir = normalize(p_far.xyz / p_far.w - p_near.xyz / p_near.w);

    let sun = normalize(frame.light.xyz);
    let daylight = clamp(frame.misc2.z, 0.1, 1.0);
    let sun_color = frame.light_color.rgb * frame.light.w * daylight;

    var color: vec3<f32>;
    if (dir.y >= -0.02) {
        // 天空：单次散射；太阳落到地平线以下时散射自然趋零
        let scattered = atmosphere(dir, sun, sun_color);
        let atmo = scattered / (1.0 + scattered) * 1.5;    // Reinhard 风格 tone map
        // 夜幕兜底：太阳低于地平线后混入背景色，深色主题依旧成立
        let night = smoothstep(0.02, -0.2, sun.y);
        let night_sky = frame.background.rgb * (0.55 + 0.45 * t);
        color = mix(atmo, night_sky, night);
    } else {
        // 地平线以下：地面色 + 轻微雾化衔接
        let fog = clamp(-dir.y * 6.0, 0.0, 1.0);
        color = mix(mix(frame.background.rgb, frame.ground.rgb, 0.6), frame.ground.rgb, fog);
    }
    return vec4<f32>(color, 1.0);
}
