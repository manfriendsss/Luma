"use strict";

const controlGroups = {
  light: [
    { id: "exposure", label: "Phơi sáng", min: -2, max: 2, step: 0.05 },
    { id: "contrast", label: "Tương phản", min: -100, max: 100, step: 1 },
    { id: "highlights", label: "Vùng sáng", min: -100, max: 100, step: 1 },
    { id: "shadows", label: "Vùng tối", min: -100, max: 100, step: 1 },
    { id: "whites", label: "Điểm trắng", min: -100, max: 100, step: 1 },
    { id: "blacks", label: "Điểm đen", min: -100, max: 100, step: 1 },
  ],
  color: [
    { id: "temperature", label: "Nhiệt độ", min: -100, max: 100, step: 1, gradient: "linear-gradient(90deg,#246cff,#dadde1 50%,#f2c230)" },
    { id: "tint", label: "Sắc thái", min: -100, max: 100, step: 1, gradient: "linear-gradient(90deg,#28a461,#d8d8dc 50%,#d84bb4)" },
    { id: "saturation", label: "Bão hòa", min: -100, max: 100, step: 1, gradient: "linear-gradient(90deg,#777,#d9d9d9 48%,#ff315e 68%,#256cff)" },
    { id: "vibrance", label: "Độ rực", min: -100, max: 100, step: 1, gradient: "linear-gradient(90deg,#777,#d7d7d7 48%,#29c8d9 68%,#1b67ff)" },
  ],
  effects: [
    { id: "clarity", label: "Độ nét cục bộ", min: -100, max: 100, step: 1 },
    { id: "dehaze", label: "Khử sương", min: -100, max: 100, step: 1 },
    { id: "vignette", label: "Tối góc", min: -100, max: 100, step: 1 },
    { id: "grain", label: "Hạt phim", min: 0, max: 100, step: 1 },
  ],
};

const hslColors = [
  ["Red", "Đỏ", "#f04455", "#e843b5", "#ff9a35"],
  ["Orange", "Cam", "#f28b32", "#ef4356", "#f5cf42"],
  ["Yellow", "Vàng", "#e9c938", "#ef8d35", "#7cc84b"],
  ["Green", "Lục", "#55bd63", "#e3c83a", "#25c9ba"],
  ["Aqua", "Xanh ngọc", "#2dc8c4", "#45bc68", "#318ff0"],
  ["Blue", "Xanh dương", "#337de8", "#28c5c3", "#8a58df"],
  ["Purple", "Tím", "#8e5dde", "#357fe7", "#e64caf"],
  ["Magenta", "Hồng tím", "#df4aa9", "#8d5adc", "#ee4956"],
];

const hslGroups = {
  hue: hslColors.map(([id, label, color, left, right]) => ({ id: `hslHue${id}`, label, min: -100, max: 100, step: 1, gradient: `linear-gradient(90deg,${left},${color} 50%,${right})` })),
  saturation: hslColors.map(([id, label, color]) => ({ id: `hslSat${id}`, label, min: -100, max: 100, step: 1, gradient: `linear-gradient(90deg,#777,${color})` })),
  luminance: hslColors.map(([id, label, color]) => ({ id: `hslLum${id}`, label, min: -100, max: 100, step: 1, gradient: `linear-gradient(90deg,#171719,${color} 50%,#f3f3f3)` })),
};

const maskControlGroup = [
  { id: "temperature", label: "Nhiệt độ", min: -100, max: 100, step: 1, gradient: "linear-gradient(90deg,#246cff,#dadde1 50%,#f2c230)" },
  { id: "tint", label: "Sắc thái", min: -100, max: 100, step: 1, gradient: "linear-gradient(90deg,#28a461,#d8d8dc 50%,#d84bb4)" },
  { id: "exposure", label: "Phơi sáng", min: -2, max: 2, step: 0.05 },
  { id: "contrast", label: "Tương phản", min: -100, max: 100, step: 1 },
  { id: "highlights", label: "Vùng sáng", min: -100, max: 100, step: 1 },
  { id: "shadows", label: "Vùng tối", min: -100, max: 100, step: 1 },
  { id: "whites", label: "Điểm trắng", min: -100, max: 100, step: 1 },
  { id: "blacks", label: "Điểm đen", min: -100, max: 100, step: 1 },
  { id: "clarity", label: "Độ nét cục bộ", min: -100, max: 100, step: 1 },
  { id: "dehaze", label: "Khử sương", min: -100, max: 100, step: 1 },
  { id: "saturation", label: "Bão hòa", min: -100, max: 100, step: 1, gradient: "linear-gradient(90deg,#777,#d9d9d9 48%,#ff315e 68%,#256cff)" },
  { id: "sharpness", label: "Độ sắc nét", min: -100, max: 100, step: 1 },
  { id: "noise", label: "Khử nhiễu", min: 0, max: 100, step: 1 },
  { id: "moire", label: "Khử moiré", min: 0, max: 100, step: 1 },
  { id: "defringe", label: "Khử viền màu", min: 0, max: 100, step: 1 },
  { id: "strength", label: "Cường độ", min: 0, max: 100, step: 1, initial: 100 },
];

const defaults = Object.fromEntries([...Object.values(controlGroups).flat(), ...Object.values(hslGroups).flat()].map((item) => [item.id, 0]));
const maskDefaults = Object.fromEntries(maskControlGroup.map((item) => [item.id, item.initial ?? 0]));

const builtInPresetValues = {
  natural: { ...defaults },
  cinematic: { ...defaults, exposure: 0.15, contrast: 18, highlights: -24, shadows: 16, blacks: -12, temperature: 8, tint: 3, saturation: -4, vibrance: 18, clarity: 12, dehaze: 8, vignette: 16, grain: 7 },
  autumn: { ...defaults, exposure: 0.25, contrast: 14, highlights: -18, shadows: 24, whites: 8, blacks: -8, temperature: 22, tint: 6, saturation: 8, vibrance: 28, clarity: 9, dehaze: 5, vignette: 13, grain: 4 },
  matte: { ...defaults, exposure: 0.1, contrast: -8, highlights: -28, shadows: 30, whites: -12, blacks: 24, temperature: 10, tint: 4, saturation: -12, vibrance: 10, clarity: -5, vignette: 10, grain: 18 },
};

const builtInPresets = [
  { id: "natural", name: "TỰ NHIÊN", source: "LUMA", swatch: "linear-gradient(135deg,#78969d,#baa77d 50%,#4c684f)", values: builtInPresetValues.natural },
  { id: "cinematic", name: "CINEMATIC", source: "LUMA", swatch: "linear-gradient(135deg,#164653,#bf814b 58%,#10171d)", values: builtInPresetValues.cinematic },
  { id: "autumn", name: "THU ÂU", source: "LUMA", swatch: "linear-gradient(135deg,#657744,#d49a42 52%,#743c2d)", values: builtInPresetValues.autumn },
  { id: "matte", name: "FILM MATTE", source: "LUMA", swatch: "linear-gradient(135deg,#86877f,#ad906f 55%,#4b4e50)", values: builtInPresetValues.matte },
];

let importedPresets = [];
try {
  importedPresets = JSON.parse(localStorage.getItem("lumaImportedPresets") || "[]");
  if (!Array.isArray(importedPresets)) importedPresets = [];
} catch {
  importedPresets = [];
}

const state = {
  photos: [],
  activeId: null,
  zoom: 1,
  previewMode: "after",
  holdingBefore: false,
  isExporting: false,
  isPainting: false,
  lastPaintPoint: null,
  drawerOpen: false,
};

const elements = Object.fromEntries([
  "editorCanvas", "canvasWrap", "canvasViewport", "emptyState", "dropOverlay", "fileInput",
  "openImageButton", "addImagesButton", "sampleImageButton", "fileName", "fileDimensions",
  "renderStatus", "resetButton", "fullscreenButton", "exportButton", "beforeBadge", "maskBadge",
  "presetDrawerHandle", "presetDrawer", "presetDrawerClose", "drawerBackdrop", "presetList",
  "presetPreviewImage", "presetPreviewEmpty", "presetPreviewName", "importPresetButton", "presetFileInput",
  "previousSettingsButton", "undoButton",
  "splitLine", "brushCursor", "zoomOutButton", "zoomInButton", "fitButton", "zoomValue",
  "filmstripSection", "filmstripList", "photoCount", "selectedCount", "selectAllButton",
  "maskHelp", "showMaskToggle", "clearMaskButton", "brushOptions", "brushSizeRange",
  "brushSizeValue", "eraseMaskToggle", "maskControls", "exportDialog", "exportForm",
  "exportScopeSelect", "formatSelect", "qualityField", "qualityRange", "qualityValue",
  "exportCount", "confirmExportButton", "toast",
].map((id) => [id, document.getElementById(id)]));
elements.canvas = elements.editorCanvas;

const vertexShaderSource = `#version 300 es
  in vec2 a_position;
  out vec2 v_uv;
  void main() {
    v_uv = vec2((a_position.x + 1.0) * 0.5, (a_position.y + 1.0) * 0.5);
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const fragmentShaderSource = `#version 300 es
  precision highp float;
  uniform sampler2D u_image;
  uniform sampler2D u_maskTexture;
  uniform vec2 u_textureSize;
  uniform float u_exposure;
  uniform float u_contrast;
  uniform float u_highlights;
  uniform float u_shadows;
  uniform float u_whites;
  uniform float u_blacks;
  uniform float u_temperature;
  uniform float u_tint;
  uniform float u_saturation;
  uniform float u_vibrance;
  uniform float u_hslHue[8];
  uniform float u_hslSat[8];
  uniform float u_hslLum[8];
  uniform float u_clarity;
  uniform float u_dehaze;
  uniform float u_vignette;
  uniform float u_grain;
  uniform float u_original;
  uniform float u_seed;
  uniform float u_maskMode;
  uniform float u_maskExposure;
  uniform float u_maskContrast;
  uniform float u_maskHighlights;
  uniform float u_maskShadows;
  uniform float u_maskWhites;
  uniform float u_maskBlacks;
  uniform float u_maskTemperature;
  uniform float u_maskTint;
  uniform float u_maskSaturation;
  uniform float u_maskClarity;
  uniform float u_maskDehaze;
  uniform float u_maskSharpness;
  uniform float u_maskNoise;
  uniform float u_maskMoire;
  uniform float u_maskDefringe;
  uniform float u_maskStrength;
  uniform float u_showMask;
  in vec2 v_uv;
  out vec4 outColor;

  float luminance(vec3 color) { return dot(color, vec3(0.2126, 0.7152, 0.0722)); }
  float hash(vec2 point) { return fract(sin(dot(point, vec2(12.9898, 78.233)) + u_seed) * 43758.5453); }
  vec3 rgbToHsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }
  vec3 hsvToRgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }
  float hueDistance(float a, float b) { float d = abs(a - b); return min(d, 1.0 - d); }
  vec3 applyHslMix(vec3 inputColor) {
    vec3 hsv = rgbToHsv(clamp(inputColor, 0.0, 1.0));
    float centers[8] = float[8](0.0, 0.0833, 0.1667, 0.3333, 0.5, 0.6667, 0.75, 0.875);
    float hueShift = 0.0;
    float satShift = 0.0;
    float lumShift = 0.0;
    float totalWeight = 0.0;
    for (int i = 0; i < 8; i++) {
      float weight = 1.0 - smoothstep(0.035, 0.145, hueDistance(hsv.x, centers[i]));
      hueShift += u_hslHue[i] * weight;
      satShift += u_hslSat[i] * weight;
      lumShift += u_hslLum[i] * weight;
      totalWeight += weight;
    }
    float normalizer = max(1.0, totalWeight);
    hsv.x = fract(hsv.x + hueShift / normalizer * 0.085 + 1.0);
    hsv.y = clamp(hsv.y * (1.0 + satShift / normalizer), 0.0, 1.0);
    hsv.z = clamp(hsv.z + lumShift / normalizer * 0.42, 0.0, 1.0);
    return hsvToRgb(hsv);
  }
  vec3 adjustMasked(vec3 color, float amount, float mask, float strength) {
    if (amount >= 0.0) return color + amount * strength * mask * (1.0 - color);
    return color + amount * strength * mask * color;
  }
  float skyMaskFor(vec3 source) {
    float maxChannel = max(max(source.r, source.g), source.b);
    float minChannel = min(min(source.r, source.g), source.b);
    float chroma = maxChannel - minChannel;
    float blue = smoothstep(-0.02, 0.17, source.b - source.r) * smoothstep(-0.08, 0.13, source.b - source.g);
    float cloud = (1.0 - smoothstep(0.07, 0.25, chroma)) * smoothstep(0.56, 0.92, luminance(source)) * 0.72;
    float upper = smoothstep(0.28, 0.76, v_uv.y);
    return clamp(max(blue, cloud) * upper, 0.0, 1.0);
  }
  void main() {
    vec3 source = texture(u_image, v_uv).rgb;
    if (u_original > 0.5) { outColor = vec4(source, 1.0); return; }

    vec3 color = source;
    vec2 texel = 1.0 / u_textureSize;
    vec3 blur = (
      texture(u_image, v_uv + vec2(texel.x, 0.0)).rgb + texture(u_image, v_uv - vec2(texel.x, 0.0)).rgb +
      texture(u_image, v_uv + vec2(0.0, texel.y)).rgb + texture(u_image, v_uv - vec2(0.0, texel.y)).rgb +
      texture(u_image, v_uv + texel).rgb + texture(u_image, v_uv - texel).rgb +
      texture(u_image, v_uv + vec2(texel.x, -texel.y)).rgb + texture(u_image, v_uv + vec2(-texel.x, texel.y)).rgb
    ) * 0.125;
    color += (color - blur) * u_clarity * 0.72;
    color *= exp2(u_exposure);
    float light = luminance(color);
    color = adjustMasked(color, u_shadows, 1.0 - smoothstep(0.08, 0.58, light), 0.40);
    color = adjustMasked(color, u_highlights, smoothstep(0.42, 0.94, light), 0.34);
    color = adjustMasked(color, u_blacks, 1.0 - smoothstep(0.0, 0.34, light), 0.28);
    color = adjustMasked(color, u_whites, smoothstep(0.64, 1.0, light), 0.28);
    color = (color - 0.5) * (1.0 + u_contrast * 0.82) + 0.5;
    color = (color - 0.5) * (1.0 + u_dehaze * 0.34) + 0.5;
    float midMask = clamp(1.0 - abs(clamp(luminance(color), 0.0, 1.0) - 0.5) * 1.65, 0.0, 1.0);
    color.r += u_temperature * 0.105 * midMask;
    color.g += u_temperature * 0.018 * midMask;
    color.b -= u_temperature * 0.105 * midMask;
    color.r += u_tint * 0.035 * midMask;
    color.g -= u_tint * 0.065 * midMask;
    color.b += u_tint * 0.035 * midMask;
    float gray = luminance(color);
    color = mix(vec3(gray), color, 1.0 + u_saturation);
    float currentSaturation = max(max(color.r, color.g), color.b) - min(min(color.r, color.g), color.b);
    color = mix(vec3(luminance(color)), color, 1.0 + u_vibrance * (1.0 - clamp(currentSaturation, 0.0, 1.0)));
    color = applyHslMix(color);

    float localMask = 0.0;
    if (u_maskMode > 0.5 && u_maskMode < 1.5) localMask = skyMaskFor(source);
    if (u_maskMode > 1.5) localMask = texture(u_maskTexture, v_uv).r;
    localMask = clamp(localMask * u_maskStrength, 0.0, 1.0);
    vec3 localColor = color + (color - blur) * (u_maskClarity * 0.65 + u_maskSharpness * 0.45);
    localColor = mix(localColor, blur, u_maskNoise * 0.72);
    localColor *= exp2(u_maskExposure);
    float localLight = luminance(localColor);
    localColor = adjustMasked(localColor, u_maskShadows, 1.0 - smoothstep(0.08, 0.58, localLight), 0.40);
    localColor = adjustMasked(localColor, u_maskHighlights, smoothstep(0.42, 0.94, localLight), 0.34);
    localColor = adjustMasked(localColor, u_maskBlacks, 1.0 - smoothstep(0.0, 0.34, localLight), 0.28);
    localColor = adjustMasked(localColor, u_maskWhites, smoothstep(0.64, 1.0, localLight), 0.28);
    localColor = (localColor - 0.5) * (1.0 + u_maskContrast * 0.82 + u_maskDehaze * 0.34) + 0.5;
    localColor.r += u_maskTemperature * 0.12;
    localColor.g += u_maskTemperature * 0.02;
    localColor.b -= u_maskTemperature * 0.12;
    localColor.r += u_maskTint * 0.04;
    localColor.g -= u_maskTint * 0.075;
    localColor.b += u_maskTint * 0.04;
    localColor = mix(vec3(luminance(localColor)), localColor, 1.0 + u_maskSaturation);
    localColor = mix(vec3(luminance(localColor)), localColor, 1.0 - u_maskMoire * 0.44);
    float magentaFringe = max(0.0, min(localColor.r, localColor.b) - localColor.g);
    localColor.g += magentaFringe * u_maskDefringe * 0.9;
    color = mix(color, localColor, localMask);

    float vignetteDistance = length((v_uv - 0.5) * 1.4142);
    float vignetteMask = smoothstep(0.43, 1.0, vignetteDistance);
    if (u_vignette >= 0.0) color *= 1.0 - u_vignette * 0.62 * vignetteMask;
    else color += (-u_vignette) * 0.24 * vignetteMask * (1.0 - color);
    color += (hash(gl_FragCoord.xy) - 0.5) * u_grain * 0.09;
    if (u_showMask > 0.5 && u_maskMode > 0.5) color = mix(color, vec3(0.0, 0.72, 1.0), localMask * 0.48);
    outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

let gl;
let program;
let imageTexture;
let maskTexture;
let uniforms = {};
let renderFrame = null;
let toastTimer = null;

function activePhoto() { return state.photos.find((photo) => photo.id === state.activeId) || null; }
function maskModeNumber(type) { return type === "sky" ? 1 : type === "brush" ? 2 : 0; }

function takeSnapshot(photo, includeMask = false) {
  return {
    values: { ...photo.values },
    maskValues: { ...photo.maskValues },
    maskType: photo.maskType,
    showMask: photo.showMask,
    preset: photo.preset,
    maskData: includeMask ? photo.maskCanvas.toDataURL("image/png") : null,
  };
}

function pushHistory(photo, snapshot) {
  if (!photo || !snapshot) return;
  photo.history.push(snapshot);
  if (photo.history.length > 40) photo.history.shift();
  updateActionButtons();
}

async function restoreSnapshot(photo, snapshot) {
  photo.values = { ...snapshot.values };
  photo.maskValues = { ...snapshot.maskValues };
  photo.maskType = snapshot.maskType;
  photo.showMask = snapshot.showMask;
  photo.preset = snapshot.preset;
  if (snapshot.maskData) {
    const maskImage = new Image();
    await new Promise((resolve, reject) => {
      maskImage.onload = resolve;
      maskImage.onerror = reject;
      maskImage.src = snapshot.maskData;
    });
    const context = photo.maskCanvas.getContext("2d");
    context.clearRect(0, 0, photo.maskCanvas.width, photo.maskCanvas.height);
    context.drawImage(maskImage, 0, 0, photo.maskCanvas.width, photo.maskCanvas.height);
    updateMaskTexture(photo);
  }
}

async function undoLastAction() {
  const photo = activePhoto();
  if (!photo || !photo.history.length) return;
  const snapshot = photo.history.pop();
  await restoreSnapshot(photo, snapshot);
  syncControls();
  setActivePreset(photo.preset);
  syncMaskUI();
  renderPresetList();
  scheduleRender();
  updateActionButtons();
  showToast("Đã hoàn tác thao tác vừa rồi.");
}

function updateActionButtons() {
  const photo = activePhoto();
  const activeIndex = state.photos.findIndex((item) => item.id === state.activeId);
  elements.undoButton.disabled = !photo || photo.history.length === 0;
  elements.previousSettingsButton.disabled = !photo || activeIndex <= 0;
}

function copyPreviousSettings() {
  const photo = activePhoto();
  const index = state.photos.findIndex((item) => item.id === state.activeId);
  if (!photo || index <= 0) return;
  const previous = state.photos[index - 1];
  pushHistory(photo, takeSnapshot(photo));
  photo.values = { ...previous.values };
  photo.maskValues = { ...previous.maskValues };
  photo.maskType = previous.maskType === "sky" ? "sky" : "none";
  photo.showMask = false;
  photo.preset = previous.preset;
  syncControls();
  setActivePreset(photo.preset);
  syncMaskUI();
  renderPresetList();
  scheduleRender();
  showToast(`Đã sao chép thiết lập từ ${previous.file.name}.`);
}

function createShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "Không thể biên dịch shader.");
  return shader;
}

function initWebGL() {
  gl = elements.canvas.getContext("webgl2", { preserveDrawingBuffer: true, premultipliedAlpha: false });
  if (!gl) throw new Error("Trình duyệt này chưa hỗ trợ WebGL 2.");
  program = gl.createProgram();
  gl.attachShader(program, createShader(gl.VERTEX_SHADER, vertexShaderSource));
  gl.attachShader(program, createShader(gl.FRAGMENT_SHADER, fragmentShaderSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Không thể khởi tạo bộ xử lý ảnh.");
  gl.useProgram(program);
  const positionLocation = gl.getAttribLocation(program, "a_position");
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  const names = ["u_image","u_maskTexture","u_textureSize","u_exposure","u_contrast","u_highlights","u_shadows","u_whites","u_blacks","u_temperature","u_tint","u_saturation","u_vibrance","u_hslHue[0]","u_hslSat[0]","u_hslLum[0]","u_clarity","u_dehaze","u_vignette","u_grain","u_original","u_seed","u_maskMode","u_maskExposure","u_maskContrast","u_maskHighlights","u_maskShadows","u_maskWhites","u_maskBlacks","u_maskTemperature","u_maskTint","u_maskSaturation","u_maskClarity","u_maskDehaze","u_maskSharpness","u_maskNoise","u_maskMoire","u_maskDefringe","u_maskStrength","u_showMask"];
  uniforms = Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)]));
  gl.uniform1i(uniforms.u_image, 0);
  gl.uniform1i(uniforms.u_maskTexture, 1);
}

function makeTexture(unit, source) {
  const texture = gl.createTexture();
  gl.activeTexture(unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  return texture;
}

function bindPhotoTextures(photo) {
  if (imageTexture) gl.deleteTexture(imageTexture);
  if (maskTexture) gl.deleteTexture(maskTexture);
  imageTexture = makeTexture(gl.TEXTURE0, photo.image);
  maskTexture = makeTexture(gl.TEXTURE1, photo.maskCanvas);
}

function updateMaskTexture(photo = activePhoto()) {
  if (!photo || !maskTexture) return;
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, maskTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, photo.maskCanvas);
}

function setPhotoUniforms(photo, original = false, hideMask = false) {
  const value = photo.values;
  const local = photo.maskValues;
  gl.uniform2f(uniforms.u_textureSize, photo.image.naturalWidth, photo.image.naturalHeight);
  gl.uniform1f(uniforms.u_exposure, value.exposure);
  gl.uniform1f(uniforms.u_contrast, value.contrast / 100);
  gl.uniform1f(uniforms.u_highlights, value.highlights / 100);
  gl.uniform1f(uniforms.u_shadows, value.shadows / 100);
  gl.uniform1f(uniforms.u_whites, value.whites / 100);
  gl.uniform1f(uniforms.u_blacks, value.blacks / 100);
  gl.uniform1f(uniforms.u_temperature, value.temperature / 100);
  gl.uniform1f(uniforms.u_tint, value.tint / 100);
  gl.uniform1f(uniforms.u_saturation, value.saturation / 100);
  gl.uniform1f(uniforms.u_vibrance, value.vibrance / 100);
  gl.uniform1fv(uniforms["u_hslHue[0]"], new Float32Array(hslColors.map(([id]) => value[`hslHue${id}`] / 100)));
  gl.uniform1fv(uniforms["u_hslSat[0]"], new Float32Array(hslColors.map(([id]) => value[`hslSat${id}`] / 100)));
  gl.uniform1fv(uniforms["u_hslLum[0]"], new Float32Array(hslColors.map(([id]) => value[`hslLum${id}`] / 100)));
  gl.uniform1f(uniforms.u_clarity, value.clarity / 100);
  gl.uniform1f(uniforms.u_dehaze, value.dehaze / 100);
  gl.uniform1f(uniforms.u_vignette, value.vignette / 100);
  gl.uniform1f(uniforms.u_grain, value.grain / 100);
  gl.uniform1f(uniforms.u_original, original ? 1 : 0);
  gl.uniform1f(uniforms.u_seed, 3.14159);
  gl.uniform1f(uniforms.u_maskMode, maskModeNumber(photo.maskType));
  gl.uniform1f(uniforms.u_maskExposure, local.exposure);
  gl.uniform1f(uniforms.u_maskContrast, local.contrast / 100);
  gl.uniform1f(uniforms.u_maskHighlights, local.highlights / 100);
  gl.uniform1f(uniforms.u_maskShadows, local.shadows / 100);
  gl.uniform1f(uniforms.u_maskWhites, local.whites / 100);
  gl.uniform1f(uniforms.u_maskBlacks, local.blacks / 100);
  gl.uniform1f(uniforms.u_maskTemperature, local.temperature / 100);
  gl.uniform1f(uniforms.u_maskTint, local.tint / 100);
  gl.uniform1f(uniforms.u_maskSaturation, local.saturation / 100);
  gl.uniform1f(uniforms.u_maskClarity, local.clarity / 100);
  gl.uniform1f(uniforms.u_maskDehaze, local.dehaze / 100);
  gl.uniform1f(uniforms.u_maskSharpness, local.sharpness / 100);
  gl.uniform1f(uniforms.u_maskNoise, local.noise / 100);
  gl.uniform1f(uniforms.u_maskMoire, local.moire / 100);
  gl.uniform1f(uniforms.u_maskDefringe, local.defringe / 100);
  gl.uniform1f(uniforms.u_maskStrength, local.strength / 100);
  gl.uniform1f(uniforms.u_showMask, !hideMask && photo.showMask ? 1 : 0);
}

function drawPhoto(photo, original = false, hideMask = false) {
  setPhotoUniforms(photo, original, hideMask);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function render(options = {}) {
  const photo = activePhoto();
  if (!photo) return;
  gl.useProgram(program);
  gl.viewport(0, 0, elements.canvas.width, elements.canvas.height);
  gl.disable(gl.SCISSOR_TEST);
  const mode = options.forceAfter ? "after" : (state.holdingBefore ? "before" : state.previewMode);
  if (mode === "before") {
    drawPhoto(photo, true, true);
  } else if (mode === "split") {
    drawPhoto(photo, false, options.hideMask);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, Math.floor(elements.canvas.width / 2), elements.canvas.height);
    drawPhoto(photo, true, true);
    gl.disable(gl.SCISSOR_TEST);
  } else {
    drawPhoto(photo, false, options.hideMask);
  }
}

function scheduleRender() {
  if (!activePhoto() || renderFrame) return;
  renderFrame = requestAnimationFrame(() => { renderFrame = null; render(); });
}

function setRangeProgress(range) {
  const percentage = ((Number(range.value) - Number(range.min)) / (Number(range.max) - Number(range.min))) * 100;
  range.style.setProperty("--range-progress", `${percentage}%`);
}

function buildControls(containerId, controls, scope = "global") {
  const container = document.getElementById(containerId);
  for (const control of controls) {
    let gesture = null;
    const key = scope === "mask" ? `mask-${control.id}` : control.id;
    const row = document.createElement("div");
    row.className = "control-row";
    const label = document.createElement("label");
    label.htmlFor = `${key}Range`;
    label.textContent = control.label;
    const range = document.createElement("input");
    range.type = "range";
    range.id = `${key}Range`;
    range.min = control.min;
    range.max = control.max;
    range.step = control.step;
    range.value = control.initial ?? 0;
    if (control.gradient) {
      range.classList.add("color-track");
      range.style.setProperty("--track-background", control.gradient);
    }
    const value = document.createElement("input");
    value.type = "number";
    value.className = "control-value";
    value.id = `${key}Value`;
    value.min = control.min;
    value.max = control.max;
    value.step = control.step;
    value.value = range.value;
    value.setAttribute("aria-label", `Giá trị ${control.label}`);
    const beginGesture = () => {
      const photo = activePhoto();
      if (photo && !gesture) gesture = { photoId: photo.id, snapshot: takeSnapshot(photo) };
    };
    const commitGesture = () => {
      if (!gesture) return;
      const photo = state.photos.find((item) => item.id === gesture.photoId);
      const currentValue = photo && (scope === "mask" ? photo.maskValues[control.id] : photo.values[control.id]);
      const previousValue = scope === "mask" ? gesture.snapshot.maskValues[control.id] : gesture.snapshot.values[control.id];
      if (photo && currentValue !== previousValue) pushHistory(photo, gesture.snapshot);
      gesture = null;
    };
    const update = (rawValue) => {
      const photo = activePhoto();
      if (!photo) return;
      const numeric = Math.min(control.max, Math.max(control.min, Number(rawValue) || 0));
      if (scope === "mask") photo.maskValues[control.id] = numeric;
      else { photo.values[control.id] = numeric; photo.preset = null; setActivePreset(null); }
      range.value = numeric;
      value.value = numeric;
      setRangeProgress(range);
      scheduleRender();
    };
    range.addEventListener("pointerdown", beginGesture);
    range.addEventListener("keydown", beginGesture);
    range.addEventListener("input", () => { beginGesture(); update(range.value); });
    range.addEventListener("change", commitGesture);
    range.addEventListener("pointerup", commitGesture);
    value.addEventListener("focus", beginGesture);
    value.addEventListener("change", () => { beginGesture(); update(value.value); commitGesture(); });
    value.addEventListener("blur", commitGesture);
    value.addEventListener("dblclick", () => { beginGesture(); update(control.initial ?? 0); commitGesture(); });
    row.append(label, range, value);
    container.appendChild(row);
    setRangeProgress(range);
  }
}

function syncControls() {
  const photo = activePhoto();
  if (!photo) return;
  for (const [id, current] of Object.entries(photo.values)) {
    const range = document.getElementById(`${id}Range`);
    const input = document.getElementById(`${id}Value`);
    if (range && input) { range.value = current; input.value = current; setRangeProgress(range); }
  }
  for (const [id, current] of Object.entries(photo.maskValues)) {
    const range = document.getElementById(`mask-${id}Range`);
    const input = document.getElementById(`mask-${id}Value`);
    if (range && input) { range.value = current; input.value = current; setRangeProgress(range); }
  }
}

function setActivePreset(name) {
  document.querySelectorAll(".preset-list-item").forEach((button) => {
    const active = button.dataset.preset === name;
    button.classList.toggle("active", active);
    const mark = button.querySelector(".preset-current-mark");
    if (mark) mark.textContent = active ? "✓" : "";
  });
}

function allPresets() {
  return [...builtInPresets, ...importedPresets];
}

function presetById(id) {
  return allPresets().find((preset) => preset.id === id) || null;
}

function applyPreset(name, record = true) {
  const photo = activePhoto();
  const preset = presetById(name);
  if (!photo || !preset) return;
  if (record) pushHistory(photo, takeSnapshot(photo));
  photo.values = { ...defaults, ...preset.values };
  photo.preset = name;
  syncControls();
  setActivePreset(name);
  renderPresetList();
  scheduleRender();
}

function presetFilter(values) {
  const exposure = Math.max(0.25, 1 + (values.exposure || 0) * 0.42);
  const contrast = Math.max(0.25, 1 + (values.contrast || 0) / 130);
  const saturation = Math.max(0, 1 + ((values.saturation || 0) + (values.vibrance || 0) * 0.45) / 100);
  const warmth = Math.max(0, (values.temperature || 0) / 100);
  return `brightness(${exposure}) contrast(${contrast}) saturate(${saturation}) sepia(${warmth * 0.28}) hue-rotate(${warmth * -10}deg)`;
}

function showPresetPreview(preset) {
  const photo = activePhoto();
  elements.presetPreviewName.textContent = preset?.name || "TỰ NHIÊN";
  elements.presetPreviewImage.style.filter = preset ? presetFilter(preset.values) : "none";
  elements.presetPreviewImage.hidden = !photo;
  elements.presetPreviewEmpty.hidden = Boolean(photo);
}

function renderPresetList() {
  elements.presetList.replaceChildren();
  const photo = activePhoto();
  for (const preset of allPresets()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `preset-list-item${photo?.preset === preset.id ? " active" : ""}`;
    button.dataset.preset = preset.id;
    const swatch = document.createElement("span");
    swatch.className = "preset-list-swatch";
    swatch.style.background = preset.swatch || "linear-gradient(135deg,#1fd1f9,#1268ff)";
    const copy = document.createElement("span");
    copy.className = "preset-list-copy";
    const name = document.createElement("span");
    name.className = "preset-list-name";
    name.textContent = preset.name;
    const source = document.createElement("span");
    source.className = "preset-list-source";
    source.textContent = preset.source || "LIGHTROOM";
    copy.append(name, source);
    const mark = document.createElement("span");
    mark.className = "preset-current-mark";
    mark.textContent = photo?.preset === preset.id ? "✓" : "";
    button.append(swatch, copy, mark);
    button.addEventListener("mouseenter", () => showPresetPreview(preset));
    button.addEventListener("focus", () => showPresetPreview(preset));
    button.addEventListener("mouseleave", () => showPresetPreview(presetById(activePhoto()?.preset) || builtInPresets[0]));
    button.addEventListener("click", () => applyPreset(preset.id));
    elements.presetList.appendChild(button);
  }
  showPresetPreview(presetById(photo?.preset) || builtInPresets[0]);
}

function setPresetDrawer(open) {
  state.drawerOpen = open;
  elements.presetDrawer.classList.toggle("open", open);
  elements.presetDrawer.setAttribute("aria-hidden", String(!open));
  elements.presetDrawerHandle.classList.toggle("open", open);
  elements.presetDrawerHandle.setAttribute("aria-expanded", String(open));
  elements.presetDrawerHandle.setAttribute("aria-label", open ? "Đóng bảng preset" : "Mở bảng preset");
  elements.presetDrawerHandle.title = open ? "Đóng bảng preset" : "Mở bảng preset";
  elements.drawerBackdrop.hidden = !open;
  if (open) renderPresetList();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function extractPresetValue(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`(?:crs:)?${escaped}\\s*=\\s*["']?([+-]?\\d+(?:\\.\\d+)?)`, "i"),
    new RegExp(`<crs:${escaped}[^>]*>\\s*([+-]?\\d+(?:\\.\\d+)?)\\s*</crs:${escaped}>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function parseLightroomPreset(text, fileName) {
  if (fileName.toLowerCase().endsWith(".json")) {
    const raw = JSON.parse(text);
    const source = raw.settings || raw.values || raw;
    const values = { ...defaults };
    let mapped = 0;
    for (const key of Object.keys(defaults)) {
      if (Number.isFinite(Number(source[key]))) { values[key] = clamp(source[key], key === "exposure" ? -2 : key === "grain" ? 0 : -100, key === "exposure" ? 2 : 100); mapped += 1; }
    }
    if (!mapped) throw new Error(`${fileName}: không tìm thấy thông số màu.`);
    return { name: String(raw.name || fileName.replace(/\.[^.]+$/, "")).toUpperCase(), values };
  }
  const map = {
    exposure: ["Exposure2012", -2, 2], contrast: ["Contrast2012", -100, 100],
    highlights: ["Highlights2012", -100, 100], shadows: ["Shadows2012", -100, 100],
    whites: ["Whites2012", -100, 100], blacks: ["Blacks2012", -100, 100],
    tint: ["Tint", -100, 100], saturation: ["Saturation", -100, 100], vibrance: ["Vibrance", -100, 100],
    clarity: ["Clarity2012", -100, 100], dehaze: ["Dehaze", -100, 100],
    vignette: ["PostCropVignetteAmount", -100, 100], grain: ["GrainAmount", 0, 100],
  };
  const values = { ...defaults };
  let mapped = 0;
  for (const [target, [source, min, max]] of Object.entries(map)) {
    const found = extractPresetValue(text, source);
    if (found !== null) { values[target] = clamp(found, min, max); mapped += 1; }
  }
  const kelvin = extractPresetValue(text, "Temperature");
  if (kelvin !== null) { values.temperature = kelvin > 1000 ? clamp((kelvin - 5500) / 25, -100, 100) : clamp(kelvin, -100, 100); mapped += 1; }
  if (!mapped) throw new Error(`${fileName}: preset không có thông số tương thích.`);
  const title = text.match(/(?:PresetName|Name)\s*=\s*["']([^"']+)|<dc:title>\s*<rdf:Alt>\s*<rdf:li[^>]*>([^<]+)/i);
  return { name: String(title?.[1] || title?.[2] || fileName.replace(/\.[^.]+$/, "")).toUpperCase(), values };
}

async function importPresetFiles(files) {
  let imported = 0;
  for (const file of [...files]) {
    try {
      const parsed = parseLightroomPreset(await file.text(), file.name);
      importedPresets.push({
        id: `imported-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: parsed.name,
        source: "NHẬP TỪ LIGHTROOM",
        swatch: "linear-gradient(135deg,#1dd6ee,#166dff 58%,#062848)",
        values: parsed.values,
      });
      imported += 1;
    } catch (error) {
      showToast(error.message || `${file.name}: không thể import.`);
    }
  }
  if (imported) {
    localStorage.setItem("lumaImportedPresets", JSON.stringify(importedPresets));
    renderPresetList();
    showToast(`Đã import ${imported} preset Lightroom.`);
  }
  elements.presetFileInput.value = "";
}

function createMaskCanvas(image) {
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "black";
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

function sizePreviewCanvas() {
  const photo = activePhoto();
  if (!photo) return;
  const maxWidth = Math.max(300, elements.canvasViewport.clientWidth - 52);
  const maxHeight = Math.max(230, elements.canvasViewport.clientHeight - 46);
  const fit = Math.min(1, maxWidth / photo.image.naturalWidth, maxHeight / photo.image.naturalHeight);
  const width = Math.max(1, Math.round(photo.image.naturalWidth * fit));
  const height = Math.max(1, Math.round(photo.image.naturalHeight * fit));
  const density = Math.min(window.devicePixelRatio || 1, 2);
  elements.canvas.width = Math.round(width * density);
  elements.canvas.height = Math.round(height * density);
  elements.canvas.style.width = `${width}px`;
  elements.canvas.style.height = `${height}px`;
  updateZoom();
  render();
}

function updateZoom() {
  elements.canvasWrap.style.transform = `scale(${state.zoom})`;
  elements.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
}

async function activatePhoto(id, updateFilmstrip = true) {
  const photo = state.photos.find((item) => item.id === id);
  if (!photo) return;
  state.activeId = id;
  state.zoom = 1;
  bindPhotoTextures(photo);
  elements.emptyState.hidden = true;
  elements.canvasWrap.hidden = false;
  elements.filmstripSection.hidden = false;
  elements.fileName.textContent = photo.file.name;
  elements.fileDimensions.textContent = `${photo.image.naturalWidth} × ${photo.image.naturalHeight}`;
  elements.presetPreviewImage.src = photo.url;
  elements.renderStatus.textContent = "Ảnh được xử lý cục bộ";
  [elements.resetButton, elements.exportButton, elements.zoomOutButton, elements.zoomInButton, elements.fitButton].forEach((button) => { button.disabled = false; });
  syncControls();
  setActivePreset(photo.preset);
  syncMaskUI();
  renderPresetList();
  updateActionButtons();
  if (updateFilmstrip) renderFilmstrip();
  requestAnimationFrame(sizePreviewCanvas);
}

async function fileToPhoto(file) {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name}: định dạng không được hỗ trợ.`);
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error(`${file.name}: không thể đọc ảnh.`)); image.src = url; });
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (image.naturalWidth > maxTextureSize || image.naturalHeight > maxTextureSize) {
    URL.revokeObjectURL(url);
    throw new Error(`${file.name}: vượt giới hạn ${maxTextureSize}px của thiết bị.`);
  }
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    file, url, image, selected: true, values: { ...defaults }, preset: "natural", history: [],
    maskType: "none", maskValues: { ...maskDefaults }, maskCanvas: createMaskCanvas(image), showMask: false,
  };
}

async function loadFiles(files) {
  const accepted = [...files].filter((file) => file.type.startsWith("image/"));
  if (!accepted.length) { showToast("Vui lòng chọn ảnh JPG, PNG hoặc WebP."); return; }
  elements.renderStatus.textContent = `Đang mở ${accepted.length} ảnh…`;
  const results = await Promise.allSettled(accepted.map(fileToPhoto));
  const added = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const failed = results.filter((result) => result.status === "rejected");
  state.photos.push(...added);
  renderFilmstrip();
  if (added.length) await activatePhoto(added[0].id);
  if (failed.length) showToast(`Đã thêm ${added.length} ảnh, ${failed.length} ảnh không mở được.`);
  else showToast(`Đã thêm ${added.length} ảnh.`);
  elements.fileInput.value = "";
}

function renderFilmstrip() {
  elements.filmstripList.replaceChildren();
  state.photos.forEach((photo, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `thumb-card${photo.id === state.activeId ? " active" : ""}${photo.selected ? " selected" : ""}`;
    card.title = photo.file.name;
    card.setAttribute("aria-label", `Mở ${photo.file.name}`);
    const image = document.createElement("img");
    image.src = photo.url;
    image.alt = "";
    const selector = document.createElement("span");
    selector.className = "thumb-select";
    selector.textContent = photo.selected ? "✓" : "";
    selector.title = photo.selected ? "Bỏ khỏi danh sách xuất" : "Chọn để xuất";
    selector.addEventListener("click", (event) => { event.stopPropagation(); photo.selected = !photo.selected; renderFilmstrip(); updateExportCount(); });
    const number = document.createElement("span");
    number.className = "thumb-index";
    number.textContent = index + 1;
    card.append(image, selector, number);
    card.addEventListener("click", () => activatePhoto(photo.id));
    elements.filmstripList.appendChild(card);
  });
  const selected = state.photos.filter((photo) => photo.selected).length;
  elements.photoCount.textContent = `${state.photos.length} ảnh`;
  elements.selectedCount.textContent = `${selected} được chọn để xuất`;
  elements.selectAllButton.textContent = selected === state.photos.length && selected > 0 ? "Bỏ chọn tất cả" : "Chọn tất cả";
  elements.filmstripSection.hidden = state.photos.length === 0;
}

function syncMaskUI() {
  const photo = activePhoto();
  if (!photo) return;
  document.querySelectorAll(".mask-type").forEach((button) => button.classList.toggle("active", button.dataset.maskType === photo.maskType));
  elements.showMaskToggle.checked = photo.showMask;
  elements.showMaskToggle.disabled = photo.maskType === "none";
  elements.clearMaskButton.disabled = photo.maskType !== "brush";
  elements.brushOptions.hidden = photo.maskType !== "brush";
  elements.maskControls.classList.toggle("disabled", photo.maskType === "none");
  elements.maskBadge.hidden = !photo.showMask || photo.maskType === "none";
  elements.maskHelp.textContent = photo.maskType === "sky"
    ? "Luma nhận diện vùng trời theo màu và vị trí. Đây là mask cục bộ, không thay hoặc ghép mây."
    : photo.maskType === "brush"
      ? "Kéo cọ trực tiếp trên ảnh để tô vùng cần chỉnh. Bật Tẩy mask để xoá bớt."
      : "Chọn Bầu trời để tự nhận diện hoặc Cọ vùng để tô thủ công.";
  updateBrushCursorVisibility();
}

function setMaskType(type) {
  const photo = activePhoto();
  if (!photo || photo.maskType === type) return;
  pushHistory(photo, takeSnapshot(photo));
  photo.maskType = type;
  if (type !== "none") photo.showMask = true;
  syncMaskUI();
  scheduleRender();
}

function clearBrushMask(record = true) {
  const photo = activePhoto();
  if (!photo) return;
  if (record) pushHistory(photo, takeSnapshot(photo, true));
  const context = photo.maskCanvas.getContext("2d");
  context.fillStyle = "black";
  context.fillRect(0, 0, photo.maskCanvas.width, photo.maskCanvas.height);
  updateMaskTexture(photo);
  scheduleRender();
  if (record) showToast("Đã xoá mask cọ.");
}

function updateBrushCursorVisibility() {
  const photo = activePhoto();
  elements.brushCursor.hidden = !photo || photo.maskType !== "brush";
}

function paintMask(event) {
  const photo = activePhoto();
  if (!photo || photo.maskType !== "brush") return;
  const rect = elements.canvas.getBoundingClientRect();
  const point = {
    x: (event.clientX - rect.left) / rect.width * photo.maskCanvas.width,
    y: (event.clientY - rect.top) / rect.height * photo.maskCanvas.height,
  };
  const size = Number(elements.brushSizeRange.value) / rect.width * photo.maskCanvas.width;
  const context = photo.maskCanvas.getContext("2d");
  context.save();
  context.strokeStyle = elements.eraseMaskToggle.checked ? "black" : "white";
  context.fillStyle = context.strokeStyle;
  context.lineWidth = size;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (state.lastPaintPoint) {
    context.beginPath();
    context.moveTo(state.lastPaintPoint.x, state.lastPaintPoint.y);
    context.lineTo(point.x, point.y);
    context.stroke();
  } else {
    context.beginPath();
    context.arc(point.x, point.y, size / 2, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
  state.lastPaintPoint = point;
  updateMaskTexture(photo);
  scheduleRender();
}

function updateBrushCursor(event) {
  const photo = activePhoto();
  if (!photo || photo.maskType !== "brush") return;
  const wrapRect = elements.canvasWrap.getBoundingClientRect();
  const canvasRect = elements.canvas.getBoundingClientRect();
  const diameter = Number(elements.brushSizeRange.value) * state.zoom;
  elements.brushCursor.style.width = `${diameter}px`;
  elements.brushCursor.style.height = `${diameter}px`;
  elements.brushCursor.style.left = `${event.clientX - wrapRect.left}px`;
  elements.brushCursor.style.top = `${event.clientY - wrapRect.top}px`;
  elements.brushCursor.hidden = event.clientX < canvasRect.left || event.clientX > canvasRect.right || event.clientY < canvasRect.top || event.clientY > canvasRect.bottom;
}

function setPreviewMode(mode) {
  state.previewMode = mode;
  document.querySelectorAll("[data-preview-mode]").forEach((button) => button.classList.toggle("active", button.dataset.previewMode === mode));
  elements.beforeBadge.hidden = mode !== "before";
  elements.splitLine.hidden = mode !== "split";
  scheduleRender();
}

function resetAdjustments() {
  const photo = activePhoto();
  if (!photo) return;
  pushHistory(photo, takeSnapshot(photo, true));
  photo.values = { ...defaults };
  photo.maskValues = { ...maskDefaults };
  photo.maskType = "none";
  photo.showMask = false;
  photo.preset = "natural";
  clearBrushMask(false);
  syncControls();
  setActivePreset("natural");
  syncMaskUI();
  scheduleRender();
  showToast("Đã đặt lại ảnh đang xem.");
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2600);
}

function exportTargets() {
  if (elements.exportScopeSelect.value === "active") return activePhoto() ? [activePhoto()] : [];
  return state.photos.filter((photo) => photo.selected);
}

function updateExportCount() {
  const count = exportTargets().length;
  elements.exportCount.textContent = `${count} ảnh`;
  elements.confirmExportButton.disabled = count === 0 || state.isExporting;
}

function openExportDialog() {
  if (!activePhoto()) return;
  updateExportCount();
  elements.exportDialog.showModal();
}

function extensionForType(type) { return type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"; }
function outputName(photo, type) { return `${photo.file.name.replace(/\.[^.]+$/, "")}-luma.${extensionForType(type)}`; }

async function canvasBlob(type, quality) {
  return new Promise((resolve, reject) => elements.canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Không thể tạo file xuất.")), type, quality));
}

async function saveBlob(blob, name, directoryHandle) {
  if (directoryHandle) {
    const handle = await directoryHandle.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
  await new Promise((resolve) => setTimeout(resolve, 220));
}

async function exportImages() {
  const targets = exportTargets();
  if (!targets.length || state.isExporting) return;
  let directoryHandle = null;
  if (targets.length > 1 && "showDirectoryPicker" in window) {
    try { directoryHandle = await window.showDirectoryPicker({ mode: "readwrite", startIn: "pictures" }); }
    catch (error) { if (error.name === "AbortError") return; }
  }
  const originalId = state.activeId;
  const originalWidth = elements.canvas.width;
  const originalHeight = elements.canvas.height;
  const originalCssWidth = elements.canvas.style.width;
  const originalCssHeight = elements.canvas.style.height;
  state.isExporting = true;
  elements.confirmExportButton.disabled = true;
  const type = elements.formatSelect.value;
  const quality = Number(elements.qualityRange.value) / 100;
  let completed = 0;
  try {
    for (const photo of targets) {
      state.activeId = photo.id;
      bindPhotoTextures(photo);
      elements.canvas.width = photo.image.naturalWidth;
      elements.canvas.height = photo.image.naturalHeight;
      render({ forceAfter: true, hideMask: true });
      gl.finish();
      const blob = await canvasBlob(type, quality);
      await saveBlob(blob, outputName(photo, type), directoryHandle);
      completed += 1;
      elements.confirmExportButton.textContent = `${completed}/${targets.length}`;
      elements.renderStatus.textContent = `Đang xuất ${completed}/${targets.length}…`;
    }
    showToast(`Đã xuất ${completed} ảnh thành công.`);
  } catch (error) {
    showToast(error.message || "Xuất ảnh thất bại.");
  } finally {
    state.activeId = originalId;
    const photo = activePhoto();
    if (photo) bindPhotoTextures(photo);
    elements.canvas.width = originalWidth;
    elements.canvas.height = originalHeight;
    elements.canvas.style.width = originalCssWidth;
    elements.canvas.style.height = originalCssHeight;
    render();
    state.isExporting = false;
    elements.confirmExportButton.textContent = "Xuất ngay";
    elements.renderStatus.textContent = "Ảnh được xử lý cục bộ";
    updateExportCount();
    renderFilmstrip();
  }
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch { showToast("Trình duyệt không cho phép toàn màn hình."); }
}

function bindEvents() {
  const chooseFiles = () => elements.fileInput.click();
  elements.openImageButton.addEventListener("click", chooseFiles);
  elements.addImagesButton.addEventListener("click", chooseFiles);
  elements.fileInput.addEventListener("change", () => loadFiles(elements.fileInput.files));
  elements.sampleImageButton.addEventListener("click", async () => {
    try {
      const response = await fetch("./sample.jpg");
      if (!response.ok) throw new Error("Không thể mở ảnh mẫu.");
      const blob = await response.blob();
      await loadFiles([new File([blob], "anh-mau-mua-thu.jpg", { type: "image/jpeg" })]);
      applyPreset("autumn");
    } catch (error) { showToast(error.message || "Không thể mở ảnh mẫu."); }
  });
  elements.resetButton.addEventListener("click", resetAdjustments);
  elements.previousSettingsButton.addEventListener("click", copyPreviousSettings);
  elements.undoButton.addEventListener("click", undoLastAction);
  elements.presetDrawerHandle.addEventListener("click", () => setPresetDrawer(!state.drawerOpen));
  elements.presetDrawerClose.addEventListener("click", () => setPresetDrawer(false));
  elements.drawerBackdrop.addEventListener("click", () => setPresetDrawer(false));
  elements.importPresetButton.addEventListener("click", () => elements.presetFileInput.click());
  elements.presetFileInput.addEventListener("change", () => importPresetFiles(elements.presetFileInput.files));
  elements.exportButton.addEventListener("click", openExportDialog);
  elements.fullscreenButton.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", () => {
    const active = Boolean(document.fullscreenElement);
    elements.fullscreenButton.setAttribute("aria-pressed", String(active));
    elements.fullscreenButton.innerHTML = active ? "<span aria-hidden=\"true\">×</span>" : "<span aria-hidden=\"true\">⛶</span>";
    elements.fullscreenButton.setAttribute("aria-label", active ? "Thoát toàn màn hình" : "Toàn màn hình");
    elements.fullscreenButton.title = active ? "Thoát toàn màn hình" : "Toàn màn hình";
    if (activePhoto()) requestAnimationFrame(sizePreviewCanvas);
  });
  elements.fitButton.addEventListener("click", () => { state.zoom = 1; updateZoom(); });
  elements.zoomInButton.addEventListener("click", () => { state.zoom = Math.min(3, state.zoom + 0.25); updateZoom(); });
  elements.zoomOutButton.addEventListener("click", () => { state.zoom = Math.max(0.5, state.zoom - 0.25); updateZoom(); });
  document.querySelectorAll("[data-preview-mode]").forEach((button) => button.addEventListener("click", () => setPreviewMode(button.dataset.previewMode)));
  document.querySelectorAll(".section-toggle").forEach((button) => button.addEventListener("click", () => button.setAttribute("aria-expanded", String(button.getAttribute("aria-expanded") !== "true"))));
  document.querySelectorAll(".hsl-tab").forEach((button) => button.addEventListener("click", () => {
    const tab = button.dataset.hslTab;
    document.querySelectorAll(".hsl-tab").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll("[data-hsl-panel]").forEach((panel) => { panel.hidden = tab !== "all" && panel.dataset.hslPanel !== tab; });
  }));
  document.querySelectorAll(".mask-type").forEach((button) => button.addEventListener("click", () => setMaskType(button.dataset.maskType)));
  elements.showMaskToggle.addEventListener("change", () => { const photo = activePhoto(); if (!photo) return; pushHistory(photo, takeSnapshot(photo)); photo.showMask = elements.showMaskToggle.checked; syncMaskUI(); scheduleRender(); });
  elements.clearMaskButton.addEventListener("click", clearBrushMask);
  elements.brushSizeRange.addEventListener("input", () => { elements.brushSizeValue.textContent = elements.brushSizeRange.value; setRangeProgress(elements.brushSizeRange); });
  elements.canvas.addEventListener("pointerdown", (event) => { const photo = activePhoto(); if (!photo || photo.maskType !== "brush") return; event.preventDefault(); pushHistory(photo, takeSnapshot(photo, true)); state.isPainting = true; state.lastPaintPoint = null; elements.canvas.setPointerCapture(event.pointerId); paintMask(event); });
  elements.canvas.addEventListener("pointermove", (event) => { updateBrushCursor(event); if (state.isPainting) paintMask(event); });
  const stopPainting = () => { state.isPainting = false; state.lastPaintPoint = null; };
  elements.canvas.addEventListener("pointerup", stopPainting);
  elements.canvas.addEventListener("pointercancel", stopPainting);
  elements.canvas.addEventListener("pointerleave", () => { stopPainting(); elements.brushCursor.hidden = true; });
  elements.selectAllButton.addEventListener("click", () => { const allSelected = state.photos.length > 0 && state.photos.every((photo) => photo.selected); state.photos.forEach((photo) => { photo.selected = !allSelected; }); renderFilmstrip(); updateExportCount(); });
  elements.exportScopeSelect.addEventListener("change", updateExportCount);
  elements.formatSelect.addEventListener("change", () => { elements.qualityField.hidden = elements.formatSelect.value === "image/png"; });
  elements.qualityRange.addEventListener("input", () => { elements.qualityValue.textContent = `${elements.qualityRange.value}%`; setRangeProgress(elements.qualityRange); });
  elements.exportForm.addEventListener("submit", (event) => { if (event.submitter?.value !== "default") return; event.preventDefault(); exportImages().then(() => elements.exportDialog.close()); });

  let dragDepth = 0;
  window.addEventListener("dragenter", (event) => { event.preventDefault(); dragDepth += 1; elements.dropOverlay.hidden = false; });
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("dragleave", (event) => { event.preventDefault(); dragDepth -= 1; if (dragDepth <= 0) { dragDepth = 0; elements.dropOverlay.hidden = true; } });
  window.addEventListener("drop", (event) => { event.preventDefault(); dragDepth = 0; elements.dropOverlay.hidden = true; loadFiles(event.dataTransfer.files); });
  window.addEventListener("keydown", (event) => {
    const editing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undoLastAction(); return; }
    if (event.key === "Escape" && state.drawerOpen) { setPresetDrawer(false); return; }
    if (event.key === "\\" && !event.repeat) { state.holdingBefore = true; elements.beforeBadge.hidden = false; scheduleRender(); }
    if (!editing && (event.key === "f" || event.key === "F")) toggleFullscreen();
    if (!editing && (event.key === "r" || event.key === "R") && !event.ctrlKey && !event.metaKey) resetAdjustments();
  });
  window.addEventListener("keyup", (event) => { if (event.key === "\\") { state.holdingBefore = false; elements.beforeBadge.hidden = state.previewMode !== "before"; scheduleRender(); } });
  window.addEventListener("resize", () => { if (activePhoto() && !state.isExporting) sizePreviewCanvas(); });
}

function start() {
  try {
    buildControls("lightControls", controlGroups.light);
    buildControls("colorControls", controlGroups.color);
    buildControls("hslHueControls", hslGroups.hue);
    buildControls("hslSaturationControls", hslGroups.saturation);
    buildControls("hslLuminanceControls", hslGroups.luminance);
    buildControls("effectControls", controlGroups.effects);
    buildControls("maskControls", maskControlGroup, "mask");
    initWebGL();
    bindEvents();
    renderPresetList();
    setRangeProgress(elements.qualityRange);
    setRangeProgress(elements.brushSizeRange);
  } catch (error) {
    elements.emptyState.innerHTML = `<h1>Không thể khởi động Luma</h1><p>${error.message}</p><p>Hãy thử mở bằng Chrome hoặc Edge phiên bản mới.</p>`;
  }
}

start();
