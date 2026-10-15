/**
 * Transparent municipal cost model.
 *
 * Band-aid patching is cheap per intervention but repeats forever on a failing
 * sub-base; a one-off reconstruction is expensive but amortises. These figures
 * are the assumption set behind every ₹ number the dashboard shows.
 */
export const PATCH_CYCLE_COST_INR = 9_500;   // crew + cold-mix + traffic management per intervention
export const PATCHES_PER_YEAR_FACTOR = 2;    // chronic defects recur ~twice per year
export const RECONSTRUCTION_HORIZON_YEARS = 3;

export const RECONSTRUCTION_COST_INR = {
  Arterial: 85_000,
  Collector: 65_000,
  Residential: 45_000,
};

export function reconstructionCost(roadType) {
  return RECONSTRUCTION_COST_INR[roadType] ?? 65_000;
}

/** What the ward currently burns repeating patches on a defect, per year. */
export function annualPatchSpend(detectionCount) {
  return detectionCount * PATCHES_PER_YEAR_FACTOR * PATCH_CYCLE_COST_INR;
}

/** Money already wasted on repeated patching at this location. */
export function sunkPatchSpend(detectionCount) {
  return detectionCount * PATCH_CYCLE_COST_INR;
}

/** Annualised saving from switching a chronic defect to permanent reconstruction. */
export function annualisedSaving({ detectionCount, roadType }) {
  const patch = annualPatchSpend(detectionCount);
  const amortisedRebuild = reconstructionCost(roadType) / RECONSTRUCTION_HORIZON_YEARS;
  return Math.max(0, Math.round(patch - amortisedRebuild));
}

/** Raw material estimate for a work order (metric tons of cold-mix). */
export function asphaltTons(priorityScore) {
  return Math.round((Number(priorityScore) / 35) * 2.5 * 10 + 5) / 10;
}
