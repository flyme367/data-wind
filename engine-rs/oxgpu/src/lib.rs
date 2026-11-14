//! # oxgpu
//!
//! 基于 wgpu 的 storage buffer 计算原语库，为 data-wind 数字孪生引擎提供
//! GPU 计算能力：
//! - [`flyline::FlylineSim`]：飞线粒子沿贝塞尔曲线运动（compute → storage → 渲染直读）
//! - [`culler::FrustumCuller`]：视锥剔除（包围球 × 六平面，atomic 写间接绘制参数）
//!
//! 设计约束：计算结果写入 storage buffer 后由渲染管线的顶点着色器直接读取，
//! 全程零 CPU 回读。

pub mod culler;
pub mod flyline;

pub use culler::{BoundingSphere, CullParams, FrustumCuller};
pub use flyline::{Arc, FlylineSim, ParticleOut};

mod shaders {
    pub const FLYLINE: &str = include_str!("shaders/flyline.wgsl");
    pub const CULL: &str = include_str!("shaders/cull.wgsl");
}

pub(crate) use shaders::{CULL, FLYLINE};
