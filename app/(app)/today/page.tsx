import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { requireSessionUserIdFromCookies } from "@/lib/auth/session";
import { SessionCard } from "@/components/session-card";
import { ActiveIssues } from "@/components/active-issues";
import { DailyReadinessCard } from "@/components/daily-readiness-card";
import { ManualSessionForm } from "@/components/manual-session-form";
import { OnboardingCard } from "@/components/onboarding-card";
import { categorizeCheckIn } from "@/lib/checkin-utils";
import { activateDraftIfReady } from "@/lib/planner/rollover";
import { generateNutritionAdvice } from "@/lib/ai/nutrition-advice";
import { hashInputs, getCachedInsight, setCachedInsight } from "@/lib/ai/insight-cache";
import { estimateDayEnergy } from "@/lib/nutrition/energy-estimate";
import { timed } from "@/lib/perf";
import { PageWrapper, StaggerList, StaggerItem } from "@/components/ui/page-wrapper";
import { DashboardShell } from "@/components/ui/dashboard-shell";
import type { NutritionAdvice, MealTimingItem } from "@/lib/ai/nutrition-advice";
import type { DayEnergyEstimate } from "@/lib/nutrition/energy-estimate";
import type { SessionProp, WorkoutPlanProp, WorkoutBlock } from "@/components/session-card";
import type { WorkoutFeedbackProp } from "@/components/workout-feedback-section";
import type { ReadinessProp } from "@/components/daily-readiness-card";
import type { IssueItem } from "@/components/active-issues";

export const dynamic = "force-dynamic";

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

// Only fields needed for card rendering — excludes rawJson and stream data
const ACTIVITY_SELECT = {
  id: true,
  stravaActivityId: true,
  name: true,
  sportType: true,
  startDate: true,
  distance: true,
  movingTime: true,
  elapsedTime: true,
  totalElevationGain: true,
  averageSpeed: true,
  averageHeartrate: true,
  maxHeartrate: true,
} as const;

export default async function TodayPage() {
  const userId = await requireSessionUserIdFromCookies();
  const pageStart = Date.now();

  // ── Step 1: user (needed for timezone to compute todayStr) ──────────────────
  const user = await timed("today/user", () =>
    prisma.user.findUniqueOrThrow({ where: { id: userId } })
  );

  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: user.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const dayName = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: user.timezone,
  }).format(new Date());

  const dayDisplay = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: user.timezone,
  }).format(new Date());

  const [y, m, d] = todayStr.split("-").map(Number);
  const todayDate = new Date(Date.UTC(y, m - 1, d));

  // ── Step 2: all data queries in parallel (1 DB round trip) ──────────────────
  const [
    didActivate,
    stravaConnectionRaw,
    sessions,
    injuryCheckIns,
    readinessRecord,
    nextPlannedSession,
    nutritionProfileRaw,
    anyPlanRow,
    anyGoalRow,
    anySessionRow,
  ] = await timed("today/batch", () =>
    Promise.all([
      activateDraftIfReady(userId, todayStr),
      prisma.stravaConnection.findUnique({ where: { userId: userId } }),
      prisma.trainingSession.findMany({
        where: {
          userId: userId,
          scheduledDate: todayDate,
          plan: { status: "active" },
        },
        include: {
          checkIn: true,
          stravaLinks: {
            // select only fields needed by ExecutionSummaryBlock — skip rawJson
            include: { activity: { select: ACTIVITY_SELECT } },
            orderBy: { createdAt: "asc" },
          },
          workoutPlan: true,
          workoutFeedback: true,
        },
        orderBy: { preferredSlot: "asc" },
      }),
      prisma.checkIn.findMany({
        where: { userId: userId, resolvedAt: null, feelScore: { lte: 3 } },
        include: { session: true },
        orderBy: { occurredAt: "desc" },
      }),
      prisma.dailyReadiness.findUnique({
        where: { userId_date: { userId: userId, date: todayDate } },
      }),
      prisma.trainingSession.findFirst({
        where: {
          userId: userId,
          plan: { status: "active" },
          status: "planned",
          scheduledDate: { gt: todayDate },
        },
        select: { intensity: true, notes: true },
        orderBy: { scheduledDate: "asc" },
      }),
      prisma.nutritionProfile.findUnique({ where: { userId: userId } }),
      prisma.trainingPlan.findFirst({ where: { userId: userId }, select: { id: true } }),
      prisma.goal.findFirst({ where: { userId: userId, deletedAt: null }, select: { id: true } }),
      prisma.trainingSession.findFirst({ where: { userId: userId }, select: { id: true } }),
    ])
  );

  if (didActivate) redirect("/today");

  const stravaConnected = !!stravaConnectionRaw;
  const isNewUser = !stravaConnected && !anyPlanRow && !anyGoalRow && !anySessionRow;

  // ── Step 3: nutrition cache check ───────────────────────────────────────────
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

  const nutritionHash = hashInputs({ date: todayStr, nutritionAdviceVersion: 3, ...nutritionAdviceInput });

  const nutritionAdvice = await timed("today/nutrition-cache", () =>
    getCachedInsight<NutritionAdvice>({
      userId: userId,
      kind: "daily-nutrition",
      scopeKey: todayStr,
      inputHash: nutritionHash,
    })
  );

  // Cache miss → schedule generation AFTER response is sent (non-blocking)
  if (!nutritionAdvice) {
    const capturedInput = nutritionAdviceInput;
    const capturedHash = nutritionHash;
    after(async () => {
      try {
        const result = await generateNutritionAdvice(capturedInput);
        await setCachedInsight({
          userId: userId,
          kind: "daily-nutrition",
          scopeKey: todayStr,
          inputHash: capturedHash,
          payload: result,
        });
      } catch {
        // non-fatal — will retry on next navigation
      }
    });
  }

  if (process.env.NODE_ENV !== "production")
    console.log(`[perf] today/total: ${Date.now() - pageStart}ms`);

  // ── Build props ─────────────────────────────────────────────────────────────
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
    // HR analytics not loaded on card view — user can analyze stream on session detail
    hrAnalytics: null,
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

  const readinessScore = readinessProp?.feelScore;
  const readinessPillClass =
    !readinessScore
      ? null
      : readinessScore >= 5
      ? "bg-emerald-100 text-emerald-700"
      : readinessScore <= 2
      ? "bg-red-100 text-red-700"
      : readinessScore <= 3
      ? "bg-amber-100 text-amber-700"
      : "bg-zinc-100 text-zinc-600";

  const totalMin = props.reduce((t, s) => t + s.durationMin, 0);

  return (
    <main className="relative min-h-screen px-4 lg:px-6 xl:px-8 pt-0 pb-24 lg:pb-8">
      {/* ── Hero header ─────────────────────────────────────────────── */}
      <div className="pt-4 pb-3">
        <div className="lg:rounded-2xl lg:bg-white/60 lg:backdrop-blur-sm lg:border lg:border-zinc-100/80 lg:shadow-sm lg:px-5 lg:py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-0.5">Today</p>
              <div className="flex items-baseline gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-zinc-900 leading-none">{dayName}</h1>
                <span className="text-sm text-zinc-500">{dayDisplay}</span>
              </div>
              {props.length > 0 && (
                <p className="text-xs text-zinc-400 mt-1">
                  {props.length} session{props.length > 1 ? "s" : ""} · {totalMin} min
                </p>
              )}
            </div>
            {readinessPillClass && (
              <div className={`rounded-full px-2.5 py-1 text-xs font-semibold mt-0.5 shrink-0 ${readinessPillClass}`}>
                {readinessScore}/6
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Page content ────────────────────────────────────────────── */}
      <PageWrapper>
        <DashboardShell
          main={
            <div className="space-y-3">
              {/* Onboarding: mobile-only (desktop version lives in side rail) */}
              {isNewUser && (
                <div className="lg:hidden">
                  <OnboardingCard />
                </div>
              )}

              <DailyReadinessCard initialReadiness={readinessProp} todayStr={todayStr} />

              {props.length === 0 ? (
                <StaggerList className="space-y-3">
                  <StaggerItem>
                    <div className="rounded-2xl bg-white border border-zinc-100 shadow-card px-4 py-4">
                      <p className="text-sm font-medium text-zinc-700">Rest day</p>
                      <p className="text-xs text-zinc-400 mt-0.5">Nothing scheduled — recovery time</p>
                    </div>
                  </StaggerItem>
                  {/* Nutrition: mobile-only inline (desktop version lives in side rail) */}
                  {nutritionAdvice && (
                    <StaggerItem className="lg:hidden">
                      <NutritionCard advice={nutritionAdvice} />
                    </StaggerItem>
                  )}
                  <StaggerItem>
                    <ManualSessionForm defaultDate={todayStr} />
                  </StaggerItem>
                </StaggerList>
              ) : (
                <StaggerList className="space-y-3">
                  {props.map((s) => (
                    <StaggerItem key={s.id}>
                      <SessionCard session={s} todayStr={todayStr} />
                    </StaggerItem>
                  ))}
                  {implicationLine && (
                    <StaggerItem>
                      <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-500 shrink-0 mt-0.5">Recovery</span>
                        <p className="text-xs text-amber-700">{implicationLine}</p>
                      </div>
                    </StaggerItem>
                  )}
                  {/* Nutrition: mobile-only inline (desktop version lives in side rail) */}
                  {nutritionAdvice && (
                    <StaggerItem className="lg:hidden">
                      <NutritionCard advice={nutritionAdvice} />
                    </StaggerItem>
                  )}
                  <StaggerItem>
                    <ManualSessionForm defaultDate={todayStr} />
                  </StaggerItem>
                </StaggerList>
              )}

              {/* Active issues: mobile-only inline (desktop version lives in side rail) */}
              <div className="lg:hidden">
                <ActiveIssues initialIssues={activeIssues} />
              </div>
            </div>
          }
          side={
            <>
              {isNewUser && <OnboardingCard />}
              {nutritionAdvice && <NutritionCard advice={nutritionAdvice} />}
              <ActiveIssues initialIssues={activeIssues} />
            </>
          }
        />
      </PageWrapper>
    </main>
  );
}

function EnergyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs text-emerald-800">
      <span className="text-emerald-600">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function MealRow({ meal }: { meal: MealTimingItem }) {
  const hasItems = (meal.items?.length ?? 0) > 0;
  return (
    <div className="space-y-0.5">
      <div className="flex gap-2 text-xs text-emerald-800">
        <span className="shrink-0 font-medium text-emerald-600 w-10">{meal.time}</span>
        <span className="flex-1">
          <span className="font-medium">{meal.label}</span>
          {" — "}
          {meal.suggestion}
          {meal.approxCalories != null && (
            <span className="text-emerald-600"> (~{meal.approxCalories} kcal)</span>
          )}
        </span>
      </div>
      {hasItems && (
        <div className="ml-12 space-y-0.5">
          {meal.items!.map((item, i) => (
            <p key={i} className="text-[11px] text-emerald-700">
              · {item.name} — {item.amount}
              {item.kcal != null && (
                <span className="text-emerald-500"> ({item.kcal} kcal)</span>
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
    <div className="rounded-2xl bg-emerald-50/70 border border-emerald-100 px-4 py-3 space-y-2.5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600 mb-0.5">Nutrition today</p>
        <p className="text-xs font-medium text-emerald-800">{advice.summary}</p>
      </div>

      {hasEnergy && (
        <div className="rounded-xl bg-emerald-100/50 px-3 py-2 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600">Energy estimate</p>
          <EnergyRow label="Passive" value={`≈${advice.energy!.passiveCalories.toLocaleString()} kcal`} />
          {advice.energy!.activeCalories > 0 && (
            <EnergyRow label="Training" value={`+${advice.energy!.activeCalories.toLocaleString()} kcal`} />
          )}
          <EnergyRow label="Target today" value={`≈${advice.energy!.targetCalories.toLocaleString()} kcal`} />
          <p className="text-[10px] text-emerald-600 italic">{advice.energy!.balanceNote}</p>
        </div>
      )}

      {hasMeals && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600">Meal timing</p>
          {advice.mealTiming.map((meal, i) => (
            <MealRow key={i} meal={meal} />
          ))}
          {mealTotal > 0 && hasEnergy && (
            <p className="text-[11px] text-emerald-800 font-medium border-t border-emerald-100 pt-1">
              Meal total ≈ {mealTotal.toLocaleString()} kcal · Target ≈ {advice.energy!.targetCalories.toLocaleString()} kcal
              {" · "}
              <span className="font-normal text-emerald-600">{advice.energy!.balanceNote}</span>
            </p>
          )}
        </div>
      )}

      {(hasBefore || hasDuring || hasAfter) && (
        <div className="space-y-1">
          {hasBefore && advice.before.map((b, i) => (
            <p key={i} className="text-xs text-emerald-800">
              <span className="font-medium">Before:</span> {b}
            </p>
          ))}
          {hasDuring && advice.during.map((d, i) => (
            <p key={i} className="text-xs text-emerald-800">
              <span className="font-medium">During:</span> {d}
            </p>
          ))}
          {hasAfter && advice.after.map((a, i) => (
            <p key={i} className="text-xs text-emerald-800">
              <span className="font-medium">After:</span> {a}
            </p>
          ))}
        </div>
      )}

      {advice.hydration.length > 0 && (
        <div className="space-y-0.5">
          {advice.hydration.map((h, i) => (
            <p key={i} className="text-xs text-emerald-800">· {h}</p>
          ))}
        </div>
      )}

      {advice.timingNote && (
        <p className="text-xs text-emerald-700 italic">{advice.timingNote}</p>
      )}

      {!hasEnergy && (
        <p className="text-[10px] text-emerald-600 italic">
          Add rest-day calorie target in Settings → Nutrition Profile for rough energy estimates.
        </p>
      )}
    </div>
  );
}
