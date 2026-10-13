// Ngăn preset bên trái: xem trước trên ảnh lớn khi rê chuột, cường độ, lưu/đổi tên/xoá/nhập/xuất.
import { builtInPresets, valueDefaults, controlById } from "./config.js";
import { defaultCurve, cloneSettings, cloneCurve, cloneGrade, settingsEqual } from "./settings.js";
import { blendCurvePoints } from "./curve.js";
import { parseLightroomPreset, presetToLumaJson, presetToXmp, migrateStoredPreset } from "./presets.js";
import { setRangeProgress } from "./controls.js";
import {
  state, el, clamp, activePhoto, record, beginGesture, endGesture, settingsChanged, showToast,
  scheduleRender, downloadBlob, safeLocalStorage, slug,
} from "./core.js";
import { askName } from "./dialogs.js";
import { syncAllControls } from "./panel.js";

const PRESET_STORAGE_KEY = "lumaPresets.v2";
const LEGACY_PRESET_KEY = "lumaImportedPresets";
let userPresets = loadUserPresets();

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

export const allPresets = () => [...builtInPresets, ...userPresets];
export const presetById = (id) => allPresets().find((p) => p.id === id) || null;

/** Áp preset lên thiết lập nền với cường độ amount (0..1.5). */
export function applyPresetSettings(base, preset, amount = 1) {
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

const presetBase = (photo) => (photo.presetState && settingsEqual(photo.settings, photo.presetState.result) ? photo.presetState.base : photo.settings);

export function applyPreset(id) {
  const photo = activePhoto();
  const preset = presetById(id);
  if (!photo || !preset) return;
  const base = cloneSettings(presetBase(photo));
  record(photo, `Preset ${preset.name}`);
  photo.settings = applyPresetSettings(base, preset, 1);
  photo.presetState = { presetId: id, base, amount: 1, result: cloneSettings(photo.settings) };
  clearPreview();
  settingsChanged(photo);
  renderPresetList();
}

export function setActivePresetMark() {
  const photo = activePhoto();
  document.querySelectorAll(".preset-list-item").forEach((item) => {
    const active = item.dataset.preset === photo?.settings.preset;
    item.classList.toggle("active", active);
    const mark = item.querySelector(".preset-current-mark");
    if (mark) mark.textContent = active ? "✓" : "";
  });
  updatePresetAmount();
}

export function updatePresetAmount() {
  const photo = activePhoto();
  const ps = photo?.presetState;
  const enabled = !!(ps && photo.settings.preset === ps.presetId);
  el.presetAmountRange.disabled = !enabled;
  const amount = enabled ? Math.round(ps.amount * 100) : 100;
  el.presetAmountRange.value = amount;
  el.presetAmountValue.textContent = `${amount}%`;
  setRangeProgress(el.presetAmountRange);
  el.presetCurrentName.textContent = presetById(photo?.settings.preset)?.name || (photo ? "Thiết lập riêng" : "—");
}

/* ---------- Xem trước trên ảnh lớn ---------- */

let previewTimer = null;
function previewPreset(preset) {
  const photo = activePhoto();
  clearTimeout(previewTimer);
  if (!photo || !preset) { clearPreview(); return; }
  // Trễ một chút để lướt chuột qua danh sách không làm giật
  previewTimer = setTimeout(() => {
    state.previewSettings = applyPresetSettings(cloneSettings(presetBase(photo)), preset, 1);
    state.previewLabel = preset.name;
    scheduleRender();
  }, 60);
}

export function clearPreview() {
  clearTimeout(previewTimer);
  if (!state.previewSettings) return;
  state.previewSettings = null;
  state.previewLabel = "";
  scheduleRender();
}

export function renderPresetList() {
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
      // Xem trước theo bàn phím (focus bằng Tab); xem trước theo chuột được xử lý ở cấp danh sách
      apply.addEventListener("focus", () => { if (apply.matches(":focus-visible")) previewPreset(preset); });
      apply.addEventListener("blur", () => { if (!el.presetList.matches(":hover")) clearPreview(); });
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
  updatePresetAmount();
}

const uuidHex = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").toUpperCase() : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("").toUpperCase());

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

export async function importPresetFiles(files) {
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

export function setPresetDrawer(open) {
  state.drawerOpen = open;
  el.presetDrawer.classList.toggle("open", open);
  el.presetDrawer.inert = !open;
  el.presetDrawerHandle.classList.toggle("open", open);
  el.presetDrawerHandle.setAttribute("aria-expanded", String(open));
  const label = open ? "Đóng bảng preset (Shift+T)" : "Mở bảng preset (Shift+T)";
  el.presetDrawerHandle.setAttribute("aria-label", label);
  el.presetDrawerHandle.title = label;
  if (open) {
    renderPresetList();
    el.presetList.querySelector(".preset-apply")?.focus({ preventScroll: true });
  } else {
    clearPreview();
    if (el.presetDrawer.contains(document.activeElement)) el.presetDrawerHandle.focus();
  }
  scheduleRender();
}

export function initPresets() {
  el.presetDrawerHandle.addEventListener("click", () => setPresetDrawer(!state.drawerOpen));
  el.presetDrawerClose.addEventListener("click", () => setPresetDrawer(false));
  el.importPresetButton.addEventListener("click", () => el.presetFileInput.click());
  el.presetFileInput.addEventListener("change", () => importPresetFiles(el.presetFileInput.files));
  el.savePresetButton.addEventListener("click", saveCurrentAsPreset);
  // Một bộ theo dõi con trỏ cho cả danh sách: bền vững cả khi danh sách được vẽ lại
  el.presetList.addEventListener("pointerover", (event) => {
    const item = event.target.closest?.(".preset-list-item");
    if (!item || event.target.closest(".preset-actions")) return;
    const preset = presetById(item.dataset.preset);
    if (preset && state.previewLabel !== preset.name) previewPreset(preset);
  });
  el.presetList.addEventListener("pointerleave", clearPreview);
  let amountGesture = null;
  el.presetAmountRange.addEventListener("input", () => {
    const photo = activePhoto();
    const ps = photo?.presetState;
    if (!ps) return;
    const preset = presetById(ps.presetId);
    if (!amountGesture) amountGesture = beginGesture(photo, `Cường độ ${preset?.name || "preset"}`);
    ps.amount = Number(el.presetAmountRange.value) / 100;
    photo.settings = applyPresetSettings(ps.base, preset, ps.amount);
    ps.result = cloneSettings(photo.settings);
    el.presetAmountValue.textContent = `${el.presetAmountRange.value}%`;
    setRangeProgress(el.presetAmountRange);
    syncAllControls();
    scheduleRender();
  });
  el.presetAmountRange.addEventListener("change", () => {
    endGesture(amountGesture);
    amountGesture = null;
    const photo = activePhoto();
    if (photo) settingsChanged(photo);
  });
  renderPresetList();
}
