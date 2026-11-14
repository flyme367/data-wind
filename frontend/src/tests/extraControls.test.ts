import { describe, expect, it } from "vitest";
import { widgetNode } from "../data/editor";
import { extraControlKinds, extraControlMarkup } from "../data/extraControls";
import type { SceneNode } from "../types";

describe("补充控件", () => {
  it("所有控件都有可渲染的默认内容", () => {
    for (const kind of extraControlKinds) {
      const node = widgetNode(kind) as SceneNode;
      expect(extraControlMarkup(node)).toContain("<");
    }
  });
  it("将文本转义，并限制二维区域的颜色和坐标", () => {
    const node = widgetNode("twin2d") as SceneNode;
    node.data = { zones: [{ label: '<img src=x onerror="alert(1)">', x: -20, y: 999, color: 'red" onload="x' }] };
    const markup = extraControlMarkup(node);
    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;img");
    expect(markup).toContain('x="0"');
    expect(markup).toContain('y="340"');
    expect(markup).toContain('fill="#4b9eff"');
  });
  it("为开关、滑条和时间进度条应用初始数据", () => {
    const toggle = widgetNode("switch") as SceneNode;
    toggle.data = { checked: true };
    expect(extraControlMarkup(toggle)).toContain('checked role="switch"');
    const slider = widgetNode("slider") as SceneNode;
    slider.data = { min: 0, max: 100, value: 500, step: 1 };
    expect(extraControlMarkup(slider)).toContain('value="100"');
    const time = widgetNode("timeProgress") as SceneNode;
    expect(extraControlMarkup(time)).toContain("12:00");
  });
});
