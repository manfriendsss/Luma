// Nhập / xuất preset. Thuần JS (không dùng DOM) để chạy được trong test Node.
import { valueDefaults, controlById, hslColors } from "./config.js";

const NUMBER = "([+-]?\\d+(?:\\.\\d+)?)";
const escapeRegex = (key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Đọc một trường số. Có ranh giới phía trước để `Tint` không khớp nhầm `ShadowTint`,
 * `Clarity2012` không khớp `LocalClarity2012`…
 */
export function extractPresetValue(text, key) {
  const k = escapeRegex(key);
  const patterns = [
    new RegExp(`(?<![A-Za-z0-9_])(?:crs:)?${k}\\s*=\\s*["']?${NUMBER}`),
    new RegExp(`<crs:${k}(?:\\s[^>]*)?>\\s*${NUMBER}\\s*</crs:${k}>`),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

/** Đọc danh sách điểm đường cong (XMP rdf:Seq hoặc bảng Lua của .lrtemplate). */
export function extractCurvePoints(text, key) {
  const k = escapeRegex(key);
  const xmp = text.match(new RegExp(`<crs:${k}>\\s*<rdf:Seq>([\\s\\S]*?)</rdf:Seq>`));
  let numbers = null;
  if (xmp) {
    numbers = [...xmp[1].matchAll(/<rdf:li>\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*<\/rdf:li>/g)].flatMap((m) => [Number(m[1]), Number(m[2])]);
  } else {
    const lua = text.match(new RegExp(`(?<![A-Za-z0-9_])${k}\\s*=\\s*\\{([^}]*)\\}`));
    if (lua) numbers = [...lua[1].matchAll(/[+-]?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  }
  if (!numbers || numbers.length < 4) return null;
  const points = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) points.push([numbers[i] / 255, numbers[i + 1] / 255]);
  return points.map(([x, y]) => [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]);
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const clampControl = (id, value) => {
  const c = controlById[id];
  return c ? clamp(value, c.min, c.max) : value;
};

const xmlUnescape = (s) => s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
  const named = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" }[e.toLowerCase()];
  if (named) return named;
  const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return Number.isFinite(code) ? String.fromCodePoint(code) : m;
});

function presetTitle(text, fileName) {
  const patterns = [
    /<crs:Name>\s*<rdf:Alt>\s*<rdf:li[^>]*>([^<]+)<\/rdf:li>/i,
    /<dc:title>\s*<rdf:Alt>\s*<rdf:li[^>]*>([^<]+)<\/rdf:li>/i,
    /(?<![A-Za-z0-9_])title\s*=\s*"([^"]+)"/,
    /(?<![A-Za-z0-9_])(?:crs:)?(?:PresetName|Name)\s*=\s*"([^"]+)"/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1].trim() && !m[1].includes("$$$")) return xmlUnescape(m[1].trim());
  }
  return fileName.replace(/\.[^.]+$/, "");
}

/**
 * Phân tích preset Lightroom (.xmp, .lrtemplate) hoặc JSON LUMA.
 * Trả về thiết lập từng phần: chỉ các trường có trong file (đúng ngữ nghĩa preset Lightroom).
 */
export function parseLightroomPreset(text, fileName) {
  if (fileName.toLowerCase().endsWith(".json")) return parseLumaJson(text, fileName);

  const values = {};
  const simple = {
    exposure: "Exposure2012", contrast: "Contrast2012", highlights: "Highlights2012", shadows: "Shadows2012",
    whites: "Whites2012", blacks: "Blacks2012", saturation: "Saturation", vibrance: "Vibrance",
    texture: "Texture", clarity: "Clarity2012", dehaze: "Dehaze",
    // Lightroom và LUMA cùng quy ước: âm = tối góc.
    vignette: "PostCropVignetteAmount",
    grain: "GrainAmount", grainSize: "GrainSize",
    sharpen: "Sharpness", noise: "LuminanceSmoothing", colorNoise: "ColorNoiseReduction",
  };
  for (const [target, source] of Object.entries(simple)) {
    const found = extractPresetValue(text, source);
    if (found !== null) values[target] = clampControl(target, found);
  }

  // Cân bằng trắng: preset cho JPEG dùng Incremental*, preset RAW dùng Kelvin.
  const incTemp = extractPresetValue(text, "IncrementalTemperature");
  const incTint = extractPresetValue(text, "IncrementalTint");
  if (incTemp !== null) values.temperature = clampControl("temperature", incTemp);
  else {
    const kelvin = extractPresetValue(text, "Temperature");
    if (kelvin !== null) {
      values.temperature = kelvin > 1000 ? clampControl("temperature", (1e6 / 5500 - 1e6 / kelvin) * 0.85) : clampControl("temperature", kelvin);
    }
  }
  if (incTint !== null) values.tint = clampControl("tint", incTint);
  else {
    const tint = extractPresetValue(text, "Tint");
    if (tint !== null) values.tint = clampControl("tint", tint / 1.5);
  }

  // HSL 8 dải màu – trùng tên với Lightroom.
  for (const [id] of hslColors) {
    for (const [prefix, target] of [["HueAdjustment", "hslHue"], ["SaturationAdjustment", "hslSat"], ["LuminanceAdjustment", "hslLum"]]) {
      const found = extractPresetValue(text, `${prefix}${id}`);
      if (found !== null) values[`${target}${id}`] = clampControl(`${target}${id}`, found);
    }
  }

  // Đường cong tông
  const curve = {};
  const pointCurve = extractCurvePoints(text, "ToneCurvePV2012");
  // Đường cong tham số giữ nguyên dạng tham số (paramShadows…), áp dụng trước đường cong điểm
  for (const [target, source] of [
    ["paramShadows", "ParametricShadows"], ["paramDarks", "ParametricDarks"], ["paramLights", "ParametricLights"], ["paramHighlights", "ParametricHighlights"],
    ["paramSplit1", "ParametricShadowSplit"], ["paramSplit2", "ParametricMidtoneSplit"], ["paramSplit3", "ParametricHighlightSplit"],
  ]) {
    const found = extractPresetValue(text, source);
    if (found !== null) values[target] = clampControl(target, found);
  }
  if (pointCurve) curve.master = pointCurve;
  // Hiệu chỉnh màu gốc (Camera Calibration)
  for (const [target, source] of [
    ["calShadowTint", "ShadowTint"], ["calRedHue", "RedHue"], ["calRedSat", "RedSaturation"],
    ["calGreenHue", "GreenHue"], ["calGreenSat", "GreenSaturation"], ["calBlueHue", "BlueHue"], ["calBlueSat", "BlueSaturation"],
  ]) {
    const found = extractPresetValue(text, source);
    if (found !== null) values[target] = clampControl(target, found);
  }
  for (const [ch, key] of [["r", "ToneCurvePV2012Red"], ["g", "ToneCurvePV2012Green"], ["b", "ToneCurvePV2012Blue"]]) {
    const pts = extractCurvePoints(text, key);
    if (pts) curve[ch] = pts;
  }

  // Phân màu (Color Grading) – ưu tiên ColorGrade*, nếu không có thì dùng Split Toning cũ.
  const grade = {};
  const zoneKeys = { shadows: "Shadow", midtones: "Midtone", highlights: "Highlight", global: "Global" };
  for (const [zone, key] of Object.entries(zoneKeys)) {
    const h = extractPresetValue(text, `ColorGrade${key}Hue`);
    const s = extractPresetValue(text, `ColorGrade${key}Sat`);
    const l = extractPresetValue(text, `ColorGrade${key}Lum`);
    if (h !== null || s !== null || l !== null) grade[zone] = { h: clamp(h ?? 0, 0, 360), s: clamp(s ?? 0, 0, 100), l: clamp(l ?? 0, -100, 100) };
  }
  if (!grade.shadows) {
    const h = extractPresetValue(text, "SplitToningShadowHue");
    const s = extractPresetValue(text, "SplitToningShadowSaturation");
    if (h !== null || s !== null) grade.shadows = { h: clamp(h ?? 0, 0, 360), s: clamp(s ?? 0, 0, 100), l: 0 };
  }
  if (!grade.highlights) {
    const h = extractPresetValue(text, "SplitToningHighlightHue");
    const s = extractPresetValue(text, "SplitToningHighlightSaturation");
    if (h !== null || s !== null) grade.highlights = { h: clamp(h ?? 0, 0, 360), s: clamp(s ?? 0, 0, 100), l: 0 };
  }
  const blending = extractPresetValue(text, "ColorGradeBlending");
  if (blending !== null) grade.blending = clamp(blending, 0, 100);
  const balance = extractPresetValue(text, "SplitToningBalance");
  if (balance !== null) grade.balance = clamp(balance, -100, 100);

  const settings = {};
  if (Object.keys(values).length) settings.values = values;
  if (Object.keys(curve).length) settings.curve = curve;
  if (Object.keys(grade).length) settings.grade = grade;
  if (!Object.keys(settings).length) throw new Error(`${fileName}: preset không có thông số tương thích.`);
  return { name: presetTitle(text, fileName).toUpperCase(), settings };
}

function parseLumaJson(text, fileName) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error(`${fileName}: JSON không hợp lệ.`); }
  // Hỗ trợ định dạng cũ { name, values } và định dạng mới { format: "luma-preset", settings }
  const source = raw.settings?.values || raw.values || raw.settings || raw;
  const values = {};
  for (const key of Object.keys(valueDefaults)) {
    if (source[key] !== undefined && Number.isFinite(Number(source[key]))) values[key] = clampControl(key, source[key]);
  }
  const settings = {};
  if (Object.keys(values).length) settings.values = values;
  if (raw.settings?.curve) settings.curve = sanitizeCurve(raw.settings.curve);
  if (raw.settings?.grade) settings.grade = raw.settings.grade;
  if (!Object.keys(settings).length) throw new Error(`${fileName}: không tìm thấy thông số màu.`);
  return { name: String(raw.name || fileName.replace(/\.[^.]+$/, "")).toUpperCase(), settings };
}

function sanitizeCurve(curve) {
  const out = {};
  for (const ch of ["master", "r", "g", "b"]) {
    if (Array.isArray(curve[ch]) && curve[ch].length >= 2) {
      out[ch] = curve[ch].map(([x, y]) => [clamp(x, 0, 1), clamp(y, 0, 1)]);
    }
  }
  return out;
}

export function presetToLumaJson(preset) {
  return JSON.stringify({ format: "luma-preset", version: 2, name: preset.name, settings: preset.settings }, null, 2);
}

const xmlEscape = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
const signed = (n, decimals = 0) => (n > 0 ? "+" : "") + Number(n).toFixed(decimals);

/** Xuất preset sang XMP tương thích Lightroom Classic / Camera Raw (ở mức các trường tương đương). */
export function presetToXmp(preset, uuid = "00000000000000000000000000000000") {
  const v = { ...valueDefaults, ...(preset.settings.values || {}) };
  const attrs = {
    PresetType: "Normal", Cluster: "", UUID: uuid, SupportsAmount: "True", SupportsColor: "True", SupportsMonochrome: "True",
    SupportsHighDynamicRange: "True", SupportsNormalDynamicRange: "True", SupportsSceneReferred: "True", SupportsOutputReferred: "True",
    CameraModelRestriction: "", Copyright: "", ContactInfo: "", Version: "15.0", ProcessVersion: "11.0",
    Exposure2012: signed(v.exposure, 2), Contrast2012: signed(v.contrast), Highlights2012: signed(v.highlights), Shadows2012: signed(v.shadows),
    Whites2012: signed(v.whites), Blacks2012: signed(v.blacks), IncrementalTemperature: signed(v.temperature), IncrementalTint: signed(v.tint),
    Texture: signed(v.texture), Clarity2012: signed(v.clarity), Dehaze: signed(v.dehaze), Vibrance: signed(v.vibrance), Saturation: signed(v.saturation),
    PostCropVignetteAmount: signed(v.vignette), GrainAmount: String(v.grain), GrainSize: String(v.grainSize),
    Sharpness: String(v.sharpen), LuminanceSmoothing: String(v.noise), ColorNoiseReduction: String(v.colorNoise),
    ParametricShadows: signed(v.paramShadows), ParametricDarks: signed(v.paramDarks), ParametricLights: signed(v.paramLights), ParametricHighlights: signed(v.paramHighlights),
    ParametricShadowSplit: String(v.paramSplit1), ParametricMidtoneSplit: String(v.paramSplit2), ParametricHighlightSplit: String(v.paramSplit3),
    ShadowTint: signed(v.calShadowTint), RedHue: signed(v.calRedHue), RedSaturation: signed(v.calRedSat),
    GreenHue: signed(v.calGreenHue), GreenSaturation: signed(v.calGreenSat), BlueHue: signed(v.calBlueHue), BlueSaturation: signed(v.calBlueSat),
  };
  for (const [id] of hslColors) {
    attrs[`HueAdjustment${id}`] = signed(v[`hslHue${id}`]);
    attrs[`SaturationAdjustment${id}`] = signed(v[`hslSat${id}`]);
    attrs[`LuminanceAdjustment${id}`] = signed(v[`hslLum${id}`]);
  }
  const grade = preset.settings.grade;
  if (grade) {
    const zoneKeys = { shadows: "Shadow", midtones: "Midtone", highlights: "Highlight", global: "Global" };
    for (const [zone, key] of Object.entries(zoneKeys)) {
      const z = grade[zone];
      if (!z) continue;
      attrs[`ColorGrade${key}Hue`] = String(Math.round(z.h));
      attrs[`ColorGrade${key}Sat`] = String(Math.round(z.s));
      attrs[`ColorGrade${key}Lum`] = signed(Math.round(z.l || 0));
    }
    if (grade.blending !== undefined) attrs.ColorGradeBlending = String(grade.blending);
    if (grade.balance !== undefined) attrs.SplitToningBalance = signed(grade.balance);
  }
  attrs.HasSettings = "True";
  const attrText = Object.entries(attrs).map(([k, val]) => `    crs:${k}="${xmlEscape(val)}"`).join("\n");
  const curveXml = (key, points) => points
    ? `   <crs:${key}>\n    <rdf:Seq>\n${points.map(([x, y]) => `     <rdf:li>${Math.round(x * 255)}, ${Math.round(y * 255)}</rdf:li>`).join("\n")}\n    </rdf:Seq>\n   </crs:${key}>\n`
    : "";
  const c = preset.settings.curve || {};
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="LUMA">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
${attrText}>
   <crs:Name>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${xmlEscape(preset.name)}</rdf:li>
    </rdf:Alt>
   </crs:Name>
${curveXml("ToneCurvePV2012", c.master)}${curveXml("ToneCurvePV2012Red", c.r)}${curveXml("ToneCurvePV2012Green", c.g)}${curveXml("ToneCurvePV2012Blue", c.b)}  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`;
}

/** Chuyển preset đã lưu ở định dạng cũ ({ values }) sang định dạng mới ({ settings }). */
export function migrateStoredPreset(preset) {
  if (preset.settings) return preset;
  return { id: preset.id, name: preset.name, source: "imported", settings: { values: { ...(preset.values || {}) } } };
}
