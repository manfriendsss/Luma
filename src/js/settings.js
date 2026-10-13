import { valueDefaults, maskValueDefaults, settingGroups } from "./config.js";

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
    // Dữ liệu cọ: { width, height, data: Uint8Array } – được chia sẻ (không sao chép) giữa các bước lịch sử.
    brush: null,
  };
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
    preset: settings.preset ?? null,
  };
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
