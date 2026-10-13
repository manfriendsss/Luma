// Lưu phiên làm việc (ảnh + thiết lập) vào IndexedDB trên chính máy người dùng.
// File ảnh được ghi một lần; thiết lập được ghi lại sau mỗi thay đổi. Không có gì được gửi lên mạng.

const DB_NAME = "luma-session";
const DB_VERSION = 1;
const FILES = "files";
const RECORDS = "records";
const META = "meta";

let dbPromise = null;

function openDb() {
  if (!("indexedDB" in globalThis)) return Promise.reject(new Error("IndexedDB không khả dụng"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of [FILES, RECORDS, META]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function run(stores, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const results = {};
    t.oncomplete = () => resolve(results);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    fn(t, results);
  }));
}

const collect = (request, results, key) => { request.onsuccess = () => { results[key] = request.result; }; };

export function saveFile(id, file) {
  return run([FILES], "readwrite", (t) => { t.objectStore(FILES).put(file, id); });
}

/** records: [{ id, name, type, lastModified, selected, settings }] */
export function saveRecords(records, meta) {
  return run([RECORDS, META], "readwrite", (t) => {
    const store = t.objectStore(RECORDS);
    for (const r of records) store.put(r, r.id);
    t.objectStore(META).put({ ...meta, savedAt: Date.now() }, "session");
  });
}

export function deletePhotos(ids, { keepFile = false } = {}) {
  return run([FILES, RECORDS], "readwrite", (t) => {
    for (const id of ids) { if (!keepFile) t.objectStore(FILES).delete(id); t.objectStore(RECORDS).delete(id); }
  });
}

/** Lưu handle thư mục (không chép ảnh) để mở lại ở phiên sau. */
export function saveFolder(key, handle) {
  return run([META], "readwrite", (t) => { t.objectStore(META).put(handle, `folder:${key}`); });
}

/** Dung lượng trình duyệt đang dùng / cho phép (nếu hỗ trợ). */
export async function storageEstimate() {
  try { return await navigator.storage?.estimate?.(); } catch { return null; }
}

export async function requestPersistence() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}

export function clearSession() {
  // Xoá toàn bộ ảnh, bản ghi và handle thư mục của phiên trước
  return run([FILES, RECORDS, META], "readwrite", (t) => {
    for (const name of [FILES, RECORDS, META]) t.objectStore(name).clear();
  });
}

export async function sessionSummary() {
  try {
    const r = await run([RECORDS, META], "readonly", (t, results) => {
      collect(t.objectStore(META).get("session"), results, "meta");
      collect(t.objectStore(RECORDS).count(), results, "count");
    });
    return r.meta && r.count ? { count: r.count, savedAt: r.meta.savedAt } : null;
  } catch {
    return null;
  }
}

export async function loadSession() {
  const r = await run([FILES, RECORDS, META], "readonly", (t, results) => {
    collect(t.objectStore(META).get("session"), results, "meta");
    collect(t.objectStore(RECORDS).getAll(), results, "records");
    collect(t.objectStore(META).getAllKeys(), results, "metaKeys");
  });
  if (!r.meta || !r.records?.length) return null;
  const byId = new Map(r.records.map((rec) => [rec.id, rec]));
  const order = (r.meta.order || []).filter((id) => byId.has(id));
  const records = order.length ? order.map((id) => byId.get(id)) : r.records;
  const folderKeys = (r.metaKeys || []).filter((k) => typeof k === "string" && k.startsWith("folder:"));
  const extra = await run([FILES, META], "readonly", (t, results) => {
    for (const rec of records) if (rec.source?.kind !== "folder" && !rec.fileRef) collect(t.objectStore(FILES).get(rec.id), results, `file:${rec.id}`);
    for (const k of folderKeys) collect(t.objectStore(META).get(k), results, k);
  });
  const files = new Map();
  for (const rec of records) if (extra[`file:${rec.id}`]) files.set(rec.id, extra[`file:${rec.id}`]);
  const folders = new Map(folderKeys.map((k) => [k.slice("folder:".length), extra[k]]).filter(([, h]) => h));
  return { meta: r.meta, records, files, folders };
}
