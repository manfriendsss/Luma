# LUMA Agent Guide

## Project

LUMA is a dependency-free, local-first photo editor. `src/` is the source of truth (native ES modules, no bundler) and `dist/` is the generated runnable copy (git-ignored). Images stay in the browser and are never uploaded; sessions are autosaved to IndexedDB on the user's device.

## CodeGraph

This repository includes a `.codegraph/` index. Before searching or reading implementation files, use:

```powershell
codegraph explore "your question or symbol"
```

After source changes, refresh the graph with:

```powershell
codegraph sync .
```

## Run and verify

```powershell
npm start
npm run build
npm run check
npm test
npm run test:e2e   # needs Playwright + Chromium; skipped automatically if missing
```

Open `http://127.0.0.1:4173`. Chrome or Edge with WebGL 2 is recommended.

## Architecture

- `src/index.html`: application shell and dialogs.
- `src/styles.css`: neutral-gray/ocean-blue interface.
- `src/app.js`: entry point, imports `src/js/main.js`.
- `src/js/main.js`: bootstrap, toolbar wiring and global keyboard shortcuts (`window.__luma` test hook).
- `src/js/core.js`: shared `state`, `el` DOM proxy, hooks, toasts, labelled undo/redo history (`record`, `beginGesture`/`endGesture`, `stepHistory`).
- `src/js/photos.js`: import, sequential decode, LRU of decoded bitmaps (`ensureBitmap`, max 2 resident), folder handles + `.luma.json` sidecars, virtual copies, rating/flag, remove/undo.
- `src/js/view.js`: viewport layout, zoom/pan, render scheduling, histogram, overlays, pointer tools (brush, gradient, radial, crop, eyedropper, range picker).
- `src/js/panel.js`: right panel drawer (locked/closed without a photo), sections (solo, bypass, modified dots), bindings, masks + range refine, history/snapshot panel.
- `src/js/gridview.js`: Grid (culling) and Survey (2–4 photos) views, edited-thumbnail queue (`refreshPreviews`, keyed by `settingsKey`).
- `src/js/worker.js` + `worker-client.js` + `render-tasks.js`: module Web Worker with its own `Renderer` on an OffscreenCanvas – `analyze` (decode, thumbnail, stats), `preview`, `export` (tiles, watermark, encode, EXIF). Every caller has a main-thread fallback when `state.capabilities.worker` is false.
- `src/js/lut.js` (pure `.cube` parser + `luma-library` IndexedDB, not cleared with the session), `luts-ui.js` (LUT panel), `watermark.js` (`drawWatermark`).
- `src/js/filmstrip.js`, `presets-ui.js`, `dialogs.js`, `export.js`, `session.js`, `i18n.js`: filmstrip/filters, preset drawer with main-canvas preview, settings menu/copy/sync, export presets + filename templates, autosave, VI/EN translation.
- `src/js/renderer.js`: WebGL 2 pipeline (uses `effectiveSettings`, so bypassed sections are skipped in preview and export). Order: perspective (`u_persp`) → lens → calibration matrix (linear) → exposure/WB → detail → tone → curve LUT (parametric ∘ point) → HSL → grade → 3D LUT (`sampler3D`, `lutResolver`) → masks → vignette/grain. `drawView({ reference })` renders a history step/snapshot instead of the original for Before/Split. sRGB mipmapped source texture; exposure/white balance in linear light; tone, curve (LUT), HSL, color grading, up to 8 masks (R8 texture array), vignette, grain, dithering. All radii are in source pixels so preview matches export. Tiled rendering for export.
- `src/js/geometry.js`: crop/straighten/rotate/flip transforms, `lensParams`, `perspectiveParams` (3×3 homography in normalized coords) and `warpParams`; `outputToSource`/`sourceToOutput` take the warp object (keep in sync with the shader).
- `src/js/presets.js`: Lightroom XMP/lrtemplate and LUMA JSON import/export (pure, unit-tested).
- `src/js/settings.js`, `config.js`: settings model, defaults, built-in presets.
- `src/js/curve.js`, `color.js`, `widgets.js`, `controls.js`, `zip.js`, `jpeg-meta.js`, `storage.js`: helpers.
- `scripts/build.mjs`: cleans and copies `src/` to `dist/`. `scripts/check.mjs`: syntax check.
- `server.mjs`: zero-dependency local static server.
- `launch-luma.ps1` and `Luma.bat`: Windows desktop launcher (Node first, Python fallback with correct JS MIME type).
- `test/`: smoke, unit (Node only) and e2e (Playwright) tests with fixtures.

## Invariants

- Never upload user photos or add network processing.
- Edits are non-destructive: colour adjustments plus crop/straighten/rotate/flip geometry stored as settings; the original file is never modified.
- Do not replace faces, skies, or image content (masks only adjust colour/tone/detail).
- Preserve per-photo settings, masks and history when switching filmstrip items.
- Export at the full resolution of the crop unless the user picks a long-edge limit; never overwrite existing files.
- Lightroom sign conventions are used for shared sliders (e.g. negative vignette darkens).
- Bitmaps are released when not active; always go through `ensureBitmap` (pin while exporting).
- Run `npm run build`, `npm run check`, `npm test`, `npm run test:e2e` and `codegraph sync .` after changes.
