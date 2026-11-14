# Reference model integration verification

2026-10-31 — local development workspace.

- 28 CC0 Kenney models were downloaded with their GLB geometry and palette textures.
- Offline conversion generated 3.2 MiB of validated GPU vertex data and matching model thumbnails.
- 19 frontend tests and 8 Rust tests passed, including resource replacement/undo, project JSON
  round-trip, all 28 mesh binaries, normalized bounds/normals, WGSL validation and storage layout.
- TypeScript, Oxlint, production build and WASM release build passed.
- The native Metal GPU probe successfully rendered/read back pixels on an AMD Radeon Pro 5300M.
- The in-app browser initially timed out on the old parallel WebGPU probes and correctly used
  Canvas2D, showing real mesh geometry rather than placeholder boxes.
- Concurrent probes are now shared, with stage-specific diagnostics and a 5-second timeout.
  After reload, the full 70-object reference campus rendered through the Rust WebGPU engine;
  the UI reported WebGPU and 67 drawable model instances. No new GPU/runtime errors appeared.
- The production preview on port 4173 also rendered the complete campus through WebGPU
  (27 FPS observed), with no console warnings or errors. Its temporary preview server was stopped.

Browser checks confirmed search (one valve result), the nine-building category, click insertion,
drag insertion, resource replacement (456-triangle valve to 448-triangle bend), one-step undo,
and restored the campus to 70 objects after testing.
The asset browser exposes thumbnails, search, category filters, click insertion and drag insertion.
The property inspector exposes the selected resource, triangle count, author/license link and model
replacement. Placement, rotation, scaling and history use the existing scene state and persistence.

The models are stylized low-poly references. Arbitrary runtime GLB import and PBR material rendering
remain outside this integration. Source assets and attribution are retained in
`frontend/public/models/ATTRIBUTION.md` and `sources.json`.

Screenshots: [full campus](screenshots/reference-campus.webp), [asset library](screenshots/model-library.webp).
