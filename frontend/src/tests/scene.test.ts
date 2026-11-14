import { beforeEach, describe, expect, it } from "vitest";
import { handle, type SceneSnapshot } from "../workers/sceneModel";
import { modelAssetById } from "../data/modelCatalog";
import { modelNode } from "../data/modelNode";
import { widgetNode } from "../data/editor";

const open = (id = "A", tree: SceneSnapshot["tree"] | null = []) =>
  handle({ type: "openProject", projectId: id, tree, template: "empty" })!;
const add = () => handle({ type: "add", node: { type: "model", name: "模型" } })!;
beforeEach(() => open());

describe("project isolation and scene history", () => {
  it("merges consecutive field edits against the authoritative worker state", () => {
    const id = handle({ type: "add", node: widgetNode("progress") })!.selectedId!;
    handle({ type: "patchWidget", id, patch: { text: "运行进度" } });
    handle({ type: "patchWidget", id, patch: { radius: 12 } });
    handle({ type: "patchData", id, patch: { percent: 42 } });
    handle({ type: "patchData", id, patch: { label: "正常" } });
    handle({ type: "patchBindings", id, patch: { text: "label" } });
    handle({ type: "patchBindings", id, patch: { visible: "show" } });
    handle({ type: "setAxis", id, property: "position", axis: "x", value: 100 });
    handle({ type: "setAxis", id, property: "position", axis: "y", value: 200 });
    const rule = { id: "rule", event: "click" as const, action: "message" as const, targetId: id, value: "初始" };
    handle({ type: "addInteraction", id, rule });
    handle({ type: "updateInteraction", id, ruleId: rule.id, patch: { event: "dblclick" } });
    const final = handle({ type: "updateInteraction", id, ruleId: rule.id, patch: { value: "完成" } })!;
    const node = final.tree.find((item) => item.id === id)!;
    expect(node.widget).toMatchObject({ text: "运行进度", radius: 12 });
    expect(node.data).toMatchObject({ percent: 42, label: "正常" });
    expect(node.bindings).toMatchObject({ text: "label", visible: "show" });
    expect(node.transform.position).toMatchObject({ x: 100, y: 200 });
    expect(node.interactions).toEqual([{ ...rule, event: "dblclick", value: "完成" }]);
    expect(handle({ type: "undo" })!.tree.find((item) => item.id === id)!.interactions![0].value).toBe("初始");
  });
  it("opening a new project clears the previous scene, selection, and undo history", () => {
    const first = add();
    expect(first.tree).toHaveLength(1);
    const second = open("B");
    expect(second).toMatchObject({ projectId: "B", tree: [], flat: [], selectedId: null, canUndo: false, canRedo: false });
    expect(handle({ type: "undo" })).toBeNull();
  });
  it("keeps an intentionally empty scene empty when reopening", () => {
    add();
    const cleared = handle({ type: "loadScene", tree: [] })!;
    expect(cleared.tree).toEqual([]);
    expect(open("A", cleared.tree).tree).toEqual([]);
  });
  it("position and geometry changes can both be undone and redone", () => {
    const created = add();
    const id = created.selectedId!;
    handle({ type: "transform", id, position: [8, 9, 10] });
    handle({ type: "geometry", id, boxSize: [7, 6, 5] });
    const undoSize = handle({ type: "undo" })!;
    expect(undoSize.tree[0].boxSize).toEqual({ x: 4, y: 4, z: 4 });
    expect(undoSize.tree[0].transform.position.x).toBe(8);
    const undoMove = handle({ type: "undo" })!;
    expect(undoMove.tree[0].transform.position).toEqual({ x: 0, y: 2, z: 0 });
    expect(handle({ type: "redo" })!.tree[0].transform.position.x).toBe(8);
  });
  it("selection changes do not mark the scene as edited", () => {
    const created = add();
    expect(handle({ type: "select", id: null })!.revision).toBe(created.revision);
    expect(handle({ type: "select", id: "missing" })!.selectedId).toBeNull();
  });
  it("reuses scene geometry for selections and invalidates it for edits and reopening", () => {
    const created = add();
    const selected = handle({ type: "select", id: null })!;
    expect(selected.tree).toBe(created.tree);
    expect(selected.flat).toBe(created.flat);
    const edited = handle({ type: "transform", id: created.selectedId!, position: [8, 2, 0] })!;
    expect(edited.flat).not.toBe(created.flat);
    expect(created.flat[0].pos).toEqual([0, 2, 0]);
    expect(edited.flat[0].pos).toEqual([8, 2, 0]);
    expect(handle({ type: "undo" })!.flat[0].pos).toEqual([0, 2, 0]);
    expect(handle({ type: "redo" })!.flat[0].pos).toEqual([8, 2, 0]);
    expect(open("A").flat).toEqual([]);
  });
  it("inserts reusable scenes as independent groups and undoes the whole insertion", () => {
    const original = add().tree;
    const template = structuredClone(original);
    const first = handle({ type: "appendScene", name: "场景 A", tree: template })!;
    const groupA = first.selectedId!;
    const second = handle({ type: "appendScene", name: "场景 B", tree: template })!;
    const groupB = second.selectedId!;
    expect(new Set(second.tree.map((node) => node.id)).size).toBe(second.tree.length);
    expect(second.tree.filter((node) => node.parentId === groupA)).toHaveLength(1);
    expect(second.tree.filter((node) => node.parentId === groupB)).toHaveLength(1);
    expect(template).toEqual(original);
    expect(handle({ type: "undo" })!.tree).toEqual(first.tree);
    expect(handle({ type: "undo" })!.tree).toEqual(original);
    expect(handle({ type: "redo" })!.tree).toEqual(first.tree);
  });
  it("input normalization does not create undo entries for unchanged properties", () => {
    const created = add();
    open("A", created.tree);
    const id = created.tree[0].id;
    expect(handle({ type: "transform", id, position: [0, 2, 0] })).toBeNull();
    expect(handle({ type: "geometry", id, boxSize: [4, 4, 4] })).toBeNull();
    expect(handle({ type: "select", id })!.canUndo).toBe(false);
  });
  it("locked objects cannot be transformed or removed", () => {
    const id = add().selectedId!;
    expect(handle({ type: "toggleLocked", id })!.flat[0].locked).toBe(true);
    expect(handle({ type: "transform", id, position: [99, 99, 99] })!.tree[0].transform.position.x).toBe(0);
    expect(handle({ type: "remove", id })!.tree).toHaveLength(1);
  });
  it("deletes the last model and restores it with one undo", () => {
    const created = add();
    const removed = handle({ type: "remove", id: created.selectedId! })!;
    expect(removed).toMatchObject({ tree: [], flat: [], selectedId: null });
    expect(handle({ type: "undo" })!.tree).toEqual(created.tree);
    expect(handle({ type: "redo" })!.tree).toEqual([]);
  });
  it("deletes an imported group-root object and ignores missing IDs", () => {
    const source = add().tree[0];
    const root = { ...source, id: "group-root", type: "group" as const, parentId: null };
    const child = { ...source, id: "child", parentId: root.id };
    open("A", [root, child]);
    expect(handle({ type: "remove", id: "missing" })).toBeNull();
    expect(handle({ type: "select", id: root.id })!.canUndo).toBe(false);
    expect(handle({ type: "remove", id: root.id })!.tree).toEqual([]);
    expect(handle({ type: "undo" })!.tree).toEqual([root, child]);
  });
  it("duplicates and deletes entire groups while preserving parent links", () => {
    const group = handle({ type: "add", node: { type: "group", name: "分组" } })!.selectedId!;
    handle({ type: "add", node: { type: "model", name: "子模型" }, parentId: group });
    const copied = handle({ type: "duplicate", id: group })!;
    expect(copied.tree).toHaveLength(4);
    expect(copied.tree.filter((n) => n.parentId === copied.selectedId)).toHaveLength(1);
    const removed = handle({ type: "remove", id: group })!;
    expect(removed.tree).toHaveLength(2);
    expect(removed.tree.some((n) => n.id === group || n.parentId === group)).toBe(false);
  });
  it("hiding a group hides its descendants in GPU instances", () => {
    const group = handle({ type: "add", node: { type: "group" } })!.selectedId!;
    handle({ type: "add", node: { type: "model" }, parentId: group });
    expect(handle({ type: "toggleVisible", id: group })!.flat).toHaveLength(0);
    expect(handle({ type: "toggleVisible", id: group })!.flat).toHaveLength(1);
  });
  it("passes scale and degree-to-radian rotation to the rendering boundary", () => {
    const id = add().selectedId!;
    handle({ type: "transform", id, property: "scale", position: [2, 3, 4] });
    const result = handle({ type: "transform", id, property: "rotation", position: [0, 90, 0] })!;
    expect(result.flat[0].size).toEqual([8, 12, 16]);
    expect(result.flat[0].rotY).toBeCloseTo(Math.PI / 2);
  });
  it("adds real mesh resources with their dimensions and retains them when duplicating", () => {
    const asset = modelAssetById.get("industrial-a")!;
    const result = handle({ type: "add", node: modelNode(asset) })!;
    expect(result.flat[0]).toMatchObject({ kind: "mesh", modelId: asset.id, size: asset.size, color: [1,1,1] });
    expect(result.flat[0].pos[1]).toBeCloseTo(asset.size[1]/2+.12);
    expect(handle({ type: "duplicate", id: result.selectedId! })!.flat[1].modelId).toBe(asset.id);
  });
  it("replaces legacy geometry without losing placement, with undo and lock protection", () => {
    const id = add().selectedId!;
    handle({ type: "transform", id, position: [8, 2, 9] });
    const result = handle({ type: "replaceModel", id, modelId: "office" })!;
    expect(result.flat[0]).toMatchObject({ kind: "mesh", modelId: "office", pos: [8,5,9] });
    expect(handle({ type: "undo" })!.flat[0].kind).toBe("box");
    handle({ type: "toggleLocked", id });
    expect(handle({ type: "replaceModel", id, modelId: "car" })!.tree[0].modelId).toBeUndefined();
  });
});
