// LUT màu dạng .cube (Adobe/Resolve): đọc file, lưu thư viện LUT trong IndexedDB riêng (không bị xoá khi bỏ phiên).
// Hàm parseCube thuần, dùng được cả trong worker và kiểm thử Node.

const MAX_3D = 65;

/**
 * Đọc nội dung .cube → { title, size, data: Float32Array (size³ × 3, R chạy nhanh nhất), domainMin, domainMax }.
 * LUT 1D được chuyển thành LUT 3D cỡ 33.
 */
export function parseCube(text, fileName = "lut.cube") {
  let title = fileName.replace(/\.[^.]+$/, "");
  let size3 = 0, size1 = 0;
  let domainMin = [0, 0, 0], domainMax = [1, 1, 1];
  const values = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const upper = line.toUpperCase();
    if (upper.startsWith("TITLE")) { const m = /"(.*)"/.exec(line); if (m && m[1].trim()) title = m[1].trim(); continue; }
    if (upper.startsWith("LUT_3D_SIZE")) { size3 = parseInt(line.split(/\s+/)[1], 10); continue; }
    if (upper.startsWith("LUT_1D_SIZE")) { size1 = parseInt(line.split(/\s+/)[1], 10); continue; }
    if (upper.startsWith("DOMAIN_MIN")) { domainMin = line.split(/\s+/).slice(1, 4).map(Number); continue; }
    if (upper.startsWith("DOMAIN_MAX")) { domainMax = line.split(/\s+/).slice(1, 4).map(Number); continue; }
    if (upper.startsWith("LUT_3D_INPUT_RANGE") || upper.startsWith("LUT_1D_INPUT_RANGE")) {
      const [lo, hi] = line.split(/\s+/).slice(1, 3).map(Number);
      domainMin = [lo, lo, lo]; domainMax = [hi, hi, hi];
      continue;
    }
    if (/^[A-Z_]+/.test(upper) && !/^[-+.\dE]/.test(upper)) continue; // từ khoá không hỗ trợ
    const nums = line.split(/\s+/).map(Number);
    if (nums.length >= 3 && nums.slice(0, 3).every(Number.isFinite)) values.push(nums[0], nums[1], nums[2]);
  }
  if (![...domainMin, ...domainMax].every(Number.isFinite) || domainMax.some((v, i) => v <= domainMin[i])) throw new Error("DOMAIN của LUT không hợp lệ.");
  if (size3) {
    if (size3 < 2 || size3 > MAX_3D) throw new Error(`Kích thước LUT ${size3} không được hỗ trợ (2–${MAX_3D}).`);
    if (values.length < size3 ** 3 * 3) throw new Error(`LUT thiếu dữ liệu: cần ${size3 ** 3} dòng, có ${values.length / 3}.`);
    return { title, size: size3, data: Float32Array.from(values.slice(0, size3 ** 3 * 3)), domainMin, domainMax };
  }
  if (size1) {
    if (values.length < size1 * 3) throw new Error("LUT 1D thiếu dữ liệu.");
    const n = 33;
    const data = new Float32Array(n * n * n * 3);
    const sample = (ch, t) => {
      const x = t * (size1 - 1);
      const i = Math.min(size1 - 2, Math.floor(x));
      const f = x - i;
      return values[i * 3 + ch] * (1 - f) + values[(i + 1) * 3 + ch] * f;
    };
    let o = 0;
    for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
      data[o++] = sample(0, r / (n - 1));
      data[o++] = sample(1, g / (n - 1));
      data[o++] = sample(2, b / (n - 1));
    }
    return { title, size: n, data, domainMin, domainMax };
  }
  throw new Error("Không tìm thấy LUT_3D_SIZE hoặc LUT_1D_SIZE trong file .cube.");
}

/** Tra LUT (nội suy ba tuyến tính) cho một màu – dùng trong kiểm thử. */
export function sampleLut(lut, [r, g, b]) {
  const n = lut.size;
  const norm = (v, i) => Math.min(1, Math.max(0, (v - lut.domainMin[i]) / (lut.domainMax[i] - lut.domainMin[i]))) * (n - 1);
  const [x, y, z] = [norm(r, 0), norm(g, 1), norm(b, 2)];
  const x0 = Math.min(n - 2, Math.floor(x)), y0 = Math.min(n - 2, Math.floor(y)), z0 = Math.min(n - 2, Math.floor(z));
  const fx = x - x0, fy = y - y0, fz = z - z0;
  const at = (i, j, k, ch) => lut.data[((k * n + j) * n + i) * 3 + ch];
  const out = [];
  for (let ch = 0; ch < 3; ch++) {
    const c00 = at(x0, y0, z0, ch) * (1 - fx) + at(x0 + 1, y0, z0, ch) * fx;
    const c10 = at(x0, y0 + 1, z0, ch) * (1 - fx) + at(x0 + 1, y0 + 1, z0, ch) * fx;
    const c01 = at(x0, y0, z0 + 1, ch) * (1 - fx) + at(x0 + 1, y0, z0 + 1, ch) * fx;
    const c11 = at(x0, y0 + 1, z0 + 1, ch) * (1 - fx) + at(x0 + 1, y0 + 1, z0 + 1, ch) * fx;
    out.push((c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz);
  }
  return out;
}

/* ---------- Thư viện trong IndexedDB ---------- */

const DB_NAME = "luma-library";
const LUTS = "luts";
const ASSETS = "assets";
let dbPromise = null;

function openLibrary() {
  if (!("indexedDB" in globalThis)) return Promise.reject(new Error("IndexedDB không khả dụng"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of [LUTS, ASSETS]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openLibrary().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    const r = fn(t.objectStore(store));
    if (r) r.onsuccess = () => { result = r.result; };
  }));
}

export const loadLuts = () => tx(LUTS, "readonly", (s) => s.getAll()).then((list) => list || []).catch(() => []);
export const saveLut = (lut) => tx(LUTS, "readwrite", (s) => s.put(lut, lut.id));
export const deleteLut = (id) => tx(LUTS, "readwrite", (s) => s.delete(id));

/** Tài nguyên nhỏ khác (logo watermark…). */
export const loadAsset = (key) => tx(ASSETS, "readonly", (s) => s.get(key)).catch(() => null);
export const saveAsset = (key, value) => tx(ASSETS, "readwrite", (s) => (value == null ? s.delete(key) : s.put(value, key)));
