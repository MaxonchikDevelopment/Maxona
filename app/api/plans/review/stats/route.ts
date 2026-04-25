import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deriveExecutionSummary } from "@/lib/execution-summary";
import { categorizeCheckIn } from "@/lib/checkin-utils";

const USER_ID = "user_maxon";

type SessionResult = {
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
  } | null;
};

export async function GET() {
  const plan = await prisma.trainingPlan.findFirst({
    where: { userId: USER_ID, status: "active" },
    include: {
      sessions: {
        include: {
          checkIn: true,
          stravaLinks: { include: { activity: true }, orderBy: { createdAt: "asc" } },
        },
        orderBy: [{ scheduledDate: "asc" }, { preferredSlot: "asc" }],
      },
    },
  });

  if (!plan) return NextResponse.json(null);

  const readinessRecords = await prisma.dailyReadiness.findMany({
    where: { userId: USER_ID, date: { gte: plan.startsAt, lte: plan.endsAt } },
  });

  const sessions = plan.sessions;
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

  const sessionResults: SessionResult[] = [];

  for (const s of sessions) {
    const isRunNote = /run/i.test(s.notes ?? "");
    const kmMatch = (s.notes ?? "").match(/(\d+(?:\.\d+)?)\s*km/i);
    if (isRunNote && kmMatch) {
      plannedRunningKm += parseFloat(kmMatch[1]);
      hasPlannedRunning = true;
    }

    const activities = s.stravaLinks.map((l) => l.activity);
    let execution: SessionResult["execution"] = null;

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

  // Adherence
  const adherenceByCount = totalPlanned > 0 ? Math.round((done / totalPlanned) * 100) : 0;
  const adherenceByDuration =
    hasAnyStrava && doneDurationWithStrava > 0
      ? Math.round((actualMovingMin / doneDurationWithStrava) * 100)
      : null;

  // Signals from readiness records
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

  // Carry-forward bullets — purely deterministic
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

  return NextResponse.json({
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
    },
    sessions: sessionResults,
    carryForward: carryForward.slice(0, 5),
  });
}
