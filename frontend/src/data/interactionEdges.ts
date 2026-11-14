/** Record the edge before invoking an action, which may synchronously update data again. */
export function triggerDataEdge(matches: Map<string, boolean>, key: string, matched: boolean, trigger: () => void): void {
  const previous = matches.get(key) ?? false;
  matches.set(key, matched);
  if (matched && !previous) trigger();
}
