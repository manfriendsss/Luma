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
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`); } catch (error) { failures.push(name); console.error(`  ✗ ${name}\n    ${error.message.split("\n")[0]}`); }
}
const app = (fn, arg) => page.evaluate(fn, arg);
const settle = (ms = 250) => page.waitForTimeout(ms);
const photo = () => app(() => window.__luma.activePhoto());
const values = () => app(() => window.__luma.activePhoto().settings.values);
const centerPixel = () => app(() => {
  const gl = window.__luma.state.renderer.gl;
  const c = gl.canvas;
  const px = new Uint8Array(4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return [...px];
});
const sampleBuffer = await readFile(join(root, "src/sample.jpg"));

try {
  await page.goto(url);
  await settle(500);

  await step("Chưa có ảnh: bảng điều chỉnh đóng; mở ra thì bị khoá, không kéo được", async () => {
    assert.equal(await app(() => document.body.classList.contains("panel-open")), false);
    await page.click("#panelHandle");
    await settle(300);
    assert.equal(await app(() => document.body.classList.contains("panel-open")), true);
    assert.equal(await app(() => document.getElementById("panelBody").inert), true);
    assert.ok(await page.isVisible("#panelLockNote"));
    await page.click("#panelHandle");
  });

  await step("Mở ảnh mẫu: bảng tự mở, mở khoá, render đúng", async () => {
    await page.click("#sampleImageButton");
    await page.waitForFunction(() => window.__luma?.state.photos.length === 1 && window.__luma.activePhoto()?.bitmap);
    await settle(800);
    assert.equal(await app(() => document.body.classList.contains("panel-open")), true);
    assert.equal(await app(() => document.getElementById("panelBody").inert), false);
    const px = await centerPixel();
    assert.ok(px[3] === 255 && px[0] + px[1] + px[2] > 30, `pixel ${px}`);
  });

  await step("Phơi sáng, hoàn tác/làm lại và bảng Lịch sử có nhãn", async () => {
    await page.fill("#exposureValue", "1.5");
    await page.press("#exposureValue", "Enter");
    await settle();
    assert.equal((await values()).exposure, 1.5);
    const labels = await app(() => [...document.querySelectorAll("#historyList .history-step")].map((b) => b.textContent));
    assert.equal(labels[0], "Phơi sáng", `nhãn bước hiện tại: ${labels}`);
    await page.keyboard.press("Control+z");
    assert.equal((await values()).exposure, 0.25);
    await page.keyboard.press("Control+Shift+z");
    assert.equal((await values()).exposure, 1.5);
    await page.dblclick('label[for="exposureRange"]');
    assert.equal((await values()).exposure, 0);
  });

  await step("Tạm tắt nhóm (bypass) và dấu đã chỉnh", async () => {
    assert.ok(await app(() => document.querySelector('[data-section="light"]').classList.contains("modified")));
    await page.click('[data-section="light"] .section-bypass');
    assert.equal(await app(() => window.__luma.activePhoto().settings.disabled.light), true);
    await page.click('[data-section="light"] .section-bypass');
    assert.ok(!(await app(() => window.__luma.activePhoto().settings.disabled.light)));
  });

  await step("Rê chuột lên preset: xem trước trên ảnh lớn, rời chuột thì trả lại", async () => {
    await page.click("#presetDrawerHandle");
    await settle(300);
    await page.hover(".preset-apply >> text=ĐEN TRẮNG CỔ ĐIỂN");
    await settle(300);
    const preview = await app(() => [window.__luma.state.previewLabel, window.__luma.state.previewSettings?.values.saturation, document.elementFromPoint(160, 420)?.className]);
    assert.equal(preview[1], -100, `xem trước: ${JSON.stringify(preview)}`);
    assert.ok(await page.isVisible("#previewBadge"));
    const px = await centerPixel();
    assert.ok(Math.abs(px[0] - px[1]) < 6 && Math.abs(px[1] - px[2]) < 6, `ảnh xem trước phải đen trắng: ${px}`);
    await page.mouse.move(700, 450);
    await settle(300);
    assert.equal(await app(() => window.__luma.state.previewSettings), null);
    await page.keyboard.press("Escape");
  });

  await step("Nhập preset XMP, áp dụng và cường độ", async () => {
    await page.setInputFiles("#presetFileInput", fixture("portrait-preset.xmp"));
    await settle(300);
    await page.click("#presetDrawerHandle");
    await page.click(".preset-apply >> text=CHÂN DUNG ẤM");
    await settle();
    assert.equal((await values()).vignette, -30);
    await page.fill("#presetAmountRange", "50");
    await page.dispatchEvent("#presetAmountRange", "input");
    await page.dispatchEvent("#presetAmountRange", "change");
    const { half, base } = await app(() => { const p = window.__luma.activePhoto(); return { half: p.settings.values.vignette, base: p.presetState.base.values.vignette }; });
    assert.equal(half, Math.round(base + (-30 - base) * 0.5));
    await page.keyboard.press("Escape");
  });

  await step("Mask Oval: bấm nhầm không dịch vùng chọn mà thoát chế độ chỉnh; kéo mới sửa", async () => {
    await page.click('[data-add-mask="radial"]');
    const before = await app(() => JSON.stringify(window.__luma.activePhoto().settings.masks[0].radial));
    await page.mouse.click(120, 200);
    await settle();
    const after = await app(() => JSON.stringify(window.__luma.activePhoto().settings.masks[0].radial));
    assert.equal(after, before, "bấm không kéo không được làm dịch oval");
    assert.equal((await photo()).activeMaskId, null, "đã thoát chế độ chỉnh");
    await page.click(".mask-item .mask-select");
    await page.mouse.move(150, 200);
    await page.mouse.down();
    await page.mouse.move(300, 320, { steps: 6 });
    await page.mouse.up();
    const moved = await app(() => JSON.stringify(window.__luma.activePhoto().settings.masks[0].radial));
    assert.notEqual(moved, before, "kéo thì vẽ oval mới");
  });

  await step("Delete xoá vùng chọn đang chọn, Ctrl+Z khôi phục", async () => {
    await page.click("#canvasViewport", { position: { x: 600, y: 60 }, force: true }).catch(() => {});
    await app(() => { const p = window.__luma.activePhoto(); p.activeMaskId = p.settings.masks[0].id; document.activeElement?.blur(); });
    await page.keyboard.press("Delete");
    assert.equal((await photo()).settings.masks.length, 0);
    await page.keyboard.press("Control+z");
    assert.equal((await photo()).settings.masks.length, 1);
  });

  await step("Mask Dải sáng làm thay đổi ảnh", async () => {
    await app(() => window.__luma.exitMaskEditing());
    await page.click('[data-add-mask="luma"]');
    await page.fill("#mask-exposureValue", "-2");
    await page.press("#mask-exposureValue", "Enter");
    await settle();
    const p = await photo();
    const mask = p.settings.masks.at(-1);
    assert.equal(mask.type, "luma");
    assert.equal(mask.values.exposure, -2);
  });

  await step("Cọ vùng: vẽ tạo dữ liệu mask, một bước lịch sử", async () => {
    await app(() => window.__luma.exitMaskEditing());
    await page.click('[data-add-mask="brush"]');
    const before = (await photo()).history.length;
    const box = await page.locator("#canvasViewport").boundingBox();
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 500, box.y + 320, { steps: 8 });
    await page.mouse.up();
    const info = await app(() => { const p = window.__luma.activePhoto(); const m = p.settings.masks.at(-1); return { h: p.history.length, n: m.brush ? m.brush.data.reduce((a, v) => a + (v > 128 ? 1 : 0), 0) : 0 }; });
    assert.equal(info.h, before + 1);
    assert.ok(info.n > 500);
    await page.keyboard.press("Escape");
  });

  await step("Cắt & xoay: nắn thẳng, X đổi dọc/ngang", async () => {
    await page.keyboard.press("r");
    await page.fill("#cropAngleRange", "6");
    await page.dispatchEvent("#cropAngleRange", "input");
    const landscape = await app(() => { const c = window.__luma.activePhoto().settings.crop; return c.w > c.h; });
    await page.keyboard.press("x");
    const portrait = await app(() => { const c = window.__luma.activePhoto().settings.crop; return c.h > c.w; });
    assert.ok(landscape && portrait);
    await page.keyboard.press("x");
    await page.keyboard.press("Enter");
    assert.equal((await photo()).settings.crop.angle, 6);
  });

  await step("Mở nhiều ảnh: chỉ giữ tối đa 2 ảnh giải mã trong RAM", async () => {
    const files = Array.from({ length: 6 }, (_, i) => ({ name: `bulk-${i + 1}.jpg`, mimeType: "image/jpeg", buffer: sampleBuffer }));
    await page.setInputFiles("#fileInput", files);
    await page.waitForFunction(() => window.__luma.state.photos.length === 7, null, { timeout: 60000 });
    await settle(800);
    for (let i = 0; i < 4; i++) { await page.keyboard.press("ArrowRight"); await settle(300); }
    const resident = await app(() => window.__luma.residentCount());
    assert.ok(resident <= 2, `ảnh trong RAM: ${resident}`);
  });

  await step("Phím mũi tên trên đường cong / vòng màu không chuyển ảnh", async () => {
    await page.locator(".thumb-open").first().click();
    await settle(400);
    const id = (await photo()).id;
    await page.evaluate(() => document.querySelector('[data-section="curve"]').scrollIntoView());
    const box = await page.locator("#curveCanvas").boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.press("ArrowRight");
    assert.equal((await photo()).id, id, "đường cong");
    await page.evaluate(() => { const s = document.querySelector('[data-section="grade"] .section-toggle'); if (s.getAttribute("aria-expanded") === "false") s.click(); });
    await page.locator(".wheel-canvas").first().focus();
    await page.keyboard.press("ArrowRight");
    assert.equal((await photo()).id, id, "vòng màu");
  });

  await step("Sao, cờ, bộ lọc và Ctrl+bấm chọn nhiều", async () => {
    await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
    await app(() => document.activeElement?.blur());
    await page.keyboard.press("3");
    await page.keyboard.press("p");
    const p = await photo();
    assert.equal(p.rating, 3);
    assert.equal(p.flag, 1);
    await page.selectOption("#filterSelect", "stars3");
    assert.equal(await page.locator(".thumb-card").count(), 1);
    await page.selectOption("#filterSelect", "all");
    await app(() => window.__luma.state.photos.forEach((ph) => { ph.selected = false; }));
    await page.locator(".thumb-open").nth(2).click({ modifiers: ["Control"] });
    await page.locator(".thumb-open").nth(4).click({ modifiers: ["Shift"] });
    assert.equal(await app(() => window.__luma.state.photos.filter((ph) => ph.selected).length), 3);
  });

  await step("Bản sao ảo và snapshot", async () => {
    await page.locator(".thumb-open").first().click();
    await settle(300);
    await app(() => document.activeElement?.blur());
    await page.keyboard.press("Control+'");
    await settle(400);
    const copy = await photo();
    assert.ok(copy.copyIndex === 1 && copy.fileRef, "bản sao ảo trỏ tới file gốc");
    await page.evaluate(() => { const s = document.querySelector('[data-section="history"] .section-toggle'); if (s.getAttribute("aria-expanded") === "false") s.click(); });
    await page.click("#snapshotButton");
    await page.fill("#nameInput", "Bản ấm");
    await page.click('#nameForm button[value="default"]');
    await page.waitForSelector("#snapshotList .history-step");
    await page.fill("#temperatureValue", "60");
    await page.press("#temperatureValue", "Enter");
    const beforeApply = await app(() => [window.__luma.activePhoto().snapshots.map((x) => x.settings.values.temperature), window.__luma.activePhoto().settings.values.temperature]);
    await page.click("#snapshotList .history-step");
    assert.notEqual((await values()).temperature, 60, `snapshot đã khôi phục: ${JSON.stringify(beforeApply)} → ${(await values()).temperature}`);
  });

  await step("Menu Thiết lập: đồng bộ sang ảnh đã chọn", async () => {
    await page.click("#settingsMenuButton");
    await page.click("#menuSync");
    await page.click("#settingsConfirmButton");
    const synced = await app(() => {
      const a = window.__luma.activePhoto();
      return window.__luma.state.photos.filter((p) => p.selected && p.id !== a.id).every((p) => p.settings.values.hslSatBlue === a.settings.values.hslSatBlue);
    });
    assert.ok(synced);
  });

  await step("Thư mục (OPFS): đọc .luma.json có sẵn và ghi lại khi chỉnh", async () => {
    await app(async (bytes) => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("luma-test-folder", { create: true });
      const img = await (await dir.getFileHandle("canh-dem.jpg", { create: true })).createWritable();
      await img.write(new Uint8Array(bytes));
      await img.close();
      const side = await (await dir.getFileHandle("canh-dem.jpg.luma.json", { create: true })).createWritable();
      await side.write(JSON.stringify({ format: "luma-sidecar", version: 1, rating: 4, flag: 0, settings: { values: { exposure: 0.7, contrast: 22 } } }));
      await side.close();
      await window.__luma.openFolderHandle(dir);
    }, [...sampleBuffer]);
    await page.waitForFunction(() => window.__luma.activePhoto()?.name === "canh-dem.jpg");
    const p = await photo();
    assert.equal(p.settings.values.exposure, 0.7);
    assert.equal(p.rating, 4);
    await page.fill("#contrastValue", "-15");
    await page.press("#contrastValue", "Enter");
    await app(() => window.__luma.flushAutosave());
    const saved = await app(async () => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("luma-test-folder");
      return JSON.parse(await (await (await dir.getFileHandle("canh-dem.jpg.luma.json")).getFile()).text());
    });
    assert.equal(saved.settings.values.contrast, -15);
    assert.equal(saved.rating, 4);
  });

  await step("Xuất JPEG theo mẫu tên, giữ EXIF, Orientation = 1", async () => {
    await page.setInputFiles("#fileInput", fixture("exif-rotated.jpg"));
    await page.waitForFunction(() => window.__luma.activePhoto()?.name === "exif-rotated.jpg");
    await settle(400);
    assert.deepEqual(await app(() => { const p = window.__luma.activePhoto(); return [p.width, p.height]; }), [200, 300]);
    await page.click("#exportButton");
    await page.selectOption("#exportPresetSelect", "full-jpeg");
    await page.selectOption("#exportScopeSelect", "active");
    await page.fill("#templateInput", "{name}-{n}-{w}x{h}");
    await page.selectOption("#sharpenSelect", "standard");
    await page.selectOption("#deliverySelect", "download");
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#confirmExportButton")]);
    assert.equal(download.suggestedFilename(), "exif-rotated-001-200x300.jpg");
    const path = join(downloadsDir, download.suggestedFilename());
    await download.saveAs(path);
    const bytes = new Uint8Array(await readFile(path));
    const meta = await import("../src/js/jpeg-meta.js");
    const seg = meta.findExifSegment(bytes);
    assert.ok(seg && new TextDecoder("latin1").decode(seg).includes("LUMA Test Cam"));
    await page.waitForFunction(() => !document.querySelector("#exportDialog").open);
  });

  await step("Xuất ZIP PNG giới hạn cạnh dài cho ảnh theo bộ lọc", async () => {
    await page.selectOption("#filterSelect", "stars3");
    await page.click("#exportButton");
    await page.selectOption("#exportScopeSelect", "visible");
    await page.selectOption("#formatSelect", "image/png");
    await page.selectOption("#resizeSelect", "long");
    await page.fill("#longEdgeInput", "400");
    const count = await page.textContent("#exportCount");
    const n = Number(count.split(" ")[0]);
    assert.ok(n >= 2, `số ảnh theo bộ lọc: ${count}`);
    if (await page.locator('#deliverySelect option[value="zip"]').count()) await page.selectOption("#deliverySelect", "zip");
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#confirmExportButton")]);
    const path = join(downloadsDir, download.suggestedFilename());
    await download.saveAs(path);
    const zip = new Uint8Array(await readFile(path));
    const dv = new DataView(zip.buffer);
    assert.equal(dv.getUint32(zip.length - 22, true), 0x06054b50);
    assert.equal(dv.getUint16(zip.length - 22 + 10, true), n);
    const dataStart = 30 + dv.getUint16(26, true);
    assert.equal(Math.max(dv.getUint32(dataStart + 16), dv.getUint32(dataStart + 20)), 400);
    await page.waitForFunction(() => !document.querySelector("#exportDialog").open);
    await page.selectOption("#filterSelect", "all");
  });

  await step("Chuyển giao diện sang tiếng Anh và trở lại", async () => {
    await page.click("#langToggle");
    await settle(200);
    assert.equal((await page.textContent("#exportButton")).trim(), "Export");
    assert.equal((await page.textContent('label[for="exposureRange"]')).trim(), "Exposure");
    await page.fill("#exposureValue", "0.5");
    await page.press("#exposureValue", "Enter");
    assert.ok(/Exposure/.test(await page.textContent("#historyList .history-step.current")), "nhãn lịch sử mới cũng được dịch");
    await page.click("#langToggle");
    await settle(200);
    assert.equal((await page.textContent("#exportButton")).trim(), "Xuất ảnh");
  });

  await step("Tự lưu và khôi phục phiên (sao, snapshot, bản sao ảo)", async () => {
    await app(() => window.__luma.flushAutosave());
    const expected = await app(() => window.__luma.state.photos.filter((p) => p.source.kind !== "folder").map((p) => [p.name, p.rating, p.snapshots.length, p.settings.values.vignette]));
    const total = await app(() => window.__luma.state.photos.length);
    await page.reload();
    await page.waitForSelector("#restoreCard:not([hidden])");
    await page.click("#restoreSessionButton");
    await page.waitForFunction((n) => window.__luma.state.photos.length >= n, total, { timeout: 60000 });
    const restored = await app(() => window.__luma.state.photos.filter((p) => p.source.kind !== "folder").map((p) => [p.name, p.rating, p.snapshots.length, p.settings.values.vignette]));
    assert.deepEqual(restored, expected, `${JSON.stringify(restored)} ≠ ${JSON.stringify(expected)}`);
  });

  await step("Bỏ ảnh khỏi phiên và hoàn tác", async () => {
    const n = await app(() => window.__luma.state.photos.length);
    await page.locator(".thumb-card").nth(1).hover();
    await page.locator(".thumb-remove").nth(1).click();
    assert.equal(await app(() => window.__luma.state.photos.length), n - 1);
    await page.click("#toastAction");
    assert.equal(await app(() => window.__luma.state.photos.length), n);
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
