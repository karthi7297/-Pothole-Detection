import path from 'node:path';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync(path.resolve(import.meta.dirname, 'tmp'), { recursive: true });
import { analyzeUpload, analyzePixels } from '../backend/src/services/vision.js';
const require = createRequire(path.resolve(import.meta.dirname, '../backend/package.json'));
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

function frame(W, H) {
  const data = new Uint8Array(W * H * 4);
  const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rnd = mulberry(5);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = 110 + 10 * Math.sin(x / 90) * Math.cos(y / 70) + (rnd() - 0.5) * 24;
    const p = (y * W + x) * 4; data[p] = v; data[p + 1] = v; data[p + 2] = v; data[p + 3] = 255;
  }
  const cx = Math.round(W / 2), cy = Math.round(H * 0.62), rx = Math.round(W * 0.16), ry = Math.round(H * 0.16);
  for (let y = Math.max(0, cy - ry - 8); y < Math.min(H, cy + ry + 8); y++) for (let x = Math.max(0, cx - rx - 8); x < Math.min(W, cx + rx + 8); x++) {
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2; if (d > 1.25) continue;
    const t = Math.min(1, Math.max(0, (1.25 - d) / 0.45)); const p = (y * W + x) * 4;
    data[p] = 110 - 44 * t; data[p + 1] = 110 - 44 * t; data[p + 2] = 110 - 44 * t;
  }
  return { data, W, H };
}

for (const [W, H] of [[640, 480], [1920, 1080], [3024, 4032]]) {
  const f = frame(W, H);
  const out = path.join(import.meta.dirname, 'tmp', `big-${W}x${H}.jpg`);
  writeFileSync(out, jpeg.encode({ data: Buffer.from(f.data), width: W, height: H }, 80).data);
  let t0 = performance.now();
  const r = await analyzeUpload(out, { mimetype: 'image/jpeg' });
  const ms = performance.now() - t0;
  t0 = performance.now();
  analyzePixels(f.data, W, H);
  const msPixels = performance.now() - t0;
  console.log(`${W}x${H}  ${ms.toFixed(0)}ms (decode+analyze)  ${msPixels.toFixed(0)}ms (pixel analysis only)  -> ${r.damage_class} ${r.confidence} bbox=${r.bbox_area_ratio}`);
}

console.log('\n--- features at 12MP ---');
console.log(JSON.stringify(await analyzeUpload(path.join(import.meta.dirname, 'tmp', 'big-3024x4032.jpg'), { mimetype: 'image/jpeg' }), null, 1));
console.log('--- features at VGA ---');
console.log(JSON.stringify(await analyzeUpload(path.join(import.meta.dirname, 'tmp', 'big-640x480.jpg'), { mimetype: 'image/jpeg' }), null, 1));
