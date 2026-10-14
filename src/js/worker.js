// Web Worker xử lý nặng ngoài luồng giao diện: giải mã + thumbnail + thống kê khi nhập ảnh,
// render ảnh xem trước đã chỉnh (lưới, so sánh) và render + mã hoá ảnh xuất (WebGL 2 trên OffscreenCanvas).
import { Renderer } from "./renderer.js";
import { analyzePixels } from "./color.js";
import { renderPreviewBlob, renderExportBlob, makeCanvas, canvasToBlob, decodeBlob, canEncode } from "./render-tasks.js";

let renderer = null;
const cancelled = new Set();

function getRenderer() {
  if (!renderer) renderer = new Renderer(new OffscreenCanvas(1, 1));
  return renderer;
}

function scaledCanvas(bitmap, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = makeCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

const handlers = {
  async probe() {
    let webgl = false;
    let maxTextureSize = 0;
    try {
      const r = getRenderer();
      webgl = true;
      maxTextureSize = r.maxTextureSize;
    } catch {
      webgl = false;
    }
    return { webgl, maxTextureSize, avif: await canEncode("image/avif") };
  },

  async analyze({ file, maxTextureSize }) {
    let bitmap;
    try { bitmap = await decodeBlob(file); } catch { throw new Error("decode"); }
    try {
      if (maxTextureSize && (bitmap.width > maxTextureSize || bitmap.height > maxTextureSize)) {
        return { tooLarge: true, width: bitmap.width, height: bitmap.height };
      }
      const thumb = scaledCanvas(bitmap, 320);
      const thumbBlob = await canvasToBlob(thumb.canvas, "image/jpeg", 0.82);
      const small = scaledCanvas(bitmap, 384);
      const stats = analyzePixels(small.ctx.getImageData(0, 0, small.canvas.width, small.canvas.height).data);
      return { width: bitmap.width, height: bitmap.height, thumbBlob, stats };
    } finally {
      bitmap.close?.();
    }
  },

  async preview({ source, photoWidth, settings, maskSize, maxSide, lut }) {
    const r = getRenderer();
    r.lutResolver = () => lut;
    const bitmap = await decodeBlob(source);
    try {
      return await renderPreviewBlob(r, { bitmap, photoWidth, settings, maskSize, maxSide });
    } finally {
      bitmap.close?.();
    }
  },

  async export(payload, jobId) {
    const r = getRenderer();
    r.lutResolver = () => payload.lut;
    const bitmap = await decodeBlob(payload.file);
    const logo = payload.watermark?.enabled && payload.watermark.useLogo && payload.logo ? await decodeBlob(payload.logo).catch(() => null) : null;
    try {
      const blob = await renderExportBlob(r, {
        ...payload,
        bitmap,
        logo,
        exif: { file: payload.file, keepExif: payload.keepExif, keepGps: payload.keepGps },
        shouldCancel: () => cancelled.has(jobId),
        onProgress: (fraction) => self.postMessage({ id: jobId, progress: fraction }),
      });
      return { blob };
    } finally {
      bitmap.close?.();
      logo?.close?.();
      cancelled.delete(jobId);
    }
  },
};

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {};
  if (type === "cancel") { cancelled.add(payload.jobId); return; }
  const handler = handlers[type];
  if (!handler) { self.postMessage({ id, ok: false, error: `Tác vụ không hỗ trợ: ${type}` }); return; }
  try {
    const result = await handler(payload, id);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error), name: error?.name });
  }
};
