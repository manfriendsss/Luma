// Các widget vẽ bằng canvas: histogram, trình chỉnh đường cong, vòng màu.
import { makeCurveEvaluator, sortPoints } from "./curve.js";

const dpr = () => Math.min(2, window.devicePixelRatio || 1);

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr()));
  const h = Math.max(1, Math.round(rect.height * dpr()));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return { w, h, scale: dpr() };
}

/* ---------------- Histogram ---------------- */

export function computeHistogram(pixels) {
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
  let shadowClip = 0, highlightClip = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const R = pixels[i], G = pixels[i + 1], B = pixels[i + 2];
    r[R]++; g[G]++; b[B]++;
    l[Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B)]++;
    if (R >= 254 || G >= 254 || B >= 254) highlightClip++;
    if (R <= 1 && G <= 1 && B <= 1) shadowClip++;
  }
  const total = pixels.length / 4;
  return { r, g, b, l, shadowClip: shadowClip / total, highlightClip: highlightClip / total };
}

export function drawHistogram(canvas, hist) {
  const { w, h } = fitCanvas(canvas);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  if (!hist) return;
  let max = 1;
  for (const ch of [hist.r, hist.g, hist.b]) {
    // Bỏ hai cột ngoài cùng khi tính đỉnh để vùng cháy không làm bẹt biểu đồ
    for (let i = 1; i < 255; i++) max = Math.max(max, ch[i]);
  }
  const scaleY = (v) => h - Math.min(1, Math.sqrt(v / max)) * (h - 2);
  const path = (ch) => {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * w, scaleY(ch[i]));
    ctx.lineTo(w, h);
    ctx.closePath();
  };
  ctx.globalCompositeOperation = "lighter";
  for (const [ch, color] of [[hist.r, "rgba(235,70,70,.62)"], [hist.g, "rgba(70,205,95,.55)"], [hist.b, "rgba(70,130,245,.62)"]]) {
    path(ch);
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  path(hist.l);
  ctx.strokeStyle = "rgba(255,255,255,.55)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

/* ---------------- Curve editor ---------------- */

export class CurveEditor {
  constructor(canvas, { onInput, onCommit, onBegin }) {
    this.canvas = canvas;
    this.points = [[0, 0], [1, 1]];
    this.channel = "master";
    this.onInput = onInput;
    this.onCommit = onCommit;
    this.onBegin = onBegin;
    this.drag = null;
    this.histogram = null;
    canvas.addEventListener("pointerdown", (e) => this.pointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.pointerMove(e));
    canvas.addEventListener("pointerup", (e) => this.pointerUp(e));
    canvas.addEventListener("pointercancel", (e) => this.pointerUp(e));
    canvas.addEventListener("dblclick", (e) => this.doubleClick(e));
    canvas.addEventListener("keydown", (e) => this.keyDown(e));
    this.selected = null;
  }

  setPoints(points, channel) {
    this.points = sortPoints(points.map(([x, y]) => [x, y]));
    if (channel) this.channel = channel;
    if (this.selected !== null && this.selected >= this.points.length) this.selected = null;
    this.draw();
  }

  pos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const pad = 8;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left - pad) / (rect.width - pad * 2))),
      y: Math.min(1, Math.max(0, 1 - (e.clientY - rect.top - pad) / (rect.height - pad * 2))),
      rawY: 1 - (e.clientY - rect.top - pad) / (rect.height - pad * 2),
      rect,
    };
  }

  hit(p) {
    const tolerance = 12 / p.rect.width;
    let best = -1, bestD = Infinity;
    this.points.forEach(([x, y], i) => {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    return bestD < tolerance * 1.6 ? best : -1;
  }

  pointerDown(e) {
    e.preventDefault();
    this.canvas.focus();
    const p = this.pos(e);
    let index = this.hit(p);
    this.onBegin?.();
    if (index < 0) {
      const y = makeCurveEvaluator(this.points)(p.x);
      this.points.push([p.x, Math.abs(y - p.y) < 0.08 ? y : p.y]);
      this.points = sortPoints(this.points);
      index = this.points.findIndex(([x]) => x === p.x);
    }
    this.selected = index;
    this.drag = { index, removed: false };
    this.canvas.setPointerCapture(e.pointerId);
    this.emit(false);
  }

  pointerMove(e) {
    if (!this.drag) return;
    const p = this.pos(e);
    const i = this.drag.index;
    const isEnd = i === 0 || i === this.points.length - 1;
    const prev = this.points[i - 1];
    const next = this.points[i + 1];
    let x = p.x;
    if (i === 0) x = Math.min(x, (next?.[0] ?? 1) - 0.01);
    else if (i === this.points.length - 1) x = Math.max(x, (prev?.[0] ?? 0) + 0.01);
    else x = Math.min((next[0]) - 0.01, Math.max(prev[0] + 0.01, x));
    // Kéo điểm giữa ra xa khỏi khung để xoá
    this.drag.removed = !isEnd && (p.rawY < -0.12 || p.rawY > 1.12);
    this.points[i] = [x, p.y];
    this.emit(false);
  }

  pointerUp() {
    if (!this.drag) return;
    if (this.drag.removed) { this.points.splice(this.drag.index, 1); this.selected = null; }
    this.drag = null;
    this.emit(true);
  }

  doubleClick(e) {
    const p = this.pos(e);
    const i = this.hit(p);
    if (i > 0 && i < this.points.length - 1) {
      this.onBegin?.();
      this.points.splice(i, 1);
      this.selected = null;
      this.emit(true);
    }
  }

  keyDown(e) {
    if (this.selected === null) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    const pt = this.points[this.selected];
    const moves = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
    if (moves[e.key]) {
      e.preventDefault();
      e.stopPropagation();
      this.onBegin?.();
      pt[0] = Math.min(1, Math.max(0, pt[0] + moves[e.key][0]));
      pt[1] = Math.min(1, Math.max(0, pt[1] + moves[e.key][1]));
      this.points = sortPoints(this.points);
      this.emit(true);
    } else if ((e.key === "Delete" || e.key === "Backspace") && this.selected > 0 && this.selected < this.points.length - 1) {
      e.preventDefault();
      e.stopPropagation();
      this.onBegin?.();
      this.points.splice(this.selected, 1);
      this.selected = null;
      this.emit(true);
    }
  }

  emit(commit) {
    const pts = this.drag?.removed ? this.points.filter((_, i) => i !== this.drag.index) : this.points;
    this.draw();
    const copy = pts.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
    if (commit) this.onCommit?.(copy); else this.onInput?.(copy);
  }

  draw() {
    const { w, h, scale } = fitCanvas(this.canvas);
    const ctx = this.canvas.getContext("2d");
    const pad = 8 * scale;
    const iw = w - pad * 2, ih = h - pad * 2;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#2a2c2f";
    ctx.fillRect(pad, pad, iw, ih);
    if (this.histogram) {
      const l = this.histogram.l;
      let max = 1;
      for (let i = 1; i < 255; i++) max = Math.max(max, l[i]);
      ctx.beginPath();
      ctx.moveTo(pad, pad + ih);
      for (let i = 0; i < 256; i++) ctx.lineTo(pad + (i / 255) * iw, pad + ih - Math.min(1, Math.sqrt(l[i] / max)) * ih * 0.9);
      ctx.lineTo(pad + iw, pad + ih);
      ctx.fillStyle = "rgba(255,255,255,.07)";
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(pad + (iw * i) / 4, pad); ctx.lineTo(pad + (iw * i) / 4, pad + ih); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pad, pad + (ih * i) / 4); ctx.lineTo(pad + iw, pad + (ih * i) / 4); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.beginPath(); ctx.moveTo(pad, pad + ih); ctx.lineTo(pad + iw, pad); ctx.stroke();
    const color = { master: "#f2f2f2", r: "#ff5c5c", g: "#5ad16b", b: "#5c9bff" }[this.channel];
    const pts = this.drag?.removed ? this.points.filter((_, i) => i !== this.drag.index) : this.points;
    const f = makeCurveEvaluator(pts);
    ctx.beginPath();
    for (let i = 0; i <= 200; i++) {
      const x = i / 200;
      const y = Math.min(1, Math.max(0, f(x)));
      const px = pad + x * iw, py = pad + (1 - y) * ih;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6 * scale;
    ctx.stroke();
    this.points.forEach(([x, y], i) => {
      ctx.beginPath();
      ctx.arc(pad + x * iw, pad + (1 - y) * ih, (i === this.selected ? 5 : 4) * scale, 0, Math.PI * 2);
      ctx.fillStyle = i === this.selected ? "#19c9f2" : "#1d1f22";
      ctx.fill();
      ctx.strokeStyle = this.drag?.removed && i === this.drag.index ? "#ef6b74" : color;
      ctx.lineWidth = 1.4 * scale;
      ctx.stroke();
    });
  }
}

/* ---------------- Color wheel ---------------- */

export class ColorWheel {
  constructor(canvas, { onInput, onCommit, onBegin, label }) {
    this.canvas = canvas;
    this.value = { h: 0, s: 0 };
    this.onInput = onInput;
    this.onCommit = onCommit;
    this.onBegin = onBegin;
    this.label = label;
    this.dragging = false;
    this.background = null;
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "slider");
    canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      canvas.focus();
      this.onBegin?.();
      this.dragging = true;
      canvas.setPointerCapture(e.pointerId);
      this.fromEvent(e, e.shiftKey);
    });
    canvas.addEventListener("pointermove", (e) => { if (this.dragging) this.fromEvent(e, e.shiftKey); });
    const end = () => { if (!this.dragging) return; this.dragging = false; this.onCommit?.({ ...this.value }); };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("dblclick", () => { this.onBegin?.(); this.set({ h: this.value.h, s: 0 }); this.onCommit?.({ ...this.value }); });
    canvas.addEventListener("keydown", (e) => {
      const map = { ArrowLeft: ["h", -2], ArrowRight: ["h", 2], ArrowUp: ["s", 1], ArrowDown: ["s", -1] };
      const m = map[e.key];
      if (!m) return;
      e.preventDefault();
      e.stopPropagation();
      this.onBegin?.();
      const next = { ...this.value };
      const step = m[1] * (e.shiftKey ? 5 : 1);
      if (m[0] === "h") next.h = ((next.h + step) % 360 + 360) % 360;
      else next.s = Math.min(100, Math.max(0, next.s + step));
      this.set(next);
      this.onCommit?.({ ...this.value });
    });
  }

  fromEvent(e, fine) {
    const rect = this.canvas.getBoundingClientRect();
    const r = rect.width / 2 - 4;
    const dx = e.clientX - rect.left - rect.width / 2;
    const dy = e.clientY - rect.top - rect.height / 2;
    let h = (Math.atan2(-dy, dx) * 180) / Math.PI;
    h = (h + 360) % 360;
    let s = Math.min(100, (Math.hypot(dx, dy) / r) * 100);
    if (fine) s = this.value.s + (s - this.value.s) * 0.25;
    this.set({ h: Math.round(h), s: Math.round(s) });
    this.onInput?.({ ...this.value });
  }

  set(value) {
    this.value = { h: value.h, s: value.s };
    this.canvas.setAttribute("aria-valuetext", `${this.label}: sắc độ ${this.value.h}°, bão hòa ${this.value.s}`);
    this.draw();
  }

  draw() {
    const { w, h, scale } = fitCanvas(this.canvas);
    const ctx = this.canvas.getContext("2d");
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 4 * scale;
    if (!this.background || this.background.width !== w) {
      const bg = document.createElement("canvas");
      bg.width = w; bg.height = h;
      const b = bg.getContext("2d");
      const img = b.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = x - cx, dy = y - cy;
          const d = Math.hypot(dx, dy) / r;
          const i = (y * w + x) * 4;
          if (d > 1) continue;
          const hue = ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360;
          const [rr, gg, bb] = hsvToRgb(hue, d * 0.85, 0.62);
          img.data[i] = rr; img.data[i + 1] = gg; img.data[i + 2] = bb;
          img.data[i + 3] = d > 0.985 ? Math.round((1 - d) / 0.015 * 255) : 255;
        }
      }
      b.putImageData(img, 0, 0);
      this.background = bg;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.background, 0, 0);
    ctx.strokeStyle = "rgba(255,255,255,.15)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
    const a = (this.value.h * Math.PI) / 180;
    const pr = (this.value.s / 100) * r;
    const px = cx + Math.cos(a) * pr, py = cy - Math.sin(a) * pr;
    ctx.beginPath();
    ctx.arc(px, py, 5 * scale, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1.5 * scale;
    ctx.stroke();
  }
}

function hsvToRgb(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}
