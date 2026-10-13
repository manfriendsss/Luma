// Định nghĩa thanh trượt, giá trị mặc định và preset tích hợp.
// Quy ước dấu theo Lightroom: Tối góc âm = làm tối viền ảnh.

export const MAX_MASKS = 8;
export const MASK_TEXTURE_LONG_EDGE = 1600;
export const HISTORY_LIMIT = 60;

export const controlGroups = {
  light: [
    { id: "exposure", label: "Phơi sáng", min: -5, max: 5, step: 0.05, decimals: 2 },
    { id: "contrast", label: "Tương phản", min: -100, max: 100, step: 1 },
    { id: "highlights", label: "Vùng sáng", min: -100, max: 100, step: 1 },
    { id: "shadows", label: "Vùng tối", min: -100, max: 100, step: 1 },
    { id: "whites", label: "Điểm trắng", min: -100, max: 100, step: 1 },
    { id: "blacks", label: "Điểm đen", min: -100, max: 100, step: 1 },
  ],
  color: [
    { id: "temperature", label: "Nhiệt độ", min: -100, max: 100, step: 1, gradient: "linear-gradient(90deg,#246cff,#dadde1 50%,#f2c230)" },
    { id: "tint", label: "Sắc thái", min: -100, max: 100, step: 1, gradient: "linear-gradient(90deg,#28a461,#d8d8dc 50%,#d84bb4)" },
    { id: "vibrance", label: "Độ rực", min: -100, max: 100, step: 1, gradient: "linear-gradient(90deg,#777,#d7d7d7 48%,#29c8d9 68%,#1b67ff)" },
    { id: "saturation", label: "Bão hòa", min: -100, max: 100, step: 1, gradient: "linear-gradient(90deg,#777,#d9d9d9 48%,#ff315e 68%,#256cff)" },
  ],
  effects: [
    { id: "texture", label: "Kết cấu", min: -100, max: 100, step: 1 },
    { id: "clarity", label: "Độ nét cục bộ", min: -100, max: 100, step: 1 },
    { id: "dehaze", label: "Khử sương", min: -100, max: 100, step: 1 },
    { id: "vignette", label: "Tối góc", min: -100, max: 100, step: 1, gradient: "linear-gradient(90deg,#141518,#9b9da2 50%,#f2f2f2)" },
    { id: "grain", label: "Hạt phim", min: 0, max: 100, step: 1 },
    { id: "grainSize", label: "Cỡ hạt", min: 0, max: 100, step: 1, initial: 25 },
  ],
  detail: [
    { id: "sharpen", label: "Làm nét", min: 0, max: 150, step: 1 },
    { id: "noise", label: "Giảm nhiễu sáng", min: 0, max: 100, step: 1 },
    { id: "colorNoise", label: "Giảm nhiễu màu", min: 0, max: 100, step: 1 },
  ],
};

export const hslColors = [
  ["Red", "Đỏ", "#f04455", "#e843b5", "#ff9a35"],
  ["Orange", "Cam", "#f28b32", "#ef4356", "#f5cf42"],
  ["Yellow", "Vàng", "#e9c938", "#ef8d35", "#7cc84b"],
  ["Green", "Lục", "#55bd63", "#e3c83a", "#25c9ba"],
  ["Aqua", "Xanh ngọc", "#2dc8c4", "#45bc68", "#318ff0"],
  ["Blue", "Xanh dương", "#337de8", "#28c5c3", "#8a58df"],
  ["Purple", "Tím", "#8e5dde", "#357fe7", "#e64caf"],
  ["Magenta", "Hồng tím", "#df4aa9", "#8d5adc", "#ee4956"],
];

export const hslGroups = {
  hue: hslColors.map(([id, label, color, left, right]) => ({ id: `hslHue${id}`, label, min: -100, max: 100, step: 1, gradient: `linear-gradient(90deg,${left},${color} 50%,${right})` })),
  saturation: hslColors.map(([id, label, color]) => ({ id: `hslSat${id}`, label, min: -100, max: 100, step: 1, gradient: `linear-gradient(90deg,#777,${color})` })),
  luminance: hslColors.map(([id, label, color]) => ({ id: `hslLum${id}`, label, min: -100, max: 100, step: 1, gradient: `linear-gradient(90deg,#171719,${color} 50%,#f3f3f3)` })),
};

export const maskControlGroup = [
  { id: "temperature", label: "Nhiệt độ", min: -100, max: 100, step: 1, gradient: "linear-gradient(90deg,#246cff,#dadde1 50%,#f2c230)" },
  { id: "tint", label: "Sắc thái", min: -100, max: 100, step: 1, gradient: "linear-gradient(90deg,#28a461,#d8d8dc 50%,#d84bb4)" },
  { id: "exposure", label: "Phơi sáng", min: -4, max: 4, step: 0.05, decimals: 2 },
  { id: "contrast", label: "Tương phản", min: -100, max: 100, step: 1 },
  { id: "highlights", label: "Vùng sáng", min: -100, max: 100, step: 1 },
  { id: "shadows", label: "Vùng tối", min: -100, max: 100, step: 1 },
  { id: "whites", label: "Điểm trắng", min: -100, max: 100, step: 1 },
  { id: "blacks", label: "Điểm đen", min: -100, max: 100, step: 1 },
  { id: "saturation", label: "Bão hòa", min: -100, max: 100, step: 1, gradient: "linear-gradient(90deg,#777,#d9d9d9 48%,#ff315e 68%,#256cff)" },
  { id: "clarity", label: "Độ nét cục bộ", min: -100, max: 100, step: 1 },
  { id: "dehaze", label: "Khử sương", min: -100, max: 100, step: 1 },
  { id: "sharpness", label: "Độ sắc nét", min: -100, max: 100, step: 1 },
  { id: "noise", label: "Giảm nhiễu", min: 0, max: 100, step: 1 },
  { id: "moire", label: "Giảm moiré màu", min: 0, max: 100, step: 1 },
  { id: "defringe", label: "Khử viền tím/lục", min: 0, max: 100, step: 1 },
  { id: "strength", label: "Cường độ", min: 0, max: 100, step: 1, initial: 100 },
];

export const allGlobalControls = [
  ...Object.values(controlGroups).flat(),
  ...Object.values(hslGroups).flat(),
];

export const valueDefaults = Object.fromEntries(allGlobalControls.map((c) => [c.id, c.initial ?? 0]));
export const maskValueDefaults = Object.fromEntries(maskControlGroup.map((c) => [c.id, c.initial ?? 0]));
export const controlById = Object.fromEntries(allGlobalControls.map((c) => [c.id, c]));
export const maskControlById = Object.fromEntries(maskControlGroup.map((c) => [c.id, c]));

export const gradeZones = [
  { id: "shadows", label: "Vùng tối" },
  { id: "midtones", label: "Trung tính" },
  { id: "highlights", label: "Vùng sáng" },
  { id: "global", label: "Toàn cục" },
];

export const maskTypes = {
  sky: { label: "Bầu trời", short: "Trời" },
  brush: { label: "Cọ vùng", short: "Cọ" },
  linear: { label: "Gradient", short: "Gradient" },
  radial: { label: "Oval", short: "Oval" },
};

export const aspectRatios = [
  { id: "free", label: "Tự do", value: null },
  { id: "original", label: "Như ảnh gốc", value: "original" },
  { id: "1:1", label: "1 : 1", value: 1 },
  { id: "4:5", label: "4 : 5", value: 4 / 5 },
  { id: "5:4", label: "5 : 4", value: 5 / 4 },
  { id: "3:2", label: "3 : 2", value: 3 / 2 },
  { id: "2:3", label: "2 : 3", value: 2 / 3 },
  { id: "16:9", label: "16 : 9", value: 16 / 9 },
  { id: "9:16", label: "9 : 16", value: 9 / 16 },
];

// Nhóm thiết lập dùng cho Sao chép / Dán / Đồng bộ.
export const settingGroups = [
  { id: "light", label: "Ánh sáng", keys: controlGroups.light.map((c) => c.id) },
  { id: "color", label: "Cân bằng màu", keys: controlGroups.color.map((c) => c.id) },
  { id: "hsl", label: "Bộ trộn HSL", keys: Object.values(hslGroups).flat().map((c) => c.id) },
  { id: "effects", label: "Hiệu ứng", keys: controlGroups.effects.map((c) => c.id) },
  { id: "detail", label: "Chi tiết", keys: controlGroups.detail.map((c) => c.id) },
  { id: "curve", label: "Đường cong tông" },
  { id: "grade", label: "Phân màu" },
  { id: "masks", label: "Vùng chọn (trừ cọ)" },
  { id: "crop", label: "Cắt & xoay" },
];

const v = (values) => ({ ...valueDefaults, ...values });

export const builtInPresets = [
  { id: "natural", name: "TỰ NHIÊN", source: "builtin", settings: { values: v({}) } },
  { id: "cinematic", name: "CINEMATIC", source: "builtin", settings: {
    values: v({ exposure: 0.15, contrast: 18, highlights: -24, shadows: 16, blacks: -12, temperature: 8, tint: 3, saturation: -4, vibrance: 18, clarity: 12, dehaze: 8, vignette: -16, grain: 7 }),
    grade: { shadows: { h: 195, s: 22, l: 0 }, highlights: { h: 38, s: 18, l: 0 } },
  } },
  { id: "autumn", name: "THU ÂU", source: "builtin", settings: {
    values: v({ exposure: 0.25, contrast: 14, highlights: -18, shadows: 24, whites: 8, blacks: -8, temperature: 22, tint: 6, saturation: 8, vibrance: 28, clarity: 9, dehaze: 5, vignette: -13, grain: 4, hslHueGreen: -18, hslSatGreen: -10, hslSatOrange: 12 }),
  } },
  { id: "matte", name: "FILM MATTE", source: "builtin", settings: {
    values: v({ exposure: 0.1, contrast: -8, highlights: -28, shadows: 30, whites: -12, blacks: 24, temperature: 10, tint: 4, saturation: -12, vibrance: 10, clarity: -5, vignette: -10, grain: 18 }),
    curve: { master: [[0, 0.08], [0.25, 0.26], [0.75, 0.76], [1, 0.95]] },
  } },
  { id: "teal-orange", name: "TEAL & ORANGE", source: "builtin", settings: {
    values: v({ contrast: 16, highlights: -20, shadows: 12, vibrance: 14, hslHueAqua: 12, hslHueBlue: -8, hslSatOrange: 10, hslLumOrange: 6 }),
    grade: { shadows: { h: 190, s: 34, l: -4 }, highlights: { h: 32, s: 28, l: 2 }, blending: 60 },
  } },
  { id: "bw-classic", name: "ĐEN TRẮNG CỔ ĐIỂN", source: "builtin", settings: {
    values: v({ saturation: -100, contrast: 24, highlights: -12, shadows: 10, whites: 10, blacks: -10, clarity: 14, grain: 12, vignette: -12, hslLumBlue: -20, hslLumOrange: 14 }),
    curve: { master: [[0, 0], [0.25, 0.2], [0.75, 0.8], [1, 1]] },
  } },
  { id: "fade", name: "PHAI NHẸ", source: "builtin", settings: {
    values: v({ contrast: -12, highlights: -10, shadows: 14, saturation: -18, temperature: 6 }),
    curve: { master: [[0, 0.12], [0.5, 0.52], [1, 0.94]] },
  } },
];
