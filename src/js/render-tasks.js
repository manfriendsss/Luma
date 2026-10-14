// Tác vụ render ngoài khung xem: ảnh xem trước đã chỉnh (lưới / so sánh), ảnh xuất đầy đủ.
// Chạy được trong Web Worker (OffscreenCanvas) lẫn luồng chính – không dùng DOM trừ khi không có OffscreenCanvas.
import { drawWatermark } from "./watermark.js";
import { findExifSegment, sanitizeExifSegment, injectExif } from "./jpeg-meta.js";

export const makeCanvas = (width, height) => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

export function canvasToBlob(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Không thể mã hoá ảnh."))), type, quality));
}

export function decodeBlob(blob) {
  return createImageBitmap(blob, { imageOrientation: "from-image", premultiplyAlpha: "none", colorSpaceConversion: "default" });
}

/** Định dạng mà trình duyệt mã hoá được thật (canvas trả về PNG nếu không hỗ trợ). */
export async function canEncode(type) {
  try {
    const blob = await canvasToBlob(makeCanvas(2, 2), type, 0.8);
    return blob?.type === type;
  } catch {
    return false;
  }
}

const scaleCrop = (crop, s) => ({
  ...crop, cx: crop.cx * s, cy: crop.cy * s, w: crop.w * s, h: crop.h * s,
  ...(crop.iw !== undefined ? { iw: crop.iw * s, ih: crop.ih * s } : {}),
});

let previewCounter = 0;

/**
 * Render ảnh đã chỉnh từ một bitmap (có thể nhỏ hơn ảnh gốc – ví dụ thumbnail) thành JPEG.
 * Toạ độ cắt được co theo tỉ lệ bitmap / ảnh gốc; vùng chọn dùng toạ độ chuẩn hoá nên giữ nguyên.
 */
export async function renderPreviewBlob(renderer, { bitmap, photoWidth, settings, maskSize, maxSide, quality = 0.88 }) {
  const s = bitmap.width / photoWidth;
  const st = Math.abs(s - 1) < 1e-6 ? settings : { ...settings, crop: scaleCrop(settings.crop, s) };
  renderer.photoId = null;
  renderer.setPhoto({ id: `preview-${++previewCounter}`, bitmap, width: bitmap.width, height: bitmap.height, maskSize });
  renderer.syncMasks(st.masks, null);
  const { width, height, pixels } = renderer.renderThumbnail(st, st.crop, maxSide);
  const canvas = makeCanvas(width, height);
  canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), width, height), 0, 0);
  return { blob: await canvasToBlob(canvas, "image/jpeg", quality), width, height };
}

/** Render ảnh xuất đầy đủ theo từng ô, thêm watermark, mã hoá và chèn EXIF. */
export async function renderExportBlob(renderer, {
  bitmap, photoId, photoWidth, photoHeight, settings, maskSize, width, height, outputSharpen = 0,
  format, quality, watermark = null, logo = null, exif = null, shouldCancel, onProgress,
}) {
  renderer.photoId = null;
  renderer.setPhoto({ id: photoId || `export-${++previewCounter}`, bitmap, width: photoWidth, height: photoHeight, maskSize });
  renderer.syncMasks(settings.masks, null);
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(`Không đủ bộ nhớ để tạo ảnh ${width}×${height}.`);
  let done = 0;
  const tile = renderer.maxTileSize();
  const totalTiles = Math.ceil(width / tile) * Math.ceil(height / tile);
  await renderer.renderTiled(settings, {
    crop: settings.crop,
    width,
    height,
    shouldCancel,
    outputSharpen,
    onTile: ({ x, y, width: w, height: h, pixels }) => {
      ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), w, h), x, y);
      done += 1;
      onProgress?.(done / totalTiles);
    },
  });
  if (watermark?.enabled) drawWatermark(ctx, width, height, watermark, logo);
  let blob = await canvasToBlob(canvas, format, quality);
  if (blob.type !== format) throw new Error(`Trình duyệt này không mã hoá được ${format.replace("image/", "").toUpperCase()}.`);
  if (canvas.width) { canvas.width = 1; canvas.height = 1; }
  if (format === "image/jpeg" && exif?.keepExif && exif.file) {
    try {
      const original = new Uint8Array(await exif.file.slice(0, 256 * 1024).arrayBuffer());
      const segment = findExifSegment(original);
      const clean = segment && sanitizeExifSegment(segment, { width, height, keepGps: exif.keepGps });
      if (clean) blob = new Blob([injectExif(new Uint8Array(await blob.arrayBuffer()), clean)], { type: format });
    } catch {
      // EXIF không bắt buộc
    }
  }
  return blob;
}
