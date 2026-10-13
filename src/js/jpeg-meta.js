// Giữ lại EXIF khi xuất JPEG.
// Pixel đã được trình duyệt xoay đúng chiều và chuyển về sRGB khi giải mã, nên:
//  - Orientation được đặt lại = 1 (tránh xoay hai lần),
//  - ảnh thu nhỏ EXIF (IFD1, vẫn là ảnh chưa chỉnh) bị bỏ,
//  - kích thước PixelX/YDimension được cập nhật,
//  - profile ICC gốc KHÔNG được chép (pixel xuất ra đã là sRGB).

export function findExifSegment(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { offset += 2; continue; }
    if (marker === 0xda || marker === 0xd9) return null; // bắt đầu dữ liệu ảnh
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker === 0xe1 && length >= 8 &&
        bytes[offset + 4] === 0x45 && bytes[offset + 5] === 0x78 && bytes[offset + 6] === 0x69 && bytes[offset + 7] === 0x66 &&
        bytes[offset + 8] === 0 && bytes[offset + 9] === 0) {
      return bytes.slice(offset, offset + 2 + length);
    }
    offset += 2 + length;
  }
  return null;
}

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/** Trả về bản sao segment APP1 đã được làm sạch (hoặc null nếu hỏng). */
export function sanitizeExifSegment(segment, { width, height, keepGps = false } = {}) {
  const out = segment.slice();
  const tiffStart = 10; // FF E1 LL LL "Exif\0\0"
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  if (out.length < tiffStart + 8) return null;
  const order = view.getUint16(tiffStart);
  const little = order === 0x4949;
  if (!little && order !== 0x4d4d) return null;
  const u16 = (o) => view.getUint16(tiffStart + o, little);
  const u32 = (o) => view.getUint32(tiffStart + o, little);
  const setU16 = (o, v) => view.setUint16(tiffStart + o, v, little);
  const setU32 = (o, v) => view.setUint32(tiffStart + o, v, little);
  const tiffLength = out.length - tiffStart;
  const inRange = (o, n) => o >= 0 && o + n <= tiffLength;

  const setNumeric = (entry, type, value) => {
    if (type === 3) setU16(entry + 8, value);
    else if (type === 4) setU32(entry + 8, value);
  };

  const walk = (ifdOffset, isIfd0) => {
    if (!inRange(ifdOffset, 2)) return;
    const count = u16(ifdOffset);
    if (!inRange(ifdOffset + 2, count * 12 + 4)) return;
    let exifPointer = null;
    let gpsPointer = null;
    for (let i = 0; i < count; i++) {
      const entry = ifdOffset + 2 + i * 12;
      const tag = u16(entry);
      const type = u16(entry + 2);
      if (!TYPE_SIZE[type]) continue;
      if (tag === 0x0112 && type === 3) setU16(entry + 8, 1);
      if (tag === 0x8769) exifPointer = u32(entry + 8);
      if (tag === 0x8825 && isIfd0) gpsPointer = u32(entry + 8);
      if (width && tag === 0xa002) setNumeric(entry, type, width);
      if (height && tag === 0xa003) setNumeric(entry, type, height);
    }
    if (isIfd0) setU32(ifdOffset + 2 + count * 12, 0); // bỏ liên kết tới IFD1 (thumbnail)
    // Xoá vị trí GPS: làm rỗng IFD GPS (số mục = 0)
    if (!keepGps && gpsPointer && inRange(gpsPointer, 2)) setU16(gpsPointer, 0);
    if (exifPointer) walk(exifPointer, false);
  };
  try {
    walk(u32(4), true);
  } catch {
    return null;
  }
  return out;
}

/** Chèn segment EXIF vào JPEG đầu ra (sau SOI và APP0 nếu có). */
export function injectExif(jpeg, segment) {
  if (!segment || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  let insertAt = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) insertAt = 4 + ((jpeg[4] << 8) | jpeg[5]);
  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, insertAt), 0);
  out.set(segment, insertAt);
  out.set(jpeg.subarray(insertAt), insertAt + segment.length);
  return out;
}
