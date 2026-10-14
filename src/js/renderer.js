// Bộ xử lý ảnh WebGL 2.
// - Ảnh gốc được nạp dạng SRGB8_ALPHA8 kèm mipmap: lấy mẫu trả về giá trị tuyến tính và thu nhỏ không bị răng cưa.
// - Phơi sáng và cân bằng trắng tính trong không gian tuyến tính; các điều chỉnh tông tính trong gamma.
// - Mọi bán kính (độ nét, kết cấu, hạt) tính theo pixel ẢNH GỐC → xem trước và file xuất giống nhau.
// - Hỗ trợ tối đa MAX_MASKS vùng chọn, cắt/xoay, đường cong tông, phân màu, render theo ô khi xuất.
import { MAX_MASKS, hslColors } from "./config.js";
import { buildCurveLut, LUT_SIZE, parametricFromValues } from "./curve.js";
import { whiteBalanceMultipliers, hueToRgb, luma, calibrationMatrix } from "./color.js";
import { cropMatrix, outputSize, lensParams, perspectiveParams } from "./geometry.js";
import { effectiveSettings } from "./settings.js";

const MASK_TYPE_CODE = { sky: 1, brush: 2, linear: 3, radial: 4, luma: 5, color: 5 };
const RANGE_CODE = { none: 0, luma: 1, color: 2 };

const vertexShaderSource = `#version 300 es
in vec2 a_pos;
uniform vec4 u_dst;
uniform vec4 u_src;
out vec2 v_out;
void main() {
  gl_Position = vec4(mix(u_dst.xy, u_dst.zw, a_pos), 0.0, 1.0);
  v_out = mix(u_src.xy, u_src.zw, a_pos);
}`;

const fragmentShaderSource = `#version 300 es
precision highp float;
precision highp sampler2DArray;
precision highp sampler3D;
uniform sampler2D u_image;
uniform sampler3D u_lut;
uniform vec4 u_lutParams;  // cường độ, kích thước, hiệu lực
uniform vec3 u_lutMin;
uniform vec3 u_lutScale;
uniform mat3 u_persp;
uniform vec4 u_perspC;     // tâm x, tâm y, L, hiệu lực
uniform mat3 u_calib;
uniform vec2 u_calibParams; // hiệu lực, sắc thái vùng tối
uniform sampler2D u_curve;
uniform sampler2DArray u_masks;
uniform vec2 u_imageSize;
uniform mat2 u_cropMat;
uniform vec2 u_cropCenter;
uniform vec2 u_outSize;
uniform float u_pxPerScreen;
uniform float u_original;
uniform vec3 u_bg;

uniform float u_exposure;
uniform vec3 u_wb;
uniform vec4 u_tone;      // contrast, highlights, shadows, whites
uniform float u_blacks;
uniform vec4 u_presence;  // texture, clarity, dehaze, vibrance
uniform float u_saturation;
uniform vec4 u_detail;    // sharpen, noise, colorNoise, defringe
uniform vec4 u_lens;      // k, s, 1/R², hiệu lực
uniform float u_outSharpen;
uniform vec4 u_fx;        // vignette, grain, grainSize, seed
uniform vec4 u_hslHue[2];
uniform vec4 u_hslSat[2];
uniform vec4 u_hslLum[2];
uniform vec3 u_gradeTint[4];  // shadows, midtones, highlights, global
uniform vec4 u_gradeLum;
uniform vec2 u_gradeParams;   // điểm cân bằng, số mũ hoà trộn

uniform int u_maskCount;
uniform vec4 u_mA[${MAX_MASKS}];  // exposure, contrast, highlights, shadows
uniform vec4 u_mB[${MAX_MASKS}];  // whites, blacks, saturation, clarity
uniform vec4 u_mC[${MAX_MASKS}];  // dehaze, sharpness, noise, moire
uniform vec4 u_mD[${MAX_MASKS}];  // defringe, strength, type, invert
uniform vec3 u_mWB[${MAX_MASKS}];
uniform vec4 u_mG1[${MAX_MASKS}]; // linear: start.xy end.xy | radial: center.xy radius.xy (px)
uniform vec4 u_mG2[${MAX_MASKS}]; // cos, sin, feather, layer
uniform vec4 u_mR[${MAX_MASKS}];  // loại dải (0 không, 1 sáng, 2 màu), lo, hi, độ mềm
uniform vec4 u_mR2[${MAX_MASKS}]; // sắc độ (0..1), dung sai, bão hoà tối thiểu, đảo dải
uniform int u_overlayMask;
uniform int u_clipping;

in vec2 v_out;
out vec4 outColor;

float luminance(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 toLinear(vec3 c) { c = max(c, 0.0); return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toGamma(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

uint hashU(uvec2 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v = v ^ (v >> 16u);
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v = v ^ (v >> 16u);
  return v.x ^ v.y;
}
float hash(vec2 p) { return float(hashU(uvec2(ivec2(floor(p)) + 65536))) / 4294967295.0; }
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1, 0)), c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec3 sampleLod(vec2 px, float lod) { return textureLod(u_image, px / u_imageSize, lod).rgb; }
vec3 ringBlur(vec2 px, float radius) {
  float lod = max(0.0, log2(max(radius, 1.0)) - 0.6);
  vec3 sum = sampleLod(px, lod) * 2.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853982 + 0.3926991;
    sum += sampleLod(px + vec2(cos(a), sin(a)) * radius, lod);
  }
  return sum / 10.0;
}

vec3 adjustRange(vec3 color, float amount, float weight, float strength) {
  if (amount >= 0.0) return color + amount * strength * weight * (1.0 - color);
  return color + amount * strength * weight * color;
}

vec3 applyTones(vec3 c, float contrast, float highlights, float shadows, float whites, float blacks) {
  float light = clamp(luminance(c), 0.0, 1.0);
  c = adjustRange(c, shadows, 1.0 - smoothstep(0.06, 0.55, light), 0.42);
  c = adjustRange(c, highlights, smoothstep(0.45, 0.95, light), 0.38);
  c = adjustRange(c, blacks, 1.0 - smoothstep(0.0, 0.3, light), 0.3);
  c = adjustRange(c, whites, smoothstep(0.62, 1.0, light), 0.3);
  if (contrast >= 0.0) {
    vec3 s = clamp(c, 0.0, 1.0);
    c += (s * s * (3.0 - 2.0 * s) - s) * contrast * 1.6;
  } else {
    c = mix(c, 0.5 + (c - 0.5) * 0.45, -contrast);
  }
  return c;
}

vec3 applyDehaze(vec3 c, float amount) {
  if (amount >= 0.0) {
    float k = amount * 0.14;
    c = (c - k) / (1.0 - k);
    float l = luminance(c);
    return mix(vec3(l), c, 1.0 + amount * 0.3);
  }
  return mix(c, vec3(0.78), -amount * 0.35);
}

vec3 saturate(vec3 c, float amount) { return mix(vec3(luminance(c)), c, 1.0 + amount); }

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
float hslValue(vec4 arr[2], int i) { return i < 4 ? arr[0][i] : arr[1][i - 4]; }

vec3 applyHslMix(vec3 inputColor) {
  vec3 hsv = rgbToHsv(clamp(inputColor, 0.0, 1.0));
  float centers[8] = float[8](0.0, 0.0833, 0.1667, 0.3333, 0.5, 0.6667, 0.75, 0.875);
  float chromaGate = smoothstep(0.02, 0.18, hsv.y);
  float hueShift = 0.0, satShift = 0.0, lumShift = 0.0, total = 0.0;
  for (int i = 0; i < 8; i++) {
    float w = 1.0 - smoothstep(0.035, 0.145, hueDistance(hsv.x, centers[i]));
    hueShift += hslValue(u_hslHue, i) * w;
    satShift += hslValue(u_hslSat, i) * w;
    lumShift += hslValue(u_hslLum, i) * w;
    total += w;
  }
  float n = max(1.0, total);
  hsv.x = fract(hsv.x + hueShift / n * 0.085 * chromaGate + 1.0);
  hsv.y = clamp(hsv.y * (1.0 + satShift / n), 0.0, 1.0);
  vec3 rgb = hsvToRgb(hsv);
  float l = lumShift / n * chromaGate;
  return l >= 0.0 ? rgb + l * 0.35 * (1.0 - rgb) * hsv.y : rgb * (1.0 + l * 0.55 * hsv.y);
}

vec3 applyGrade(vec3 c) {
  float t = clamp(luminance(c), 0.0, 1.0);
  float p = u_gradeParams.x;
  float e = u_gradeParams.y;
  float ws = pow(clamp(1.0 - t / p, 0.0, 1.0), e);
  float wh = pow(clamp((t - p) / (1.0 - p), 0.0, 1.0), e);
  float wm = clamp(1.0 - ws - wh, 0.0, 1.0);
  c += u_gradeTint[0] * ws + u_gradeTint[1] * wm + u_gradeTint[2] * wh + u_gradeTint[3];
  float lum = u_gradeLum.x * ws + u_gradeLum.y * wm + u_gradeLum.z * wh + u_gradeLum.w;
  return lum >= 0.0 ? c + lum * (1.0 - c) : c * (1.0 + lum);
}

float skyMask(vec3 source, vec2 uv) {
  float maxC = max(max(source.r, source.g), source.b);
  float minC = min(min(source.r, source.g), source.b);
  float blue = smoothstep(-0.02, 0.17, source.b - source.r) * smoothstep(-0.08, 0.13, source.b - source.g);
  float cloud = (1.0 - smoothstep(0.07, 0.25, maxC - minC)) * smoothstep(0.56, 0.92, luminance(source)) * 0.72;
  float upper = 1.0 - smoothstep(0.24, 0.72, uv.y);
  return clamp(max(blue, cloud) * upper, 0.0, 1.0);
}

float maskValue(int i, vec2 px, vec2 uv, vec3 sourceGamma) {
  vec4 d = u_mD[i];
  int type = int(d.z + 0.5);
  vec4 g1 = u_mG1[i];
  vec4 g2 = u_mG2[i];
  float m = 0.0;
  if (type == 1) m = skyMask(sourceGamma, uv);
  else if (type == 2) m = texture(u_masks, vec3(uv, g2.w)).r;
  else if (type == 3) {
    vec2 dir = g1.zw - g1.xy;
    float t = dot(px - g1.xy, dir) / max(dot(dir, dir), 1e-4);
    m = 1.0 - smoothstep(0.0, 1.0, t);
  } else if (type == 4) {
    vec2 q = px - g1.xy;
    q = vec2(g2.x * q.x + g2.y * q.y, -g2.y * q.x + g2.x * q.y);
    float r = length(q / max(g1.zw, vec2(1.0)));
    float f = max(0.01, g2.z);
    m = 1.0 - smoothstep(1.0 - f, 1.0, r);
  }
  else if (type == 5) m = 1.0;
  if (d.w > 0.5) m = 1.0 - m;
  vec4 r = u_mR[i];
  if (r.x > 0.5) {
    float w = 1.0;
    if (r.x < 1.5) {
      float l = luminance(sourceGamma);
      w = smoothstep(r.y - r.w, r.y, l) * (1.0 - smoothstep(r.z, r.z + r.w, l));
    } else {
      vec3 hsv = rgbToHsv(clamp(sourceGamma, 0.0, 1.0));
      vec4 r2 = u_mR2[i];
      float dist = hueDistance(hsv.x, r2.x);
      w = (1.0 - smoothstep(r2.y, r2.y + 0.06, dist)) * smoothstep(r2.z * 0.5, r2.z + 0.02, hsv.y);
    }
    if (u_mR2[i].w > 0.5) w = 1.0 - w;
    m *= w;
  }
  return clamp(m * d.y, 0.0, 1.0);
}

void main() {
  vec2 px = u_cropCenter + u_cropMat * (v_out - 0.5);
  if (u_perspC.w > 0.5) {
    vec3 h = u_persp * vec3((px - u_perspC.xy) / u_perspC.z, 1.0);
    px = h.z > 1e-4 ? u_perspC.xy + h.xy / h.z * u_perspC.z : vec2(-1e6);
  }
  if (u_lens.w > 0.5) {
    vec2 d = px - u_imageSize * 0.5;
    px = u_imageSize * 0.5 + d * u_lens.y * (1.0 + u_lens.x * dot(d, d) * u_lens.z);
  }
  vec2 uv = px / u_imageSize;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) { outColor = vec4(u_bg, 1.0); return; }

  vec3 srcLin = texture(u_image, uv).rgb;
  vec3 srcGamma = toGamma(srcLin);
  if (u_original > 0.5) { outColor = vec4(srcGamma, 1.0); return; }

  // Bán kính thật tính theo pixel ảnh gốc. Khi xem thu nhỏ, dải chi tiết nhỏ hơn một pixel màn hình
  // được làm mờ dần theo tỉ lệ (giống khi thu nhỏ file xuất) thay vì bị phóng to → xem trước khớp file xuất.
  float longEdge = max(u_imageSize.x, u_imageSize.y);
  float screen = max(1.0, u_pxPerScreen);
  float fineTrue = 1.0;
  float textureTrue = max(2.0, longEdge * 0.0025);
  float clarityTrue = max(4.0, longEdge * 0.012);
  float fineRadius = max(fineTrue, screen);
  float textureRadius = max(textureTrue, screen * 2.0);
  float clarityRadius = max(clarityTrue, screen * 2.0);
  vec3 blurFine = toGamma(ringBlur(px, fineRadius));
  vec3 blurTexture = toGamma(ringBlur(px, textureRadius));
  vec3 blurClarity = toGamma(ringBlur(px, clarityRadius));
  vec3 dFine = (srcGamma - blurFine) * (fineTrue / fineRadius);
  vec3 dTexture = (blurFine - blurTexture) * min(1.0, textureTrue / (textureRadius * 0.5));
  vec3 dClarity = (srcGamma - blurClarity) * min(1.0, clarityTrue / clarityRadius);

  vec3 lin = u_calibParams.x > 0.5 ? max(u_calib * srcLin, 0.0) : srcLin;
  lin = lin * exp2(u_exposure) * u_wb;
  vec3 c = toGamma(lin);
  if (u_calibParams.y != 0.0) {
    float sh = 1.0 - smoothstep(0.0, 0.55, clamp(luminance(c), 0.0, 1.0));
    c += vec3(0.5, -1.0, 0.5) * u_calibParams.y * 0.07 * sh;
  }
  float mid = 1.0 - abs(clamp(luminance(c), 0.0, 1.0) - 0.5) * 1.4;
  c += dTexture * u_presence.x * 1.1;
  c += dClarity * u_presence.y * 0.75 * clamp(mid, 0.0, 1.0);
  c += dFine * u_detail.x * 1.3;
  c -= vec3(luminance(dFine)) * u_detail.y * 0.95;
  vec3 chromaDetail = (dFine + dTexture) - vec3(luminance(dFine + dTexture));
  c -= chromaDetail * u_detail.z * 0.95;

  if (u_detail.w > 0.0) {
    float fringeEdge = clamp(length(srcGamma - blurTexture) * 5.0, 0.0, 1.0);
    float fp = smoothstep(0.0, 0.08, min(c.r, c.b) - c.g);
    float fg = smoothstep(0.0, 0.08, c.g - max(c.r, c.b));
    c = mix(c, vec3(luminance(c)), u_detail.w * fringeEdge * max(fp, fg));
  }
  if (u_outSharpen > 0.0) {
    vec3 blurOut = toGamma(ringBlur(px, max(1.0, u_pxPerScreen)));
    c += (srcGamma - blurOut) * u_outSharpen;
  }

  c = applyDehaze(c, u_presence.z);
  c = applyTones(c, u_tone.x, u_tone.y, u_tone.z, u_tone.w, u_blacks);

  vec3 cc = clamp(c, 0.0, 1.0);
  c = vec3(texture(u_curve, vec2(cc.r, 0.5)).r, texture(u_curve, vec2(cc.g, 0.5)).g, texture(u_curve, vec2(cc.b, 0.5)).b) + (c - cc);

  float currentSat = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
  c = saturate(c, u_presence.w * (1.0 - clamp(currentSat, 0.0, 1.0)));
  c = saturate(c, u_saturation);
  c = applyHslMix(c);
  c = applyGrade(c);

  if (u_lutParams.z > 0.5) {
    float n = u_lutParams.y;
    vec3 cc = clamp((c - u_lutMin) * u_lutScale, 0.0, 1.0);
    vec3 looked = texture(u_lut, cc * ((n - 1.0) / n) + 0.5 / n).rgb;
    c = mix(c, looked, u_lutParams.x);
  }

  float overlay = 0.0;
  for (int i = 0; i < ${MAX_MASKS}; i++) {
    if (i >= u_maskCount) break;
    float m = maskValue(i, px, uv, srcGamma);
    if (i == u_overlayMask) overlay = m;
    if (m <= 0.0) continue;
    vec4 a = u_mA[i];
    vec4 b = u_mB[i];
    vec4 k = u_mC[i];
    vec3 l = toGamma(toLinear(c) * exp2(a.x) * u_mWB[i]);
    l += dClarity * b.w * 0.8 + dFine * k.y * 1.0;
    l -= vec3(luminance(dFine)) * k.z * 0.95;
    l -= chromaDetail * k.w * 0.95;
    float edge = clamp(length(dFine) * 7.0, 0.0, 1.0);
    float purple = smoothstep(0.0, 0.08, min(l.r, l.b) - l.g);
    float green = smoothstep(0.0, 0.08, l.g - max(l.r, l.b));
    l = mix(l, vec3(luminance(l)), u_mD[i].x * edge * max(purple, green));
    l = applyDehaze(l, k.x);
    l = applyTones(l, a.y, a.z, a.w, b.x, b.y);
    l = saturate(l, b.z);
    c = mix(c, l, m);
  }

  vec2 centered = (v_out - 0.5) * 1.4142;
  float vig = smoothstep(0.42, 1.0, length(centered));
  if (u_fx.x < 0.0) c *= 1.0 + u_fx.x * 0.78 * vig;
  else c += u_fx.x * 0.42 * vig * (1.0 - c);

  if (u_fx.y > 0.0) {
    float outLong = max(u_outSize.x, u_outSize.y);
    float cell = max(0.5, mix(0.7, 3.2, u_fx.z) * max(1.0, outLong / 2400.0));
    vec2 gp = v_out * u_outSize / cell;
    float footprint = max(1.0, u_pxPerScreen / cell);
    float n = (valueNoise(gp + u_fx.w) + valueNoise(gp * 2.13 + 17.0) * 0.5) / 1.5 - 0.5;
    float lum = clamp(luminance(c), 0.0, 1.0);
    c += n * u_fx.y * 0.22 * (0.35 + 2.6 * lum * (1.0 - lum)) / sqrt(footprint);
  }

  if (u_clipping == 1) {
    if (max(max(c.r, c.g), c.b) >= 0.998) c = vec3(1.0, 0.12, 0.12);
    else if (max(max(c.r, c.g), c.b) <= 0.004) c = vec3(0.1, 0.35, 1.0);
  }
  if (overlay > 0.0) c = mix(c, vec3(1.0, 0.18, 0.32), overlay * 0.5);
  c += (hash(gl_FragCoord.xy + u_fx.w * 31.0) - 0.5) / 255.0;
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false, alpha: true });
    if (!gl) throw new Error("Trình duyệt này chưa hỗ trợ WebGL 2.");
    this.gl = gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.maxViewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    this.maxRenderbuffer = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    this.program = this.createProgram();
    gl.useProgram(this.program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.program, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.uniforms = {};
    const count = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(this.program, i);
      const name = info.name.replace(/\[0\]$/, "");
      this.uniforms[name] = gl.getUniformLocation(this.program, info.name);
    }
    gl.uniform1i(this.uniforms.u_image, 0);
    gl.uniform1i(this.uniforms.u_curve, 1);
    gl.uniform1i(this.uniforms.u_masks, 2);
    gl.uniform1i(this.uniforms.u_lut, 4);
    this.lutTexture = gl.createTexture();
    this.lutKey = null;
    this.lutResolver = null; // (lutRef) => { id, size, data, domainMin, domainMax } | null
    this.uploadLut(null);
    this.curveTexture = gl.createTexture();
    this.curveKey = null;
    this.maskTexture = null;
    this.maskSize = null;
    this.layerVersions = new Array(MAX_MASKS).fill(null);
    this.imageTexture = null;
    this.photoId = null;
    this.fbo = gl.createFramebuffer();
    this.fboTexture = null;
    this.fboSize = null;
  }

  createProgram() {
    const gl = this.gl;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "Không thể biên dịch shader.");
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexShaderSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentShaderSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Không thể khởi tạo bộ xử lý ảnh.");
    return program;
  }

  /** Nạp ảnh của một photo (ImageBitmap) lên GPU kèm mipmap. */
  setPhoto(photo) {
    const gl = this.gl;
    if (this.photoId === photo.id && this.imageTexture) return;
    if (this.imageTexture) gl.deleteTexture(this.imageTexture);
    this.imageTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, photo.bitmap);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.photoId = photo.id;
    this.imageSize = [photo.width, photo.height];
    this.allocateMaskTexture(photo.maskSize);
  }

  allocateMaskTexture({ width, height }) {
    const gl = this.gl;
    if (this.maskTexture) gl.deleteTexture(this.maskTexture);
    this.maskTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.maskTexture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R8, width, height, MAX_MASKS);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.maskSize = { width, height };
    this.layerVersions.fill(null);
  }

  /** source: HTMLCanvasElement đang vẽ, hoặc { data: Uint8Array } (1 kênh), hoặc null để xoá. */
  uploadMaskLayer(layer, source, version) {
    const gl = this.gl;
    if (!this.maskTexture || layer >= MAX_MASKS) return;
    if (version !== undefined && this.layerVersions[layer] === version) return;
    const { width, height } = this.maskSize;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.maskTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (!source) {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, width, height, 1, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(width * height));
    } else if (source.data) {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, width, height, 1, gl.RED, gl.UNSIGNED_BYTE, source.data);
    } else {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, width, height, 1, gl.RED, gl.UNSIGNED_BYTE, source);
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.layerVersions[layer] = version ?? null;
  }

  syncMasks(masks, liveCanvas) {
    for (let i = 0; i < MAX_MASKS; i++) {
      const mask = masks[i];
      if (mask && mask.type === "brush" && liveCanvas && liveCanvas.maskId === mask.id) {
        this.uploadMaskLayer(i, liveCanvas.canvas, `live-${mask.id}-${liveCanvas.version}`);
      } else if (mask && mask.type === "brush" && mask.brush) {
        this.uploadMaskLayer(i, mask.brush, `${mask.id}-${mask.brush.version}`);
      } else if (this.layerVersions[i] !== "empty") {
        this.uploadMaskLayer(i, null, "empty");
      }
    }
  }

  /** Nạp LUT 3D (null → LUT đơn vị 2×2×2). */
  uploadLut(lut) {
    const key = lut ? `${lut.id}:${lut.size}` : "identity";
    if (key === this.lutKey) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (lut) {
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data instanceof Float32Array ? lut.data : new Float32Array(lut.data));
    } else {
      const id = new Float32Array(24);
      let o = 0;
      for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) { id[o++] = r; id[o++] = g; id[o++] = b; }
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, 2, 2, 2, 0, gl.RGB, gl.FLOAT, id);
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    this.lutKey = key;
  }

  setCurve(curve, values = null) {
    const param = values ? parametricFromValues(values) : null;
    const key = JSON.stringify([curve, param]);
    if (key === this.curveKey) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, LUT_SIZE, 1, 0, gl.RGBA, gl.FLOAT, buildCurveLut(curve, param));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.curveKey = key;
  }

  setUniforms(rawSettings, { crop, pxPerScreen, original = false, overlayMask = -1, clipping = false, background = [0.16, 0.17, 0.18], outputSharpen = 0 }) {
    const settings = effectiveSettings(rawSettings);
    const gl = this.gl;
    const u = this.uniforms;
    const v = settings.values;
    const [iw, ih] = this.imageSize;
    const out = outputSize(crop);
    gl.uniform2f(u.u_imageSize, iw, ih);
    const m = cropMatrix(crop);
    // mat2 trong GLSL là cột trước
    gl.uniformMatrix2fv(u.u_cropMat, false, new Float32Array([m[0], m[2], m[1], m[3]]));
    gl.uniform2f(u.u_cropCenter, crop.cx, crop.cy);
    gl.uniform2f(u.u_outSize, out.width, out.height);
    gl.uniform1f(u.u_pxPerScreen, Math.max(0.01, pxPerScreen));
    gl.uniform1f(u.u_original, original ? 1 : 0);
    gl.uniform3f(u.u_bg, ...background);

    gl.uniform1f(u.u_exposure, v.exposure);
    gl.uniform3f(u.u_wb, ...whiteBalanceMultipliers(v.temperature, v.tint));
    gl.uniform4f(u.u_tone, v.contrast / 100, v.highlights / 100, v.shadows / 100, v.whites / 100);
    gl.uniform1f(u.u_blacks, v.blacks / 100);
    gl.uniform4f(u.u_presence, v.texture / 100, v.clarity / 100, v.dehaze / 100, v.vibrance / 100);
    gl.uniform1f(u.u_saturation, v.saturation / 100);
    gl.uniform4f(u.u_detail, v.sharpen / 100, v.noise / 100, v.colorNoise / 100, (v.defringe || 0) / 100);
    const lens = lensParams(v.distortion, iw, ih);
    gl.uniform4f(u.u_lens, lens?.k || 0, lens?.s || 1, lens ? 1 / (lens.R * lens.R) : 0, lens ? 1 : 0);
    const persp = perspectiveParams(v, iw, ih);
    if (persp) {
      const M = persp.M; // hàng trước → cột trước cho GLSL
      gl.uniformMatrix3fv(u.u_persp, false, new Float32Array([M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]]));
      gl.uniform4f(u.u_perspC, persp.cx, persp.cy, persp.L, 1);
    } else {
      gl.uniform4f(u.u_perspC, iw / 2, ih / 2, 1, 0);
    }
    const calib = calibrationMatrix(v);
    if (calib) gl.uniformMatrix3fv(u.u_calib, false, new Float32Array([calib[0], calib[3], calib[6], calib[1], calib[4], calib[7], calib[2], calib[5], calib[8]]));
    gl.uniform2f(u.u_calibParams, calib ? 1 : 0, (v.calShadowTint || 0) / 100);
    const lut = settings.lut && this.lutResolver ? this.lutResolver(settings.lut) : null;
    const lutAmount = (v.lutAmount ?? 100) / 100;
    if (lut && lutAmount > 0) {
      this.uploadLut(lut);
      gl.uniform4f(u.u_lutParams, lutAmount, lut.size, 1, 0);
      const min = lut.domainMin || [0, 0, 0], max = lut.domainMax || [1, 1, 1];
      gl.uniform3f(u.u_lutMin, ...min);
      gl.uniform3f(u.u_lutScale, ...max.map((m, i) => 1 / (m - min[i])));
    } else {
      gl.uniform4f(u.u_lutParams, 0, 2, 0, 0);
    }
    gl.uniform1f(u.u_outSharpen, outputSharpen);
    gl.uniform4f(u.u_fx, v.vignette / 100, v.grain / 100, v.grainSize / 100, 7.31);
    const pack = (prefix) => new Float32Array(hslColors.map(([id]) => v[`${prefix}${id}`] / 100));
    gl.uniform4fv(u.u_hslHue, pack("hslHue"));
    gl.uniform4fv(u.u_hslSat, pack("hslSat"));
    gl.uniform4fv(u.u_hslLum, pack("hslLum"));

    const grade = settings.grade;
    const tints = [];
    const lums = [];
    for (const zone of ["shadows", "midtones", "highlights", "global"]) {
      const z = grade[zone];
      const rgb = hueToRgb(z.h);
      const y = luma(...rgb);
      const k = (z.s / 100) * 0.32;
      tints.push((rgb[0] - y) * k, (rgb[1] - y) * k, (rgb[2] - y) * k);
      lums.push((z.l / 100) * 0.25);
    }
    gl.uniform3fv(u.u_gradeTint, new Float32Array(tints));
    gl.uniform4f(u.u_gradeLum, ...lums);
    const balancePoint = Math.min(0.85, Math.max(0.15, 0.5 - (grade.balance / 100) * 0.3));
    const blendExp = 2.4 + (0.55 - 2.4) * (grade.blending / 100);
    gl.uniform2f(u.u_gradeParams, balancePoint, blendExp);

    const masks = settings.masks.slice(0, MAX_MASKS).filter(Boolean);
    const A = new Float32Array(MAX_MASKS * 4), B = new Float32Array(MAX_MASKS * 4), C = new Float32Array(MAX_MASKS * 4), D = new Float32Array(MAX_MASKS * 4);
    const WB = new Float32Array(MAX_MASKS * 3), G1 = new Float32Array(MAX_MASKS * 4), G2 = new Float32Array(MAX_MASKS * 4);
    const R = new Float32Array(MAX_MASKS * 4), R2 = new Float32Array(MAX_MASKS * 4);
    const longEdge = Math.max(iw, ih);
    settings.masks.slice(0, MAX_MASKS).forEach((mask, i) => {
      const mv = mask.values;
      A.set([mv.exposure, mv.contrast / 100, mv.highlights / 100, mv.shadows / 100], i * 4);
      B.set([mv.whites / 100, mv.blacks / 100, mv.saturation / 100, mv.clarity / 100], i * 4);
      C.set([mv.dehaze / 100, mv.sharpness / 100, mv.noise / 100, mv.moire / 100], i * 4);
      const enabled = mask.visible !== false;
      D.set([mv.defringe / 100, enabled ? mv.strength / 100 : 0, MASK_TYPE_CODE[mask.type] || 0, mask.invert ? 1 : 0], i * 4);
      WB.set(whiteBalanceMultipliers(mv.temperature, mv.tint), i * 3);
      if (mask.type === "linear") {
        G1.set([mask.linear.start.x * iw, mask.linear.start.y * ih, mask.linear.end.x * iw, mask.linear.end.y * ih], i * 4);
      } else if (mask.type === "radial") {
        G1.set([mask.radial.center.x * iw, mask.radial.center.y * ih, mask.radial.rx * longEdge, mask.radial.ry * longEdge], i * 4);
      }
      const rot = ((mask.radial?.rotation || 0) * Math.PI) / 180;
      G2.set([Math.cos(rot), Math.sin(rot), (mask.feather ?? 50) / 100, i], i * 4);
      const range = mask.type === "luma" ? { ...mask.range, type: "luma" } : mask.type === "color" ? { ...mask.range, type: "color" } : (mask.range || { type: "none" });
      R.set([RANGE_CODE[range.type] || 0, (range.lo ?? 25) / 100, (range.hi ?? 75) / 100, Math.max(0.005, (range.feather ?? 15) / 100)], i * 4);
      R2.set([((range.hue ?? 0) % 360) / 360, (range.tolerance ?? 30) / 360, (range.sat ?? 40) / 100 * 0.6, range.invert ? 1 : 0], i * 4);
    });
    gl.uniform1i(u.u_maskCount, masks.length);
    gl.uniform4fv(u.u_mA, A);
    gl.uniform4fv(u.u_mB, B);
    gl.uniform4fv(u.u_mC, C);
    gl.uniform4fv(u.u_mD, D);
    gl.uniform3fv(u.u_mWB, WB);
    gl.uniform4fv(u.u_mG1, G1);
    gl.uniform4fv(u.u_mG2, G2);
    gl.uniform4fv(u.u_mR, R);
    gl.uniform4fv(u.u_mR2, R2);
    gl.uniform1i(u.u_overlayMask, overlayMask);
    gl.uniform1i(u.u_clipping, clipping ? 1 : 0);
  }

  bindTextures() {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.maskTexture);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture);
  }

  /** Chuẩn bị đường cong + uniform cho một bộ thiết lập. */
  prepare(settings, options) {
    const eff = effectiveSettings(settings);
    this.setCurve(eff.curve, eff.values);
    this.setUniforms(settings, options);
  }

  quad(dst, src = [0, 0, 1, 1]) {
    const gl = this.gl;
    gl.uniform4f(this.uniforms.u_dst, ...dst);
    gl.uniform4f(this.uniforms.u_src, ...src);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /**
   * Vẽ lên canvas hiển thị.
   * rect: vị trí ảnh đầu ra trên canvas (pixel canvas): { x, y, width, height }
   * split: null | vị trí x (pixel canvas) của đường chia – bên trái là ảnh gốc (hoặc ảnh tham chiếu).
   * reference: thiết lập dùng thay cho ảnh gốc (so sánh với một bước lịch sử / snapshot).
   */
  drawView(settings, { crop, rect, original, split = null, overlayMask = -1, clipping = false, background, reference = null, liveBrush = null }) {
    const gl = this.gl;
    const W = this.canvas.width;
    const H = this.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.imageTexture) return;
    gl.useProgram(this.program);
    this.bindTextures();
    const out = outputSize(crop);
    const pxPerScreen = out.width / rect.width;
    const toNdcX = (x) => (x / W) * 2 - 1;
    const toNdcY = (y) => 1 - (y / H) * 2;
    const dst = [toNdcX(rect.x), toNdcY(rect.y), toNdcX(rect.x + rect.width), toNdcY(rect.y + rect.height)];
    const drawReference = () => {
      this.syncMasks(reference.masks, null);
      this.bindTextures();
      this.prepare(reference, { crop, pxPerScreen, clipping, background });
      this.quad(dst);
    };
    if (original && reference) { drawReference(); return; }
    this.syncMasks(settings.masks, liveBrush);
    this.bindTextures();
    this.prepare(settings, { crop, pxPerScreen, original, overlayMask, clipping, background });
    this.quad(dst);
    if (split !== null && !original) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, 0, Math.max(0, Math.round(split)), H);
      if (reference) drawReference();
      else {
        gl.uniform1f(this.uniforms.u_original, 1);
        this.quad(dst);
      }
      gl.disable(gl.SCISSOR_TEST);
    }
  }

  ensureFbo(width, height) {
    const gl = this.gl;
    if (this.fboSize && this.fboSize[0] === width && this.fboSize[1] === height) return;
    if (this.fboTexture) gl.deleteTexture(this.fboTexture);
    this.fboTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.fboTexture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTexture, 0);
    this.fboSize = [width, height];
  }

  /**
   * Render vùng src (toạ độ đầu ra 0..1) vào buffer width×height, đọc pixel theo thứ tự hàng từ trên xuống.
   * pxPerScreen: số pixel ảnh gốc ứng với 1 pixel đầu ra.
   */
  renderRegion(settings, { crop, width, height, src = [0, 0, 1, 1], pxPerScreen, original = false, target, outputSharpen = 0 }) {
    const gl = this.gl;
    this.ensureFbo(width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(this.program);
    this.bindTextures();
    this.prepare(settings, { crop, pxPerScreen, original, outputSharpen });
    // Đặt hàng đầu ảnh ở y = -1 để readPixels trả về thứ tự từ trên xuống.
    this.quad([-1, -1, 1, 1], src);
    const pixels = target || new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return pixels;
  }

  /** Render ảnh nhỏ toàn khung (thumbnail, histogram). */
  renderThumbnail(settings, crop, maxSide) {
    const out = outputSize(crop);
    const scale = Math.min(1, maxSide / Math.max(out.width, out.height));
    const width = Math.max(1, Math.round(out.width * scale));
    const height = Math.max(1, Math.round(out.height * scale));
    const pixels = this.renderRegion(settings, { crop, width, height, pxPerScreen: out.width / width });
    return { width, height, pixels };
  }

  maxTileSize() {
    return Math.max(256, Math.min(2048, this.maxRenderbuffer, this.maxViewport[0], this.maxViewport[1]));
  }

  /** Render toàn bộ ảnh đầu ra theo từng ô để vượt giới hạn kích thước canvas/GPU. */
  async renderTiled(settings, { crop, width, height, onTile, shouldCancel, outputSharpen = 0 }) {
    const tile = this.maxTileSize();
    const out = outputSize(crop);
    const pxPerScreen = out.width / width;
    for (let y = 0; y < height; y += tile) {
      for (let x = 0; x < width; x += tile) {
        if (shouldCancel?.()) throw new DOMException("Đã huỷ", "AbortError");
        const w = Math.min(tile, width - x);
        const h = Math.min(tile, height - y);
        const src = [x / width, y / height, (x + w) / width, (y + h) / height];
        const pixels = this.renderRegion(settings, { crop, width: w, height: h, src, pxPerScreen, outputSharpen });
        onTile({ x, y, width: w, height: h, pixels });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }
}
