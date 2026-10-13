// Hình học cắt/xoay không phá huỷ.
// Chuỗi biến đổi từ toạ độ đầu ra (u,v ∈ [0,1], y hướng xuống) về pixel ảnh gốc:
//   p = ((u-0.5)·W, (v-0.5)·H) → lật ngang (nếu có) → xoay ngược quarter·90° → xoay thẳng θ → + tâm.
// Khung cắt (w,h) được định nghĩa trong "khung đã nắn thẳng" trước khi xoay 90°.

// Góc dương = nội dung ảnh xoay theo chiều kim đồng hồ (giống Lightroom).
const DEG = -Math.PI / 180;

export function quarterOf(crop) {
  return ((crop.quarter || 0) % 4 + 4) % 4;
}

/** Kích thước đầu ra sau khi cắt (pixel ảnh gốc). */
export function outputSize(crop) {
  const q = quarterOf(crop);
  return q % 2 ? { width: crop.h, height: crop.w } : { width: crop.w, height: crop.h };
}

const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3]];
const apply = (m, x, y) => [m[0] * x + m[1] * y, m[2] * x + m[3] * y];

function rotation(theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [c, -s, s, c];
}

// Xoay ngược chiều kim đồng hồ (trong hệ y hướng xuống) q lần 90°: (x,y) → (y,-x)
function ccwQuarter(q) {
  let m = [1, 0, 0, 1];
  for (let i = 0; i < q; i++) m = mul([0, 1, -1, 0], m);
  return m;
}

/** Ma trận 2×2 (hàng trước) ánh xạ (u-0.5, v-0.5) → độ lệch pixel gốc so với tâm. */
export function cropMatrix(crop) {
  const { width, height } = outputSize(crop);
  const flip = crop.flip ? [-1, 0, 0, 1] : [1, 0, 0, 1];
  const scale = [width, 0, 0, height];
  return mul(rotation((crop.angle || 0) * DEG), mul(ccwQuarter(quarterOf(crop)), mul(flip, scale)));
}

export function invert2(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
}

export function outputToSource(crop, u, v) {
  const [dx, dy] = apply(cropMatrix(crop), u - 0.5, v - 0.5);
  return { x: crop.cx + dx, y: crop.cy + dy };
}

export function sourceToOutput(crop, x, y) {
  const [u, v] = apply(invert2(cropMatrix(crop)), x - crop.cx, y - crop.cy);
  return { u: u + 0.5, v: v + 0.5 };
}

/** Góc (độ) mà nội dung ảnh gốc bị xoay khi hiển thị ở đầu ra – dùng để vẽ oval. */
export function sourceToOutputLinear(crop) {
  return invert2(cropMatrix(crop));
}

function cornersInside(crop, imageWidth, imageHeight, w, h) {
  const r = rotation((crop.angle || 0) * DEG);
  const eps = 0.5;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const [dx, dy] = apply(r, (sx * w) / 2, (sy * h) / 2);
    const x = crop.cx + dx;
    const y = crop.cy + dy;
    if (x < -eps || y < -eps || x > imageWidth + eps || y > imageHeight + eps) return false;
  }
  return true;
}

/** Thu nhỏ khung cắt (giữ tâm và tỉ lệ) cho tới khi nằm trọn trong ảnh. */
export function fitCropInside(crop, imageWidth, imageHeight) {
  const out = { ...crop };
  const targetW = Math.max(8, out.iw ?? out.w);
  const targetH = Math.max(8, out.ih ?? out.h);
  out.iw = targetW;
  out.ih = targetH;
  out.cx = Math.min(imageWidth, Math.max(0, out.cx));
  out.cy = Math.min(imageHeight, Math.max(0, out.cy));
  if (!cornersInside(out, imageWidth, imageHeight, 8, 8)) {
    out.cx = imageWidth / 2;
    out.cy = imageHeight / 2;
  }
  if (cornersInside(out, imageWidth, imageHeight, targetW, targetH)) {
    out.w = targetW;
    out.h = targetH;
    return out;
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (cornersInside(out, imageWidth, imageHeight, targetW * mid, targetH * mid)) lo = mid;
    else hi = mid;
  }
  out.w = Math.max(8, targetW * lo);
  out.h = Math.max(8, targetH * lo);
  return out;
}

export function isCropInside(crop, imageWidth, imageHeight) {
  return cornersInside(crop, imageWidth, imageHeight, crop.w, crop.h);
}

/** Khung chứa toàn bộ ảnh sau khi nắn thẳng – dùng khi đang ở chế độ cắt. */
export function straightenedBounds(crop, imageWidth, imageHeight) {
  const t = Math.abs((crop.angle || 0) * DEG);
  const w = imageWidth * Math.cos(t) + imageHeight * Math.sin(t);
  const h = imageWidth * Math.sin(t) + imageHeight * Math.cos(t);
  return { ...crop, cx: imageWidth / 2, cy: imageHeight / 2, w, h };
}

/** Chuyển khung cắt sang hệ "hiển thị" (đã xoay 90° và lật) của khung bao trong chế độ cắt. */
export function cropRectInView(crop, imageWidth, imageHeight) {
  const view = straightenedBounds(crop, imageWidth, imageHeight);
  const r = rotation(-(crop.angle || 0) * DEG);
  const [px, py] = apply(r, crop.cx - view.cx, crop.cy - view.cy);
  const q = quarterOf(crop);
  // p_disp = Flip · CW^q · p_pre ; CW^q = (CCW^q)^-1
  let [x, y] = apply(invert2(ccwQuarter(q)), px, py);
  if (crop.flip) x = -x;
  const size = outputSize(crop);
  const viewSize = outputSize(view);
  return {
    view,
    viewWidth: viewSize.width,
    viewHeight: viewSize.height,
    // Toạ độ chuẩn hoá trong khung hiển thị (0..1)
    x: (x - size.width / 2) / viewSize.width + 0.5,
    y: (y - size.height / 2) / viewSize.height + 0.5,
    w: size.width / viewSize.width,
    h: size.height / viewSize.height,
  };
}

/** Ngược lại: từ hình chữ nhật trong khung hiển thị → crop. */
export function cropFromViewRect(crop, imageWidth, imageHeight, rect) {
  const view = straightenedBounds(crop, imageWidth, imageHeight);
  const viewSize = outputSize(view);
  const q = quarterOf(crop);
  const dispW = rect.w * viewSize.width;
  const dispH = rect.h * viewSize.height;
  let x = (rect.x + rect.w / 2 - 0.5) * viewSize.width;
  const y = (rect.y + rect.h / 2 - 0.5) * viewSize.height;
  if (crop.flip) x = -x;
  const [px, py] = apply(ccwQuarter(q), x, y);
  const [dx, dy] = apply(rotation((crop.angle || 0) * DEG), px, py);
  const w = q % 2 ? dispH : dispW;
  const h = q % 2 ? dispW : dispH;
  return { ...crop, cx: view.cx + dx, cy: view.cy + dy, w, h, iw: w, ih: h };
}

export function rotateQuarter(crop, direction) {
  // direction = 1: xoay phải (theo chiều kim đồng hồ); -1: xoay trái
  const step = crop.flip ? -direction : direction;
  return { ...crop, quarter: ((quarterOf(crop) + step) % 4 + 4) % 4 };
}

export function aspectValue(aspectId, imageWidth, imageHeight, crop) {
  if (!aspectId || aspectId === "free") return null;
  if (aspectId === "original") {
    const q = quarterOf(crop);
    return q % 2 ? imageHeight / imageWidth : imageWidth / imageHeight;
  }
  const [a, b] = aspectId.split(":").map(Number);
  return a / b;
}

/** Đặt khung theo tỉ lệ (tỉ lệ tính trên ảnh đầu ra), giữ tâm, vừa nhất có thể. */
export function applyAspect(crop, aspect, imageWidth, imageHeight) {
  if (!aspect) return { ...crop };
  const q = quarterOf(crop);
  const preAspect = q % 2 ? 1 / aspect : aspect; // w/h trong khung trước khi xoay 90°
  const area = Math.max(crop.w, crop.h) ** 2;
  let w = Math.sqrt(area * preAspect);
  let h = w / preAspect;
  const big = Math.max(imageWidth, imageHeight) * 2;
  const scale = big / Math.max(w, h);
  w *= scale;
  h *= scale;
  return fitCropInside({ ...crop, iw: w, ih: h }, imageWidth, imageHeight);
}
