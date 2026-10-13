// Unit test thuần Node (không cần cài thêm gói). Chạy: npm test
import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { parseLightroomPreset, extractPresetValue, presetToXmp, presetToLumaJson, migrateStoredPreset } from "../src/js/presets.js";
import { createZipParts, concatParts, crc32 } from "../src/js/zip.js";
import { findExifSegment, sanitizeExifSegment, injectExif } from "../src/js/jpeg-meta.js";
import { makeCurveEvaluator, buildCurveLut, blendCurvePoints, LUT_SIZE } from "../src/js/curve.js";
import {
  outputToSource, sourceToOutput, fitCropInside, isCropInside, outputSize, rotateQuarter,
  cropRectInView, cropFromViewRect, applyAspect,
} from "../src/js/geometry.js";
import { whiteBalanceMultipliers, neutralizeWhiteBalance, autoTone, analyzePixels } from "../src/js/color.js";
import { defaultSettings, cloneSettings, settingsEqual, mergeSettingGroups, createMask } from "../src/js/settings.js";

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);
let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    failures.push({ name, error });
  }
}
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ""} ${a} ≉ ${b}`);

/* ---------------- Preset ---------------- */

await test("XMP: đọc giá trị cơ bản và tên", async () => {
  const { name, settings } = parseLightroomPreset(await readFile(fixture("portrait-preset.xmp"), "utf8"), "portrait-preset.xmp");
  assert.equal(name, "CHÂN DUNG ẤM");
  const v = settings.values;
  near(v.exposure, 0.35);
  assert.equal(v.contrast, 12);
  assert.equal(v.highlights, -40);
  assert.equal(v.temperature, 15);
  assert.equal(v.tint, -6);
  assert.equal(v.texture, 8);
  assert.equal(v.grain, 20);
});

await test("XMP: tối góc giữ đúng dấu Lightroom (âm = tối)", async () => {
  const { settings } = parseLightroomPreset(await readFile(fixture("portrait-preset.xmp"), "utf8"), "a.xmp");
  assert.equal(settings.values.vignette, -30);
});

await test("XMP: Tint không khớp nhầm SplitToningShadowTint, Clarity không khớp LocalClarity", async () => {
  const text = await readFile(fixture("portrait-preset.xmp"), "utf8");
  assert.equal(extractPresetValue(text, "Tint"), null, "chỉ có IncrementalTint và SplitToningShadowTint");
  assert.equal(extractPresetValue(text, "Clarity2012"), 10);
  assert.equal(extractPresetValue(text, "Contrast2012"), 12);
  assert.equal(extractPresetValue(text, "Exposure2012"), 0.35);
  assert.equal(extractPresetValue(text, "Saturation"), -10);
});

await test("XMP: nhập HSL, đường cong và phân màu", async () => {
  const { settings } = parseLightroomPreset(await readFile(fixture("portrait-preset.xmp"), "utf8"), "a.xmp");
  assert.equal(settings.values.hslHueOrange, -6);
  assert.equal(settings.values.hslSatBlue, -25);
  assert.equal(settings.values.hslLumGreen, 15);
  assert.equal(settings.curve.master.length, 3);
  near(settings.curve.master[0][1], 18 / 255);
  assert.deepEqual(settings.grade.shadows, { h: 210, s: 40, l: 0 });
  assert.deepEqual(settings.grade.midtones, { h: 30, s: 12, l: 0 });
  assert.equal(settings.grade.blending, 70);
  assert.equal(settings.grade.balance, -20);
});

await test(".lrtemplate: Lua, Kelvin, đường cong tham số, split toning", async () => {
  const { name, settings } = parseLightroomPreset(await readFile(fixture("legacy.lrtemplate"), "utf8"), "legacy.lrtemplate");
  assert.equal(name, "OLD FILM");
  assert.equal(settings.values.blacks, 15);
  assert.ok(settings.values.temperature > 10 && settings.values.temperature < 40, `temperature ${settings.values.temperature}`);
  near(settings.values.tint, 8, 1e-9);
  assert.ok(settings.curve.master.length > 3, "đường cong tham số được chuyển thành điểm");
  const f = makeCurveEvaluator(settings.curve.master);
  assert.ok(f(0.12) > 0.12, "ParametricShadows dương làm sáng vùng tối");
  assert.ok(f(0.88) < 0.88, "ParametricHighlights âm làm tối vùng sáng");
  assert.deepEqual(settings.grade.highlights, { h: 45, s: 18, l: 0 });
});

await test("JSON LUMA cũ và mới", () => {
  const old = parseLightroomPreset(JSON.stringify({ name: "x", values: { exposure: 9, contrast: 20 } }), "x.json");
  assert.equal(old.settings.values.exposure, 5, "kẹp vào giới hạn");
  const preset = { name: "MỚI", settings: { values: { saturation: -40 }, curve: { master: [[0, 0.1], [1, 0.9]] } } };
  const back = parseLightroomPreset(presetToLumaJson(preset), "y.json");
  assert.equal(back.name, "MỚI");
  assert.equal(back.settings.values.saturation, -40);
  assert.deepEqual(back.settings.curve.master, [[0, 0.1], [1, 0.9]]);
  assert.throws(() => parseLightroomPreset("{}", "z.json"));
  assert.throws(() => parseLightroomPreset("not json", "z.json"));
});

await test("Xuất XMP rồi đọc lại cho cùng giá trị", () => {
  const preset = { name: "VÒNG <LẶP> & XMP", settings: { values: { exposure: -0.4, vignette: -22, hslSatRed: 15, temperature: 9 }, curve: { master: [[0, 0], [0.5, 0.6], [1, 1]] }, grade: { shadows: { h: 200, s: 30, l: -5 } } } };
  const parsed = parseLightroomPreset(presetToXmp(preset), "out.xmp");
  assert.equal(parsed.name, "VÒNG <LẶP> & XMP");
  near(parsed.settings.values.exposure, -0.4);
  assert.equal(parsed.settings.values.vignette, -22);
  assert.equal(parsed.settings.values.hslSatRed, 15);
  assert.equal(parsed.settings.values.temperature, 9);
  near(parsed.settings.curve.master[1][1], Math.round(0.6 * 255) / 255);
  assert.equal(parsed.settings.grade.shadows.h, 200);
  assert.equal(parsed.settings.grade.shadows.l, -5);
});

await test("Preset đã lưu ở định dạng cũ được chuyển đổi", () => {
  const migrated = migrateStoredPreset({ id: "a", name: "A", values: { vignette: -20 } });
  assert.deepEqual(migrated.settings.values, { vignette: -20 });
  assert.equal(migrated.source, "imported");
});

/* ---------------- ZIP ---------------- */

await test("CRC32 chuẩn", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

await test("ZIP có cấu trúc hợp lệ", () => {
  const files = [{ name: "a.jpg", data: new Uint8Array([1, 2, 3]) }, { name: "ảnh-2.jpg", data: new Uint8Array(1000).fill(7) }];
  const zip = concatParts(createZipParts(files));
  const view = new DataView(zip.buffer);
  const eocd = zip.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50);
  assert.equal(view.getUint16(eocd + 10, true), 2);
  const cdOffset = view.getUint32(eocd + 16, true);
  assert.equal(view.getUint32(cdOffset, true), 0x02014b50);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(14, true), crc32(files[0].data));
});

/* ---------------- EXIF ---------------- */

await test("EXIF: Orientation về 1, xoá GPS và thumbnail, cập nhật kích thước, chèn vào JPEG", async () => {
  const bytes = new Uint8Array(await readFile(fixture("exif-rotated.jpg")));
  const segment = findExifSegment(bytes);
  assert.ok(segment, "tìm thấy APP1 Exif");
  const clean = sanitizeExifSegment(segment, { width: 200, height: 300 });
  assert.ok(clean);
  const text = new TextDecoder("latin1").decode(clean);
  assert.ok(text.includes("LUMA Test Cam"), "giữ thông tin máy ảnh");
  // Tìm lại Orientation
  const tiff = 10;
  const dv = new DataView(clean.buffer, clean.byteOffset);
  const little = dv.getUint16(tiff) === 0x4949;
  const ifd0 = dv.getUint32(tiff + 4, little);
  const count = dv.getUint16(tiff + ifd0, little);
  let orientation = null, gpsPointer = null;
  for (let i = 0; i < count; i++) {
    const e = tiff + ifd0 + 2 + i * 12;
    const tag = dv.getUint16(e, little);
    if (tag === 0x0112) orientation = dv.getUint16(e + 8, little);
    if (tag === 0x8825) gpsPointer = dv.getUint32(e + 8, little);
  }
  assert.equal(orientation, 1);
  assert.equal(dv.getUint16(tiff + gpsPointer, little), 0, "IFD GPS rỗng");
  assert.equal(dv.getUint32(tiff + ifd0 + 2 + count * 12, little), 0, "không còn IFD1");
  const keep = sanitizeExifSegment(segment, { keepGps: true });
  const dv2 = new DataView(keep.buffer, keep.byteOffset);
  assert.ok(dv2.getUint16(tiff + gpsPointer, little) > 0, "giữ GPS khi được yêu cầu");
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xd9]);
  const out = injectExif(fakeJpeg, clean);
  assert.equal(out.length, fakeJpeg.length + clean.length);
  assert.deepEqual([...out.subarray(8, 10)], [0xff, 0xe1], "EXIF nằm ngay sau APP0");
  assert.ok(findExifSegment(out));
});

await test("EXIF: file không có EXIF hoặc hỏng không gây lỗi", () => {
  assert.equal(findExifSegment(new Uint8Array([1, 2, 3])), null);
  assert.equal(findExifSegment(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])), null);
  const broken = new Uint8Array([0xff, 0xe1, 0, 16, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 42, 0, 255, 255, 255, 127]);
  assert.doesNotThrow(() => sanitizeExifSegment(broken));
});

/* ---------------- Đường cong ---------------- */

await test("Đường cong đơn điệu, qua các điểm, LUT đúng kích thước", () => {
  const pts = [[0, 0], [0.25, 0.1], [0.5, 0.5], [0.75, 0.9], [1, 1]];
  const f = makeCurveEvaluator(pts);
  for (const [x, y] of pts) near(f(x), y, 1e-9);
  let prev = -1;
  for (let i = 0; i <= 200; i++) { const y = f(i / 200); assert.ok(y >= prev - 1e-12, "không giảm"); prev = y; }
  const lut = buildCurveLut({ master: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] });
  assert.equal(lut.length, LUT_SIZE * 4);
  near(lut[(LUT_SIZE / 2) * 4], (LUT_SIZE / 2) / (LUT_SIZE - 1), 1e-6);
  const half = blendCurvePoints([[0, 0], [1, 1]], [[0, 0.2], [1, 1]], 0.5);
  near(makeCurveEvaluator(half)(0), 0.1, 1e-9);
});

/* ---------------- Hình học cắt/xoay ---------------- */

await test("Cắt/xoay: ánh xạ hai chiều khớp nhau", () => {
  const crop = { cx: 900, cy: 500, w: 800, h: 450, angle: 7.5, quarter: 1, flip: true };
  for (const [u, v] of [[0, 0], [1, 0], [0.3, 0.8], [1, 1]]) {
    const s = outputToSource(crop, u, v);
    const back = sourceToOutput(crop, s.x, s.y);
    near(back.u, u, 1e-9);
    near(back.v, v, 1e-9);
  }
  assert.deepEqual(outputSize(crop), { width: 450, height: 800 });
});

await test("Cắt/xoay: nắn thẳng tự thu khung nằm trong ảnh", () => {
  const W = 1600, H = 900;
  const crop = fitCropInside({ cx: W / 2, cy: H / 2, w: W, h: H, angle: 10 }, W, H);
  assert.ok(isCropInside(crop, W, H));
  assert.ok(crop.w < W && crop.w > W * 0.6);
  near(crop.w / crop.h, W / H, 1e-6, "giữ tỉ lệ");
  const back = fitCropInside({ ...crop, angle: 0 }, W, H);
  near(back.w, W, 1e-6, "xoay về 0 khôi phục kích thước mong muốn");
});

await test("Cắt/xoay: hình chữ nhật trong khung hiển thị ↔ crop", () => {
  const W = 1200, H = 800;
  for (const crop of [
    { cx: 500, cy: 380, w: 600, h: 400, angle: 5, quarter: 0, flip: false },
    { cx: 650, cy: 420, w: 500, h: 300, angle: -12, quarter: 1, flip: false },
    { cx: 600, cy: 400, w: 700, h: 500, angle: 3, quarter: 3, flip: true },
  ]) {
    const r = cropRectInView(crop, W, H);
    const back = cropFromViewRect(crop, W, H, r);
    near(back.cx, crop.cx, 1e-6);
    near(back.cy, crop.cy, 1e-6);
    near(back.w, crop.w, 1e-6);
    near(back.h, crop.h, 1e-6);
  }
});

await test("Cắt/xoay: xoay 90° đổi chiều đầu ra, tỉ lệ được áp đúng", () => {
  const crop = { cx: 800, cy: 450, w: 1600, h: 900, angle: 0, quarter: 0, flip: false };
  const rotated = rotateQuarter(crop, 1);
  assert.deepEqual(outputSize(rotated), { width: 900, height: 1600 });
  const square = applyAspect(crop, 1, 1600, 900);
  near(outputSize(square).width / outputSize(square).height, 1, 1e-6);
  assert.ok(isCropInside(square, 1600, 900));
});

/* ---------------- Màu ---------------- */

await test("Cân bằng trắng: chấm lại màu đã trung tính hoá cho ra màu xám", () => {
  const sample = [0.32, 0.28, 0.2];
  const wb = neutralizeWhiteBalance(sample);
  assert.ok(wb.temperature < 0, "ảnh ám vàng → giảm nhiệt độ");
  const [r, g, b] = whiteBalanceMultipliers(wb.temperature, wb.tint);
  const out = [sample[0] * r, sample[1] * g, sample[2] * b];
  assert.ok(Math.max(...out) / Math.min(...out) < 1.03, `gần trung tính: ${out}`);
  const [r0, g0, b0] = whiteBalanceMultipliers(0, 0);
  near(r0, 1, 1e-9); near(g0, 1, 1e-9); near(b0, 1, 1e-9);
});

await test("Auto Tone: ảnh tối được làm sáng, ảnh cháy được giảm vùng sáng", () => {
  const make = (value) => { const d = new Uint8ClampedArray(400 * 4); for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = value + ((i / 4) % 20); d[i + 3] = 255; } return d; };
  assert.ok(autoTone(analyzePixels(make(30))).exposure > 0.5);
  const bright = make(235);
  assert.ok(autoTone(analyzePixels(bright)).highlights < 0);
});

/* ---------------- Thiết lập ---------------- */

await test("Thiết lập: sao chép sâu, so sánh, ghép nhóm", () => {
  const a = defaultSettings(1000, 800);
  const b = cloneSettings(a);
  assert.ok(settingsEqual(a, b));
  b.values.exposure = 1;
  assert.ok(!settingsEqual(a, b));
  assert.equal(a.values.exposure, 0);
  const brush = createMask("brush");
  brush.brush = { width: 2, height: 2, data: new Uint8Array(4), version: "v1" };
  b.masks.push(brush, createMask("radial"));
  const c = cloneSettings(b);
  assert.equal(c.masks[0].brush, brush.brush, "dữ liệu cọ chia sẻ theo tham chiếu");
  const merged = mergeSettingGroups(a, { ...b, __size: { width: 1000, height: 800 } }, ["light", "masks"], { width: 1000, height: 800 });
  assert.equal(merged.values.exposure, 1);
  assert.equal(merged.masks.length, 1, "chỉ ghép mask hình học, không ghép cọ");
  assert.equal(merged.masks[0].type, "radial");
  const portrait = mergeSettingGroups(defaultSettings(600, 900), { ...a, __size: { width: 1000, height: 800 } }, ["crop"], { width: 600, height: 900 });
  assert.deepEqual([portrait.crop.w, portrait.crop.h], [600, 900], "không cắt ảnh đích khi ảnh nguồn chưa cắt");
});

if (failures.length) {
  for (const { name, error } of failures) console.error(`✗ ${name}\n  ${error.message}`);
  console.error(`\n${failures.length} test lỗi, ${passed} test đạt.`);
  process.exit(1);
}
console.log(`✓ ${passed} unit test đạt.`);
