// Kiểm tra cấu trúc nhanh: các phần tử giao diện và module bắt buộc tồn tại.
import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const html = await read("src/index.html");

for (const id of [
  "editorCanvas", "canvasViewport", "imageFrame", "frameOverlay", "filmstripList", "filterSelect", "presetDrawer", "presetList",
  "presetFileInput", "presetAmountRange", "savePresetButton", "settingsMenu", "settingsMenuButton", "menuPrevious", "menuCopy", "menuPaste",
  "menuSync", "menuVirtualCopy", "menuReset", "undoButton", "redoButton", "openFolderButton", "langToggle", "exportDialog",
  "exportPresetSelect", "templateInput", "sharpenSelect", "deliverySelect", "resizeSelect", "keepExifToggle", "exportProgress",
  "controlPanel", "panelHandle", "panelBody", "panelLockNote", "soloToggle", "maskList", "maskControls", "rangeTypeSelect",
  "rangeControls", "histogramCanvas", "histogramInfo", "curveCanvas", "gradeWheels", "lensControls", "historyList", "snapshotList",
  "snapshotButton", "cropBar", "cropAngleRange", "cropGridSelect", "swapCropButton", "clippingButton", "eyedropperButton",
  "autoToneButton", "previewBadge", "maskBadge", "restoreCard", "folderChip", "storageInfo", "settingsDialog", "nameDialog", "shortcutsDialog",
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `thiếu #${id}`);
}
assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/, "app.js phải được nạp dạng module");
assert.match(html, />LUMA</, "thương hiệu LUMA viết hoa");
assert.match(html, /id="presetDrawer"[^>]*\binert\b/, "ngăn preset đóng phải có inert");
assert.match(html, /id="controlPanel"[^>]*\binert\b/, "bảng điều chỉnh đóng phải có inert");
assert.doesNotMatch(html, /drawerBackdrop/, "ngăn preset không còn lớp phủ làm mờ ảnh");
assert.equal((html.match(/data-section="/g) || []).length, 10, "đủ 10 nhóm trong bảng điều chỉnh");

const modules = {
  "main.js": ["onKeyDown", "start", "bindToolbar"],
  "core.js": ["undo", "redo", "stepHistory", "pushHistory", "focusOwnsKeys"],
  "photos.js": ["createPhoto", "ensureBitmap", "openFolderHandle", "writeSidecar", "createVirtualCopy", "removePhoto", "setRating", "setFlag"],
  "view.js": ["render", "setZoom", "startBrushStroke", "updateMaskGeometry", "updateCropGesture", "swapCropOrientation", "exitMaskEditing", "sampleWhiteBalance"],
  "panel.js": ["setPanelOpen", "togglePanel", "syncSectionStates", "addMask", "deleteMask", "renderHistoryPanel", "resetPhoto"],
  "presets-ui.js": ["applyPreset", "applyPresetSettings", "importPresetFiles", "saveCurrentAsPreset", "deletePreset", "clearPreview"],
  "export.js": ["exportImages", "renderPhotoToBlob", "formatFileName", "openExportDialog"],
  "dialogs.js": ["openSettingsDialog", "pasteSettings", "copyPreviousSettings", "askName"],
  "filmstrip.js": ["renderFilmstrip", "passesFilter", "navigatePhoto"],
  "session.js": ["flushAutosave", "restoreSession"],
  "i18n.js": ["setLanguage", "translate"],
};
for (const [file, fns] of Object.entries(modules)) {
  const code = await read(`src/js/${file}`);
  for (const fn of fns) assert.match(code, new RegExp(`function\\s+${fn}\\b`), `${file}: thiếu ${fn}()`);
}
for (const module of ["config", "settings", "renderer", "geometry", "presets", "curve", "color", "widgets", "controls", "zip", "jpeg-meta", "storage"]) {
  await read(`src/js/${module}.js`);
}
console.log("✓ LUMA smoke checks passed.");
