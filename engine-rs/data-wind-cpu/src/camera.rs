//! 轨道相机（glam）。

use glam::camera::rh::proj::directx::perspective;
use glam::camera::rh::view::look_at_mat4;
use glam::{Mat4, Quat, Vec3, Vec4};

#[derive(Copy, Clone, Debug)]
pub struct Camera {
    pub target: glam::Vec3,
    pub yaw: f32,
    pub pitch: f32,
    pub dist: f32,
}

impl Camera {
    pub fn new(target: Vec3, yaw: f32, pitch: f32, dist: f32) -> Self {
        Self {
            target,
            yaw,
            pitch,
            dist,
        }
    }

    pub fn eye(&self) -> Vec3 {
        let (cp, sp) = (self.pitch.cos(), self.pitch.sin());
        let (cy, sy) = (self.yaw.cos(), self.yaw.sin());
        self.target + self.dist * Vec3::new(sy * cp, sp, cy * cp)
    }

    pub fn view(&self) -> Mat4 {
        look_at_mat4(self.eye(), self.target, Vec3::Y)
    }

    pub fn proj(&self, aspect: f32) -> Mat4 {
        perspective(45f32.to_radians(), aspect, 0.1, 600.0)
    }

    pub fn vp(&self, aspect: f32) -> Mat4 {
        self.proj(aspect) * self.view()
    }

    /// 视锥六平面（WebGPU 0..1 深度），每个平面为 (a,b,c,d)，a*x+b*y+c*z+d >= 0 在内部。
    pub fn frustum_planes(&self, aspect: f32) -> [[f32; 4]; 6] {
        let m = self.vp(aspect).to_cols_array_2d();
        let row = |i: usize| Vec4::new(m[0][i], m[1][i], m[2][i], m[3][i]);
        let r0 = row(0);
        let r1 = row(1);
        let r2 = row(2);
        let r3 = row(3);
        let raw = [
            r3 + r0, // left
            r3 - r0, // right
            r3 + r1, // bottom
            r3 - r1, // top
            r2,      // near (0..1 depth)
            r3 - r2, // far
        ];
        let mut out = [[0f32; 4]; 6];
        for (i, p) in raw.iter().enumerate() {
            let len = p.truncate().length();
            let len = if len > 1e-6 { len } else { 1.0 };
            out[i] = [(p.x / len), (p.y / len), (p.z / len), (p.w / len)];
        }
        out
    }

    /// 屏幕坐标 → 拾取射线（origin, dir）。
    pub fn pick_ray(&self, aspect: f32, x: f64, y: f64, width: f64, height: f64) -> (Vec3, Vec3) {
        let ndc_x = (2.0 * x / width - 1.0) as f32;
        let ndc_y = (1.0 - 2.0 * y / height) as f32;
        let inv = self.vp(aspect).inverse();
        let near = inv * Vec4::new(ndc_x, ndc_y, 0.0, 1.0);
        let far = inv * Vec4::new(ndc_x, ndc_y, 1.0, 1.0);
        let origin = near.truncate() / near.w;
        let far_pt = far.truncate() / far.w;
        (origin, (far_pt - origin).normalize_or_zero())
    }
}

/// Intersection used when moving an object parallel to the ground.
pub fn ray_horizontal_plane(origin: Vec3, direction: Vec3, height: f32) -> Option<Vec3> {
    if direction.y.abs() < 1e-6 || !height.is_finite() {
        return None;
    }
    let distance = (height - origin.y) / direction.y;
    if !distance.is_finite() || !(0.0..=600.0).contains(&distance) {
        return None;
    }
    let point = origin + direction * distance;
    point.is_finite().then_some(point)
}

/// 拾取：绕 Y 旋转的 OBB 盒体。
pub fn ray_box(origin: Vec3, dir: Vec3, center: Vec3, half: Vec3, rot_y: f32) -> Option<f32> {
    ray_oriented_box(origin, dir, center, half, Quat::from_rotation_y(rot_y))
}

/// Ray intersection in the box's local space, using the rendering quaternion.
pub fn ray_oriented_box(
    origin: Vec3,
    dir: Vec3,
    center: Vec3,
    half: Vec3,
    rotation: Quat,
) -> Option<f32> {
    let inverse = rotation.conjugate();
    let o = inverse * (origin - center);
    let d = inverse * dir;
    let mut tmin = 0.0f32;
    let mut tmax = f32::INFINITY;
    for a in 0..3 {
        let (o_a, d_a, h_a) = match a {
            0 => (o.x, d.x, half.x),
            1 => (o.y, d.y, half.y),
            _ => (o.z, d.z, half.z),
        };
        if d_a.abs() < 1e-8 {
            if o_a.abs() > h_a {
                return None;
            }
        } else {
            let mut t1 = (-h_a - o_a) / d_a;
            let mut t2 = (h_a - o_a) / d_a;
            if t1 > t2 {
                std::mem::swap(&mut t1, &mut t2);
            }
            tmin = tmin.max(t1);
            tmax = tmax.min(t2);
            if tmin > tmax {
                return None;
            }
        }
    }
    Some(tmin)
}

/// 拾取：球体。
pub fn ray_sphere(origin: Vec3, dir: Vec3, center: Vec3, radius: f32) -> Option<f32> {
    let oc = origin - center;
    let b = oc.dot(dir);
    let c = oc.length_squared() - radius * radius;
    let disc = b * b - c;
    if disc < 0.0 {
        return None;
    }
    let t = -b - disc.sqrt();
    if t >= 0.0 { Some(t) } else { None }
}
