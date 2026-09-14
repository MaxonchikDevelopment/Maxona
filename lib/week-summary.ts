import type { TrainingSession, CheckIn, DailyReadiness, StravaActivity, SessionStravaActivityLink, SessionMetrics } from "@prisma/client";
import { deriveExecutionSummary } from "@/lib/execution-summary";
import { categorizeCheckIn } from "@/lib/checkin-utils";
import type { Prisma, PrismaClient } from "@prisma/client";

export type WeekSummarySession = TrainingSession & {
  checkIn: CheckIn | null;
  stravaLinks: (SessionStravaActivityLink & { activity: StravaActivity })[];
  metrics?: SessionMetrics | null;
};

export type WeekSummarySessionResult = {
  id: string;
  date: string;
  intensity: string;
  durationMin: number;
  notes: string | null;
  status: string;
  checkIn: { feelScore: number; notes: string | null } | null;
  execution: {
    actualMovingMin: number;
    actualDistanceKm: number | null;
    elevationGain: number | null;
    paceStr: string | null;
    qualityLabel: string;
    splitSession: boolean;
    hillsIndicator: boolean;
    actualSportTypes: string[];
  } | null;
};

export type WeekSummaryResult = {
  weekStart: string;
  weekEnd: string;
  planned: number;
  done: number;
  skipped: number;
  plannedDurationMin: number;
  actualMovingMin: number | null;
  plannedRunningKm: number | null;
  actualRunningKm: number | null;
  hardPlanned: number;
  hardDone: number;
  adherenceByCount: number;
  adherenceByDuration: number | null;
  executionQuality: {
    matched: number;
    slightlyShort: number;
    clearlyShort: number;
    longerThanPlanned: number;
    interrupted: number;
    hillyVariant: number;
    splitSessions: number;
  };
  signals: {
    lowReadinessDays: number;
    fatigueDays: number;
    injuryDays: number;
    unresolvedIssues: number;
    mainLimiter: string | null;
    avgDecouplingPct?: number;
    decouplingSessionCount?: number;
    avgEfWhole?: number;
    efSessionCount?: number;
  };
  sessions: WeekSummarySessionResult[];
  carryForward: string[];
};

/**
 * Computes the weekly adherence/execution retrospective for a plan.
 * Shared by the Review-page stats API and (per Review & Plan Overhaul plan)
 * the planner context / persisted WeekSummary — one source of truth.
 */
export function computeWeekSummary(
  plan: { startsAt: Date; endsAt: Date },
  sessions: WeekSummarySession[],
  readinessRecords: DailyReadiness[]
): WeekSummaryResult {
  const totalPlanned = sessions.length;
  const done = sessions.filter((s) => s.status === "done").length;
  const skipped = sessions.filter((s) => s.status === "skipped").length;
  const plannedDurationMin = sessions.reduce((s, sess) => s + sess.durationMin, 0);
  const hardPlanned = sessions.filter((s) => s.intensity === "hard").length;
  const hardDone = sessions.filter((s) => s.intensity === "hard" && s.status === "done").length;

  let actualMovingMin = 0;
  let doneDurationWithStrava = 0;
  let hasAnyStrava = false;
  let actualRunningKm = 0;
  let hasRunningStrava = false;
  let plannedRunningKm = 0;
  let hasPlannedRunning = false;

  const execQuality = {
    matched: 0,
    slightlyShort: 0,
    clearlyShort: 0,
    longerThanPlanned: 0,
    interrupted: 0,
    hillyVariant: 0,
    splitSessions: 0,
  };

  const sessionResults: WeekSummarySessionResult[] = [];

  for (const s of sessions) {
    const isRunNote = /run/i.test(s.notes ?? "");
    const kmMatch = (s.notes ?? "").match(/(\d+(?:\.\d+)?)\s*km/i);
    if (isRunNote && kmMatch) {
      plannedRunningKm += parseFloat(kmMatch[1]);
      hasPlannedRunning = true;
    }

    const activities = s.stravaLinks.map((l) => l.activity);
    let execution: WeekSummarySessionResult["execution"] = null;

    if (activities.length > 0 && s.status === "done") {
      const activityInputs = activities.map((a) => ({
        distance: a.distance,
        movingTime: a.movingTime,
        elapsedTime: a.elapsedTime,
        totalElevationGain: a.totalElevationGain,
        averageSpeed: a.averageSpeed,
        sportType: a.sportType,
        averageHeartrate: a.averageHeartrate ?? null,
        maxHeartrate: a.maxHeartrate ?? null,
      }));

      const summary = deriveExecutionSummary(s, activityInputs);
      if (summary) {
        hasAnyStrava = true;
        actualMovingMin += summary.actualMovingMin;
        doneDurationWithStrava += s.durationMin;

        const isRunning = activities.some((a) => /run/i.test(a.sportType));
        if (isRunning && summary.actualDistanceKm) {
          actualRunningKm += summary.actualDistanceKm;
          hasRunningStrava = true;
        }

        switch (summary.qualityLabel) {
          case "Matched":            execQuality.matched++; break;
          case "Slightly short":     execQuality.slightlyShort++; break;
          case "Clearly short":      execQuality.clearlyShort++; break;
          case "Longer than planned": execQuality.longerThanPlanned++; break;
          case "Interrupted":        execQuality.interrupted++; break;
          case "Hilly variant":      execQuality.hillyVariant++; break;
        }
        if (summary.splitSession) execQuality.splitSessions++;

        execution = {
          actualMovingMin: summary.actualMovingMin,
          actualDistanceKm: summary.actualDistanceKm,
          elevationGain: summary.elevationGain,
          paceStr: summary.paceStr,
          qualityLabel: summary.qualityLabel,
          splitSession: summary.splitSession,
          hillsIndicator: summary.hillsIndicator,
          actualSportTypes: activities.map((a) => a.sportType),
        };
      }
    }

    sessionResults.push({
      id: s.id,
      date: s.scheduledDate.toISOString().split("T")[0],
      intensity: s.intensity,
      durationMin: s.durationMin,
      notes: s.notes,
      status: s.status,
      checkIn: s.checkIn
        ? { feelScore: s.checkIn.feelScore, notes: s.checkIn.notes }
        : null,
      execution,
    });
  }

  const adherenceByCount = totalPlanned > 0 ? Math.round((done / totalPlanned) * 100) : 0;
  const adherenceByDuration =
    hasAnyStrava && doneDurationWithStrava > 0
      ? Math.round((actualMovingMin / doneDurationWithStrava) * 100)
      : null;

  const lowReadinessDays = readinessRecords.filter((r) => r.feelScore <= 3).length;
  const readinessFatigue = readinessRecords.filter((r) => r.category === "fatigue").length;
  const readinessInjury = readinessRecords.filter((r) => r.category === "injury").length;

  const checkinFatigue = sessions.filter(
    (s) => s.checkIn && categorizeCheckIn(s.checkIn.feelScore, s.checkIn.notes) === "fatigue"
  ).length;
  const checkinInjury = sessions.filter(
    (s) => s.checkIn && categorizeCheckIn(s.checkIn.feelScore, s.checkIn.notes) === "injury"
  ).length;

  const fatigueDays = Math.max(readinessFatigue, checkinFatigue);
  const injuryDays = Math.max(readinessInjury, checkinInjury);

  const unresolvedIssues = sessions.filter(
    (s) =>
      s.checkIn &&
      !s.checkIn.resolvedAt &&
      s.checkIn.feelScore <= 3 &&
      categorizeCheckIn(s.checkIn.feelScore, s.checkIn.notes) === "injury"
  ).length;

  let mainLimiter: string | null = null;
  if (unresolvedIssues > 0) mainLimiter = "Unresolved injury";
  else if (injuryDays > 0) mainLimiter = "Injury signals this week";
  else if (fatigueDays >= 2) mainLimiter = "Recurring fatigue";
  else if (lowReadinessDays >= 3) mainLimiter = "Consistently low readiness";

  const carryForward: string[] = [];

  if (unresolvedIssues > 0) {
    carryForward.push("Unresolved injury — no hard sessions until cleared");
  }

  if (totalPlanned > 2) {
    if (adherenceByCount < 60) {
      carryForward.push(`Low adherence (${adherenceByCount}%) — keep next week volume conservative`);
    } else if (adherenceByCount >= 90 && done >= 3) {
      carryForward.push(`Strong adherence (${adherenceByCount}%) — load can hold or step up slightly`);
    }
  }

  const interruptedRatio = done > 0 ? execQuality.interrupted / done : 0;
  if (interruptedRatio >= 0.5 && done >= 2) {
    carryForward.push("Multiple sessions interrupted — keep recovery bias next week");
  }

  if (hasPlannedRunning && hasRunningStrava && plannedRunningKm > 0) {
    const ratio = actualRunningKm / plannedRunningKm;
    if (ratio < 0.7) {
      carryForward.push(
        `Actual running km (${actualRunningKm.toFixed(1)}km) well below planned (${plannedRunningKm.toFixed(1)}km) — avoid jumping volume next week`
      );
    }
  }

  if (hardDone >= 1 && execQuality.matched + execQuality.longerThanPlanned >= 1 && unresolvedIssues === 0) {
    carryForward.push(
      `${hardDone} hard session${hardDone > 1 ? "s" : ""} executed well — maintain hard session spacing`
    );
  }

  if (fatigueDays >= 2 && carryForward.length < 5) {
    carryForward.push(`${fatigueDays} fatigue signals this week — start next week with an easy day`);
  }

  // Only average decoupling across sessions the pipeline marked valid — an
  // invalid/short session's ratio isn't a real aerobic-decoupling reading.
  const validDecouplingPcts = sessions
    .map((s) => s.metrics)
    .filter((m): m is SessionMetrics => !!m && m.decouplingValid && m.decouplingPct != null)
    .map((m) => m.decouplingPct as number);
  const avgDecouplingPct =
    validDecouplingPcts.length > 0
      ? parseFloat((validDecouplingPcts.reduce((a, b) => a + b, 0) / validDecouplingPcts.length).toFixed(1))
      : undefined;

  // EF is an aerobic-efficiency signal that only makes sense within a stable
  // intensity band — mixing in hard-effort sessions blends different
  // physiological regimes into one meaningless number. Restrict to easy/moderate.
  const efWholeValues = sessions
    .filter((s) => s.intensity === "easy" || s.intensity === "moderate")
    .map((s) => s.metrics?.efWhole)
    .filter((v): v is number => v != null);
  const avgEfWhole =
    efWholeValues.length > 0
      ? parseFloat((efWholeValues.reduce((a, b) => a + b, 0) / efWholeValues.length).toFixed(3))
      : undefined;

  return {
    weekStart: plan.startsAt.toISOString().split("T")[0],
    weekEnd: plan.endsAt.toISOString().split("T")[0],
    planned: totalPlanned,
    done,
    skipped,
    plannedDurationMin,
    actualMovingMin: hasAnyStrava ? actualMovingMin : null,
    plannedRunningKm: hasPlannedRunning ? parseFloat(plannedRunningKm.toFixed(1)) : null,
    actualRunningKm: hasRunningStrava ? parseFloat(actualRunningKm.toFixed(1)) : null,
    hardPlanned,
    hardDone,
    adherenceByCount,
    adherenceByDuration,
    executionQuality: execQuality,
    signals: {
      lowReadinessDays,
      fatigueDays,
      injuryDays,
      unresolvedIssues,
      mainLimiter,
      ...(avgDecouplingPct != null && {
        avgDecouplingPct,
        decouplingSessionCount: validDecouplingPcts.length,
      }),
      ...(avgEfWhole != null && {
        avgEfWhole,
        efSessionCount: efWholeValues.length,
      }),
    },
    sessions: sessionResults,
    carryForward: carryForward.slice(0, 5),
  };
}

export type KeySession = {
  date: string;
  label: string;
  intensity: string;
  status: string;
  feelScore: number | null;
  quality: string | null;
};

/** Distils a WeekSummaryResult into the compact fields persisted on WeekSummary. */
function deriveSummaryExtras(result: WeekSummaryResult): {
  avgFeelScore: number | null;
  keySessions: KeySession[];
} {
  const feels = result.sessions
    .map((s) => s.checkIn?.feelScore)
    .filter((f): f is number => typeof f === "number");
  const avgFeelScore =
    feels.length > 0
      ? parseFloat((feels.reduce((a, b) => a + b, 0) / feels.length).toFixed(1))
      : null;

  const keySessions: KeySession[] = result.sessions
    .filter((s) => s.status === "done" && (s.intensity === "hard" || s.durationMin >= 75))
    .slice(0, 6)
    .map((s) => ({
      date: s.date,
      label: (s.notes ?? s.intensity).split(":")[0].trim(),
      intensity: s.intensity,
      status: s.status,
      feelScore: s.checkIn?.feelScore ?? null,
      quality: s.execution?.qualityLabel ?? null,
    }));

  return { avgFeelScore, keySessions };
}

/**
 * Persists the week retrospective as a durable WeekSummary row. Idempotent via
 * the @@unique([userId, weekStart]) upsert — safe under concurrent rollover
 * calls. Returns false (never throws) when the write fails so callers can treat
 * it as best-effort and never let it block plan activation.
 */
export async function persistWeekSummary(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  plan: { id: string; startsAt: Date; endsAt: Date },
  sessions: WeekSummarySession[],
  readinessRecords: DailyReadiness[],
  overrides?: { recoveryScore?: number | null; reviewNotes?: string | null; narrative?: string | null }
): Promise<boolean> {
  try {
    const result = computeWeekSummary(plan, sessions, readinessRecords);
    const { avgFeelScore, keySessions } = deriveSummaryExtras(result);

    const data = {
      planId: plan.id,
      weekEnd: plan.endsAt,
      planned: result.planned,
      done: result.done,
      skipped: result.skipped,
      plannedDurationMin: result.plannedDurationMin,
      actualMovingMin: result.actualMovingMin,
      adherenceByCount: result.adherenceByCount,
      adherenceByDuration: result.adherenceByDuration,
      hardPlanned: result.hardPlanned,
      hardDone: result.hardDone,
      avgFeelScore,
      executionQuality: result.executionQuality as unknown as Prisma.InputJsonValue,
      signals: result.signals as unknown as Prisma.InputJsonValue,
      keySessions: keySessions as unknown as Prisma.InputJsonValue,
      carryForward: result.carryForward,
      recoveryScore: overrides?.recoveryScore ?? null,
      reviewNotes: overrides?.reviewNotes ?? null,
      narrative: overrides?.narrative ?? null,
    };

    await db.weekSummary.upsert({
      where: { userId_weekStart: { userId, weekStart: plan.startsAt } },
      create: { userId, weekStart: plan.startsAt, ...data },
      update: data,
    });
    return true;
  } catch (err) {
    console.error("[week-summary] persistWeekSummary failed:", err);
    return false;
  }
}
