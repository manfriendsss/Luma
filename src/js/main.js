import {
  controlGroups, hslGroups, maskControlGroup, builtInPresets, valueDefaults, controlById,
  MAX_MASKS, MASK_TEXTURE_LONG_EDGE, HISTORY_LIMIT, gradeZones, maskTypes, aspectRatios, settingGroups,
} from "./config.js";
import {
  defaultSettings, defaultCurve, defaultGrade, defaultCrop, cloneSettings, cloneCurve, cloneGrade, createMask,
  settingsEqual, mergeSettingGroups, isIdentityCurve,
} from "./settings.js";
import { blendCurvePoints } from "./curve.js";
import { Renderer } from "./renderer.js";
import {
  outputSize, outputToSource, sourceToOutput, fitCropInside, isCropInside, straightenedBounds,
  cropRectInView, cropFromViewRect, rotateQuarter, aspectValue, applyAspect,
} from "./geometry.js";
import { parseLightroomPreset, presetToLumaJson, presetToXmp, migrateStoredPreset } from "./presets.js";
import { analyzePixels, autoTone, autoWhiteBalance, neutralizeWhiteBalance, srgbToLinear } from "./color.js";
import { computeHistogram, drawHistogram, CurveEditor, ColorWheel } from "./widgets.js";
import { buildControls, setRangeProgress } from "./controls.js";
import { createZipParts } from "./zip.js";
import { findExifSegment, sanitizeExifSegment, injectExif } from "./jpeg-meta.js";
import * as storage from "./storage.js";

/* ============================================================
   Trạng thái
   ============================================================ */

const state = {
  photos: [],
  activeId: null,
  previewMode: "after",
  holdingBefore: false,
  splitPos: 0.5,
  view: { fit: true, scale: 1, panX: 0, panY: 0 },
  tool: null, // null | "crop" | "eyedropper"
  cropSession: null,
  showMaskOverlay: false,
  clipping: false,
  clipboard: null,
  syncGroups: settingGroups.filter((g) => !["crop", "masks"].includes(g.id)).map((g) => g.id),
  drawerOpen: false,
  curveChannel: "master",
  spaceDown: false,
  gesture: null,
  exporting: null,
  storedSession: null,
  lastPointer: null,
  layout: null,
};

const PRESET_STORAGE_KEY = "lumaPresets.v2";
const LEGACY_PRESET_KEY = "lumaImportedPresets";
let userPresets = loadUserPresets();

const $ = (id) => document.getElementById(id);
const el = new Proxy({}, { get: (cache, id) => cache[id] || (cache[id] = $(id)) });

let renderer = null;
let renderFrame = null;
let histogramTimer = null;
let toastTimer = null;
let autosaveTimer = null;
const dirtyPhotos = new Set();
let controlSets = [];
let maskControlSet = null;
let curveEditor = null;
const gradeWidgets = {};
let gradeControlSet = null;

/* ============================================================
   Tiện ích
   ============================================================ */

const activePhoto = () => state.photos.find((p) => p.id === state.activeId) || null;
const activeMask = (photo = activePhoto()) => photo?.settings.masks.find((m) => m.id === photo.activeMaskId) || null;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const editingText = () => {
  const a = document.activeElement;
  return a && (a.tagName === "TEXTAREA" || a.tagName === "SELECT" || (a.tagName === "INPUT" && !["range", "checkbox", "button"].includes(a.type)));
};

function showToast(message, action = null, duration = 3200) {
  el.toastMessage.textContent = message;
  el.toastAction.hidden = !action;
  if (action) {
    el.toastAction.textContent = action.label;
    el.toastAction.onclick = () => { el.toast.classList.remove("show"); action.run(); };
  }
  el.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), action ? Math.max(duration, 5200) : duration);
}

function setStatus(text) { el.renderStatus.textContent = text; }

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function safeLocalStorage(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

/* ============================================================
   Lịch sử (hoàn tác / làm lại)
   ============================================================ */

function pushHistory(photo, snapshot) {
  if (!photo || !snapshot) return;
  photo.history.push(snapshot);
  if (photo.history.length > HISTORY_LIMIT) photo.history.shift();
  photo.future = [];
  updateActionButtons();
}

/** Ghi lại trạng thái trước một thao tác rời rạc. */
function record(photo = activePhoto()) {
  if (photo) pushHistory(photo, cloneSettings(photo.settings));
}

/** Bắt đầu một cử chỉ (kéo thanh trượt, vẽ…): chỉ đẩy lịch sử nếu có thay đổi thật. */
function beginGesture(photo = activePhoto()) {
  if (!photo) return null;
  return { photoId: photo.id, snapshot: cloneSettings(photo.settings) };
}

function endGesture(gesture) {
  if (!gesture) return;
  const photo = state.photos.find((p) => p.id === gesture.photoId);
  if (!photo) return;
  if (!settingsEqual(gesture.snapshot, photo.settings)) {
    pushHistory(photo, gesture.snapshot);
    markDirty(photo);
  }
}

function undo() {
  const photo = activePhoto();
  if (!photo || !photo.history.length || state.tool === "crop") return;
  photo.future.push(cloneSettings(photo.settings));
  photo.settings = photo.history.pop();
  photo.presetState = null;
  ensureActiveMask(photo);
  settingsChanged(photo);
  showToast("Đã hoàn tác.");
}

function redo() {
  const photo = activePhoto();
  if (!photo || !photo.future.length || state.tool === "crop") return;
  photo.history.push(cloneSettings(photo.settings));
  photo.settings = photo.future.pop();
  photo.presetState = null;
  ensureActiveMask(photo);
  settingsChanged(photo);
  showToast("Đã làm lại.");
}

function ensureActiveMask(photo) {
  if (!photo.settings.masks.some((m) => m.id === photo.activeMaskId)) {
    photo.activeMaskId = photo.settings.masks.at(-1)?.id || null;
  }
}

/** Gọi sau mỗi thay đổi thiết lập để cập nhật toàn bộ giao diện liên quan. */
function settingsChanged(photo = activePhoto(), { save = true } = {}) {
  if (!photo) return;
  if (save) markDirty(photo);
  if (photo.id !== state.activeId) { updateFilmstripBadges(); return; }
  syncAllControls();
  renderMaskUI();
  setActivePresetMark();
  updateActionButtons();
  updateFilmstripBadges();
  scheduleRender();
}

/* ============================================================
   Nạp ảnh
   ============================================================ */

async function decodeImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image", premultiplyAlpha: "none", colorSpaceConversion: "default" });
  } catch {
    // Một số trình duyệt cũ không nhận tuỳ chọn → giải mã qua <img>
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error("decode")); img.src = url; });
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function createPhoto(file, { id, settings, selected = true } = {}) {
  if (file.type && !file.type.startsWith("image/")) throw new Error(`${file.name}: định dạng không được hỗ trợ.`);
  let bitmap;
  try { bitmap = await decodeImage(file); } catch { throw new Error(`${file.name}: không thể đọc ảnh.`); }
  const max = renderer.maxTextureSize;
  if (bitmap.width > max || bitmap.height > max) {
    bitmap.close?.();
    throw new Error(`${file.name}: ảnh ${bitmap.width}×${bitmap.height} vượt giới hạn ${max}px của GPU trên máy này.`);
  }
  const scale = Math.min(1, MASK_TEXTURE_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
  const photo = {
    id: id || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
    file,
    name: file.name || "anh.jpg",
    url: URL.createObjectURL(file),
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    maskSize: { width: Math.max(1, Math.round(bitmap.width * scale)), height: Math.max(1, Math.round(bitmap.height * scale)) },
    selected,
    settings: normalizeSettings(settings, bitmap.width, bitmap.height),
    history: [],
    future: [],
    activeMaskId: null,
    presetState: null,
    liveBrush: null,
    analysis: null,
  };
  ensureActiveMask(photo);
  return photo;
}

/** Bổ sung trường thiếu cho thiết lập cũ hoặc thiết lập khôi phục. */
function normalizeSettings(settings, width, height) {
  const base = defaultSettings(width, height);
  if (!settings) return base;
  const masks = Array.isArray(settings.masks) ? settings.masks.slice(0, MAX_MASKS).map((m) => {
    const fresh = createMask(m.type);
    return { ...fresh, ...m, values: { ...fresh.values, ...(m.values || {}) }, linear: m.linear || fresh.linear, radial: { ...fresh.radial, ...(m.radial || {}) } };
  }) : [];
  return {
    values: { ...base.values, ...(settings.values || {}) },
    curve: cloneCurve(settings.curve),
    grade: cloneGrade(settings.grade),
    crop: settings.crop ? fitCropInside({ ...base.crop, ...settings.crop }, width, height) : base.crop,
    masks,
    preset: settings.preset ?? null,
  };
}

function photoAnalysis(photo) {
  if (photo.analysis) return photo.analysis;
  const scale = Math.min(1, 512 / Math.max(photo.width, photo.height));
  const w = Math.max(1, Math.round(photo.width * scale));
  const h = Math.max(1, Math.round(photo.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(photo.bitmap, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  photo.analysis = { width: w, height: h, data, stats: analyzePixels(data) };
  return photo.analysis;
}

async function loadFiles(files) {
  const accepted = [...files].filter((f) => !f.type || f.type.startsWith("image/"));
  if (!accepted.length) { showToast("Vui lòng chọn ảnh JPG, PNG hoặc WebP."); return; }
  if (state.storedSession && !state.photos.length) {
    // Người dùng bắt đầu phiên mới thay vì khôi phục
    await storage.clearSession().catch(() => {});
    state.storedSession = null;
    el.restoreCard.hidden = true;
  }
  setStatus(`Đang mở ${accepted.length} ảnh…`);
  const results = await Promise.allSettled(accepted.map((f) => createPhoto(f)));
  const added = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const failed = results.filter((r) => r.status === "rejected");
  state.photos.push(...added);
  for (const p of added) {
    storage.saveFile(p.id, p.file).catch(() => {});
    markDirty(p);
  }
  renderFilmstrip();
  if (added.length) activatePhoto(added[0].id);
  if (failed.length) showToast(failed.length === 1 ? failed[0].reason.message : `Đã thêm ${added.length} ảnh, ${failed.length} ảnh không mở được.`);
  else showToast(`Đã thêm ${added.length} ảnh.`);
  el.fileInput.value = "";
  if (!added.length) setStatus("Sẵn sàng");
}

function activatePhoto(id) {
  const photo = state.photos.find((p) => p.id === id);
  if (!photo) return;
  if (state.tool === "crop") finishCrop(true);
  if (state.tool === "eyedropper") setTool(null);
  state.activeId = id;
  state.view = { fit: true, scale: 1, panX: 0, panY: 0 };
  el.emptyState.hidden = true;
  el.editorCanvas.hidden = false;
  el.imageFrame.hidden = false;
  el.filmstripSection.hidden = false;
  el.fileName.textContent = photo.name;
  el.fileName.title = photo.name;
  setStatus("Ảnh được xử lý cục bộ");
  for (const id2 of ["resetButton", "exportButton", "zoomOutButton", "zoomInButton", "fitButton", "actualSizeButton", "cropToolButton", "clippingButton", "autoToneButton", "eyedropperButton", "autoWhiteBalanceButton", "copySettingsButton", "savePresetButton"]) el[id2].disabled = false;
  document.querySelectorAll("[data-add-mask]").forEach((b) => { b.disabled = false; });
  updateDimensions();
  syncAllControls();
  renderMaskUI();
  renderPresetList();
  updateActionButtons();
  renderFilmstrip();
  scheduleAutosave();
  requestAnimationFrame(() => { scheduleRender(); });
  document.querySelector(`.thumb-card[data-id="${id}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function updateDimensions() {
  const photo = activePhoto();
  if (!photo) return;
  const out = outputSize(photo.settings.crop);
  const cropped = Math.round(out.width) !== photo.width || Math.round(out.height) !== photo.height;
  el.fileDimensions.textContent = cropped
    ? `${Math.round(out.width)} × ${Math.round(out.height)} (gốc ${photo.width} × ${photo.height})`
    : `${photo.width} × ${photo.height}`;
}

/* ============================================================
   Hiển thị: bố cục, zoom/pan, render
   ============================================================ */

function displayCrop(photo) {
  const crop = photo.settings.crop;
  return state.tool === "crop" ? straightenedBounds(crop, photo.width, photo.height) : crop;
}

function computeLayout(photo) {
  const vp = el.canvasViewport;
  const vw = vp.clientWidth;
  const vh = vp.clientHeight;
  const crop = displayCrop(photo);
  const out = outputSize(crop);
  const pad = state.tool === "crop" ? 44 : 22;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const fitScale = Math.max(0.01, Math.min((vw - pad * 2) / out.width, (vh - pad * 2) / out.height, 1));
  const scale = state.view.fit || state.tool === "crop" ? fitScale : state.view.scale;
  const width = out.width * scale;
  const height = out.height * scale;
  const panX = state.view.fit || state.tool === "crop" ? 0 : state.view.panX;
  const panY = state.view.fit || state.tool === "crop" ? 0 : state.view.panY;
  return { vw, vh, dpr, crop, out, scale, fitScale, x: (vw - width) / 2 + panX, y: (vh - height) / 2 + panY, width, height };
}

function clampPan() {
  const photo = activePhoto();
  if (!photo || state.view.fit) return;
  const l = computeLayout(photo);
  const maxX = Math.max(0, (l.width - l.vw) / 2 + l.vw * 0.3);
  const maxY = Math.max(0, (l.height - l.vh) / 2 + l.vh * 0.3);
  state.view.panX = clamp(state.view.panX, -maxX, maxX);
  state.view.panY = clamp(state.view.panY, -maxY, maxY);
}

function zoomPercent(layout) {
  return Math.round(layout.scale * layout.dpr * 100);
}

/** Đặt mức zoom (đơn vị: px CSS trên mỗi pixel ảnh), giữ nguyên điểm ảnh dưới (anchorX, anchorY). */
function setZoom(scale, anchorX, anchorY) {
  const photo = activePhoto();
  if (!photo || state.tool === "crop") return;
  const before = computeLayout(photo);
  const dpr = before.dpr;
  const minScale = Math.min(before.fitScale, 0.05);
  const target = clamp(scale, minScale, 16 / dpr);
  const ax = anchorX ?? before.vw / 2;
  const ay = anchorY ?? before.vh / 2;
  const u = (ax - before.x) / before.width;
  const v = (ay - before.y) / before.height;
  if (Math.abs(target - before.fitScale) < 1e-4) {
    state.view = { fit: true, scale: target, panX: 0, panY: 0 };
  } else {
    const newW = before.out.width * target;
    const newH = before.out.height * target;
    state.view.fit = false;
    state.view.scale = target;
    state.view.panX = ax - u * newW - (before.vw - newW) / 2;
    state.view.panY = ay - v * newH - (before.vh - newH) / 2;
    clampPan();
  }
  scheduleRender();
}

const ZOOM_STEPS = [0.0625, 0.125, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
function stepZoom(direction, anchorX, anchorY) {
  const photo = activePhoto();
  if (!photo) return;
  const l = computeLayout(photo);
  const current = l.scale * l.dpr;
  let next;
  if (direction > 0) next = ZOOM_STEPS.find((s) => s > current * 1.01) ?? 16;
  else next = [...ZOOM_STEPS].reverse().find((s) => s < current * 0.99) ?? ZOOM_STEPS[0];
  if (direction < 0 && next < l.fitScale * l.dpr) { fitView(); return; }
  setZoom(next / l.dpr, anchorX, anchorY);
}

function fitView() {
  state.view = { fit: true, scale: 1, panX: 0, panY: 0 };
  scheduleRender();
}

function actualSize(anchorX, anchorY) {
  const photo = activePhoto();
  if (!photo) return;
  const l = computeLayout(photo);
  setZoom(1 / l.dpr, anchorX, anchorY);
}

function scheduleRender() {
  if (renderFrame) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = null;
    render();
  });
}

function sizeCanvas(layout) {
  const canvas = el.editorCanvas;
  const w = Math.max(1, Math.round(layout.vw * layout.dpr));
  const h = Math.max(1, Math.round(layout.vh * layout.dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  canvas.style.width = `${layout.vw}px`;
  canvas.style.height = `${layout.vh}px`;
}

function overlayMaskIndex(photo) {
  if (!state.showMaskOverlay || state.tool === "crop") return -1;
  return photo.settings.masks.findIndex((m) => m.id === photo.activeMaskId);
}

function render() {
  const photo = activePhoto();
  if (!photo || state.exporting) return;
  const layout = computeLayout(photo);
  state.layout = layout;
  sizeCanvas(layout);
  renderer.setPhoto(photo);
  renderer.syncMasks(photo.settings.masks, photo.liveBrush);
  const mode = state.holdingBefore ? "before" : state.previewMode;
  const d = layout.dpr;
  renderer.drawView(photo.settings, {
    crop: layout.crop,
    rect: { x: layout.x * d, y: layout.y * d, width: layout.width * d, height: layout.height * d },
    original: mode === "before",
    split: mode === "split" && state.tool !== "crop" ? (layout.x + layout.width * state.splitPos) * d : null,
    overlayMask: overlayMaskIndex(photo),
    clipping: state.clipping,
  });
  el.zoomValue.textContent = state.tool === "crop" ? "Cắt" : (state.view.fit ? `Vừa · ${zoomPercent(layout)}%` : `${zoomPercent(layout)}%`);
  el.beforeBadge.hidden = mode !== "before";
  el.maskBadge.hidden = overlayMaskIndex(photo) < 0;
  updateOverlay(layout);
  scheduleHistogram();
}

function scheduleHistogram() {
  clearTimeout(histogramTimer);
  histogramTimer = setTimeout(updateHistogram, 140);
}

let lastHistogram = null;
function updateHistogram() {
  const photo = activePhoto();
  if (!photo || state.exporting) return;
  renderer.setPhoto(photo);
  const { pixels } = renderer.renderThumbnail(photo.settings, photo.settings.crop, 220);
  lastHistogram = computeHistogram(pixels);
  drawHistogram(el.histogramCanvas, lastHistogram);
  el.shadowClipIndicator.classList.toggle("active", lastHistogram.shadowClip > 0.002);
  el.highlightClipIndicator.classList.toggle("active", lastHistogram.highlightClip > 0.002);
  if (curveEditor) { curveEditor.histogram = lastHistogram; curveEditor.draw(); }
  if (!state.lastPointer) updateHistogramInfo();
}

function updateHistogramInfo(text) {
  if (text) { el.histogramInfo.textContent = text; return; }
  const photo = activePhoto();
  if (!photo) { el.histogramInfo.textContent = "—"; return; }
  const v = photo.settings.values;
  el.histogramInfo.textContent = `Phơi sáng ${v.exposure > 0 ? "+" : ""}${v.exposure.toFixed(2)} EV · ${photo.settings.masks.length} vùng chọn`;
}

/* ---------- Toạ độ màn hình ↔ ảnh ---------- */

function viewportPoint(event) {
  const r = el.canvasViewport.getBoundingClientRect();
  return { x: event.clientX - r.left, y: event.clientY - r.top };
}

/** Điểm trên viewport (px CSS) → pixel ảnh gốc */
function screenToSource(photo, p, layout = state.layout) {
  const u = (p.x - layout.x) / layout.width;
  const v = (p.y - layout.y) / layout.height;
  const s = outputToSource(layout.crop, u, v);
  return { x: s.x, y: s.y, u, v };
}

function sourceToScreen(photo, x, y, layout = state.layout) {
  const { u, v } = sourceToOutput(layout.crop, x, y);
  return { x: layout.x + u * layout.width, y: layout.y + v * layout.height };
}

const insideImage = (p, layout = state.layout) => p.x >= layout.x && p.y >= layout.y && p.x <= layout.x + layout.width && p.y <= layout.y + layout.height;

/* ---------- Lớp phủ: khung cắt, hình học mask, đường chia ---------- */

function updateOverlay(layout) {
  const photo = activePhoto();
  const frame = el.imageFrame;
  frame.style.left = `${layout.x}px`;
  frame.style.top = `${layout.y}px`;
  frame.style.width = `${layout.width}px`;
  frame.style.height = `${layout.height}px`;
  const mode = state.holdingBefore ? "before" : state.previewMode;
  el.splitLine.hidden = !(mode === "split" && state.tool !== "crop");
  el.splitLine.style.left = `${state.splitPos * 100}%`;
  const svg = el.frameOverlay;
  svg.setAttribute("width", layout.width);
  svg.setAttribute("height", layout.height);
  svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
  let html = "";
  const toFrame = (x, y) => {
    const s = sourceToScreen(photo, x, y, layout);
    return [s.x - layout.x, s.y - layout.y];
  };
  if (state.tool === "crop") {
    const r = cropRectInView(photo.settings.crop, photo.width, photo.height);
    const x = r.x * layout.width, y = r.y * layout.height, w = r.w * layout.width, h = r.h * layout.height;
    const W = layout.width, H = layout.height;
    html += `<path class="crop-shade" fill-rule="evenodd" d="M0 0H${W}V${H}H0Z M${x} ${y}H${x + w}V${y + h}H${x}Z"/>`;
    html += `<rect class="crop-frame" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
    for (let i = 1; i < 3; i++) {
      html += `<line class="crop-grid" x1="${x + (w * i) / 3}" y1="${y}" x2="${x + (w * i) / 3}" y2="${y + h}"/>`;
      html += `<line class="crop-grid" x1="${x}" y1="${y + (h * i) / 3}" x2="${x + w}" y2="${y + (h * i) / 3}"/>`;
    }
    const c = 16;
    for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x + w, y + h, -1, -1], [x, y + h, 1, -1]]) {
      html += `<path class="crop-corner" d="M${cx} ${cy + dy * c}V${cy}H${cx + dx * c}"/>`;
    }
    for (const [mx, my, horizontal] of [[x + w / 2, y, true], [x + w / 2, y + h, true], [x, y + h / 2, false], [x + w, y + h / 2, false]]) {
      html += horizontal ? `<line class="crop-edge" x1="${mx - 10}" y1="${my}" x2="${mx + 10}" y2="${my}"/>` : `<line class="crop-edge" x1="${mx}" y1="${my - 10}" x2="${mx}" y2="${my + 10}"/>`;
    }
  } else if (photo) {
    const mask = activeMask(photo);
    if (mask && mask.type === "linear") {
      const s = toFrame(mask.linear.start.x * photo.width, mask.linear.start.y * photo.height);
      const e = toFrame(mask.linear.end.x * photo.width, mask.linear.end.y * photo.height);
      const dx = e[0] - s[0], dy = e[1] - s[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * 2000, ny = (dx / len) * 2000;
      for (const [px, py, cls] of [[s[0], s[1], "geo-line"], [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2, "geo-line geo-mid"], [e[0], e[1], "geo-line geo-dashed"]]) {
        html += `<line class="${cls}" x1="${px - nx}" y1="${py - ny}" x2="${px + nx}" y2="${py + ny}"/>`;
      }
      html += `<line class="geo-axis" x1="${s[0]}" y1="${s[1]}" x2="${e[0]}" y2="${e[1]}"/>`;
      html += `<circle class="geo-handle" cx="${s[0]}" cy="${s[1]}" r="6"/><circle class="geo-handle geo-handle-alt" cx="${e[0]}" cy="${e[1]}" r="6"/>`;
    } else if (mask && mask.type === "radial") {
      const pts = radialPoints(photo, mask).map(([px, py]) => toFrame(px, py));
      html += `<path class="geo-line" d="M${pts.map((p) => p.join(" ")).join("L")}Z"/>`;
      const inner = radialPoints(photo, mask, 1 - (mask.feather ?? 50) / 100).map(([px, py]) => toFrame(px, py));
      html += `<path class="geo-line geo-dashed" d="M${inner.map((p) => p.join(" ")).join("L")}Z"/>`;
      for (const [name, [hx, hy]] of Object.entries(radialHandles(photo, mask))) {
        const [fx, fy] = toFrame(hx, hy);
        html += `<circle class="geo-handle${name === "center" ? "" : " geo-handle-alt"}${name === "rotate" ? " geo-rotate" : ""}" cx="${fx}" cy="${fy}" r="${name === "center" ? 6 : 5}"/>`;
      }
    }
  }
  svg.innerHTML = html;
}

function radialGeometryPx(photo, mask) {
  const L = Math.max(photo.width, photo.height);
  const r = mask.radial;
  const rot = ((r.rotation || 0) * Math.PI) / 180;
  return { cx: r.center.x * photo.width, cy: r.center.y * photo.height, rx: r.rx * L, ry: r.ry * L, cos: Math.cos(rot), sin: Math.sin(rot), L };
}

function radialPoints(photo, mask, scale = 1) {
  const g = radialGeometryPx(photo, mask);
  const pts = [];
  for (let i = 0; i < 72; i++) {
    const t = (i / 72) * Math.PI * 2;
    const ex = Math.cos(t) * g.rx * scale, ey = Math.sin(t) * g.ry * scale;
    pts.push([g.cx + g.cos * ex - g.sin * ey, g.cy + g.sin * ex + g.cos * ey]);
  }
  return pts;
}

function radialHandles(photo, mask) {
  const g = radialGeometryPx(photo, mask);
  const at = (ex, ey) => [g.cx + g.cos * ex - g.sin * ey, g.cy + g.sin * ex + g.cos * ey];
  return { center: [g.cx, g.cy], rx: at(g.rx, 0), ry: at(0, g.ry), rotate: at(0, -g.ry - g.L * 0.04) };
}

/* ============================================================
   Thao tác chuột trên ảnh
   ============================================================ */

function hitTestCrop(photo, p, layout) {
  const r = cropRectInView(photo.settings.crop, photo.width, photo.height);
  const x = layout.x + r.x * layout.width, y = layout.y + r.y * layout.height;
  const w = r.w * layout.width, h = r.h * layout.height;
  const tol = 12;
  const nearL = Math.abs(p.x - x) < tol, nearR = Math.abs(p.x - (x + w)) < tol;
  const nearT = Math.abs(p.y - y) < tol, nearB = Math.abs(p.y - (y + h)) < tol;
  const withinX = p.x > x - tol && p.x < x + w + tol;
  const withinY = p.y > y - tol && p.y < y + h + tol;
  let edges = "";
  if (nearT && withinX) edges += "t";
  if (nearB && withinX) edges += "b";
  if (nearL && withinY) edges += "l";
  if (nearR && withinY) edges += "r";
  if (edges) return { kind: "resize", edges, rect: r };
  if (p.x > x && p.x < x + w && p.y > y && p.y < y + h) return { kind: "move", rect: r };
  return { kind: "rotate", rect: r };
}

function hitTestMask(photo, mask, p) {
  const layout = state.layout;
  const near = (pt, d = 11) => Math.hypot(pt.x - p.x, pt.y - p.y) < d;
  if (mask.type === "linear") {
    const s = sourceToScreen(photo, mask.linear.start.x * photo.width, mask.linear.start.y * photo.height, layout);
    const e = sourceToScreen(photo, mask.linear.end.x * photo.width, mask.linear.end.y * photo.height, layout);
    if (near(s)) return "start";
    if (near(e)) return "end";
    const dx = e.x - s.x, dy = e.y - s.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = clamp(((p.x - s.x) * dx + (p.y - s.y) * dy) / len2, 0, 1);
    if (Math.hypot(s.x + dx * t - p.x, s.y + dy * t - p.y) < 8) return "body";
    return null;
  }
  if (mask.type === "radial") {
    const handles = radialHandles(photo, mask);
    for (const name of ["rotate", "rx", "ry", "center"]) {
      if (near(sourceToScreen(photo, ...handles[name], layout))) return name;
    }
    const src = screenToSource(photo, p, layout);
    const g = radialGeometryPx(photo, mask);
    const dx = src.x - g.cx, dy = src.y - g.cy;
    const qx = g.cos * dx + g.sin * dy, qy = -g.sin * dx + g.cos * dy;
    if (Math.hypot(qx / g.rx, qy / g.ry) < 1) return "body";
  }
  return null;
}

// Các thành phần giao diện nằm trong khung ảnh nhưng không phải là ảnh
const isViewportChrome = (target) => target instanceof Element && !!target.closest(".crop-bar, .empty-state, .drop-overlay");

function onPointerDown(event) {
  const photo = activePhoto();
  if (!photo || state.exporting || !state.layout || isViewportChrome(event.target)) return;
  if (event.button === 2) return;
  const p = viewportPoint(event);
  const layout = state.layout;
  const capture = () => el.canvasViewport.setPointerCapture(event.pointerId);

  if (event.button === 1 || state.spaceDown) {
    event.preventDefault();
    if (state.tool === "crop") return;
    state.gesture = { kind: "pan", start: p, panX: state.view.panX, panY: state.view.panY, wasFit: state.view.fit, fitLayout: layout };
    capture();
    updateCursor(p);
    return;
  }

  if (state.tool === "eyedropper") {
    if (!insideImage(p)) return;
    sampleWhiteBalance(photo, p);
    return;
  }

  if (state.tool === "crop") {
    event.preventDefault();
    const hit = hitTestCrop(photo, p, layout);
    state.gesture = { kind: `crop-${hit.kind}`, edges: hit.edges, start: p, rect: { ...hit.rect }, crop: { ...photo.settings.crop } };
    if (hit.kind === "rotate") {
      const r = hit.rect;
      const cx = layout.x + (r.x + r.w / 2) * layout.width, cy = layout.y + (r.y + r.h / 2) * layout.height;
      state.gesture.center = { x: cx, y: cy };
      state.gesture.startAngle = Math.atan2(p.y - cy, p.x - cx);
    }
    capture();
    return;
  }

  const mode = state.holdingBefore ? "before" : state.previewMode;
  if (mode === "split") {
    const sx = layout.x + layout.width * state.splitPos;
    if (Math.abs(p.x - sx) < 10 && p.y >= layout.y && p.y <= layout.y + layout.height) {
      state.gesture = { kind: "split" };
      capture();
      return;
    }
  }

  const mask = activeMask(photo);
  if (mask && mask.visible !== false) {
    if (mask.type === "brush" && insideImage(p)) {
      event.preventDefault();
      startBrushStroke(photo, mask, p, event.altKey);
      capture();
      return;
    }
    if (mask.type === "linear" || mask.type === "radial") {
      const handle = hitTestMask(photo, mask, p);
      if (handle || insideImage(p)) {
        event.preventDefault();
        const src = screenToSource(photo, p, layout);
        state.gesture = {
          kind: "mask-geo", handle: handle || "create", mask, start: src,
          snapshot: beginGesture(photo), linear: JSON.parse(JSON.stringify(mask.linear)), radial: { ...mask.radial, center: { ...mask.radial.center } },
        };
        if (!handle) {
          const uv = { x: clamp(src.x / photo.width, 0, 1), y: clamp(src.y / photo.height, 0, 1) };
          if (mask.type === "linear") { mask.linear.start = { ...uv }; mask.linear.end = { ...uv }; }
          else { mask.radial.center = { ...uv }; mask.radial.rx = 0.01; mask.radial.ry = 0.01; }
        }
        capture();
        scheduleRender();
        return;
      }
    }
  }

  // Không có công cụ: kéo để di chuyển khi ảnh lớn hơn khung
  if (!state.view.fit && insideImage(p)) {
    state.gesture = { kind: "pan", start: p, panX: state.view.panX, panY: state.view.panY };
    capture();
    updateCursor(p);
  }
}

function onPointerMove(event) {
  const photo = activePhoto();
  if (!photo || !state.layout) return;
  const p = viewportPoint(event);
  state.lastPointer = p;
  const g = state.gesture;
  if (!g && isViewportChrome(event.target)) { el.canvasViewport.style.cursor = ""; el.brushCursor.hidden = true; return; }
  if (!g) {
    updateCursor(p, event);
    updateBrushCursor(p);
    updatePixelReadout(p);
    return;
  }
  const layout = state.layout;
  if (g.kind === "pan") {
    if (g.wasFit) {
      // Bắt đầu kéo khi đang "vừa khung" (giữ Space) → chuyển sang chế độ tuỳ chỉnh với cùng tỉ lệ
      state.view = { fit: false, scale: layout.scale, panX: 0, panY: 0 };
      g.wasFit = false;
    }
    state.view.panX = g.panX + (p.x - g.start.x);
    state.view.panY = g.panY + (p.y - g.start.y);
    clampPan();
    scheduleRender();
  } else if (g.kind === "split") {
    state.splitPos = clamp((p.x - layout.x) / layout.width, 0.02, 0.98);
    scheduleRender();
  } else if (g.kind === "brush") {
    continueBrushStroke(photo, p);
    updateBrushCursor(p);
  } else if (g.kind === "mask-geo") {
    updateMaskGeometry(photo, g, screenToSource(photo, p, layout), event);
  } else if (g.kind.startsWith("crop-")) {
    updateCropGesture(photo, g, p, event);
  }
}

function onPointerUp() {
  const g = state.gesture;
  const photo = activePhoto();
  state.gesture = null;
  if (!g || !photo) return;
  if (g.kind === "brush") endBrushStroke(photo, g);
  if (g.kind === "mask-geo") {
    if (g.handle === "create") {
      const m = g.mask;
      // Bấm mà không kéo: giữ hình cũ, chỉ dời vị trí
      if (m.type === "linear" && Math.hypot((m.linear.end.x - m.linear.start.x) * photo.width, (m.linear.end.y - m.linear.start.y) * photo.height) < 4) {
        const dx = m.linear.start.x - (g.linear.start.x + g.linear.end.x) / 2;
        const dy = m.linear.start.y - (g.linear.start.y + g.linear.end.y) / 2;
        m.linear = { start: { x: g.linear.start.x + dx, y: g.linear.start.y + dy }, end: { x: g.linear.end.x + dx, y: g.linear.end.y + dy } };
      }
      if (m.type === "radial" && m.radial.rx < 0.012 && m.radial.ry < 0.012) {
        m.radial = { ...g.radial, center: { ...m.radial.center } };
      }
      scheduleRender();
    }
    endGesture(g.snapshot);
    syncMaskEditor();
  }
  if (g.kind.startsWith("crop-")) updateDimensions();
  if (g.kind === "pan" || g.kind === "split") scheduleRender();
}

function updateCursor(p, event) {
  const photo = activePhoto();
  const vp = el.canvasViewport;
  if (!photo || !state.layout) { vp.style.cursor = ""; return; }
  let cursor = "default";
  if (state.spaceDown || state.gesture?.kind === "pan") cursor = state.gesture ? "grabbing" : "grab";
  else if (state.tool === "eyedropper") cursor = insideImage(p) ? "crosshair" : "default";
  else if (state.tool === "crop") {
    const hit = hitTestCrop(photo, p, state.layout);
    const map = { t: "ns-resize", b: "ns-resize", l: "ew-resize", r: "ew-resize", tl: "nwse-resize", br: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize", lt: "nwse-resize", rb: "nwse-resize", rt: "nesw-resize", lb: "nesw-resize" };
    if (hit.kind === "resize") {
      const e = hit.edges.split("").sort((a, b) => "tblr".indexOf(a) - "tblr".indexOf(b)).join("");
      cursor = map[e] || "move";
    } else cursor = hit.kind === "move" ? "move" : "alias";
  } else {
    const mode = state.holdingBefore ? "before" : state.previewMode;
    const sx = state.layout.x + state.layout.width * state.splitPos;
    const mask = activeMask(photo);
    if (mode === "split" && Math.abs(p.x - sx) < 10 && insideImage(p)) cursor = "col-resize";
    else if (mask?.type === "brush" && mask.visible !== false && insideImage(p)) cursor = "none";
    else if (mask && (mask.type === "linear" || mask.type === "radial") && mask.visible !== false) {
      const h = hitTestMask(photo, mask, p);
      cursor = h === "body" || h === "center" ? "move" : h ? "pointer" : insideImage(p) ? "crosshair" : "default";
    } else if (!state.view.fit && insideImage(p)) cursor = "grab";
  }
  vp.style.cursor = cursor;
  void event;
}

let readoutFrame = null;
function updatePixelReadout(p) {
  if (readoutFrame) return;
  readoutFrame = requestAnimationFrame(() => {
    readoutFrame = null;
    if (!state.layout || !insideImage(p) || state.tool === "crop") { updateHistogramInfo(); return; }
    const gl = renderer.gl;
    const d = state.layout.dpr;
    const px = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(Math.floor(p.x * d), Math.floor(el.editorCanvas.height - p.y * d - 1), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const pct = (v) => Math.round((v / 255) * 100);
    updateHistogramInfo(`R ${pct(px[0])}% · G ${pct(px[1])}% · B ${pct(px[2])}%`);
  });
}

function onWheel(event) {
  const photo = activePhoto();
  if (!photo || state.tool === "crop" || isViewportChrome(event.target)) return;
  event.preventDefault();
  const p = viewportPoint(event);
  const l = computeLayout(photo);
  const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0018));
  const next = l.scale * factor;
  if (next <= l.fitScale && factor < 1) { fitView(); return; }
  setZoom(next, p.x, p.y);
}

/* ---------- Cọ vùng ---------- */

function brushSettings() {
  return {
    size: Number(el.brushSizeRange.value),
    feather: Number(el.brushFeatherRange.value) / 100,
    flow: Number(el.brushFlowRange.value) / 100,
  };
}

function startBrushStroke(photo, mask, p, altKey) {
  const { width, height } = photo.maskSize;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (mask.brush) {
    const img = ctx.createImageData(width, height);
    const src = mask.brush.data;
    for (let i = 0, j = 0; i < src.length; i++, j += 4) { img.data[j] = img.data[j + 1] = img.data[j + 2] = src[i]; img.data[j + 3] = 255; }
    ctx.putImageData(img, 0, 0);
  } else {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
  }
  photo.liveBrush = { maskId: mask.id, canvas, ctx, version: 0 };
  state.gesture = { kind: "brush", snapshot: beginGesture(photo), last: null, erase: altKey || el.eraseMaskToggle.checked };
  continueBrushStroke(photo, p);
}

function continueBrushStroke(photo, p) {
  const live = photo.liveBrush;
  const g = state.gesture;
  if (!live || !g) return;
  const src = screenToSource(photo, p);
  const mx = (src.x / photo.width) * photo.maskSize.width;
  const my = (src.y / photo.height) * photo.maskSize.height;
  const { size, feather, flow } = brushSettings();
  const radius = Math.max(0.6, (size / 2) * (state.layout.out.width / state.layout.width) * (photo.maskSize.width / photo.width));
  const ctx = live.ctx;
  const color = g.erase ? "0,0,0" : "255,255,255";
  const dab = (x, y) => {
    const grad = ctx.createRadialGradient(x, y, radius * (1 - feather) * 0.98, x, y, radius);
    grad.addColorStop(0, `rgba(${color},${flow})`);
    grad.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  };
  if (g.last) {
    const dist = Math.hypot(mx - g.last.x, my - g.last.y);
    const spacing = Math.max(0.5, radius * 0.22);
    let travelled = g.carry || 0;
    while (travelled + spacing <= dist) {
      travelled += spacing;
      const t = travelled / dist;
      dab(g.last.x + (mx - g.last.x) * t, g.last.y + (my - g.last.y) * t);
    }
    g.carry = travelled - dist;
  } else {
    dab(mx, my);
    g.carry = 0;
  }
  g.last = { x: mx, y: my };
  live.version += 1;
  scheduleRender();
}

function endBrushStroke(photo, g) {
  const live = photo.liveBrush;
  if (!live) return;
  const mask = photo.settings.masks.find((m) => m.id === live.maskId);
  if (mask) {
    const { width, height } = photo.maskSize;
    const rgba = live.ctx.getImageData(0, 0, width, height).data;
    const data = new Uint8Array(width * height);
    for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = rgba[j];
    mask.brush = { width, height, data, version: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` };
  }
  photo.liveBrush = null;
  endGesture(g?.snapshot);
  scheduleRender();
}

function updateBrushCursor(p) {
  const photo = activePhoto();
  const mask = activeMask(photo);
  const show = photo && mask?.type === "brush" && mask.visible !== false && !state.tool && insideImage(p) && !state.spaceDown;
  el.brushCursor.hidden = !show;
  if (!show) return;
  const d = Number(el.brushSizeRange.value);
  el.brushCursor.style.width = `${d}px`;
  el.brushCursor.style.height = `${d}px`;
  el.brushCursor.style.left = `${p.x}px`;
  el.brushCursor.style.top = `${p.y}px`;
  const inner = d * (1 - Number(el.brushFeatherRange.value) / 100);
  el.brushCursor.style.setProperty("--inner", `${Math.max(0, inner)}px`);
}

/* ---------- Mask hình học ---------- */

function updateMaskGeometry(photo, g, src, event) {
  const mask = g.mask;
  const uv = { x: clamp(src.x / photo.width, -0.5, 1.5), y: clamp(src.y / photo.height, -0.5, 1.5) };
  const L = Math.max(photo.width, photo.height);
  if (mask.type === "linear") {
    if (g.handle === "create" || g.handle === "end") mask.linear.end = uv;
    else if (g.handle === "start") mask.linear.start = uv;
    else if (g.handle === "body") {
      const dx = uv.x - g.start.x / photo.width, dy = uv.y - g.start.y / photo.height;
      mask.linear.start = { x: g.linear.start.x + dx, y: g.linear.start.y + dy };
      mask.linear.end = { x: g.linear.end.x + dx, y: g.linear.end.y + dy };
    }
  } else {
    const r = mask.radial;
    const geo = radialGeometryPx(photo, mask);
    if (g.handle === "create") {
      let rx = Math.abs(src.x - g.start.x) / L, ry = Math.abs(src.y - g.start.y) / L;
      if (event.shiftKey) rx = ry = Math.max(rx, ry);
      r.rotation = 0;
      r.rx = Math.max(0.01, rx);
      r.ry = Math.max(0.01, ry);
    } else if (g.handle === "center" || g.handle === "body") {
      r.center = { x: g.radial.center.x + (src.x - g.start.x) / photo.width, y: g.radial.center.y + (src.y - g.start.y) / photo.height };
    } else if (g.handle === "rx" || g.handle === "ry") {
      const dx = src.x - geo.cx, dy = src.y - geo.cy;
      const along = g.handle === "rx" ? Math.abs(geo.cos * dx + geo.sin * dy) : Math.abs(-geo.sin * dx + geo.cos * dy);
      r[g.handle] = Math.max(0.005, along / L);
      if (event.shiftKey) { r.rx = r[g.handle]; r.ry = r[g.handle]; }
    } else if (g.handle === "rotate") {
      const angle = Math.atan2(src.y - geo.cy, src.x - geo.cx);
      let deg = (angle * 180) / Math.PI + 90;
      if (event.shiftKey) deg = Math.round(deg / 15) * 15;
      r.rotation = ((deg + 540) % 360) - 180;
    }
  }
  syncMaskEditor();
  scheduleRender();
}

/* ---------- Cắt & xoay ---------- */

function setTool(tool) {
  const photo = activePhoto();
  if (state.tool === tool) tool = null;
  if (state.tool === "crop" && tool !== "crop") finishCrop(true);
  state.tool = tool;
  el.eyedropperButton.setAttribute("aria-pressed", String(tool === "eyedropper"));
  el.eyedropperButton.classList.toggle("active", tool === "eyedropper");
  if (tool === "crop" && photo) {
    state.cropSession = beginGesture(photo);
    if (photo.settings.crop.iw === undefined) photo.settings.crop = { ...photo.settings.crop, iw: photo.settings.crop.w, ih: photo.settings.crop.h };
    syncCropBar();
  }
  el.cropBar.hidden = tool !== "crop";
  el.cropToolButton.setAttribute("aria-pressed", String(tool === "crop"));
  el.cropToolButton.classList.toggle("active", tool === "crop");
  if (tool === "eyedropper") setStatus("Bấm vào vùng trắng hoặc xám trung tính trên ảnh để cân bằng trắng · Esc để huỷ");
  else setStatus("Ảnh được xử lý cục bộ");
  el.brushCursor.hidden = true;
  scheduleRender();
}

function finishCrop(apply) {
  const photo = activePhoto();
  if (!photo || state.tool !== "crop") return;
  if (!apply && state.cropSession) {
    photo.settings = cloneSettings(state.cropSession.snapshot);
  } else {
    endGesture(state.cropSession);
  }
  state.cropSession = null;
  state.tool = null;
  el.cropBar.hidden = true;
  el.cropToolButton.setAttribute("aria-pressed", "false");
  el.cropToolButton.classList.remove("active");
  state.view = { fit: true, scale: 1, panX: 0, panY: 0 };
  updateDimensions();
  settingsChanged(photo);
}

function syncCropBar() {
  const photo = activePhoto();
  if (!photo) return;
  const crop = photo.settings.crop;
  el.cropAspectSelect.value = crop.aspect || "free";
  el.cropAngleRange.value = crop.angle || 0;
  el.cropAngleValue.textContent = `${(crop.angle || 0).toFixed(1)}°`;
  setRangeProgress(el.cropAngleRange);
}

function setCrop(photo, crop) {
  photo.settings.crop = crop;
  updateDimensions();
  syncCropBar();
  scheduleRender();
}

function updateCropGesture(photo, g, p, event) {
  const layout = state.layout;
  const W = photo.width, H = photo.height;
  const dx = (p.x - g.start.x) / layout.width;
  const dy = (p.y - g.start.y) / layout.height;
  const base = g.crop;
  if (g.kind === "crop-rotate") {
    const angle = Math.atan2(p.y - g.center.y, p.x - g.center.x);
    let deg = (base.angle || 0) + ((angle - g.startAngle) * 180) / Math.PI;
    deg = clamp(deg, -45, 45);
    if (event.shiftKey) deg = Math.round(deg);
    setCrop(photo, fitCropInside({ ...base, angle: deg }, W, H));
    return;
  }
  if (g.kind === "crop-move") {
    // Tìm khoảng dịch lớn nhất vẫn nằm trong ảnh
    let lo = 0, hi = 1;
    const tryAt = (t) => cropFromViewRect(base, W, H, { ...g.rect, x: g.rect.x + dx * t, y: g.rect.y + dy * t });
    if (isCropInside(tryAt(1), W, H)) lo = 1;
    else for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (isCropInside(tryAt(m), W, H)) lo = m; else hi = m; }
    const next = tryAt(lo);
    setCrop(photo, { ...next, iw: base.iw ?? base.w, ih: base.ih ?? base.h });
    return;
  }
  // Đổi kích thước
  const r = { ...g.rect };
  const view = cropRectInView(base, W, H);
  const minN = 24 / layout.width;
  let left = r.x, top = r.y, right = r.x + r.w, bottom = r.y + r.h;
  if (g.edges.includes("l")) left = Math.min(right - minN, left + dx);
  if (g.edges.includes("r")) right = Math.max(left + minN, right + dx);
  if (g.edges.includes("t")) top = Math.min(bottom - minN, top + dy);
  if (g.edges.includes("b")) bottom = Math.max(top + minN, bottom + dy);
  let aspect = aspectValue(base.aspect, W, H, base);
  if (!aspect && event.shiftKey) aspect = (r.w * view.viewWidth) / (r.h * view.viewHeight);
  if (aspect) {
    const k = view.viewWidth / view.viewHeight; // chuyển tỉ lệ pixel → tỉ lệ toạ độ chuẩn hoá
    let w = right - left, h = bottom - top;
    const horizontalOnly = !g.edges.includes("t") && !g.edges.includes("b");
    const verticalOnly = !g.edges.includes("l") && !g.edges.includes("r");
    if (horizontalOnly || (!verticalOnly && Math.abs(dx) >= Math.abs(dy))) h = (w * k) / aspect;
    else w = (h * aspect) / k;
    if (g.edges.includes("l")) left = right - w; else if (!g.edges.includes("r")) { const cx = (left + right) / 2; left = cx - w / 2; }
    right = left + w;
    if (g.edges.includes("t")) top = bottom - h; else if (!g.edges.includes("b")) { const cy = (top + bottom) / 2; top = cy - h / 2; }
    bottom = top + h;
  }
  const next = cropFromViewRect(base, W, H, { x: left, y: top, w: right - left, h: bottom - top });
  if (isCropInside(next, W, H)) setCrop(photo, next);
}

/* ---------- Chấm cân bằng trắng ---------- */

function sampleWhiteBalance(photo, p) {
  const src = screenToSource(photo, p);
  const a = photoAnalysis(photo);
  const cx = Math.round((src.x / photo.width) * (a.width - 1));
  const cy = Math.round((src.y / photo.height) * (a.height - 1));
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = cy - 2; y <= cy + 2; y++) {
    for (let x = cx - 2; x <= cx + 2; x++) {
      if (x < 0 || y < 0 || x >= a.width || y >= a.height) continue;
      const i = (y * a.width + x) * 4;
      r += srgbToLinear(a.data[i] / 255); g += srgbToLinear(a.data[i + 1] / 255); b += srgbToLinear(a.data[i + 2] / 255);
      n += 1;
    }
  }
  if (!n) return;
  const wb = neutralizeWhiteBalance([r / n, g / n, b / n]);
  record(photo);
  photo.settings.values.temperature = wb.temperature;
  photo.settings.values.tint = wb.tint;
  photo.settings.preset = null;
  setTool(null);
  settingsChanged(photo);
  showToast(`Cân bằng trắng: nhiệt độ ${wb.temperature}, sắc thái ${wb.tint}.`);
}

/* ============================================================
   Bảng điều chỉnh
   ============================================================ */

function globalBinding() {
  let gesture = null;
  return {
    key: (c) => c.id,
    get: (c) => activePhoto()?.settings.values[c.id] ?? (c.initial ?? 0),
    set: (c, v) => {
      const photo = activePhoto();
      if (!photo) return;
      photo.settings.values[c.id] = v;
      photo.settings.preset = null;
      photo.presetState = null;
      setActivePresetMark();
      scheduleRender();
    },
    begin: () => { gesture = beginGesture(); },
    commit: () => { endGesture(gesture); gesture = null; updateActionButtons(); updateFilmstripBadges(); },
  };
}

function maskBinding() {
  let gesture = null;
  return {
    key: (c) => `mask-${c.id}`,
    get: (c) => activeMask()?.values[c.id] ?? (c.initial ?? 0),
    set: (c, v) => {
      const mask = activeMask();
      if (!mask) return;
      mask.values[c.id] = v;
      scheduleRender();
    },
    begin: () => { gesture = beginGesture(); },
    commit: () => { endGesture(gesture); gesture = null; updateActionButtons(); renderMaskList(); },
  };
}

function buildPanels() {
  const binding = globalBinding();
  controlSets = [
    buildControls(el.lightControls, controlGroups.light, binding),
    buildControls(el.colorControls, controlGroups.color, binding),
    buildControls(el.effectControls, controlGroups.effects, binding),
    buildControls(el.detailControls, controlGroups.detail, binding),
    buildControls(el.hslHueControls, hslGroups.hue, binding),
    buildControls(el.hslSaturationControls, hslGroups.saturation, binding),
    buildControls(el.hslLuminanceControls, hslGroups.luminance, binding),
  ];
  maskControlSet = buildControls(el.maskControls, maskControlGroup, maskBinding());
  buildGradePanel();
  buildCurvePanel();
}

function syncAllControls() {
  if (!activePhoto()) return;
  for (const set of controlSets) set.sync();
  syncMaskEditor();
  syncGradePanel();
  syncCurvePanel();
  updatePresetAmount();
}

/* ---------- Đường cong ---------- */

function buildCurvePanel() {
  let gesture = null;
  curveEditor = new CurveEditor(el.curveCanvas, {
    onBegin: () => { gesture = beginGesture(); },
    onInput: (points) => {
      const photo = activePhoto();
      if (!photo) return;
      photo.settings.curve[state.curveChannel] = points;
      photo.settings.preset = null;
      photo.presetState = null;
      scheduleRender();
    },
    onCommit: (points) => {
      const photo = activePhoto();
      if (!photo) return;
      photo.settings.curve[state.curveChannel] = points;
      photo.settings.preset = null;
      endGesture(gesture);
      gesture = null;
      setActivePresetMark();
      syncCurvePanel();
      scheduleRender();
    },
  });
  document.querySelectorAll("[data-curve-channel]").forEach((button) => button.addEventListener("click", () => {
    state.curveChannel = button.dataset.curveChannel;
    document.querySelectorAll("[data-curve-channel]").forEach((b) => {
      b.classList.toggle("active", b === button);
      b.setAttribute("aria-selected", String(b === button));
    });
    syncCurvePanel();
  }));
  el.curveResetButton.addEventListener("click", () => {
    const photo = activePhoto();
    if (!photo) return;
    record(photo);
    photo.settings.curve = defaultCurve();
    photo.settings.preset = null;
    settingsChanged(photo);
  });
}

function syncCurvePanel() {
  const photo = activePhoto();
  if (!photo || !curveEditor) return;
  curveEditor.setPoints(photo.settings.curve[state.curveChannel], state.curveChannel);
  const changed = Object.values(photo.settings.curve).some((pts) => !isIdentityCurve(pts));
  el.curveResetButton.disabled = !changed;
  document.querySelectorAll("[data-curve-channel]").forEach((b) => {
    b.classList.toggle("modified", !isIdentityCurve(photo.settings.curve[b.dataset.curveChannel]));
  });
}

/* ---------- Phân màu ---------- */

function buildGradePanel() {
  let gesture = null;
  const begin = () => { gesture = beginGesture(); };
  const commit = () => { endGesture(gesture); gesture = null; syncGradePanel(); updateActionButtons(); };
  for (const zone of gradeZones) {
    const wrap = document.createElement("div");
    wrap.className = "grade-wheel";
    const title = document.createElement("span");
    title.className = "grade-title";
    title.textContent = zone.label;
    const canvas = document.createElement("canvas");
    canvas.className = "wheel-canvas";
    canvas.setAttribute("aria-label", `Vòng màu ${zone.label}`);
    const readout = document.createElement("span");
    readout.className = "grade-readout";
    const lum = document.createElement("input");
    lum.type = "range";
    lum.min = -100;
    lum.max = 100;
    lum.step = 1;
    lum.value = 0;
    lum.className = "grade-lum";
    lum.setAttribute("aria-label", `Độ sáng ${zone.label}`);
    lum.title = `Độ sáng ${zone.label} · nhấp đúp để đặt lại`;
    const wheel = new ColorWheel(canvas, {
      label: zone.label,
      onBegin: begin,
      onInput: ({ h, s }) => {
        const photo = activePhoto();
        if (!photo) return;
        Object.assign(photo.settings.grade[zone.id], { h, s });
        photo.settings.preset = null;
        readout.textContent = `${h}° · ${s}`;
        scheduleRender();
      },
      onCommit: ({ h, s }) => {
        const photo = activePhoto();
        if (photo) Object.assign(photo.settings.grade[zone.id], { h, s });
        commit();
        scheduleRender();
      },
    });
    let lumActive = false;
    lum.addEventListener("input", () => {
      if (!lumActive) { lumActive = true; begin(); }
      const photo = activePhoto();
      if (!photo) return;
      photo.settings.grade[zone.id].l = Number(lum.value);
      setRangeProgress(lum);
      scheduleRender();
    });
    lum.addEventListener("change", () => { if (lumActive) { lumActive = false; commit(); } });
    lum.addEventListener("dblclick", () => {
      const photo = activePhoto();
      if (!photo) return;
      begin();
      photo.settings.grade[zone.id].l = 0;
      commit();
      scheduleRender();
    });
    wrap.append(title, canvas, readout, lum);
    el.gradeWheels.appendChild(wrap);
    gradeWidgets[zone.id] = { wheel, lum, readout };
  }
  const gradeControls = [
    { id: "blending", label: "Hoà trộn", min: 0, max: 100, step: 1, initial: 50 },
    { id: "balance", label: "Cân bằng", min: -100, max: 100, step: 1, initial: 0 },
  ];
  gradeControlSet = buildControls(el.gradeControls, gradeControls, {
    key: (c) => `grade-${c.id}`,
    get: (c) => activePhoto()?.settings.grade[c.id] ?? c.initial,
    set: (c, v) => { const photo = activePhoto(); if (!photo) return; photo.settings.grade[c.id] = v; photo.settings.preset = null; scheduleRender(); },
    begin,
    commit,
  });
  el.gradeResetButton.addEventListener("click", () => {
    const photo = activePhoto();
    if (!photo) return;
    record(photo);
    photo.settings.grade = defaultGrade();
    settingsChanged(photo);
  });
}

function syncGradePanel() {
  const photo = activePhoto();
  if (!photo) return;
  const grade = photo.settings.grade;
  let changed = grade.blending !== 50 || grade.balance !== 0;
  for (const zone of gradeZones) {
    const z = grade[zone.id];
    const w = gradeWidgets[zone.id];
    w.wheel.set(z);
    w.lum.value = z.l;
    setRangeProgress(w.lum);
    w.readout.textContent = `${Math.round(z.h)}° · ${Math.round(z.s)}${z.l ? ` · ${z.l > 0 ? "+" : ""}${z.l}` : ""}`;
    if (z.s || z.l) changed = true;
  }
  gradeControlSet.sync();
  el.gradeResetButton.disabled = !changed;
}

/* ---------- Vùng chọn ---------- */

const maskName = (photo, mask) => {
  const sameType = photo.settings.masks.filter((m) => m.type === mask.type);
  return `${maskTypes[mask.type].label} ${sameType.indexOf(mask) + 1}`;
};

function addMask(type) {
  const photo = activePhoto();
  if (!photo) return;
  if (photo.settings.masks.length >= MAX_MASKS) { showToast(`Tối đa ${MAX_MASKS} vùng chọn cho mỗi ảnh.`); return; }
  record(photo);
  const mask = createMask(type);
  // Đặt hình mặc định quanh tâm khung đang xem
  const center = outputToSource(photo.settings.crop, 0.5, 0.5);
  const cu = { x: center.x / photo.width, y: center.y / photo.height };
  if (type === "radial") mask.radial.center = cu;
  if (type === "linear") {
    const top = outputToSource(photo.settings.crop, 0.5, 0.1);
    const mid = outputToSource(photo.settings.crop, 0.5, 0.55);
    mask.linear = { start: { x: top.x / photo.width, y: top.y / photo.height }, end: { x: mid.x / photo.width, y: mid.y / photo.height } };
  }
  photo.settings.masks.push(mask);
  photo.activeMaskId = mask.id;
  state.showMaskOverlay = type === "brush" || type === "sky";
  settingsChanged(photo);
  el.showMaskToggle.checked = state.showMaskOverlay;
}

function deleteMask(id) {
  const photo = activePhoto();
  if (!photo) return;
  record(photo);
  photo.settings.masks = photo.settings.masks.filter((m) => m.id !== id);
  ensureActiveMask(photo);
  settingsChanged(photo);
  showToast("Đã xoá vùng chọn.", { label: "Hoàn tác", run: undo });
}

function duplicateMask(id) {
  const photo = activePhoto();
  const mask = photo?.settings.masks.find((m) => m.id === id);
  if (!mask) return;
  if (photo.settings.masks.length >= MAX_MASKS) { showToast(`Tối đa ${MAX_MASKS} vùng chọn cho mỗi ảnh.`); return; }
  record(photo);
  const copy = { ...JSON.parse(JSON.stringify({ ...mask, brush: null })), id: createMask(mask.type).id, brush: mask.brush };
  photo.settings.masks.splice(photo.settings.masks.indexOf(mask) + 1, 0, copy);
  photo.activeMaskId = copy.id;
  settingsChanged(photo);
}

function renderMaskUI() {
  renderMaskList();
  syncMaskEditor();
}

function renderMaskList() {
  const photo = activePhoto();
  const list = el.maskList;
  list.replaceChildren();
  if (!photo) return;
  for (const mask of photo.settings.masks) {
    const li = document.createElement("li");
    li.className = `mask-item${mask.id === photo.activeMaskId ? " active" : ""}${mask.visible === false ? " muted" : ""}`;
    const select = document.createElement("button");
    select.type = "button";
    select.className = "mask-select";
    select.setAttribute("aria-pressed", String(mask.id === photo.activeMaskId));
    select.innerHTML = `<span class="mask-dot mask-dot-${mask.type}" aria-hidden="true"></span><span class="mask-name"></span>${mask.invert ? '<span class="mask-flag">đảo</span>' : ""}`;
    select.querySelector(".mask-name").textContent = maskName(photo, mask);
    select.addEventListener("click", () => {
      photo.activeMaskId = photo.activeMaskId === mask.id ? null : mask.id;
      renderMaskUI();
      scheduleRender();
    });
    const vis = document.createElement("button");
    vis.type = "button";
    vis.className = "mask-icon";
    vis.textContent = mask.visible === false ? "○" : "●";
    vis.title = mask.visible === false ? "Bật vùng chọn" : "Tạm tắt vùng chọn";
    vis.setAttribute("aria-label", `${vis.title}: ${maskName(photo, mask)}`);
    vis.addEventListener("click", () => {
      record(photo);
      mask.visible = mask.visible === false;
      settingsChanged(photo);
    });
    const dup = document.createElement("button");
    dup.type = "button";
    dup.className = "mask-icon";
    dup.textContent = "⧉";
    dup.title = "Nhân bản";
    dup.setAttribute("aria-label", `Nhân bản ${maskName(photo, mask)}`);
    dup.addEventListener("click", () => duplicateMask(mask.id));
    const del = document.createElement("button");
    del.type = "button";
    del.className = "mask-icon danger";
    del.textContent = "×";
    del.title = "Xoá vùng chọn";
    del.setAttribute("aria-label", `Xoá ${maskName(photo, mask)}`);
    del.addEventListener("click", () => deleteMask(mask.id));
    li.append(select, vis, dup, del);
    list.appendChild(li);
  }
  document.querySelectorAll("[data-add-mask]").forEach((b) => { b.disabled = photo.settings.masks.length >= MAX_MASKS; });
}

function syncMaskEditor() {
  const photo = activePhoto();
  const mask = activeMask(photo);
  el.maskEditor.hidden = !mask;
  const help = {
    sky: "Vùng trời được nhận diện tự động theo màu và vị trí. Chỉ chỉnh màu – không thay hay ghép trời.",
    brush: "Tô trực tiếp trên ảnh. Giữ Alt để tẩy, phím [ ] để đổi cỡ cọ.",
    linear: "Kéo trên ảnh để vẽ gradient mới; kéo tay nắm để chỉnh, kéo đường giữa để di chuyển.",
    radial: "Kéo trên ảnh để vẽ oval mới (giữ Shift để tròn đều); kéo tâm để di chuyển, tay nắm để đổi cỡ hoặc xoay.",
  };
  el.maskHelp.textContent = mask ? help[mask.type] : (photo?.settings.masks.length ? "Chọn một vùng trong danh sách để chỉnh." : `Thêm vùng chọn để chỉnh sáng, màu và chi tiết cục bộ. Tối đa ${MAX_MASKS} vùng.`);
  if (!mask) return;
  el.showMaskToggle.checked = state.showMaskOverlay;
  el.invertMaskToggle.checked = !!mask.invert;
  el.clearMaskButton.hidden = mask.type !== "brush";
  el.brushOptions.hidden = mask.type !== "brush";
  el.radialOptions.hidden = mask.type !== "radial";
  if (mask.type === "radial") {
    el.maskFeatherRange.value = mask.feather ?? 50;
    el.maskFeatherValue.textContent = mask.feather ?? 50;
    el.maskRotationRange.value = Math.round(mask.radial.rotation || 0);
    el.maskRotationValue.textContent = `${Math.round(mask.radial.rotation || 0)}°`;
    setRangeProgress(el.maskFeatherRange);
    setRangeProgress(el.maskRotationRange);
  }
  maskControlSet?.sync();
}

/* ============================================================
   Preset
   ============================================================ */

function loadUserPresets() {
  return safeLocalStorage(() => {
    const stored = JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) || "null");
    if (Array.isArray(stored)) return stored.map(migrateStoredPreset);
    const legacy = JSON.parse(localStorage.getItem(LEGACY_PRESET_KEY) || "[]");
    return Array.isArray(legacy) ? legacy.map(migrateStoredPreset) : [];
  }, []);
}

function saveUserPresets() {
  const ok = safeLocalStorage(() => { localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(userPresets)); return true; }, false);
  if (!ok) showToast("Không thể lưu preset vào bộ nhớ trình duyệt.");
}

const allPresets = () => [...builtInPresets, ...userPresets];
const presetById = (id) => allPresets().find((p) => p.id === id) || null;

/** Áp preset lên thiết lập nền với cường độ amount (0..1.5). */
function applyPresetSettings(base, preset, amount = 1) {
  const out = cloneSettings(base);
  const complete = preset.source === "builtin" || preset.complete;
  const ps = preset.settings || {};
  const targetValues = complete ? { ...valueDefaults, ...(ps.values || {}) } : { ...base.values, ...(ps.values || {}) };
  for (const [key, target] of Object.entries(targetValues)) {
    const c = controlById[key];
    if (!c) continue;
    const from = base.values[key] ?? 0;
    const v = from + (target - from) * amount;
    out.values[key] = clamp(Math.round(v / c.step) * c.step, c.min, c.max);
    if (c.step < 1) out.values[key] = Number(out.values[key].toFixed(2));
  }
  const targetCurve = complete ? { ...defaultCurve(), ...(ps.curve || {}) } : { ...base.curve, ...(ps.curve || {}) };
  for (const ch of ["master", "r", "g", "b"]) {
    if (JSON.stringify(targetCurve[ch]) !== JSON.stringify(base.curve[ch])) out.curve[ch] = blendCurvePoints(base.curve[ch], targetCurve[ch], Math.min(1, amount));
  }
  const baseGrade = base.grade;
  const targetGrade = complete ? cloneGrade(ps.grade) : cloneGrade({ ...baseGrade, ...(ps.grade || {}) });
  for (const zone of ["shadows", "midtones", "highlights", "global"]) {
    const a = baseGrade[zone], b = targetGrade[zone];
    out.grade[zone] = {
      h: b.s > 0 ? b.h : a.h,
      s: clamp(Math.round(a.s + (b.s - a.s) * amount), 0, 100),
      l: clamp(Math.round(a.l + (b.l - a.l) * amount), -100, 100),
    };
  }
  out.grade.blending = clamp(Math.round(baseGrade.blending + (targetGrade.blending - baseGrade.blending) * amount), 0, 100);
  out.grade.balance = clamp(Math.round(baseGrade.balance + (targetGrade.balance - baseGrade.balance) * amount), -100, 100);
  out.preset = preset.id;
  return out;
}

function applyPreset(id) {
  const photo = activePhoto();
  const preset = presetById(id);
  if (!photo || !preset) return;
  const base = photo.presetState && settingsEqual(photo.settings, photo.presetState.result) ? photo.presetState.base : cloneSettings(photo.settings);
  record(photo);
  const amount = 1;
  photo.settings = applyPresetSettings(base, preset, amount);
  photo.presetState = { presetId: id, base, amount, result: cloneSettings(photo.settings) };
  settingsChanged(photo);
  renderPresetList();
}

function setActivePresetMark() {
  const photo = activePhoto();
  document.querySelectorAll(".preset-list-item").forEach((item) => {
    const active = item.dataset.preset === photo?.settings.preset;
    item.classList.toggle("active", active);
    item.querySelector(".preset-apply")?.setAttribute("aria-current", active ? "true" : "false");
    const mark = item.querySelector(".preset-current-mark");
    if (mark) mark.textContent = active ? "✓" : "";
  });
  updatePresetAmount();
}

function updatePresetAmount() {
  const photo = activePhoto();
  const ps = photo?.presetState;
  const enabled = !!(ps && photo.settings.preset === ps.presetId);
  el.presetAmountRange.disabled = !enabled;
  const amount = enabled ? Math.round(ps.amount * 100) : 100;
  el.presetAmountRange.value = amount;
  el.presetAmountValue.textContent = `${amount}%`;
  setRangeProgress(el.presetAmountRange);
}

function renderPresetList() {
  const list = el.presetList;
  list.replaceChildren();
  const photo = activePhoto();
  const groups = [
    ["LUMA", builtInPresets],
    ["CỦA BẠN", userPresets.filter((p) => p.source === "user")],
    ["ĐÃ NHẬP", userPresets.filter((p) => p.source !== "user")],
  ];
  for (const [title, presets] of groups) {
    if (!presets.length) continue;
    const heading = document.createElement("div");
    heading.className = "preset-group-title";
    heading.textContent = title;
    list.appendChild(heading);
    for (const preset of presets) {
      const item = document.createElement("div");
      item.className = `preset-list-item${photo?.settings.preset === preset.id ? " active" : ""}`;
      item.dataset.preset = preset.id;
      const apply = document.createElement("button");
      apply.type = "button";
      apply.className = "preset-apply";
      apply.innerHTML = '<span class="preset-list-name"></span><span class="preset-current-mark" aria-hidden="true"></span>';
      apply.querySelector(".preset-list-name").textContent = preset.name;
      apply.querySelector(".preset-current-mark").textContent = photo?.settings.preset === preset.id ? "✓" : "";
      apply.addEventListener("mouseenter", () => showPresetPreview(preset));
      apply.addEventListener("focus", () => showPresetPreview(preset));
      apply.addEventListener("mouseleave", () => showPresetPreview(null));
      apply.addEventListener("blur", () => showPresetPreview(null));
      apply.addEventListener("click", () => applyPreset(preset.id));
      const actions = document.createElement("div");
      actions.className = "preset-actions";
      const action = (label, text, fn, cls = "") => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `preset-action ${cls}`;
        b.textContent = text;
        b.title = label;
        b.setAttribute("aria-label", `${label}: ${preset.name}`);
        b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
        actions.appendChild(b);
      };
      action("Xuất JSON (LUMA)", "JSON", () => downloadBlob(new Blob([presetToLumaJson(preset)], { type: "application/json" }), `${slug(preset.name)}.json`));
      action("Xuất XMP (Lightroom)", "XMP", () => downloadBlob(new Blob([presetToXmp(preset, uuidHex())], { type: "application/rdf+xml" }), `${slug(preset.name)}.xmp`));
      if (preset.source !== "builtin") {
        action("Đổi tên", "✎", () => renamePreset(preset.id));
        action("Xoá preset", "×", () => deletePreset(preset.id), "danger");
      }
      item.append(apply, actions);
      list.appendChild(item);
    }
  }
  showPresetPreview(null);
  updatePresetAmount();
}

const slug = (name) => name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "preset";
const uuidHex = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").toUpperCase() : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("").toUpperCase());

function showPresetPreview(preset) {
  const photo = activePhoto();
  el.presetPreviewEmpty.hidden = !!photo;
  el.presetPreviewCanvas.hidden = !photo;
  const shown = preset || presetById(photo?.settings.preset);
  el.presetPreviewName.textContent = preset ? preset.name : (shown ? shown.name : "THIẾT LẬP HIỆN TẠI");
  if (!photo || !state.drawerOpen) return;
  const base = photo.presetState && settingsEqual(photo.settings, photo.presetState.result) ? photo.presetState.base : photo.settings;
  const settings = preset ? applyPresetSettings(base, preset, 1) : photo.settings;
  renderer.setPhoto(photo);
  renderer.syncMasks(settings.masks, null);
  const canvas = el.presetPreviewCanvas;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const thumb = renderer.renderThumbnail(settings, settings.crop, Math.max(canvas.width, canvas.height) * 1.2);
  const tmp = document.createElement("canvas");
  tmp.width = thumb.width;
  tmp.height = thumb.height;
  tmp.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(thumb.pixels.buffer), thumb.width, thumb.height), 0, 0);
  const ctx = canvas.getContext("2d");
  const s = Math.max(canvas.width / thumb.width, canvas.height / thumb.height);
  const w = thumb.width * s, h = thumb.height * s;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(tmp, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  scheduleRender();
}

function askName(title, initial = "") {
  return new Promise((resolve) => {
    el.nameDialogTitle.textContent = title;
    el.nameInput.value = initial;
    const onClose = () => {
      el.nameDialog.removeEventListener("close", onClose);
      resolve(el.nameDialog.returnValue === "default" ? el.nameInput.value.trim() : null);
    };
    el.nameDialog.addEventListener("close", onClose);
    el.nameDialog.returnValue = "";
    el.nameDialog.showModal();
    el.nameInput.select();
  });
}

async function saveCurrentAsPreset() {
  const photo = activePhoto();
  if (!photo) return;
  const name = await askName("Lưu preset", photo.settings.preset ? `${presetById(photo.settings.preset)?.name || ""} (SỬA)` : "PRESET CỦA TÔI");
  if (!name) return;
  const preset = {
    id: `user-${Date.now().toString(36)}`,
    name: name.toUpperCase(),
    source: "user",
    complete: true,
    settings: { values: { ...photo.settings.values }, curve: cloneCurve(photo.settings.curve), grade: cloneGrade(photo.settings.grade) },
  };
  userPresets.push(preset);
  saveUserPresets();
  photo.settings.preset = preset.id;
  photo.presetState = null;
  renderPresetList();
  showToast(`Đã lưu preset “${preset.name}”.`);
}

async function renamePreset(id) {
  const preset = userPresets.find((p) => p.id === id);
  if (!preset) return;
  const name = await askName("Đổi tên preset", preset.name);
  if (!name) return;
  preset.name = name.toUpperCase();
  saveUserPresets();
  renderPresetList();
}

function deletePreset(id) {
  const index = userPresets.findIndex((p) => p.id === id);
  if (index < 0) return;
  const [removed] = userPresets.splice(index, 1);
  saveUserPresets();
  renderPresetList();
  showToast(`Đã xoá preset “${removed.name}”.`, {
    label: "Hoàn tác",
    run: () => { userPresets.splice(index, 0, removed); saveUserPresets(); renderPresetList(); },
  });
}

async function importPresetFiles(files) {
  let imported = 0;
  const errors = [];
  for (const file of [...files]) {
    try {
      const parsed = parseLightroomPreset(await file.text(), file.name);
      userPresets.push({ id: `imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name: parsed.name, source: "imported", settings: parsed.settings });
      imported += 1;
    } catch (error) {
      errors.push(error.message || `${file.name}: không thể nhập.`);
    }
  }
  if (imported) { saveUserPresets(); renderPresetList(); }
  if (errors.length && imported) showToast(`Đã nhập ${imported} preset · ${errors.length} file lỗi: ${errors[0]}`);
  else if (errors.length) showToast(errors[0]);
  else showToast(`Đã nhập ${imported} preset Lightroom.`);
  el.presetFileInput.value = "";
}

function setPresetDrawer(open) {
  state.drawerOpen = open;
  el.presetDrawer.classList.toggle("open", open);
  el.presetDrawer.inert = !open;
  el.presetDrawerHandle.classList.toggle("open", open);
  el.presetDrawerHandle.setAttribute("aria-expanded", String(open));
  const label = open ? "Đóng bảng preset" : "Mở bảng preset";
  el.presetDrawerHandle.setAttribute("aria-label", label);
  el.presetDrawerHandle.title = label;
  el.drawerBackdrop.hidden = !open;
  if (open) {
    renderPresetList();
    requestAnimationFrame(() => showPresetPreview(null));
    el.presetList.querySelector(".preset-apply")?.focus({ preventScroll: true });
  } else if (el.presetDrawer.contains(document.activeElement)) {
    el.presetDrawerHandle.focus();
  }
}

/* ============================================================
   Sao chép / dán / đồng bộ thiết lập
   ============================================================ */

function openSettingsDialog(mode) {
  const photo = activePhoto();
  if (!photo) return;
  const targets = state.photos.filter((p) => p.selected && p.id !== photo.id);
  if (mode === "sync" && !targets.length) { showToast("Hãy chọn thêm ảnh trong filmstrip (ô ✓) để đồng bộ."); return; }
  el.settingsDialogTitle.textContent = mode === "copy" ? "Sao chép thiết lập" : "Đồng bộ thiết lập";
  el.settingsDialogEyebrow.textContent = mode === "copy" ? "SAO CHÉP" : "ĐỒNG BỘ";
  el.settingsDialogText.textContent = mode === "copy"
    ? `Chọn nhóm thiết lập cần sao chép từ “${photo.name}”. Sau đó dùng Dán (Ctrl+Shift+V) trên ảnh khác.`
    : `Áp thiết lập của “${photo.name}” sang ${targets.length} ảnh đã chọn khác.`;
  el.settingsConfirmButton.textContent = mode === "copy" ? "Sao chép" : `Đồng bộ ${targets.length} ảnh`;
  el.settingsGroupList.replaceChildren();
  for (const group of settingGroups) {
    const label = document.createElement("label");
    label.className = "toggle-label";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = group.id;
    input.checked = state.syncGroups.includes(group.id);
    label.append(input, ` ${group.label}`);
    el.settingsGroupList.appendChild(label);
  }
  updateGroupToggle();
  el.settingsDialog.dataset.mode = mode;
  el.settingsDialog.returnValue = "";
  el.settingsDialog.showModal();
}

function updateGroupToggle() {
  const boxes = [...el.settingsGroupList.querySelectorAll("input")];
  el.toggleAllGroupsButton.textContent = boxes.every((b) => b.checked) ? "Bỏ chọn tất cả" : "Chọn tất cả";
  el.settingsConfirmButton.disabled = !boxes.some((b) => b.checked);
}

function confirmSettingsDialog() {
  const photo = activePhoto();
  const groups = [...el.settingsGroupList.querySelectorAll("input:checked")].map((b) => b.value);
  state.syncGroups = groups;
  if (!photo || !groups.length) return;
  if (el.settingsDialog.dataset.mode === "copy") {
    state.clipboard = { settings: cloneSettings(photo.settings), size: { width: photo.width, height: photo.height }, groups };
    updateActionButtons();
    showToast(`Đã sao chép ${groups.length} nhóm thiết lập.`);
  } else {
    const targets = state.photos.filter((p) => p.selected && p.id !== photo.id);
    for (const target of targets) applySettingsTo(target, photo.settings, { width: photo.width, height: photo.height }, groups);
    showToast(`Đã đồng bộ sang ${targets.length} ảnh.`);
    updateFilmstripBadges();
  }
}

function applySettingsTo(target, sourceSettings, sourceSize, groups) {
  pushHistory(target, cloneSettings(target.settings));
  const merged = mergeSettingGroups(target.settings, { ...sourceSettings, __size: sourceSize }, groups, { width: target.width, height: target.height });
  merged.crop = fitCropInside(merged.crop, target.width, target.height);
  target.settings = merged;
  target.presetState = null;
  ensureActiveMask(target);
  settingsChanged(target);
}

function pasteSettings() {
  const photo = activePhoto();
  if (!photo || !state.clipboard) return;
  applySettingsTo(photo, state.clipboard.settings, state.clipboard.size, state.clipboard.groups);
  showToast("Đã dán thiết lập.", { label: "Hoàn tác", run: undo });
}

function copyPreviousSettings() {
  const photo = activePhoto();
  const index = state.photos.indexOf(photo);
  if (!photo || index <= 0) return;
  const previous = state.photos[index - 1];
  applySettingsTo(photo, previous.settings, { width: previous.width, height: previous.height }, settingGroups.map((g) => g.id));
  showToast(`Đã sao chép thiết lập từ ${previous.name}.`, { label: "Hoàn tác", run: undo });
}

/* ============================================================
   Filmstrip
   ============================================================ */

function isEdited(photo) {
  return !settingsEqual({ ...photo.settings, preset: null }, { ...defaultSettings(photo.width, photo.height), preset: null });
}

function renderFilmstrip() {
  const list = el.filmstripList;
  list.replaceChildren();
  state.photos.forEach((photo, index) => {
    const card = document.createElement("div");
    card.className = `thumb-card${photo.id === state.activeId ? " active" : ""}${photo.selected ? " selected" : ""}`;
    card.dataset.id = photo.id;
    card.setAttribute("role", "listitem");
    const open = document.createElement("button");
    open.type = "button";
    open.className = "thumb-open";
    open.title = photo.name;
    open.setAttribute("aria-label", `Mở ảnh ${index + 1}: ${photo.name}`);
    if (photo.id === state.activeId) open.setAttribute("aria-current", "true");
    const img = document.createElement("img");
    img.src = photo.url;
    img.alt = "";
    img.loading = "lazy";
    const number = document.createElement("span");
    number.className = "thumb-index";
    number.textContent = index + 1;
    const edited = document.createElement("span");
    edited.className = "thumb-edited";
    edited.title = "Đã chỉnh sửa";
    edited.hidden = !isEdited(photo);
    open.append(img, number, edited);
    open.addEventListener("click", () => activatePhoto(photo.id));
    const select = document.createElement("button");
    select.type = "button";
    select.className = "thumb-select";
    select.textContent = photo.selected ? "✓" : "";
    select.setAttribute("aria-pressed", String(photo.selected));
    select.setAttribute("aria-label", `Chọn ${photo.name} để xuất / đồng bộ`);
    select.title = photo.selected ? "Bỏ chọn" : "Chọn để xuất / đồng bộ";
    select.addEventListener("click", () => { photo.selected = !photo.selected; renderFilmstrip(); updateExportCount(); markDirty(photo); });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "thumb-remove";
    remove.textContent = "×";
    remove.title = "Bỏ ảnh khỏi phiên làm việc";
    remove.setAttribute("aria-label", `Bỏ ${photo.name} khỏi phiên làm việc`);
    remove.addEventListener("click", () => removePhoto(photo.id));
    card.append(open, select, remove);
    list.appendChild(card);
  });
  const selected = state.photos.filter((p) => p.selected).length;
  el.photoCount.textContent = `${state.photos.length} ảnh`;
  el.selectedCount.textContent = `${selected} được chọn`;
  el.selectAllButton.textContent = selected === state.photos.length && selected > 0 ? "Bỏ chọn tất cả" : "Chọn tất cả";
  el.filmstripSection.hidden = state.photos.length === 0;
  updateActionButtons();
}

function updateFilmstripBadges() {
  for (const photo of state.photos) {
    const badge = document.querySelector(`.thumb-card[data-id="${photo.id}"] .thumb-edited`);
    if (badge) badge.hidden = !isEdited(photo);
  }
}

function removePhoto(id) {
  const index = state.photos.findIndex((p) => p.id === id);
  if (index < 0) return;
  const [photo] = state.photos.splice(index, 1);
  const wasActive = state.activeId === id;
  let finalized = false;
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    URL.revokeObjectURL(photo.url);
    photo.bitmap.close?.();
    storage.deletePhotos([photo.id]).catch(() => {});
  };
  if (wasActive) {
    const next = state.photos[Math.min(index, state.photos.length - 1)];
    if (next) activatePhoto(next.id);
    else showEmptyState();
  }
  renderFilmstrip();
  scheduleAutosave();
  const timer = setTimeout(finalize, 7000);
  showToast(`Đã bỏ ${photo.name} khỏi phiên.`, {
    label: "Hoàn tác",
    run: () => {
      if (finalized) return;
      clearTimeout(timer);
      state.photos.splice(index, 0, photo);
      renderFilmstrip();
      activatePhoto(photo.id);
      markDirty(photo);
    },
  }, 6500);
}

function showEmptyState() {
  state.activeId = null;
  el.emptyState.hidden = false;
  el.editorCanvas.hidden = true;
  el.imageFrame.hidden = true;
  el.fileName.textContent = "Chưa có ảnh";
  el.fileDimensions.textContent = "—";
  for (const id of ["resetButton", "exportButton", "zoomOutButton", "zoomInButton", "fitButton", "actualSizeButton", "cropToolButton", "clippingButton", "autoToneButton", "eyedropperButton", "autoWhiteBalanceButton", "copySettingsButton", "savePresetButton"]) el[id].disabled = true;
  el.zoomValue.textContent = "—";
  drawHistogram(el.histogramCanvas, null);
  updateHistogramInfo();
  renderMaskList();
  el.maskEditor.hidden = true;
  updateActionButtons();
}

function navigatePhoto(direction) {
  const index = state.photos.findIndex((p) => p.id === state.activeId);
  const next = state.photos[index + direction];
  if (next) activatePhoto(next.id);
}

function updateActionButtons() {
  const photo = activePhoto();
  const index = state.photos.indexOf(photo);
  el.undoButton.disabled = !photo || !photo.history.length;
  el.redoButton.disabled = !photo || !photo.future.length;
  el.previousSettingsButton.disabled = !photo || index <= 0;
  el.pasteSettingsButton.disabled = !photo || !state.clipboard;
  el.syncSettingsButton.disabled = !photo || !state.photos.some((p) => p.selected && p.id !== photo.id);
}

/* ============================================================
   Đặt lại, tự động
   ============================================================ */

function resetPhoto() {
  const photo = activePhoto();
  if (!photo) return;
  if (state.tool === "crop") finishCrop(false);
  record(photo);
  photo.settings = defaultSettings(photo.width, photo.height);
  photo.presetState = null;
  photo.activeMaskId = null;
  updateDimensions();
  settingsChanged(photo);
  showToast("Đã đặt lại ảnh đang xem.", { label: "Hoàn tác", run: undo });
}

function runAutoTone() {
  const photo = activePhoto();
  if (!photo) return;
  const result = autoTone(photoAnalysis(photo).stats);
  record(photo);
  Object.assign(photo.settings.values, result);
  photo.settings.preset = null;
  settingsChanged(photo);
  showToast("Đã tự động căn tông sáng.", { label: "Hoàn tác", run: undo });
}

function runAutoWhiteBalance() {
  const photo = activePhoto();
  if (!photo) return;
  const wb = autoWhiteBalance(photoAnalysis(photo).stats);
  record(photo);
  Object.assign(photo.settings.values, wb);
  photo.settings.preset = null;
  settingsChanged(photo);
  showToast(`Tự động cân bằng trắng: nhiệt độ ${wb.temperature}, sắc thái ${wb.tint}.`, { label: "Hoàn tác", run: undo });
}

/* ============================================================
   Xuất ảnh
   ============================================================ */

function exportTargets() {
  if (el.exportScopeSelect.value === "active") return activePhoto() ? [activePhoto()] : [];
  return state.photos.filter((p) => p.selected);
}

function updateExportCount() {
  const targets = exportTargets();
  el.exportCount.textContent = `${targets.length} ảnh`;
  el.confirmExportButton.disabled = targets.length === 0 || !!state.exporting;
  const multiple = targets.length > 1;
  const current = el.deliverySelect.value;
  el.deliverySelect.replaceChildren();
  const options = [];
  if ("showDirectoryPicker" in window) options.push(["folder", "Chọn thư mục lưu"]);
  if (multiple) options.push(["zip", "Gói thành một file ZIP"]);
  options.push(["download", multiple ? "Tải từng file về thư mục Tải xuống" : "Tải về thư mục Tải xuống"]);
  for (const [value, label] of options) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    el.deliverySelect.appendChild(o);
  }
  el.deliverySelect.value = options.some(([v]) => v === current) ? current : (multiple ? (options[0][0]) : "download");
  el.metadataField.hidden = el.formatSelect.value !== "image/jpeg";
  el.keepGpsToggle.disabled = !el.keepExifToggle.checked;
}

function openExportDialog() {
  if (!activePhoto()) return;
  if (state.tool === "crop") finishCrop(true);
  updateExportCount();
  el.exportProgress.hidden = true;
  el.exportDialog.showModal();
}

const extensionForType = (type) => (type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg");

function uniqueName(base, ext, used) {
  let name = `${base}.${ext}`;
  let n = 2;
  while (used.has(name.toLowerCase())) name = `${base}-${n++}.${ext}`;
  used.add(name.toLowerCase());
  return name;
}

async function fileExists(dir, name) {
  try { await dir.getFileHandle(name, { create: false }); return true; } catch { return false; }
}

function exportDimensions(photo) {
  const out = outputSize(photo.settings.crop);
  let width = Math.round(out.width), height = Math.round(out.height);
  if (el.resizeSelect.value === "long") {
    const target = clamp(Number(el.longEdgeInput.value) || 2048, 64, 30000);
    const s = Math.min(1, target / Math.max(width, height));
    width = Math.max(1, Math.round(width * s));
    height = Math.max(1, Math.round(height * s));
  }
  return { width, height };
}

async function renderPhotoToBlob(photo, type, quality, shouldCancel, onProgress) {
  const { width, height } = exportDimensions(photo);
  if (width * height > 250_000_000 || width > 32000 || height > 32000) {
    throw new Error(`${photo.name}: ${width}×${height} vượt giới hạn canvas của trình duyệt. Hãy giảm kích thước xuất.`);
  }
  renderer.setPhoto(photo);
  renderer.syncMasks(photo.settings.masks, null);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(`${photo.name}: không đủ bộ nhớ để tạo ảnh ${width}×${height}.`);
  let done = 0;
  const tile = renderer.maxTileSize();
  const totalTiles = Math.ceil(width / tile) * Math.ceil(height / tile);
  await renderer.renderTiled(photo.settings, {
    crop: photo.settings.crop,
    width,
    height,
    shouldCancel,
    onTile: ({ x, y, width: w, height: h, pixels }) => {
      ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), w, h), x, y);
      done += 1;
      onProgress?.(done / totalTiles);
    },
  });
  let blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`${photo.name}: không thể mã hoá file xuất.`))), type, quality));
  canvas.width = canvas.height = 1;
  if (type === "image/jpeg" && el.keepExifToggle.checked) {
    try {
      const original = new Uint8Array(await photo.file.slice(0, 256 * 1024).arrayBuffer());
      const segment = findExifSegment(original);
      const clean = segment && sanitizeExifSegment(segment, { width, height, keepGps: el.keepGpsToggle.checked });
      if (clean) blob = new Blob([injectExif(new Uint8Array(await blob.arrayBuffer()), clean)], { type });
    } catch {
      // EXIF không bắt buộc – bỏ qua nếu lỗi
    }
  }
  return { blob, width, height };
}

async function exportImages() {
  const targets = exportTargets();
  if (!targets.length || state.exporting) return;
  const delivery = el.deliverySelect.value;
  let directory = null;
  if (delivery === "folder") {
    try {
      directory = await window.showDirectoryPicker({ mode: "readwrite", startIn: "pictures" });
    } catch (error) {
      if (error.name === "AbortError") return;
      showToast("Không mở được thư mục, sẽ tải file về thư mục Tải xuống.");
    }
  }
  const type = el.formatSelect.value;
  const quality = Number(el.qualityRange.value) / 100;
  const ext = extensionForType(type);
  const used = new Set();
  const zipFiles = [];
  state.exporting = { cancelled: false };
  const shouldCancel = () => state.exporting?.cancelled;
  el.exportProgress.hidden = false;
  el.confirmExportButton.disabled = true;
  el.cancelExportButton.textContent = "Dừng";
  const progress = (i, fraction, text) => {
    el.exportProgressBar.style.width = `${((i + fraction) / targets.length) * 100}%`;
    el.exportProgressText.textContent = text;
  };
  let completed = 0;
  const errors = [];
  try {
    for (const [i, photo] of targets.entries()) {
      if (shouldCancel()) break;
      progress(i, 0, `Đang xử lý ${i + 1}/${targets.length}: ${photo.name}`);
      setStatus(`Đang xuất ${i + 1}/${targets.length}…`);
      try {
        const { blob } = await renderPhotoToBlob(photo, type, quality, shouldCancel, (f) => progress(i, f * 0.9, `Đang xử lý ${i + 1}/${targets.length}: ${photo.name}`));
        const base = `${photo.name.replace(/\.[^.]+$/, "")}-luma`;
        let name = uniqueName(base, ext, used);
        if (directory) {
          while (await fileExists(directory, name)) name = uniqueName(base, ext, used);
          const handle = await directory.getFileHandle(name, { create: true });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
        } else if (delivery === "zip") {
          zipFiles.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
        } else {
          downloadBlob(blob, name);
          await new Promise((r) => setTimeout(r, 350));
        }
        completed += 1;
      } catch (error) {
        if (error.name === "AbortError") break;
        errors.push(error.message || `${photo.name}: xuất thất bại.`);
      }
      progress(i, 1, `Đã xong ${completed}/${targets.length}`);
    }
    if (zipFiles.length && !shouldCancel()) {
      progress(targets.length - 1, 1, "Đang đóng gói ZIP…");
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      downloadBlob(new Blob(createZipParts(zipFiles), { type: "application/zip" }), `luma-${stamp}.zip`);
    }
  } finally {
    const cancelled = shouldCancel();
    state.exporting = null;
    el.cancelExportButton.textContent = "Huỷ";
    el.confirmExportButton.disabled = false;
    setStatus("Ảnh được xử lý cục bộ");
    const photo = activePhoto();
    if (photo) { renderer.photoId = null; renderer.setPhoto(photo); }
    scheduleRender();
    if (cancelled) showToast(`Đã dừng xuất (${completed} ảnh đã xong).`);
    else if (errors.length) showToast(`Đã xuất ${completed} ảnh · ${errors.length} lỗi: ${errors[0]}`, null, 7000);
    else showToast(`Đã xuất ${completed} ảnh thành công.`);
    if (!cancelled && !errors.length) el.exportDialog.close();
  }
}

/* ============================================================
   Tự lưu phiên
   ============================================================ */

function markDirty(photo) {
  dirtyPhotos.add(photo.id);
  scheduleAutosave();
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(flushAutosave, 900);
}

async function flushAutosave() {
  const records = [...dirtyPhotos].map((id) => state.photos.find((p) => p.id === id)).filter(Boolean).map((p) => ({
    id: p.id, name: p.name, type: p.file.type, selected: p.selected, settings: p.settings,
  }));
  dirtyPhotos.clear();
  try {
    await storage.saveRecords(records, { order: state.photos.map((p) => p.id), activeId: state.activeId });
  } catch {
    if (!state.autosaveWarned) { state.autosaveWarned = true; setStatus("Không thể tự lưu phiên (bộ nhớ trình duyệt bị chặn)"); }
  }
}

async function checkStoredSession() {
  const summary = await storage.sessionSummary();
  if (!summary || state.photos.length) return;
  state.storedSession = summary;
  const when = new Date(summary.savedAt).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
  el.restoreDetail.textContent = `${summary.count} ảnh · lưu lúc ${when}`;
  el.restoreCard.hidden = false;
}

async function restoreSession() {
  el.restoreSessionButton.disabled = true;
  setStatus("Đang khôi phục phiên trước…");
  try {
    const session = await storage.loadSession();
    if (!session) throw new Error("Không còn dữ liệu phiên.");
    const results = await Promise.allSettled(session.records.map((rec) => {
      const file = rec.file instanceof File ? rec.file : new File([rec.file], rec.name, { type: rec.type || rec.file.type });
      return createPhoto(file, { id: rec.id, settings: rec.settings, selected: rec.selected !== false });
    }));
    const photos = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    state.photos.push(...photos);
    state.storedSession = null;
    el.restoreCard.hidden = true;
    renderFilmstrip();
    const active = photos.find((p) => p.id === session.meta.activeId) || photos[0];
    if (active) activatePhoto(active.id);
    showToast(`Đã khôi phục ${photos.length} ảnh.`);
  } catch (error) {
    showToast(error.message || "Không thể khôi phục phiên.");
    setStatus("Sẵn sàng");
  } finally {
    el.restoreSessionButton.disabled = false;
  }
}

async function discardSession() {
  await storage.clearSession().catch(() => {});
  state.storedSession = null;
  el.restoreCard.hidden = true;
  showToast("Đã bỏ phiên cũ.");
}

/* ============================================================
   Sự kiện
   ============================================================ */

function setPreviewMode(mode) {
  state.previewMode = mode;
  document.querySelectorAll("[data-preview-mode]").forEach((b) => {
    const active = b.dataset.previewMode === mode;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  });
  scheduleRender();
}

function toggleClipping(force) {
  state.clipping = force ?? !state.clipping;
  el.clippingButton.setAttribute("aria-pressed", String(state.clipping));
  el.clippingButton.classList.toggle("active", state.clipping);
  scheduleRender();
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch {
    showToast("Trình duyệt không cho phép toàn màn hình.");
  }
}

function restoreSectionState() {
  const saved = safeLocalStorage(() => JSON.parse(localStorage.getItem("luma.sections") || "{}"), {});
  document.querySelectorAll("[data-section]").forEach((section) => {
    const toggle = section.querySelector(".section-toggle");
    const key = section.dataset.section;
    if (toggle && key in saved) toggle.setAttribute("aria-expanded", String(saved[key]));
  });
}

function saveSectionState() {
  const state2 = {};
  document.querySelectorAll("[data-section]").forEach((section) => {
    state2[section.dataset.section] = section.querySelector(".section-toggle")?.getAttribute("aria-expanded") === "true";
  });
  safeLocalStorage(() => localStorage.setItem("luma.sections", JSON.stringify(state2)));
}

function bindEvents() {
  const chooseFiles = () => el.fileInput.click();
  el.openImageButton.addEventListener("click", chooseFiles);
  el.addImagesButton.addEventListener("click", chooseFiles);
  el.fileInput.addEventListener("change", () => loadFiles(el.fileInput.files));
  el.sampleImageButton.addEventListener("click", async () => {
    try {
      const response = await fetch("./sample.jpg");
      if (!response.ok) throw new Error("Không thể mở ảnh mẫu.");
      const blob = await response.blob();
      await loadFiles([new File([blob], "anh-mau-mua-thu.jpg", { type: "image/jpeg" })]);
      applyPreset("autumn");
    } catch (error) {
      showToast(error.message || "Không thể mở ảnh mẫu.");
    }
  });
  el.restoreSessionButton.addEventListener("click", restoreSession);
  el.discardSessionButton.addEventListener("click", discardSession);

  el.resetButton.addEventListener("click", resetPhoto);
  el.previousSettingsButton.addEventListener("click", copyPreviousSettings);
  el.copySettingsButton.addEventListener("click", () => openSettingsDialog("copy"));
  el.pasteSettingsButton.addEventListener("click", pasteSettings);
  el.syncSettingsButton.addEventListener("click", () => openSettingsDialog("sync"));
  el.undoButton.addEventListener("click", undo);
  el.redoButton.addEventListener("click", redo);
  el.fullscreenButton.addEventListener("click", toggleFullscreen);
  el.shortcutsButton.addEventListener("click", () => el.shortcutsDialog.showModal());
  el.exportButton.addEventListener("click", openExportDialog);
  document.addEventListener("fullscreenchange", () => {
    const active = !!document.fullscreenElement;
    el.fullscreenButton.setAttribute("aria-pressed", String(active));
    el.fullscreenButton.querySelector("span").textContent = active ? "×" : "⛶";
    el.fullscreenButton.setAttribute("aria-label", active ? "Thoát toàn màn hình" : "Toàn màn hình");
    scheduleRender();
  });

  el.presetDrawerHandle.addEventListener("click", () => setPresetDrawer(!state.drawerOpen));
  el.presetDrawerClose.addEventListener("click", () => setPresetDrawer(false));
  el.drawerBackdrop.addEventListener("click", () => setPresetDrawer(false));
  el.importPresetButton.addEventListener("click", () => el.presetFileInput.click());
  el.presetFileInput.addEventListener("change", () => importPresetFiles(el.presetFileInput.files));
  el.savePresetButton.addEventListener("click", saveCurrentAsPreset);
  let amountGesture = null;
  el.presetAmountRange.addEventListener("input", () => {
    const photo = activePhoto();
    const ps = photo?.presetState;
    if (!ps) return;
    if (!amountGesture) amountGesture = beginGesture(photo);
    const preset = presetById(ps.presetId);
    ps.amount = Number(el.presetAmountRange.value) / 100;
    photo.settings = applyPresetSettings(ps.base, preset, ps.amount);
    ps.result = cloneSettings(photo.settings);
    el.presetAmountValue.textContent = `${el.presetAmountRange.value}%`;
    setRangeProgress(el.presetAmountRange);
    for (const set of controlSets) set.sync();
    syncCurvePanel();
    syncGradePanel();
    scheduleRender();
  });
  el.presetAmountRange.addEventListener("change", () => { endGesture(amountGesture); amountGesture = null; updateActionButtons(); showPresetPreview(null); });

  el.fitButton.addEventListener("click", fitView);
  el.actualSizeButton.addEventListener("click", () => actualSize());
  el.zoomInButton.addEventListener("click", () => stepZoom(1));
  el.zoomOutButton.addEventListener("click", () => stepZoom(-1));
  el.cropToolButton.addEventListener("click", () => setTool("crop"));
  el.clippingButton.addEventListener("click", () => toggleClipping());
  el.shadowClipIndicator.addEventListener("click", () => toggleClipping());
  el.highlightClipIndicator.addEventListener("click", () => toggleClipping());
  el.autoToneButton.addEventListener("click", runAutoTone);
  el.autoWhiteBalanceButton.addEventListener("click", runAutoWhiteBalance);
  el.eyedropperButton.addEventListener("click", () => setTool("eyedropper"));
  document.querySelectorAll("[data-preview-mode]").forEach((b) => b.addEventListener("click", () => setPreviewMode(b.dataset.previewMode)));
  document.querySelectorAll(".section-toggle").forEach((b) => b.addEventListener("click", () => {
    b.setAttribute("aria-expanded", String(b.getAttribute("aria-expanded") !== "true"));
    saveSectionState();
    if (b.getAttribute("aria-expanded") === "true") { syncCurvePanel(); syncGradePanel(); }
  }));
  document.querySelectorAll(".hsl-tab").forEach((button) => button.addEventListener("click", () => {
    const tab = button.dataset.hslTab;
    document.querySelectorAll(".hsl-tab").forEach((t) => {
      t.classList.toggle("active", t === button);
      t.setAttribute("aria-selected", String(t === button));
    });
    document.querySelectorAll("[data-hsl-panel]").forEach((panel) => { panel.hidden = tab !== "all" && panel.dataset.hslPanel !== tab; });
  }));

  // Crop
  for (const a of aspectRatios) {
    const o = document.createElement("option");
    o.value = a.id;
    o.textContent = a.label;
    el.cropAspectSelect.appendChild(o);
  }
  el.cropAspectSelect.addEventListener("change", () => {
    const photo = activePhoto();
    if (!photo) return;
    const crop = { ...photo.settings.crop, aspect: el.cropAspectSelect.value };
    const aspect = aspectValue(crop.aspect, photo.width, photo.height, crop);
    setCrop(photo, aspect ? applyAspect(crop, aspect, photo.width, photo.height) : crop);
  });
  el.cropAngleRange.addEventListener("input", () => {
    const photo = activePhoto();
    if (!photo) return;
    setCrop(photo, fitCropInside({ ...photo.settings.crop, angle: Number(el.cropAngleRange.value) }, photo.width, photo.height));
  });
  el.cropAngleRange.addEventListener("dblclick", () => {
    const photo = activePhoto();
    if (photo) setCrop(photo, fitCropInside({ ...photo.settings.crop, angle: 0 }, photo.width, photo.height));
  });
  const rotate = (dir) => {
    const photo = activePhoto();
    if (!photo) return;
    let crop = rotateQuarter(photo.settings.crop, dir);
    const aspect = aspectValue(crop.aspect, photo.width, photo.height, crop);
    if (aspect && crop.aspect !== "original") crop = applyAspect(crop, aspect, photo.width, photo.height);
    setCrop(photo, crop);
  };
  el.rotateLeftButton.addEventListener("click", () => rotate(-1));
  el.rotateRightButton.addEventListener("click", () => rotate(1));
  el.flipButton.addEventListener("click", () => {
    const photo = activePhoto();
    if (photo) setCrop(photo, { ...photo.settings.crop, flip: !photo.settings.crop.flip });
  });
  el.cropResetButton.addEventListener("click", () => {
    const photo = activePhoto();
    if (photo) setCrop(photo, { ...defaultCrop(photo.width, photo.height), iw: photo.width, ih: photo.height });
  });
  el.cropDoneButton.addEventListener("click", () => finishCrop(true));

  // Masks
  document.querySelectorAll("[data-add-mask]").forEach((b) => b.addEventListener("click", () => addMask(b.dataset.addMask)));
  el.showMaskToggle.addEventListener("change", () => { state.showMaskOverlay = el.showMaskToggle.checked; scheduleRender(); });
  el.invertMaskToggle.addEventListener("change", () => {
    const photo = activePhoto();
    const mask = activeMask(photo);
    if (!mask) return;
    record(photo);
    mask.invert = el.invertMaskToggle.checked;
    settingsChanged(photo);
  });
  el.clearMaskButton.addEventListener("click", () => {
    const photo = activePhoto();
    const mask = activeMask(photo);
    if (!mask || !mask.brush) return;
    record(photo);
    mask.brush = null;
    settingsChanged(photo);
    showToast("Đã xoá nét cọ.", { label: "Hoàn tác", run: undo });
  });
  const mini = (range, output, fmt = (v) => v) => {
    range.addEventListener("input", () => { output.textContent = fmt(range.value); setRangeProgress(range); });
    setRangeProgress(range);
  };
  mini(el.brushSizeRange, el.brushSizeValue);
  mini(el.brushFeatherRange, el.brushFeatherValue);
  mini(el.brushFlowRange, el.brushFlowValue);
  let geoGesture = null;
  const geoBegin = () => { if (!geoGesture) geoGesture = beginGesture(); };
  const geoEnd = () => { endGesture(geoGesture); geoGesture = null; updateActionButtons(); };
  el.maskFeatherRange.addEventListener("input", () => {
    const mask = activeMask();
    if (!mask) return;
    geoBegin();
    mask.feather = Number(el.maskFeatherRange.value);
    el.maskFeatherValue.textContent = mask.feather;
    setRangeProgress(el.maskFeatherRange);
    scheduleRender();
  });
  el.maskFeatherRange.addEventListener("change", geoEnd);
  el.maskRotationRange.addEventListener("input", () => {
    const mask = activeMask();
    if (!mask) return;
    geoBegin();
    mask.radial.rotation = Number(el.maskRotationRange.value);
    el.maskRotationValue.textContent = `${mask.radial.rotation}°`;
    setRangeProgress(el.maskRotationRange);
    scheduleRender();
  });
  el.maskRotationRange.addEventListener("change", geoEnd);

  // Viewport
  const vp = el.canvasViewport;
  vp.addEventListener("pointerdown", onPointerDown);
  vp.addEventListener("pointermove", onPointerMove);
  vp.addEventListener("pointerup", onPointerUp);
  vp.addEventListener("pointercancel", onPointerUp);
  vp.addEventListener("pointerleave", () => {
    if (!state.gesture) { el.brushCursor.hidden = true; state.lastPointer = null; updateHistogramInfo(); }
  });
  vp.addEventListener("wheel", onWheel, { passive: false });
  vp.addEventListener("dblclick", (event) => {
    const photo = activePhoto();
    if (!photo || state.tool || activeMask(photo)) return;
    const p = viewportPoint(event);
    if (!insideImage(p)) return;
    if (state.view.fit) actualSize(p.x, p.y); else fitView();
  });
  vp.addEventListener("contextmenu", (e) => { if (state.gesture) e.preventDefault(); });

  // Filmstrip & export
  el.selectAllButton.addEventListener("click", () => {
    const all = state.photos.length > 0 && state.photos.every((p) => p.selected);
    state.photos.forEach((p) => { p.selected = !all; markDirty(p); });
    renderFilmstrip();
    updateExportCount();
  });
  el.exportScopeSelect.addEventListener("change", updateExportCount);
  el.formatSelect.addEventListener("change", () => { el.qualityField.hidden = el.formatSelect.value === "image/png"; updateExportCount(); });
  el.qualityRange.addEventListener("input", () => { el.qualityValue.textContent = `${el.qualityRange.value}%`; setRangeProgress(el.qualityRange); });
  el.resizeSelect.addEventListener("change", () => { el.longEdgeField.hidden = el.resizeSelect.value !== "long"; });
  el.keepExifToggle.addEventListener("change", updateExportCount);
  el.exportForm.addEventListener("submit", (event) => {
    if (event.submitter?.value === "default") { event.preventDefault(); exportImages(); return; }
    if (state.exporting) { event.preventDefault(); state.exporting.cancelled = true; }
  });
  el.exportDialog.addEventListener("cancel", (event) => { if (state.exporting) { event.preventDefault(); state.exporting.cancelled = true; } });

  el.settingsForm.addEventListener("submit", (event) => { if (event.submitter?.value === "default") confirmSettingsDialog(); });
  el.settingsGroupList.addEventListener("change", updateGroupToggle);
  el.toggleAllGroupsButton.addEventListener("click", () => {
    const boxes = [...el.settingsGroupList.querySelectorAll("input")];
    const all = boxes.every((b) => b.checked);
    boxes.forEach((b) => { b.checked = !all; });
    updateGroupToggle();
  });

  // Kéo thả file
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  window.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth += 1; el.dropOverlay.hidden = false; });
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("dragleave", (e) => { if (!hasFiles(e)) return; dragDepth -= 1; if (dragDepth <= 0) { dragDepth = 0; el.dropOverlay.hidden = true; } });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    el.dropOverlay.hidden = true;
    const files = [...e.dataTransfer.files];
    const presetFiles = files.filter((f) => /\.(xmp|lrtemplate|json)$/i.test(f.name));
    const images = files.filter((f) => !presetFiles.includes(f));
    if (presetFiles.length) importPresetFiles(presetFiles);
    if (images.length) loadFiles(images);
  });

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", (event) => {
    if (event.key === "\\") { state.holdingBefore = false; scheduleRender(); }
    if (event.code === "Space") { state.spaceDown = false; if (state.lastPointer) updateCursor(state.lastPointer); }
  });
  window.addEventListener("blur", () => { state.spaceDown = false; state.holdingBefore = false; });
  window.addEventListener("resize", () => { if (activePhoto()) { clampPan(); scheduleRender(); } });
  new ResizeObserver(() => { if (activePhoto()) scheduleRender(); }).observe(el.canvasViewport);
  window.addEventListener("pagehide", () => { if (dirtyPhotos.size) flushAutosave(); });
}

function onKeyDown(event) {
  const ctrl = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  const typing = editingText();
  const dialogOpen = document.querySelector("dialog[open]");
  if (dialogOpen) return;

  if (ctrl && !typing) {
    if (key === "z" && !event.shiftKey) { event.preventDefault(); undo(); return; }
    if ((key === "z" && event.shiftKey) || key === "y") { event.preventDefault(); redo(); return; }
    if (event.shiftKey && key === "c") { event.preventDefault(); openSettingsDialog("copy"); return; }
    if (event.shiftKey && key === "v") { event.preventDefault(); pasteSettings(); return; }
    if (event.shiftKey && key === "s") { event.preventDefault(); openSettingsDialog("sync"); return; }
    if (event.shiftKey && key === "e") { event.preventDefault(); openExportDialog(); return; }
    return;
  }
  if (typing || event.altKey && key !== "alt") return;

  if (event.key === "Escape") {
    if (state.drawerOpen) { setPresetDrawer(false); return; }
    if (state.tool === "crop") { finishCrop(false); return; }
    if (state.tool) { setTool(null); return; }
    return;
  }
  if (event.key === "Enter" && state.tool === "crop") { event.preventDefault(); finishCrop(true); return; }
  if (event.code === "Space" && activePhoto()) {
    const tag = document.activeElement?.tagName;
    if (tag === "BUTTON" || (tag === "INPUT" && document.activeElement.type === "checkbox")) return;
    event.preventDefault();
    if (!state.spaceDown) { state.spaceDown = true; if (state.lastPointer) updateCursor(state.lastPointer); el.brushCursor.hidden = true; }
    return;
  }
  if (event.key === "\\" && !event.repeat) { state.holdingBefore = true; scheduleRender(); return; }
  if (event.key === "?") { el.shortcutsDialog.showModal(); return; }
  const onRange = document.activeElement?.type === "range";
  if (!activePhoto()) return;
  if (key === "f") toggleFullscreen();
  else if (key === "r" && event.shiftKey) resetPhoto();
  else if (key === "r") setTool("crop");
  else if (key === "j") toggleClipping();
  else if (key === "w") setTool("eyedropper");
  else if (key === "y") setPreviewMode(state.previewMode === "split" ? "after" : "split");
  else if (key === "o") { state.showMaskOverlay = !state.showMaskOverlay; el.showMaskToggle.checked = state.showMaskOverlay; scheduleRender(); }
  else if (key === "z") { if (state.view.fit) actualSize(state.lastPointer?.x, state.lastPointer?.y); else fitView(); }
  else if (event.key === "+" || event.key === "=") stepZoom(1, state.lastPointer?.x, state.lastPointer?.y);
  else if (event.key === "-" || event.key === "_") stepZoom(-1, state.lastPointer?.x, state.lastPointer?.y);
  else if (event.key === "[" || event.key === "]") {
    const delta = event.key === "]" ? 1.15 : 1 / 1.15;
    el.brushSizeRange.value = Math.round(clamp(Number(el.brushSizeRange.value) * delta, 4, 400));
    el.brushSizeRange.dispatchEvent(new Event("input"));
    if (state.lastPointer) updateBrushCursor(state.lastPointer);
  } else if (!onRange && event.key === "ArrowLeft") navigatePhoto(-1);
  else if (!onRange && event.key === "ArrowRight") navigatePhoto(1);
}

/* ============================================================
   Khởi động
   ============================================================ */

function start() {
  try {
    renderer = new Renderer(el.editorCanvas);
  } catch (error) {
    el.emptyState.replaceChildren();
    const h1 = document.createElement("h1");
    h1.textContent = "Không thể khởi động LUMA";
    const p1 = document.createElement("p");
    p1.textContent = error.message;
    const p2 = document.createElement("p");
    p2.textContent = "Hãy mở bằng Chrome hoặc Edge phiên bản mới (cần WebGL 2).";
    el.emptyState.append(h1, p1, p2);
    return;
  }
  el.editorCanvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    showToast("GPU bị mất kết nối — hãy tải lại trang. Phiên làm việc đã được tự lưu.", null, 10000);
  });
  restoreSectionState();
  buildPanels();
  bindEvents();
  renderPresetList();
  setRangeProgress(el.qualityRange);
  drawHistogram(el.histogramCanvas, null);
  checkStoredSession();
  window.__luma = { state, renderer, applyPreset, addMask, activePhoto, settingsChanged, exportImages, setTool };
}

start();
