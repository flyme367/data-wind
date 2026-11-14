//! Avian height-field collision, streamed around the orbit camera's focus point.
//! Each 64 m tile uses only 16 × 16 cells; render rings never become colliders.

use crate::{
    app::{DwViewport, EngineStateHandle},
    common::Mode,
    terrain::TerrainSurface,
};
use avian3d::prelude::{Collider, PhysicsPlugins, RigidBody};
use bevy::prelude::*;
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

const TILE_SIZE: f32 = 64.0;
const COLLISION_CELLS: u32 = 16;

pub(crate) struct TerrainPhysicsPlugin;

impl Plugin for TerrainPhysicsPlugin {
    fn build(&self, app: &mut App) {
        app.add_plugins(PhysicsPlugins::default())
            .add_systems(Update, sync_collision_tiles);
    }
}

struct ActiveTerrain {
    surface: Arc<TerrainSurface>,
    cell: (i32, i32),
    transform: ([f32; 4], [f32; 4], [f32; 4]),
    entities: Vec<Entity>,
}

fn sync_collision_tiles(
    mut commands: Commands,
    state: NonSend<EngineStateHandle>,
    viewports: Query<(), (With<DwViewport>, With<Camera>)>,
    mut active: Local<HashMap<String, ActiveTerrain>>,
) {
    let state = state.borrow();
    let mut retained = HashSet::new();
    if state.mode == Mode::Editor && !viewports.is_empty() {
        for draw in &state.terrains {
            if !draw.surface.config.collision {
                continue;
            }
            let Some(instance) = state.instances_cpu.get(draw.index as usize) else {
                continue;
            };
            let size =
                glam::Vec3::from_array(instance.half_sel[..3].try_into().unwrap_or([0.5; 3]))
                    .abs()
                    .max(glam::Vec3::splat(0.001))
                    * 2.0;
            let position = glam::Vec3::new(
                instance.center_rot[0],
                instance.center_rot[1],
                instance.center_rot[2],
            );
            let rotation = glam::Quat::from_array(instance.rotation);
            let focus = rotation.conjugate() * (state.camera.target - position);
            if focus.x.abs() > size.x * 0.5 + 128.0 || focus.z.abs() > size.z * 0.5 + 128.0 {
                continue;
            }
            retained.insert(draw.id.clone());
            let cell = (
                ((focus.x + size.x * 0.5) / TILE_SIZE).floor() as i32,
                ((focus.z + size.z * 0.5) / TILE_SIZE).floor() as i32,
            );
            // Selection highlighting is stored in half_sel.w and does not affect collision.
            let signature = (
                instance.center_rot,
                [size.x, size.y, size.z, 0.0],
                instance.rotation,
            );
            if active.get(&draw.id).is_some_and(|previous| {
                previous.cell == cell
                    && previous.transform == signature
                    && Arc::ptr_eq(&previous.surface, &draw.surface)
            }) {
                continue;
            }
            if let Some(previous) = active.remove(&draw.id) {
                for entity in previous.entities {
                    commands.entity(entity).despawn();
                }
            }
            let mut entities = Vec::new();
            for z in cell.1 - 1..=cell.1 + 1 {
                for x in cell.0 - 1..=cell.0 + 1 {
                    if x < 0 || z < 0 {
                        continue;
                    }
                    let min = glam::Vec2::new(x as f32, z as f32) * TILE_SIZE;
                    let max =
                        (min + glam::Vec2::splat(TILE_SIZE)).min(glam::Vec2::new(size.x, size.z));
                    if min.x >= max.x || min.y >= max.y {
                        continue;
                    }
                    let extent = max - min;
                    let heights = (0..=COLLISION_CELLS)
                        .map(|ix| {
                            (0..=COLLISION_CELLS)
                                .map(|iz| {
                                    let uv = (min
                                        + extent * glam::Vec2::new(ix as f32, iz as f32)
                                            / COLLISION_CELLS as f32)
                                        / glam::Vec2::new(size.x, size.z);
                                    draw.surface.sample(uv) - 0.5
                                })
                                .collect()
                        })
                        .collect();
                    let center = (min + max) * 0.5 - glam::Vec2::new(size.x, size.z) * 0.5;
                    let center = position + rotation * glam::Vec3::new(center.x, 0.0, center.y);
                    let collider =
                        Collider::heightfield(heights, Vec3::new(extent.x, size.y, extent.y));
                    entities.push(
                        commands
                            .spawn((
                                RigidBody::Static,
                                collider,
                                Transform::from_translation(Vec3::from_array(center.to_array()))
                                    .with_rotation(Quat::from_array(instance.rotation)),
                            ))
                            .id(),
                    );
                }
            }
            active.insert(
                draw.id.clone(),
                ActiveTerrain {
                    surface: draw.surface.clone(),
                    cell,
                    transform: signature,
                    entities,
                },
            );
        }
    }
    active.retain(|id, previous| {
        if retained.contains(id) {
            return true;
        }
        for entity in &previous.entities {
            commands.entity(*entity).despawn();
        }
        false
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        common::FlatInstanceIn, scene::ScenePools, state::EngineState, terrain::TerrainConfig,
    };
    use std::{cell::RefCell, rc::Rc};

    #[test]
    fn heightfield_axes_and_scale_match_the_render_height_source() {
        let heights = (0..=16)
            .map(|x| {
                (0..=16)
                    .map(|z| 0.25 * x as f32 / 16.0 + 0.5 * z as f32 / 16.0 - 0.5)
                    .collect()
            })
            .collect();
        let collider = Collider::heightfield(heights, Vec3::new(64.0, 24.0, 32.0));
        let (distance, _) = collider
            .cast_ray(
                Vec3::ZERO,
                Quat::IDENTITY,
                Vec3::new(-16.0, 40.0, 8.0),
                Vec3::NEG_Y,
                100.0,
                false,
            )
            .expect("hit the sampled height field");
        assert!((distance - 41.5).abs() < 0.001);
    }

    #[test]
    fn avian_tiles_are_reused_and_removed_when_disabled_or_out_of_range() {
        let mut app = App::new();
        let mut state = EngineState::default();
        let flat = FlatInstanceIn {
            id: "ground".into(),
            kind: "terrain".into(),
            pos: [0.0, 12.0, 0.0],
            size: [256.0, 24.0, 256.0],
            rot_y: 0.0,
            rotation: None,
            color: [0.5; 3],
            locked: None,
            to: None,
            model_id: None,
            water: None,
            terrain: Some(TerrainConfig {
                collision: true,
                ..Default::default()
            }),
        };
        state.apply_pools(ScenePools::from_flat(&[flat.clone()]));
        state.camera.target = glam::Vec3::ZERO;
        let state = Rc::new(RefCell::new(state));
        app.world_mut()
            .insert_non_send::<EngineStateHandle>(state.clone());
        app.add_plugins((MinimalPlugins, TransformPlugin, TerrainPhysicsPlugin));
        app.finish();
        app.cleanup();
        app.world_mut().spawn((Camera::default(), DwViewport(0)));
        let colliders = |world: &mut World| -> HashSet<Entity> {
            world
                .query_filtered::<Entity, With<Collider>>()
                .iter(world)
                .collect()
        };
        app.update();
        let first = colliders(app.world_mut());
        assert_eq!(first.len(), 9);
        app.update();
        assert_eq!(
            colliders(app.world_mut()),
            first,
            "stationary frames reuse tiles"
        );
        state.borrow_mut().camera.target.x = 1000.0;
        app.update();
        assert!(
            colliders(app.world_mut()).is_empty(),
            "distant terrain releases tiles"
        );
        state.borrow_mut().camera.target.x = 0.0;
        app.update();
        assert_eq!(colliders(app.world_mut()).len(), 9);
        let mut flat = flat;
        flat.terrain.as_mut().expect("terrain config").collision = false;
        state
            .borrow_mut()
            .apply_pools(ScenePools::from_flat(&[flat]));
        app.update();
        assert!(
            colliders(app.world_mut()).is_empty(),
            "disabled terrain releases tiles"
        );
    }
}
