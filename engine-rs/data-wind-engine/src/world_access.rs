//! Queue World mutations for Bevy and reject callbacks after its World is cleared.

use bevy::prelude::World;
use std::cell::{Cell, RefCell};
use std::rc::Rc;

type PendingOperation = Box<dyn FnOnce(&mut World)>;

#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum Phase {
    #[default]
    Uninitialized,
    Running,
    Closed,
}

#[derive(Default)]
pub(crate) struct WorldAccess {
    phase: Cell<Phase>,
    pending: RefCell<Vec<PendingOperation>>,
}

struct WorldLifetime(Rc<WorldAccess>);

impl Drop for WorldLifetime {
    fn drop(&mut self) {
        self.0.phase.set(Phase::Closed);
        self.0.pending.borrow_mut().clear();
    }
}

impl WorldAccess {
    pub(crate) fn initialized(&self) -> bool {
        self.phase.get() != Phase::Uninitialized
    }

    pub(crate) fn closed(&self) -> bool {
        self.phase.get() == Phase::Closed
    }

    pub(crate) fn has_pending(&self) -> bool {
        !self.pending.borrow().is_empty()
    }

    pub(crate) fn attach(self: &Rc<Self>, world: &mut World) {
        self.phase.set(Phase::Running);
        world.insert_non_send(WorldLifetime(self.clone()));
    }

    pub(crate) fn from_world(world: &World) -> Option<Rc<Self>> {
        world
            .get_non_send::<WorldLifetime>()
            .map(|lifetime| lifetime.0.clone())
    }

    pub(crate) fn enqueue(&self, operation: impl FnOnce(&mut World) + 'static) {
        if !self.closed() {
            self.pending.borrow_mut().push(Box::new(operation));
        }
    }

    pub(crate) fn flush(&self, world: &mut World) {
        let pending = std::mem::take(&mut *self.pending.borrow_mut());
        for operation in pending {
            if self.closed() {
                break;
            }
            operation(world);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy::prelude::Resource;

    #[derive(Default, Resource)]
    struct Counter(u32);

    fn setup() -> (Rc<WorldAccess>, World) {
        let access = Rc::new(WorldAccess::default());
        let mut world = World::new();
        world.init_resource::<Counter>();
        access.attach(&mut world);
        (access, world)
    }

    #[test]
    fn startup_and_reentrant_commands_run_in_order_without_borrowing_the_queue() {
        let (access, mut world) = setup();
        let nested = access.clone();
        access.enqueue(move |world| {
            world.resource_mut::<Counter>().0 += 1;
            nested.enqueue(|world| world.resource_mut::<Counter>().0 += 10);
        });
        access.enqueue(|world| world.resource_mut::<Counter>().0 *= 2);
        assert_eq!(world.resource::<Counter>().0, 0);
        access.flush(&mut world);
        assert_eq!(world.resource::<Counter>().0, 2);
        access.flush(&mut world);
        assert_eq!(world.resource::<Counter>().0, 12);
    }

    #[test]
    fn clearing_the_world_discards_queued_and_late_callbacks() {
        let (access, mut world) = setup();
        access.enqueue(|_| panic!("shutdown discards queued operations"));
        world.clear_all();
        access.enqueue(|_| panic!("closed World rejects new operations"));
        access.flush(&mut world);
        assert!(access.closed());
        assert!(access.pending.borrow().is_empty());
    }

    #[test]
    fn dropping_the_world_closes_the_access_handle() {
        let (access, world) = setup();
        drop(world);
        assert!(access.closed());
        access.enqueue(|_| panic!("dropped World rejects new operations"));
        assert!(access.pending.borrow().is_empty());
    }
}
