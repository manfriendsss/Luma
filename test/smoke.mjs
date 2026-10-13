import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";

const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const js = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const distHtml = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
const distCss = await readFile(new URL("../dist/styles.css", import.meta.url), "utf8");
const distJs = await readFile(new URL("../dist/app.js", import.meta.url), "utf8");

assert.equal(distHtml, html, "dist/index.html is stale; run npm run build");
assert.equal(distCss, css, "dist/styles.css is stale; run npm run build");
assert.equal(distJs, js, "dist/app.js is stale; run npm run build");

for (const id of [
  "editorCanvas", "filmstripList", "presetDrawer", "presetList", "presetFileInput",
  "previousSettingsButton", "undoButton", "exportDialog", "maskControls",
  "presetDrawerHandle", "hslHueControls", "hslSaturationControls", "hslLuminanceControls",
  "maskGeometryOverlay", "gradientGuide", "radialGuide"
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
}

for (const feature of [
  "copyPreviousSettings", "undoLastAction", "parseLightroomPreset", "importPresetFiles",
  "exportImages", "paintMask", "toggleFullscreen", "updateGeometricMask", "syncMaskGeometryOverlay"
]) {
  assert.match(js, new RegExp(`function\\s+${feature}\\b`), `missing ${feature}()`);
}

assert.match(css, /--accent:\s*#19c9f2/i, "ocean-blue accent is missing");
assert.match(css, /--bg:\s*#2d2f32/i, "neutral gray background is missing");
assert.match(css, /\.drawer-handle\.open/, "moving preset drawer handle is missing");
assert.match(css, /input\.color-track/, "colored slider tracks are missing");
assert.match(js, /applyHslMix\(/, "WebGL HSL processing is missing");
assert.match(js, /type === "gradient" \? 3/, "linear gradient mask mode is missing");
assert.match(js, /type === "radial" \? 4/, "radial mask mode is missing");
assert.doesNotMatch(js, /preset-list-swatch/, "preset list should not render thumbnail swatches");
assert.doesNotMatch(css, /#e92cae|#7847ff/i, "old pink-purple theme remains");
assert.match(html, />LUMA</, "brand must be uppercase LUMA");

console.log("LUMA smoke checks passed.");
