/** Geographic helpers — haversine maths shared by clustering, dedup and assignment. */

const R = 6_371_008.8; // mean Earth radius in metres
const toRad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Perpendicular distance (metres) from a point to a segment, plus the projection ratio. */
export function distanceToSegmentMeters(p, a, b) {
  const latRef = toRad((a.lat + b.lat) / 2);
  const mx = (lon) => toRad(lon) * R * Math.cos(latRef);
  const my = (lat) => toRad(lat) * R;

  const px = mx(p.lon), py = my(p.lat);
  const ax = mx(a.lon), ay = my(a.lat);
  const bx = mx(b.lon), by = my(b.lat);

  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx, cy = ay + t * dy;
  return { distance: Math.hypot(px - cx, py - cy), t };
}

/** Nearest road segment to a point; null when the network is empty. */
export function nearestSegment(point, segments) {
  let best = null;
  for (const s of segments) {
    const { distance } = distanceToSegmentMeters(
      point,
      { lat: s.start_lat, lon: s.start_lon },
      { lat: s.end_lat, lon: s.end_lon }
    );
    if (!best || distance < best.distance) best = { segment: s, distance };
  }
  return best;
}

/** Simple deterministic jitter for the simulator. */
export const jitter = (spread) => (Math.random() - 0.5) * 2 * spread;
