# Board CJK font

`NotoSansSC-Regular.otf` is the Simplified Chinese subset distributed by the Noto CJK project:

- Source: https://github.com/notofonts/noto-cjk/blob/main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf
- License: SIL Open Font License 1.1, included in [OFL.txt](OFL.txt).
- Copyright: font copyright and author information are retained in the original OpenType name table.

The unmodified font is embedded in the WebAssembly binary. `BoardCanvas.font_license()` exposes the
license as readable text. egui's bundled Latin fonts remain available; this font supplies CJK glyphs.
