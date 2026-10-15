import { CHRONIC_MIN_SAMPLES, CHRONIC_WINDOW_DAYS, DEDUP_RADIUS_M } from '../config.js';

/**
 * DBSCAN over haversine distance (PRD 4.4).
 * Pure JS implementation — no scikit-learn, no native build.
 *
 * @param {Array<{latitude:number, longitude:number}>} points
 * @param {{epsMeters?:number, minSamples?:number}} opts
 * @returns {{clusters: Array<number[]>, noise: number[]}}
 */
export function dbscan(points, { epsMeters = DEDUP_RADIUS_M, minSamples = CHRONIC_MIN_SAMPLES } = {}) {
  const n = points.length;
  const labels = new Array(n).fill(undefined); // undefined = unvisited, -1 = noise, >=0 = cluster
  const R = 6_371_008.8;
  const toRad = (d) => (d * Math.PI) / 180;

  const dist = (i, j) => {
    const a = points[i], b = points[j];
    const dLat = toRad(b.latitude - a.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };

  const neighbours = (i) => {
    const out = [];
    for (let j = 0; j < n; j++) if (i !== j && dist(i, j) <= epsMeters) out.push(j);
    return out;
  };

  let clusterId = -1;
  for (let i = 0; i < n; i++) {
    if (labels[i] !== undefined) continue;
    const seeds = neighbours(i);
    if (seeds.length + 1 < minSamples) {
      labels[i] = -1;
      continue;
    }
    clusterId += 1;
    labels[i] = clusterId;
    const queue = [...seeds];
    while (queue.length) {
      const j = queue.pop();
      if (labels[j] === -1) labels[j] = clusterId;
      if (labels[j] !== undefined) continue;
      labels[j] = clusterId;
      const more = neighbours(j);
      if (more.length + 1 >= minSamples) queue.push(...more);
    }
  }

  const clusters = [];
  for (let k = 0; k < clusterId + 1; k++) clusters.push([]);
  const noise = [];
  labels.forEach((label, idx) => (label === -1 ? noise.push(idx) : clusters[label].push(idx)));
  return { clusters, noise };
}

export const chronicWindowDays = CHRONIC_WINDOW_DAYS;

/** Centroid of a set of indexed detections. */
export function centroid(points) {
  const lat = points.reduce((a, p) => a + p.latitude, 0) / points.length;
  const lon = points.reduce((a, p) => a + p.longitude, 0) / points.length;
  return { lat, lon };
}

/** Most frequent damage class inside a cluster. */
export function dominantClass(points) {
  const tally = new Map();
  for (const p of points) tally.set(p.damage_class, (tally.get(p.damage_class) || 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'pothole';
}
