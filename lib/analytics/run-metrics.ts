import FitParser from "fit-file-parser";

export type SessionMetricsResult = {
  source: "fit_upload";
  movingTimeSec: number;
  elapsedTimeSec: number;
  pauses: { startIso: string; endIso: string; durationSec: number }[];
  distanceKm: number;
  avgHr: number | null;
  efWhole: number | null;
  efFirstHalf: number | null;
  efSecondHalf: number | null;
  decouplingPct: number | null;
  decouplingValid: boolean;
  zoneShare: { below140: number; z140to150: number; above150: number } | null;
  cadenceSpm: number | null;
  powerAvg: number | null;
};

type FitRecord = {
  timestamp: Date;
  distance?: number;
  heart_rate?: number;
  power?: number;
};

type FitEvent = {
  event_type: string;
  timestamp: Date;
};

type FitSession = {
  total_cycles?: number;
  total_timer_time?: number;
};

type Pause = { start: Date; end: Date };

const DECOUPLING_VALID_THRESHOLD_SEC = 5400;

function buildPauses(events: FitEvent[]): Pause[] {
  const pauses: Pause[] = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].event_type !== "stop") continue;
    const start = events.slice(i + 1).find((e) => e.event_type === "start");
    if (start) {
      pauses.push({ start: events[i].timestamp, end: start.timestamp });
    }
  }
  return pauses;
}

function movingTime(t1: Date, t2: Date, pauses: Pause[]): number {
  const elapsed = (t2.getTime() - t1.getTime()) / 1000;
  let overlap = 0;
  for (const p of pauses) {
    const start = Math.max(t1.getTime(), p.start.getTime());
    const end = Math.min(t2.getTime(), p.end.getTime());
    overlap += Math.max(0, (end - start) / 1000);
  }
  return elapsed - overlap;
}

function meanHeartRate(records: FitRecord[]): number | null {
  const hrs = records.filter((r) => r.heart_rate != null).map((r) => r.heart_rate as number);
  if (hrs.length === 0) return null;
  return hrs.reduce((sum, hr) => sum + hr, 0) / hrs.length;
}

function computeEf(records: FitRecord[], pauses: Pause[]): number | null {
  const meanHr = meanHeartRate(records);
  if (meanHr == null) return null;
  const first = records[0];
  const last = records[records.length - 1];
  const segmentMovingTime = movingTime(first.timestamp, last.timestamp, pauses);
  if (segmentMovingTime <= 0) return null;
  const distanceDelta = (last.distance as number) - (first.distance as number);
  return distanceDelta / segmentMovingTime / meanHr;
}

export function computeSessionMetrics(fitBuffer: Buffer): SessionMetricsResult {
  const parser = new FitParser({ mode: "list" });

  let data: {
    records?: FitRecord[];
    events?: FitEvent[];
    sessions?: FitSession[];
  } | undefined;

  parser.parse(fitBuffer as Parameters<typeof parser.parse>[0], (error, parsed) => {
    if (error) throw new Error(String(error));
    data = parsed as typeof data;
  });

  if (!data) throw new Error("FIT file produced no data");

  const records = (data.records ?? []).filter((r) => r.distance != null);
  const events = data.events ?? [];
  const fitSession = data.sessions?.[0];

  const pauses = buildPauses(events);

  const first = records[0];
  const last = records[records.length - 1];

  const elapsedTimeSec = (last.timestamp.getTime() - first.timestamp.getTime()) / 1000;
  const movingTimeSec = movingTime(first.timestamp, last.timestamp, pauses);
  const distanceKm = ((last.distance as number) - (first.distance as number)) / 1000;

  const avgHr = meanHeartRate(records);

  const efWhole = computeEf(records, pauses);

  const midDistance = ((first.distance as number) + (last.distance as number)) / 2;
  let splitIdx = 0;
  let bestDelta = Infinity;
  records.forEach((r, i) => {
    const delta = Math.abs((r.distance as number) - midDistance);
    if (delta < bestDelta) {
      bestDelta = delta;
      splitIdx = i;
    }
  });
  const firstHalf = records.slice(0, splitIdx + 1);
  const secondHalf = records.slice(splitIdx);
  const efFirstHalf = computeEf(firstHalf, pauses);
  const efSecondHalf = computeEf(secondHalf, pauses);

  const decouplingPct =
    efFirstHalf != null && efSecondHalf != null
      ? ((efFirstHalf - efSecondHalf) / efFirstHalf) * 100
      : null;
  const decouplingValid = movingTimeSec >= DECOUPLING_VALID_THRESHOLD_SEC;

  const hrSamples = records.filter((r) => r.heart_rate != null).map((r) => r.heart_rate as number);
  const zoneShare =
    hrSamples.length === 0
      ? null
      : {
          below140: (hrSamples.filter((hr) => hr < 140).length / hrSamples.length) * 100,
          z140to150:
            (hrSamples.filter((hr) => hr >= 140 && hr < 150).length / hrSamples.length) * 100,
          above150: (hrSamples.filter((hr) => hr >= 150).length / hrSamples.length) * 100,
        };

  // fit-file-parser exposes the FIT SDK's total_cycles field for running sessions,
  // which is the total_strides value the algorithm calls for.
  const cadenceSpm =
    fitSession?.total_cycles != null && fitSession?.total_timer_time != null
      ? (2 * fitSession.total_cycles) / (fitSession.total_timer_time / 60)
      : null;

  const powerSamples = records.filter((r) => r.power != null).map((r) => r.power as number);
  const powerAvg =
    powerSamples.length === 0
      ? null
      : powerSamples.reduce((sum, p) => sum + p, 0) / powerSamples.length;

  return {
    source: "fit_upload",
    movingTimeSec,
    elapsedTimeSec,
    pauses: pauses.map((p) => ({
      startIso: p.start.toISOString(),
      endIso: p.end.toISOString(),
      durationSec: (p.end.getTime() - p.start.getTime()) / 1000,
    })),
    distanceKm,
    avgHr,
    efWhole,
    efFirstHalf,
    efSecondHalf,
    decouplingPct,
    decouplingValid,
    zoneShare,
    cadenceSpm,
    powerAvg,
  };
}
