import type {
  AvailabilityWindow,
  ScheduleEvent,
  TrainingSession,
  DayOfWeek,
} from "@prisma/client";
import type { PlannedSession } from "@/lib/ai/adapter";

export interface RuleContext {
  availabilityWindows: AvailabilityWindow[];
  scheduleEvents: ScheduleEvent[];
  previousSessions: TrainingSession[];
  weekStart: Date;
  constraints: Record<string, unknown>;
}

export interface RuleConstraints {
  blockedDates: string[];
  blockedHardSessionDates: string[];
  maxWeeklyMinutes: number;
}

export interface Rule {
  name: string;
  apply(context: RuleContext): Partial<RuleConstraints>;
}

export function applyRules(rules: Rule[], context: RuleContext): RuleConstraints {
  const result: RuleConstraints = {
    blockedDates: [],
    blockedHardSessionDates: [],
    maxWeeklyMinutes: Infinity,
  };

  for (const rule of rules) {
    const partial = rule.apply(context);
    if (partial.blockedDates) result.blockedDates.push(...partial.blockedDates);
    if (partial.blockedHardSessionDates)
      result.blockedHardSessionDates.push(...partial.blockedHardSessionDates);
    if (partial.maxWeeklyMinutes !== undefined) {
      result.maxWeeklyMinutes = Math.min(
        result.maxWeeklyMinutes,
        partial.maxWeeklyMinutes
      );
    }
  }

  return result;
}

export function filterSessions(
  sessions: PlannedSession[],
  constraints: RuleConstraints
): PlannedSession[] {
  const sorted = [...sessions].sort(
    (a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime()
  );

  const hardSessionDates: Date[] = [];
  let totalMinutes = 0;

  return sorted.filter((s) => {
    const dateStr = toDateStr(s.scheduledDate);

    if (constraints.blockedDates.includes(dateStr)) return false;

    if (s.intensity === "hard") {
      if (constraints.blockedHardSessionDates.includes(dateStr)) return false;
      const tooClose = hardSessionDates.some(
        (d) =>
          Math.abs(s.scheduledDate.getTime() - d.getTime()) / (1000 * 60 * 60) <
          48
      );
      if (tooClose) return false;
      hardSessionDates.push(s.scheduledDate);
    }

    if (
      s.planningType !== "fixed" &&
      constraints.maxWeeklyMinutes !== Infinity &&
      totalMinutes + s.durationMin > constraints.maxWeeklyMinutes
    ) {
      return false;
    }

    totalMinutes += s.durationMin;
    return true;
  });
}

export function toDateStr(date: Date): string {
  return date.toISOString().split("T")[0];
}

function modalityBucket(notes: string | null | undefined): string {
  const raw = (notes ?? "").toLowerCase();
  if (raw.startsWith("running")) return "running";
  if (raw.startsWith("hyrox")) return "hyrox";
  if (raw.startsWith("cycling")) return "cycling";
  if (raw.startsWith("swimming")) return "swimming";
  return "other";
}

/**
 * Removes exact duplicates and enforces two-a-day rules deterministically.
 * Called after filterSessions so the final saved plan is always clean.
 */
export function deduplicateSessions(
  sessions: PlannedSession[],
  opts: { injuryActive: boolean; recoveryOk: boolean }
): PlannedSession[] {
  // Step 1: drop exact slot+modality duplicates (same date, slot, modality bucket)
  const seenSlotKey = new Set<string>();
  const deduped: PlannedSession[] = [];
  for (const s of sessions) {
    const key = `${toDateStr(s.scheduledDate)}|${s.preferredSlot}|${modalityBucket(s.notes)}`;
    if (!seenSlotKey.has(key)) {
      seenSlotKey.add(key);
      deduped.push(s);
    }
  }

  // Step 2: group by date and enforce two-a-day policy
  const byDate = new Map<string, PlannedSession[]>();
  for (const s of deduped) {
    const d = toDateStr(s.scheduledDate);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(s);
  }

  const result: PlannedSession[] = [];
  for (const [, daySessions] of byDate) {
    if (daySessions.length <= 1) {
      result.push(...daySessions);
      continue;
    }

    // Hard cap: max 2 sessions per day; take first two
    const [a, b] = daySessions.slice(0, 2);

    const slotsOk = a.preferredSlot !== b.preferredSlot;
    const modalitiesOk = modalityBucket(a.notes) !== modalityBucket(b.notes);
    const noDoubleRun =
      !(modalityBucket(a.notes) === "running" && modalityBucket(b.notes) === "running");
    const allowed =
      !opts.injuryActive && opts.recoveryOk && slotsOk && modalitiesOk && noDoubleRun;

    if (allowed) {
      result.push(a, b);
    } else {
      // Keep fixed session if present; otherwise keep first
      const keep = [a, b].find((s) => s.planningType === "fixed") ?? a;
      result.push(keep);
    }
  }

  return result.sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime());
}

export function eachDayOfWeek(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

const JS_DAY_TO_DOW: Record<number, DayOfWeek> = {
  0: "sun",
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: "sat",
};

export function toDayOfWeek(date: Date): DayOfWeek {
  return JS_DAY_TO_DOW[date.getDay()];
}
