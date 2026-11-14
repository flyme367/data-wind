export type KitChoiceOptionKey = "button-name-option" | "dropdown-value-text-option";

/** Keep the selected option and per-option linkage values attached to their rows when edited. */
export function kitChoiceEditPatch(options: Record<string, unknown>, key: KitChoiceOptionKey,
  next: string[], previousIndices: number[]): Record<string, unknown> {
  const previous = Array.isArray(options[key]) ? options[key].map(String) : [];
  const patch: Record<string, unknown> = { [key]: next };
  const saved = key === "button-name-option" && Array.isArray(options["last-button-list"])
    ? options["last-button-list"].map(value => value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : {}) : [];
  const previousKey = (index: number) => saved[index]?.label === previous[index] && typeof saved[index]?.key === "string"
    ? String(saved[index]!.key) : `${previous[index]}-${index}`;
  if (key === "button-name-option") {
    const selected = previous.findIndex((_, index) => previousKey(index) === options["selected-key"]);
    if (selected >= 0) {
      const index = previousIndices.indexOf(selected);
      patch["selected-key"] = index >= 0 ? `${next[index]}-${index}` : "";
    }
    const remapped = new Map<string, string>();
    previousIndices.forEach((oldIndex, index) => {
      if (oldIndex >= 0 && oldIndex < previous.length) remapped.set(previousKey(oldIndex), `${next[index]}-${index}`);
    });
    const cluster = options["item-style-cluster"];
    if (cluster && typeof cluster === "object" && !Array.isArray(cluster)) {
      const styles = structuredClone(cluster as Record<string, unknown>);
      const oldKeys = new Set(previous.map((_, index) => previousKey(index)));
      const removed = new Set<string>();
      for (const [id, value] of Object.entries(styles)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const item = value as Record<string, unknown>;
        const itemKey = item["item-key"];
        if (typeof itemKey === "string" && oldKeys.has(itemKey)) {
          const replacement = remapped.get(itemKey);
          if (replacement === undefined) { delete styles[id]; removed.add(id); }
          else item["item-key"] = replacement;
        }
      }
      if (removed.size && Array.isArray(styles.indexes)) styles.indexes = styles.indexes.filter(id => !removed.has(String(id)));
      patch["item-style-cluster"] = styles;
    }
    if (Array.isArray(options["last-button-list"])) patch["last-button-list"] = next.map((label, index) => {
      const oldIndex = previousIndices[index] ?? -1;
      const item = saved[oldIndex] ?? {};
      return { ...item, label, key: `${label}-${index}`,
        value: item.value === undefined || item.value === previous[oldIndex] ? label : item.value };
    });
  } else {
    const selected = typeof options["dropdown-default-value"] === "string"
      ? previous.indexOf(options["dropdown-default-value"] as string) : -1;
    if (selected >= 0) {
      const index = previousIndices.indexOf(selected);
      patch["dropdown-default-value"] = index >= 0 ? next[index]
        : options["show-default-option"] === true ? "___default___" : "";
    }
  }
  const linkKey = key === "button-name-option" ? "linkage-values" : "relationship-values";
  const value = options[linkKey];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const original = value as Record<string, unknown>;
    const oldKeys = new Set(previous.map((label, index) => key === "button-name-option" ? previousKey(index) : `${label}-${index}`));
    const entries = Object.entries(original).filter(([name]) => !oldKeys.has(name));
    previousIndices.forEach((oldIndex, index) => {
      if (oldIndex < 0 || oldIndex >= previous.length) return;
      const oldKey = key === "button-name-option" ? previousKey(oldIndex) : `${previous[oldIndex]}-${oldIndex}`;
      if (Object.hasOwn(original, oldKey)) entries.push([`${next[index]}-${index}`, original[oldKey]]);
    });
    patch[linkKey] = Object.fromEntries(entries);
  }
  return patch;
}
