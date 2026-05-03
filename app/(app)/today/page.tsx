import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { SessionCard } from "@/components/session-card";
import { ActiveIssues } from "@/components/active-issues";
import { DailyReadinessCard } from "@/components/daily-readiness-card";
import { ManualSessionForm } from "@/components/manual-session-form";
import { categorizeCheckIn } from "@/lib/checkin-utils";
import { activateDraftIfReady } from "@/lib/planner/rollover";
import { generateNutritionAdvice } from "@/lib/ai/nutrition-advice";
import { hashInputs, getCachedInsight, setCachedInsight } from "@/lib/ai/insight-cache";
import { estimateDayEnergy } from "@/lib/nutrition/energy-estimate";
import { buildHrAnalytics } from "@/lib/analytics/hr-stream";
import type { NutritionAdvice, MealTimingItem } from "@/lib/ai/nutrition-advice";
import type { DayEnergyEstimate } from "@/lib/nutrition/energy-estimate";
import type { HrAnalytics } from "@/lib/analytics/hr-stream";
import type { SessionProp, WorkoutPlanProp, WorkoutBlock } from "@/components/session-card";
import type { WorkoutFeedbackProp } from "@/components/workout-feedback-section";
import type { ReadinessProp } from "@/components/daily-readiness-card";
import type { IssueItem } from "@/components/active-issues";

export const dynamic = "force-dynamic";

const USER_ID = "user_maxon";

function buildImplicationLine(
  readiness: ReadinessProp | null,
  activeIssues: IssueItem[],
  latestCheckIn: { feelScore: number; category: string; sessionNotes: string | null } | null,
  nextPlanned: { intensity: string; notes: string | null } | null
): string | null {
  const nextLabel =
    nextPlanned?.notes?.split(":")[0].trim() ??
    (nextPlanned ? nextPlanned.intensity : null);

  if (activeIssues.length > 0) {
    const issue = activeIssues[0];
    const issueLabel = issue.sessionNotes?.split(":")[0].trim() ?? "injury";
    if (nextPlanned && nextPlanned.intensity === "hard") {
      return `${issueLabel} still active — ${nextLabel} moved to easy`;
    }
    return `${issueLabel} still active — hard sessions blocked`;
  }

  if (latestCheckIn && latestCheckIn.feelScore <= 3) {
    if (latestCheckIn.category === "injury") {
      const sport = latestCheckIn.sessionNotes?.split(":")[0].trim() ?? "session";
      if (nextPlanned) {
        return `Injury flagged in ${sport} — ${nextLabel} stays easy or rest`;
      }
      return "Injury flagged — next session stays easy";
    }
    if (latestCheckIn.category === "fatigue") {
      if (nextPlanned) {
        return `Fatigue noted today — ${nextLabel} kept lighter`;
      }
      return "Fatigue noted — next session kept lighter";
    }
  }

  if (!readiness) return null;

  if (readiness.category === "injury" && readiness.feelScore <= 3) {
    return "Possible injury flagged — plan will protect next sessions";
  }
  if (readiness.category === "fatigue" && readiness.feelScore <= 3) {
    if (nextPlanned) {
      return `Fatigue noted — ${nextLabel} stays lighter`;
    }
    return "Fatigue noted — next session kept lighter";
  }
  if ((readiness.tags as string[]).some((t) => ["alcohol", "poor_sleep"].includes(t))) {
    if (nextPlanned) {
      return `Poor recovery signal — ${nextLabel} may be shorter`;
    }
    return "Poor recovery signal — tomorrow's session may be shorter";
  }

  if (nextPlanned && readiness.feelScore >= 5) {
    return `Plan on track — ${nextLabel} ahead`;
  }

  return null;
}

export default async function TodayPage() {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID } });

  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: user.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  if (await activateDraftIfReady(USER_ID, todayStr)) {
    redirect("/today");
  }

  const [y, m, d] = todayStr.split("-").map(Number);
  const todayDate = new Date(Date.UTC(y, m - 1, d));

  const stravaConnection = await prisma.stravaConnection.findUnique({ where: { userId: USER_ID } });
  const stravaConnected = !!stravaConnection;

  const [sessions, injuryCheckIns, readinessRecord, nextPlannedSession, nutritionProfileRaw] =
    await Promise.all([
      prisma.trainingSession.findMany({
        where: {
          userId: USER_ID,
          scheduledDate: todayDate,
          plan: { status: "active" },
        },
        include: {
          checkIn: true,
          stravaLinks: { include: { activity: true }, orderBy: { createdAt: "asc" } },
          workoutPlan: true,
          workoutFeedback: true,
        },
        orderBy: { preferredSlot: "asc" },
      }),
      prisma.checkIn.findMany({
        where: { userId: USER_ID, resolvedAt: null, feelScore: { lte: 3 } },
        include: { session: true },
        orderBy: { occurredAt: "desc" },
      }),
      prisma.dailyReadiness.findUnique({
        where: { userId_date: { userId: USER_ID, date: todayDate } },
      }),
      prisma.trainingSession.findFirst({
        where: {
          userId: USER_ID,
          plan: { status: "active" },
          status: "planned",
          scheduledDate: { gt: todayDate },
        },
        orderBy: { scheduledDate: "asc" },
      }),
      prisma.nutritionProfile.findUnique({ where: { userId: USER_ID } }),
    ]);

  // ── HR Analytics: batch-load streams for done sessions with Strava ──
  const primaryActivityIds = sessions
    .filter((s) => (s.status === "done" || !!s.checkIn) && s.stravaLinks.length > 0)
    .map((s) => (s.stravaLinks.find((l) => l.isPrimary) ?? s.stravaLinks[0])?.activity?.id)
    .filter((id): id is string => !!id);

  const [streamsRaw, trainingProfile] = await Promise.all([
    primaryActivityIds.length > 0
      ? prisma.stravaActivityStream.findMany({
          where: { stravaActivityId: { in: primaryActivityIds } },
          select: { stravaActivityId: true, time: true, heartrate: true },
        })
      : Promise.resolve([]),
    primaryActivityIds.length > 0
      ? prisma.userTrainingProfile.findUnique({ where: { userId: USER_ID } })
      : Promise.resolve(null),
  ]);

  const streamsByActivityId = Object.fromEntries(
    streamsRaw.map((s) => [s.stravaActivityId, s])
  );

  const hrAnalyticsBySession: Record<string, HrAnalytics> = {};
  for (const s of sessions) {
    if (s.stravaLinks.length === 0) continue;
    const primaryLink = s.stravaLinks.find((l) => l.isPrimary) ?? s.stravaLinks[0];
    const stream = streamsByActivityId[primaryLink.activity.id];
    if (!stream) continue;
    const { time, heartrate } = stream;
    if (!Array.isArray(time) || !Array.isArray(heartrate)) continue;
    const analytics = buildHrAnalytics(
      time as number[],
      heartrate as number[],
      trainingProfile,
      s.intensity
    );
    if (analytics) hrAnalyticsBySession[s.id] = analytics;
  }

  const sessionInputs = sessions.map((s) => ({
    intensity: s.intensity,
    durationMin: s.durationMin,
    notes: s.notes,
  }));

  const energy: DayEnergyEstimate | null = estimateDayEnergy({
    sessions: sessionInputs,
    nutritionProfile: nutritionProfileRaw
      ? {
          bodyWeightKg: nutritionProfileRaw.bodyWeightKg,
          estimatedRestDayCalories: nutritionProfileRaw.estimatedRestDayCalories,
          calorieGoal: nutritionProfileRaw.calorieGoal,
        }
      : null,
  });

  const nutritionAdviceInput = {
    sessions: sessionInputs,
    readiness: readinessRecord
      ? {
          feelScore: readinessRecord.feelScore,
          notes: readinessRecord.notes,
          tags: readinessRecord.tags,
          category: readinessRecord.category,
        }
      : null,
    nutritionProfile: nutritionProfileRaw
      ? {
          dietNotes: nutritionProfileRaw.dietNotes,
          avoidFoods: nutritionProfileRaw.avoidFoods,
          preferredBreakfast: nutritionProfileRaw.preferredBreakfast,
          preferredPreWorkoutSnack: nutritionProfileRaw.preferredPreWorkoutSnack,
          preferredPostWorkoutMeal: nutritionProfileRaw.preferredPostWorkoutMeal,
          caffeineSensitive: nutritionProfileRaw.caffeineSensitive,
          stomachSensitive: nutritionProfileRaw.stomachSensitive,
          currentMealPattern: nutritionProfileRaw.currentMealPattern,
          nutritionGoal: nutritionProfileRaw.nutritionGoal,
          minHoursAfterMainMealBeforeWorkout: nutritionProfileRaw.minHoursAfterMainMealBeforeWorkout,
          preWorkoutSnackTolerance: nutritionProfileRaw.preWorkoutSnackTolerance,
          preferredFoods: nutritionProfileRaw.preferredFoods,
          supplements: nutritionProfileRaw.supplements,
          cookingTimePreference: nutritionProfileRaw.cookingTimePreference,
          bodyWeightKg: nutritionProfileRaw.bodyWeightKg,
          estimatedRestDayCalories: nutritionProfileRaw.estimatedRestDayCalories,
          calorieGoal: nutritionProfileRaw.calorieGoal,
        }
      : null,
    energy,
  };

  const nutritionHash = hashInputs({ date: todayStr, ...nutritionAdviceInput });

  let nutritionAdvice: NutritionAdvice | null =
    await getCachedInsight<NutritionAdvice>({
      userId: USER_ID,
      kind: "daily-nutrition",
      scopeKey: todayStr,
      inputHash: nutritionHash,
    });

  if (!nutritionAdvice) {
    if (process.env.NODE_ENV !== "production") console.time("[today] nutrition-advice generate");
    try {
      nutritionAdvice = await generateNutritionAdvice(nutritionAdviceInput);
      void setCachedInsight({
        userId: USER_ID,
        kind: "daily-nutrition",
        scopeKey: todayStr,
        inputHash: nutritionHash,
        payload: nutritionAdvice,
      });
    } catch {
      nutritionAdvice = null;
    }
    if (process.env.NODE_ENV !== "production") console.timeEnd("[today] nutrition-advice generate");
  }

  const props: SessionProp[] = sessions.map((s) => ({
    id: s.id,
    scheduledDate: s.scheduledDate.toISOString().split("T")[0],
    preferredSlot: s.preferredSlot,
    planningType: s.planningType,
    status: s.status,
    durationMin: s.durationMin,
    intensity: s.intensity,
    notes: s.notes,
    checkIn: s.checkIn
      ? {
          id: s.checkIn.id,
          feelScore: s.checkIn.feelScore,
          notes: s.checkIn.notes,
          coachAdvice: s.checkIn.coachAdvice,
          resolvedAt: s.checkIn.resolvedAt?.toISOString() ?? null,
        }
      : null,
    stravaLinks: s.stravaLinks.map((l) => ({
      id: l.id,
      isPrimary: l.isPrimary,
      activity: {
        id: l.activity.id,
        stravaActivityId: l.activity.stravaActivityId,
        name: l.activity.name,
        sportType: l.activity.sportType,
        startDate: l.activity.startDate.toISOString(),
        distance: l.activity.distance,
        movingTime: l.activity.movingTime,
        elapsedTime: l.activity.elapsedTime,
        totalElevationGain: l.activity.totalElevationGain,
        averageSpeed: l.activity.averageSpeed,
        averageHeartrate: l.activity.averageHeartrate,
        maxHeartrate: l.activity.maxHeartrate,
      },
    })),
    stravaConnected,
    workoutPlan: s.workoutPlan
      ? ({
          id: s.workoutPlan.id,
          planType: s.workoutPlan.planType,
          goal: s.workoutPlan.goal,
          target: s.workoutPlan.target,
          blocks: s.workoutPlan.blocks as WorkoutBlock[],
          rules: s.workoutPlan.rules as string[],
          alternatives: s.workoutPlan.alternatives as string[] | null,
          summary: s.workoutPlan.summary,
        } satisfies WorkoutPlanProp)
      : null,
    workoutFeedback: s.workoutFeedback
      ? ({
          id: s.workoutFeedback.id,
          adherenceLabel: s.workoutFeedback.adherenceLabel,
          summary: s.workoutFeedback.summary,
          bullets: Array.isArray(s.workoutFeedback.bullets)
            ? (s.workoutFeedback.bullets as string[])
            : [],
          nextAdjustment: s.workoutFeedback.nextAdjustment,
          generatedAt: s.workoutFeedback.generatedAt.toISOString(),
        } satisfies WorkoutFeedbackProp)
      : null,
    hrAnalytics: hrAnalyticsBySession[s.id] ?? null,
    nutritionAdvice,
  }));

  const activeIssues: IssueItem[] = injuryCheckIns
    .filter((ci) => categorizeCheckIn(ci.feelScore, ci.notes) === "injury")
    .map((ci) => ({
      checkInId: ci.id,
      sessionId: ci.sessionId,
      sessionDate: ci.session.scheduledDate.toISOString().split("T")[0],
      sessionIntensity: ci.session.intensity,
      sessionNotes: ci.session.notes,
      feelScore: ci.feelScore,
      notes: ci.notes,
    }));

  const readinessProp: ReadinessProp | null = readinessRecord
    ? {
        id: readinessRecord.id,
        date: readinessRecord.date.toISOString().split("T")[0],
        feelScore: readinessRecord.feelScore,
        notes: readinessRecord.notes,
        tags: readinessRecord.tags,
        category: readinessRecord.category,
        coachAdvice: readinessRecord.coachAdvice,
      }
    : null;

  const todayCheckIn = sessions
    .filter((s) => s.checkIn)
    .map((s) => ({
      feelScore: s.checkIn!.feelScore,
      category: categorizeCheckIn(s.checkIn!.feelScore, s.checkIn!.notes),
      sessionNotes: s.notes,
    }))
    .sort((a, b) => a.feelScore - b.feelScore)[0] ?? null;

  const nextPlanned = nextPlannedSession
    ? { intensity: nextPlannedSession.intensity, notes: nextPlannedSession.notes }
    : null;

  const implicationLine = buildImplicationLine(readinessProp, activeIssues, todayCheckIn, nextPlanned);

  return (
    <main className="p-4 space-y-3">
      <h1 className="text-xl font-bold">Today</h1>
      <DailyReadinessCard initialReadiness={readinessProp} todayStr={todayStr} />
      {props.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-gray-500">Rest day — nothing scheduled.</p>
          {nutritionAdvice && <NutritionCard advice={nutritionAdvice} />}
          <ManualSessionForm defaultDate={todayStr} />
        </div>
      ) : (
        <div className="space-y-3">
          {props.map((s) => (
            <SessionCard key={s.id} session={s} todayStr={todayStr} />
          ))}
          {implicationLine && (
            <div className="flex items-start gap-1.5 rounded bg-amber-50 px-2.5 py-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-500 shrink-0 mt-0.5">Recovery</span>
              <p className="text-xs text-amber-700">{implicationLine}</p>
            </div>
          )}
          {nutritionAdvice && <NutritionCard advice={nutritionAdvice} />}
          <ManualSessionForm defaultDate={todayStr} />
        </div>
      )}
      <ActiveIssues initialIssues={activeIssues} />
    </main>
  );
}

const GOAL_LABELS: Record<string, string> = {
  maintain: "Maintain",
  slight_surplus: "Slight surplus",
  slight_deficit: "Slight deficit",
};

function EnergyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs text-green-800">
      <span className="text-green-600">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function MealRow({ meal }: { meal: MealTimingItem }) {
  const hasItems = (meal.items?.length ?? 0) > 0;
  return (
    <div className="space-y-0.5">
      <div className="flex gap-2 text-xs text-green-800">
        <span className="shrink-0 font-medium text-green-600 w-10">{meal.time}</span>
        <span className="flex-1">
          <span className="font-medium">{meal.label}</span>
          {" — "}
          {meal.suggestion}
          {meal.approxCalories != null && (
            <span className="text-green-600"> (~{meal.approxCalories} kcal)</span>
          )}
        </span>
      </div>
      {hasItems && (
        <div className="ml-12 space-y-0.5">
          {meal.items!.map((item, i) => (
            <p key={i} className="text-[11px] text-green-700">
              · {item.name} — {item.amount}
              {item.kcal != null && (
                <span className="text-green-500"> ({item.kcal} kcal)</span>
              )}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function NutritionCard({ advice }: { advice: NutritionAdvice }) {
  const hasEnergy = advice.energy != null;
  const hasMeals = advice.mealTiming.length > 0;
  const hasBefore = advice.before.length > 0;
  const hasDuring = advice.during.length > 0;
  const hasAfter = advice.after.length > 0;
  const mealTotal = advice.mealTiming.reduce((sum, m) => sum + (m.approxCalories ?? 0), 0);

  return (
    <div className="rounded border border-green-100 bg-green-50 px-3 py-2.5 space-y-2">
      {/* Focus */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-green-600">Nutrition today</p>
        <p className="text-xs font-medium text-green-700 mt-0.5">{advice.summary}</p>
      </div>

      {/* Energy estimate */}
      {hasEnergy && (
        <div className="rounded bg-green-100/60 px-2.5 py-2 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-green-500">Energy estimate</p>
          <EnergyRow label="Passive" value={`≈${advice.energy!.passiveCalories.toLocaleString()} kcal`} />
          {advice.energy!.activeCalories > 0 && (
            <EnergyRow label="Training" value={`+${advice.energy!.activeCalories.toLocaleString()} kcal`} />
          )}
          <EnergyRow label="Target today" value={`≈${advice.energy!.targetCalories.toLocaleString()} kcal`} />
          <p className="text-[10px] text-green-500 italic">{advice.energy!.balanceNote}</p>
        </div>
      )}

      {/* Meal timing */}
      {hasMeals && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-green-500">Meal timing</p>
          {advice.mealTiming.map((meal, i) => (
            <MealRow key={i} meal={meal} />
          ))}
          {mealTotal > 0 && hasEnergy && (
            <p className="text-[11px] text-green-700 font-medium border-t border-green-100 pt-1">
              Meal total ≈ {mealTotal.toLocaleString()} kcal · Target ≈ {advice.energy!.targetCalories.toLocaleString()} kcal
              {" · "}
              <span className="font-normal text-green-600">{advice.energy!.balanceNote}</span>
            </p>
          )}
        </div>
      )}

      {/* Before / During / After */}
      {(hasBefore || hasDuring || hasAfter) && (
        <div className="space-y-1">
          {hasBefore && advice.before.map((b, i) => (
            <p key={i} className="text-xs text-green-800">
              <span className="font-medium">Before:</span> {b}
            </p>
          ))}
          {hasDuring && advice.during.map((d, i) => (
            <p key={i} className="text-xs text-green-800">
              <span className="font-medium">During:</span> {d}
            </p>
          ))}
          {hasAfter && advice.after.map((a, i) => (
            <p key={i} className="text-xs text-green-800">
              <span className="font-medium">After:</span> {a}
            </p>
          ))}
        </div>
      )}

      {/* Hydration */}
      {advice.hydration.length > 0 && (
        <div className="space-y-0.5">
          {advice.hydration.map((h, i) => (
            <p key={i} className="text-xs text-green-800">· {h}</p>
          ))}
        </div>
      )}

      {/* Timing note */}
      {advice.timingNote && (
        <p className="text-xs text-green-600 italic">{advice.timingNote}</p>
      )}

      {/* Missing energy callout */}
      {!hasEnergy && (
        <p className="text-[10px] text-green-500 italic">
          Add rest-day calorie target in Settings → Nutrition Profile for rough energy estimates.
        </p>
      )}
    </div>
  );
}
