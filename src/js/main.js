// Điểm khởi động: nối các module, thanh công cụ, kéo thả và phím tắt.
import { Renderer } from "./renderer.js";
import { setRangeProgress } from "./controls.js";
import { drawHistogram } from "./widgets.js";
import { fitCropInside, rotateQuarter, aspectValue, applyAspect } from "./geometry.js";
import { defaultCrop } from "./settings.js";
import {
  state, el, clamp, activePhoto, activeMask, editingText, focusOwnsKeys, showToast, undo, redo, scheduleRender,
} from "./core.js";
import { initSession, flushAutosave } from "./session.js";
import {
  loadFiles, openFolder, openFolderHandle, folderSupported, createVirtualCopy, setRating, setFlag, updateFolderChip, residentCount,
} from "./photos.js";
import { initFilmstrip, navigatePhoto, targetPhotos } from "./filmstrip.js";
import {
  initView, setTool, finishCrop, setCrop, fitView, actualSize, stepZoom, updateBrushCursor, exitMaskEditing,
  swapCropOrientation, cycleCropGrid, showAngleHint, scheduleHistogram, updateHistogramInfo,
} from "./view.js";
import { initPanel, togglePanel, resetPhoto, deleteMask } from "./panel.js";
import { initPresets, setPresetDrawer, importPresetFiles } from "./presets-ui.js";
import { initExport, openExportDialog } from "./export.js";
import { initDialogs, openSettingsDialog, pasteSettings, copyPreviousSettings, toggleMenu } from "./dialogs.js";
import { initI18n, toggleLanguage } from "./i18n.js";

function setPreviewMode(mode) {
  state.previewMode = mode;
  document.querySelectorAll("[data-preview-mode]").forEach((b) => {
    const active = b.dataset.previewMode === mode;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  });
  scheduleRender();
}

function toggleClipping(force) {
  state.clipping = force ?? !state.clipping;
  el.clippingButton.setAttribute("aria-pressed", String(state.clipping));
  el.clippingButton.classList.toggle("active", state.clipping);
  scheduleRender();
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch {
    showToast("Trình duyệt không cho phép toàn màn hình.");
  }
}

function bindToolbar() {
  const chooseFiles = () => el.fileInput.click();
  el.openImageButton.addEventListener("click", chooseFiles);
  el.addImagesButton.addEventListener("click", chooseFiles);
  el.fileInput.addEventListener("change", () => loadFiles(el.fileInput.files));
  for (const button of [el.openFolderButton, el.emptyOpenFolderButton]) {
    button.hidden = !folderSupported();
    button.addEventListener("click", openFolder);
  }
  el.sampleImageButton.addEventListener("click", async () => {
    try {
      const response = await fetch("./sample.jpg");
      if (!response.ok) throw new Error("Không thể mở ảnh mẫu.");
      const blob = await response.blob();
      await loadFiles([new File([blob], "anh-mau-mua-thu.jpg", { type: "image/jpeg" })]);
      const { applyPreset } = await import("./presets-ui.js");
      applyPreset("autumn");
    } catch (error) {
      showToast(error.message || "Không thể mở ảnh mẫu.");
    }
  });

  el.undoButton.addEventListener("click", () => undo());
  el.redoButton.addEventListener("click", () => redo());
  el.menuPrevious.addEventListener("click", copyPreviousSettings);
  el.menuCopy.addEventListener("click", () => openSettingsDialog("copy"));
  el.menuPaste.addEventListener("click", pasteSettings);
  el.menuSync.addEventListener("click", () => openSettingsDialog("sync"));
  el.menuVirtualCopy.addEventListener("click", () => createVirtualCopy());
  el.menuReset.addEventListener("click", resetPhoto);
  el.fullscreenButton.addEventListener("click", toggleFullscreen);
  el.shortcutsButton.addEventListener("click", () => el.shortcutsDialog.showModal());
  el.langToggle.addEventListener("click", toggleLanguage);
  document.addEventListener("fullscreenchange", () => {
    const active = !!document.fullscreenElement;
    el.fullscreenButton.setAttribute("aria-pressed", String(active));
    el.fullscreenButton.querySelector("span").textContent = active ? "×" : "⛶";
    el.fullscreenButton.setAttribute("aria-label", active ? "Thoát toàn màn hình" : "Toàn màn hình");
    scheduleRender();
  });

  el.fitButton.addEventListener("click", fitView);
  el.actualSizeButton.addEventListener("click", () => actualSize());
  el.zoomInButton.addEventListener("click", () => stepZoom(1));
  el.zoomOutButton.addEventListener("click", () => stepZoom(-1));
  el.cropToolButton.addEventListener("click", () => setTool("crop"));
  el.clippingButton.addEventListener("click", () => toggleClipping());
  el.shadowClipIndicator.addEventListener("click", () => toggleClipping());
  el.highlightClipIndicator.addEventListener("click", () => toggleClipping());
  document.querySelectorAll("[data-preview-mode]").forEach((b) => b.addEventListener("click", () => setPreviewMode(b.dataset.previewMode)));
}

function bindCropBar() {
  el.cropAspectSelect.addEventListener("change", () => {
    const photo = activePhoto();
    if (!photo) return;
    const crop = { ...photo.settings.crop, aspect: el.cropAspectSelect.value };
    const aspect = aspectValue(crop.aspect, photo.width, photo.height, crop);
    setCrop(photo, aspect ? applyAspect(crop, aspect, photo.width, photo.height) : crop);
  });
  el.cropAngleRange.addEventListener("input", () => {
    const photo = activePhoto();
    if (!photo) return;
    setCrop(photo, fitCropInside({ ...photo.settings.crop, angle: Number(el.cropAngleRange.value) }, photo.width, photo.height));
    showAngleHint();
  });
  el.cropAngleRange.addEventListener("dblclick", () => {
    const photo = activePhoto();
    if (photo) setCrop(photo, fitCropInside({ ...photo.settings.crop, angle: 0 }, photo.width, photo.height));
  });
  el.cropGridSelect.addEventListener("change", () => { state.cropGrid = el.cropGridSelect.value; scheduleRender(); });
  const rotate = (dir) => {
    const photo = activePhoto();
    if (!photo) return;
    let crop = rotateQuarter(photo.settings.crop, dir);
    const aspect = aspectValue(crop.aspect, photo.width, photo.height, crop);
    if (aspect && crop.aspect !== "original") crop = applyAspect(crop, aspect, photo.width, photo.height);
    setCrop(photo, crop);
  };
  el.rotateLeftButton.addEventListener("click", () => rotate(-1));
  el.rotateRightButton.addEventListener("click", () => rotate(1));
  el.swapCropButton.addEventListener("click", swapCropOrientation);
  el.flipButton.addEventListener("click", () => {
    const photo = activePhoto();
    if (photo) setCrop(photo, { ...photo.settings.crop, flip: !photo.settings.crop.flip });
  });
  el.cropResetButton.addEventListener("click", () => {
    const photo = activePhoto();
    if (photo) setCrop(photo, { ...defaultCrop(photo.width, photo.height), iw: photo.width, ih: photo.height });
  });
  el.cropDoneButton.addEventListener("click", () => finishCrop(true));
}

function bindDragDrop() {
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  window.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth += 1; el.dropOverlay.hidden = false; });
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("dragleave", (e) => { if (!hasFiles(e)) return; dragDepth -= 1; if (dragDepth <= 0) { dragDepth = 0; el.dropOverlay.hidden = true; } });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    el.dropOverlay.hidden = true;
    const files = [...e.dataTransfer.files];
    const presetFiles = files.filter((f) => /\.(xmp|lrtemplate|json)$/i.test(f.name));
    const images = files.filter((f) => !presetFiles.includes(f));
    if (presetFiles.length) importPresetFiles(presetFiles);
    if (images.length) loadFiles(images);
  });
}

function onKeyDown(event) {
  const ctrl = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  const typing = editingText();
  if (document.querySelector("dialog[open]")) return;
  if (!el.settingsMenu.hidden && event.key === "Escape") { toggleMenu(false); return; }

  if (ctrl && !typing) {
    if (key === "z" && !event.shiftKey) { event.preventDefault(); undo(); return; }
    if ((key === "z" && event.shiftKey) || key === "y") { event.preventDefault(); redo(); return; }
    if (event.shiftKey && key === "c") { event.preventDefault(); openSettingsDialog("copy"); return; }
    if (event.shiftKey && key === "v") { event.preventDefault(); pasteSettings(); return; }
    if (event.shiftKey && key === "s") { event.preventDefault(); openSettingsDialog("sync"); return; }
    if (event.shiftKey && key === "e") { event.preventDefault(); openExportDialog(); return; }
    if (event.key === "'") { event.preventDefault(); createVirtualCopy(); return; }
    return;
  }
  if (typing || (event.altKey && key !== "alt")) return;

  if (event.key === "Escape") {
    if (state.drawerOpen) { setPresetDrawer(false); return; }
    if (state.tool === "crop") { finishCrop(false); return; }
    if (state.tool) { setTool(null); return; }
    exitMaskEditing();
    return;
  }
  if (event.key === "Enter" && state.tool === "crop") { event.preventDefault(); finishCrop(true); return; }
  if (event.code === "Space" && activePhoto()) {
    const tag = document.activeElement?.tagName;
    if (tag === "BUTTON" || (tag === "INPUT" && document.activeElement.type === "checkbox")) return;
    event.preventDefault();
    if (!state.spaceDown) { state.spaceDown = true; el.brushCursor.hidden = true; }
    return;
  }
  if (event.key === "\\" && !event.repeat) { state.holdingBefore = true; scheduleRender(); return; }
  if (event.key === "?") { el.shortcutsDialog.showModal(); return; }
  if (key === "t") { if (event.shiftKey) setPresetDrawer(!state.drawerOpen); else togglePanel(); return; }
  if (key === "f") { toggleFullscreen(); return; }
  const photo = activePhoto();
  if (!photo) return;
  const ownsKeys = focusOwnsKeys();

  if (state.tool === "crop") {
    if (key === "x") { swapCropOrientation(); return; }
    if (key === "o") { cycleCropGrid(); return; }
  }
  if (key === "r" && event.shiftKey) resetPhoto();
  else if (key === "r") setTool("crop");
  else if (key === "j") toggleClipping();
  else if (key === "w") setTool("eyedropper");
  else if (key === "y") setPreviewMode(state.previewMode === "split" ? "after" : "split");
  else if (key === "o") { state.showMaskOverlay = !state.showMaskOverlay; el.showMaskToggle.checked = state.showMaskOverlay; scheduleRender(); }
  else if (key === "z") { if (state.view.fit) actualSize(state.lastPointer?.x, state.lastPointer?.y); else fitView(); }
  else if (event.key === "+" || event.key === "=") stepZoom(1, state.lastPointer?.x, state.lastPointer?.y);
  else if (event.key === "-" || event.key === "_") stepZoom(-1, state.lastPointer?.x, state.lastPointer?.y);
  else if (event.key === "[" || event.key === "]") {
    const delta = event.key === "]" ? 1.15 : 1 / 1.15;
    el.brushSizeRange.value = Math.round(clamp(Number(el.brushSizeRange.value) * delta, 4, 400));
    el.brushSizeRange.dispatchEvent(new Event("input"));
    updateBrushCursor();
  } else if (!ownsKeys && /^[0-5]$/.test(event.key)) setRating(targetPhotos(), Number(event.key));
  else if (!ownsKeys && key === "p") setFlag(targetPhotos(), 1);
  else if (!ownsKeys && key === "x") setFlag(targetPhotos(), -1);
  else if (!ownsKeys && key === "u") setFlag(targetPhotos(), 0);
  else if (!ownsKeys && (event.key === "Delete" || event.key === "Backspace") && activeMask(photo)) { event.preventDefault(); deleteMask(photo.activeMaskId); }
  else if (!ownsKeys && event.key === "ArrowLeft") { event.preventDefault(); navigatePhoto(-1); }
  else if (!ownsKeys && event.key === "ArrowRight") { event.preventDefault(); navigatePhoto(1); }
}

function start() {
  try {
    state.renderer = new Renderer(el.editorCanvas);
  } catch (error) {
    el.emptyState.replaceChildren();
    const h1 = document.createElement("h1");
    h1.textContent = "Không thể khởi động LUMA";
    const p1 = document.createElement("p");
    p1.textContent = error.message;
    const p2 = document.createElement("p");
    p2.textContent = "Hãy mở bằng Chrome hoặc Edge phiên bản mới (cần WebGL 2).";
    el.emptyState.append(h1, p1, p2);
    return;
  }
  el.editorCanvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    showToast("GPU bị mất kết nối — hãy tải lại trang. Phiên làm việc đã được tự lưu.", null, 10000);
  });
  initI18n();
  initPanel();
  initPresets();
  initDialogs();
  initExport();
  initFilmstrip();
  initView();
  bindToolbar();
  bindCropBar();
  bindDragDrop();
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", (event) => {
    if (event.key === "\\") { state.holdingBefore = false; scheduleRender(); }
    if (event.code === "Space") state.spaceDown = false;
  });
  window.addEventListener("blur", () => { state.spaceDown = false; state.holdingBefore = false; });
  setRangeProgress(el.qualityRange);
  drawHistogram(el.histogramCanvas, null);
  updateHistogramInfo();
  updateFolderChip();
  initSession();
  void scheduleHistogram;
  // Móc dùng cho kiểm thử tự động (test/e2e.mjs)
  window.__luma = { state, activePhoto, setTool, exitMaskEditing, openFolderHandle, flushAutosave, residentCount };
}

start();
