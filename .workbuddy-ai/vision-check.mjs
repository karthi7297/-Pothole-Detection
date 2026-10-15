/**
 * Calibration / regression harness for backend/src/services/vision.js
 *
 *   node .workbuddy-ai/vision-check.mjs
 *
 * Generates deterministic synthetic frames with known ground truth (asphalt
 * with a pothole, a fatigue-crack web, a longitudinal seam crack, plus negative
 * cases: bare wall, sky+grass, uniform grey, motion-blurred) and prints what the
 * detector concludes. Exits non-zero if a case lands on the wrong side of the
 * PRD confidence gate (0.60) or the auto-verify line (0.85).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { analyzeUpload, analyzePixels } from '../backend/src/services/vision.js';

// This harness lives outside backend/, so resolve the encoders from its deps.
const require = createRequire(path.resolve(import.meta.dirname, '../backend/package.json'));
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const OUT = path.resolve(import.meta.dirname, 'vision-fixtures');
mkdirSync(OUT, { recursive: true });

const W = 640;
const H = 480;

const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function canvas() {
  return { w: W, h: H, data: new Uint8Array(W * H * 4) };
}
function put(img, x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const p = (y * img.w + x) * 4;
  img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; img.data[p + 3] = 255;
}

/** Grainy grey asphalt base. */
function asphalt(img, rnd, base = 112) {
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      // low-frequency patchiness + per-pixel aggregate grain
      const low = 10 * Math.sin(x / 70) * Math.cos(y / 55);
      const v = Math.max(0, Math.min(255, base + low + (rnd() - 0.5) * 26));
      put(img, x, y, v, v * 0.99, v * 0.97);
    }
  }
  return img;
}

/** 5x5 box blur — used both for realistic rims and for the blur negative case. */
function blur(img, passes) {
  const src0 = Uint8Array.from(img.data);
  const src = { ...img, data: src0 };
  const dst = Uint8Array.from(img.data);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < img.h; y++) {
      for (let x = 0; x < img.w; x++) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const sx = x + dx, sy = y + dy;
            if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) continue;
            const q = (sy * img.w + sx) * 4;
            r += src.data[q]; g += src.data[q + 1]; b += src.data[q + 2]; n++;
          }
        }
        const q = (y * img.w + x) * 4;
        dst[q] = r / n; dst[q + 1] = g / n; dst[q + 2] = b / n;
      }
    }
    src.data = Uint8Array.from(dst);
  }
  img.data = dst;
  return img;
}

function pothole(img, rnd, cxIn, cyIn, rxIn, ryIn) {
  // Integer geometry: fractional coordinates make the typed-array write a
  // no-op, which would silently leave a blank frame.
  const cx = Math.round(cxIn), cy = Math.round(cyIn);
  const rx = Math.round(rxIn), ry = Math.round(ryIn);
  for (let y = Math.max(0, cy - ry - 6); y < Math.min(img.h, cy + ry + 6); y++) {
    for (let x = Math.max(0, cx - rx - 6); x < Math.min(img.w, cx + rx + 6); x++) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d > 1.25) continue;
      const t = Math.min(1, Math.max(0, (1.25 - d) / 0.45)); // soft rim
      const depth = 42 + (rnd() - 0.5) * 16;
      const p = (y * img.w + x) * 4;
      img.data[p] = 112 - depth * t;
      img.data[p + 1] = 108 - depth * t;
      img.data[p + 2] = 104 - depth * t;
    }
  }
  return img;
}

/** Fatigue cracking: broad dark region densely laced with thin cracks. */
function alligator(img, rnd) {
  const x0 = W * 0.1, x1 = W * 0.9, y0 = H * 0.35, y1 = H * 0.95;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = (y * img.w + x) * 4;
      img.data[p] -= 22; img.data[p + 1] -= 22; img.data[p + 2] -= 22;
    }
  }
  for (let i = 0; i < 260; i++) {
    let x = x0 + rnd() * (x1 - x0);
    let y = y0 + rnd() * (y1 - y0);
    const steps = 18 + Math.floor(rnd() * 30);
    let ang = rnd() * Math.PI * 2;
    for (let s = 0; s < steps; s++) {
      ang += (rnd() - 0.5) * 1.9;
      x += Math.cos(ang) * 2; y += Math.sin(ang) * 2;
      put(img, Math.round(x), Math.round(y), 26, 24, 22);
      put(img, Math.round(x) + 1, Math.round(y), 30, 28, 26);
    }
  }
  return img;
}

/** Single long thin seam crack. */
function longitudinal(img, rnd) {
  let x = W * 0.5;
  for (let y = H * 0.1; y < H * 0.95; y++) {
    x += (rnd() - 0.5) * 1.4;
    for (let d = 0; d < 4; d++) put(img, Math.round(x) + d, Math.round(y), 32, 30, 28);
  }
  return img;
}

function wall(img, rnd) {
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const v = 214 + (rnd() - 0.5) * 14;
      put(img, x, y, v, v, v * 0.985);
    }
  }
  return img;
}

function skyGrass(img, rnd) {
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (y < img.h * 0.45) put(img, x, y, 118 + rnd() * 24, 165 + rnd() * 24, 228 + rnd() * 16);
      else put(img, x, y, 58 + rnd() * 26, 108 + rnd() * 30, 48 + rnd() * 20);
    }
  }
  return img;
}

function uniform(img) {
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) put(img, x, y, 128, 128, 128);
  return img;
}

/* ------------------------------------------------------------------ cases -- */

const build = {
  'pothole-clear': (g) => pothole(asphalt(g, mulberry32(7)), mulberry32(11), W * 0.5, H * 0.62, W * 0.17, H * 0.17),
  'pothole-offcentre': (g) => pothole(asphalt(g, mulberry32(21), 124), mulberry32(22), W * 0.26, H * 0.74, W * 0.13, H * 0.13),
  'pothole-small': (g) => pothole(asphalt(g, mulberry32(31)), mulberry32(32), W * 0.55, H * 0.66, W * 0.075, H * 0.06),
  'pothole-blurred': (g) => blur(pothole(asphalt(g, mulberry32(41)), mulberry32(42), W * 0.5, H * 0.62, W * 0.17, H * 0.17), 4),
  'alligator-web': (g) => alligator(asphalt(g, mulberry32(51), 118), mulberry32(52)),
  'longitudinal-seam': (g) => longitudinal(asphalt(g, mulberry32(61)), mulberry32(62)),
  'concrete-wall': (g) => wall(g, mulberry32(71)),
  'sky-and-grass': (g) => skyGrass(g, mulberry32(81)),
  'uniform-grey': (g) => uniform(g),
};

const EXPECT = {
  'pothole-clear': { min: 0.85, cls: 'pothole' },
  'pothole-offcentre': { min: 0.85, cls: 'pothole' },
  'pothole-small': { min: 0.60, cls: 'pothole' },
  'pothole-blurred': { max: 0.85, cls: 'pothole' },
  'alligator-web': { min: 0.60, cls: 'alligator_crack' },
  'longitudinal-seam': { min: 0.60, cls: 'longitudinal_crack' },
  'concrete-wall': { max: 0.60 },
  'sky-and-grass': { max: 0.60 },
  'uniform-grey': { max: 0.60 },
};

const tier = (c) => (c >= 0.85 ? 'Verified' : c >= 0.6 ? 'Pending' : 'Rejected');

let failures = 0;
const rows = [];
for (const [name, fn] of Object.entries(build)) {
  const img = fn(canvas());
  const inline = analyzePixels(img.data, img.w, img.h);

  // also exercise the real file path (JPEG + PNG decode round-trip)
  const jpg = jpeg.encode({ data: Buffer.from(img.data), width: img.w, height: img.h }, 82);
  const jpgPath = path.join(OUT, `${name}.jpg`);
  writeFileSync(jpgPath, jpg.data);
  const viaFile = await analyzeUpload(jpgPath, { mimetype: 'image/jpeg' });

  const pngPath = path.join(OUT, `${name}.png`);
  writeFileSync(pngPath, PNG.sync.write({ width: img.w, height: img.h, data: Buffer.from(img.data) }));

  const exp = EXPECT[name];
  const problems = [];
  if (exp.min !== undefined && viaFile.confidence < exp.min) problems.push(`confidence ${viaFile.confidence} < ${exp.min}`);
  if (exp.max !== undefined && viaFile.confidence > exp.max) problems.push(`confidence ${viaFile.confidence} > ${exp.max}`);
  if (exp.cls && viaFile.damage_class !== exp.cls) problems.push(`class ${viaFile.damage_class} != ${exp.cls}`);
  if (problems.length) failures += 1;

  rows.push({
    case: name,
    class: viaFile.damage_class,
    confidence: viaFile.confidence,
    tier: tier(viaFile.confidence),
    bbox: viaFile.bbox_area_ratio,
    'p/a/l': `${viaFile.class_scores.pothole.toFixed(2)}/${viaFile.class_scores.alligator_crack.toFixed(2)}/${viaFile.class_scores.longitudinal_crack.toFixed(2)}`,
    'road/focus/fill': `${viaFile.features.roadness}/${viaFile.features.sharpness}/${viaFile.features.fill}`,
    'lapVar/rimIn/interior': `${viaFile.features.lap_var}/${viaFile.features.rim_in_ratio}/${viaFile.features.interiority}`,
    'jpeg Δ': (inline.confidence - viaFile.confidence).toFixed(3),
    verdict: problems.length ? `FAIL: ${problems.join('; ')}` : 'pass',
  });
}

console.table(rows);
console.log(failures ? `\n${failures} case(s) failed` : '\nall cases passed');
process.exit(failures ? 1 : 0);
