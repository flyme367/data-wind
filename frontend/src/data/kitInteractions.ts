import type { SceneNode } from "../types";
import type { Interaction } from "./editor";
import { kitMetadata, kitNumber, kitRecord } from "./kitRuntime";

const events: Record<string, Interaction["event"]> = {
  click: "click", dblclick: "dblclick", mouseEnter: "mouseenter", mouseLeave: "mouseleave",
  appear: "componentEnter", disappear: "componentLeave", select: "componentSelected",
  unselect: "componentUnselected", selectTrigger: "componentSelected", unSelectTrigger: "componentUnselected",
  ClickRowV2Trigger: "itemClick", optionSelectMapping: "itemClick", receiveBehaviorEvent: "custom",
};

function lookupTarget(value: unknown, targets: ReadonlyMap<string, string>): string | undefined {
  const path = kitRecord(value).elementPath;
  if (!Array.isArray(path)) return undefined;
  for (let i = path.length - 1; i >= 0; i--) {
    const target = targets.get(String(path[i]));
    if (target) return target;
  }
  return undefined;
}

/** Translate portable interactions into editor actions, retaining the untouched reference configuration. */
export function importKitInteractions(node: SceneNode, tree: SceneNode[]): Interaction[] {
  const source = kitMetadata(node)?.source;
  const raw = kitRecord(source?.options?.interacts);
  if (!Object.keys(raw).length) return [];
  const targets = new Map(tree.flatMap(item => {
    const uid = kitMetadata(item)?.source.uid;
    return uid ? [[uid, item.id] as const] : [];
  }));
  const rules: Interaction[] = [];
  for (const [key, group] of Object.entries(raw)) {
    const config = kitRecord(group);
    const interactions = Array.isArray(config.interacts) ? config.interacts : [];
    for (const [index, rawItem] of interactions.entries()) {
      const item = kitRecord(rawItem);
      const trigger = kitRecord(item.trigger ?? config.trigger);
      const event = events[String(trigger.name)];
      if (!event) continue;
      const actions = Array.isArray(item.actions) ? item.actions : [item.action];
      for (const [actionIndex, rawAction] of actions.entries()) {
        const action = kitRecord(rawAction), options = kitRecord(action.options);
        const target = options.element ?? options.popupUid;
        const targetIds = (Array.isArray(target) ? target : [target])
          .map(item => lookupTarget(item, targets)).filter((id): id is string => Boolean(id));
        if (target !== undefined && !targetIds.length) continue;
        const rule: Interaction = {
          id: `kit-rule-${key}-${index}-${actionIndex}`, name: String(item.alias || action.name || "交互").slice(0, 100),
          event, action: "none", targetId: targetIds[0] ?? node.id, value: "",
          sequence: options.start === "meanwhile" ? "with" : "after",
          delayMs: Math.min(120_000, Math.max(0, kitNumber(options.delay))),
        };
        const clicked = action.triggerTarget ?? item.triggerTarget;
        if (typeof clicked === "string" && clicked) rule.itemValue = clicked.replace(/-\d+$/, "").slice(0, 300);
        switch (action.name) {
          case "switchState": rule.action = "state"; rule.value = String(options.state ?? ""); break;
          case "switchPopup":
            rule.action = options.operate === "hide" ? "hide" : options.operate === "show" ? "show" : "toggle";
            break;
          case "reloadData": rule.action = "refresh"; break;
          case "editProjectParams": {
            if (!Array.isArray(options["params-key"])) continue;
            const params = Object.fromEntries(options["params-key"].flatMap(key => typeof key === "string"
              && Object.hasOwn(options, `${key}-params-value`) ? [[key, options[`${key}-params-value`]]] : []));
            if (!Object.keys(params).length) continue;
            rule.action = "projectParams";
            rule.value = JSON.stringify(params);
            break;
          }
          case "changeOption": {
            if (!Array.isArray(options.optionKey)) continue;
            const optionPatch = Object.fromEntries(options.optionKey.filter(key => typeof key === "string"
              && Object.hasOwn(options, key)).map(key => [key, options[key]]));
            if (!Object.keys(optionPatch).length) continue;
            rule.action = "modify";
            rule.targetIds = targetIds.length > 1 ? targetIds : undefined;
            rule.value = JSON.stringify({ data: { __kitOptionOverrides: optionPatch } });
            if (rule.value.length > 100_000) continue;
            break;
          }
          case "appear":
            rule.action = "playEntrance";
            rule.animation = "fade";
            rule.animationStack = options["appear-add"] === "stack";
            rule.durationMs = Math.min(120_000, Math.max(0, kitNumber(options.duration, 1000)));
            break;
          case "disappear":
            // A leave event is emitted after visibility changes. Keep its source settings for inspection.
            continue;
          case "custom": {
            let data: Record<string, unknown>;
            if (options.custom === "switchTab") {
              const index = options.tab_index;
              data = index === "next" || index === "previous" ? { __kitTabStep: index === "next" ? 1 : -1 }
                : { __kitOptionOverrides: { "active-index": kitNumber(index) } };
            } else if (["selected", "unSelected", "select", "unselect"].includes(String(options.custom))) {
              const checked = options.custom === "selected" || options.custom === "select";
              data = { __kitOptionOverrides: { checked, "selected-key": checked ? options.buttons_item : "" } };
            } else continue;
            rule.action = "modify";
            rule.value = JSON.stringify({ data });
            break;
          }
          default: continue;
        }
        rules.push(rule);
      }
    }
  }
  return rules.slice(0, 100);
}
