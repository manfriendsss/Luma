import { valueDefaults, maskValueDefaults, settingGroups, panelSections, controlGroups, hslGroups } from "./config.js";

export const identityCurve = () => [[0, 0], [1, 1]];

export function defaultCurve() {
  return { master: identityCurve(), r: identityCurve(), g: identityCurve(), b: identityCurve() };
}

export function defaultGrade() {
  return {
    shadows: { h: 0, s: 0, l: 0 },
    midtones: { h: 0, s: 0, l: 0 },
    highlights: { h: 0, s: 0, l: 0 },
    global: { h: 0, s: 0, l: 0 },
    blending: 50,
    balance: 0,
  };
}

/** Crop toàn ảnh. Toạ độ theo pixel ảnh gốc, trục y hướng xuống, góc theo độ (dương = xoay theo chiều kim đồng hồ). */
export function defaultCrop(width, height) {
  return { cx: width / 2, cy: height / 2, w: width, h: height, angle: 0, flip: false, aspect: "free" };
}

export function defaultSettings(width = 1, height = 1) {
  return {
    values: { ...valueDefaults },
    curve: defaultCurve(),
    grade: defaultGrade(),
    crop: defaultCrop(width, height),
    masks: [],
    disabled: {},
    lut: null, // { id, name } – dữ liệu LUT nằm trong thư viện (IndexedDB), cường độ ở values.lutAmount
    preset: "natural",
  };
}

let maskCounter = 0;
export function newMaskId() {
  maskCounter += 1;
  return `m${Date.now().toString(36)}${maskCounter}`;
}

export function createMask(type) {
  return {
    id: newMaskId(),
    type,
    invert: false,
    visible: true,
    feather: type === "radial" ? 50 : 0,
    brushFeather: 50,
    linear: { start: { x: 0.5, y: 0.15 }, end: { x: 0.5, y: 0.55 } },
    radial: { center: { x: 0.5, y: 0.5 }, rx: 0.28, ry: 0.2, rotation: 0 },
    values: { ...maskValueDefaults },
    // Giới hạn thêm theo dải sáng / dải màu (giao với vùng chọn). Mask "luma"/"color" luôn dùng dải tương ứng.
    range: defaultRange(type === "color" ? "color" : type === "luma" ? "luma" : "none"),
    // Dữ liệu cọ: { width, height, data: Uint8Array } – được chia sẻ (không sao chép) giữa các bước lịch sử.
    brush: null,
  };
}

export function defaultRange(type = "none") {
  return { type, lo: 25, hi: 75, feather: 15, hue: 210, sat: 40, tolerance: 30, invert: false };
}

const clonePoints = (points) => points.map(([x, y]) => [x, y]);

export function cloneCurve(curve) {
  const base = defaultCurve();
  return Object.fromEntries(Object.keys(base).map((k) => [k, clonePoints(curve?.[k] || base[k])]));
}

export function cloneGrade(grade) {
  const base = defaultGrade();
  const out = { blending: grade?.blending ?? base.blending, balance: grade?.balance ?? base.balance };
  for (const zone of ["shadows", "midtones", "highlights", "global"]) out[zone] = { ...base[zone], ...(grade?.[zone] || {}) };
  return out;
}

export function cloneMask(mask, { keepBrush = true } = {}) {
  return {
    ...mask,
    linear: { start: { ...mask.linear.start }, end: { ...mask.linear.end } },
    radial: { ...mask.radial, center: { ...mask.radial.center } },
    values: { ...mask.values },
    range: { ...defaultRange(), ...(mask.range || {}) },
    brush: keepBrush ? mask.brush : null,
  };
}

/** Sao chép sâu thiết lập; dữ liệu cọ (bất biến) được giữ theo tham chiếu để lịch sử nhẹ. */
export function cloneSettings(settings) {
  return {
    values: { ...settings.values },
    curve: cloneCurve(settings.curve),
    grade: cloneGrade(settings.grade),
    crop: { ...settings.crop },
    masks: settings.masks.map((m) => cloneMask(m)),
    disabled: { ...(settings.disabled || {}) },
    lut: settings.lut ? { ...settings.lut } : null,
    preset: settings.preset ?? null,
  };
}

/** Thiết lập thực sự được render: các nhóm đang "tạm tắt" trả về mặc định. */
export function effectiveSettings(settings) {
  const disabled = settings.disabled || {};
  if (!Object.values(disabled).some(Boolean)) return settings;
  const out = cloneSettings(settings);
  for (const section of panelSections) {
    if (!disabled[section.id]) continue;
    if (section.keys) for (const k of section.keys) out.values[k] = valueDefaults[k];
    if (section.id === "hsl") for (const c of Object.values(hslGroups).flat()) out.values[c.id] = 0;
    if (section.id === "curve") out.curve = defaultCurve();
    if (section.id === "grade") out.grade = defaultGrade();
    if (section.id === "masks") out.masks = out.masks.map((m) => ({ ...m, visible: false }));
    if (section.id === "lut") out.lut = null;
  }
  return out;
}

/** Nhóm có khác mặc định không (để hiện dấu chấm trên tiêu đề). */
export function sectionModified(settings, sectionId) {
  const section = panelSections.find((s) => s.id === sectionId);
  if (!section) return false;
  const keysModified = section.keys ? section.keys.some((k) => Math.abs((settings.values[k] ?? valueDefaults[k]) - valueDefaults[k]) > 1e-9) : false;
  if (sectionId === "lut") return !!settings.lut;
  if (sectionId === "curve") return keysModified || Object.values(settings.curve).some((p) => !isIdentityCurve(p));
  if (section.keys) return keysModified;
  if (sectionId === "hsl") return Object.values(hslGroups).flat().some((c) => settings.values[c.id]);
  if (sectionId === "grade") {
    const g = settings.grade;
    return g.blending !== 50 || g.balance !== 0 || ["shadows", "midtones", "highlights", "global"].some((z) => g[z].s || g[z].l);
  }
  if (sectionId === "masks") return settings.masks.length > 0;
  return false;
}

/* ---------- Nén dữ liệu cọ (RLE) để lưu file .luma.json ---------- */

export function encodeBrush(brush) {
  if (!brush) return null;
  const { data } = brush;
  const out = [];
  let i = 0;
  while (i < data.length) {
    const v = data[i];
    let run = 1;
    while (i + run < data.length && data[i + run] === v && run < 65535) run++;
    out.push(v, run & 255, run >> 8);
    i += run;
  }
  const bytes = Uint8Array.from(out);
  let binary = "";
  for (let k = 0; k < bytes.length; k += 0x8000) binary += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return { width: brush.width, height: brush.height, rle: btoa(binary) };
}

export function decodeBrush(encoded) {
  if (!encoded?.rle) return null;
  const binary = atob(encoded.rle);
  const data = new Uint8Array(encoded.width * encoded.height);
  let o = 0;
  for (let i = 0; i + 2 < binary.length; i += 3) {
    const v = binary.charCodeAt(i);
    const run = binary.charCodeAt(i + 1) | (binary.charCodeAt(i + 2) << 8);
    data.fill(v, o, o + run);
    o += run;
  }
  return { width: encoded.width, height: encoded.height, data, version: `f${Math.random().toString(36).slice(2, 9)}` };
}

/** Thiết lập → JSON có thể ghi ra file (cọ được nén). */
export function serializeSettings(settings) {
  return { ...cloneSettings(settings), masks: settings.masks.map((m) => ({ ...cloneMask(m, { keepBrush: false }), brush: encodeBrush(m.brush) })) };
}

export function deserializeMasks(masks) {
  return (masks || []).map((m) => ({ ...m, brush: m.brush && m.brush.rle ? decodeBrush(m.brush) : m.brush }));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** So sánh hai thiết lập (không phụ thuộc thứ tự khoá; dữ liệu cọ so theo phiên bản). */
export function settingsEqual(a, b) {
  // iw/ih (kích thước "mong muốn" khi nắn thẳng) không ảnh hưởng tới kết quả hiển thị
  const strip = (s) => stableStringify({
    ...s,
    crop: { ...s.crop, iw: undefined, ih: undefined },
    masks: s.masks.map((m) => ({ ...m, brush: m.brush ? m.brush.version ?? 1 : null })),
  });
  return strip(a) === strip(b);
}

export function isIdentityCurve(points) {
  return points.length === 2 && points[0][0] === 0 && points[0][1] === 0 && points[1][0] === 1 && points[1][1] === 1;
}

/** Ghép các nhóm thiết lập được chọn từ nguồn sang đích (dùng cho Dán / Đồng bộ). */
export function mergeSettingGroups(target, source, groupIds, targetSize) {
  const out = cloneSettings(target);
  for (const id of groupIds) {
    const group = settingGroups.find((g) => g.id === id);
    if (!group) continue;
    if (group.keys) for (const key of group.keys) out.values[key] = source.values[key];
    if (id === "curve") out.curve = cloneCurve(source.curve);
    if (id === "grade") out.grade = cloneGrade(source.grade);
    if (id === "lut") out.lut = source.lut ? { ...source.lut } : null;
    if (id === "masks") {
      const geometric = source.masks.filter((m) => m.type !== "brush").map((m) => ({ ...cloneMask(m, { keepBrush: false }), id: newMaskId() }));
      out.masks = [...out.masks.filter((m) => m.type === "brush"), ...geometric];
    }
    if (id === "crop" && targetSize) out.crop = scaleCropToSize(source.crop, source.__size, targetSize);
  }
  out.preset = null;
  return out;
}

/** Chuyển crop theo tỉ lệ tương đối sang ảnh có kích thước khác. */
export function scaleCropToSize(crop, fromSize, toSize) {
  if (!fromSize) return { ...defaultCrop(toSize.width, toSize.height), angle: crop.angle, flip: crop.flip };
  // Ảnh nguồn không cắt/xoay → ảnh đích cũng giữ nguyên khung của chính nó
  const untouched = Math.abs(crop.w - fromSize.width) < 1 && Math.abs(crop.h - fromSize.height) < 1 && !crop.angle && !crop.quarter && !crop.flip;
  if (untouched) return defaultCrop(toSize.width, toSize.height);
  const sx = toSize.width / fromSize.width;
  const sy = toSize.height / fromSize.height;
  const s = Math.min(sx, sy);
  return { ...crop, cx: crop.cx * sx, cy: crop.cy * sy, w: crop.w * s, h: crop.h * s };
}

export function maskValuesAreDefault(mask) {
  return Object.entries(maskValueDefaults).every(([k, v]) => mask.values[k] === v);
}
