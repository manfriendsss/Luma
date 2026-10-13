# LUMA Agent Guide

## Project

LUMA is a dependency-free, local-first photo editor. `src/` is the source of truth and `dist/` is the generated runnable copy. Images stay in the browser and are never uploaded.

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
```

Open `http://127.0.0.1:4173`. Chrome or Edge with WebGL 2 is recommended.

## Architecture

- `src/index.html`: semantic application shell and dialogs.
- `src/styles.css`: responsive neutral-gray/ocean-blue interface, preset drawer, filmstrip, controls.
- `src/app.js`: state, WebGL shader, multi-image workflow, masking, preset import, undo, and export.
- `dist/`: generated runnable copy; do not edit it directly.
- `scripts/build.mjs`: copies `src/` to `dist/` without dependencies.
- `server.mjs`: zero-dependency local static server.
- `launch-luma.ps1` and `Luma.bat`: Windows desktop launcher.
- `assets/`: source-quality application icon assets.

## Invariants

- Never upload user photos or add network processing.
- Photo adjustments must remain non-destructive and color-only.
- Do not replace faces, skies, or image content.
- Preserve per-photo settings when switching filmstrip items.
- Keep batch export at the original image dimensions.
- Run `npm run build`, `npm run check`, `npm test`, and `codegraph sync .` after changes.
