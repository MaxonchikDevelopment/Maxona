export type HrBand = { min: number; max: number };

export type ComputedZones = {
  easy: HrBand;
  tempo: HrBand;
  threshold: HrBand;
};

// %LTHR bands (threshold-anchored, not Karvonen %HRR — buildHrZones()'s method
// needs restingHr, which AthleteDossier does not have): easy 70-80%, tempo
// 80-90%, threshold/hard 90-100% of lactate threshold HR.
const EASY_PCT: HrBand = { min: 0.7, max: 0.8 };
const TEMPO_PCT: HrBand = { min: 0.8, max: 0.9 };
const THRESHOLD_PCT: HrBand = { min: 0.9, max: 1.0 };

export function computeZonesFromDossier(
  maxHr: number | null | undefined,
  lthrEstimate: number | null | undefined,
): ComputedZones | null {
  if (!maxHr || !lthrEstimate) return null;

  const band = (pct: HrBand): HrBand => ({
    min: Math.round(lthrEstimate * pct.min),
    max: Math.min(Math.round(lthrEstimate * pct.max), maxHr),
  });

  return {
    easy: band(EASY_PCT),
    tempo: band(TEMPO_PCT),
    threshold: band(THRESHOLD_PCT),
  };
}
