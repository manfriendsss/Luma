// Bảng điều chỉnh bên phải: ngăn kéo có tay nắm, các nhóm thanh trượt, đường cong, phân màu,
// vùng chọn, lịch sử & snapshot.
import {
  controlGroups, hslGroups, maskControlGroup, MAX_MASKS, gradeZones, maskTypes, panelSections,
} from "./config.js";
import {
  defaultCurve, defaultGrade, cloneSettings, createMask, isIdentityCurve, sectionModified, defaultRange, defaultSettings,
} from "./settings.js";
import { valueDefaults } from "./config.js";
import { outputToSource, fitPerspectiveScale } from "./geometry.js";
import { autoTone, autoWhiteBalance } from "./color.js";
import { CurveEditor, ColorWheel, drawHistogram } from "./widgets.js";
import { buildControls, setRangeProgress } from "./controls.js";
import {
  state, el, hooks, activePhoto, activeMask, record, beginGesture, endGesture, settingsChanged, showToast,
  scheduleRender, stepHistory, undo, safeLocalStorage, currentLabel, ensureActiveMask, uid, onSettingsChanged,
} from "./core.js";
import { setActivePresetMark, updatePresetAmount, renderPresetList } from "./presets-ui.js";
import { updateFilmstripBadges, selectedPhotos } from "./filmstrip.js";
import { updateDimensions, updateHistogramInfo, setTool, updateBrushCursor, warpOf, scheduleRender as viewRender } from "./view.js";
import { syncLutPanel } from "./luts-ui.js";
import { askName } from "./dialogs.js";

let controlSets = [];
let maskControlSet = null;
let rangeControlSet = null;
let curveEditor = null;
let gradeControlSet = null;
const gradeWidgets = {};

export const curveEditorRef = () => curveEditor;

/* ============================================================
   Ngăn kéo bên phải
   ============================================================ */

const PANEL_PREF = "luma.panelOpen";

export function setPanelOpen(open, { remember = true } = {}) {
  state.panelOpen = open;
  document.body.classList.toggle("panel-open", open);
  el.controlPanel.inert = !open;
  el.controlPanel.setAttribute("aria-hidden", String(!open));
  el.panelHandle.setAttribute("aria-expanded", String(open));
  const label = open ? "Đóng bảng điều chỉnh (T)" : "Mở bảng điều chỉnh (T)";
  el.panelHandle.setAttribute("aria-label", label);
  el.panelHandle.title = label;
  if (remember && state.photos.length) safeLocalStorage(() => localStorage.setItem(PANEL_PREF, open ? "1" : "0"));
  if (open) requestAnimationFrame(() => { syncCurvePanel(); syncGradePanel(); });
  // Khung ảnh đổi kích thước → ResizeObserver tự render lại
}

/** Mở/đóng theo yêu cầu người dùng; chỉ ghi nhớ lựa chọn khi đã có ảnh. */
export function togglePanel(open = !state.panelOpen) {
  if (state.photos.length) state.panelUserClosed = !open;
  setPanelOpen(open);
}

/** Khoá bảng khi chưa có ảnh: vẫn mở xem được nhưng mờ và không kéo được thanh trượt. */
function setPanelLocked(locked) {
  el.controlPanel.classList.toggle("locked", locked);
  el.panelBody.inert = locked;
  el.panelLockNote.hidden = !locked;
}

export function onPhotoActivated(photo) {
  setPanelLocked(false);
  // Trên màn hình hẹp bảng nằm đè lên ảnh → không tự mở
  if (!state.panelOpen && !state.panelUserClosed && window.innerWidth > 850) {
    const pref = safeLocalStorage(() => localStorage.getItem(PANEL_PREF), null);
    if (pref !== "0") setPanelOpen(true, { remember: false });
  }
  for (const id of ["exportButton", "zoomOutButton", "zoomInButton", "fitButton", "actualSizeButton", "cropToolButton", "clippingButton", "savePresetButton", "settingsMenuButton"]) el[id].disabled = false;
  void photo;
  syncAllControls();
  renderMaskUI();
  renderPresetList();
  renderHistoryPanel();
  updateActionButtons();
  updateHistogramInfo();
}

export function onNoPhoto() {
  setPanelLocked(true);
  setPanelOpen(false, { remember: false });
  for (const id of ["exportButton", "zoomOutButton", "zoomInButton", "fitButton", "actualSizeButton", "cropToolButton", "clippingButton", "savePresetButton"]) el[id].disabled = true;
  el.zoomValue.textContent = "—";
  drawHistogram(el.histogramCanvas, null);
  updateHistogramInfo();
  renderMaskList();
  el.maskEditor.hidden = true;
  renderHistoryPanel();
  updateActionButtons();
}

/* ============================================================
   Nhóm: dấu đã chỉnh, tạm tắt, mở một nhóm
   ============================================================ */

const SECTION_PREF = "luma.sections";
const EYE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const SOLO_PREF = "luma.soloSections";

function sectionToggle(section) { return section.querySelector(".section-toggle"); }

function saveSectionState() {
  const out = {};
  document.querySelectorAll("[data-section]").forEach((section) => {
    out[section.dataset.section] = sectionToggle(section)?.getAttribute("aria-expanded") === "true";
  });
  safeLocalStorage(() => localStorage.setItem(SECTION_PREF, JSON.stringify(out)));
}

function setSectionOpen(section, open) {
  sectionToggle(section)?.setAttribute("aria-expanded", String(open));
  if (open && section.dataset.section === "curve") syncCurvePanel();
  if (open && section.dataset.section === "grade") syncGradePanel();
}

function initSections() {
  const saved = safeLocalStorage(() => JSON.parse(localStorage.getItem(SECTION_PREF) || "{}"), {});
  const solo = safeLocalStorage(() => localStorage.getItem(SOLO_PREF) === "1", false);
  el.soloToggle.setAttribute("aria-pressed", String(solo));
  document.querySelectorAll("[data-section]").forEach((section) => {
    const key = section.dataset.section;
    if (key in saved) setSectionOpen(section, saved[key]);
    sectionToggle(section)?.addEventListener("click", (event) => {
      const open = sectionToggle(section).getAttribute("aria-expanded") !== "true";
      const soloMode = el.soloToggle.getAttribute("aria-pressed") === "true" || event.altKey;
      if (open && soloMode) document.querySelectorAll("[data-section]").forEach((s) => { if (s !== section) setSectionOpen(s, false); });
      setSectionOpen(section, open);
      saveSectionState();
    });
    const bypass = section.querySelector(".section-bypass");
    if (bypass) {
      bypass.innerHTML = EYE_ICON;
      bypass.addEventListener("click", () => toggleSectionBypass(key));
    }
  });
  el.soloToggle.addEventListener("click", () => {
    const next = el.soloToggle.getAttribute("aria-pressed") !== "true";
    el.soloToggle.setAttribute("aria-pressed", String(next));
    safeLocalStorage(() => localStorage.setItem(SOLO_PREF, next ? "1" : "0"));
    if (next) {
      const open = [...document.querySelectorAll("[data-section]")].filter((s) => sectionToggle(s)?.getAttribute("aria-expanded") === "true");
      open.slice(1).forEach((s) => setSectionOpen(s, false));
      saveSectionState();
    }
    showToast(next ? "Chế độ một nhóm: mở nhóm này sẽ tự đóng nhóm khác." : "Đã tắt chế độ một nhóm.");
  });
  el.collapseAllButton.addEventListener("click", () => {
    document.querySelectorAll("[data-section]").forEach((s) => setSectionOpen(s, false));
    saveSectionState();
  });
}

function toggleSectionBypass(sectionId) {
  const photo = activePhoto();
  if (!photo) return;
  const label = panelSections.find((s) => s.id === sectionId)?.label || sectionId;
  const disabled = !photo.settings.disabled?.[sectionId];
  record(photo, `${disabled ? "Tắt" : "Bật"} nhóm ${label}`);
  photo.settings.disabled = { ...(photo.settings.disabled || {}), [sectionId]: disabled };
  if (!disabled) delete photo.settings.disabled[sectionId];
  settingsChanged(photo);
  showToast(disabled ? `Đã tạm tắt nhóm ${label} (áp dụng cả khi xuất).` : `Đã bật lại nhóm ${label}.`);
}

export function syncSectionStates() {
  const photo = activePhoto();
  el.curveParamDetails.classList.toggle("modified", !!photo && controlGroups.curveParam.some((c) => photo.settings.values[c.id] !== valueDefaults[c.id]));
  document.querySelectorAll("[data-section]").forEach((section) => {
    const id = section.dataset.section;
    const modified = photo ? sectionModified(photo.settings, id) : false;
    const disabled = !!photo?.settings.disabled?.[id];
    section.classList.toggle("modified", modified);
    section.classList.toggle("bypassed", disabled);
    const bypass = section.querySelector(".section-bypass");
    if (bypass) {
      bypass.setAttribute("aria-pressed", String(disabled));
      bypass.title = disabled ? "Nhóm đang tắt – bấm để bật lại" : "Tạm tắt nhóm này để so sánh";
      bypass.hidden = !modified && !disabled;
    }
  });
}

/* ============================================================
   Thanh trượt
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
    begin: (c) => { gesture = beginGesture(activePhoto(), c.label); },
    commit: () => { endGesture(gesture); gesture = null; afterCommit(); },
  };
}

function maskBinding() {
  let gesture = null;
  return {
    key: (c) => `mask-${c.id}`,
    get: (c) => activeMask()?.values[c.id] ?? (c.initial ?? 0),
    set: (c, v) => { const mask = activeMask(); if (!mask) return; mask.values[c.id] = v; scheduleRender(); },
    begin: (c) => { const p = activePhoto(); gesture = beginGesture(p, `${maskLabel(p, activeMask(p))}: ${c.label}`); },
    commit: () => { endGesture(gesture); gesture = null; afterCommit(); renderMaskList(); },
  };
}

const rangeControls = [
  { id: "lo", label: "Từ (tối)", min: 0, max: 100, step: 1, initial: 25 },
  { id: "hi", label: "Đến (sáng)", min: 0, max: 100, step: 1, initial: 75 },
  { id: "feather", label: "Độ mềm", min: 1, max: 50, step: 1, initial: 15 },
  { id: "tolerance", label: "Dung sai màu", min: 5, max: 90, step: 1, initial: 30 },
];

function rangeBinding() {
  let gesture = null;
  return {
    key: (c) => `range-${c.id}`,
    get: (c) => activeMask()?.range?.[c.id] ?? c.initial,
    set: (c, v) => {
      const mask = activeMask();
      if (!mask) return;
      mask.range = { ...mask.range, [c.id]: v };
      if (c.id === "lo" && mask.range.hi < v) mask.range.hi = v;
      if (c.id === "hi" && mask.range.lo > v) mask.range.lo = v;
      scheduleRender();
    },
    begin: (c) => { const p = activePhoto(); gesture = beginGesture(p, `${maskLabel(p, activeMask(p))}: ${c.label}`); },
    commit: () => { endGesture(gesture); gesture = null; afterCommit(); rangeControlSet.sync(); },
  };
}

function afterCommit() {
  updateActionButtons();
  updateFilmstripBadges();
  syncSectionStates();
  renderHistoryPanel();
}

export function syncAllControls() {
  if (!activePhoto()) return;
  for (const set of controlSets) set.sync();
  syncMaskEditor();
  syncGradePanel();
  syncCurvePanel();
  syncSectionStates();
  updatePresetAmount();
  syncLutPanel();
}

/* ---------- Đường cong ---------- */

function buildCurvePanel() {
  let gesture = null;
  curveEditor = new CurveEditor(el.curveCanvas, {
    onBegin: () => { gesture = beginGesture(activePhoto(), "Đường cong tông"); },
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
      afterCommit();
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
    record(photo, "Đặt lại đường cong");
    photo.settings.curve = defaultCurve();
    for (const c of controlGroups.curveParam) photo.settings.values[c.id] = valueDefaults[c.id];
    photo.settings.preset = null;
    settingsChanged(photo);
  });
}

function syncCurvePanel() {
  const photo = activePhoto();
  if (!photo || !curveEditor) return;
  curveEditor.setPoints(photo.settings.curve[state.curveChannel], state.curveChannel);
  el.curveResetButton.disabled = !sectionModified(photo.settings, "curve");
  document.querySelectorAll("[data-curve-channel]").forEach((b) => {
    b.classList.toggle("modified", !isIdentityCurve(photo.settings.curve[b.dataset.curveChannel]));
  });
}

/* ---------- Phân màu ---------- */

function buildGradePanel() {
  let gesture = null;
  const begin = (label = "Phân màu") => { gesture = beginGesture(activePhoto(), label); };
  const commit = () => { endGesture(gesture); gesture = null; syncGradePanel(); afterCommit(); };
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
      onBegin: () => begin(`Phân màu ${zone.label}`),
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
      if (!lumActive) { lumActive = true; begin(`Độ sáng ${zone.label}`); }
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
      begin(`Độ sáng ${zone.label}`);
      photo.settings.grade[zone.id].l = 0;
      commit();
      scheduleRender();
    });
    wrap.append(title, canvas, readout, lum);
    el.gradeWheels.appendChild(wrap);
    gradeWidgets[zone.id] = { wheel, lum, readout };
  }
  gradeControlSet = buildControls(el.gradeControls, [
    { id: "blending", label: "Hoà trộn", min: 0, max: 100, step: 1, initial: 50 },
    { id: "balance", label: "Cân bằng", min: -100, max: 100, step: 1, initial: 0 },
  ], {
    key: (c) => `grade-${c.id}`,
    get: (c) => activePhoto()?.settings.grade[c.id] ?? c.initial,
    set: (c, v) => { const photo = activePhoto(); if (!photo) return; photo.settings.grade[c.id] = v; photo.settings.preset = null; scheduleRender(); },
    begin: (c) => begin(c.label),
    commit,
  });
  el.gradeResetButton.addEventListener("click", () => {
    const photo = activePhoto();
    if (!photo) return;
    record(photo, "Đặt lại phân màu");
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

/* ============================================================
   Vùng chọn
   ============================================================ */

export const maskLabel = (photo, mask) => {
  if (!photo || !mask) return "";
  const same = photo.settings.masks.filter((m) => m.type === mask.type);
  return `${maskTypes[mask.type]?.label || mask.type} ${same.indexOf(mask) + 1}`;
};

export function addMask(type) {
  const photo = activePhoto();
  if (!photo) return;
  if (photo.settings.masks.length >= MAX_MASKS) { showToast(`Tối đa ${MAX_MASKS} vùng chọn cho mỗi ảnh.`); return; }
  record(photo, `Thêm ${maskTypes[type].label}`);
  const mask = createMask(type);
  const warp = warpOf(photo);
  const center = outputToSource(photo.settings.crop, 0.5, 0.5, warp);
  if (type === "radial") mask.radial.center = { x: center.x / photo.width, y: center.y / photo.height };
  if (type === "linear") {
    const top = outputToSource(photo.settings.crop, 0.5, 0.1, warp);
    const mid = outputToSource(photo.settings.crop, 0.5, 0.55, warp);
    mask.linear = { start: { x: top.x / photo.width, y: top.y / photo.height }, end: { x: mid.x / photo.width, y: mid.y / photo.height } };
  }
  photo.settings.masks.push(mask);
  photo.activeMaskId = mask.id;
  state.showMaskOverlay = ["brush", "sky", "luma", "color"].includes(type);
  if (photo.settings.disabled?.masks) delete photo.settings.disabled.masks;
  settingsChanged(photo);
  if (type === "color") setTool("range-picker");
}

export function deleteMask(id) {
  const photo = activePhoto();
  const mask = photo?.settings.masks.find((m) => m.id === id);
  if (!mask) return;
  record(photo, `Xoá ${maskLabel(photo, mask)}`);
  photo.settings.masks = photo.settings.masks.filter((m) => m.id !== id);
  ensureActiveMask(photo);
  settingsChanged(photo);
  showToast("Đã xoá vùng chọn.", { label: "Hoàn tác", run: () => undo() });
}

function duplicateMask(id) {
  const photo = activePhoto();
  const mask = photo?.settings.masks.find((m) => m.id === id);
  if (!mask) return;
  if (photo.settings.masks.length >= MAX_MASKS) { showToast(`Tối đa ${MAX_MASKS} vùng chọn cho mỗi ảnh.`); return; }
  record(photo, `Nhân bản ${maskLabel(photo, mask)}`);
  const copy = { ...JSON.parse(JSON.stringify({ ...mask, brush: null })), id: createMask(mask.type).id, brush: mask.brush };
  photo.settings.masks.splice(photo.settings.masks.indexOf(mask) + 1, 0, copy);
  photo.activeMaskId = copy.id;
  settingsChanged(photo);
}

export function renderMaskUI() {
  renderMaskList();
  syncMaskEditor();
}

export function renderMaskList() {
  const photo = activePhoto();
  const list = el.maskList;
  list.replaceChildren();
  document.querySelectorAll("[data-add-mask]").forEach((b) => { b.disabled = !photo || photo.settings.masks.length >= MAX_MASKS; });
  if (!photo) return;
  for (const mask of photo.settings.masks) {
    const li = document.createElement("li");
    li.className = `mask-item${mask.id === photo.activeMaskId ? " active" : ""}${mask.visible === false ? " muted" : ""}`;
    const select = document.createElement("button");
    select.type = "button";
    select.className = "mask-select";
    select.setAttribute("aria-pressed", String(mask.id === photo.activeMaskId));
    select.innerHTML = `<span class="mask-dot mask-dot-${mask.type}" aria-hidden="true"></span><span class="mask-name"></span>`;
    select.querySelector(".mask-name").textContent = maskLabel(photo, mask);
    if (mask.invert) select.insertAdjacentHTML("beforeend", '<span class="mask-flag">đảo</span>');
    if (mask.range?.type && mask.range.type !== "none" && !["luma", "color"].includes(mask.type)) select.insertAdjacentHTML("beforeend", `<span class="mask-flag">${mask.range.type === "luma" ? "∩ sáng" : "∩ màu"}</span>`);
    select.addEventListener("click", () => {
      photo.activeMaskId = photo.activeMaskId === mask.id ? null : mask.id;
      renderMaskUI();
      scheduleRender();
    });
    const icon = (text, title, fn, cls = "") => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `mask-icon ${cls}`;
      b.textContent = text;
      b.title = title;
      b.setAttribute("aria-label", `${title}: ${maskLabel(photo, mask)}`);
      b.addEventListener("click", fn);
      return b;
    };
    li.append(
      select,
      icon(mask.visible === false ? "○" : "●", mask.visible === false ? "Bật vùng chọn" : "Tạm tắt vùng chọn", () => {
        record(photo, `${mask.visible === false ? "Bật" : "Tắt"} ${maskLabel(photo, mask)}`);
        mask.visible = mask.visible === false;
        settingsChanged(photo);
      }),
      icon("⧉", "Nhân bản", () => duplicateMask(mask.id)),
      icon("×", "Xoá vùng chọn (Delete)", () => deleteMask(mask.id), "danger"),
    );
    list.appendChild(li);
  }
}

export function syncMaskEditor() {
  const photo = activePhoto();
  const mask = activeMask(photo);
  el.maskEditor.hidden = !mask;
  const help = {
    sky: "Vùng trời được nhận diện tự động theo màu và vị trí. Chỉ chỉnh màu – không thay hay ghép trời.",
    brush: "Tô trực tiếp trên ảnh. Giữ Alt để tẩy, phím [ ] đổi cỡ cọ.",
    linear: "Kéo trên ảnh để vẽ gradient mới; kéo tay nắm để chỉnh, kéo đường giữa để di chuyển.",
    radial: "Kéo trên ảnh để vẽ oval mới (Shift: tròn đều); kéo tâm để di chuyển, tay nắm để đổi cỡ hoặc xoay.",
    luma: "Chọn vùng theo độ sáng của ảnh gốc. Chỉnh khoảng Từ – Đến bên dưới.",
    color: "Chọn vùng theo màu. Bấm “Chọn màu” rồi bấm vào ảnh.",
  };
  el.maskHelp.textContent = mask
    ? `${help[mask.type]} Bấm chỗ trống hoặc Esc để thoát · Delete để xoá.`
    : (photo?.settings.masks.length ? "Chọn một vùng trong danh sách để chỉnh." : `Thêm vùng chọn để chỉnh sáng, màu và chi tiết cục bộ. Tối đa ${MAX_MASKS} vùng.`);
  if (!mask) { updateBrushCursor(); return; }
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
  // Giới hạn theo dải
  const fixedType = mask.type === "luma" ? "luma" : mask.type === "color" ? "color" : null;
  const rangeType = fixedType || mask.range?.type || "none";
  el.rangeTypeField.hidden = !!fixedType;
  el.rangeTypeSelect.value = rangeType;
  el.rangeLumaControls.hidden = rangeType !== "luma";
  el.rangeColorControls.hidden = rangeType !== "color";
  el.rangeInvertToggle.checked = !!mask.range?.invert;
  el.rangeInvertLabel.hidden = rangeType === "none";
  el.rangeSwatch.style.background = `hsl(${mask.range?.hue ?? 0} ${Math.max(35, mask.range?.sat ?? 40)}% 50%)`;
  el.rangeSwatch.title = `Sắc độ ${mask.range?.hue ?? 0}°`;
  for (const [id, row] of rangeControlSet.rows) row.row.hidden = id === "tolerance" ? rangeType !== "color" : rangeType !== "luma";
  maskControlSet?.sync();
  rangeControlSet?.sync();
  updateBrushCursor();
}

function initMasks() {
  document.querySelectorAll("[data-add-mask]").forEach((b) => b.addEventListener("click", () => addMask(b.dataset.addMask)));
  el.showMaskToggle.addEventListener("change", () => { state.showMaskOverlay = el.showMaskToggle.checked; scheduleRender(); });
  el.invertMaskToggle.addEventListener("change", () => {
    const photo = activePhoto();
    const mask = activeMask(photo);
    if (!mask) return;
    record(photo, `Đảo ${maskLabel(photo, mask)}`);
    mask.invert = el.invertMaskToggle.checked;
    settingsChanged(photo);
  });
  el.clearMaskButton.addEventListener("click", () => {
    const photo = activePhoto();
    const mask = activeMask(photo);
    if (!mask || !mask.brush) return;
    record(photo, `Xoá nét ${maskLabel(photo, mask)}`);
    mask.brush = null;
    settingsChanged(photo);
    showToast("Đã xoá nét cọ.", { label: "Hoàn tác", run: () => undo() });
  });
  const mini = (range, output, fmt = (v) => v) => {
    range.addEventListener("input", () => { output.textContent = fmt(range.value); setRangeProgress(range); });
    setRangeProgress(range);
  };
  mini(el.brushSizeRange, el.brushSizeValue);
  mini(el.brushFeatherRange, el.brushFeatherValue);
  mini(el.brushFlowRange, el.brushFlowValue);
  let geoGesture = null;
  const geoBegin = (label) => { if (!geoGesture) geoGesture = beginGesture(activePhoto(), label); };
  const geoEnd = () => { endGesture(geoGesture); geoGesture = null; afterCommit(); };
  el.maskFeatherRange.addEventListener("input", () => {
    const mask = activeMask();
    if (!mask) return;
    geoBegin("Độ mềm vùng chọn");
    mask.feather = Number(el.maskFeatherRange.value);
    el.maskFeatherValue.textContent = mask.feather;
    setRangeProgress(el.maskFeatherRange);
    scheduleRender();
  });
  el.maskFeatherRange.addEventListener("change", geoEnd);
  el.maskRotationRange.addEventListener("input", () => {
    const mask = activeMask();
    if (!mask) return;
    geoBegin("Xoay vùng chọn");
    mask.radial.rotation = Number(el.maskRotationRange.value);
    el.maskRotationValue.textContent = `${mask.radial.rotation}°`;
    setRangeProgress(el.maskRotationRange);
    scheduleRender();
  });
  el.maskRotationRange.addEventListener("change", geoEnd);
  el.rangeTypeSelect.addEventListener("change", () => {
    const photo = activePhoto();
    const mask = activeMask(photo);
    if (!mask) return;
    record(photo, `Giới hạn ${maskLabel(photo, mask)}`);
    mask.range = { ...defaultRange(), ...(mask.range || {}), type: el.rangeTypeSelect.value };
    settingsChanged(photo);
    if (mask.range.type === "color") setTool("range-picker");
  });
  el.rangeInvertToggle.addEventListener("change", () => {
    const photo = activePhoto();
    const mask = activeMask(photo);
    if (!mask) return;
    record(photo, `Trừ dải ${maskLabel(photo, mask)}`);
    mask.range = { ...mask.range, invert: el.rangeInvertToggle.checked };
    settingsChanged(photo);
  });
  el.rangePickButton.addEventListener("click", () => setTool("range-picker"));
}

/* ============================================================
   Lịch sử & snapshot
   ============================================================ */

export function renderHistoryPanel() {
  const photo = activePhoto();
  const list = el.historyList;
  list.replaceChildren();
  el.snapshotList.replaceChildren();
  el.snapshotButton.disabled = !photo;
  if (!photo) { el.historyEmpty.hidden = false; return; }
  el.historyEmpty.hidden = true;
  const row = (label, steps, cls, settings = null) => {
    const li = document.createElement("li");
    li.className = "history-row";
    const b = document.createElement("button");
    b.type = "button";
    b.className = `history-step ${cls}`;
    b.textContent = label;
    if (steps === 0) b.setAttribute("aria-current", "step");
    else b.title = steps < 0 ? `Quay lại ${-steps} bước` : `Tiến tới ${steps} bước`;
    b.addEventListener("click", () => { if (steps) stepHistory(photo, steps); });
    li.appendChild(b);
    if (settings) li.appendChild(compareButton(photo, label, settings));
    list.appendChild(li);
  };
  photo.future.forEach((step, j) => row(step.label, photo.future.length - j, "future", step.settings));
  row(currentLabel(photo), 0, "current");
  for (let i = photo.history.length - 1; i >= 0; i--) row(photo.history[i - 1]?.label ?? "Trạng thái đầu", -(photo.history.length - i), "past", photo.history[i].settings);
  for (const snap of photo.snapshots) {
    const li = document.createElement("li");
    li.className = "snapshot-item";
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "history-step";
    apply.textContent = snap.name;
    apply.title = `Áp dụng snapshot · tạo lúc ${new Date(snap.createdAt).toLocaleString("vi-VN")}`;
    apply.addEventListener("click", () => {
      record(photo, `Snapshot: ${snap.name}`);
      photo.settings = { ...cloneSettings(snap.settings), crop: { ...snap.settings.crop } };
      photo.presetState = null;
      ensureActiveMask(photo);
      updateDimensions();
      settingsChanged(photo);
      showToast(`Đã áp dụng snapshot “${snap.name}”.`, { label: "Hoàn tác", run: () => undo() });
    });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "mask-icon danger";
    del.textContent = "×";
    del.setAttribute("aria-label", `Xoá snapshot ${snap.name}`);
    del.title = "Xoá snapshot";
    del.addEventListener("click", () => {
      photo.snapshots = photo.snapshots.filter((s) => s !== snap);
      hooks.markDirty(photo);
      renderHistoryPanel();
    });
    li.append(apply, compareButton(photo, `Snapshot “${snap.name}”`, snap.settings), del);
    el.snapshotList.appendChild(li);
  }
  el.snapshotEmpty.hidden = photo.snapshots.length > 0;
}

/** Nút ◐: so sánh ảnh hiện tại với một mốc (bước lịch sử / snapshot) thay cho ảnh gốc. */
function compareButton(photo, label, settings) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "mask-icon compare-icon";
  b.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor"/></svg>';
  const active = state.compareRef?.photoId === photo.id && state.compareRef.settings === settings;
  b.classList.toggle("active", active);
  b.setAttribute("aria-pressed", String(active));
  b.title = active ? "Đang so sánh với mốc này – bấm để bỏ" : "So sánh ảnh hiện tại với mốc này";
  b.setAttribute("aria-label", `So sánh với ${label}`);
  b.addEventListener("click", () => setCompareReference(active ? null : { photoId: photo.id, label, settings }));
  return b;
}

export function setCompareReference(ref) {
  state.compareRef = ref;
  if (ref && state.previewMode === "after") hooks.setPreviewMode?.("split");
  if (!ref && state.previewMode !== "after") hooks.setPreviewMode?.("after");
  renderHistoryPanel();
  viewRender();
  if (ref) showToast(`Đang so sánh với: ${ref.label}. Dùng Trước / Tách đôi để xem.`);
}

async function createSnapshot() {
  const photo = activePhoto();
  if (!photo) return;
  const name = await askName("Tạo snapshot", `Snapshot ${photo.snapshots.length + 1}`, "Tên snapshot");
  if (!name) return;
  photo.snapshots.push({ id: uid(), name, createdAt: Date.now(), settings: cloneSettings(photo.settings) });
  hooks.markDirty(photo);
  renderHistoryPanel();
  showToast(`Đã tạo snapshot “${name}”.`);
}

/* ============================================================
   Nút hành động, tự động
   ============================================================ */

export function updateActionButtons() {
  const photo = activePhoto();
  const index = state.photos.indexOf(photo);
  el.undoButton.disabled = !photo || !photo.history.length;
  el.redoButton.disabled = !photo || !photo.future.length;
  el.menuPrevious.disabled = !photo || index <= 0;
  el.menuCopy.disabled = !photo;
  el.menuPaste.disabled = !photo || !state.clipboard;
  el.menuSync.disabled = !photo || !selectedPhotos().some((p) => p.id !== photo.id);
  el.menuVirtualCopy.disabled = !photo;
  el.menuReset.disabled = !photo;
  el.settingsMenuButton.disabled = !photo;
}

export function resetPhoto() {
  const photo = activePhoto();
  if (!photo) return;
  record(photo, "Đặt lại ảnh");
  photo.settings = defaultSettings(photo.width, photo.height);
  photo.presetState = null;
  photo.activeMaskId = null;
  settingsChanged(photo);
  showToast("Đã đặt lại ảnh đang xem.", { label: "Hoàn tác", run: () => undo() });
}

function runAutoTone() {
  const photo = activePhoto();
  if (!photo) return;
  record(photo, "Tự động tông sáng");
  Object.assign(photo.settings.values, autoTone(photo.stats));
  photo.settings.preset = null;
  settingsChanged(photo);
  showToast("Đã tự động căn tông sáng.", { label: "Hoàn tác", run: () => undo() });
}

function runAutoWhiteBalance() {
  const photo = activePhoto();
  if (!photo) return;
  const wb = autoWhiteBalance(photo.stats);
  record(photo, "Tự động cân bằng trắng");
  Object.assign(photo.settings.values, wb);
  photo.settings.preset = null;
  settingsChanged(photo);
  showToast(`Tự động cân bằng trắng: nhiệt độ ${wb.temperature}, sắc thái ${wb.tint}.`, { label: "Hoàn tác", run: () => undo() });
}

/* ============================================================
   Khởi tạo
   ============================================================ */

export function initPanel() {
  const binding = globalBinding();
  controlSets = [
    buildControls(el.lightControls, controlGroups.light, binding),
    buildControls(el.colorControls, controlGroups.color, binding),
    buildControls(el.effectControls, controlGroups.effects, binding),
    buildControls(el.detailControls, controlGroups.detail, binding),
    buildControls(el.lensControls, controlGroups.lens, binding),
    buildControls(el.transformControls, controlGroups.transform, binding),
    buildControls(el.calibrationControls, controlGroups.calibration, binding),
    buildControls(el.curveParamControls, controlGroups.curveParam, binding),
    buildControls(el.lutControls, controlGroups.lut, binding),
    buildControls(el.hslHueControls, hslGroups.hue, binding),
    buildControls(el.hslSaturationControls, hslGroups.saturation, binding),
    buildControls(el.hslLuminanceControls, hslGroups.luminance, binding),
  ];
  maskControlSet = buildControls(el.maskControls, maskControlGroup, maskBinding());
  rangeControlSet = buildControls(el.rangeControls, rangeControls, rangeBinding());
  buildGradePanel();
  buildCurvePanel();
  initSections();
  initMasks();
  document.querySelectorAll(".hsl-tab").forEach((button) => button.addEventListener("click", () => {
    const tab = button.dataset.hslTab;
    document.querySelectorAll(".hsl-tab").forEach((t) => {
      t.classList.toggle("active", t === button);
      t.setAttribute("aria-selected", String(t === button));
    });
    document.querySelectorAll("[data-hsl-panel]").forEach((panel) => { panel.hidden = tab !== "all" && panel.dataset.hslPanel !== tab; });
  }));
  el.autoToneButton.addEventListener("click", runAutoTone);
  el.autoWhiteBalanceButton.addEventListener("click", runAutoWhiteBalance);
  el.eyedropperButton.addEventListener("click", () => setTool("eyedropper"));
  el.snapshotButton.addEventListener("click", createSnapshot);
  el.compareBadgeClear.addEventListener("click", () => setCompareReference(null));
  el.transformFitButton.addEventListener("click", () => {
    const photo = activePhoto();
    if (!photo) return;
    const scale = fitPerspectiveScale(photo.settings.values, photo.width, photo.height);
    record(photo, "Phối cảnh: vừa khung");
    photo.settings.values.perspScale = scale;
    settingsChanged(photo);
    showToast(`Thu phóng ${scale}% để không lộ vùng trống.`);
  });
  el.guideGridToggle.addEventListener("change", () => { state.showGuideGrid = el.guideGridToggle.checked; viewRender(); });
  el.panelHandle.addEventListener("click", () => togglePanel());
  el.panelClose.addEventListener("click", () => togglePanel(false));
  setPanelLocked(true);
  setPanelOpen(false, { remember: false });

  hooks.historyChanged.push((photo) => { if (photo.id === state.activeId) { renderHistoryPanel(); updateActionButtons(); } });
  onSettingsChanged((photo) => {
    if (photo.id !== state.activeId) { updateFilmstripBadges(); return; }
    syncAllControls();
    renderMaskUI();
    setActivePresetMark();
    updateActionButtons();
    updateFilmstripBadges();
    renderHistoryPanel();
    updateDimensions();
    scheduleRender();
  });
}
