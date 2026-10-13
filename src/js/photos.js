// Quản lý ảnh: nạp tiết kiệm bộ nhớ, thư mục + file thiết lập đi kèm (.luma.json), bản sao ảo, sao/cờ.
import { MAX_MASKS, MASK_TEXTURE_LONG_EDGE } from "./config.js";
import {
  defaultSettings, cloneCurve, cloneGrade, createMask, cloneSettings, defaultRange,
  serializeSettings, deserializeMasks,
} from "./settings.js";
import { fitCropInside } from "./geometry.js";
import { analyzePixels } from "./color.js";
import {
  state, el, activePhoto, showToast, setStatus, markDirty, scheduleRender, ensureActiveMask, uid, settingsChanged,
} from "./core.js";
import * as storage from "./storage.js";
import { renderFilmstrip, updateFilmstripBadges } from "./filmstrip.js";
import { onPhotoActivated, onNoPhoto } from "./panel.js";
import { finishCrop, setTool, resetView, updateDimensions } from "./view.js";

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const RESIDENT_LIMIT = 2; // số ảnh giữ bản giải mã đầy đủ trong RAM
const resident = [];

/* ---------- Giải mã ---------- */

let decodeChain = Promise.resolve();
/** Giải mã tuần tự để không làm tràn bộ nhớ khi mở nhiều ảnh cùng lúc. */
function queued(fn) {
  const run = decodeChain.then(fn, fn);
  decodeChain = run.catch(() => {});
  return run;
}

export async function decodeImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image", premultiplyAlpha: "none", colorSpaceConversion: "default" });
  } catch {
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

function canvasFrom(bitmap, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

async function makeThumbnail(bitmap) {
  const { canvas } = canvasFrom(bitmap, 320);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  return blob ? URL.createObjectURL(blob) : "";
}

function computeStats(bitmap) {
  const { canvas, ctx } = canvasFrom(bitmap, 384);
  return analyzePixels(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
}

/** Đảm bảo ảnh có bản giải mã đầy đủ (giữ tối đa RESIDENT_LIMIT ảnh trong RAM). */
export async function ensureBitmap(photo) {
  if (photo.bitmap) { touch(photo); return photo.bitmap; }
  if (!photo.decoding) {
    photo.decoding = queued(async () => {
      const bitmap = await decodeImage(photo.file);
      photo.bitmap = bitmap;
      touch(photo);
      return bitmap;
    }).finally(() => { photo.decoding = null; });
  }
  return photo.decoding;
}

function touch(photo) {
  const i = resident.indexOf(photo);
  if (i >= 0) resident.splice(i, 1);
  resident.push(photo);
  while (resident.length > RESIDENT_LIMIT) {
    const victim = resident.find((p) => p.id !== state.activeId && !p.pinned);
    if (!victim) break;
    releaseBitmap(victim);
  }
}

export function releaseBitmap(photo) {
  const i = resident.indexOf(photo);
  if (i >= 0) resident.splice(i, 1);
  photo.bitmap?.close?.();
  photo.bitmap = null;
  photo.analysis = null;
}

export const residentCount = () => state.photos.filter((p) => p.bitmap).length;

/** Dữ liệu pixel nhỏ cho chấm cân bằng trắng / chọn màu (tính khi cần từ ảnh đang mở). */
export function photoAnalysis(photo) {
  if (photo.analysis) return photo.analysis;
  if (!photo.bitmap) return null;
  const { canvas, ctx } = canvasFrom(photo.bitmap, 512);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  photo.analysis = { width: canvas.width, height: canvas.height, data };
  return photo.analysis;
}

/* ---------- Tạo ảnh ---------- */

/** Bổ sung trường thiếu cho thiết lập cũ hoặc thiết lập khôi phục. */
export function normalizeSettings(settings, width, height) {
  const base = defaultSettings(width, height);
  if (!settings) return base;
  const masks = Array.isArray(settings.masks) ? deserializeMasks(settings.masks).slice(0, MAX_MASKS).map((m) => {
    const fresh = createMask(m.type);
    return {
      ...fresh, ...m,
      values: { ...fresh.values, ...(m.values || {}) },
      linear: m.linear || fresh.linear,
      radial: { ...fresh.radial, ...(m.radial || {}) },
      range: { ...defaultRange(fresh.range.type), ...(m.range || {}) },
    };
  }) : [];
  return {
    values: { ...base.values, ...(settings.values || {}) },
    curve: cloneCurve(settings.curve),
    grade: cloneGrade(settings.grade),
    crop: settings.crop ? fitCropInside({ ...base.crop, ...settings.crop }, width, height) : base.crop,
    masks,
    disabled: { ...(settings.disabled || {}) },
    preset: settings.preset ?? null,
  };
}

export async function createPhoto(file, options = {}) {
  if (file.type && !file.type.startsWith("image/")) throw new Error(`${file.name}: định dạng không được hỗ trợ.`);
  return queued(async () => {
    let bitmap;
    try { bitmap = await decodeImage(file); } catch { throw new Error(`${file.name}: không thể đọc ảnh.`); }
    const max = state.renderer.maxTextureSize;
    if (bitmap.width > max || bitmap.height > max) {
      bitmap.close?.();
      throw new Error(`${file.name}: ảnh ${bitmap.width}×${bitmap.height} vượt giới hạn ${max}px của GPU trên máy này.`);
    }
    const width = bitmap.width, height = bitmap.height;
    const thumbUrl = await makeThumbnail(bitmap);
    const stats = computeStats(bitmap);
    bitmap.close?.(); // giải phóng ngay; sẽ giải mã lại khi ảnh được mở
    const scale = Math.min(1, MASK_TEXTURE_LONG_EDGE / Math.max(width, height));
    const photo = {
      id: options.id || uid(),
      file,
      fileRef: options.fileRef || null,
      name: options.name || file.name || "anh.jpg",
      source: options.source || { kind: "file" },
      thumbUrl,
      bitmap: null,
      width,
      height,
      stats,
      maskSize: { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) },
      selected: options.selected ?? true,
      rating: options.rating || 0,
      flag: options.flag || 0,
      snapshots: (options.snapshots || []).map((s) => ({ ...s, settings: normalizeSettings(s.settings, width, height) })),
      settings: normalizeSettings(options.settings, width, height),
      history: [],
      future: [],
      activeMaskId: null,
      presetState: null,
      liveBrush: null,
      analysis: null,
      copyIndex: options.copyIndex || 0,
    };
    ensureActiveMask(photo);
    return photo;
  });
}

/* ---------- Nạp file / thư mục ---------- */

async function startNewSessionIfNeeded() {
  if (state.storedSession && !state.photos.length) {
    await storage.clearSession().catch(() => {});
    state.storedSession = null;
    el.restoreCard.hidden = true;
  }
}

async function addPhotos(entries, label) {
  setStatus(`Đang mở ${entries.length} ảnh…`);
  const added = [];
  const failed = [];
  let first = true;
  for (const [i, entry] of entries.entries()) {
    try {
      const photo = await createPhoto(entry.file, entry.options);
      state.photos.push(photo);
      added.push(photo);
      if (photo.source.kind === "file") storage.saveFile(photo.id, photo.file).catch(() => {});
      markDirty(photo);
      renderFilmstrip();
      setStatus(`Đang mở ${i + 1}/${entries.length} ảnh…`);
      if (first) { first = false; activatePhoto(photo.id); }
    } catch (error) {
      failed.push(error);
    }
  }
  if (failed.length) showToast(failed.length === 1 && !added.length ? failed[0].message : `Đã thêm ${added.length} ảnh, ${failed.length} ảnh không mở được.`);
  else showToast(label || `Đã thêm ${added.length} ảnh.`);
  setStatus(added.length ? "Ảnh được xử lý cục bộ" : "Sẵn sàng");
  return added;
}

export async function loadFiles(files) {
  const accepted = [...files].filter((f) => (f.type ? f.type.startsWith("image/") : IMAGE_EXT.test(f.name)));
  if (!accepted.length) { showToast("Vui lòng chọn ảnh JPG, PNG hoặc WebP."); return []; }
  await startNewSessionIfNeeded();
  el.fileInput.value = "";
  return addPhotos(accepted.map((file) => ({ file, options: {} })));
}

export const folderSupported = () => "showDirectoryPicker" in window;

/** Mở cả thư mục ảnh. Thiết lập được lưu vào file "<tên ảnh>.luma.json" ngay cạnh ảnh gốc. */
export async function openFolder() {
  if (!folderSupported()) { showToast("Trình duyệt này chưa hỗ trợ mở thư mục. Hãy dùng Chrome hoặc Edge."); return; }
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: "luma-folder", mode: "readwrite", startIn: "pictures" });
  } catch (error) {
    if (error.name !== "AbortError") showToast("Không mở được thư mục.");
    return;
  }
  await openFolderHandle(handle);
}

/** Mở từ một FileSystemDirectoryHandle (thư mục người dùng chọn, hoặc OPFS khi kiểm thử). */
export async function openFolderHandle(handle) {
  await startNewSessionIfNeeded();
  const permission = await handle.queryPermission?.({ mode: "readwrite" });
  const writable = permission === undefined || permission === "granted";
  const key = `${handle.name}-${uid().slice(0, 8)}`;
  state.folders.set(key, { handle, writable });
  const files = [];
  const sidecars = new Map();
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== "file") continue;
    if (IMAGE_EXT.test(name)) files.push(name);
    else if (name.endsWith(".luma.json")) sidecars.set(name.slice(0, -".luma.json".length), entry);
  }
  files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!files.length) { showToast(`Thư mục “${handle.name}” không có ảnh JPG, PNG hoặc WebP.`); return; }
  const entries = [];
  let restored = 0;
  for (const name of files) {
    const file = await (await handle.getFileHandle(name)).getFile();
    let data = null;
    if (sidecars.has(name)) {
      try { data = JSON.parse(await (await sidecars.get(name).getFile()).text()); restored += 1; } catch { data = null; }
    }
    entries.push({
      file,
      options: {
        source: { kind: "folder", folderKey: key, fileName: name },
        settings: data?.settings,
        rating: data?.rating,
        flag: data?.flag,
        snapshots: data?.snapshots,
      },
    });
  }
  storage.saveFolder(key, handle).catch(() => {});
  updateFolderChip();
  await addPhotos(entries, `Đã mở ${files.length} ảnh từ “${handle.name}”${restored ? ` · khôi phục thiết lập của ${restored} ảnh` : ""}.`);
}

export function updateFolderChip() {
  const folders = [...state.folders.values()];
  el.folderChip.hidden = !folders.length;
  if (!folders.length) return;
  const writable = folders.some((f) => f.writable);
  el.folderChipName.textContent = folders.map((f) => f.handle.name).join(", ");
  el.sidecarToggle.checked = state.sidecarEnabled && writable;
  el.sidecarToggle.disabled = !writable;
  el.folderChip.title = writable
    ? "Thiết lập được lưu vào file .luma.json cạnh từng ảnh"
    : "Thư mục chỉ đọc – thiết lập chỉ được lưu trong trình duyệt";
}

/** Ghi file thiết lập đi kèm cho ảnh mở từ thư mục. */
export async function writeSidecar(photo) {
  if (photo.source.kind !== "folder" || photo.copyIndex || !state.sidecarEnabled) return;
  const folder = state.folders.get(photo.source.folderKey);
  if (!folder?.writable) return;
  const payload = {
    format: "luma-sidecar",
    version: 1,
    image: photo.source.fileName,
    savedAt: new Date().toISOString(),
    rating: photo.rating,
    flag: photo.flag,
    settings: serializeSettings(photo.settings),
    snapshots: photo.snapshots.map((s) => ({ id: s.id, name: s.name, createdAt: s.createdAt, settings: serializeSettings(s.settings) })),
  };
  const handle = await folder.handle.getFileHandle(`${photo.source.fileName}.luma.json`, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(payload));
  await writable.close();
}

/* ---------- Mở ảnh ---------- */

let activationToken = 0;
export async function activatePhoto(id) {
  const photo = state.photos.find((p) => p.id === id);
  if (!photo) return;
  if (state.tool === "crop") finishCrop(true);
  if (state.tool) setTool(null);
  const token = ++activationToken;
  state.activeId = id;
  resetView();
  el.emptyState.hidden = true;
  el.filmstripSection.hidden = false;
  el.fileName.textContent = photo.name;
  el.fileName.title = photo.name;
  updateDimensions();
  onPhotoActivated(photo);
  renderFilmstrip();
  markDirty(photo);
  document.querySelector(`.thumb-card[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (!photo.bitmap) {
    setStatus("Đang giải mã ảnh…");
    try { await ensureBitmap(photo); } catch { showToast(`${photo.name}: không thể đọc ảnh.`); return; }
    if (token !== activationToken) return;
    setStatus("Ảnh được xử lý cục bộ");
  }
  el.editorCanvas.hidden = false;
  el.imageFrame.hidden = false;
  touch(photo);
  scheduleRender();
}

export function showEmptyState() {
  state.activeId = null;
  el.emptyState.hidden = false;
  el.editorCanvas.hidden = true;
  el.imageFrame.hidden = true;
  el.fileName.textContent = "Chưa có ảnh";
  el.fileDimensions.textContent = "—";
  onNoPhoto();
}

/* ---------- Bỏ ảnh, bản sao ảo ---------- */

const fileOwner = (photo) => photo.fileRef || photo.id;

export function removePhoto(id) {
  const index = state.photos.findIndex((p) => p.id === id);
  if (index < 0) return;
  const [photo] = state.photos.splice(index, 1);
  const wasActive = state.activeId === id;
  let finalized = false;
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    const owner = fileOwner(photo);
    const fileStillUsed = state.photos.some((p) => fileOwner(p) === owner);
    if (!fileStillUsed) URL.revokeObjectURL(photo.thumbUrl);
    releaseBitmap(photo);
    storage.deletePhotos([photo.id], { keepFile: fileStillUsed }).catch(() => {});
    // Nếu bản chính bị bỏ nhưng bản sao còn: chuyển file sang bản sao đầu tiên
    if (fileStillUsed && owner === photo.id) {
      const heir = state.photos.find((p) => p.fileRef === photo.id);
      if (heir) {
        for (const p of state.photos) if (p.fileRef === photo.id) p.fileRef = p === heir ? null : heir.id;
        storage.saveFile(heir.id, heir.file).catch(() => {});
        markDirty(heir);
      }
    }
  };
  if (wasActive) {
    const next = state.photos[Math.min(index, state.photos.length - 1)];
    if (next) activatePhoto(next.id);
    else showEmptyState();
  }
  renderFilmstrip();
  const timer = setTimeout(finalize, 7000);
  showToast(`Đã bỏ ${photo.name} khỏi phiên.`, {
    label: "Hoàn tác",
    run: () => {
      if (finalized) return;
      clearTimeout(timer);
      state.photos.splice(index, 0, photo);
      renderFilmstrip();
      activatePhoto(photo.id);
    },
  }, 6500);
  markDirty(state.photos[0] || photo);
}

export function createVirtualCopy(photo = activePhoto()) {
  if (!photo) return;
  const owner = fileOwner(photo);
  const siblings = state.photos.filter((p) => fileOwner(p) === owner);
  const copyIndex = Math.max(...siblings.map((p) => p.copyIndex || 0)) + 1;
  const baseName = state.photos.find((p) => p.id === owner)?.name || photo.name;
  const copy = {
    ...photo,
    id: uid(),
    fileRef: owner,
    name: `${baseName} (bản sao ${copyIndex})`,
    copyIndex,
    bitmap: null,
    decoding: null,
    analysis: null,
    liveBrush: null,
    presetState: null,
    pinned: false,
    settings: cloneSettings(photo.settings),
    snapshots: [],
    history: [],
    future: [],
    activeMaskId: null,
    selected: true,
  };
  state.photos.splice(state.photos.indexOf(photo) + 1, 0, copy);
  markDirty(copy);
  activatePhoto(copy.id);
  showToast(`Đã tạo bản sao ảo của ${baseName}.`);
}

/* ---------- Sao & cờ ---------- */

export function setRating(photos, rating) {
  for (const p of photos) { p.rating = rating; markDirty(p); }
  renderFilmstrip();
  if (photos.length) showToast(rating ? `Đã gắn ${"★".repeat(rating)} cho ${photos.length} ảnh.` : `Đã bỏ sao cho ${photos.length} ảnh.`);
}

export function setFlag(photos, flag) {
  for (const p of photos) { p.flag = flag; markDirty(p); }
  renderFilmstrip();
  const label = flag === 1 ? "Đã gắn cờ chọn" : flag === -1 ? "Đã đánh dấu loại" : "Đã bỏ cờ";
  if (photos.length) showToast(`${label} cho ${photos.length} ảnh.`);
}

/** Khôi phục ảnh từ bản ghi phiên. */
export async function restorePhotos(records, filesById) {
  const photos = [];
  for (const rec of records) {
    const file = rec.source?.kind === "folder" ? filesById.get(rec.id) : filesById.get(rec.fileRef || rec.id);
    if (!file) continue;
    try {
      const f = file instanceof File ? file : new File([file], rec.name, { type: rec.type || file.type });
      const photo = await createPhoto(f, { ...rec, settings: rec.settings });
      photo.name = rec.name;
      photos.push(photo);
      state.photos.push(photo);
      renderFilmstrip();
    } catch {
      // bỏ qua ảnh không đọc được
    }
  }
  return photos;
}

export { settingsChanged, updateFilmstripBadges };
