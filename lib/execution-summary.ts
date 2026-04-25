export type ActivityInput = {
  distance: number;
  movingTime: number;
  elapsedTime: number;
  totalElevationGain: number;
  averageSpeed: number;
  sportType: string;
};

export type ExecutionSummary = {
  plannedDurationMin: number;
  plannedDistanceKm: number | null;
  actualMovingMin: number;
  actualElapsedMin: number | null;
  actualDistanceKm: number | null;
  elevationGain: number | null;
  paceStr: string | null;
  speedKph: number | null;
  splitSession: boolean;
  interpretationLine: string;
};

function extractPlannedDistanceKm(notes: string | null): number | null {
  if (!notes) return null;
  const match = notes.match(/(\d+(?:\.\d+)?)\s*km/i);
  return match ? parseFloat(match[1]) : null;
}

function fmtPace(speedMs: number): string | null {
  if (speedMs <= 0) return null;
  const secPerKm = 1000 / speedMs;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

export function deriveExecutionSummary(
  session: { durationMin: number; notes: string | null },
  activities: ActivityInput[]
): ExecutionSummary | null {
  if (activities.length === 0) return null;

  const totalMovingSec = activities.reduce((s, a) => s + a.movingTime, 0);
  const totalElapsedSec = activities.reduce((s, a) => s + a.elapsedTime, 0);
  const totalDistanceM = activities.reduce((s, a) => s + a.distance, 0);
  const totalElevation = activities.reduce((s, a) => s + a.totalElevationGain, 0);

  const plannedDistanceKm = extractPlannedDistanceKm(session.notes);
  const actualMovingMin = Math.round(totalMovingSec / 60);
  const elapsedMin = Math.round(totalElapsedSec / 60);
  const gapMin = elapsedMin - actualMovingMin;
  const actualElapsedMin = gapMin >= 5 ? elapsedMin : null;
  const actualDistanceKm =
    totalDistanceM > 0 ? parseFloat((totalDistanceM / 1000).toFixed(1)) : null;
  const elevationGain = totalElevation >= 50 ? Math.round(totalElevation) : null;

  const sports = activities.map((a) => a.sportType);
  const isRunning = sports.some((s) => /run/i.test(s));
  const isCycling =
    !isRunning && sports.some((s) => /ride|cycling|cycle|bike/i.test(s));
  const avgSpeedMs =
    totalMovingSec > 0 ? totalDistanceM / totalMovingSec : 0;
  const paceStr = isRunning && actualDistanceKm ? fmtPace(avgSpeedMs) : null;
  const speedKph =
    isCycling && avgSpeedMs > 0
      ? Math.round(avgSpeedMs * 3.6 * 10) / 10
      : null;
  const splitSession = activities.length > 1;

  const durationDeltaMin = actualMovingMin - session.durationMin;
  const distanceRatio =
    plannedDistanceKm && actualDistanceKm
      ? (actualDistanceKm - plannedDistanceKm) / plannedDistanceKm
      : null;
  const elevPerKm =
    actualDistanceKm && actualDistanceKm > 0
      ? totalElevation / actualDistanceKm
      : null;

  let interpretationLine: string;

  if (splitSession) {
    const uniqueSports = [...new Set(sports)];
    const sportStr = uniqueSports.slice(0, 2).join(" + ");
    interpretationLine = `${sportStr} captured as split session`;
  } else if (
    distanceRatio !== null &&
    Math.abs(distanceRatio) < 0.05 &&
    Math.abs(durationDeltaMin) <= 5
  ) {
    interpretationLine = "Matched plan closely";
  } else if (
    distanceRatio !== null &&
    distanceRatio < -0.1 &&
    elevPerKm !== null &&
    elevPerKm >= 20
  ) {
    interpretationLine = "Good hill stimulus despite shorter distance";
  } else if (distanceRatio !== null && distanceRatio < -0.1) {
    interpretationLine = "Slightly shorter than planned, but solid effort";
  } else if (distanceRatio !== null && distanceRatio > 0.1) {
    interpretationLine = "Exceeded planned distance";
  } else if (Math.abs(durationDeltaMin) <= 5) {
    interpretationLine = "Matched planned duration closely";
  } else if (durationDeltaMin < -10 && gapMin >= 10) {
    interpretationLine = "More fragmented than planned — pace continuity less clean";
  } else if (durationDeltaMin < -10) {
    interpretationLine = "Slightly shorter than planned";
  } else if (durationDeltaMin > 10) {
    interpretationLine = "Went longer than planned";
  } else if (elevPerKm !== null && elevPerKm >= 20 && totalElevation >= 100) {
    interpretationLine = "Good hill stimulus";
  } else {
    interpretationLine = "Execution matched plan";
  }

  return {
    plannedDurationMin: session.durationMin,
    plannedDistanceKm,
    actualMovingMin,
    actualElapsedMin,
    actualDistanceKm,
    elevationGain,
    paceStr,
    speedKph,
    splitSession,
    interpretationLine,
  };
}
