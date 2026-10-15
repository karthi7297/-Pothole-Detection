/**
 * Turning coordinates into a location **name**.
 *
 * A citizen report is only actionable when the field crew knows *where* it is —
 * "11.016840, 76.955890" means nothing to a repair gang, "Cross Cut Road,
 * Gandhipuram" does. This module resolves a place name two ways:
 *
 *   1. Mapbox reverse geocoding, when a token is configured — gives the real
 *      street / neighbourhood / locality name.
 *   2. The nearest road segment in our own network — always available, so a
 *      report never ends up nameless even offline or without an API key.
 *
 * The road-network fallback is not a placeholder: the segment's `street_name`
 * is the municipality's own authoritative name for that corridor.
 */
import { MAPBOX_TOKEN, GEOCODE_TIMEOUT_MS } from '../config.js';
import { query } from '../db.js';
import { nearestSegment } from './geo.js';

const MAX_SEGMENT_SNAP_M = 400;
const MAX_NAME_LEN = 140;

/** Trim, collapse whitespace and cap length. */
const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LEN);

/**
 * "Cross Cut Road, Gandhipuram" — the two most useful parts of a Mapbox feature.
 *
 * `place_name` is the full postal chain ("Cross Cut Road, Gandhipuram,
 * Coimbatore, Tamil Nadu 641012, India"), which is far too long for a report
 * row, so we take the feature itself plus the locality/district context.
 */
function shortPlaceName(feature) {
  const parts = [feature.text];
  const context = feature.context || [];
  const want = ['locality', 'district', 'place', 'neighborhood'];
  for (const kind of want) {
    const hit = context.find((c) => String(c.id || '').startsWith(kind));
    if (hit?.text) {
      parts.push(hit.text);
      break;
    }
  }
  return tidy(parts.filter(Boolean).join(', '));
}

/** Mapbox reverse geocode. Returns null on any failure — never throws. */
async function mapboxReverse(lat, lon) {
  if (!MAPBOX_TOKEN) return null;

  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json` +
    `?access_token=${encodeURIComponent(MAPBOX_TOKEN)}&limit=1&types=address,poi,place,locality,neighborhood`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEOCODE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const body = await res.json();
    const feature = body?.features?.[0];
    if (!feature) return null;
    return {
      name: shortPlaceName(feature) || tidy(feature.place_name),
      full: tidy(feature.place_name),
      category: tidy(feature.properties?.category || feature.place_type?.[0] || ''),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The nearest corridor in our own network, with how far away it is. */
export function nearestRoad(lat, lon) {
  const segments = query('SELECT * FROM road_segments');
  const near = nearestSegment({ lat, lon }, segments);
  if (!near) return null;
  const withinNetwork = near.distance <= MAX_SEGMENT_SNAP_M;
  return {
    street_name: near.segment.street_name,
    zone_name: near.segment.zone_name,
    road_type: near.segment.road_type,
    segment_id: near.segment.segment_id,
    distance_m: Math.round(near.distance),
    within_network: withinNetwork,
  };
}

/** "Cross Cut Road, Central Zone" — the road-network naming convention. */
export function composeRoadName(street, zone) {
  const s = tidy(street);
  const z = tidy(zone);
  if (!s || s === 'Unassigned') return z || 'Unassigned location';
  if (!z) return s;
  return tidy(`${s}, ${z}`);
}

/**
 * Resolve a location name for a coordinate pair.
 *
 * Always resolves to something usable. `source` tells the caller where the name
 * came from, so the UI can say "auto-detected" honestly.
 */
export async function reverseGeocode(lat, lon) {
  const road = nearestRoad(lat, lon);
  const fallbackName = composeRoadName(road?.street_name, road?.zone_name);

  const boxed = await mapboxReverse(lat, lon);

  // Prefer the real place name, but never let it hide the municipality's own
  // corridor name — both are useful, so we return them side by side.
  const name = boxed?.name || fallbackName;

  return {
    name,
    source: boxed?.name ? 'mapbox' : 'road-network',
    full: boxed?.full || null,
    category: boxed?.category || null,
    street_name: road?.street_name || null,
    zone_name: road?.zone_name || null,
    road_type: road?.road_type || null,
    segment_id: road?.segment_id || null,
    distance_m: road?.distance_m ?? null,
    within_network: road?.within_network ?? false,
    latitude: lat,
    longitude: lon,
  };
}
