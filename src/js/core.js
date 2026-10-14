// Trạng thái dùng chung, tiện ích giao diện và lịch sử chỉnh sửa (có nhãn cho bảng Lịch sử).
import { HISTORY_LIMIT, settingGroups } from "./config.js";
import { cloneSettings, settingsEqual } from "./settings.js";

export const state = {
  photos: [],
  activeId: null,
  previewMode: "after",
  holdingBefore: false,
  splitPos: 0.5,
  view: { fit: true, scale: 1, panX: 0, panY: 0 },
  tool: null, // null | "crop" | "eyedropper" | "range-picker"
  cropSession: null,
  cropGrid: "thirds",
  showMaskOverlay: false,
  clipping: false,
  clipboard: null,
  syncGroups: settingGroups.filter((g) => !["crop", "masks", "transform"].includes(g.id)).map((g) => g.id),
  drawerOpen: false,
  panelOpen: false,
  curveChannel: "master",
  spaceDown: false,
  gesture: null,
  exporting: null,
  storedSession: null,
  lastPointer: null,
  layout: null,
  previewSettings: null, // preset đang rê chuột → xem trước trên ảnh lớn
  previewLabel: "",
  filter: "all",
  selectionAnchor: null,
  folders: new Map(), // key → { handle, writable }
  sidecarEnabled: true,
  renderer: null,
  luts: new Map(), // id → { id, name, size, data, domainMin, domainMax }
  viewMode: "loupe", // "loupe" | "grid" | "survey"
  compareRef: null,
  showGuideGrid: false, // { label, settings } – mốc so sánh thay cho ảnh gốc
  capabilities: { worker: false, avif: false },
};

export const $ = (id) => document.getElementById(id);
export const el = new Proxy({}, { get: (cache, id) => cache[id] || (cache[id] = $(id)) });
export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/* ---------- Đăng ký hàm giữa các module (tránh phụ thuộc vòng khi khởi tạo) ---------- */
export const hooks = {
  settingsChanged: [],
  historyChanged: [],
  markDirty: () => {},
  scheduleRender: () => {},
  setPreviewMode: null,
};
export const onSettingsChanged = (fn) => hooks.settingsChanged.push(fn);
export const scheduleRender = () => hooks.scheduleRender();
export const markDirty = (photo) => hooks.markDirty(photo);

export const activePhoto = () => state.photos.find((p) => p.id === state.activeId) || null;
export const activeMask = (photo = activePhoto()) => photo?.settings.masks.find((m) => m.id === photo.activeMaskId) || null;

export function editingText() {
  const a = document.activeElement;
  return !!a && (a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable || (a.tagName === "INPUT" && !["range", "checkbox", "button", "radio"].includes(a.type)));
}

/** Phím tắt điều hướng (mũi tên, Delete…) chỉ chạy khi tiêu điểm không nằm trong một widget tự xử lý phím. */
export function focusOwnsKeys() {
  const a = document.activeElement;
  if (!a || a === document.body) return false;
  if (a.tagName === "INPUT" || a.tagName === "SELECT" || a.tagName === "TEXTAREA" || a.tagName === "CANVAS") return true;
  const role = a.getAttribute("role");
  if (role && ["slider", "menu", "menuitem", "listbox", "tab", "spinbutton"].includes(role)) return true;
  return !!a.closest("dialog, .menu-popover");
}

let toastTimer = null;
export function showToast(message, action = null, duration = 3200) {
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

export function setStatus(text) { el.renderStatus.textContent = text; }

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function safeLocalStorage(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

export const slug = (name) => name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "preset";
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/* ============================================================
   Lịch sử: mỗi bước = { settings, label }
   ============================================================ */

function notifyHistory(photo) { for (const fn of hooks.historyChanged) fn(photo); }

export function pushHistory(photo, snapshot, label = "Chỉnh sửa") {
  if (!photo || !snapshot) return;
  photo.history.push({ settings: snapshot, label });
  if (photo.history.length > HISTORY_LIMIT) photo.history.shift();
  photo.future = [];
  notifyHistory(photo);
}

/** Ghi lại trạng thái trước một thao tác rời rạc. */
export function record(photo = activePhoto(), label) {
  if (photo) pushHistory(photo, cloneSettings(photo.settings), label);
}

/** Bắt đầu một cử chỉ (kéo thanh trượt, vẽ…): chỉ ghi lịch sử nếu có thay đổi thật. */
export function beginGesture(photo = activePhoto(), label = "Chỉnh sửa") {
  if (!photo) return null;
  return { photoId: photo.id, snapshot: cloneSettings(photo.settings), label };
}

export function endGesture(gesture, label) {
  if (!gesture) return false;
  const photo = state.photos.find((p) => p.id === gesture.photoId);
  if (!photo) return false;
  if (!settingsEqual(gesture.snapshot, photo.settings)) {
    pushHistory(photo, gesture.snapshot, label || gesture.label);
    markDirty(photo);
    return true;
  }
  return false;
}

export function ensureActiveMask(photo) {
  if (photo.activeMaskId && !photo.settings.masks.some((m) => m.id === photo.activeMaskId)) photo.activeMaskId = null;
}

export function settingsChanged(photo = activePhoto(), options = {}) {
  if (!photo) return;
  if (options.save !== false) markDirty(photo);
  for (const fn of hooks.settingsChanged) fn(photo, options);
}

export const currentLabel = (photo) => photo.history.at(-1)?.label ?? "Trạng thái đầu";

export function undo(photo = activePhoto(), { silent = false } = {}) {
  if (!photo || !photo.history.length || state.tool === "crop") return false;
  const step = photo.history.pop();
  photo.future.push({ settings: cloneSettings(photo.settings), label: step.label });
  photo.settings = step.settings;
  photo.presetState = null;
  ensureActiveMask(photo);
  if (!silent) { settingsChanged(photo); notifyHistory(photo); showToast(`Đã hoàn tác: ${step.label}.`); }
  return true;
}

export function redo(photo = activePhoto(), { silent = false } = {}) {
  if (!photo || !photo.future.length || state.tool === "crop") return false;
  const step = photo.future.pop();
  photo.history.push({ settings: cloneSettings(photo.settings), label: step.label });
  photo.settings = step.settings;
  photo.presetState = null;
  ensureActiveMask(photo);
  if (!silent) { settingsChanged(photo); notifyHistory(photo); showToast(`Đã làm lại: ${step.label}.`); }
  return true;
}

/** Nhảy tới một bước: steps < 0 = lùi, > 0 = tiến. */
export function stepHistory(photo, steps) {
  if (!photo) return;
  let moved = false;
  for (let i = 0; i < Math.abs(steps); i++) moved = (steps < 0 ? undo(photo, { silent: true }) : redo(photo, { silent: true })) || moved;
  if (moved) { settingsChanged(photo); notifyHistory(photo); }
}
