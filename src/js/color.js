// Toán màu dùng chung giữa JS và shader (giữ hằng số đồng bộ với renderer.js).

export const WB_TEMP_K = 0.5;
export const WB_TINT_K = 0.4;

export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(c) {
  const v = Math.max(0, c);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

export const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Hệ số nhân cân bằng trắng (tuyến tính) cho nhiệt độ/sắc thái trong khoảng -100..100. */
export function whiteBalanceMultipliers(temperature, tint) {
  const t = temperature / 100;
  const g = tint / 100;
  const r = 2 ** (t * WB_TEMP_K + g * WB_TINT_K * 0.5);
  const gg = 2 ** (-g * WB_TINT_K);
  const b = 2 ** (-t * WB_TEMP_K + g * WB_TINT_K * 0.5);
  const norm = luma(r, gg, b);
  return [r / norm, gg / norm, b / norm];
}

/** Tìm nhiệt độ/sắc thái khiến màu tuyến tính (r,g,b) thành trung tính. */
export function neutralizeWhiteBalance([r, g, b], strength = 1) {
  const eps = 1e-4;
  const lr = Math.log2(Math.max(eps, r));
  const lg = Math.log2(Math.max(eps, g));
  const lb = Math.log2(Math.max(eps, b));
  const t = (lb - lr) / (2 * WB_TEMP_K);
  const gt = (lg - (lr + lb) / 2) / (1.5 * WB_TINT_K);
  const clamp = (v) => Math.round(Math.max(-100, Math.min(100, v * 100 * strength)));
  return { temperature: clamp(t), tint: clamp(gt) };
}

/**
 * Thống kê ảnh (pixel sRGB 8-bit RGBA) cho Auto Tone / Auto WB.
 * Trả về phân vị độ sáng (gamma) và trung bình màu tuyến tính của vùng hợp lệ.
 */
export function analyzePixels(data) {
  const hist = new Uint32Array(256);
  let sr = 0, sg = 0, sb = 0, count = 0, clipped = 0, total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    hist[y] += 1;
    total += 1;
    if (r >= 254 || g >= 254 || b >= 254) clipped += 1;
    if (y > 20 && y < 235 && Math.max(r, g, b) < 250) {
      sr += srgbToLinear(r / 255);
      sg += srgbToLinear(g / 255);
      sb += srgbToLinear(b / 255);
      count += 1;
    }
  }
  const percentile = (p) => {
    const target = total * p;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) return i / 255;
    }
    return 1;
  };
  return {
    p005: percentile(0.005), p10: percentile(0.1), p50: percentile(0.5), p90: percentile(0.9), p995: percentile(0.995),
    clipFraction: total ? clipped / total : 0,
    meanLinear: count ? [sr / count, sg / count, sb / count] : [0.18, 0.18, 0.18],
  };
}

export function autoTone(stats) {
  const lift = (p, ev) => linearToSrgb(srgbToLinear(p) * 2 ** ev);
  const round = (v) => Math.round(v);
  let exposure = Math.log2(srgbToLinear(0.46) / Math.max(0.002, srgbToLinear(Math.max(0.01, stats.p50)))) * 0.75;
  exposure = Math.max(-2, Math.min(2, Math.round(exposure * 20) / 20));
  const hi = lift(stats.p995, exposure);
  const lo = lift(stats.p005, exposure);
  const p10 = lift(stats.p10, exposure);
  const p90 = lift(stats.p90, exposure);
  const out = { exposure, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 };
  if (hi >= 0.99 || stats.clipFraction > 0.01) out.highlights = -round(Math.min(70, 20 + stats.clipFraction * 900));
  else if (hi < 0.93) out.whites = round(Math.min(45, (0.96 - hi) * 140));
  if (lo > 0.05) out.blacks = -round(Math.min(45, (lo - 0.02) * 160));
  if (p10 < 0.12) out.shadows = round(Math.min(45, (0.16 - p10) * 220));
  const spread = p90 - p10;
  if (spread < 0.55) out.contrast = round(Math.min(25, (0.6 - spread) * 70));
  return out;
}

export function autoWhiteBalance(stats) {
  return neutralizeWhiteBalance(stats.meanLinear, 0.85);
}

export function hueToRgb(hueDegrees) {
  const h = (((hueDegrees % 360) + 360) % 360) / 60;
  const x = 1 - Math.abs((h % 2) - 1);
  const table = [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]];
  return table[Math.floor(h) % 6];
}
