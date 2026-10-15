import { GRADES, TRAFFIC_MULTIPLIER } from '../config.js';

/**
 * PRD 4.2 — Dynamic Priority Level Scoring.
 *   score = (severity × trafficMultiplier) + (reportCount × 1.5) + monsoonBonus
 *   severity = bboxAreaRatio × confidence × 10
 *
 * Calibration note: `bbox_area_ratio` is the share of the frame the defect
 * occupies (0.12 = 12%). Multiplied by 10 it would stay below 2 for every
 * realistic defect, which makes the PRD's grading bands (10 / 22 / 35)
 * unreachable. We therefore scale the ratio to a 0–100 severity index so the
 * published bands behave as intended.
 */
export function severityOf({ bbox_area_ratio, confidence }) {
  return Number(bbox_area_ratio) * Number(confidence) * 100;
}

export function trafficMultiplier(roadType) {
  return TRAFFIC_MULTIPLIER[roadType] ?? 1.0;
}

export function priorityScore({ bbox_area_ratio, confidence, road_type, reportCount = 1, monsoon = false }) {
  const severity = severityOf({ bbox_area_ratio, confidence });
  const score = severity * trafficMultiplier(road_type) + reportCount * 1.5 + (monsoon ? 5 : 0);
  return Math.round(score * 10) / 10;
}

/** PRD 4.2 grading scale. */
export function gradeOf(score) {
  const s = Number(score) || 0;
  if (s <= GRADES.LOW) return 'LOW';
  if (s <= GRADES.MEDIUM) return 'MEDIUM';
  if (s <= GRADES.HIGH) return 'HIGH';
  return 'CRITICAL';
}

export const isCritical = (score) => gradeOf(score) === 'CRITICAL';

/** 0–100 confidence-weighted blend of raw priority scores for progress bars. */
export function priorityIndex(score) {
  return Math.max(0, Math.min(100, Math.round((Number(score) / 60) * 100)));
}
