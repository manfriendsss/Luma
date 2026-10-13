// Kiểm tra cấu trúc nhanh: các phần tử giao diện và module bắt buộc tồn tại.
import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const html = await read("src/index.html");
const main = await read("src/js/main.js");

for (const id of [
  "editorCanvas", "canvasViewport", "imageFrame", "frameOverlay", "filmstripList", "presetDrawer", "presetList",
  "presetFileInput", "presetPreviewCanvas", "presetAmountRange", "savePresetButton", "previousSettingsButton",
  "copySettingsButton", "pasteSettingsButton", "syncSettingsButton", "undoButton", "redoButton", "exportDialog",
  "deliverySelect", "resizeSelect", "keepExifToggle", "exportProgress", "maskList", "maskControls", "histogramCanvas",
  "curveCanvas", "gradeWheels", "cropBar", "cropAngleRange", "clippingButton", "eyedropperButton", "autoToneButton",
  "restoreCard", "settingsDialog", "nameDialog", "shortcutsDialog", "hslHueControls", "hslSaturationControls", "hslLuminanceControls",
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `thiếu #${id}`);
}
assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/, "app.js phải được nạp dạng module");
assert.match(html, />LUMA</, "thương hiệu LUMA viết hoa");
assert.match(html, /id="presetDrawer"[^>]*\binert\b/, "ngăn preset đóng phải có inert");
assert.doesNotMatch(html, /<button[^>]*>\s*<span[^>]*thumb-select/, "không lồng nút trong nút");

for (const fn of [
  "undo", "redo", "applyPreset", "applyPresetSettings", "importPresetFiles", "saveCurrentAsPreset", "deletePreset",
  "exportImages", "renderPhotoToBlob", "startBrushStroke", "updateMaskGeometry", "updateCropGesture", "sampleWhiteBalance",
  "runAutoTone", "openSettingsDialog", "pasteSettings", "copyPreviousSettings", "removePhoto", "restoreSession", "toggleFullscreen",
]) {
  assert.match(main, new RegExp(`function\\s+${fn}\\b`), `thiếu ${fn}()`);
}
for (const module of ["config", "settings", "renderer", "geometry", "presets", "curve", "color", "widgets", "controls", "zip", "jpeg-meta", "storage"]) {
  await read(`src/js/${module}.js`);
}
console.log("✓ LUMA smoke checks passed.");
