// Khung xem ảnh: bố cục, zoom/pan, render, histogram, lớp phủ và thao tác chuột (cọ, mask, cắt, chấm màu).
import { aspectRatios } from "./config.js";
import { cloneSettings } from "./settings.js";
import {
  outputSize, outputToSource, sourceToOutput, fitCropInside, isCropInside, straightenedBounds,
  cropRectInView, cropFromViewRect, aspectValue, lensParams,
} from "./geometry.js";
import { neutralizeWhiteBalance, srgbToLinear } from "./color.js";
import { computeHistogram, drawHistogram } from "./widgets.js";
import { setRangeProgress } from "./controls.js";
import {
  state, el, hooks, clamp, activePhoto, activeMask, record, beginGesture, endGesture, settingsChanged, showToast, setStatus,
} from "./core.js";
import { photoAnalysis } from "./photos.js";
import { syncMaskEditor, renderMaskUI, curveEditorRef, maskLabel } from "./panel.js";

let renderFrame = null;
let histogramTimer = null;
export let lastHistogram = null;

/* ============================================================
   Bố cục và zoom
   ============================================================ */

export function resetView() {
  state.view = { fit: true, scale: 1, panX: 0, panY: 0 };
}

const isWide = () => window.innerWidth > 850;

function displayCrop(photo) {
  const crop = photo.settings.crop;
  return state.tool === "crop" ? straightenedBounds(crop, photo.width, photo.height) : crop;
}

/** Méo ống kính đang áp dụng (null nếu không có hoặc nhóm Ống kính đang tắt). */
export function lensOf(photo, settings = photo.settings) {
  if (settings.disabled?.lens) return null;
  return lensParams(settings.values.distortion, photo.width, photo.height);
}

export function computeLayout(photo) {
  const vp = el.canvasViewport;
  const vw = vp.clientWidth;
  const vh = vp.clientHeight;
  // Ngăn preset đang mở che bên trái → căn ảnh vào phần còn lại
  const drawerOffset = state.drawerOpen && isWide() ? Math.max(0, el.presetDrawer.getBoundingClientRect().right - vp.getBoundingClientRect().left) : 0;
  const availW = Math.max(120, vw - drawerOffset);
  const crop = displayCrop(photo);
  const out = outputSize(crop);
  const pad = state.tool === "crop" ? 44 : 22;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const fitScale = Math.max(0.01, Math.min((availW - pad * 2) / out.width, (vh - pad * 2) / out.height, 1));
  const fixed = state.view.fit || state.tool === "crop";
  const scale = fixed ? fitScale : state.view.scale;
  const width = out.width * scale;
  const height = out.height * scale;
  const panX = fixed ? 0 : state.view.panX;
  const panY = fixed ? 0 : state.view.panY;
  return {
    vw, vh, dpr, crop, out, scale, fitScale, drawerOffset,
    x: drawerOffset + (availW - width) / 2 + panX, y: (vh - height) / 2 + panY, width, height,
  };
}

export function clampPan() {
  const photo = activePhoto();
  if (!photo || state.view.fit) return;
  const l = computeLayout(photo);
  const maxX = Math.max(0, (l.width - l.vw) / 2 + l.vw * 0.3);
  const maxY = Math.max(0, (l.height - l.vh) / 2 + l.vh * 0.3);
  state.view.panX = clamp(state.view.panX, -maxX, maxX);
  state.view.panY = clamp(state.view.panY, -maxY, maxY);
}

const zoomPercent = (layout) => Math.round(layout.scale * layout.dpr * 100);

export function setZoom(scale, anchorX, anchorY) {
  const photo = activePhoto();
  if (!photo || state.tool === "crop") return;
  const before = computeLayout(photo);
  const target = clamp(scale, Math.min(before.fitScale, 0.05), 16 / before.dpr);
  const ax = anchorX ?? before.vw / 2;
  const ay = anchorY ?? before.vh / 2;
  const u = (ax - before.x) / before.width;
  const v = (ay - before.y) / before.height;
  if (Math.abs(target - before.fitScale) < 1e-4) {
    resetView();
  } else {
    const newW = before.out.width * target;
    const newH = before.out.height * target;
    const availW = before.vw - before.drawerOffset;
    state.view.fit = false;
    state.view.scale = target;
    state.view.panX = ax - u * newW - before.drawerOffset - (availW - newW) / 2;
    state.view.panY = ay - v * newH - (before.vh - newH) / 2;
    clampPan();
  }
  scheduleRender();
}

const ZOOM_STEPS = [0.0625, 0.125, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
export function stepZoom(direction, anchorX, anchorY) {
  const photo = activePhoto();
  if (!photo) return;
  const l = computeLayout(photo);
  const current = l.scale * l.dpr;
  const next = direction > 0
    ? ZOOM_STEPS.find((s) => s > current * 1.01) ?? 16
    : [...ZOOM_STEPS].reverse().find((s) => s < current * 0.99) ?? ZOOM_STEPS[0];
  if (direction < 0 && next < l.fitScale * l.dpr) { fitView(); return; }
  setZoom(next / l.dpr, anchorX, anchorY);
}

export function fitView() { resetView(); scheduleRender(); }

export function actualSize(anchorX, anchorY) {
  const photo = activePhoto();
  if (!photo) return;
  setZoom(1 / computeLayout(photo).dpr, anchorX, anchorY);
}

export function updateDimensions() {
  const photo = activePhoto();
  if (!photo) return;
  const out = outputSize(photo.settings.crop);
  const cropped = Math.round(out.width) !== photo.width || Math.round(out.height) !== photo.height;
  el.fileDimensions.textContent = cropped
    ? `${Math.round(out.width)} × ${Math.round(out.height)} (gốc ${photo.width} × ${photo.height})`
    : `${photo.width} × ${photo.height}`;
}

/* ============================================================
   Render
   ============================================================ */

export function scheduleRender() {
  if (renderFrame) return;
  renderFrame = requestAnimationFrame(() => { renderFrame = null; render(); });
}
hooks.scheduleRender = scheduleRender;

function sizeCanvas(layout) {
  const canvas = el.editorCanvas;
  const w = Math.max(1, Math.round(layout.vw * layout.dpr));
  const h = Math.max(1, Math.round(layout.vh * layout.dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  canvas.style.width = `${layout.vw}px`;
  canvas.style.height = `${layout.vh}px`;
}

function overlayMaskIndex(photo) {
  if (!state.showMaskOverlay || state.tool === "crop" || state.previewSettings) return -1;
  return photo.settings.masks.findIndex((m) => m.id === photo.activeMaskId);
}

/** Thiết lập đang hiển thị: xem trước preset (khi rê chuột) hoặc thiết lập thật. */
export const shownSettings = (photo) => state.previewSettings || photo.settings;

export function render() {
  const photo = activePhoto();
  if (!photo || state.exporting || !photo.bitmap) return;
  const renderer = state.renderer;
  const layout = computeLayout(photo);
  state.layout = layout;
  sizeCanvas(layout);
  const settings = shownSettings(photo);
  renderer.setPhoto(photo);
  renderer.syncMasks(settings.masks, photo.liveBrush);
  const mode = state.holdingBefore ? "before" : state.previewMode;
  const d = layout.dpr;
  renderer.drawView(settings, {
    crop: layout.crop,
    rect: { x: layout.x * d, y: layout.y * d, width: layout.width * d, height: layout.height * d },
    original: mode === "before",
    split: mode === "split" && state.tool !== "crop" ? (layout.x + layout.width * state.splitPos) * d : null,
    overlayMask: overlayMaskIndex(photo),
    clipping: state.clipping,
  });
  el.zoomValue.textContent = state.tool === "crop" ? "Cắt" : (state.view.fit ? `Vừa · ${zoomPercent(layout)}%` : `${zoomPercent(layout)}%`);
  el.beforeBadge.hidden = mode !== "before";
  el.beforeBadge.textContent = "ẢNH GỐC";
  el.previewBadge.hidden = !state.previewSettings;
  el.previewBadge.textContent = `XEM TRƯỚC · ${state.previewLabel}`;
  updateMaskBadge(photo);
  updateOverlay(layout);
  scheduleHistogram();
}

function updateMaskBadge(photo) {
  const mask = activeMask(photo);
  const show = !!mask && !state.tool && !state.previewSettings;
  el.maskBadge.hidden = !show;
  if (show) el.maskBadgeText.textContent = `Đang chỉnh: ${maskLabel(photo, mask)}${state.showMaskOverlay ? " · lớp phủ" : ""}`;
}

export function scheduleHistogram() {
  clearTimeout(histogramTimer);
  histogramTimer = setTimeout(updateHistogram, 140);
}

function updateHistogram() {
  const photo = activePhoto();
  if (!photo || state.exporting || !photo.bitmap) return;
  const renderer = state.renderer;
  const settings = shownSettings(photo);
  renderer.setPhoto(photo);
  renderer.syncMasks(settings.masks, photo.liveBrush);
  const { pixels } = renderer.renderThumbnail(settings, settings.crop, 220);
  lastHistogram = computeHistogram(pixels);
  drawHistogram(el.histogramCanvas, lastHistogram);
  el.shadowClipIndicator.classList.toggle("active", lastHistogram.shadowClip > 0.002);
  el.highlightClipIndicator.classList.toggle("active", lastHistogram.highlightClip > 0.002);
  const curve = curveEditorRef();
  if (curve) { curve.histogram = lastHistogram; curve.draw(); }
  if (!state.lastPointer) updateHistogramInfo();
}

export function updateHistogramInfo(text) {
  if (text) { el.histogramInfo.textContent = text; return; }
  const photo = activePhoto();
  if (!photo) { el.histogramInfo.textContent = "Chưa có ảnh"; return; }
  const v = photo.settings.values;
  const out = outputSize(photo.settings.crop);
  el.histogramInfo.textContent = `${Math.round(out.width)} × ${Math.round(out.height)} · ${v.exposure > 0 ? "+" : ""}${v.exposure.toFixed(2)} EV · ${photo.settings.masks.length} vùng chọn`;
}

/* ---------- Toạ độ ---------- */

export function viewportPoint(event) {
  const r = el.canvasViewport.getBoundingClientRect();
  return { x: event.clientX - r.left, y: event.clientY - r.top };
}

export function screenToSource(photo, p, layout = state.layout) {
  const u = (p.x - layout.x) / layout.width;
  const v = (p.y - layout.y) / layout.height;
  const s = outputToSource(layout.crop, u, v, lensOf(photo));
  return { x: s.x, y: s.y, u, v };
}

export function sourceToScreen(photo, x, y, layout = state.layout) {
  const { u, v } = sourceToOutput(layout.crop, x, y, lensOf(photo));
  return { x: layout.x + u * layout.width, y: layout.y + v * layout.height };
}

export const insideImage = (p, layout = state.layout) => !!layout && p.x >= layout.x && p.y >= layout.y && p.x <= layout.x + layout.width && p.y <= layout.y + layout.height;

/* ============================================================
   Lớp phủ
   ============================================================ */

function cropGridLines(x, y, w, h) {
  const lines = [];
  const hv = (fx, fy) => { if (fx !== null) lines.push([x + w * fx, y, x + w * fx, y + h]); if (fy !== null) lines.push([x, y + h * fy, x + w, y + h * fy]); };
  switch (state.cropGrid) {
    case "grid": for (let i = 1; i < 6; i++) hv(i / 6, i / 6); break;
    case "golden": hv(0.382, 0.382); hv(0.618, 0.618); break;
    case "diagonal": {
      const s = Math.min(w, h);
      lines.push([x, y, x + s, y + s], [x + w, y, x + w - s, y + s], [x, y + h, x + s, y + h - s], [x + w, y + h, x + w - s, y + h - s]);
      break;
    }
    case "none": break;
    default: hv(1 / 3, 1 / 3); hv(2 / 3, 2 / 3);
  }
  return lines;
}

export function updateOverlay(layout = state.layout) {
  const photo = activePhoto();
  if (!layout || !photo) return;
  const frame = el.imageFrame;
  frame.style.left = `${layout.x}px`;
  frame.style.top = `${layout.y}px`;
  frame.style.width = `${layout.width}px`;
  frame.style.height = `${layout.height}px`;
  const mode = state.holdingBefore ? "before" : state.previewMode;
  el.splitLine.hidden = !(mode === "split" && state.tool !== "crop");
  el.splitLine.style.left = `${state.splitPos * 100}%`;
  const svg = el.frameOverlay;
  svg.setAttribute("width", layout.width);
  svg.setAttribute("height", layout.height);
  svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
  let html = "";
  const toFrame = (x, y) => {
    const s = sourceToScreen(photo, x, y, layout);
    return [s.x - layout.x, s.y - layout.y];
  };
  if (state.tool === "crop") {
    const r = cropRectInView(photo.settings.crop, photo.width, photo.height);
    const x = r.x * layout.width, y = r.y * layout.height, w = r.w * layout.width, h = r.h * layout.height;
    const W = layout.width, H = layout.height;
    html += `<path class="crop-shade" fill-rule="evenodd" d="M0 0H${W}V${H}H0Z M${x} ${y}H${x + w}V${y + h}H${x}Z"/>`;
    html += `<rect class="crop-frame" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
    for (const [x1, y1, x2, y2] of cropGridLines(x, y, w, h)) html += `<line class="crop-grid" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    const c = 16;
    for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x + w, y + h, -1, -1], [x, y + h, 1, -1]]) {
      html += `<path class="crop-corner" d="M${cx} ${cy + dy * c}V${cy}H${cx + dx * c}"/>`;
    }
    for (const [mx, my, horizontal] of [[x + w / 2, y, true], [x + w / 2, y + h, true], [x, y + h / 2, false], [x + w, y + h / 2, false]]) {
      html += horizontal ? `<line class="crop-edge" x1="${mx - 10}" y1="${my}" x2="${mx + 10}" y2="${my}"/>` : `<line class="crop-edge" x1="${mx}" y1="${my - 10}" x2="${mx}" y2="${my + 10}"/>`;
    }
    // Hiện góc xoay ngay trên ảnh khi đang xoay
    const g = state.gesture;
    if (g?.kind === "crop-rotate" || state.cropAngleHint) {
      const angle = photo.settings.crop.angle || 0;
      html += `<g class="crop-angle"><rect x="${x + w / 2 - 34}" y="${y + h / 2 - 15}" width="68" height="30" rx="7"/><text x="${x + w / 2}" y="${y + h / 2 + 5}" text-anchor="middle">${angle.toFixed(1)}°</text></g>`;
    }
    const size = outputSize(photo.settings.crop);
    html += `<text class="crop-size" x="${x + w - 8}" y="${y + h - 9}" text-anchor="end">${Math.round(size.width)} × ${Math.round(size.height)}</text>`;
  } else if (!state.previewSettings) {
    const mask = activeMask(photo);
    if (mask && mask.type === "linear") {
      const s = toFrame(mask.linear.start.x * photo.width, mask.linear.start.y * photo.height);
      const e = toFrame(mask.linear.end.x * photo.width, mask.linear.end.y * photo.height);
      const dx = e[0] - s[0], dy = e[1] - s[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * 2000, ny = (dx / len) * 2000;
      for (const [px, py, cls] of [[s[0], s[1], "geo-line"], [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2, "geo-line geo-mid"], [e[0], e[1], "geo-line geo-dashed"]]) {
        html += `<line class="${cls}" x1="${px - nx}" y1="${py - ny}" x2="${px + nx}" y2="${py + ny}"/>`;
      }
      html += `<line class="geo-axis" x1="${s[0]}" y1="${s[1]}" x2="${e[0]}" y2="${e[1]}"/>`;
      html += `<circle class="geo-handle" cx="${s[0]}" cy="${s[1]}" r="6"/><circle class="geo-handle geo-handle-alt" cx="${e[0]}" cy="${e[1]}" r="6"/>`;
    } else if (mask && mask.type === "radial") {
      const pts = radialPoints(photo, mask).map(([px, py]) => toFrame(px, py));
      html += `<path class="geo-line" d="M${pts.map((p) => p.join(" ")).join("L")}Z"/>`;
      const inner = radialPoints(photo, mask, 1 - (mask.feather ?? 50) / 100).map(([px, py]) => toFrame(px, py));
      html += `<path class="geo-line geo-dashed" d="M${inner.map((p) => p.join(" ")).join("L")}Z"/>`;
      for (const [name, [hx, hy]] of Object.entries(radialHandles(photo, mask))) {
        const [fx, fy] = toFrame(hx, hy);
        html += `<circle class="geo-handle${name === "center" ? "" : " geo-handle-alt"}${name === "rotate" ? " geo-rotate" : ""}" cx="${fx}" cy="${fy}" r="${name === "center" ? 6 : 5}"/>`;
      }
    }
  }
  svg.innerHTML = html;
}

function radialGeometryPx(photo, mask) {
  const L = Math.max(photo.width, photo.height);
  const r = mask.radial;
  const rot = ((r.rotation || 0) * Math.PI) / 180;
  return { cx: r.center.x * photo.width, cy: r.center.y * photo.height, rx: r.rx * L, ry: r.ry * L, cos: Math.cos(rot), sin: Math.sin(rot), L };
}

function radialPoints(photo, mask, scale = 1) {
  const g = radialGeometryPx(photo, mask);
  const pts = [];
  for (let i = 0; i < 72; i++) {
    const t = (i / 72) * Math.PI * 2;
    const ex = Math.cos(t) * g.rx * scale, ey = Math.sin(t) * g.ry * scale;
    pts.push([g.cx + g.cos * ex - g.sin * ey, g.cy + g.sin * ex + g.cos * ey]);
  }
  return pts;
}

function radialHandles(photo, mask) {
  const g = radialGeometryPx(photo, mask);
  const at = (ex, ey) => [g.cx + g.cos * ex - g.sin * ey, g.cy + g.sin * ex + g.cos * ey];
  return { center: [g.cx, g.cy], rx: at(g.rx, 0), ry: at(0, g.ry), rotate: at(0, -g.ry - g.L * 0.04) };
}

/* ============================================================
   Thao tác chuột
   ============================================================ */

const DRAG_THRESHOLD = 4;

function hitTestCrop(photo, p, layout) {
  const r = cropRectInView(photo.settings.crop, photo.width, photo.height);
  const x = layout.x + r.x * layout.width, y = layout.y + r.y * layout.height;
  const w = r.w * layout.width, h = r.h * layout.height;
  const tol = 12;
  const nearL = Math.abs(p.x - x) < tol, nearR = Math.abs(p.x - (x + w)) < tol;
  const nearT = Math.abs(p.y - y) < tol, nearB = Math.abs(p.y - (y + h)) < tol;
  const withinX = p.x > x - tol && p.x < x + w + tol;
  const withinY = p.y > y - tol && p.y < y + h + tol;
  let edges = "";
  if (nearT && withinX) edges += "t";
  if (nearB && withinX) edges += "b";
  if (nearL && withinY) edges += "l";
  if (nearR && withinY) edges += "r";
  if (edges) return { kind: "resize", edges, rect: r };
  if (p.x > x && p.x < x + w && p.y > y && p.y < y + h) return { kind: "move", rect: r };
  return { kind: "rotate", rect: r };
}

function hitTestMask(photo, mask, p) {
  const layout = state.layout;
  const near = (pt, d = 11) => Math.hypot(pt.x - p.x, pt.y - p.y) < d;
  if (mask.type === "linear") {
    const s = sourceToScreen(photo, mask.linear.start.x * photo.width, mask.linear.start.y * photo.height, layout);
    const e = sourceToScreen(photo, mask.linear.end.x * photo.width, mask.linear.end.y * photo.height, layout);
    if (near(s)) return "start";
    if (near(e)) return "end";
    const dx = e.x - s.x, dy = e.y - s.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = clamp(((p.x - s.x) * dx + (p.y - s.y) * dy) / len2, 0, 1);
    if (Math.hypot(s.x + dx * t - p.x, s.y + dy * t - p.y) < 8) return "body";
    return null;
  }
  if (mask.type === "radial") {
    const handles = radialHandles(photo, mask);
    for (const name of ["rotate", "rx", "ry", "center"]) {
      if (near(sourceToScreen(photo, ...handles[name], layout))) return name;
    }
    const src = screenToSource(photo, p, layout);
    const g = radialGeometryPx(photo, mask);
    const dx = src.x - g.cx, dy = src.y - g.cy;
    const qx = g.cos * dx + g.sin * dy, qy = -g.sin * dx + g.cos * dy;
    if (Math.hypot(qx / g.rx, qy / g.ry) < 1) return "body";
  }
  return null;
}

const isViewportChrome = (target) => target instanceof Element && !!target.closest(".crop-bar, .empty-state, .drop-overlay, .stage-badge, .toast");

/** Thoát chế độ chỉnh vùng chọn (bỏ chọn mask đang hoạt động). */
export function exitMaskEditing() {
  const photo = activePhoto();
  if (!photo?.activeMaskId) return false;
  photo.activeMaskId = null;
  state.showMaskOverlay = false;
  el.brushCursor.hidden = true;
  renderMaskUI();
  scheduleRender();
  return true;
}

function onPointerDown(event) {
  const photo = activePhoto();
  if (!photo || state.exporting || !state.layout || isViewportChrome(event.target)) return;
  if (event.button === 2) return;
  const p = viewportPoint(event);
  const layout = state.layout;
  const capture = () => el.canvasViewport.setPointerCapture(event.pointerId);

  if (event.button === 1 || state.spaceDown) {
    event.preventDefault();
    if (state.tool === "crop") return;
    state.gesture = { kind: "pan", start: p, panX: state.view.panX, panY: state.view.panY, wasFit: state.view.fit };
    capture();
    updateCursor(p);
    return;
  }

  if (state.tool === "eyedropper" || state.tool === "range-picker") {
    if (!insideImage(p)) return;
    if (state.tool === "eyedropper") sampleWhiteBalance(photo, p);
    else sampleRangeColor(photo, p);
    return;
  }

  if (state.tool === "crop") {
    event.preventDefault();
    const hit = hitTestCrop(photo, p, layout);
    state.gesture = { kind: `crop-${hit.kind}`, edges: hit.edges, start: p, rect: { ...hit.rect }, crop: { ...photo.settings.crop } };
    if (hit.kind === "rotate") {
      const r = hit.rect;
      const cx = layout.x + (r.x + r.w / 2) * layout.width, cy = layout.y + (r.y + r.h / 2) * layout.height;
      state.gesture.center = { x: cx, y: cy };
      state.gesture.startAngle = Math.atan2(p.y - cy, p.x - cx);
    }
    capture();
    return;
  }

  const mode = state.holdingBefore ? "before" : state.previewMode;
  if (mode === "split") {
    const sx = layout.x + layout.width * state.splitPos;
    if (Math.abs(p.x - sx) < 10 && p.y >= layout.y && p.y <= layout.y + layout.height) {
      state.gesture = { kind: "split" };
      capture();
      return;
    }
  }

  const mask = activeMask(photo);
  if (mask && mask.visible !== false) {
    if (mask.type === "brush" && insideImage(p)) {
      event.preventDefault();
      startBrushStroke(photo, mask, p, event.altKey);
      capture();
      return;
    }
    if (mask.type === "linear" || mask.type === "radial") {
      const handle = hitTestMask(photo, mask, p);
      if (handle || insideImage(p)) {
        event.preventDefault();
        // Chỉ bắt đầu sửa khi đã kéo quá ngưỡng – bấm nhầm không làm dịch vùng chọn
        state.gesture = { kind: "mask-pending", handle, mask, startScreen: p };
        capture();
        return;
      }
    }
  }

  if (!state.view.fit && insideImage(p)) {
    state.gesture = { kind: "pan", start: p, panX: state.view.panX, panY: state.view.panY, clickToExit: !!mask };
    capture();
    updateCursor(p);
    return;
  }
  // Bấm vào chỗ trống khi đang chỉnh vùng chọn (cọ / bầu trời / dải) → thoát chế độ chỉnh
  if (mask) state.gesture = { kind: "click-exit", startScreen: p };
}

function beginMaskGeometry(photo, g) {
  const mask = g.mask;
  const src = screenToSource(photo, g.startScreen);
  Object.assign(g, {
    kind: "mask-geo",
    handle: g.handle || "create",
    start: src,
    snapshot: beginGesture(photo, g.handle ? `Chỉnh ${maskLabel(photo, mask)}` : `Vẽ ${maskLabel(photo, mask)}`),
    linear: JSON.parse(JSON.stringify(mask.linear)),
    radial: { ...mask.radial, center: { ...mask.radial.center } },
  });
  if (g.handle === "create") {
    const uv = { x: clamp(src.x / photo.width, 0, 1), y: clamp(src.y / photo.height, 0, 1) };
    if (mask.type === "linear") { mask.linear.start = { ...uv }; mask.linear.end = { ...uv }; }
    else { mask.radial.center = { ...uv }; mask.radial.rx = 0.01; mask.radial.ry = 0.01; }
  }
}

function onPointerMove(event) {
  const photo = activePhoto();
  if (!photo || !state.layout) return;
  const p = viewportPoint(event);
  state.lastPointer = p;
  const g = state.gesture;
  if (!g && isViewportChrome(event.target)) { el.canvasViewport.style.cursor = ""; el.brushCursor.hidden = true; return; }
  if (!g) {
    updateCursor(p);
    updateBrushCursor(p);
    updatePixelReadout(p);
    return;
  }
  const layout = state.layout;
  if (g.kind === "mask-pending") {
    if (Math.hypot(p.x - g.startScreen.x, p.y - g.startScreen.y) < DRAG_THRESHOLD) return;
    beginMaskGeometry(photo, g);
  }
  if (g.kind === "click-exit") return;
  if (g.kind === "pan") {
    if (Math.hypot(p.x - g.start.x, p.y - g.start.y) >= DRAG_THRESHOLD) g.moved = true;
    if (g.wasFit) {
      state.view = { fit: false, scale: layout.scale, panX: 0, panY: 0 };
      g.wasFit = false;
    }
    state.view.panX = g.panX + (p.x - g.start.x);
    state.view.panY = g.panY + (p.y - g.start.y);
    clampPan();
    scheduleRender();
  } else if (g.kind === "split") {
    state.splitPos = clamp((p.x - layout.x) / layout.width, 0.02, 0.98);
    scheduleRender();
  } else if (g.kind === "brush") {
    continueBrushStroke(photo, p);
    updateBrushCursor(p);
  } else if (g.kind === "mask-geo") {
    updateMaskGeometry(photo, g, screenToSource(photo, p, layout), event);
  } else if (g.kind.startsWith("crop-")) {
    updateCropGesture(photo, g, p, event);
  }
}

function onPointerUp() {
  const g = state.gesture;
  const photo = activePhoto();
  state.gesture = null;
  if (!g || !photo) return;
  if (g.kind === "brush") endBrushStroke(photo, g);
  if (g.kind === "mask-pending") {
    // Bấm không kéo: bấm vào chỗ trống ngoài vùng chọn → thoát chế độ chỉnh
    if (!g.handle) exitMaskEditing();
    return;
  }
  if (g.kind === "click-exit") { exitMaskEditing(); return; }
  if (g.kind === "pan" && g.clickToExit && !g.moved) exitMaskEditing();
  if (g.kind === "mask-geo") {
    if (g.handle === "create") {
      const m = g.mask;
      if (m.type === "radial" && m.radial.rx < 0.012 && m.radial.ry < 0.012) m.radial = { ...g.radial, center: { ...m.radial.center } };
    }
    endGesture(g.snapshot);
    syncMaskEditor();
    scheduleRender();
  }
  if (g.kind.startsWith("crop-")) { updateDimensions(); scheduleRender(); }
  if (g.kind === "pan" || g.kind === "split") scheduleRender();
}

function updateCursor(p) {
  const photo = activePhoto();
  const vp = el.canvasViewport;
  if (!photo || !state.layout) { vp.style.cursor = ""; return; }
  let cursor = "default";
  if (state.spaceDown || state.gesture?.kind === "pan") cursor = state.gesture ? "grabbing" : "grab";
  else if (state.tool === "eyedropper" || state.tool === "range-picker") cursor = insideImage(p) ? "crosshair" : "default";
  else if (state.tool === "crop") {
    const hit = hitTestCrop(photo, p, state.layout);
    const map = { t: "ns-resize", b: "ns-resize", l: "ew-resize", r: "ew-resize", tl: "nwse-resize", br: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize" };
    if (hit.kind === "resize") {
      const e = hit.edges.split("").sort((a, b) => "tblr".indexOf(a) - "tblr".indexOf(b)).join("");
      cursor = map[e] || "move";
    } else cursor = hit.kind === "move" ? "move" : "alias";
  } else {
    const mode = state.holdingBefore ? "before" : state.previewMode;
    const sx = state.layout.x + state.layout.width * state.splitPos;
    const mask = activeMask(photo);
    if (mode === "split" && Math.abs(p.x - sx) < 10 && insideImage(p)) cursor = "col-resize";
    else if (mask?.type === "brush" && mask.visible !== false && insideImage(p)) cursor = "none";
    else if (mask && (mask.type === "linear" || mask.type === "radial") && mask.visible !== false) {
      const h = hitTestMask(photo, mask, p);
      cursor = h === "body" || h === "center" ? "move" : h ? "pointer" : insideImage(p) ? "crosshair" : "default";
    } else if (!state.view.fit && insideImage(p)) cursor = "grab";
  }
  vp.style.cursor = cursor;
}

let readoutFrame = null;
function updatePixelReadout(p) {
  if (readoutFrame) return;
  readoutFrame = requestAnimationFrame(() => {
    readoutFrame = null;
    if (!state.layout || !insideImage(p) || state.tool === "crop") { updateHistogramInfo(); return; }
    const gl = state.renderer.gl;
    const d = state.layout.dpr;
    const px = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(Math.floor(p.x * d), Math.floor(el.editorCanvas.height - p.y * d - 1), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const pct = (v) => Math.round((v / 255) * 100);
    updateHistogramInfo(`R ${pct(px[0])}% · G ${pct(px[1])}% · B ${pct(px[2])}%`);
  });
}

function onWheel(event) {
  const photo = activePhoto();
  if (!photo || state.tool === "crop" || isViewportChrome(event.target)) return;
  event.preventDefault();
  const p = viewportPoint(event);
  const l = computeLayout(photo);
  const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0018));
  const next = l.scale * factor;
  if (next <= l.fitScale && factor < 1) { fitView(); return; }
  setZoom(next, p.x, p.y);
}

/* ---------- Cọ vùng ---------- */

function brushSettings() {
  return {
    size: Number(el.brushSizeRange.value),
    feather: Number(el.brushFeatherRange.value) / 100,
    flow: Number(el.brushFlowRange.value) / 100,
  };
}

function startBrushStroke(photo, mask, p, altKey) {
  const { width, height } = photo.maskSize;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (mask.brush) {
    const img = ctx.createImageData(width, height);
    const src = mask.brush.data;
    for (let i = 0, j = 0; i < src.length; i++, j += 4) { img.data[j] = img.data[j + 1] = img.data[j + 2] = src[i]; img.data[j + 3] = 255; }
    ctx.putImageData(img, 0, 0);
  } else {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
  }
  const erase = altKey || el.eraseMaskToggle.checked;
  photo.liveBrush = { maskId: mask.id, canvas, ctx, version: 0 };
  state.gesture = { kind: "brush", snapshot: beginGesture(photo, erase ? `Tẩy ${maskLabel(photo, mask)}` : `Tô ${maskLabel(photo, mask)}`), last: null, erase };
  continueBrushStroke(photo, p);
}

function continueBrushStroke(photo, p) {
  const live = photo.liveBrush;
  const g = state.gesture;
  if (!live || !g) return;
  const src = screenToSource(photo, p);
  const mx = (src.x / photo.width) * photo.maskSize.width;
  const my = (src.y / photo.height) * photo.maskSize.height;
  const { size, feather, flow } = brushSettings();
  const radius = Math.max(0.6, (size / 2) * (state.layout.out.width / state.layout.width) * (photo.maskSize.width / photo.width));
  const ctx = live.ctx;
  const color = g.erase ? "0,0,0" : "255,255,255";
  const dab = (x, y) => {
    const grad = ctx.createRadialGradient(x, y, radius * (1 - feather) * 0.98, x, y, radius);
    grad.addColorStop(0, `rgba(${color},${flow})`);
    grad.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  };
  if (g.last) {
    const dist = Math.hypot(mx - g.last.x, my - g.last.y);
    const spacing = Math.max(0.5, radius * 0.22);
    let travelled = g.carry || 0;
    while (travelled + spacing <= dist) {
      travelled += spacing;
      const t = travelled / dist;
      dab(g.last.x + (mx - g.last.x) * t, g.last.y + (my - g.last.y) * t);
    }
    g.carry = travelled - dist;
  } else {
    dab(mx, my);
    g.carry = 0;
  }
  g.last = { x: mx, y: my };
  live.version += 1;
  scheduleRender();
}

function endBrushStroke(photo, g) {
  const live = photo.liveBrush;
  if (!live) return;
  const mask = photo.settings.masks.find((m) => m.id === live.maskId);
  if (mask) {
    const { width, height } = photo.maskSize;
    const rgba = live.ctx.getImageData(0, 0, width, height).data;
    const data = new Uint8Array(width * height);
    for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = rgba[j];
    mask.brush = { width, height, data, version: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` };
  }
  photo.liveBrush = null;
  endGesture(g?.snapshot);
  scheduleRender();
}

export function updateBrushCursor(p = state.lastPointer) {
  const photo = activePhoto();
  const mask = activeMask(photo);
  const show = !!p && !!photo && mask?.type === "brush" && mask.visible !== false && !state.tool && insideImage(p) && !state.spaceDown;
  el.brushCursor.hidden = !show;
  if (!show) return;
  const d = Number(el.brushSizeRange.value);
  el.brushCursor.style.width = `${d}px`;
  el.brushCursor.style.height = `${d}px`;
  el.brushCursor.style.left = `${p.x}px`;
  el.brushCursor.style.top = `${p.y}px`;
  const inner = d * (1 - Number(el.brushFeatherRange.value) / 100);
  el.brushCursor.style.setProperty("--inner", `${Math.max(0, inner)}px`);
}

/* ---------- Mask hình học ---------- */

function updateMaskGeometry(photo, g, src, event) {
  const mask = g.mask;
  const uv = { x: clamp(src.x / photo.width, -0.5, 1.5), y: clamp(src.y / photo.height, -0.5, 1.5) };
  const L = Math.max(photo.width, photo.height);
  if (mask.type === "linear") {
    if (g.handle === "create" || g.handle === "end") mask.linear.end = uv;
    else if (g.handle === "start") mask.linear.start = uv;
    else if (g.handle === "body") {
      const dx = uv.x - g.start.x / photo.width, dy = uv.y - g.start.y / photo.height;
      mask.linear.start = { x: g.linear.start.x + dx, y: g.linear.start.y + dy };
      mask.linear.end = { x: g.linear.end.x + dx, y: g.linear.end.y + dy };
    }
  } else {
    const r = mask.radial;
    const geo = radialGeometryPx(photo, mask);
    if (g.handle === "create") {
      let rx = Math.abs(src.x - g.start.x) / L, ry = Math.abs(src.y - g.start.y) / L;
      if (event.shiftKey) rx = ry = Math.max(rx, ry);
      r.rotation = 0;
      r.rx = Math.max(0.01, rx);
      r.ry = Math.max(0.01, ry);
    } else if (g.handle === "center" || g.handle === "body") {
      r.center = { x: g.radial.center.x + (src.x - g.start.x) / photo.width, y: g.radial.center.y + (src.y - g.start.y) / photo.height };
    } else if (g.handle === "rx" || g.handle === "ry") {
      const dx = src.x - geo.cx, dy = src.y - geo.cy;
      const along = g.handle === "rx" ? Math.abs(geo.cos * dx + geo.sin * dy) : Math.abs(-geo.sin * dx + geo.cos * dy);
      r[g.handle] = Math.max(0.005, along / L);
      if (event.shiftKey) { r.rx = r[g.handle]; r.ry = r[g.handle]; }
    } else if (g.handle === "rotate") {
      const angle = Math.atan2(src.y - geo.cy, src.x - geo.cx);
      let deg = (angle * 180) / Math.PI + 90;
      if (event.shiftKey) deg = Math.round(deg / 15) * 15;
      r.rotation = ((deg + 540) % 360) - 180;
    }
  }
  syncMaskEditor();
  scheduleRender();
}

/* ============================================================
   Công cụ: cắt & xoay, chấm màu
   ============================================================ */

export function setTool(tool) {
  const photo = activePhoto();
  if (state.tool === tool) tool = null;
  if (state.tool === "crop" && tool !== "crop") finishCrop(true);
  state.tool = tool;
  el.eyedropperButton.setAttribute("aria-pressed", String(tool === "eyedropper"));
  el.eyedropperButton.classList.toggle("active", tool === "eyedropper");
  if (tool === "crop" && photo) {
    state.cropSession = beginGesture(photo, "Cắt & xoay");
    if (photo.settings.crop.iw === undefined) photo.settings.crop = { ...photo.settings.crop, iw: photo.settings.crop.w, ih: photo.settings.crop.h };
    syncCropBar();
  }
  el.cropBar.hidden = tool !== "crop";
  el.cropToolButton.setAttribute("aria-pressed", String(tool === "crop"));
  el.cropToolButton.classList.toggle("active", tool === "crop");
  document.querySelectorAll("[data-range-pick]").forEach((b) => b.classList.toggle("active", tool === "range-picker"));
  if (tool === "eyedropper") setStatus("Bấm vào vùng trắng hoặc xám trung tính trên ảnh để cân bằng trắng · Esc để huỷ");
  else if (tool === "range-picker") setStatus("Bấm vào màu cần chọn trên ảnh · Esc để huỷ");
  else if (tool === "crop") setStatus("Kéo góc/cạnh để cắt · kéo ngoài khung để xoay · X đổi dọc/ngang · O đổi lưới · Enter xong · Esc huỷ");
  else setStatus("Ảnh được xử lý cục bộ");
  el.brushCursor.hidden = true;
  scheduleRender();
}

export function finishCrop(apply) {
  const photo = activePhoto();
  if (!photo || state.tool !== "crop") return;
  if (!apply && state.cropSession) photo.settings = cloneSettings(state.cropSession.snapshot);
  else endGesture(state.cropSession);
  state.cropSession = null;
  state.tool = null;
  el.cropBar.hidden = true;
  el.cropToolButton.setAttribute("aria-pressed", "false");
  el.cropToolButton.classList.remove("active");
  resetView();
  updateDimensions();
  setStatus("Ảnh được xử lý cục bộ");
  settingsChanged(photo);
}

export function syncCropBar() {
  const photo = activePhoto();
  if (!photo) return;
  const crop = photo.settings.crop;
  const aspect = crop.aspect || "free";
  if (![...el.cropAspectSelect.options].some((o) => o.value === aspect)) {
    const o = document.createElement("option");
    o.value = aspect;
    o.textContent = aspect.replace(":", " : ");
    el.cropAspectSelect.appendChild(o);
  }
  el.cropAspectSelect.value = aspect;
  el.cropAngleRange.value = crop.angle || 0;
  el.cropAngleValue.textContent = `${(crop.angle || 0).toFixed(1)}°`;
  el.cropGridSelect.value = state.cropGrid;
  setRangeProgress(el.cropAngleRange);
}

export function setCrop(photo, crop) {
  photo.settings.crop = crop;
  updateDimensions();
  syncCropBar();
  scheduleRender();
}

let angleHintTimer = null;
export function showAngleHint() {
  state.cropAngleHint = true;
  clearTimeout(angleHintTimer);
  angleHintTimer = setTimeout(() => { state.cropAngleHint = false; scheduleRender(); }, 900);
  scheduleRender();
}

/** X: đổi khung cắt dọc ↔ ngang. */
export function swapCropOrientation() {
  const photo = activePhoto();
  if (!photo || state.tool !== "crop") return;
  const crop = photo.settings.crop;
  let aspect = crop.aspect || "free";
  if (aspect === "original") aspect = `${photo.height}:${photo.width}`;
  else if (aspect.includes(":")) { const [a, b] = aspect.split(":"); aspect = `${b}:${a}`; }
  const next = fitCropInside({ ...crop, w: crop.h, h: crop.w, iw: crop.ih ?? crop.h, ih: crop.iw ?? crop.w, aspect }, photo.width, photo.height);
  setCrop(photo, next);
  showToast(next.w >= next.h ? "Khung cắt: ngang" : "Khung cắt: dọc");
}

export function cycleCropGrid() {
  const ids = ["thirds", "grid", "golden", "diagonal", "none"];
  state.cropGrid = ids[(ids.indexOf(state.cropGrid) + 1) % ids.length];
  el.cropGridSelect.value = state.cropGrid;
  scheduleRender();
}

function updateCropGesture(photo, g, p, event) {
  const layout = state.layout;
  const W = photo.width, H = photo.height;
  const dx = (p.x - g.start.x) / layout.width;
  const dy = (p.y - g.start.y) / layout.height;
  const base = g.crop;
  if (g.kind === "crop-rotate") {
    const angle = Math.atan2(p.y - g.center.y, p.x - g.center.x);
    let deg = (base.angle || 0) + ((angle - g.startAngle) * 180) / Math.PI;
    deg = clamp(deg, -45, 45);
    if (event.shiftKey) deg = Math.round(deg);
    setCrop(photo, fitCropInside({ ...base, angle: deg }, W, H));
    return;
  }
  if (g.kind === "crop-move") {
    let lo = 0, hi = 1;
    const tryAt = (t) => cropFromViewRect(base, W, H, { ...g.rect, x: g.rect.x + dx * t, y: g.rect.y + dy * t });
    if (isCropInside(tryAt(1), W, H)) lo = 1;
    else for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (isCropInside(tryAt(m), W, H)) lo = m; else hi = m; }
    setCrop(photo, { ...tryAt(lo), iw: base.iw ?? base.w, ih: base.ih ?? base.h });
    return;
  }
  const r = { ...g.rect };
  const view = cropRectInView(base, W, H);
  const minN = 24 / layout.width;
  let left = r.x, top = r.y, right = r.x + r.w, bottom = r.y + r.h;
  if (g.edges.includes("l")) left = Math.min(right - minN, left + dx);
  if (g.edges.includes("r")) right = Math.max(left + minN, right + dx);
  if (g.edges.includes("t")) top = Math.min(bottom - minN, top + dy);
  if (g.edges.includes("b")) bottom = Math.max(top + minN, bottom + dy);
  let aspect = aspectValue(base.aspect, W, H, base);
  if (!aspect && event.shiftKey) aspect = (r.w * view.viewWidth) / (r.h * view.viewHeight);
  if (aspect) {
    const k = view.viewWidth / view.viewHeight;
    let w = right - left, h = bottom - top;
    const horizontalOnly = !g.edges.includes("t") && !g.edges.includes("b");
    const verticalOnly = !g.edges.includes("l") && !g.edges.includes("r");
    if (horizontalOnly || (!verticalOnly && Math.abs(dx) >= Math.abs(dy))) h = (w * k) / aspect;
    else w = (h * aspect) / k;
    if (g.edges.includes("l")) left = right - w; else if (!g.edges.includes("r")) { const cx = (left + right) / 2; left = cx - w / 2; }
    right = left + w;
    if (g.edges.includes("t")) top = bottom - h; else if (!g.edges.includes("b")) { const cy = (top + bottom) / 2; top = cy - h / 2; }
    bottom = top + h;
  }
  const next = cropFromViewRect(base, W, H, { x: left, y: top, w: right - left, h: bottom - top });
  if (isCropInside(next, W, H)) setCrop(photo, next);
}

function sampleSource(photo, p, radius = 2) {
  const src = screenToSource(photo, p);
  const a = photoAnalysis(photo);
  if (!a) return null;
  const cx = Math.round((src.x / photo.width) * (a.width - 1));
  const cy = Math.round((src.y / photo.height) * (a.height - 1));
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= a.width || y >= a.height) continue;
      const i = (y * a.width + x) * 4;
      r += srgbToLinear(a.data[i] / 255); g += srgbToLinear(a.data[i + 1] / 255); b += srgbToLinear(a.data[i + 2] / 255);
      n += 1;
    }
  }
  return n ? [r / n, g / n, b / n] : null;
}

function sampleWhiteBalance(photo, p) {
  const sample = sampleSource(photo, p);
  if (!sample) return;
  const wb = neutralizeWhiteBalance(sample);
  record(photo, "Chấm cân bằng trắng");
  photo.settings.values.temperature = wb.temperature;
  photo.settings.values.tint = wb.tint;
  photo.settings.preset = null;
  setTool(null);
  settingsChanged(photo);
  showToast(`Cân bằng trắng: nhiệt độ ${wb.temperature}, sắc thái ${wb.tint}.`);
}

function sampleRangeColor(photo, p) {
  const mask = activeMask(photo);
  const sample = sampleSource(photo, p, 1);
  if (!mask || !sample) return;
  const [r, g, b] = sample.map((v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  const s = max ? d / max : 0;
  if (s < 0.06) { showToast("Màu này gần như xám – hãy chọn vùng có màu rõ hơn, hoặc dùng Dải sáng."); return; }
  record(photo, `Chọn màu cho ${maskLabel(photo, mask)}`);
  mask.range = { ...mask.range, type: mask.type === "color" ? "color" : mask.range.type === "none" ? "color" : mask.range.type, hue: Math.round(h), sat: Math.round(s * 100) };
  setTool(null);
  settingsChanged(photo);
}

/* ============================================================
   Khởi tạo
   ============================================================ */

export function initView() {
  const vp = el.canvasViewport;
  vp.addEventListener("pointerdown", onPointerDown);
  vp.addEventListener("pointermove", onPointerMove);
  vp.addEventListener("pointerup", onPointerUp);
  vp.addEventListener("pointercancel", onPointerUp);
  vp.addEventListener("pointerleave", () => {
    if (!state.gesture) { el.brushCursor.hidden = true; state.lastPointer = null; updateHistogramInfo(); }
  });
  vp.addEventListener("wheel", onWheel, { passive: false });
  vp.addEventListener("dblclick", (event) => {
    const photo = activePhoto();
    if (!photo || state.tool || activeMask(photo) || isViewportChrome(event.target)) return;
    const p = viewportPoint(event);
    if (!insideImage(p)) return;
    if (state.view.fit) actualSize(p.x, p.y); else fitView();
  });
  vp.addEventListener("contextmenu", (e) => { if (state.gesture) e.preventDefault(); });
  el.maskBadgeExit.addEventListener("click", exitMaskEditing);
  for (const a of aspectRatios) {
    const o = document.createElement("option");
    o.value = a.id;
    o.textContent = a.label;
    el.cropAspectSelect.appendChild(o);
  }
  new ResizeObserver(() => { if (activePhoto()) scheduleRender(); }).observe(vp);
  window.addEventListener("resize", () => { if (activePhoto()) { clampPan(); scheduleRender(); } });
}
