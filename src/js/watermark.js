// Vẽ watermark (chữ và/hoặc logo) lên ảnh xuất. Dùng chung cho luồng chính và worker.
import { defaultWatermark } from "./config.js";

const ANCHORS = {
  tl: [0, 0], t: [0.5, 0], tr: [1, 0],
  l: [0, 0.5], c: [0.5, 0.5], r: [1, 0.5],
  bl: [0, 1], b: [0.5, 1], br: [1, 1],
};

/**
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} width  @param {number} height
 * @param {object} options  { enabled, text, useLogo, position, size (% cạnh ngắn), opacity (%), margin (%), color }
 * @param {ImageBitmap|null} logo
 * @returns {{x:number,y:number,width:number,height:number}|null} vùng đã vẽ (để kiểm thử)
 */
export function drawWatermark(ctx, width, height, options, logo = null) {
  const o = { ...defaultWatermark, ...(options || {}) };
  const text = (o.text || "").trim();
  const useLogo = o.useLogo && logo;
  if (!o.enabled || (!text && !useLogo)) return null;
  const short = Math.min(width, height);
  const fontPx = Math.max(8, short * (o.size / 100));
  const margin = short * (o.margin / 100);
  const gap = fontPx * 0.45;
  ctx.save();
  ctx.font = `600 ${fontPx}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = "middle";
  const textWidth = text ? ctx.measureText(text).width : 0;
  const logoH = useLogo ? fontPx * 1.8 : 0;
  const logoW = useLogo ? logoH * (logo.width / logo.height) : 0;
  const boxW = logoW + (useLogo && text ? gap : 0) + textWidth;
  const boxH = Math.max(logoH, text ? fontPx * 1.2 : 0);
  const [ax, ay] = ANCHORS[o.position] || ANCHORS.br;
  const x = margin + (width - 2 * margin - boxW) * ax;
  const y = margin + (height - 2 * margin - boxH) * ay;
  ctx.globalAlpha = Math.min(1, Math.max(0, o.opacity / 100));
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = fontPx * 0.12;
  if (useLogo) ctx.drawImage(logo, x, y + (boxH - logoH) / 2, logoW, logoH);
  if (text) {
    ctx.fillStyle = o.color || "#ffffff";
    ctx.fillText(text, x + logoW + (useLogo ? gap : 0), y + boxH / 2);
  }
  ctx.restore();
  return { x, y, width: boxW, height: boxH };
}
