export type ActivityInput = {
  distance: number;
  movingTime: number;
  elapsedTime: number;
  totalElevationGain: number;
  averageSpeed: number;
  sportType: string;
  averageHeartrate?: number | null;
  maxHeartrate?: number | null;
};

export type ExecutionQualityLabel =
  | "Matched"
  | "Slightly short"
  | "Clearly short"
  | "Longer than planned"
  | "Interrupted"
  | "Hilly variant";

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
  hillsIndicator: boolean;
  qualityLabel: ExecutionQualityLabel;
  avgHR: number | null;
  maxHR: number | null;
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
  const isCycling = !isRunning && sports.some((s) => /ride|cycling|cycle|bike/i.test(s));
  const avgSpeedMs = totalMovingSec > 0 ? totalDistanceM / totalMovingSec : 0;
  const paceStr = isRunning && actualDistanceKm ? fmtPace(avgSpeedMs) : null;
  const speedKph =
    isCycling && avgSpeedMs > 0 ? Math.round(avgSpeedMs * 3.6 * 10) / 10 : null;
  const splitSession = activities.length > 1;

  // HR with reliability filter (50–220) — same bounds used in checkin route
  const reliableAvgHRs = activities
    .map((a) => a.averageHeartrate)
    .filter((h): h is number => h != null && h >= 50 && h <= 220);
  const reliableMaxHRs = activities
    .map((a) => a.maxHeartrate)
    .filter((h): h is number => h != null && h >= 50 && h <= 220);
  const avgHR =
    reliableAvgHRs.length > 0
      ? Math.round(reliableAvgHRs.reduce((s, h) => s + h, 0) / reliableAvgHRs.length)
      : null;
  const maxHR = reliableMaxHRs.length > 0 ? Math.max(...reliableMaxHRs) : null;

  // Execution quality — mirrors classification logic in lib/planner/execution-delta.ts
  const pauseRatio =
    totalElapsedSec > 0 ? (totalElapsedSec - totalMovingSec) / totalElapsedSec : 0;
  const plannedDurationSec = session.durationMin * 60;
  const plannedDistanceM = plannedDistanceKm ? plannedDistanceKm * 1000 : null;
  const elevPerKmRaw =
    totalDistanceM > 0 ? totalElevation / (totalDistanceM / 1000) : null;

  const primaryRatio: number | null =
    plannedDistanceM != null && plannedDistanceM > 0 && totalDistanceM > 0
      ? totalDistanceM / plannedDistanceM
      : plannedDurationSec > 0 && totalMovingSec > 0
      ? totalMovingSec / plannedDurationSec
      : null;

  let qualityLabel: ExecutionQualityLabel;
  if (splitSession || pauseRatio > 0.2) {
    qualityLabel = "Interrupted";
  } else if (primaryRatio !== null && primaryRatio < 0.75) {
    qualityLabel = "Clearly short";
  } else if (primaryRatio !== null && primaryRatio < 0.9) {
    qualityLabel = "Slightly short";
  } else if (primaryRatio !== null && primaryRatio > 1.15) {
    qualityLabel = "Longer than planned";
  } else if (isRunning && elevPerKmRaw !== null && elevPerKmRaw >= 20) {
    qualityLabel = "Hilly variant";
  } else {
    qualityLabel = "Matched";
  }

  const hillsIndicator =
    elevPerKmRaw !== null && elevPerKmRaw >= 20 && totalElevation >= 100;

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
    hillsIndicator,
    qualityLabel,
    avgHR,
    maxHR,
  };
}
