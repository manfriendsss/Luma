// Hộp thoại dùng chung, menu "Thiết lập" và Sao chép / Dán / Đồng bộ thiết lập.
import { settingGroups } from "./config.js";
import { cloneSettings, mergeSettingGroups } from "./settings.js";
import { fitCropInside } from "./geometry.js";
import { state, el, activePhoto, pushHistory, ensureActiveMask, settingsChanged, showToast, undo } from "./core.js";
import { selectedPhotos, updateFilmstripBadges } from "./filmstrip.js";
import { updateActionButtons } from "./panel.js";

/** Hộp thoại nhập tên (không dùng prompt() vì chặn luồng). */
export function askName(title, initial = "", label = "Tên preset") {
  return new Promise((resolve) => {
    el.nameDialogTitle.textContent = title;
    el.nameLabel.textContent = label;
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

/* ---------- Menu Thiết lập ---------- */

export function toggleMenu(open = el.settingsMenu.hidden) {
  el.settingsMenu.hidden = !open;
  el.settingsMenuButton.setAttribute("aria-expanded", String(open));
  if (open) {
    const r = el.settingsMenuButton.getBoundingClientRect();
    el.settingsMenu.style.top = `${r.bottom + 6}px`;
    el.settingsMenu.style.left = `${Math.max(8, Math.min(window.innerWidth - 300, r.left))}px`;
    el.settingsMenu.querySelector("[role=menuitem]:not(:disabled)")?.focus();
  }
}

function initMenu() {
  el.settingsMenuButton.addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(); });
  el.settingsMenu.addEventListener("click", (e) => { if (e.target.closest("[role=menuitem]")) toggleMenu(false); });
  document.addEventListener("pointerdown", (e) => {
    if (!el.settingsMenu.hidden && !el.settingsMenu.contains(e.target) && e.target !== el.settingsMenuButton) toggleMenu(false);
  });
  el.settingsMenu.addEventListener("keydown", (e) => {
    const items = [...el.settingsMenu.querySelectorAll("[role=menuitem]:not(:disabled)")];
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    if (e.key === "Escape") { e.preventDefault(); toggleMenu(false); el.settingsMenuButton.focus(); }
    if (e.key === "Tab") toggleMenu(false);
  });
}

/* ---------- Sao chép / dán / đồng bộ ---------- */

export function openSettingsDialog(mode) {
  const photo = activePhoto();
  if (!photo) return;
  const targets = selectedPhotos().filter((p) => p.id !== photo.id);
  if (mode === "sync" && !targets.length) { showToast("Hãy chọn thêm ảnh trong filmstrip (ô ✓ hoặc Ctrl + bấm) để đồng bộ."); return; }
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
    const text = document.createElement("span");
    text.textContent = group.label;
    label.append(input, text);
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
    const targets = selectedPhotos().filter((p) => p.id !== photo.id);
    for (const target of targets) applySettingsTo(target, photo.settings, { width: photo.width, height: photo.height }, groups, `Đồng bộ từ ${photo.name}`);
    showToast(`Đã đồng bộ sang ${targets.length} ảnh.`);
    updateFilmstripBadges();
  }
}

export function applySettingsTo(target, sourceSettings, sourceSize, groups, label = "Dán thiết lập") {
  pushHistory(target, cloneSettings(target.settings), label);
  const merged = mergeSettingGroups(target.settings, { ...sourceSettings, __size: sourceSize }, groups, { width: target.width, height: target.height });
  merged.crop = fitCropInside(merged.crop, target.width, target.height);
  if (groups.includes("masks")) merged.disabled = { ...merged.disabled, masks: !!sourceSettings.disabled?.masks };
  target.settings = merged;
  target.presetState = null;
  ensureActiveMask(target);
  settingsChanged(target);
}

export function pasteSettings() {
  const photo = activePhoto();
  if (!photo || !state.clipboard) return;
  applySettingsTo(photo, state.clipboard.settings, state.clipboard.size, state.clipboard.groups);
  showToast("Đã dán thiết lập.", { label: "Hoàn tác", run: () => undo() });
}

export function copyPreviousSettings() {
  const photo = activePhoto();
  const index = state.photos.indexOf(photo);
  if (!photo || index <= 0) return;
  const previous = state.photos[index - 1];
  applySettingsTo(photo, previous.settings, { width: previous.width, height: previous.height }, settingGroups.map((g) => g.id), `Sao chép từ ${previous.name}`);
  showToast(`Đã sao chép thiết lập từ ${previous.name}.`, { label: "Hoàn tác", run: () => undo() });
}

export function initDialogs() {
  initMenu();
  el.settingsForm.addEventListener("submit", (event) => { if (event.submitter?.value === "default") confirmSettingsDialog(); });
  el.settingsGroupList.addEventListener("change", updateGroupToggle);
  el.toggleAllGroupsButton.addEventListener("click", () => {
    const boxes = [...el.settingsGroupList.querySelectorAll("input")];
    const all = boxes.every((b) => b.checked);
    boxes.forEach((b) => { b.checked = !all; });
    updateGroupToggle();
  });
}
