/** Coalesce motion while preserving gesture boundaries and the existing 4px drag threshold. */
export function createPointerInput<T extends { clientX: number; clientY: number }>(consume: (input: T) => void) {
  let pending: T | null = null;
  let gesture: { x: number; y: number; moved: boolean } | null = null;
  const flush = () => {
    const input = pending;
    pending = null;
    if (input) consume(input);
  };
  return {
    start(input: T) {
      flush();
      gesture = { x: input.clientX, y: input.clientY, moved: false };
    },
    push(input: T) {
      pending = input;
      if (gesture && !gesture.moved && Math.hypot(input.clientX - gesture.x, input.clientY - gesture.y) > 4) {
        // Preserve a drag that crosses the threshold then returns before the next frame.
        gesture.moved = true;
        flush();
      }
    },
    end(input?: T) {
      if (input) pending = input;
      flush();
      gesture = null;
    },
    flush,
    clear() { pending = null; gesture = null; },
  };
}
