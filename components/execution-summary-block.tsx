"use client";
import { deriveExecutionSummary } from "@/lib/execution-summary";
import type { ExecutionQualityLabel } from "@/lib/execution-summary";
import type { StravaLinkProp } from "@/components/strava-panel";

function fmtMin(min: number): string {
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${min}m`;
}

function fmtDist(km: number): string {
  return `${km.toFixed(1)} km`;
}

const QUALITY_COLOR: Record<ExecutionQualityLabel, string> = {
  "Matched": "text-green-600",
  "Slightly short": "text-amber-600",
  "Clearly short": "text-red-500",
  "Longer than planned": "text-blue-600",
  "Interrupted": "text-amber-600",
  "Hilly variant": "text-gray-600",
};

function plannedSportBucket(notes: string | null): string | null {
  if (!notes) return null;
  const lower = notes.toLowerCase();
  if (lower.startsWith("running")) return "running";
  if (lower.startsWith("cycling")) return "cycling";
  if (lower.startsWith("swimming")) return "swimming";
  if (lower.startsWith("hyrox")) return "hyrox";
  return null;
}

function plannedSportDisplayLabel(notes: string | null): string | null {
  const bucket = plannedSportBucket(notes);
  if (bucket === "running") return "Running";
  if (bucket === "cycling") return "Cycling";
  if (bucket === "swimming") return "Swimming";
  if (bucket === "hyrox") return "HYROX";
  return null;
}

function normalizeSportType(st: string): string {
  const l = st.toLowerCase();
  if (l.includes("run")) return "Running";
  if (l.includes("ride") || l.includes("cycling") || l.includes("cycle") || l.includes("bike") || l.includes("ebike")) return "Cycling";
  if (l.includes("swim")) return "Swimming";
  if (l.includes("weight") || l.includes("crossfit") || l.includes("hyrox")) return "Strength";
  return st;
}

function derivedActualSportLabel(sportTypes: string[]): string | null {
  if (sportTypes.length === 0) return null;
  const unique = [...new Set(sportTypes.map(normalizeSportType))];
  return unique.join(" + ");
}

function actualDiffersFromPlanned(plannedBucket: string | null, sportTypes: string[]): boolean {
  if (!plannedBucket || sportTypes.length === 0) return false;
  return !sportTypes.some((st) => {
    const l = st.toLowerCase();
    if (plannedBucket === "running") return l.includes("run");
    if (plannedBucket === "cycling") return l.includes("ride") || l.includes("cycle") || l.includes("bike") || l.includes("ebike");
    if (plannedBucket === "swimming") return l.includes("swim");
    if (plannedBucket === "hyrox") return l.includes("weight") || l.includes("crossfit") || l.includes("hyrox");
    return false;
  });
}

export function ExecutionSummaryBlock({
  session,
  stravaLinks,
}: {
  session: { durationMin: number; notes: string | null };
  stravaLinks: StravaLinkProp[];
}) {
  const summary = deriveExecutionSummary(
    session,
    stravaLinks.map((l) => ({
      distance: l.activity.distance,
      movingTime: l.activity.movingTime,
      elapsedTime: l.activity.elapsedTime,
      totalElevationGain: l.activity.totalElevationGain,
      averageSpeed: l.activity.averageSpeed,
      sportType: l.activity.sportType,
      averageHeartrate: l.activity.averageHeartrate,
      maxHeartrate: l.activity.maxHeartrate,
    }))
  );
  if (!summary) return null;

  const actualSportTypes = stravaLinks.map((l) => l.activity.sportType);
  const plannedBucket = plannedSportBucket(session.notes);
  const sportLabel = derivedActualSportLabel(actualSportTypes);
  const showSport = !!sportLabel && actualDiffersFromPlanned(plannedBucket, actualSportTypes);

  const plannedSportLabel = showSport ? plannedSportDisplayLabel(session.notes) : null;
  const plannedLabel = [
    plannedSportLabel,
    fmtMin(summary.plannedDurationMin),
    summary.plannedDistanceKm ? `~${fmtDist(summary.plannedDistanceKm)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const actualParts = [
    showSport ? sportLabel : null,
    `${fmtMin(summary.actualMovingMin)} moving`,
    summary.actualDistanceKm ? fmtDist(summary.actualDistanceKm) : null,
    summary.paceStr,
    summary.speedKph ? `${summary.speedKph} km/h` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const secondaryParts = [
    summary.actualElapsedMin ? `${fmtMin(summary.actualElapsedMin)} elapsed` : null,
    summary.elevationGain ? `${summary.elevationGain}m elev` : null,
    summary.avgHR ? `HR avg ${summary.avgHR}` : null,
    summary.maxHR ? `HR max ${summary.maxHR}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2 space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
        Execution
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
        <div>
          <span className="text-[10px] text-zinc-400">Plan </span>
          <span className="font-medium text-zinc-700">{plannedLabel}</span>
        </div>
        <div>
          <span className="text-[10px] text-zinc-400">Actual </span>
          <span className={`font-medium ${showSport ? "text-indigo-700" : "text-zinc-700"}`}>
            {actualParts}
          </span>
        </div>
      </div>
      {secondaryParts && (
        <p className="text-[10px] text-zinc-400">{secondaryParts}</p>
      )}
      <div className="flex flex-wrap items-center gap-1 text-[10px]">
        <span className={`font-medium ${QUALITY_COLOR[summary.qualityLabel]}`}>
          {summary.qualityLabel}
        </span>
        {summary.splitSession && (
          <>
            <span className="text-zinc-300">·</span>
            <span className="text-zinc-400">Split session</span>
          </>
        )}
        {summary.hillsIndicator && summary.qualityLabel !== "Hilly variant" && (
          <>
            <span className="text-zinc-300">·</span>
            <span className="text-zinc-400">Hills</span>
          </>
        )}
      </div>
    </div>
  );
}
