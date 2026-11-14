import { KIT_CITY_GEOMETRY_OPTION, KIT_CITY_TYPE, isKitTabPanel, kitColor, kitFileUrl, kitGradient, kitNumber, kitOptions, kitPair, kitRecord, kitTextFont,
  kitTabIndex, kitTabLabels, type KitMetadata } from "../data/kitRuntime";
import { KIT_WEATHER_TYPE, kitWeatherConditionKey, kitWeatherIconKey, type KitWeatherSample } from "../data/kitWeather";
import type { RustBoardNode } from "./boardScene";

interface KitPaintStyle {
  image: string;
  fill: string;
  color: string;
  fontSize: number;
  borderColor: string;
  borderWidth: number;
  borderStyle?: unknown;
  radius: number;
  gradient?: ReturnType<typeof kitGradient>;
  textVisible?: boolean;
  align?: unknown;
  vertical?: unknown;
  offset?: unknown;
  fit?: unknown;
  ninePatch?: unknown;
  imageScale?: number;
  imageOffset?: unknown;
  fontFamily?: unknown;
  fontBold?: boolean;
  fontItalic?: boolean;
  fontUnderline?: boolean;
  fontStrike?: boolean;
  letterSpacing?: number;
  textIndent?: number;
  arrangement?: unknown;
  textOverflow?: unknown;
  padding?: unknown;
  glowColor?: string;
  glowBlur?: number;
  glowOffset?: unknown;
}

/** Expand resource references into texture inputs for the same Rust surface used in preview and export. */
export function kitBoardVisuals(node: RustBoardNode, meta: KitMetadata, childNames: string[],
  related: Record<string, unknown> = {},
  weather?: (options: Record<string, unknown>) => KitWeatherSample | undefined): RustBoardNode[] {
  const options = { ...kitOptions(meta.source), ...related };
  const extra: RustBoardNode[] = [];
  if (meta.source.type === KIT_CITY_TYPE && options[KIT_CITY_GEOMETRY_OPTION] === true)
    node.data.__kitCityGeometry = true;
  const weatherData = meta.source.type === KIT_WEATHER_TYPE ? weather?.(options) : undefined;
  if (meta.source.type === KIT_WEATHER_TYPE && !weatherData) {
    const base = { ...node.widget, kind: "text" as const, align: "center" as const,
      borderStyle: "none" as const, borderWidth: 0, radius: 0, shadowColor: "transparent" };
    extra.push({ ...node, id: `${node.id}::kit-weather-background`, color: "transparent", locked: true,
      widget: { ...base, text: "", background: "#080d16" },
      data: { __kitDecoration: true, passThrough: true } });
    extra.push({ ...node, id: `${node.id}::kit-weather-title`, height: node.height / 2, color: "#1687ff", locked: true,
      widget: { ...base, text: "暂无数据", fontSize: 20, background: "transparent" },
      data: { __kitDecoration: true, passThrough: true, __kitText: { vertical: "center" } } });
    node.color = "#ffffff";
    node.widget = { ...node.widget, kind: "text", text: "请到右侧窗口设置/更新Key", fontSize: 14,
      align: "center", background: "transparent" };
    node.data.__kitWeatherEmpty = true;
  }
  const media = (key: string, url: string, x: number, y: number, width: number, height: number, onlyTexture = false) => {
    if (!url) return "";
    const id = `${node.id}::kit-${key}`;
    const video = /\.(webm|mp4|mov|m4v)(?:[?#]|$)|^data:video\//i.test(url);
    extra.push({ ...node, id, x, y, width, height, color: "#ffffff", locked: true,
      widget: { ...node.widget, kind: video ? "video" : "image", image: url, text: "", background: "transparent",
        borderColor: "transparent", borderStyle: "none", borderWidth: 0, shadowColor: "transparent" },
      data: { __kitResource: onlyTexture, __kitDecoration: true, passThrough: true, src: url, objectFit: "stretch",
        autoplay: options["main-video-animation"] !== false, loop: true, muted: true, hideControls: true },
    });
    return id;
  };
  const texture = (key: string, source: unknown) => media(key, kitFileUrl(source), node.x, node.y, node.width, node.height, true);
  if (weatherData) {
    const font = (key: string) => {
      const style = kitRecord(options[key]);
      return { size: kitNumber(style.size, 30), color: kitColor(style.color, node.color),
        family: style.family, bold: style.bold === true, italic: style.italic === true,
        underline: style.underline === true, strike: style["line-through"] === true };
    };
    const text = (value: string, fontKey: string, offsetKey: string) =>
      ({ value, font: font(fontKey), offset: kitPair(options[offsetKey], [0, 0]) });
    const condition = kitWeatherConditionKey(weatherData.condition);
    const icons = kitRecord(options["icon-list"]);
    const icon = kitRecord(icons[kitWeatherIconKey(icons, condition)])["change-image"];
    const range = weatherData.high === undefined ? weatherData.temperature
      : `${weatherData.temperature}${String(options.connector ?? "~")}${weatherData.high}`;
    const direction = weatherData.wind && !/风|无持续/.test(weatherData.wind) ? `${weatherData.wind}风` : weatherData.wind;
    const power = weatherData.power && !weatherData.power.endsWith("级") ? `${weatherData.power}级` : weatherData.power;
    const wind = options["wind-type"] === "direction" ? direction : options["wind-type"] === "level" ? power
      : [direction, power].filter(Boolean).join(" ");
    node.data.__kitWeather = {
      icon: options.icon !== false ? {
        condition, position: options["icon-position"], fill: kitColor(options["image-background"]),
        size: kitNumber(options["image-size"], 50), offset: kitPair(options["image-offset"], [0, 0]),
        image: texture("weather-icon", icon),
      } : null,
      column: options["weather-direction"] === "column", align: options["weather-align"], reverse: options.reverse === true,
      name: options["weather-name"] !== false
        ? text(weatherData.condition, "weather-text-font", "weather-text-offset") : null,
      temperature: options.temperature !== false
        ? { ...text(range, "weather-temperature-font", "temperature-text-offset"),
          unit: String(options.suffix ?? "℃"), unitFont: font("suffix-text-font") } : null,
      wind: options.wind !== false ? text(wind, "wind-text-font", "wind-text-offset") : null,
    };
  }
  const isButton = meta.source.type === "widget.basic.button-v2" || meta.source.type === "widget.basic.button";
  if (isButton) {
    const styles = Object.fromEntries(["default", "hover", "click", "select"].map(state => {
      const font = kitRecord(options[`text-${state}-font`]);
      const image = texture(`button-${state}`, options[`background-${state}-image`]);
      const blur = kitNumber(options[`background-${state}-blur`]);
      if (image && blur > 0) extra.at(-1)!.data.__kitImageFilter = { blur };
      const style: KitPaintStyle = {
        image,
        fill: kitColor(options[`background-${state}-color`]),
        gradient: kitGradient(options[`background-${state}-color`]),
        color: kitColor(font.color, node.color), fontSize: kitNumber(font.size, node.widget.fontSize),
        borderColor: kitColor(options[`border-${state}-color`]),
        borderWidth: options[`border-${state}-style`] === "none" ? 0 : kitNumber(options[`border-${state}-width`]),
        borderStyle: options[`border-${state}-style`],
        radius: kitNumber(options[`border-${state}-radius`]),
        align: options[`text-${state}-position`], vertical: options[`text-${state}-vertical`],
        offset: options[`text-offset-${state}`],
        fontFamily: String(font.family ?? ""), fontBold: font.bold === true, fontItalic: font.italic === true,
        fontUnderline: font.underline === true, fontStrike: font["line-through"] === true,
        letterSpacing: kitNumber(options[`font-${state}-spacing`]),
        textIndent: kitNumber(options[`text-${state}-indent`]), arrangement: options["text-arrangement"],
        padding: options.padding,
        glowColor: kitColor(options[`font-${state}-shadow-color`]),
        glowBlur: kitNumber(options[`font-${state}-shadow-blur`], -1),
        glowOffset: options[`font-${state}-shadow-offset`],
        fit: options[`background-${state}-fill-type`],
        imageScale: kitNumber(options[`background-image-scale-${state}`], 100),
        imageOffset: options[`background-image-position-${state}`],
        ninePatch: options[`use-nine-patch-${state}`] === true ? options[`nine-patch-${state}`] : null,
      };
      return [state, style];
    }));
    node.data.__kitButton = { styles, checked: options.checked === true, hover: options["show-hover"] === true,
      click: options["show-click"] === true, select: options["show-select"] === true,
      hoverAnimation: options["animation-hover-show"] === true, clickAnimation: options["animation-click-show"] === true,
      hoverDuration: kitNumber(options["animation-hover-time"], 0.35),
      clickDuration: kitNumber(options["animation-click-time"], 0.35) };
  } else if (options.background !== false) {
    const image = texture("background", options["background-image"]);
    const gradient = kitGradient(options["background-color"]);
    if (image) {
      const blur = kitNumber(options["background-blur"]);
      if (blur > 0) extra.at(-1)!.data.__kitImageFilter = { blur };
    }
    if (image || gradient) node.data.__kitBackground = { image, gradient, fit: options["background-fill-type"],
      ninePatch: options["use-nine-patch"] === true ? options["nine-patch"] : null };
  }

  if (meta.source.type.startsWith("widget.group.buttons")) {
    const cluster = kitRecord(options["item-style-cluster"]);
    const indexes = Array.isArray(cluster.indexes) ? cluster.indexes : [];
    const baseIndex = indexes.find(index => !kitRecord(cluster[String(index)])["item-key"]) ?? indexes[0] ?? "default";
    const base = kitRecord(cluster[String(baseIndex)]);
    const mergedItem = (index: unknown) => ({ ...base, ...kitRecord(cluster[String(index)]) });
    const itemStyle = (index: unknown, state: string): KitPaintStyle => {
      const item = mergedItem(index);
      const font = kitRecord(item[`font-${state}`]);
      const image = texture(`menu-${String(index)}-${state}`, item[`background-image-${state}`]);
      const blur = kitNumber(item[`background-blur-${state}`]);
      if (image && blur > 0) extra.at(-1)!.data.__kitImageFilter = { blur };
      return { image,
        fill: kitColor(item[`background-color-${state}`]), color: kitColor(font.color, node.color),
        gradient: kitGradient(item[`background-color-${state}`]),
        fontSize: kitNumber(font.size, 16), borderColor: kitColor(item[`border-color-${state}`]),
        borderWidth: item[`border-style-${state}`] === "none" ? 0 : kitNumber(item[`border-size-${state}`]),
        borderStyle: item[`border-style-${state}`], radius: kitNumber(item[`border-radius-${state}`]),
        align: item[`text-align-${state}`], offset: item[`text-offset-${state}`],
        fontFamily: String(font.family ?? ""), fontBold: font.bold === true, fontItalic: font.italic === true,
        fontUnderline: font.underline === true, fontStrike: font["line-through"] === true,
        letterSpacing: kitNumber(item[`text-spacing-${state}`]), arrangement: options["text-arrangement"],
        textOverflow: options["text-overflow"],
        glowColor: kitColor(item[`font-shadow-color-${state}`]), glowBlur: kitNumber(item[`font-shadow-blur-${state}`], -1),
        glowOffset: item[`font-shadow-offset-${state}`],
        fit: item[`background-image-fill-${state}`],
        imageScale: kitNumber(item[`background-image-scale-${state}`], 100),
        imageOffset: item[`background-image-position-${state}`],
        ninePatch: item[`use-nine-patch-${state}`] === true ? item[`nine-patch-${state}`] : null };
    };
    const styleKeys = [baseIndex, ...indexes.filter(index => index !== baseIndex)].slice(0, 40);
    const styles = styleKeys.map(index => ({
      default: itemStyle(index, "default"), selected: itemStyle(index, "selected"), hover: itemStyle(index, "hover"),
      hoverEnabled: mergedItem(index)["item-hover-enable"] !== false,
      selectedEnabled: mergedItem(index)["item-selected-enable"] !== false,
    }));
    const items = Array.isArray(node.data.items) ? node.data.items.map(String) : [];
    const previous = Array.isArray(options["last-button-list"]) ? options["last-button-list"].map(kitRecord) : [];
    const styleIndexes = items.map((label, index) => {
      const matches = (item: Record<string, unknown>) => String(item.label ?? "") === label && typeof item.key === "string";
      const saved = previous[index] && matches(previous[index]) ? previous[index] : previous.find(matches);
      const key = saved?.key ?? `${label}-${index}`;
      const match = styleKeys.findIndex(id => kitRecord(cluster[String(id)])["item-key"] === key);
      return Math.max(0, match);
    });
    const layoutCluster = kitRecord(options["layout-cluster"]);
    const layoutIndexes = Array.isArray(layoutCluster.indexes) ? layoutCluster.indexes : [];
    const itemLayouts = layoutIndexes.map(id => {
      const item = kitRecord(layoutCluster[String(id)]);
      return { x: kitNumber(item["offset-x"]), y: kitNumber(item["offset-y"]), rotation: kitNumber(item["item-rotation"]) };
    });
    const [rows, columns] = kitPair(options.layout, [1, 1]);
    node.data.__kitMenu = { rows, columns, styles, styleIndexes, itemSize: options["item-size"], itemLayouts,
      overflow: options.overflow, active: node.data.active, scroll: options["layout-setting"] === "scroll",
      visibleCount: kitNumber(options["layout-scroll-count"], 3), vertical: options["layout-arrangement"] === "vertical",
      wheel: options["layout-wheel-scroll"] === true, scrollMode: options["layout-scroll-mode"],
      scrollbar: options["show-scrollbar"] === true, scrollbarSize: kitNumber(options["scrollbar-size"], 6),
      scrollbarColor: kitColor(options["scrollbar-color"], "#a5a5a5"),
      scrollbarBackground: kitColor(options["scrollbar-bg-color"]),
      allowUnselected: options["allow-unselected"] === true, allowRepeat: options["allow-repeated-trigger"] === true,
      gap: kitNumber(options["item-gap"]) };
  }

  if (meta.source.type === "widget.basic.dropdown-v2") {
    const style = (prefix: "header" | "popup" | "item" | "selected"): KitPaintStyle => {
      const header = prefix === "header", popup = prefix === "popup", selected = prefix === "selected";
      const font = kitRecord(options[header ? "top-fonts" : selected ? "dropdown-selected-font" : "dropdown-font"]);
      const fill = options[header ? "dropdown-background-color" : popup ? "dropdown-option-background-color"
        : selected ? "dropdown-hover-background-color" : "__transparent"];
      const imageKey = header ? "dropdown-background-image" : popup ? "dropdown-option-background-image"
        : selected ? "dropdown-drop-option-selected-background-image" : "dropdown-drop-option-background-image";
      const fitKey = header ? "dropdown-background-image-type" : popup ? "dropdown-option-background-image-type"
        : "dropdown-drop-option-background-image-type";
      const nineKey = header ? "dropdown-use-nine-patch-default" : popup ? "dropdown-option-use-nine-patch-default"
        : "dropdown-drop-option-use-nine-patch";
      const patchKey = header ? "dropdown-nine-patch-default" : popup ? "dropdown-option-nine-patch-default"
        : "dropdown-drop-option-nine-patch";
      const border = header ? "options-border" : "options-drop-border";
      return { image: texture(`dropdown-${prefix}`, options[imageKey]), fill: kitColor(fill), gradient: kitGradient(fill),
        color: kitColor(font.color, "#d5d5d6"), fontSize: kitNumber(font.size, header ? 18 : 15),
        borderColor: header || popup ? kitColor(options[`${border}-color`]) : "transparent",
        borderWidth: (header || popup) && options[`${border}-style`] !== "none" ? kitNumber(options[`${border}-width`]) : 0,
        radius: header || popup ? kitNumber(options[`${border}-radius`]) : 0,
        align: options["text-position"], offset: [0, kitNumber(options[header ? "text-select-transform" : "text-transform"])],
        fit: options[fitKey], ninePatch: options[nineKey] === true ? options[patchKey] : null };
    };
    node.data.__kitDropdown = {
      headerHeight: Math.max(0, kitNumber(options["dropdown-selected-box-height"], 30)),
      rowHeight: Math.max(1, kitNumber(options["dropdown-option-height"], 30)),
      maxOptions: Math.max(1, kitNumber(options["dropdown-drop-options-number"], 5)),
      leftPadding: Math.max(0, kitNumber(options["dropdown-option-left-padding"], 10)),
      selectPadding: options["dropdown-select-padding"], dropPadding: options["dropdown-drop-padding"],
      icon: texture("dropdown-icon", options["dropdown-menu-icon"]), iconSize: options["dropdown-menu-icon-size"],
      iconMargin: kitNumber(options["dropdown-menu-icon-margin"]), noData: String(options["dropdown-no-data"] ?? "no data"),
      placeholder: options["show-default-option"] === true && options["use-multiple"] !== true
        ? String(options["dropdown-tip-text"] ?? "请选择") : "",
      multiple: options["use-multiple"] === true,
      search: options["use-search"] === true,
      closeOnlyOnSelect: options["close-only-on-select"] === true,
      ...(Array.isArray(node.data.__kitChoiceTree) ? { tree: node.data.__kitChoiceTree } : {}),
      header: style("header"), popup: style("popup"), item: style("item"), selected: style("selected"),
    };
  }

  if (isKitTabPanel(meta.source.type) && options.tabs !== false) {
    const items = kitTabLabels(options, childNames);
    if (items.length) {
      const mode = options["tabs-type"] === "mark" ? "mark" : "tag";
      const horizontal = options[`tabs-${mode}-direction`] !== "vertical";
      const position = String(options[`tabs-${mode}-position`] ?? "top_left");
      const itemWidth = Math.max(1, kitNumber(options[`tabs-${mode}-width`], 60));
      const itemHeight = Math.max(1, kitNumber(options[`tabs-${mode}-height`], 30));
      const gap = Math.max(0, kitNumber(options["tabs-spacing"], 8));
      const width = horizontal ? itemWidth * items.length + gap * (items.length - 1) : itemWidth;
      const height = horizontal ? itemHeight : itemHeight * items.length + gap * (items.length - 1);
      const inset = mode === "mark" ? 10 : 0;
      const [dx, dy] = kitPair(options["tabs-tag-offset"], [0, 0]);
      const x = position === "top_center" || position === "bottom_center" ? (node.width - width) / 2
        : position.includes("right") ? node.width - width - inset : inset;
      const y = position === "left_center" || position === "right_center" ? (node.height - height) / 2
        : position.startsWith("bottom") ? node.height - height - inset : inset;
      const tabStyle = (suffix: string): KitPaintStyle => {
        const font = kitRecord(options[`tabs-text-font${suffix}`]);
        const fill = options[`tabs-background-color${suffix}`];
        const image = texture(`tab${suffix || "-default"}`, options[`tabs-background-image${suffix}`]);
        const blur = kitNumber(options[`tabs-background-blur${suffix}`]);
        if (image && blur > 0) extra.at(-1)!.data.__kitImageFilter = { blur };
        return { image, fill: kitColor(fill), gradient: kitGradient(fill), color: kitColor(font.color, node.color),
          fontSize: kitNumber(font.size, 16), textVisible: mode === "tag" || options[`tabs-text-display${suffix}`] === true,
          align: options[`tabs-text-align${suffix}`], vertical: options[`tabs-vertical-align${suffix}`], offset: options[`tabs-text-offset${suffix}`],
          borderColor: kitColor(options[`tabs-border-color${suffix}`]),
          borderWidth: options[`tabs-border-style${suffix}`] === "none" ? 0 : kitNumber(options[`tabs-border-size${suffix}`]),
          radius: mode === "mark" && options["tabs-mark-shape"] === "round" ? itemWidth / 2
            : kitNumber(options[`tabs-border-radius${suffix}`]),
          fit: options[`tabs-background-fill-type${suffix}`],
          ninePatch: options[`tabs-use-nine-patch${suffix}`] === true ? options[`tabs-nine-patch${suffix}`] : null,
        };
      };
      const styles = [{ default: tabStyle(""), selected: tabStyle("-selected"), hover: tabStyle("-hover"),
        hoverEnabled: options["tabs-hover-show"] === true }];
      extra.push({ ...node, id: `${node.id}::kit-tabs`, x: node.x + x + dx, y: node.y + y + dy, width, height, locked: true,
        widget: { ...node.widget, kind: horizontal ? "menuHorizontal" : "menuVertical", background: "transparent",
          borderWidth: 0, shadowColor: "transparent" },
        data: { __kitPanelTab: node.id, items, __kitMenu: { rows: horizontal ? 1 : items.length,
          columns: horizontal ? items.length : 1, styles, active: kitTabIndex(options, items.length), gap } },
      });
    }
  }

  if (["widget.group.list-v2", "widget.group.list"].includes(meta.source.type) && node.data.__kitListInfo) {
    const info = kitRecord(node.data.__kitListInfo);
    const slots = Array.isArray(info.slots) ? info.slots.map(kitRecord) : [];
    if (kitNumber(info.total) === 0 && slots.length === 0 && options["hide-empty-tip"] === false) {
      extra.push({ ...node, id: `${node.id}::kit-list-empty`, locked: true, color: "#a5a5a5",
        widget: { ...node.widget, kind: "text", text: "暂无数据", fontSize: 14, align: "center",
          background: "transparent", borderWidth: 0, shadowColor: "transparent" },
        data: { __kitListBackground: true, __kitDecoration: true, passThrough: true } });
    }
    const styles = Object.fromEntries(["default", "selected"].map(state => {
      const prefix = `item-${state}-`;
      const image = texture(`list-item-${state}`, options[`${prefix}image`]);
      const blur = kitNumber(options[`${prefix}blur`]);
      if (image && blur > 0) extra.at(-1)!.data.__kitImageFilter = { blur };
      return [state, { image, fill: kitColor(options[`${prefix}color`]), gradient: kitGradient(options[`${prefix}color`]),
        fit: options[`${prefix}image-fill`], ninePatch: options[`${prefix}use-nine-patch`] === true
          ? options[`${prefix}nine-patch`] : null }];
    }));
    const box = (id: string, x: number, y: number, width: number, height: number,
      background: string, data: Record<string, unknown>) => {
      if (width <= 0 || height <= 0) return;
      extra.push({ ...node, id: `${node.id}::kit-list-${id}`, x: node.x + x, y: node.y + y, width, height,
        color: "transparent", locked: true, widget: { ...node.widget, kind: "shape", text: "", background,
          borderColor: "transparent", borderWidth: 0, borderStyle: "none", shadowColor: "transparent" },
        data: { __kitListBackground: true, shape: "rect", ...data } });
    };
    slots.forEach((slot, index) => {
      const x = kitNumber(slot.x), y = kitNumber(slot.y), width = kitNumber(slot.width), height = kitNumber(slot.height);
      const selected = options["use-item-selected"] === true && slot.index === info.selected;
      const style = styles[selected ? "selected" : "default"]!;
      box(`item-${index}`, x, y, width, height, style.fill, { __kitDecoration: true, passThrough: true,
        __kitListClip: slot.clip,
        __kitBackground: { image: style.image, gradient: style.gradient, fit: style.fit, ninePatch: style.ninePatch } });
      box(`hit-${index}`, x, y, width, height, "transparent", { __kitListClone: true,
        __kitListOriginalId: node.id, __kitListRootId: node.id, __kitListIndex: slot.index, __kitListRow: slot.row,
        __kitListClip: slot.clip, passThrough: options["no-events"] === true });
    });
    if (options["list-show-line"] === true) {
      const thickness = Math.max(0, kitNumber(options["line-border-width"], 1));
      const color = kitColor(options["line-border-color"], "#ffffff");
      const lineStyle = String(options["line-border-style"] ?? "solid");
      const line = (id: string, x: number, y: number, length: number, horizontal: boolean) => {
        const segment = lineStyle === "dotted" ? Math.max(1, thickness) : 7;
        const gap = lineStyle === "solid" ? 0 : 4;
        const count = gap ? Math.min(500, Math.ceil(length / (segment + gap))) : 1;
        for (let part = 0; part < count; part++) {
          const offset = part * (segment + gap), size = gap ? Math.min(segment, length - offset) : length;
          box(`${id}-${part}`, x + (horizontal ? offset : 0), y + (horizontal ? 0 : offset),
            horizontal ? size : thickness, horizontal ? thickness : size, color,
            { __kitDecoration: true, passThrough: true,
              __kitListClip: { x: node.x, y: node.y, width: node.width, height: node.height } });
        }
      };
      slots.forEach((slot, index) => {
        const x = kitNumber(slot.x), y = kitNumber(slot.y);
        if (y > 0) line(`line-h-${index}`, x, y, kitNumber(slot.width), true);
        if (x > 0) line(`line-v-${index}`, x, y, kitNumber(slot.height), false);
      });
    }
  }

  if (["widget.group.list-v2", "widget.group.list"].includes(meta.source.type)
      && node.data.__kitListInfo && options["is-show-switch-button"] !== false
      && kitNumber(kitRecord(node.data.__kitListInfo).total) > kitNumber(kitRecord(node.data.__kitListInfo).capacity)) {
    const info = kitRecord(node.data.__kitListInfo);
    const total = Math.max(0, Math.trunc(kitNumber(info.total)));
    const capacity = Math.max(1, Math.trunc(kitNumber(info.capacity, 1)));
    const start = Math.max(0, Math.trunc(kitNumber(info.start)));
    const pages = Math.min(30, Math.max(1, Math.ceil(total / capacity)));
    const active = Math.min(pages - 1, Math.floor(start / capacity));
    const mode = String(options["page-button-type"] ?? "dot");
    const vertical = options["list-scroll-direction"] !== "horizontal";
    const items = mode === "flip" ? ["‹", "›"] : mode === "page"
      ? ["‹", ...Array.from({ length: Math.min(28, pages) }, (_, index) => String(index + 1)), "›"]
      : Array.from({ length: pages }, (_, index) => String(index + 1));
    const [rawWidth, rawHeight] = kitPair(options[mode === "dot" ? "list-dot-size"
      : mode === "flip" ? "flip-button-size" : "pagination-button-size"], mode === "dot" ? [25, 25] : [32, 32]);
    const itemWidth = Math.max(1, rawWidth), itemHeight = Math.max(1, rawHeight);
    const gap = mode === "flip" ? Math.max(0, kitNumber(options["flip-button-gap"], 5)) : 5;
    const width = vertical ? itemWidth : itemWidth * items.length + gap * (items.length - 1);
    const height = vertical ? itemHeight * items.length + gap * (items.length - 1) : itemHeight;
    const position = String(options[mode === "flip" ? vertical ? "flip-button-position-vertical" : "flip-button-position-horizontal"
      : vertical ? "button-position-vertical" : "button-position-horizontal"]
      ?? (vertical ? "right" : "bottom"));
    const offset = kitPair(options[mode === "flip" ? vertical ? "flip-button-offset-vertical" : "flip-button-offset-horizontal"
      : vertical ? "list-dot-offset-vertical" : "list-dot-offset-horizontal"], [0, 0]);
    const x = (vertical ? position === "left" ? 0 : position === "center" ? (node.width - width) / 2
      : node.width - width : (node.width - width) / 2) + offset[0];
    const y = (vertical ? (node.height - height) / 2 : position === "top" ? 0
      : position === "center" ? (node.height - height) / 2 : node.height - height) + offset[1];
    const dot = mode === "dot";
    const radius = dot && options["list-dot-shape"] === "circle" ? Math.min(itemWidth, itemHeight) / 2
      : dot ? kitNumber(options["list-dot-border-radius"], 5) : 0;
    const style = (state: "default" | "selected" | "hover", index: number): KitPaintStyle => {
      const fill = dot ? options[state === "selected" ? "list-dot-color-active"
        : state === "hover" ? "list-dot-color-hover" : "list-dot-color"]
        : mode === "flip" ? options[state === "hover" ? "flip-button-hover-bg-color" : "flip-button-bg-color"]
          : options[state === "selected" ? "pagination-button-active-bg-color" : "pagination-button-bg-color"];
      const arrow = index === 0 ? "prev" : "next";
      const image = mode === "flip" && options["flip-button-style"] === "diy"
        ? texture(`list-${arrow}-${state}`, options[`${arrow}-button-${state === "hover" ? "hover-" : ""}image`]) : "";
      return { image, fill: kitColor(fill, "#b2b2b2"), color: kitColor(options["pagination-button-font-color"], "#ffffff"),
        fontSize: kitNumber(kitRecord(options["pagination-font"]).size, 14), borderColor: "transparent",
        borderWidth: 0, radius, textVisible: !dot && !image };
    };
    extra.push({ ...node, id: `${node.id}::kit-list-controls`, x: node.x + x, y: node.y + y,
      width, height, locked: true, widget: { ...node.widget, kind: vertical ? "menuVertical" : "menuHorizontal",
        background: "transparent", borderWidth: 0, shadowColor: "transparent" },
      data: { __kitPanelTab: node.id, __kitListControl: true, items,
        __kitMenu: { rows: vertical ? items.length : 1, columns: vertical ? 1 : items.length,
          styles: items.map((_, index) => ({ default: style("default", index), selected: style("selected", index),
            hover: style("hover", index), hoverEnabled: true })),
          active: mode === "flip" ? -1 : active + (mode === "page" ? 1 : 0), gap } },
    });
  }

  if (meta.source.type === "widget.group.popup" && options["close-btn-show"] !== false) {
    node.data.__kitClose = { color: kitColor(options["close-btn-color"], "#cccccc"),
      size: kitNumber(options["close-btn-size"], 20), x: kitNumber(options["close-btn-offsetX"]),
      y: kitNumber(options["close-btn-offsetY"]) };
  }
  if (meta.source.type === "widget.basic.table-v3" || meta.source.type === "widget.basic.table-v2") {
    const fields = Array.isArray(node.data.__kitTableFields) ? node.data.__kitTableFields.map(String) : [];
    if (fields.length && Array.isArray(node.data.rows) && node.data.rows.some(row => row && typeof row === "object" && !Array.isArray(row))) {
      node.data.__kitTableRawRows = node.data.rows;
      const labels = Array.isArray(node.data.columns) ? node.data.columns : [];
      node.data.rows = node.data.rows.map(row => {
        if (Array.isArray(row)) return row;
        const record = kitRecord(row);
        return fields.map((field, index) => record[field] ?? record[String(labels[index] ?? "")] ?? "");
      });
    }
    const clusterItems = (value: unknown) => {
      const cluster = kitRecord(value);
      return (Array.isArray(cluster.indexes) ? cluster.indexes : []).map(index => kitRecord(cluster[String(index)]));
    };
    const rowStyles = clusterItems(options["table-row-body-cluster"]).map((row, index) => {
      const font = kitRecord(row["row-font"]);
      return {
        fill: kitColor(row["row-bg-color"], "#16181ccd"), gradient: kitGradient(row["row-bg-color"]),
        image: texture(`table-row-${index}`, row["row-bg-image"]), fit: row["row-bg-image-fill-type"],
        ninePatch: row["row-bg-image-use-nine-patch"] === true ? row["row-bg-image-nine-patch"] : null,
        hover: kitColor(row["row-hover-bg-color"], "#1f4461"),
        hoverImage: texture(`table-row-${index}-hover`, row["row-hover-bg-image"]),
        selected: kitColor(row["row-selected-bg-color"], "#166aac"),
        selectedImage: texture(`table-row-${index}-selected`, row["row-selected-bg-image"]),
        color: kitColor(font.color, "#d7e6ff"), fontSize: kitNumber(font.size, 14),
      };
    });
    const columnStyles = clusterItems(options["table-col-body-cluster"]).map((column, index) => {
      const font = kitRecord(column["col-font"]);
      const conditions = column["col-condition-setting"] === true
        ? clusterItems(column["col-condition-cluster"]).map(condition => {
          const conditionFont = kitRecord(condition["col-font"]);
          return { field: condition["condition-field"], value: condition["field-value"],
            fill: condition["col-bg-color"] === undefined ? null : kitColor(condition["col-bg-color"]),
            color: condition["col-font-setting"] === true ? kitColor(conditionFont.color, "#ffffff") : null,
            fontSize: condition["col-font-setting"] === true ? kitNumber(conditionFont.size, 14) : null,
            align: condition["col-align"], replacement: condition["col-content-replace-show"] === true
              ? condition["col-content-replace"] : undefined };
        }) : [];
      return {
        width: kitNumber(column["col-width"], 100), widthAuto: kitNumber(column["col-width-auto"], 30),
        align: column["col-align"] ?? "center", fill: kitColor(column["col-bg-color"]),
        image: texture(`table-column-${index}`, column["col-bg-image"]), fit: column["col-bg-image-fill-type"],
        ninePatch: column["col-bg-image-use-nine-patch"] === true ? column["col-bg-image-nine-patch"] : null,
        color: column["col-font-setting"] === true ? kitColor(font.color, "#ffffff") : null,
        fontSize: column["col-font-setting"] === true ? kitNumber(font.size, 14) : null,
        type: column["col-type"] ?? "text", percentageType: column["col-percentage-type"] ?? "direct",
        decimals: kitNumber(column["col-decimal-places"], 2), completeZero: column["col-complete-zero"] === true,
        chartColor: kitColor(column["col-chart-fill-color"], "#1890ff"),
        chartBackground: kitColor(column["col-chart-bg-color"], "#d9e4eb"),
        chartWidth: kitNumber(column["col-chart-width"], 5), chartRadius: kitNumber(column["col-chart-border-radius"], 100),
        chartText: column["col-chart-font-enabled"] === true, chartMethod: column["col-chart-percentage-method"] ?? "none",
        conditions,
      };
    });
    if (kitNumber(options["order-width"]) > 0 && Array.isArray(node.data.rows)) {
      const sourceRows = Array.isArray(node.data.__kitTableRawRows) ? node.data.__kitTableRawRows : node.data.rows;
      node.data.__kitTableRawRows = sourceRows.map(row => {
        if (!Array.isArray(row)) return row;
        return Object.fromEntries(fields.map((field, index) => [field, row[index]]));
      });
      const right = options["order-fixed"] === "right";
      const roman = (value: number) => {
        let remaining = value, output = "";
        for (const [amount, glyph] of [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"],
          [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]] as const) {
          while (remaining >= amount) { output += glyph; remaining -= amount; }
        }
        return output;
      };
      const add = (values: unknown[], value: unknown) => right ? [...values, value] : [value, ...values];
      node.data.rows = node.data.rows.map((row, index) => {
        const value = options["order-type"] === "empty" ? "" : options["order-type"] === "roman"
          ? roman(index + 1) : String(index + 1);
        return add(Array.isArray(row) ? row : [], String(options["order-format"] ?? "{index}").replaceAll("{index}", value));
      });
      node.data.columns = add(Array.isArray(node.data.columns) ? node.data.columns : [], String(options["order-name"] ?? "序号"));
      node.data.__kitTableFields = add(fields, "__kitIndex");
      const font = kitRecord(options["order-text-font"]);
      const icons = Array.isArray(options["order-icon"]) ? options["order-icon"] : [];
      const order = { width: kitNumber(options["order-width"]), widthAuto: kitNumber(options["order-width-auto"], 30),
        align: options["order-text-align"] ?? "center", fill: kitColor(options["order-bg-color"]),
        image: texture("table-order", options["order-bg-image"]), fit: options["order-bg-image-fill-type"],
        ninePatch: options["order-bg-image-use-nine-patch"] === true ? options["order-bg-image-nine-patch"] : null,
        color: options["order-font-setting"] === true ? kitColor(font.color, "#ffffff") : null,
        fontSize: options["order-font-setting"] === true ? kitNumber(font.size, 14) : null,
        type: "text", percentageType: "direct", decimals: 0, completeZero: false, chartColor: "transparent",
        chartBackground: "transparent", chartWidth: 0, chartRadius: 0, chartText: false, chartMethod: "none", conditions: [],
        icons: icons.map((icon, index) => texture(`table-order-icon-${index}`, icon)),
        iconSize: options["order-icon-size"] ?? [20, 20],
      };
      if (right) columnStyles.push(order); else columnStyles.unshift(order);
    }
    const headerFont = kitRecord(options["header-font"]);
    node.data.__kitTable = {
      fields: node.data.__kitTableFields, headerHeight: kitNumber(options["header-height"], 30),
      headerGap: kitNumber(options["header-margin-bottom"]), rowCount: kitNumber(options["row-count"], 5),
      rowHeight: options["fluid-height-type"] === "auto" ? kitNumber(options["table-row-height"], 30) : null,
      rowGap: kitNumber(options["row-spacing"]), autoWidth: options.autoWidth === true,
      paginationHeight: options.pagination === true ? kitNumber(options["pagination-height"]) : 0,
      firstSelected: options["select-first-row"] === true,
      header: { fill: kitColor(options["header-bg-color"], "#1087e4"), gradient: kitGradient(options["header-bg-color"]),
        image: texture("table-header", options["header-bg-image"]), fit: options["header-bg-image-fill-type"],
        ninePatch: options["header-bg-image-use-nine-patch"] === true ? options["header-bg-image-nine-patch"] : null,
        color: kitColor(headerFont.color, "#cccccc"), fontSize: kitNumber(headerFont.size, 14), align: options["header-align"] ?? "center" },
      horizontalLine: { width: kitNumber(options["table-cell-line-horizontal-width"], 1), color: kitColor(options["table-cell-line-horizontal-color"], "#1087e4") },
      verticalLine: { width: kitNumber(options["table-cell-line-vertical-width"], 1), color: kitColor(options["table-cell-line-vertical-color"], "#1087e4") },
      headerHorizontalLine: { width: kitNumber(options["table-header-line-horizontal-width"], 1), color: kitColor(options["table-header-line-horizontal-color"]) },
      headerVerticalLine: { width: kitNumber(options["table-header-line-vertical-width"], 1), color: kitColor(options["table-header-line-vertical-color"]) },
      rows: rowStyles, columns: columnStyles,
    };
  }
  if (node.widget.kind === "progress") {
    const decimalPlaces = Math.min(12, Math.max(0, Math.trunc(kitNumber(options["label-decimal-places"], 2))));
    const labelIsPercent = options["label-text-type"] !== "normal";
    const labelValue = labelIsPercent ? kitNumber(node.data.percent) : kitNumber(node.data.__kitProgressValue);
    const labelText = labelValue.toLocaleString("en-US", { useGrouping: false,
      minimumFractionDigits: options["label-complete-zero"] === true ? decimalPlaces : 0,
      maximumFractionDigits: decimalPlaces }) + (labelIsPercent ? "%" : "");
    node.data.__kitProgress = { shape: options.shape, color: kitColor(options["progress-color"], node.color),
      gradient: kitGradient(options["progress-color"]),
      background: kitColor(options["shape-background"], "#333333"),
      backgroundGradient: kitGradient(options["shape-background"]), ring: kitNumber(options["ring-size"], 8),
      ringType: options["ring-type"],
      radius: kitNumber(options["fill-border-radius"], 4), label: options.label !== false,
      fillShape: options["bar-shape"], burstBackground: options["background-shape_burst"] === true,
      burstCount: kitNumber(options["bar-shape_burst-number"], 20),
      burstGap: kitNumber(options["bar-shape_burst-interval"], 10),
      labelSize: kitNumber(kitRecord(options["label-font"]).size, 16),
      labelColor: options["label-color-type"] === "follow" ? kitColor(options["progress-color"], node.color)
        : kitColor(kitRecord(options["label-font"]).color, "#ffffff"),
      labelText, labelPosition: options["label-position"], labelOffset: options["label-offset"],
      angle: kitNumber(options["data-start-angle"], -90), endAngle: kitNumber(options["data-end-angle"], 270) };
  }

  if (["text", "textMultiline", "clock", "metric"].includes(node.widget.kind)) {
    const textFont = kitTextFont(meta.source.type, options);
    const unitFont = kitRecord(options["unit-font2"] ?? options["unit-font"]);
    const [glowX, glowY] = kitPair(options["font-shadow-offset"],
      [kitNumber(options["font-shadow-offset-x"]), kitNumber(options["font-shadow-offset-y"])]);
    const [unitGlowX, unitGlowY] = kitPair(options["unit-shadow-offset"], [0, 0]);
    node.data.__kitText = {
      vertical: options["text-vertical"] ?? (meta.source.type === "widget.basic.paragraph" ? "top" : "center"),
      arrangement: options["text-arrangement"],
      overflow: options["text-overflow"], offset: node.widget.kind === "metric"
        ? [kitNumber(options["text-offset-x"]), 0] : options["text-position-relative"],
      indent: kitNumber(options["text-indent"]), padding: options["text-padding"],
      strike: textFont["line-through"] === true || textFont.deleteline === true,
      glow: kitColor(options["font-shadow-color"]), glowBlur: kitNumber(options["font-shadow-blur"], -1),
      glowX, glowY,
      shadow: kitColor(options["shadow-color"]), shadowBlur: kitNumber(options["shadow-blur"], -1),
      shadowX: kitNumber(options["shadow-offset-x"]), shadowY: kitNumber(options["shadow-offset-y"]),
      timeFormat: options["time-format"], timeCustom: options["time-customise"], weekday: options["show-weekday"],
      timeZone: options["time-zone"] ?? "Etc/GMT-8",
      unitFont, unitColor: kitColor(unitFont.color, node.color),
      unitX: kitNumber(options["unit-offsetX"]), unitY: kitNumber(options["unit-offsetY"]),
      unitGlow: kitColor(options["unit-shadow-color"]), unitGlowBlur: kitNumber(options["unit-shadow-blur"], -1),
      unitGlowX, unitGlowY,
    };
    if (node.data.__kitWeatherEmpty === true) {
      (node.data.__kitText as Record<string, unknown>).offset = [0, node.height / 4];
    }
    if (node.widget.kind === "metric" && options["animation-display"] === true) {
      const target = Number(node.widget.value.replaceAll(",", ""));
      if (Number.isFinite(target)) node.data.__kitMetricAnimation = {
        target, mode: options["animation-type"] === "update" ? "update" : "count",
        delay: Math.max(0, kitNumber(options["animation-delay"], 1)) * 1000,
        duration: Math.max(0.1, kitNumber(options["animation-duration"], 1)) * 1000,
        loop: options["animation-loop"] === true, interval: Math.max(0, kitNumber(options["animation-interval"])) * 1000,
        decimals: Math.max(0, Math.min(12, Math.trunc(kitNumber(options["decimal-places"], 2)))),
        completeZero: options["complete-zero"] === true, grouping: options["comma-display"] === true,
        digits: options["integer-digits"] === "fixed" ? Math.max(1, Math.min(21, Math.trunc(kitNumber(options["fixed-digits"], 2)))) : 1,
      };
    }
    if (["widget.basic.text", "widget.basic.paragraph"].includes(meta.source.type) && options["animation-display"] === true) {
      node.data.__kitTextAnimation = {
        mode: options["animation-type"] === "blink" ? "blink" : "scroll",
        delay: Math.max(0, kitNumber(options["animation-delay"], 1)) * 1000,
        duration: Math.max(0.1, kitNumber(options["animation-duration"], 1)) * 1000,
        loop: options["animation-loop"] === true, interval: Math.max(0, kitNumber(options["animation-interval"])) * 1000,
        easing: String(options["animation-easing"] ?? "none"),
      };
    }
  }
  if (meta.source.type.startsWith("widget.basic.main-video")) {
    media("main-video", kitFileUrl(options["background-video"] ?? options["background-video-path"]),
      node.x, node.y, node.width, node.height);
    const [width, height] = kitPair(options["main-element-size"], [260, 260]);
    const [dx, dy] = kitPair(options["main-element-position"], [0, 0]);
    media("main-element", kitFileUrl(options["main-element-path"]),
      node.x + (node.width - width) / 2 + dx, node.y + (node.height - height) / 2 + dy, width, height);
    const labels = Array.isArray(options["text-display"]) ? options["text-display"] : [];
    const values = Array.isArray(options["number-display"]) ? options["number-display"] : [];
    const labelFont = kitRecord(options["text-font"]);
    const valueFont = kitRecord(options["number-font"] ?? options["number-text-font"]);
    for (const [index, value] of values.slice(0, 4).entries()) {
      const x = node.x + node.width * (index % 2 ? .61 : .30);
      const y = node.y + node.height * (index < 2 ? .25 : .39);
      extra.push({ ...node, id: `${node.id}::kit-value-${index}`, x, y, width: node.width * .09, height: node.height * .065,
        color: kitColor(valueFont.color, "#86d0ff"), widget: { ...node.widget, kind: "metric", text: String(labels[index] ?? ""),
          value: String(value), fontSize: kitNumber(valueFont.size, 32), fontFamily: String(labelFont.family ?? ""),
          background: "transparent", borderStyle: "none", borderWidth: 0 }, data: { __kitDecoration: true, passThrough: true },
      });
    }
  }
  return extra;
}
