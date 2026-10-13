// Filmstrip: chọn nhiều (Ctrl/Shift + click), sao, cờ, bộ lọc.
import { state, el, activePhoto, markDirty } from "./core.js";
import { defaultSettings, settingsEqual } from "./settings.js";
import { activatePhoto, removePhoto } from "./photos.js";
import { updateActionButtons } from "./panel.js";
import { updateExportCount } from "./export.js";

export function isEdited(photo) {
  return !settingsEqual({ ...photo.settings, preset: null }, { ...defaultSettings(photo.width, photo.height), preset: null });
}

const filters = {
  all: () => true,
  picked: (p) => p.flag === 1,
  rejected: (p) => p.flag === -1,
  unrejected: (p) => p.flag !== -1,
  edited: (p) => isEdited(p),
  unedited: (p) => !isEdited(p),
  selected: (p) => p.selected,
};

export function passesFilter(photo, filter = state.filter) {
  const stars = /^stars(\d)$/.exec(filter);
  if (stars) return photo.rating >= Number(stars[1]);
  return (filters[filter] || filters.all)(photo);
}

export const visiblePhotos = () => state.photos.filter((p) => passesFilter(p));
export const selectedPhotos = () => state.photos.filter((p) => p.selected);

/** Ảnh mà phím sao/cờ áp dụng: chỉ ảnh đang xem (ảnh mới mặc định đều được tích chọn để xuất). */
export function targetPhotos() {
  const active = activePhoto();
  return active ? [active] : [];
}

function onThumbClick(photo, event) {
  if (event.ctrlKey || event.metaKey) {
    photo.selected = !photo.selected;
    state.selectionAnchor = photo.id;
    markDirty(photo);
    renderFilmstrip();
    updateExportCount();
    return;
  }
  if (event.shiftKey && state.selectionAnchor) {
    const list = visiblePhotos();
    const a = list.findIndex((p) => p.id === state.selectionAnchor);
    const b = list.indexOf(photo);
    if (a >= 0 && b >= 0) {
      for (const p of list.slice(Math.min(a, b), Math.max(a, b) + 1)) { p.selected = true; markDirty(p); }
      renderFilmstrip();
      updateExportCount();
      return;
    }
  }
  state.selectionAnchor = photo.id;
  activatePhoto(photo.id);
}

export function renderFilmstrip() {
  const list = el.filmstripList;
  list.replaceChildren();
  const visible = visiblePhotos();
  state.photos.forEach((photo, index) => {
    if (!passesFilter(photo)) return;
    const card = document.createElement("div");
    card.className = `thumb-card${photo.id === state.activeId ? " active" : ""}${photo.selected ? " selected" : ""}${photo.flag === -1 ? " rejected" : ""}`;
    card.dataset.id = photo.id;
    card.setAttribute("role", "listitem");
    const open = document.createElement("button");
    open.type = "button";
    open.className = "thumb-open";
    open.title = `${photo.name}\nCtrl + bấm: chọn thêm · Shift + bấm: chọn một dãy`;
    open.setAttribute("aria-label", `Mở ảnh ${index + 1}: ${photo.name}`);
    if (photo.id === state.activeId) open.setAttribute("aria-current", "true");
    const img = document.createElement("img");
    img.src = photo.thumbUrl;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    const number = document.createElement("span");
    number.className = "thumb-index";
    number.textContent = photo.copyIndex ? `${index + 1}·${photo.copyIndex}` : index + 1;
    const meta = document.createElement("span");
    meta.className = "thumb-meta";
    if (photo.rating) {
      const stars = document.createElement("span");
      stars.className = "thumb-stars";
      stars.textContent = "★".repeat(photo.rating);
      stars.setAttribute("aria-label", `${photo.rating} sao`);
      meta.appendChild(stars);
    }
    if (photo.flag) {
      const flag = document.createElement("span");
      flag.className = `thumb-flag ${photo.flag === 1 ? "pick" : "reject"}`;
      flag.textContent = photo.flag === 1 ? "⚑" : "✕";
      flag.title = photo.flag === 1 ? "Được chọn" : "Bị loại";
      meta.appendChild(flag);
    }
    const edited = document.createElement("span");
    edited.className = "thumb-edited";
    edited.title = "Đã chỉnh sửa";
    edited.hidden = !isEdited(photo);
    open.append(img, number, meta, edited);
    open.addEventListener("click", (event) => onThumbClick(photo, event));
    const select = document.createElement("button");
    select.type = "button";
    select.className = "thumb-select";
    select.textContent = photo.selected ? "✓" : "";
    select.setAttribute("aria-pressed", String(photo.selected));
    select.setAttribute("aria-label", `Chọn ${photo.name} để xuất / đồng bộ`);
    select.title = photo.selected ? "Bỏ chọn" : "Chọn để xuất / đồng bộ";
    select.addEventListener("click", () => {
      photo.selected = !photo.selected;
      state.selectionAnchor = photo.id;
      markDirty(photo);
      renderFilmstrip();
      updateExportCount();
    });
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
  const selected = selectedPhotos().length;
  const total = state.photos.length;
  el.photoCount.textContent = visible.length === total ? `${total} ảnh` : `${visible.length}/${total} ảnh`;
  el.selectedCount.textContent = `${selected} được chọn`;
  el.selectAllButton.textContent = visible.length && visible.every((p) => p.selected) ? "Bỏ chọn tất cả" : "Chọn tất cả";
  el.filmstripSection.hidden = total === 0;
  el.filmstripEmpty.hidden = visible.length > 0 || total === 0;
  updateActionButtons();
}

export function updateFilmstripBadges() {
  for (const photo of state.photos) {
    const badge = document.querySelector(`.thumb-card[data-id="${CSS.escape(photo.id)}"] .thumb-edited`);
    if (badge) badge.hidden = !isEdited(photo);
  }
}

export function navigatePhoto(direction) {
  const list = visiblePhotos();
  const index = list.findIndex((p) => p.id === state.activeId);
  const next = list[index < 0 ? 0 : index + direction];
  if (next) activatePhoto(next.id);
}

export function initFilmstrip() {
  el.selectAllButton.addEventListener("click", () => {
    const list = visiblePhotos();
    const all = list.length > 0 && list.every((p) => p.selected);
    for (const p of list) { p.selected = !all; markDirty(p); }
    renderFilmstrip();
    updateExportCount();
  });
  el.filterSelect.addEventListener("change", () => {
    state.filter = el.filterSelect.value;
    renderFilmstrip();
    updateExportCount();
  });
}
