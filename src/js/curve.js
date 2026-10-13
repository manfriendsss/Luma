// Đường cong tông: nội suy cubic đơn điệu (Fritsch–Carlson) để không bị "vượt" giữa các điểm.

export const LUT_SIZE = 1024;

export function sortPoints(points) {
  return [...points].sort((a, b) => a[0] - b[0]);
}

export function makeCurveEvaluator(rawPoints) {
  const points = sortPoints(rawPoints).filter((p, i, arr) => i === 0 || p[0] > arr[i - 1][0] + 1e-6);
  if (points.length === 0) return (x) => x;
  if (points.length === 1) return () => points[0][1];
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const delta = [];
  for (let i = 0; i < n - 1; i++) delta.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / delta[i];
    const b = m[i + 1] / delta[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * delta[i];
      m[i + 1] = t * b * delta[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** LUT RGBA float: kênh R/G/B = đường cong kênh ∘ đường cong tổng. */
export function buildCurveLut(curve) {
  const master = makeCurveEvaluator(curve.master);
  const channels = [makeCurveEvaluator(curve.r), makeCurveEvaluator(curve.g), makeCurveEvaluator(curve.b)];
  const lut = new Float32Array(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i++) {
    const x = i / (LUT_SIZE - 1);
    const mx = clamp01(master(x));
    lut[i * 4] = clamp01(channels[0](mx));
    lut[i * 4 + 1] = clamp01(channels[1](mx));
    lut[i * 4 + 2] = clamp01(channels[2](mx));
    lut[i * 4 + 3] = 1;
  }
  return lut;
}

/** Trộn hai đường cong (dùng cho thanh Cường độ preset). */
export function blendCurvePoints(basePoints, targetPoints, amount, samples = 9) {
  if (amount === 1) return targetPoints.map(([x, y]) => [x, y]);
  if (amount === 0) return basePoints.map(([x, y]) => [x, y]);
  const a = makeCurveEvaluator(basePoints);
  const b = makeCurveEvaluator(targetPoints);
  const out = [];
  for (let i = 0; i < samples; i++) {
    const x = i / (samples - 1);
    out.push([x, clamp01(a(x) + (b(x) - a(x)) * amount)]);
  }
  return out;
}

/** Đường cong tham số kiểu Lightroom (Shadows/Darks/Lights/Highlights) → các điểm. */
export function parametricToPoints({ shadows = 0, darks = 0, lights = 0, highlights = 0, s1 = 25, s2 = 50, s3 = 75 }) {
  if (!shadows && !darks && !lights && !highlights) return null;
  const p1 = s1 / 100;
  const p2 = s2 / 100;
  const p3 = s3 / 100;
  const regions = [
    [shadows, 0, p1],
    [darks, p1, p2],
    [lights, p2, p3],
    [highlights, p3, 1],
  ];
  const f = (x) => {
    let y = x;
    for (const [amount, a, b] of regions) {
      if (!amount) continue;
      const c = (a + b) / 2;
      const w = Math.max(0.08, (b - a));
      const bump = Math.max(0, 1 - ((x - c) / w) ** 2);
      y += (amount / 100) * 0.16 * bump * bump;
    }
    return clamp01(y);
  };
  const out = [];
  for (let i = 0; i <= 8; i++) {
    const x = i / 8;
    out.push([x, f(x)]);
  }
  out[0][1] = clamp01(out[0][1]);
  return out;
}

export function composeCurves(firstPoints, secondPoints, samples = 11) {
  const a = makeCurveEvaluator(firstPoints);
  const b = makeCurveEvaluator(secondPoints);
  const out = [];
  for (let i = 0; i < samples; i++) {
    const x = i / (samples - 1);
    out.push([x, clamp01(b(clamp01(a(x))))]);
  }
  return out;
}
