// Tự lưu phiên (IndexedDB) và ghi file thiết lập cạnh ảnh khi làm việc theo thư mục.
import { state, el, hooks, showToast, setStatus } from "./core.js";
import * as storage from "./storage.js";
import { restorePhotos, writeSidecar, activatePhoto, updateFolderChip } from "./photos.js";
import { renderFilmstrip } from "./filmstrip.js";

const dirty = new Set();
let timer = null;
let warnedQuota = false;

hooks.markDirty = (photo) => {
  if (!photo) return;
  dirty.add(photo.id);
  scheduleAutosave();
};

export function scheduleAutosave() {
  clearTimeout(timer);
  timer = setTimeout(flushAutosave, 900);
}

const toRecord = (p) => ({
  id: p.id,
  name: p.name,
  type: p.file.type,
  selected: p.selected,
  rating: p.rating,
  flag: p.flag,
  source: p.source,
  fileRef: p.fileRef,
  copyIndex: p.copyIndex,
  snapshots: p.snapshots,
  settings: p.settings,
});

export async function flushAutosave() {
  clearTimeout(timer);
  const photos = [...dirty].map((id) => state.photos.find((p) => p.id === id)).filter(Boolean);
  dirty.clear();
  try {
    await storage.saveRecords(photos.map(toRecord), { order: state.photos.map((p) => p.id), activeId: state.activeId });
  } catch (error) {
    if (!warnedQuota) {
      warnedQuota = true;
      const full = error?.name === "QuotaExceededError";
      showToast(full
        ? "Bộ nhớ trình duyệt đã đầy – không tự lưu được phiên. Hãy bỏ bớt ảnh hoặc dùng “Mở thư mục” để không phải chép ảnh vào trình duyệt."
        : "Không thể tự lưu phiên (bộ nhớ trình duyệt bị chặn).", null, 9000);
    }
  }
  for (const photo of photos) {
    try { await writeSidecar(photo); } catch {
      const folder = state.folders.get(photo.source?.folderKey);
      if (folder) { folder.writable = false; updateFolderChip(); showToast("Không ghi được file .luma.json vào thư mục – thiết lập vẫn được lưu trong trình duyệt."); }
    }
  }
  updateStorageInfo();
}

export async function updateStorageInfo() {
  const estimate = await storage.storageEstimate();
  if (!estimate?.quota) return;
  const used = estimate.usage / 1024 / 1024;
  const pct = estimate.usage / estimate.quota;
  el.storageInfo.textContent = `Phiên: ${used < 1024 ? `${used.toFixed(0)} MB` : `${(used / 1024).toFixed(1)} GB`}`;
  el.storageInfo.title = `Dung lượng trình duyệt đã dùng ${(pct * 100).toFixed(1)}% hạn mức`;
  el.storageInfo.classList.toggle("warn", pct > 0.8);
}

export async function checkStoredSession() {
  const summary = await storage.sessionSummary();
  if (!summary || state.photos.length) return;
  state.storedSession = summary;
  const when = new Date(summary.savedAt).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
  el.restoreDetail.textContent = `${summary.count} ảnh · lưu lúc ${when}`;
  el.restoreCard.hidden = false;
}

export async function restoreSession() {
  el.restoreSessionButton.disabled = true;
  setStatus("Đang khôi phục phiên trước…");
  try {
    const session = await storage.loadSession();
    if (!session) throw new Error("Không còn dữ liệu phiên.");
    // Xin lại quyền truy cập các thư mục đã mở (cần thao tác của người dùng – nút Tiếp tục)
    const filesById = new Map(session.files);
    let deniedFolders = 0;
    for (const [key, handle] of session.folders) {
      let permission = await handle.queryPermission?.({ mode: "readwrite" });
      if (permission !== "granted") permission = await handle.requestPermission?.({ mode: "readwrite" }).catch(() => "denied");
      let writable = permission === "granted";
      if (!writable) {
        const read = await handle.requestPermission?.({ mode: "read" }).catch(() => "denied");
        if (read !== "granted") { deniedFolders += 1; continue; }
      }
      state.folders.set(key, { handle, writable });
      for (const rec of session.records) {
        if (rec.source?.kind !== "folder" || rec.source.folderKey !== key) continue;
        try { filesById.set(rec.id, await (await handle.getFileHandle(rec.source.fileName)).getFile()); } catch { /* file đã bị xoá/đổi tên */ }
      }
    }
    // Bản sao ảo dùng chung file với bản chính
    for (const rec of session.records) if (rec.fileRef && filesById.has(rec.fileRef)) filesById.set(rec.id, filesById.get(rec.fileRef));
    for (const rec of session.records) if (rec.fileRef && !filesById.has(rec.fileRef) && filesById.has(rec.id)) rec.fileRef = null;
    const photos = await restorePhotos(session.records, filesById);
    state.storedSession = null;
    el.restoreCard.hidden = true;
    updateFolderChip();
    renderFilmstrip();
    const active = photos.find((p) => p.id === session.meta.activeId) || photos[0];
    if (active) activatePhoto(active.id);
    const missing = session.records.length - photos.length;
    showToast(`Đã khôi phục ${photos.length} ảnh${missing ? ` · ${missing} ảnh không tìm thấy${deniedFolders ? " (chưa cấp quyền thư mục)" : ""}` : ""}.`);
  } catch (error) {
    showToast(error.message || "Không thể khôi phục phiên.");
    setStatus("Sẵn sàng");
  } finally {
    el.restoreSessionButton.disabled = false;
  }
}

export async function discardSession() {
  await storage.clearSession().catch(() => {});
  state.storedSession = null;
  el.restoreCard.hidden = true;
  showToast("Đã bỏ phiên cũ.");
}

export function initSession() {
  storage.requestPersistence();
  window.addEventListener("pagehide", () => { if (dirty.size) flushAutosave(); });
  el.restoreSessionButton.addEventListener("click", restoreSession);
  el.discardSessionButton.addEventListener("click", discardSession);
  el.sidecarToggle.addEventListener("change", () => {
    state.sidecarEnabled = el.sidecarToggle.checked;
    if (state.sidecarEnabled) for (const p of state.photos) if (p.source.kind === "folder") hooks.markDirty(p);
  });
  checkStoredSession();
  updateStorageInfo();
}
