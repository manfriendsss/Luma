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
    await page.waitForFunction(() => window.__luma.state.previewSettings?.values.saturation === -100, null, { timeout: 5000 }).catch(() => {});
    const preview = await app(() => [window.__luma.state.previewLabel, window.__luma.state.previewSettings?.values.saturation, document.elementFromPoint(160, 420)?.className]);
    assert.equal(preview[1], -100, `xem trước: ${JSON.stringify(preview)}`);
    await page.waitForSelector("#previewBadge:not([hidden])", { timeout: 5000 });
    let px = await centerPixel();
    for (let i = 0; i < 15 && !(Math.abs(px[0] - px[1]) < 6 && Math.abs(px[1] - px[2]) < 6); i++) { await settle(200); px = await centerPixel(); }
    assert.ok(Math.abs(px[0] - px[1]) < 6 && Math.abs(px[1] - px[2]) < 6, `ảnh xem trước phải đen trắng: ${px}`);
    await page.mouse.move(700, 450);
    await page.waitForFunction(() => window.__luma.state.previewSettings === null, null, { timeout: 5000 });
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

  const setValue = async (id, v) => { await page.fill(`#${id}Value`, String(v)); await page.press(`#${id}Value`, "Enter"); await settle(200); };
  const pixelDiff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  /** Đọc lại điểm giữa cho tới khi thoả điều kiện (render có thể trễ một vài khung hình khi máy bận). */
  const pixelUntil = async (ok, tries = 20) => {
    let px = await centerPixel();
    for (let i = 0; i < tries && !ok(px); i++) { await settle(150); px = await centerPixel(); }
    return px;
  };

  const sectionState = await app(() => [...document.querySelectorAll("[data-section]")].map((s) => [s.dataset.section, s.querySelector(".section-toggle").getAttribute("aria-expanded")]));
  const restoreSections = () => app((saved) => { for (const [id, open] of saved) document.querySelector(`[data-section="${id}"] .section-toggle`).setAttribute("aria-expanded", open); }, sectionState);

  await step("Web Worker sẵn sàng; AVIF chỉ hiện khi mã hoá được", async () => {
    await page.waitForFunction(() => window.__luma.state.capabilities.worker === true, null, { timeout: 15000 });
    const { avif, hidden } = await app(() => ({ avif: window.__luma.state.capabilities.avif, hidden: document.getElementById("avifOption").hidden }));
    assert.equal(hidden, !avif);
  });

  await step("Phối cảnh: Dọc + Vừa khung thay đổi ảnh, góc không lộ vùng trống", async () => {
    await page.click("#collapseAllButton");
    await page.click('[data-section="transform"] .section-toggle');
    await settle(150);
    await page.keyboard.press("r"); await page.keyboard.press("Escape"); // đảm bảo không ở chế độ cắt
    const before = await centerPixel();
    await setValue("perspVertical", 45);
    await page.click("#transformFitButton");
    await settle(400);
    const v = await values();
    assert.equal(v.perspVertical, 45);
    assert.ok(v.perspScale > 100, `thu phóng ${v.perspScale}`);
    assert.ok(await app(() => document.querySelector('[data-section="transform"]').classList.contains("modified")));
    const corners = await app(() => {
      const gl = window.__luma.state.renderer.gl;
      const l = window.__luma.state.layout;
      const px = new Uint8Array(4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(Math.round((l.x + l.width - 3) * l.dpr), Math.round(gl.canvas.height - (l.y + l.height - 3) * l.dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [...px];
    });
    assert.ok(corners[3] === 255 && corners[0] + corners[1] + corners[2] > 20, `góc dưới phải có ảnh: ${corners}`);
    assert.ok(pixelDiff(before, await pixelUntil((p) => pixelDiff(before, p) > 3)) > 3, "ảnh đã thay đổi");
    await setValue("perspVertical", 0);
    await setValue("perspScale", 100);
    await page.click('[data-section="transform"] .section-toggle');
  });

  await step("Đường cong tham số và hiệu chỉnh màu gốc làm thay đổi ảnh", async () => {
    await page.click('[data-section="curve"] .section-toggle');
    await page.click("#curveParamDetails summary");
    const before = await centerPixel();
    await setValue("paramShadows", 80);
    await setValue("paramDarks", 60);
    const lifted = await pixelUntil((p) => pixelDiff(before, p) > 3);
    assert.ok(pixelDiff(before, lifted) > 3, `đường cong tham số: ${before} → ${lifted}`);
    assert.ok(await app(() => document.getElementById("curveParamDetails").classList.contains("modified")));
    await page.click('[data-section="calibration"] .section-toggle');
    await setValue("calGreenHue", 100);
    await setValue("calGreenSat", -80);
    const calibrated = await pixelUntil((p) => pixelDiff(lifted, p) > 2);
    assert.ok(pixelDiff(lifted, calibrated) > 2, `màu gốc: ${lifted} → ${calibrated}`);
    for (let i = 0; i < 4; i++) await page.keyboard.press("Control+z");
    await settle(200);
    const v = await values();
    assert.deepEqual([v.paramShadows, v.paramDarks, v.calGreenHue, v.calGreenSat], [0, 0, 0, 0]);
    await page.click("#collapseAllButton");
    await settle(300);
  });

  await step("LUT .cube: nhập, áp dụng, cường độ, bỏ LUT", async () => {
    const lines = ['TITLE "Đảo màu"', "LUT_3D_SIZE 2"];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) lines.push(`${1 - r} ${1 - g} ${1 - b}`);
    // Vùng chọn được áp dụng sau LUT → tạm tắt để kiểm tra phép đảo màu
    await page.click('[data-section="masks"] .section-bypass');
    await settle(300);
    const before = await centerPixel();
    await page.setInputFiles("#lutFileInput", { name: "invert.cube", mimeType: "text/plain", buffer: Buffer.from(lines.join("\n")) });
    await page.waitForFunction(() => window.__luma.activePhoto().settings.lut?.name === "Đảo màu");
    await settle(300);
    const inverted = await pixelUntil((p) => Math.abs(p[2] - (255 - before[2])) < 40);
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(inverted[c] - (255 - before[c])) < 40, `kênh ${c}: ${before[c]} → ${inverted[c]}`);
    await page.click('[data-section="lut"] .section-toggle');
    await setValue("lutAmount", 0);
    const restored = await pixelUntil((p) => pixelDiff(before, p) < 12);
    assert.ok(pixelDiff(before, restored) < 12, `cường độ 0 = không đổi: ${before} → ${restored}`);
    assert.equal(await app(() => window.__luma.state.luts.size), 1);
    await page.selectOption("#lutSelect", "");
    await settle(200);
    assert.equal((await photo()).settings.lut, null);
    await setValue("lutAmount", 100);
    await page.click('[data-section="masks"] .section-bypass');
    await restoreSections();
  });

  await step("So sánh với một bước lịch sử (thay cho ảnh gốc)", async () => {
    await restoreSections();
    await setValue("exposure", 1.2);
    await page.click('[data-section="history"] .section-toggle');
    await settle(150);
    await page.locator("#historyList .compare-icon").first().click();
    await settle(300);
    const ref = await app(() => ({ label: window.__luma.state.compareRef?.label, mode: window.__luma.state.previewMode }));
    assert.ok(ref.label, "có mốc so sánh");
    assert.equal(ref.mode, "split");
    assert.ok(await page.isVisible("#compareBadge"));
    await page.click("#compareBadgeClear");
    assert.equal(await app(() => window.__luma.state.compareRef), null);
    assert.equal(await app(() => window.__luma.state.previewMode), "after");
    await page.click('[data-section="history"] .section-toggle');
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

  await step("Chế độ Lưới: G mở, mũi tên di chuyển, gắn sao, Enter quay lại", async () => {
    await page.keyboard.press("g");
    await page.waitForSelector("#gridView:not([hidden]) .grid-card");
    assert.equal(await page.locator(".grid-card").count(), 7);
    assert.ok(await page.isHidden("#canvasViewport"));
    const start = await app(() => window.__luma.state.photos.findIndex((p) => p.id === window.__luma.state.activeId));
    await page.keyboard.press(start > 0 ? "ArrowLeft" : "ArrowRight");
    await settle(200);
    const moved = await app(() => window.__luma.state.photos.findIndex((p) => p.id === window.__luma.state.activeId));
    assert.notEqual(moved, start);
    await page.keyboard.press("2");
    await settle(150);
    assert.equal((await photo()).rating, 2);
    assert.equal(await page.locator(".grid-card.active .grid-star.on").count(), 2);
    await page.keyboard.press("0");
    // Ảnh đã chỉnh có thumbnail render lại (worker)
    await page.waitForFunction(() => window.__luma.state.photos.some((p) => p.previewUrl), null, { timeout: 15000 });
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__luma.state.viewMode === "loupe" && window.__luma.activePhoto()?.bitmap);
    assert.ok(await page.isVisible("#canvasViewport"));
  });

  await step("So sánh nhiều ảnh (N): 2 ảnh đã chọn hiện cạnh nhau", async () => {
    await app(() => {
      const { state } = window.__luma;
      const other = state.photos.find((p) => p.id !== state.activeId);
      state.photos.forEach((p) => { p.selected = p.id === state.activeId || p === other; });
    });
    await page.keyboard.press("n");
    await page.waitForFunction(() => document.querySelectorAll(".survey-cell").length === 2);
    await page.waitForFunction(() => [...document.querySelectorAll(".survey-cell img")].every((img) => img.src.startsWith("blob:") && img.complete && img.naturalWidth > 0) && !document.querySelector(".survey-cell.loading"), null, { timeout: 30000 });
    await page.keyboard.press("e");
    await page.waitForFunction(() => window.__luma.state.viewMode === "loupe");
    await app(() => { window.__luma.state.photos.forEach((p) => { p.selected = true; }); });
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

  await step("Watermark: chữ ở giữa ảnh xuất (PNG, qua worker)", async () => {
    const exportCenter = async (watermark) => {
      await page.click("#exportButton");
      await page.selectOption("#exportPresetSelect", "full-jpeg");
      await page.selectOption("#exportScopeSelect", "active");
      await page.selectOption("#formatSelect", "image/png");
      await page.selectOption("#deliverySelect", "download");
      if (watermark !== await page.isChecked("#watermarkToggle")) await page.click("#watermarkToggle");
      if (watermark) {
        await page.fill("#watermarkText", "██████");
        await page.selectOption("#watermarkPosition", "c");
        await page.fill("#watermarkSize", "20");
        await page.fill("#watermarkOpacity", "100");
        await page.dispatchEvent("#watermarkSize", "input");
        await page.dispatchEvent("#watermarkOpacity", "input");
        await page.evaluate(() => { const c = document.getElementById("watermarkColor"); c.value = "#ff0000"; c.dispatchEvent(new Event("change")); });
      }
      const [download] = await Promise.all([page.waitForEvent("download"), page.click("#confirmExportButton")]);
      const bytes = await readFile(await download.path());
      await page.waitForFunction(() => !document.querySelector("#exportDialog").open);
      return app(async (b64) => {
        const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
        const bmp = await createImageBitmap(blob);
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext("2d");
        ctx.drawImage(bmp, 0, 0);
        return [...ctx.getImageData(Math.floor(bmp.width / 2), Math.floor(bmp.height / 2), 1, 1).data];
      }, bytes.toString("base64"));
    };
    const plain = await exportCenter(false);
    const marked = await exportCenter(true);
    assert.ok(marked[0] > 200 && marked[1] < 80 && marked[2] < 80, `giữa ảnh có chữ đỏ: ${marked} (gốc ${plain})`);
    await page.click("#exportButton");
    await page.click("#watermarkToggle");
    await page.click("#cancelExportButton");
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
