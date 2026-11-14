import referenceKits from "./referenceKits.json";
import type { SceneNode } from "../types";
import { importKitTemplate, type ReferenceKitWidget } from "./kitRuntime";

export interface KitCatalogEntry {
  id: string;
  referenceId: string;
  label: string;
  thumbnail: string;
  familyId: string;
  familyLabel: string;
  category: string;
  categories: string[];
  sourceUrl: string;
  template: string;
  widgetTypes: string[];
}
export interface KitFamily {
  id: string;
  label: string;
  thumbnail: string;
  categories: string[];
  entries: KitCatalogEntry[];
}
/** Reference order, names, families and category membership are retained verbatim. */
export const kitFamilies: KitFamily[] = referenceKits.families.map(family => ({
  ...family,
  entries: family.entries.map(entry => ({ ...entry, familyId: family.id, familyLabel: family.label })),
}));
export const kitCatalog = kitFamilies.flatMap(family => family.entries);

/** Keep the app and exported viewer portable under a URL subdirectory. */
export const kitAssetUrl = (path: string): string => path.startsWith("/kits/") ? `.${path}` : path;
const templates = new Map<string, Promise<ReferenceKitWidget>>();
export async function loadKitTemplate(entry: KitCatalogEntry): Promise<ReferenceKitWidget> {
  let pending = templates.get(entry.id);
  if (!pending) {
    pending = fetch(kitAssetUrl(entry.template)).then(async response => {
      if (!response.ok) throw new Error(`套件「${entry.label}」加载失败（${response.status}）`);
      const template: unknown = await response.json();
      if (!template || typeof template !== "object" || !("type" in template))
        throw new Error(`套件「${entry.label}」的模板格式无效`);
      return template as ReferenceKitWidget;
    }).catch(error => { templates.delete(entry.id); throw error; });
    templates.set(entry.id, pending);
  }
  return structuredClone(await pending);
}
export function kitNodes(entry: KitCatalogEntry, template: ReferenceKitWidget,
  origin = { x: 80, y: 80 }): SceneNode[] {
  return importKitTemplate(entry, template, origin);
}
