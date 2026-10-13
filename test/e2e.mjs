// Kiểm thử đầu-cuối trong Chromium thật (WebGL 2).
// Cần Playwright: npm i -D playwright && npx playwright install chromium
// Chạy: npm run test:e2e   (tự build và tự khởi động server ở cổng ngẫu nhiên)
import { spawn } from "node:child_process";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";

let playwright;
try {
  playwright = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
} catch {
  console.log("Bỏ qua E2E: chưa cài Playwright (npm i -D playwright && npx playwright install chromium).");
  process.exit(0);
}
const { chromium } = playwright.default || playwright;

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const port = 4300 + Math.floor(Math.random() * 500);

await new Promise((resolve, reject) => {
  const build = spawn(process.execPath, ["scripts/build.mjs"], { cwd: root, stdio: "inherit" });
  build.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("build failed"))));
});
const server = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port) } });
await new Promise((resolve) => server.stdout.once("data", resolve));
const url = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const downloadsDir = await mkdtemp(join(tmpdir(), "luma-e2e-"));
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

let passed = 0;
const failures = [];
async function step(name, fn) {
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`); } catch (error) { failures.push(name); console.error(`  ✗ ${name}\n    ${error.message}`); }
}
const app = (fn, arg) => page.evaluate(fn, arg);
const settle = (ms = 250) => page.waitForTimeout(ms);
const centerPixel = () => app(() => {
  const gl = window.__luma.renderer.gl;
  const c = gl.canvas;
  const px = new Uint8Array(4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return [...px];
});

try {
  await page.goto(url);
  await settle(500);

  await step("Mở ảnh mẫu và render", async () => {
    await page.click("#sampleImageButton");
    await page.waitForFunction(() => window.__luma?.state.photos.length === 1);
    await settle(800);
    const px = await centerPixel();
    assert.ok(px[3] === 255 && px[0] + px[1] + px[2] > 30, `pixel ${px}`);
    assert.equal(await page.textContent("#fileDimensions"), "1600 × 900");
  });

  await step("Phơi sáng thay đổi pixel, hoàn tác / làm lại", async () => {
    const before = await centerPixel();
    await page.fill("#exposureValue", "1.5");
    await page.press("#exposureValue", "Enter");
    await settle();
    const after = await centerPixel();
    assert.ok(after[1] > before[1] + 10, `sáng hơn: ${before} → ${after}`);
    await page.keyboard.press("Control+z");
    await settle();
    assert.equal(await app(() => window.__luma.activePhoto().settings.values.exposure), 0.25);
    await page.keyboard.press("Control+Shift+z");
    await settle();
    assert.equal(await app(() => window.__luma.activePhoto().settings.values.exposure), 1.5);
  });

  await step("Nhấp đúp nhãn đặt lại thanh trượt", async () => {
    await page.dblclick('label[for="exposureRange"]');
    await settle();
    assert.equal(await app(() => window.__luma.activePhoto().settings.values.exposure), 0);
  });

  await step("Đường cong: bấm thêm điểm và kéo", async () => {
    await page.evaluate(() => document.querySelector('[data-section="curve"]').scrollIntoView());
    const box = await page.locator("#curveCanvas").boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3, { steps: 4 });
    await page.mouse.up();
    await settle();
    const pts = await app(() => window.__luma.activePhoto().settings.curve.master);
    assert.equal(pts.length, 3);
    assert.ok(pts[1][1] > 0.6, `điểm giữa được kéo lên: ${pts[1]}`);
  });

  await step("Cọ vùng: vẽ tạo dữ liệu mask, một bước lịch sử", async () => {
    await page.click('[data-add-mask="brush"]');
    const historyBefore = await app(() => window.__luma.activePhoto().history.length);
    const canvas = await page.locator("#canvasViewport").boundingBox();
    await page.mouse.move(canvas.x + 300, canvas.y + 300);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 500, canvas.y + 320, { steps: 8 });
    await page.mouse.up();
    await settle();
    const info = await app(() => {
      const p = window.__luma.activePhoto();
      const m = p.settings.masks[0];
      return { history: p.history.length, painted: m.brush ? m.brush.data.reduce((a, v) => a + (v > 128 ? 1 : 0), 0) : 0 };
    });
    assert.equal(info.history, historyBefore + 1);
    assert.ok(info.painted > 500, `số pixel đã tô: ${info.painted}`);
  });

  await step("Xoá vùng chọn và hoàn tác", async () => {
    await page.click(".mask-item .mask-icon.danger");
    assert.equal(await app(() => window.__luma.activePhoto().settings.masks.length), 0);
    await page.keyboard.press("Control+z");
    assert.equal(await app(() => window.__luma.activePhoto().settings.masks.length), 1);
  });

  await step("Zoom 1:1 và cuộn chuột", async () => {
    await page.click("#actualSizeButton");
    await settle();
    assert.equal(await page.textContent("#zoomValue"), "100%");
    await page.click("#fitButton");
    await settle();
    assert.match(await page.textContent("#zoomValue"), /^Vừa/);
  });

  await step("Nhập preset XMP và áp dụng", async () => {
    await page.setInputFiles("#presetFileInput", fixture("portrait-preset.xmp"));
    await settle(400);
    await page.click("#presetDrawerHandle");
    await settle(300);
    const item = page.locator(".preset-apply", { hasText: "CHÂN DUNG ẤM" });
    await item.click();
    await settle();
    const v = await app(() => window.__luma.activePhoto().settings.values);
    assert.equal(v.vignette, -30);
    assert.equal(v.hslSatBlue, -25);
    await page.fill("#presetAmountRange", "50");
    await page.dispatchEvent("#presetAmountRange", "input");
    await page.dispatchEvent("#presetAmountRange", "change");
    const { half, base } = await app(() => {
      const p = window.__luma.activePhoto();
      return { half: p.settings.values.vignette, base: p.presetState.base.values.vignette };
    });
    assert.equal(half, Math.round(base + (-30 - base) * 0.5), `cường độ 50% (nền ${base})`);
    await page.keyboard.press("Escape");
    await page.waitForSelector("#drawerBackdrop", { state: "hidden" });
  });

  await step("Cắt & xoay: nắn thẳng thu nhỏ khung, kích thước hiển thị cập nhật", async () => {
    await page.keyboard.press("r");
    await page.fill("#cropAngleRange", "6");
    await page.dispatchEvent("#cropAngleRange", "input");
    await page.click("#cropDoneButton");
    await settle();
    const crop = await app(() => window.__luma.activePhoto().settings.crop);
    assert.equal(crop.angle, 6);
    assert.ok(crop.w < 1600);
    assert.match(await page.textContent("#fileDimensions"), /gốc 1600 × 900/);
  });

  await step("Thêm ảnh có EXIF xoay: ảnh được dựng đúng chiều", async () => {
    await page.setInputFiles("#fileInput", fixture("exif-rotated.jpg"));
    await page.waitForFunction(() => window.__luma.state.photos.length === 2);
    await settle(500);
    const dims = await app(() => { const p = window.__luma.activePhoto(); return [p.width, p.height]; });
    assert.deepEqual(dims, [200, 300], "Orientation=6 → ảnh đứng");
  });

  await step("Xuất JPEG giữ EXIF, Orientation = 1, không GPS", async () => {
    await page.click("#exportButton");
    await page.selectOption("#exportScopeSelect", "active");
    await page.selectOption("#deliverySelect", "download");
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#confirmExportButton")]);
    const path = join(downloadsDir, download.suggestedFilename());
    await download.saveAs(path);
    assert.equal(download.suggestedFilename(), "exif-rotated-luma.jpg");
    const bytes = new Uint8Array(await readFile(path));
    const meta = await import("../src/js/jpeg-meta.js");
    const seg = meta.findExifSegment(bytes);
    assert.ok(seg, "có EXIF");
    const text = new TextDecoder("latin1").decode(seg);
    assert.ok(text.includes("LUMA Test Cam"));
    const dv = new DataView(seg.buffer, seg.byteOffset);
    const little = dv.getUint16(10) === 0x4949;
    const ifd0 = dv.getUint32(14, little);
    const n = dv.getUint16(10 + ifd0, little);
    for (let i = 0; i < n; i++) {
      const e = 10 + ifd0 + 2 + i * 12;
      if (dv.getUint16(e, little) === 0x0112) assert.equal(dv.getUint16(e + 8, little), 1);
      if (dv.getUint16(e, little) === 0x8825) assert.equal(dv.getUint16(10 + dv.getUint32(e + 8, little), little), 0);
    }
    await page.waitForFunction(() => !document.querySelector("#exportDialog").open);
  });

  await step("Xuất nhiều ảnh thành ZIP, thu nhỏ cạnh dài, tên không trùng", async () => {
    await page.click("#exportButton");
    await page.selectOption("#exportScopeSelect", "selected");
    await page.selectOption("#formatSelect", "image/png");
    await page.selectOption("#resizeSelect", "long");
    await page.fill("#longEdgeInput", "400");
    await page.selectOption("#deliverySelect", "zip");
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#confirmExportButton")]);
    const path = join(downloadsDir, download.suggestedFilename());
    await download.saveAs(path);
    const zip = new Uint8Array(await readFile(path));
    const dv = new DataView(zip.buffer);
    const eocd = zip.length - 22;
    assert.equal(dv.getUint32(eocd, true), 0x06054b50);
    assert.equal(dv.getUint16(eocd + 10, true), 2);
    // Kiểm tra kích thước PNG đầu tiên (IHDR)
    const nameLen = dv.getUint16(26, true);
    const dataStart = 30 + nameLen;
    const w = dv.getUint32(dataStart + 16), h = dv.getUint32(dataStart + 20);
    assert.ok(Math.max(w, h) === 400, `PNG ${w}×${h}`);
    await page.waitForFunction(() => !document.querySelector("#exportDialog").open);
  });

  await step("Đồng bộ thiết lập sang ảnh đã chọn", async () => {
    await page.locator(".thumb-open").first().click();
    await settle();
    await page.keyboard.press("Control+Shift+s");
    await page.click("#settingsConfirmButton");
    await settle();
    const [a, b] = await app(() => window.__luma.state.photos.map((p) => p.settings.values.hslSatBlue));
    assert.equal(a, b);
  });

  await step("Tự lưu và khôi phục phiên sau khi tải lại trang", async () => {
    await settle(1500);
    const expected = await app(() => window.__luma.state.photos.map((p) => [p.name, p.settings.values.vignette, p.settings.crop.angle, p.settings.masks.length]));
    await page.reload();
    await page.waitForSelector("#restoreCard:not([hidden])");
    await page.click("#restoreSessionButton");
    await page.waitForFunction(() => window.__luma.state.photos.length === 2);
    const restored = await app(() => window.__luma.state.photos.map((p) => [p.name, p.settings.values.vignette, p.settings.crop.angle, p.settings.masks.length]));
    assert.deepEqual(restored, expected);
    const painted = await app(() => window.__luma.state.photos[0].settings.masks[0]?.brush?.data.length || 0);
    assert.ok(painted > 0, "dữ liệu cọ được khôi phục");
  });

  await step("Bỏ ảnh khỏi phiên và hoàn tác", async () => {
    await page.locator(".thumb-card").nth(1).hover();
    await page.locator(".thumb-remove").nth(1).click();
    assert.equal(await app(() => window.__luma.state.photos.length), 1);
    await page.click("#toastAction");
    assert.equal(await app(() => window.__luma.state.photos.length), 2);
  });

  await step("Không có lỗi JavaScript", async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
  server.kill();
}

if (failures.length) {
  console.error(`\n${failures.length} bước E2E lỗi, ${passed} bước đạt.`);
  process.exit(1);
}
console.log(`✓ ${passed} bước E2E đạt.`);
