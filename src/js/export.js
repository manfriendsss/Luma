// Xuất ảnh: preset xuất, mẫu tên file, làm nét đầu ra, ZIP / thư mục / tải từng file, giữ EXIF.
import { builtInExportPresets, outputSharpenAmounts } from "./config.js";
import { outputSize } from "./geometry.js";
import { createZipParts } from "./zip.js";
import { findExifSegment, sanitizeExifSegment, injectExif } from "./jpeg-meta.js";
import { state, el, clamp, activePhoto, showToast, setStatus, downloadBlob, safeLocalStorage, slug, uid, scheduleRender } from "./core.js";
import { ensureBitmap, releaseBitmap } from "./photos.js";
import { selectedPhotos, visiblePhotos } from "./filmstrip.js";
import { finishCrop } from "./view.js";
import { presetById } from "./presets-ui.js";
import { askName } from "./dialogs.js";
import { setRangeProgress } from "./controls.js";

const EXPORT_PRESETS_KEY = "luma.exportPresets";
const LAST_EXPORT_KEY = "luma.lastExport";
let userExportPresets = safeLocalStorage(() => JSON.parse(localStorage.getItem(EXPORT_PRESETS_KEY) || "[]"), []);

const allExportPresets = () => [...builtInExportPresets, ...userExportPresets];

function readOptions() {
  return {
    format: el.formatSelect.value,
    quality: Number(el.qualityRange.value),
    resize: el.resizeSelect.value,
    longEdge: clamp(Number(el.longEdgeInput.value) || 2048, 64, 30000),
    sharpen: el.sharpenSelect.value,
    template: el.templateInput.value.trim() || "{name}-luma",
    keepExif: el.keepExifToggle.checked,
    keepGps: el.keepGpsToggle.checked,
  };
}

function writeOptions(o) {
  el.formatSelect.value = o.format;
  el.qualityRange.value = o.quality;
  el.qualityValue.textContent = `${o.quality}%`;
  el.resizeSelect.value = o.resize;
  el.longEdgeInput.value = o.longEdge;
  el.sharpenSelect.value = o.sharpen || "none";
  el.templateInput.value = o.template || "{name}-luma";
  el.keepExifToggle.checked = o.keepExif !== false;
  el.keepGpsToggle.checked = !!o.keepGps;
  syncFields();
}

function syncFields() {
  el.qualityField.hidden = el.formatSelect.value === "image/png";
  el.longEdgeField.hidden = el.resizeSelect.value !== "long";
  el.metadataField.hidden = el.formatSelect.value !== "image/jpeg";
  el.keepGpsToggle.disabled = !el.keepExifToggle.checked;
  el.qualityValue.textContent = `${el.qualityRange.value}%`;
  setRangeProgress(el.qualityRange);
  updateTemplatePreview();
}

function renderExportPresetSelect(selectedId = el.exportPresetSelect.value) {
  el.exportPresetSelect.replaceChildren();
  const custom = document.createElement("option");
  custom.value = "";
  custom.textContent = "Tuỳ chỉnh";
  el.exportPresetSelect.appendChild(custom);
  for (const p of allExportPresets()) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.builtin ? p.name : `★ ${p.name}`;
    el.exportPresetSelect.appendChild(o);
  }
  el.exportPresetSelect.value = allExportPresets().some((p) => p.id === selectedId) ? selectedId : "";
  el.deleteExportPresetButton.disabled = !userExportPresets.some((p) => p.id === el.exportPresetSelect.value);
}

export function exportTargets() {
  const scope = el.exportScopeSelect.value;
  if (scope === "active") return activePhoto() ? [activePhoto()] : [];
  if (scope === "visible") return visiblePhotos();
  return selectedPhotos();
}

export function updateExportCount() {
  if (!el.exportDialog.open) return;
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
  el.deliverySelect.value = options.some(([v]) => v === current) ? current : (multiple ? options[0][0] : "download");
  updateTemplatePreview();
}

/* ---------- Mẫu tên file ---------- */

const pad = (n, len = 2) => String(n).padStart(len, "0");

export function formatFileName(template, photo, { index = 1, width, height, date = new Date() } = {}) {
  // Bản sao ảo "IMG_001.JPG (bản sao 2)" → "IMG_001-v2"
  const copy = / \(bản sao (\d+)\)$/.exec(photo.name);
  const stem = (copy ? photo.name.slice(0, copy.index) : photo.name).replace(/\.[^.]+$/, "");
  const base = copy ? `${stem}-v${copy[1]}` : stem;
  const tokens = {
    name: base,
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}${pad(date.getMinutes())}`,
    n: pad(index, 3),
    w: width ?? "",
    h: height ?? "",
    rating: photo.rating ? `${photo.rating}sao` : "",
    preset: slug(presetById(photo.settings.preset)?.name || "rieng"),
  };
  const name = template.replace(/\{(\w+)\}/g, (m, key) => (key in tokens ? String(tokens[key]) : m));
  // Ký tự không hợp lệ trong tên file Windows/macOS
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().replace(/^\.+/, "") || base;
}

function updateTemplatePreview() {
  const photo = exportTargets()[0] || activePhoto();
  if (!photo) { el.templatePreview.textContent = ""; return; }
  const { width, height } = exportDimensions(photo, readOptions());
  el.templatePreview.textContent = `Ví dụ: ${formatFileName(el.templateInput.value || "{name}-luma", photo, { index: 1, width, height })}.${extensionForType(el.formatSelect.value)}`;
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

function exportDimensions(photo, options) {
  const out = outputSize(photo.settings.crop);
  let width = Math.round(out.width), height = Math.round(out.height);
  if (options.resize === "long") {
    const s = Math.min(1, options.longEdge / Math.max(width, height));
    width = Math.max(1, Math.round(width * s));
    height = Math.max(1, Math.round(height * s));
  }
  return { width, height };
}

async function renderPhotoToBlob(photo, options, shouldCancel, onProgress) {
  const { width, height } = exportDimensions(photo, options);
  if (width * height > 250_000_000 || width > 32000 || height > 32000) {
    throw new Error(`${photo.name}: ${width}×${height} vượt giới hạn canvas của trình duyệt. Hãy giảm kích thước xuất.`);
  }
  const renderer = state.renderer;
  const wasResident = !!photo.bitmap;
  photo.pinned = true;
  try {
    await ensureBitmap(photo);
    renderer.photoId = null;
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
      outputSharpen: outputSharpenAmounts[options.sharpen] || 0,
      onTile: ({ x, y, width: w, height: h, pixels }) => {
        ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), w, h), x, y);
        done += 1;
        onProgress?.(done / totalTiles);
      },
    });
    let blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`${photo.name}: không thể mã hoá file xuất.`))), options.format, options.quality / 100));
    canvas.width = canvas.height = 1;
    if (options.format === "image/jpeg" && options.keepExif) {
      try {
        const original = new Uint8Array(await photo.file.slice(0, 256 * 1024).arrayBuffer());
        const segment = findExifSegment(original);
        const clean = segment && sanitizeExifSegment(segment, { width, height, keepGps: options.keepGps });
        if (clean) blob = new Blob([injectExif(new Uint8Array(await blob.arrayBuffer()), clean)], { type: options.format });
      } catch {
        // EXIF không bắt buộc
      }
    }
    return { blob, width, height };
  } finally {
    photo.pinned = false;
    if (!wasResident && photo.id !== state.activeId) releaseBitmap(photo);
  }
}

export function openExportDialog() {
  if (!activePhoto()) return;
  if (state.tool === "crop") finishCrop(true);
  const last = safeLocalStorage(() => JSON.parse(localStorage.getItem(LAST_EXPORT_KEY) || "null"), null);
  renderExportPresetSelect(last?.presetId || "");
  if (last?.options) writeOptions({ ...builtInExportPresets[0].options, ...last.options });
  else writeOptions(builtInExportPresets[0].options);
  if (last?.scope) el.exportScopeSelect.value = last.scope;
  el.exportProgress.hidden = true;
  el.exportDialog.showModal();
  updateExportCount();
}

async function exportImages() {
  const targets = exportTargets();
  if (!targets.length || state.exporting) return;
  const options = readOptions();
  safeLocalStorage(() => localStorage.setItem(LAST_EXPORT_KEY, JSON.stringify({ options, presetId: el.exportPresetSelect.value, scope: el.exportScopeSelect.value })));
  const delivery = el.deliverySelect.value;
  let directory = null;
  if (delivery === "folder") {
    try {
      directory = await window.showDirectoryPicker({ id: "luma-export", mode: "readwrite", startIn: "pictures" });
    } catch (error) {
      if (error.name === "AbortError") return;
      showToast("Không mở được thư mục, sẽ tải file về thư mục Tải xuống.");
    }
  }
  const ext = extensionForType(options.format);
  const used = new Set();
  const zipFiles = [];
  const startedAt = new Date();
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
      const label = `Đang xử lý ${i + 1}/${targets.length}: ${photo.name}`;
      progress(i, 0, label);
      setStatus(`Đang xuất ${i + 1}/${targets.length}…`);
      try {
        const { blob, width, height } = await renderPhotoToBlob(photo, options, shouldCancel, (f) => progress(i, f * 0.9, label));
        const base = formatFileName(options.template, photo, { index: i + 1, width, height, date: startedAt });
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
      const stamp = startedAt.toISOString().slice(0, 16).replace(/[:T]/g, "-");
      downloadBlob(new Blob(createZipParts(zipFiles), { type: "application/zip" }), `luma-${stamp}.zip`);
    }
  } finally {
    const cancelled = shouldCancel();
    state.exporting = null;
    el.cancelExportButton.textContent = "Huỷ";
    el.confirmExportButton.disabled = false;
    setStatus("Ảnh được xử lý cục bộ");
    const photo = activePhoto();
    if (photo) { state.renderer.photoId = null; await ensureBitmap(photo).catch(() => {}); }
    scheduleRender();
    if (cancelled) showToast(`Đã dừng xuất (${completed} ảnh đã xong).`);
    else if (errors.length) showToast(`Đã xuất ${completed} ảnh · ${errors.length} lỗi: ${errors[0]}`, null, 7000);
    else showToast(`Đã xuất ${completed} ảnh thành công.`);
    if (!cancelled && !errors.length) el.exportDialog.close();
  }
}

async function saveExportPreset() {
  const name = await askName("Lưu preset xuất", "Preset xuất của tôi", "Tên preset xuất");
  if (!name) return;
  const preset = { id: `xp-${uid().slice(0, 8)}`, name, options: readOptions() };
  userExportPresets.push(preset);
  safeLocalStorage(() => localStorage.setItem(EXPORT_PRESETS_KEY, JSON.stringify(userExportPresets)));
  renderExportPresetSelect(preset.id);
  showToast(`Đã lưu preset xuất “${name}”.`);
}

function deleteExportPreset() {
  const id = el.exportPresetSelect.value;
  userExportPresets = userExportPresets.filter((p) => p.id !== id);
  safeLocalStorage(() => localStorage.setItem(EXPORT_PRESETS_KEY, JSON.stringify(userExportPresets)));
  renderExportPresetSelect("");
}

export function initExport() {
  el.exportButton.addEventListener("click", openExportDialog);
  el.exportScopeSelect.addEventListener("change", updateExportCount);
  for (const input of [el.formatSelect, el.resizeSelect, el.keepExifToggle, el.sharpenSelect]) {
    input.addEventListener("change", () => { el.exportPresetSelect.value = ""; syncFields(); updateExportCount(); });
  }
  el.qualityRange.addEventListener("input", () => { el.exportPresetSelect.value = ""; syncFields(); });
  el.longEdgeInput.addEventListener("input", () => { el.exportPresetSelect.value = ""; updateTemplatePreview(); });
  el.templateInput.addEventListener("input", updateTemplatePreview);
  el.exportPresetSelect.addEventListener("change", () => {
    const preset = allExportPresets().find((p) => p.id === el.exportPresetSelect.value);
    if (preset) writeOptions({ ...builtInExportPresets[0].options, ...preset.options });
    el.deleteExportPresetButton.disabled = !userExportPresets.some((p) => p.id === el.exportPresetSelect.value);
    updateExportCount();
  });
  el.saveExportPresetButton.addEventListener("click", saveExportPreset);
  el.deleteExportPresetButton.addEventListener("click", deleteExportPreset);
  document.querySelectorAll("[data-token]").forEach((b) => b.addEventListener("click", () => {
    const input = el.templateInput;
    const pos = input.selectionStart ?? input.value.length;
    input.value = `${input.value.slice(0, pos)}${b.dataset.token}${input.value.slice(input.selectionEnd ?? pos)}`;
    input.focus();
    updateTemplatePreview();
  }));
  el.exportForm.addEventListener("submit", (event) => {
    if (event.submitter?.value === "default") { event.preventDefault(); exportImages(); return; }
    if (state.exporting) { event.preventDefault(); state.exporting.cancelled = true; }
  });
  el.exportDialog.addEventListener("cancel", (event) => { if (state.exporting) { event.preventDefault(); state.exporting.cancelled = true; } });
}
