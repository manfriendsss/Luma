// Chế độ xem Lưới (lọc ảnh nhanh) và So sánh (2–4 ảnh cạnh nhau), cùng dịch vụ tạo thumbnail đã chỉnh.
import { state, el, activePhoto, showToast, scheduleRender, onSettingsChanged } from "./core.js";
import { visiblePhotos, selectedPhotos, isEdited, passesFilter } from "./filmstrip.js";
import { activatePhoto, setRating, setFlag, ensureBitmap, releaseBitmap } from "./photos.js";
import { finishCrop, setTool } from "./view.js";
import { runTask, workerReady } from "./worker-client.js";
import { renderPreviewBlob, decodeBlob } from "./render-tasks.js";
import { Renderer } from "./renderer.js";

/* ============================================================
   Thumbnail đã áp thiết lập
   ============================================================ */

let fallbackRenderer = null;
function localRenderer() {
  if (!fallbackRenderer) fallbackRenderer = new Renderer(document.createElement("canvas"));
  fallbackRenderer.lutResolver = (ref) => state.luts.get(ref.id) || null;
  return fallbackRenderer;
}

function hashString(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Khoá nội dung của thiết lập (dữ liệu cọ tính theo phiên bản) + LUT có sẵn hay không. */
export function settingsKey(settings) {
  const masks = settings.masks.map((m) => ({ ...m, brush: m.brush ? m.brush.version ?? 1 : null }));
  const lutReady = settings.lut ? state.luts.has(settings.lut.id) : false;
  return hashString(JSON.stringify([settings.values, settings.curve, settings.grade, settings.crop, settings.disabled, settings.lut, lutReady, masks]));
}

/** Bản sao thiết lập gửi được sang worker (chỉ dữ liệu thuần). */
function plainSettings(settings) {
  return { ...settings, masks: settings.masks.map((m) => ({ ...m, brush: m.brush ? { width: m.brush.width, height: m.brush.height, data: m.brush.data, version: m.brush.version } : null })) };
}

const lutFor = (settings) => (settings.lut ? state.luts.get(settings.lut.id) || null : null);

async function renderPreview(photo, source, maxSide) {
  const payload = { source, photoWidth: photo.width, settings: plainSettings(photo.settings), maskSize: photo.maskSize, maxSide, lut: lutFor(photo.settings) };
  if (workerReady()) {
    try { return (await runTask("preview", payload).promise).blob; } catch { /* rơi về luồng chính */ }
  }
  const bitmap = source === photo.file && photo.bitmap ? photo.bitmap : await decodeBlob(source);
  try {
    return (await renderPreviewBlob(localRenderer(), { bitmap, photoWidth: photo.width, settings: photo.settings, maskSize: photo.maskSize, maxSide })).blob;
  } finally {
    if (bitmap !== photo.bitmap) bitmap.close?.();
  }
}

const previewQueue = new Set();
let previewRunning = false;

function updateThumbImages(photo) {
  const url = photo.previewUrl || photo.thumbUrl;
  document.querySelectorAll(`[data-id="${CSS.escape(photo.id)}"] img[data-thumb]`).forEach((img) => { if (img.src !== url) img.src = url; });
}

async function processPreviews() {
  if (previewRunning) return;
  previewRunning = true;
  try {
    while (previewQueue.size) {
      const id = previewQueue.values().next().value;
      previewQueue.delete(id);
      const photo = state.photos.find((p) => p.id === id);
      if (!photo?.thumbBlob) continue;
      const key = settingsKey(photo.settings);
      if (photo.previewKey === key) continue;
      if (!isEdited(photo)) {
        if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
        photo.previewUrl = null;
        photo.previewKey = key;
        updateThumbImages(photo);
        continue;
      }
      try {
        const blob = await renderPreview(photo, photo.thumbBlob, 360);
        if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
        photo.previewUrl = URL.createObjectURL(blob);
        photo.previewKey = key;
        updateThumbImages(photo);
      } catch {
        photo.previewKey = key; // không thử lại liên tục
      }
      if (state.exporting) await new Promise((r) => setTimeout(r, 400));
    }
  } finally {
    previewRunning = false;
  }
}

/** Xếp hàng tạo lại thumbnail cho các ảnh có thiết lập thay đổi. */
export function refreshPreviews(photos = state.photos) {
  for (const p of photos) if (p.thumbBlob && p.previewKey !== settingsKey(p.settings)) previewQueue.add(p.id);
  clearTimeout(refreshPreviews.timer);
  refreshPreviews.timer = setTimeout(processPreviews, 500);
}

/* ============================================================
   Chế độ xem
   ============================================================ */

export function setViewMode(mode) {
  if (!["loupe", "grid", "survey"].includes(mode)) mode = "loupe";
  if (mode !== "loupe" && !state.photos.length) return;
  if (mode !== "loupe" && state.tool === "crop") finishCrop(true);
  if (mode !== "loupe" && state.tool) setTool(null);
  state.viewMode = mode;
  document.querySelectorAll("[data-view-mode]").forEach((b) => {
    const active = b.dataset.viewMode === mode;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  });
  const stage = el.canvasViewport.closest(".stage-panel");
  stage.classList.toggle("view-grid", mode === "grid");
  stage.classList.toggle("view-survey", mode === "survey");
  el.canvasViewport.hidden = mode !== "loupe";
  el.gridView.hidden = mode !== "grid";
  el.surveyView.hidden = mode !== "survey";
  if (mode === "grid") { renderGrid(); refreshPreviews(); requestAnimationFrame(() => focusActiveCard()); }
  if (mode === "survey") renderSurvey();
  if (mode === "loupe") {
    const photo = activePhoto();
    if (photo) activatePhoto(photo.id);
    scheduleRender();
  }
}

/* ---------- Lưới ---------- */

function starButtons(photo) {
  const wrap = document.createElement("span");
  wrap.className = "grid-stars";
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `grid-star${photo.rating >= i ? " on" : ""}`;
    b.textContent = "★";
    b.tabIndex = -1;
    b.setAttribute("aria-label", `${i} sao`);
    b.addEventListener("click", (e) => { e.stopPropagation(); setRating([photo], photo.rating === i ? 0 : i); });
    wrap.appendChild(b);
  }
  return wrap;
}

export function renderGrid() {
  if (state.viewMode !== "grid") return;
  const list = el.gridList;
  const photos = visiblePhotos();
  list.replaceChildren();
  el.gridEmpty.hidden = photos.length > 0;
  for (const photo of photos) {
    const card = document.createElement("div");
    card.className = `grid-card${photo.id === state.activeId ? " active" : ""}${photo.flag === -1 ? " rejected" : ""}${photo.selected ? " selected" : ""}`;
    card.dataset.id = photo.id;
    card.setAttribute("role", "option");
    card.setAttribute("aria-selected", String(photo.id === state.activeId));
    card.title = photo.name;
    const frame = document.createElement("div");
    frame.className = "grid-thumb";
    const img = document.createElement("img");
    img.dataset.thumb = "";
    img.src = photo.previewUrl || photo.thumbUrl;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    frame.appendChild(img);
    if (photo.flag) {
      const flag = document.createElement("span");
      flag.className = `grid-flag ${photo.flag === 1 ? "pick" : "reject"}`;
      flag.textContent = photo.flag === 1 ? "⚑" : "✕";
      frame.appendChild(flag);
    }
    if (isEdited(photo)) {
      const dot = document.createElement("span");
      dot.className = "thumb-edited";
      dot.title = "Đã chỉnh sửa";
      frame.appendChild(dot);
    }
    const meta = document.createElement("div");
    meta.className = "grid-meta";
    const name = document.createElement("span");
    name.className = "grid-name";
    name.textContent = photo.name;
    meta.append(name, starButtons(photo));
    card.append(frame, meta);
    card.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey) { photo.selected = !photo.selected; renderGrid(); return; }
      activatePhoto(photo.id);
    });
    card.addEventListener("dblclick", () => { activatePhoto(photo.id); setViewMode("loupe"); });
    list.appendChild(card);
  }
}

function focusActiveCard() {
  const card = el.gridList.querySelector(".grid-card.active");
  card?.scrollIntoView({ block: "nearest" });
}

function gridColumns() {
  const cards = [...el.gridList.querySelectorAll(".grid-card")];
  if (cards.length < 2) return 1;
  const top = cards[0].offsetTop;
  const n = cards.findIndex((c) => c.offsetTop !== top);
  return n < 0 ? cards.length : n;
}

/** Phím mũi tên / Enter trong lưới. Trả về true nếu đã xử lý. */
export function handleGridKey(event) {
  if (state.viewMode !== "grid") return false;
  const list = visiblePhotos();
  const index = list.findIndex((p) => p.id === state.activeId);
  const cols = gridColumns();
  const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[event.key];
  if (move) {
    event.preventDefault();
    const next = list[Math.min(list.length - 1, Math.max(0, (index < 0 ? 0 : index + move)))];
    if (next) activatePhoto(next.id);
    return true;
  }
  if (event.key === "Enter") { event.preventDefault(); setViewMode("loupe"); return true; }
  return false;
}

/* ---------- So sánh nhiều ảnh ---------- */

const surveyCache = new Map(); // photoId → { key, url }
let surveyToken = 0;

export function surveyPhotos() {
  const chosen = selectedPhotos().filter((p) => passesFilter(p));
  const active = activePhoto();
  const list = chosen.length >= 2 ? chosen : [];
  if (active && list.length && !list.includes(active)) list.unshift(active);
  return list.slice(0, 4);
}

export async function renderSurvey() {
  if (state.viewMode !== "survey") return;
  const photos = surveyPhotos();
  const grid = el.surveyGrid;
  grid.replaceChildren();
  grid.dataset.count = String(photos.length);
  el.surveyHint.hidden = photos.length >= 2;
  if (photos.length < 2) return;
  const token = ++surveyToken;
  const cells = photos.map((photo) => {
    const cell = document.createElement("figure");
    cell.className = `survey-cell${photo.id === state.activeId ? " active" : ""}`;
    cell.dataset.id = photo.id;
    const img = document.createElement("img");
    img.alt = photo.name;
    img.src = surveyCache.get(photo.id)?.url || photo.previewUrl || photo.thumbUrl;
    const cap = document.createElement("figcaption");
    cap.innerHTML = '<span class="survey-name"></span><span class="survey-stars"></span>';
    cap.querySelector(".survey-name").textContent = photo.name;
    cap.querySelector(".survey-stars").textContent = photo.rating ? "★".repeat(photo.rating) : "";
    cell.append(img, cap);
    cell.addEventListener("click", () => { activatePhoto(photo.id); grid.querySelectorAll(".survey-cell").forEach((c) => c.classList.toggle("active", c === cell)); });
    cell.addEventListener("dblclick", () => { activatePhoto(photo.id); setViewMode("loupe"); });
    grid.appendChild(cell);
    return { photo, cell, img };
  });
  await new Promise((r) => requestAnimationFrame(r));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const { photo, cell, img } of cells) {
    if (token !== surveyToken) return;
    const maxSide = Math.min(2000, Math.round(Math.max(cell.clientWidth, cell.clientHeight) * dpr));
    const key = `${settingsKey(photo.settings)}:${maxSide}`;
    const cached = surveyCache.get(photo.id);
    if (cached?.key === key) { img.src = cached.url; continue; }
    cell.classList.add("loading");
    try {
      let blob;
      if (workerReady()) blob = await renderPreview(photo, photo.file, maxSide);
      else {
        const wasResident = !!photo.bitmap;
        photo.pinned = true;
        try { await ensureBitmap(photo); blob = await renderPreview(photo, photo.file, maxSide); } finally {
          photo.pinned = false;
          if (!wasResident && photo.id !== state.activeId) releaseBitmap(photo);
        }
      }
      if (cached) URL.revokeObjectURL(cached.url);
      const url = URL.createObjectURL(blob);
      surveyCache.set(photo.id, { key, url });
      if (token === surveyToken) img.src = url;
    } catch {
      showToast(`${photo.name}: không render được ảnh so sánh.`);
    } finally {
      cell.classList.remove("loading");
    }
  }
}

export function initGridView() {
  document.querySelectorAll("[data-view-mode]").forEach((b) => b.addEventListener("click", () => setViewMode(b.dataset.viewMode)));
  el.gridSizeRange.addEventListener("input", () => el.gridList.style.setProperty("--grid-size", `${el.gridSizeRange.value}px`));
  el.gridList.style.setProperty("--grid-size", `${el.gridSizeRange.value}px`);
  let resizeTimer = null;
  new ResizeObserver(() => {
    if (state.viewMode !== "survey") return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderSurvey, 250);
  }).observe(el.surveyView);
  onSettingsChanged(() => {
    if (state.viewMode === "survey") { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderSurvey, 400); }
  });
}
