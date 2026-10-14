// Bảng LUT: nhập file .cube vào thư viện, chọn LUT cho ảnh đang xem, cường độ (values.lutAmount).
import { parseCube, loadLuts, saveLut, deleteLut } from "./lut.js";
import { state, el, activePhoto, record, settingsChanged, showToast, uid, scheduleRender } from "./core.js";

const sortedLuts = () => [...state.luts.values()].sort((a, b) => a.name.localeCompare(b.name));

function renderLutOptions() {
  const select = el.lutSelect;
  const photo = activePhoto();
  const current = photo?.settings.lut || null;
  select.replaceChildren();
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "Không dùng LUT";
  select.appendChild(none);
  for (const lut of sortedLuts()) {
    const o = document.createElement("option");
    o.value = lut.id;
    o.textContent = `${lut.name} · ${lut.size}³`;
    select.appendChild(o);
  }
  if (current && !state.luts.has(current.id)) {
    const o = document.createElement("option");
    o.value = current.id;
    o.textContent = `${current.name} (không có trong thư viện)`;
    select.appendChild(o);
  }
  select.value = current?.id || "";
}

export function syncLutPanel() {
  if (!el.lutSelect) return;
  renderLutOptions();
  const photo = activePhoto();
  const current = photo?.settings.lut || null;
  const missing = !!current && !state.luts.has(current.id);
  el.lutMissing.hidden = !missing;
  if (missing) el.lutMissing.textContent = `Không tìm thấy LUT “${current.name}” trong thư viện của trình duyệt này – hãy nhập lại file .cube.`;
  el.deleteLutButton.disabled = !el.lutSelect.value || !state.luts.has(el.lutSelect.value);
  el.lutControls.classList.toggle("disabled-controls", !current || missing);
}

function setPhotoLut(photo, lut) {
  record(photo, lut ? `LUT ${lut.name}` : "Bỏ LUT");
  photo.settings.lut = lut ? { id: lut.id, name: lut.name } : null;
  photo.settings.preset = null;
  if (lut && !photo.settings.values.lutAmount) photo.settings.values.lutAmount = 100;
  if (photo.settings.disabled?.lut) delete photo.settings.disabled.lut;
  settingsChanged(photo);
}

export async function importLutFiles(files) {
  const imported = [];
  const errors = [];
  for (const file of files) {
    try {
      const parsed = parseCube(await file.text(), file.name);
      const lut = { id: `lut-${uid().slice(0, 8)}`, name: parsed.title || file.name, size: parsed.size, data: parsed.data, domainMin: parsed.domainMin, domainMax: parsed.domainMax, createdAt: Date.now() };
      state.luts.set(lut.id, lut);
      imported.push(lut);
      saveLut(lut).catch(() => showToast("Không lưu được LUT vào thư viện – LUT chỉ dùng được trong phiên này."));
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
    }
  }
  const photo = activePhoto();
  if (imported.length && photo) setPhotoLut(photo, imported.at(-1));
  syncLutPanel();
  if (errors.length) showToast(errors[0], null, 6000);
  else if (imported.length) showToast(imported.length === 1 ? `Đã nhập LUT “${imported[0].name}”${photo ? " và áp dụng cho ảnh đang xem" : ""}.` : `Đã nhập ${imported.length} LUT.`);
  return imported;
}

async function removeSelectedLut() {
  const id = el.lutSelect.value;
  const lut = state.luts.get(id);
  if (!lut) return;
  state.luts.delete(id);
  await deleteLut(id).catch(() => {});
  const users = state.photos.filter((p) => p.settings.lut?.id === id).length;
  syncLutPanel();
  scheduleRender();
  showToast(users ? `Đã xoá LUT “${lut.name}” khỏi thư viện (${users} ảnh vẫn tham chiếu – sẽ không được áp dụng).` : `Đã xoá LUT “${lut.name}”.`);
}

export async function initLuts() {
  state.renderer.lutResolver = (ref) => state.luts.get(ref.id) || null;
  el.importLutButton.addEventListener("click", () => el.lutFileInput.click());
  el.lutFileInput.addEventListener("change", async () => {
    const files = [...el.lutFileInput.files];
    el.lutFileInput.value = "";
    if (files.length) await importLutFiles(files);
  });
  el.lutSelect.addEventListener("change", () => {
    const photo = activePhoto();
    if (!photo) return;
    const lut = state.luts.get(el.lutSelect.value) || null;
    if (!lut && el.lutSelect.value) { syncLutPanel(); return; }
    setPhotoLut(photo, lut);
  });
  el.deleteLutButton.addEventListener("click", removeSelectedLut);
  for (const lut of await loadLuts()) state.luts.set(lut.id, lut);
  syncLutPanel();
  if (state.luts.size) scheduleRender();
}
