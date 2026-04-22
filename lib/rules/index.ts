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
