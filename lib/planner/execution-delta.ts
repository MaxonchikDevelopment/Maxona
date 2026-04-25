export type ExecutionQuality =
  | "matched"
  | "slightly_short"
  | "clearly_short"
  | "longer_than_planned"
  | "interrupted"
  | "hilly_variant";

export interface ExecutionDelta {
  quality: ExecutionQuality;
  durationDeltaMin: number;
  actualDistanceM: number | null;
  plannedDistanceM: number | null;
  elevationGainM: number;
  elevationPerKm: number | null;
  splitSession: boolean;
  pauseRatio: number;
}

interface ActivityData {
  movingTime: number;
  elapsedTime: number;
  distance: number;
  totalElevationGain: number;
}

function parsePlannedDistanceM(notes: string | null | undefined): number | null {
  if (!notes) return null;
  const match = notes.match(/\b(\d+(?:\.\d+)?)\s*km\b/i);
  if (!match) return null;
  return parseFloat(match[1]) * 1000;
}

export function deriveExecutionDelta(
  session: { durationMin: number; notes: string | null; intensity: string },
  activities: ActivityData[]
): ExecutionDelta | null {
  if (activities.length === 0) return null;

  const totalMovingTime = activities.reduce((s, a) => s + a.movingTime, 0);
  const totalElapsedTime = activities.reduce((s, a) => s + a.elapsedTime, 0);
  const totalDistance = activities.reduce((s, a) => s + a.distance, 0);
  const totalElevationGain = activities.reduce((s, a) => s + a.totalElevationGain, 0);
  const splitSession = activities.length > 1;

  const pauseTime = Math.max(0, totalElapsedTime - totalMovingTime);
  const pauseRatio = totalElapsedTime > 0 ? pauseTime / totalElapsedTime : 0;

  const plannedDistanceM = parsePlannedDistanceM(session.notes);
  const elevationPerKm = totalDistance > 0 ? totalElevationGain / (totalDistance / 1000) : null;

  const plannedDurationSec = session.durationMin * 60;
  const durationDeltaMin =
    plannedDurationSec > 0 ? Math.round((totalMovingTime - plannedDurationSec) / 60) : 0;

  // Prefer distance ratio when both are known; fall back to duration ratio
  const primaryRatio: number | null =
    plannedDistanceM != null && plannedDistanceM > 0 && totalDistance > 0
      ? totalDistance / plannedDistanceM
      : plannedDurationSec > 0 && totalMovingTime > 0
      ? totalMovingTime / plannedDurationSec
      : null;

  const isRun = (session.notes ?? "").toLowerCase().startsWith("running");

  // Classification — first match wins, order matters
  let quality: ExecutionQuality;
  if (splitSession || pauseRatio > 0.2) {
    quality = "interrupted";
  } else if (primaryRatio !== null && primaryRatio < 0.75) {
    quality = "clearly_short";
  } else if (primaryRatio !== null && primaryRatio < 0.9) {
    quality = "slightly_short";
  } else if (primaryRatio !== null && primaryRatio > 1.15) {
    quality = "longer_than_planned";
  } else if (isRun && elevationPerKm !== null && elevationPerKm >= 20) {
    quality = "hilly_variant";
  } else {
    quality = "matched";
  }

  return {
    quality,
    durationDeltaMin,
    actualDistanceM: totalDistance > 0 ? totalDistance : null,
    plannedDistanceM,
    elevationGainM: Math.round(totalElevationGain),
    elevationPerKm,
    splitSession,
    pauseRatio,
  };
}
