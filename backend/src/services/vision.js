/**
 * RoadPulse vision v2 — content-based road-damage detection.
 *
 * PRD 4.1 calls for a YOLOv8 edge classifier. Running pre-trained Torch weights
 * inside this Node service is not an option (the platform is deliberately
 * zero-native-build), so this module implements the *evidence* half of that
 * pipeline in pure JS: it decodes the uploaded frame and measures the physical
 * signature of pavement damage —
 *
 *   pothole          → a compact, high-contrast DARK blob with a sharp rim and a
 *                      comparatively smooth interior (a bowl).
 *   alligator_crack  → a broad, mottled region whose interior is dense with
 *                      edges (the interconnecting crack web).
 *   longitudinal_crack → a long, thin linear streak with a high aspect ratio.
 *
 * The measurements are combined into a calibrated 0–1 confidence in the same
 * units the rest of the platform already uses (`CONFIDENCE_GATE` = 0.60,
 * `AUTO_VERIFY_CONFIDENCE` = 0.85), so a clear pothole auto-verifies and a
 * blurry or irrelevant frame is held or discarded — instead of every upload
 * being scored with the same hard-coded constant.
 *
 * Swapping in a real model later means replacing `analyzePixels` only; the
 * route-facing contract (`analyzeUpload`) stays the same.
 */

import fs from 'node:fs/promises';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { AUTO_VERIFY_CONFIDENCE, CONFIDENCE_GATE, DAMAGE_CLASSES } from '../config.js';

export const DETECTOR_ID = 'roadpulse-vision-v2';
export const FALLBACK_DETECTOR_ID = 'metadata-fallback';

/** Long edge of the working canvas the statistics are measured on. */
const WORK_LONG_EDGE = 192;
/** Ignore dark blobs smaller than this share of the frame (sensor noise, dashes). */
const MIN_REGION_FRACTION = 0.0015;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => clamp(v, 0, 1);

/* ------------------------------------------------------------------ decode -- */

/**
 * Decode a JPEG or PNG buffer into an RGBA byte array.
 * Returns null for anything we cannot read (video, WebP, HEIC…) so the caller
 * can fall back instead of throwing.
 */
export function decodeImage(buffer, mimetype = '') {
  const type = String(mimetype).toLowerCase();
  try {
    if (type.includes('jpeg') || type.includes('jpg') || (!type && buffer[0] === 0xff && buffer[1] === 0xd8)) {
      // Decoding is synchronous CPU work in the request handler, so bound it:
      // anything past a 64 MP frame is refused (we fall back to Pending) rather
      // than stalling the event loop.
      const img = jpeg.decode(buffer, {
        useTArray: true,
        formatAsRGBA: true,
        tolerantDecoding: true,
        maxResolutionInMP: 64,
        maxMemoryUsageInMB: 512,
      });
      return { data: img.data, width: img.width, height: img.height };
    }
    if (type.includes('png') || (!type && buffer[0] === 0x89 && buffer[1] === 0x50)) {
      const img = PNG.sync.read(buffer);
      return { data: img.data, width: img.width, height: img.height };
    }
  } catch {
    return null;
  }
  return null;
}

/* ------------------------------------------------------------- primitives -- */

/** Separable box blur via a summed-area table — O(1) per pixel. */
function boxBlur(src, w, h, radius) {
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += src[y * w + x];
      sat[(y + 1) * (w + 1) + (x + 1)] = sat[y * (w + 1) + (x + 1)] + rowSum;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h - 1, y + radius);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w - 1, x + radius);
      const sum =
        sat[(y1 + 1) * (w + 1) + (x1 + 1)] -
        sat[y0 * (w + 1) + (x1 + 1)] -
        sat[(y1 + 1) * (w + 1) + x0] +
        sat[y0 * (w + 1) + x0];
      out[y * w + x] = sum / ((y1 - y0 + 1) * (x1 - x0 + 1));
    }
  }
  return out;
}

/** Sobel gradient magnitude — edge energy per pixel. */
function gradientMagnitude(y, w, h) {
  const out = new Float32Array(w * h);
  for (let j = 1; j < h - 1; j++) {
    for (let i = 1; i < w - 1; i++) {
      const idx = j * w + i;
      const tl = y[idx - w - 1], t = y[idx - w], tr = y[idx - w + 1];
      const l = y[idx - 1], r = y[idx + 1];
      const bl = y[idx + w - 1], b = y[idx + w], br = y[idx + w + 1];
      const gx = tr + 2 * r + br - (tl + 2 * l + bl);
      const gy = bl + 2 * b + br - (tl + 2 * t + tr);
      out[idx] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

/**
 * Variance of the Laplacian over a fixed native-resolution crop.
 *
 * Focus has to be measured *before* the downsampling that produces the work
 * canvas: a 12 MP photo is averaged far harder than a VGA one, so measuring on
 * the work canvas would make the same in-focus scene score sharp at VGA and
 * soft at 12 MP. Probing fixed-size crops at native resolution keeps the number
 * comparable across every camera.
 */
function nativeFocusVariance(data, width, height, { size = 224 } = {}) {
  const s = Math.min(size, width, height);
  // Several probes, taking the sharpest: a single centre crop can land wholly
  // inside one smooth region (a bowl, a shadowed patch) and read as a totally
  // blurred photo. Focus is a property of the frame, so one textured region is
  // enough to establish it.
  const probes = [
    [width * 0.5, height * 0.5],
    [width * 0.25, height * 0.3],
    [width * 0.75, height * 0.3],
    [width * 0.25, height * 0.72],
    [width * 0.75, height * 0.72],
  ];

  let best = 0;
  for (const [cx, cy] of probes) {
    const x0 = clamp(Math.round(cx - s / 2), 0, Math.max(0, width - s));
    const y0 = clamp(Math.round(cy - s / 2), 0, Math.max(0, height - s));
    const v = cropLapVariance(data, width, x0, y0, s);
    if (v > best) best = v;
  }
  return best;
}

function cropLapVariance(data, width, x0, y0, s) {
  const y = new Float32Array(s * s);
  for (let j = 0; j < s; j++) {
    for (let i = 0; i < s; i++) {
      const p = ((y0 + j) * width + (x0 + i)) * 4;
      y[j * s + i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }
  }

  let sum = 0;
  let sqSum = 0;
  let n = 0;
  for (let j = 1; j < s - 1; j++) {
    for (let i = 1; i < s - 1; i++) {
      const idx = j * s + i;
      const lap = 4 * y[idx] - y[idx - 1] - y[idx + 1] - y[idx - s] - y[idx + s];
      sum += lap;
      sqSum += lap * lap;
      n += 1;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sqSum / n - mean * mean;
}

/**
 * Downsample RGBA to a working grayscale canvas. Block averaging doubles as a
 * cheap denoiser, which keeps the blob statistics stable on phone-sized photos.
 */
function toWorkingCanvas(data, width, height) {
  const long = Math.max(width, height);
  const block = Math.max(1, Math.round(long / WORK_LONG_EDGE));
  const w = Math.max(8, Math.floor(width / block));
  const h = Math.max(8, Math.floor(height / block));
  const y = new Float32Array(w * h);
  const sat = new Float32Array(w * h);

  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let lum = 0;
      let chroma = 0;
      let n = 0;
      const x0 = i * block;
      const y0 = j * block;
      for (let sy = y0; sy < Math.min(y0 + block, height); sy += 1) {
        for (let sx = x0; sx < Math.min(x0 + block, width); sx += 1) {
          const p = (sy * width + sx) * 4;
          const r = data[p];
          const g = data[p + 1];
          const b = data[p + 2];
          lum += 0.299 * r + 0.587 * g + 0.114 * b;
          const mx = Math.max(r, g, b);
          const mn = Math.min(r, g, b);
          chroma += mx === 0 ? 0 : (mx - mn) / mx;
          n += 1;
        }
      }
      y[j * w + i] = n ? lum / n : 0;
      sat[j * w + i] = n ? chroma / n : 0;
    }
  }
  return { w, h, y, sat };
}

/** Largest 8-connected component of `mask`, or null when nothing is big enough. */
function largestComponent(mask, w, h, minArea) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let best = null;

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;

    let area = 0;
    let minX = w, maxX = -1, minY = h, maxY = -1;

    while (sp > 0) {
      const idx = stack[--sp];
      const x = idx % w;
      const yy = (idx - x) / w;
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (yy < minY) minY = yy;
      if (yy > maxY) maxY = yy;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = yy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nIdx = ny * w + nx;
          if (mask[nIdx] && !seen[nIdx]) {
            seen[nIdx] = 1;
            stack[sp++] = nIdx;
          }
        }
      }
    }

    if (area >= minArea && (!best || area > best.area)) {
      best = { area, minX, maxX, minY, maxY };
    }
  }
  return best;
}

/* --------------------------------------------------------------- detection -- */

/**
 * Score a decoded RGBA frame. Pure and synchronous so it can be unit-tested and
 * reused by any future pipeline (dashcam frames, batch jobs).
 *
 * @returns {{
 *   damage_class: string, confidence: number, bbox_area_ratio: number,
 *   class_scores: Record<string, number>,
 *   features: Record<string, number>
 * }}
 */
export function analyzePixels(data, width, height) {
  const { w, h, y, sat } = toWorkingCanvas(data, width, height);
  const total = w * h;
  // Two background scales: a tight one finds rims and small defects, a coarse
  // one still sees the interior of a defect that fills much of the frame (with
  // a tight window alone a big pothole's middle matches its own local mean and
  // vanishes).
  const radiusNear = clamp(Math.round(Math.min(w, h) / 16), 3, 14);
  const radiusFar = clamp(Math.round(Math.min(w, h) / 3), 6, 60);

  const meanNear = boxBlur(y, w, h, radiusNear);
  const meanFar = boxBlur(y, w, h, radiusFar);
  const grad = gradientMagnitude(y, w, h);

  let imgEdgeSum = 0;
  for (let i = 0; i < total; i++) imgEdgeSum += grad[i];
  const imgEdge = imgEdgeSum / total;

  /* Frame-level context: is this even a road? Pavement is grey and matte, so a
     frame dominated by saturated colour (sky, foliage, indoors) scores low. */
  let roadPixels = 0;
  for (let i = 0; i < total; i++) {
    if (sat[i] < 0.38 && y[i] >= 10 && y[i] <= 205) roadPixels += 1;
  }
  const roadness = roadPixels / total;

  /* Focus: variance of the Laplacian at native resolution. Motion-blurred or
     out-of-focus frames have almost no high-frequency energy, and must not be
     trusted. Measured on the source pixels so the score does not depend on how
     much this frame happened to be downsampled. */
  const lapVar = nativeFocusVariance(data, width, height);

  /* Dark-blob extraction: a pothole is markedly darker than the pavement
     immediately around it, not merely dark in absolute terms (which is just a
     shaded frame). */
  const mask = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const bg = Math.max(meanNear[i], meanFar[i]);
    const residual = Math.max(meanNear[i] - y[i], meanFar[i] - y[i]);
    if (residual > Math.max(7, 0.18 * bg) && y[i] < 0.93 * bg) mask[i] = 1;
  }

  const region = largestComponent(mask, w, h, Math.max(12, Math.round(MIN_REGION_FRACTION * total)));

  const features = {
    roadness,
    sharpness: clamp01((lapVar - 8) / 70),
    lap_var: lapVar,
    interior_edge: 0,
    rim_edge: 0,
    rim_in_ratio: 0,
    interiority: 1,
    coverage: region ? region.area / total : 0,
    fill: 0,
    aspect: 0,
    contrast: 0,
    weblike: 0,
    linearity: 0,
  };

  /* Component scores, all 0–1. `blob` gates every non-linear class: without a
     region there is no defect, and no amount of good context may conjure one. */
  let blob = 0;
  let patch = 0;
  let depth = 0;
  let rim = 0;

  if (region) {
    const bw = region.maxX - region.minX + 1;
    const bh = region.maxY - region.minY + 1;
    features.fill = clamp01(region.area / (bw * bh));
    features.aspect = clamp(Math.max(bw, bh) / Math.max(1, Math.min(bw, bh)), 1, 20);
    features.coverage = region.area / total;

    /* The sky/grass horizon, a shadowed wall corner or a dark frame edge all
       produce a big dark component, but they are *scene structure*: they run to
       the frame boundary. Real pavement damage sits inside the frame. */
    const touches =
      (region.minX <= 1 ? 1 : 0) +
      (region.maxX >= w - 2 ? 1 : 0) +
      (region.minY <= 1 ? 1 : 0) +
      (region.maxY >= h - 2 ? 1 : 0);
    features.interiority = touches <= 1 ? 1 : touches === 2 ? 0.45 : 0.15;

    /* Rim vs interior edge energy. A bowl has a defined rim and a quiet inside;
       a fatigue-crack web is edge-dense all over; a thin crack is edge-dense
       and thin. */
    let rimSum = 0;
    let rimN = 0;
    let inSum = 0;
    let inN = 0;
    for (let j = Math.max(1, region.minY - 1); j <= Math.min(h - 2, region.maxY + 1); j++) {
      for (let i = Math.max(1, region.minX - 1); i <= Math.min(w - 2, region.maxX + 1); i++) {
        const idx = j * w + i;
        if (!mask[idx]) continue;
        const isRim =
          !mask[idx - 1] || !mask[idx + 1] || !mask[idx - w] || !mask[idx + w];
        if (isRim) {
          rimSum += grad[idx];
          rimN += 1;
        } else {
          inSum += grad[idx];
          inN += 1;
        }
      }
    }
    const rimEdge = rimN ? rimSum / rimN : 0;
    const inEdge = inN ? inSum / inN : 0;
    features.rim_edge = rimEdge / Math.max(1e-3, imgEdge);
    features.interior_edge = inEdge / Math.max(1e-3, imgEdge);
    features.rim_in_ratio = inEdge / Math.max(1e-3, rimEdge);

    let residualSum = 0;
    for (let i = 0; i < total; i++) {
      if (mask[i]) residualSum += Math.max(meanNear[i] - y[i], meanFar[i] - y[i]);
    }
    features.contrast = residualSum / Math.max(1, region.area);

    // How defect-shaped the region is (big enough, filled enough, in-frame).
    const sizeScore = clamp01((features.coverage - 0.004) / 0.025);
    const fillScore = clamp01((features.fill - 0.3) / 0.4);
    // `patch` is the size-only gate: a fatigue-crack field is a large region
    // with a ragged outline, so requiring it to be a *filled* blob would reject
    // exactly the damage it is meant to find.
    patch = sizeScore * features.interiority;
    blob = (0.5 * sizeScore + 0.5 * fillScore) * features.interiority;

    depth = clamp01((features.contrast - 8) / 30);
    rim = clamp01((features.rim_edge - 1.05) / 1.0);

    // Edge-dense interior relative to the rim ⇒ fatigue-crack web.
    features.weblike =
      clamp01((features.rim_in_ratio - 0.55) / 0.45) * clamp01(features.coverage / 0.03);
    // Long and thin ⇒ longitudinal seam crack.
    features.linearity =
      features.coverage < 0.12 && features.aspect >= 2.4 && features.fill < 0.5
        ? clamp01((features.aspect - 2.4) / 3.6)
        : 0;
  }

  /* Frame context. Like every computer-vision stack, this needs a plausible
     substrate: damage on asphalt, in focus. Context multiplies the evidence
     rather than adding to it, so a sharp pavement-free frame or a clean but
     blurry frame cannot score on context alone. */
  const context = clamp01((roadness - 0.15) / 0.5);
  const focus = features.sharpness;
  const contextFactor = (0.15 + 0.85 * context) * (0.4 + 0.6 * focus);

  const class_scores = {
    // A bowl: a compact dark blob, strong contrast, a defined rim, quiet inside.
    pothole: clamp01(blob * (0.55 + 0.25 * depth + 0.2 * rim) * (1 - 0.7 * features.weblike)),
    // Fatigue cracking: a broad patch laced with interior crack edges.
    alligator_crack: clamp01(patch * (0.25 + 0.75 * features.weblike) * (0.6 + 0.4 * depth)),
    // A seam crack is defined by its shape, so it does not need the blob gate.
    longitudinal_crack: clamp01(features.linearity * (0.5 + 0.3 * depth + 0.2 * rim)),
  };
  for (const cls of DAMAGE_CLASSES) class_scores[cls] = clamp01(class_scores[cls] * contextFactor);

  const ranked = DAMAGE_CLASSES
    .map((cls) => ({ cls, score: class_scores[cls] ?? 0 }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const runnerUp = ranked[1] || { score: 0 };

  /* Calibration: no evidence at all lands below the 0.60 gate, a strong and
     unambiguous signature clears the 0.85 auto-verify line, and weakly-defined
     damage sits in between as Pending. The class margin trims a few points when
     the runner-up class is nearly as plausible. */
  const margin = clamp01((best.score - runnerUp.score) / 0.25);
  const confidence = best.score > 0
    ? clamp(0.4 + 0.6 * best.score * (0.9 + 0.1 * margin), 0, 0.99)
    : clamp(0.24 + 0.1 * context + 0.05 * focus, 0, 0.45);

  /* Bounding-box area ratio drives PRD 4.2 severity, so it must reflect the
     measured defect box — not a constant. */
  let bbox_area_ratio = 0.25;
  if (region) {
    const bw = (region.maxX - region.minX + 1) / w;
    const bh = (region.maxY - region.minY + 1) / h;
    bbox_area_ratio = Number(clamp(bw * bh, 0.02, 0.6).toFixed(4));
  }

  return {
    damage_class: best.score > 0 ? best.cls : 'pothole',
    confidence: Number(confidence.toFixed(4)),
    bbox_area_ratio,
    class_scores: Object.fromEntries(
      Object.entries(class_scores).map(([k, v]) => [k, Number(v.toFixed(4))])
    ),
    features: Object.fromEntries(
      Object.entries(features).map(([k, v]) => [k, Number(v.toFixed(4))])
    ),
  };
}

/* -------------------------------------------------------------- file entry -- */

/**
 * Analyze an uploaded file from disk.
 *
 * Never throws: formats we cannot decode (video, WebP, HEIC) come back with
 * `decoded: false` and a deliberately unremarkable confidence, so the report is
 * held for an officer instead of being auto-verified on a guess.
 *
 * @param {string} filePath absolute path to the saved upload
 * @param {{ mimetype?: string, size?: number }} [meta]
 */
export async function analyzeUpload(filePath, { mimetype = '', size = 0 } = {}) {
  let buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch {
    return undecodable(mimetype, size, 'unreadable');
  }

  const decoded = decodeImage(buffer, mimetype);
  if (!decoded) return undecodable(mimetype, size, 'unsupported-format');

  const result = analyzePixels(decoded.data, decoded.width, decoded.height);
  return {
    ...result,
    decoded: true,
    detector: DETECTOR_ID,
    image: { width: decoded.width, height: decoded.height },
  };
}

/** Honest fallback for frames we could not look inside. */
function undecodable(mimetype, size, reason) {
  return {
    damage_class: 'pothole',
    confidence: 0.62,
    bbox_area_ratio: 0.2,
    class_scores: { pothole: 0.3, alligator_crack: 0.3, longitudinal_crack: 0.3 },
    features: {},
    decoded: false,
    detector: FALLBACK_DETECTOR_ID,
    fallback_reason: reason,
    image: { mimetype, sizeBytes: size },
  };
}

/**
 * Confidence for a defect class the reporter asserted by hand. The label is
 * trusted — the floor keeps a human-claimed report in the queue as Pending
 * rather than discarding it — while the pixels decide whether it auto-verifies.
 */
export function manualLabelConfidence(classScores, claimedClass) {
  const evidence = clamp01(classScores?.[claimedClass] ?? 0);
  return Number(clamp(0.5 + 0.5 * evidence, CONFIDENCE_GATE + 0.02, 0.97).toFixed(4));
}

export { AUTO_VERIFY_CONFIDENCE, CONFIDENCE_GATE };
