export type HrZoneRange = { min: number; max: number };

export type HrZones = {
  z1: HrZoneRange; // recovery
  z2: HrZoneRange; // easy aerobic
  z3: HrZoneRange; // tempo
  z4: HrZoneRange; // threshold
  z5: HrZoneRange; // VO2max
};

export type TrainingProfileInput = {
  restingHr?: number | null;
  maxHr?: number | null;
  easyHrMin?: number | null;
  easyHrMax?: number | null;
  tempoHrMin?: number | null;
  tempoHrMax?: number | null;
  thresholdHr?: number | null;
  zoneMethod?: string | null;
};

// Karvonen formula: targetHR = restingHR + HRR × percentage
function karvonen(resting: number, max: number, pct: number): number {
  return Math.round(resting + (max - resting) * pct);
}

export function buildHrZones(profile: TrainingProfileInput): HrZones | null {
  const { restingHr, maxHr, easyHrMin, easyHrMax, tempoHrMin, tempoHrMax, thresholdHr } = profile;

  // If user provided manual zone boundaries, trust them
  if (easyHrMin && easyHrMax && tempoHrMin && tempoHrMax && thresholdHr) {
    return {
      z1: { min: 0, max: easyHrMin - 1 },
      z2: { min: easyHrMin, max: easyHrMax },
      z3: { min: tempoHrMin, max: tempoHrMax },
      z4: { min: thresholdHr, max: thresholdHr + 15 },
      z5: { min: thresholdHr + 16, max: maxHr ?? thresholdHr + 30 },
    };
  }

  // Need at least restingHr + maxHr for Karvonen
  if (!restingHr || !maxHr) return null;

  return {
    z1: { min: karvonen(restingHr, maxHr, 0.5), max: karvonen(restingHr, maxHr, 0.6) },
    z2: { min: karvonen(restingHr, maxHr, 0.6), max: karvonen(restingHr, maxHr, 0.7) },
    z3: { min: karvonen(restingHr, maxHr, 0.7), max: karvonen(restingHr, maxHr, 0.8) },
    z4: { min: karvonen(restingHr, maxHr, 0.8), max: karvonen(restingHr, maxHr, 0.9) },
    z5: { min: karvonen(restingHr, maxHr, 0.9), max: maxHr },
  };
}

export function formatZoneLabel(zones: HrZones, zoneName: "z1" | "z2" | "z3" | "z4" | "z5"): string {
  const z = zones[zoneName];
  return `${z.min}–${z.max} bpm`;
}

export function zoneDescription(profile: TrainingProfileInput): string {
  if (!profile.restingHr && !profile.maxHr && !profile.easyHrMin) {
    return "easy conversational effort";
  }
  const zones = buildHrZones(profile);
  if (!zones) return "easy conversational effort";

  const z1 = zones.z1;
  const z2 = zones.z2;
  return `Zone 1–2 (${z1.min}–${z2.max} bpm)`;
}
