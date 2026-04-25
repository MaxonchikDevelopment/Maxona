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

  const plannedLabel = `${fmtMin(summary.plannedDurationMin)}${
    summary.plannedDistanceKm ? ` · ~${fmtDist(summary.plannedDistanceKm)}` : ""
  }`;

  const actualParts = [
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
    <div className="rounded bg-gray-50 px-2 py-1.5 space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        Execution
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
        <div>
          <span className="text-[10px] text-gray-400">Plan </span>
          <span className="font-medium text-gray-700">{plannedLabel}</span>
        </div>
        <div>
          <span className="text-[10px] text-gray-400">Actual </span>
          <span className="font-medium text-gray-700">{actualParts}</span>
        </div>
      </div>
      {secondaryParts && (
        <p className="text-[10px] text-gray-400">{secondaryParts}</p>
      )}
      <div className="flex flex-wrap items-center gap-1 text-[10px]">
        <span className={`font-medium ${QUALITY_COLOR[summary.qualityLabel]}`}>
          {summary.qualityLabel}
        </span>
        {summary.splitSession && (
          <>
            <span className="text-gray-300">·</span>
            <span className="text-gray-400">Split session</span>
          </>
        )}
        {summary.hillsIndicator && summary.qualityLabel !== "Hilly variant" && (
          <>
            <span className="text-gray-300">·</span>
            <span className="text-gray-400">Hills</span>
          </>
        )}
      </div>
    </div>
  );
}
