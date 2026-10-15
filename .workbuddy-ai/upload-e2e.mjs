/**
 * End-to-end check of the citizen/field upload path against a running API.
 *
 *   node .workbuddy-ai/upload-e2e.mjs [baseUrl]
 *
 * Exercises both upload endpoints with the synthetic fixtures produced by
 * vision-check.mjs and asserts the verdict each report receives.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'http://localhost:8151';
const FIX = path.resolve(import.meta.dirname, 'vision-fixtures');

const login = async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Only the driver role holds `detections:ingest`; the executive is oversight-only.
    body: JSON.stringify({ email: 'driver@tnstc.in', password: 'roadpulse123' }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  return (await res.json()).token;
};

async function upload(file, { token, lat, lon, damageClass = 'auto', mime = 'image/jpeg' } = {}) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(path.join(FIX, file))], { type: mime }), file);
  form.append('latitude', String(lat));
  form.append('longitude', String(lon));
  form.append('location_mode', 'manual');
  form.append('damage_class', damageClass);
  const res = await fetch(`${BASE}/api/detections/${token ? 'upload' : 'upload-anonymous'}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const results = [];
function check(name, ok, detail) {
  results.push({ case: name, verdict: ok ? 'pass' : 'FAIL', detail });
}

const token = await login();

/* A — a clear pothole from a signed-in reporter must auto-verify. */
const a = await upload('pothole-clear.jpg', { token, lat: 11.0241, lon: 76.9623 });
check(
  'A clean pothole auto-verifies',
  a.status === 201 && a.body.status === 'Verified' && a.body.detection.confidence >= 0.85
    && a.body.detection.damage_class === 'pothole',
  `${a.status} ${a.body?.status} ${a.body?.detection?.damage_class} ${a.body?.detection?.confidence} bbox=${a.body?.detection?.bbox_area_ratio} detector=${a.body?.detection?.detector}`
);

/* B — the reported bug: real potholes no longer sit at a flat 82% / Pending. */
const conf = a.body?.detection?.confidence;
check(
  'B confidence is content-derived, not a constant',
  typeof conf === 'number' && conf > 0.85 && alligatorBboxDiffers(a.body?.detection?.bbox_area_ratio),
  `confidence=${conf} (stub was a flat 0.82), bbox=${a.body?.detection?.bbox_area_ratio} (stub was a flat 0.25)`
);
function alligatorBboxDiffers(v) {
  return typeof v === 'number' && v > 0 && v !== 0.25;
}

/* C — a wall is not road damage: held Pending for an officer, never verified. */
const c = await upload('concrete-wall.jpg', { lat: 11.0248, lon: 76.9631 });
check(
  'C non-road photo is held, never verified',
  c.status === 201 && c.body.status === 'Pending' && c.body.detection.confidence < 0.6
    && c.body.detection.below_gate === true,
  `${c.status} ${c.body?.status} conf=${c.body?.detection?.confidence} below_gate=${c.body?.detection?.below_gate}`
);

/* D — sky/grass scene, same expectation. */
const d = await upload('sky-and-grass.jpg', { lat: 11.0253, lon: 76.9638 });
check(
  'D saturated scene is held, never verified',
  d.status === 201 && d.body.status === 'Pending' && d.body.detection.confidence < 0.6,
  `${d.status} ${d.body?.status} conf=${d.body?.detection?.confidence}`
);

/* E — a small but genuine pothole still lands in the verification queue. */
const e = await upload('pothole-small.jpg', { token, lat: 11.0259, lon: 76.9645 });
check(
  'E small pothole is kept as Pending/Verified (not rejected)',
  e.status === 201 && e.body.detection.damage_class === 'pothole' && e.body.detection.confidence >= 0.6,
  `${e.status} ${e.body?.status} ${e.body?.detection?.damage_class} ${e.body?.detection?.confidence}`
);

/* F — a manual "Pothole" label on a real pothole confirms to a high score. */
const f = await upload('pothole-clear.jpg', { token, lat: 11.0266, lon: 76.9652, damageClass: 'pothole' });
check(
  'F hand-labelled pothole is evidence-weighted, not flat 82%',
  f.status === 201 && f.body.detection.confidence >= 0.85,
  `${f.status} ${f.body?.status} conf=${f.body?.detection?.confidence} detector=${f.body?.detection?.detector}`
);

/* G — a manual label the pixels contradict stays Pending, never auto-verifies. */
const g = await upload('concrete-wall.jpg', { token, lat: 11.0271, lon: 76.9660, damageClass: 'pothole' });
check(
  'G contradicted manual label stays Pending',
  g.status === 201 && g.body.status === 'Pending' && g.body.detection.confidence < 0.85,
  `${g.status} ${g.body?.status} conf=${g.body?.detection?.confidence}`
);

/* H — a correct auto classification of fatigue cracking. */
const h = await upload('alligator-web.jpg', { token, lat: 11.0277, lon: 76.9667 });
check(
  'H fatigue cracking classified as alligator_crack',
  h.status === 201 && h.body.detection.damage_class === 'alligator_crack' && h.body.status !== 'Rejected',
  `${h.status} ${h.body?.status} ${h.body?.detection?.damage_class} ${h.body?.detection?.confidence}`
);

/* I — a format we cannot decode is honestly held at Pending. */
const i = await upload('uniform-grey.png', { lat: 11.0283, lon: 76.9674, mime: 'image/webp' });
check(
  'I undecodable frame falls back to Pending, not a guess',
  i.status === 201 && i.body.status === 'Pending' && i.body.detection.decoded === false
    && i.body.detection.detector === 'metadata-fallback',
  `${i.status} ${i.body?.status} decoded=${i.body?.detection?.decoded} detector=${i.body?.detection?.detector}`
);

console.table(results.map((r) => ({ case: r.case, verdict: r.verdict })));
for (const r of results) console.log(`${r.verdict === 'pass' ? '·' : '✗'} ${r.case}\n    ${r.detail}`);

const failed = results.filter((r) => r.verdict === 'FAIL').length;
console.log(failed ? `\n${failed} check(s) failed` : '\nall upload checks passed');
process.exit(failed ? 1 : 0);
