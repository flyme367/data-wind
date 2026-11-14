import type { Interaction } from "./editor";

export interface EntranceAnimation {
  animation: NonNullable<Interaction["animation"]>;
  easing: NonNullable<Interaction["easing"]>;
  startAt: number;
  delay: number;
  duration: number;
}

const milliseconds = (value: number | undefined, fallback: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(120_000, value!)) : fallback;

/** Keep overlapping animations only when the action explicitly enables stacking. */
export function entranceAnimations(rule: Interaction, previous: unknown, now = Date.now()): EntranceAnimation[] {
  const active = rule.animationStack && Array.isArray(previous)
    ? previous.filter((item): item is EntranceAnimation => item && typeof item === "object"
      && typeof item.startAt === "number" && typeof item.delay === "number" && typeof item.duration === "number"
      && item.startAt + item.delay + item.duration > now).slice(-7)
    : [];
  return [...active, {
    animation: rule.animation ?? "fade", easing: rule.easing ?? "exponentialIn", startAt: now,
    delay: milliseconds(rule.delayMs, 0), duration: milliseconds(rule.durationMs, 1000),
  }];
}

/** Resolve simultaneous groups and sequence later groups after their longest action. */
export function interactionSchedule(rules: Interaction[]): { rule: Interaction; at: number }[] {
  let groupStart = 0, groupEnd = 0;
  return rules.map(rule => {
    if (rule.sequence === "after") groupStart = groupEnd;
    const delay = milliseconds(rule.delayMs, 0);
    const duration = rule.action === "playEntrance" ? milliseconds(rule.durationMs, 1000) : 0;
    const at = groupStart + (rule.action === "playEntrance" ? 0 : delay);
    groupEnd = Math.max(groupEnd, groupStart + delay + duration);
    return { rule, at };
  });
}
