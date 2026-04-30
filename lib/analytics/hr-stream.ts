import { buildHrZones } from "@/lib/training/zones";
import type { TrainingProfileInput } from "@/lib/training/zones";

export type HrPoint = { tSec: number; minute: number; hr: number };

export type HrZoneStat = {
  zone: "Z1" | "Z2" | "Z3" | "Z4" | "Z5";
  label: string;
  minHr: number;
  maxHr: number;
  seconds: number;
  minutes: number;
  percent: number;
};

export type HrChartData = {
  points: HrPoint[];
  avgHr: number;
  peakHr: number;
  minHr: number;
  durationMin: number;
};

export type HrAnalytics = {
  chart: HrChartData;
  zones: HrZoneStat[] | null;
  insights: string[];
};

const ZONE_DEFS = [
  { zone: "Z1" as const, label: "Recovery" },
  { zone: "Z2" as const, label: "Easy" },
  { zone: "Z3" as const, label: "Moderate" },
  { zone: "Z4" as const, label: "Hard" },
  { zone: "Z5" as const, label: "Max" },
];

// Fallback when Karvonen data is incomplete but maxHr is available
function percentageZoneBounds(maxHr: number) {
  return [
    { min: 0, max: Math.round(maxHr * 0.6) },
    { min: Math.round(maxHr * 0.6) + 1, max: Math.round(maxHr * 0.7) },
    { min: Math.round(maxHr * 0.7) + 1, max: Math.round(maxHr * 0.8) },
    { min: Math.round(maxHr * 0.8) + 1, max: Math.round(maxHr * 0.9) },
    { min: Math.round(maxHr * 0.9) + 1, max: maxHr },
  ];
}

export function buildHrTimeSeries(time: number[], heartrate: number[]): HrPoint[] {
  const len = Math.min(time.length, heartrate.length);
  const points: HrPoint[] = [];
  for (let i = 0; i < len; i++) {
    const hr = heartrate[i];
    if (hr < 30 || hr > 250) continue;
    points.push({ tSec: time[i], minute: time[i] / 60, hr });
  }
  return points;
}

export function calculateHrZones(
  points: HrPoint[],
  profile: TrainingProfileInput | null
): HrZoneStat[] | null {
  if (points.length < 2 || !profile) return null;

  const built = buildHrZones(profile);
  let bounds: Array<{ min: number; max: number }> | null = null;

  if (built) {
    bounds = [built.z1, built.z2, built.z3, built.z4, built.z5];
  } else if (profile.maxHr) {
    bounds = percentageZoneBounds(profile.maxHr);
  }
  if (!bounds) return null;

  const secondsPerZone = [0, 0, 0, 0, 0];
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].tSec - points[i - 1].tSec;
    if (dt <= 0 || dt > 300) continue;
    const hr = (points[i].hr + points[i - 1].hr) / 2;
    let idx = bounds.findIndex((b) => hr >= b.min && hr <= b.max);
    if (idx === -1) idx = hr > bounds[4].max ? 4 : 0;
    secondsPerZone[idx] += dt;
  }

  const totalSec = secondsPerZone.reduce((s, v) => s + v, 0);
  if (totalSec === 0) return null;

  return ZONE_DEFS.map((def, i) => ({
    zone: def.zone,
    label: def.label,
    minHr: bounds![i].min,
    maxHr: bounds![i].max,
    seconds: Math.round(secondsPerZone[i]),
    minutes: Math.round(secondsPerZone[i] / 60),
    percent: Math.round((secondsPerZone[i] / totalSec) * 100),
  }));
}

function buildInsights(
  chart: HrChartData,
  zones: HrZoneStat[] | null,
  plannedIntensity: string
): string[] {
  if (chart.points.length < 10) return ["Short HR stream: interpret carefully."];

  const insights: string[] = [];
  insights.push(
    `Peak ${chart.peakHr} bpm · Avg ${chart.avgHr} bpm · ${chart.durationMin} min`
  );

  if (zones) {
    const mainZone = [...zones].sort((a, b) => b.seconds - a.seconds)[0];
    const z4z5Pct =
      (zones.find((z) => z.zone === "Z4")?.percent ?? 0) +
      (zones.find((z) => z.zone === "Z5")?.percent ?? 0);
    const z1z2Pct =
      (zones.find((z) => z.zone === "Z1")?.percent ?? 0) +
      (zones.find((z) => z.zone === "Z2")?.percent ?? 0);

    if (mainZone.zone === "Z1" || mainZone.zone === "Z2") {
      insights.push(`Mostly ${mainZone.zone} ${mainZone.label.toLowerCase()} (${mainZone.percent}%) — aerobic base work.`);
    } else if (mainZone.zone === "Z3") {
      insights.push(`Mostly Z3 moderate (${mainZone.percent}%) — solid aerobic effort.`);
    } else {
      insights.push(`High-intensity session: ${mainZone.zone} was dominant (${mainZone.percent}%).`);
    }

    if (plannedIntensity === "easy" && z4z5Pct > 25) {
      insights.push(`Planned easy but ${z4z5Pct}% Z4/Z5 — executed harder than intended.`);
    } else if (plannedIntensity === "hard" && z1z2Pct > 60) {
      insights.push(`Planned hard but ${z1z2Pct}% Z1/Z2 — execution was conservative.`);
    } else if (plannedIntensity === "moderate" && z4z5Pct < 10 && z1z2Pct > 50) {
      insights.push(`Good aerobic match for planned moderate intent.`);
    } else if (z4z5Pct > 0) {
      insights.push(`${z4z5Pct}% of time above threshold.`);
    }
  }

  return insights;
}

// Thin the series to at most maxPts points, evenly spaced
export function downsampleHr(points: HrPoint[], maxPts = 300): HrPoint[] {
  if (points.length <= maxPts) return points;
  const step = points.length / maxPts;
  return Array.from({ length: maxPts }, (_, i) => points[Math.round(i * step)]);
}

export function buildHrAnalytics(
  time: number[],
  heartrate: number[],
  profile: TrainingProfileInput | null,
  plannedIntensity: string
): HrAnalytics | null {
  const points = buildHrTimeSeries(time, heartrate);
  if (points.length < 5) return null;

  const hrs = points.map((p) => p.hr);
  const avgHr = Math.round(hrs.reduce((s, h) => s + h, 0) / hrs.length);
  const peakHr = Math.max(...hrs);
  const minHr = Math.min(...hrs);
  const durationMin = Math.round(
    (points[points.length - 1].tSec - points[0].tSec) / 60
  );

  const chart: HrChartData = {
    points: downsampleHr(points),
    avgHr,
    peakHr,
    minHr,
    durationMin,
  };

  const zones = calculateHrZones(points, profile);
  const insights = buildInsights(chart, zones, plannedIntensity);

  return { chart, zones, insights };
}
