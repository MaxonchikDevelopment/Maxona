import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { requireSessionUserIdFromCookies } from "@/lib/auth/session";
import { SessionCard } from "@/components/session-card";
import { ActiveIssues } from "@/components/active-issues";
import { ReplanButton } from "@/components/replan-button";
import { ManualSessionForm } from "@/components/manual-session-form";
import { OnboardingCard } from "@/components/onboarding-card";
import { categorizeCheckIn } from "@/lib/checkin-utils";
import { activateDraftIfReady } from "@/lib/planner/rollover";
import { normalizeCoachBullets } from "@/lib/format-bullets";
import { formatIntensity, formatSlot } from "@/lib/format-labels";
import { formatSessionTarget } from "@/components/session-card";
import { generateWeeklyNutritionFocus } from "@/lib/ai/weekly-nutrition-focus";
import { hashInputs, getCachedInsight, setCachedInsight } from "@/lib/ai/insight-cache";
import { timed } from "@/lib/perf";
import { PageWrapper, StaggerList, StaggerItem } from "@/components/ui/page-wrapper";
import { DashboardShell } from "@/components/ui/dashboard-shell";
import { NutritionFocusBlock } from "@/components/nutrition-focus-block";
import type { WeeklyNutritionFocus } from "@/lib/ai/weekly-nutrition-focus";
import type { SessionProp, WorkoutPlanProp, WorkoutBlock } from "@/components/session-card";
import type { WorkoutFeedbackProp } from "@/components/workout-feedback-section";
import type { IssueItem } from "@/components/active-issues";
import type { StravaLinkProp } from "@/components/strava-panel";

// Explicit type covering only what this page uses — bypasses Prisma 6 inference bug
// when two same-model findFirst calls are in the same Promise.all.
type PlanWithSessions = {
  id: string;
  startsAt: Date;
  focusSummary: string | null;
  changeExplanation: string | null;
  sessions: Array<{
    id: string;
    scheduledDate: Date;
    preferredSlot: string;
    planningType: string;
    status: string;
    durationMin: number;
    intensity: string;
    notes: string | null;
    distanceKm: number | null;
    targetPaceMinPerKm: string | null;
    targetHrZoneMin: number | null;
    targetHrZoneMax: number | null;
    subtype: string | null;
    checkIn: {
      id: string;
      feelScore: number;
      notes: string | null;
      coachAdvice: string | null;
      resolvedAt: Date | null;
    } | null;
  }>;
};

export const dynamic = "force-dynamic";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const READINESS_TAG_LABELS: Record<string, string> = {
  alcohol: "Alcohol",
  poor_sleep: "Poor sleep",
  stress: "Stress",
  travel: "Travel",
  soreness: "Soreness",
  stomach: "Stomach",
};

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

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

type ReadinessBannerProps = { category: string; feelScore: number; tags: unknown };

function ReadinessBanner({ readiness }: { readiness: ReadinessBannerProps }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-700">
      <span className="font-semibold">
        {readiness.category === "injury" ? "Injury" : "Fatigue"} · {readiness.feelScore}/6
      </span>
      {(readiness.tags as string[]).length > 0 && (
        <>
          <span className="text-amber-400">·</span>
          <span>
            {(readiness.tags as string[])
              .map((t) => READINESS_TAG_LABELS[t] ?? t)
              .join(", ")}
          </span>
        </>
      )}
    </div>
  );
}

function ChangeBlock({ explanation }: { explanation: string }) {
  return (
    <div className="rounded-2xl bg-indigo-50 border border-indigo-100 px-4 py-3 space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-400">What changed</p>
      <ul className="space-y-1">
        {normalizeCoachBullets(explanation)
          .split("\n\n")
          .filter((l) => l.trim())
          .map((line, i) => (
            <li key={i} className="text-xs text-indigo-800">
              · {line.replace(/^[•·]\s*/, "")}
            </li>
          ))}
      </ul>
    </div>
  );
}

function FocusSummary({ text }: { text: string }) {
  const lines = normalizeCoachBullets(text)
    .split("\n\n")
    .filter((l) => l.trim())
    .map((l) => l.replace(/^[•·]\s*/, "").trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return (
      <p className="text-sm text-zinc-500 mt-2 leading-relaxed">
        {lines[0] ?? text}
      </p>
    );
  }

  return (
    <ul className="mt-2 space-y-0.5">
      {lines.map((line, i) => (
        <li key={i} className="flex items-start gap-1.5 text-xs text-zinc-500">
          <span className="text-zinc-300 mt-0.5 shrink-0 select-none">·</span>
          <span className="leading-relaxed">{line}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function WeekPage() {
  const userId = await requireSessionUserIdFromCookies();
  const pageStart = Date.now();

  // ── Step 1: user (needed for timezone) ─────────────────────────────────────
  const user = await timed("week/user", () =>
    prisma.user.findUniqueOrThrow({ where: { id: userId } })
  );

  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: user.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const todayDate = new Date(todayStr + "T00:00:00Z");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pc = prisma as any;

  // ── Step 2: all independent queries in parallel (1 DB round trip) ───────────
  const [
    didActivate,
    stravaConnectionRaw,
    planRaw,
    draftPlan,
    injuryCheckIns,
    nutritionProfileRaw,
    latestReadiness,
    anyGoalRow,
    anySessionRow,
  ] = await timed("week/batch1", () =>
    Promise.all([
      activateDraftIfReady(userId, todayStr),
      prisma.stravaConnection.findUnique({ where: { userId: userId } }),
      prisma.trainingPlan.findFirst({
        where: { userId: userId, status: "active" },
        orderBy: { startsAt: "desc" },
        include: {
          sessions: {
            include: { checkIn: true },
            orderBy: [{ scheduledDate: "asc" }, { preferredSlot: "asc" }],
          },
        },
      }),
      prisma.trainingPlan.findFirst({
        where: { userId: userId, status: "draft" },
        orderBy: { startsAt: "desc" },
        include: {
          sessions: {
            include: { checkIn: true },
            orderBy: [{ scheduledDate: "asc" }, { preferredSlot: "asc" }],
          },
        },
      }),
      prisma.checkIn.findMany({
        where: { userId: userId, resolvedAt: null, feelScore: { lte: 3 } },
        include: { session: true },
        orderBy: { occurredAt: "desc" },
      }),
      pc.nutritionProfile.findUnique({ where: { userId: userId } }) as Promise<{
        nutritionGoal: string | null;
        currentMealPattern: string | null;
        stomachSensitive: boolean;
        caffeineSensitive: boolean;
        preferredFoods: string | null;
        avoidFoods: string | null;
        supplements: string | null;
        cookingTimePreference: string | null;
        calorieGoal: string | null;
        estimatedRestDayCalories: number | null;
      } | null>,
      // latestReadiness moved into batch — safe to always query
      pc.dailyReadiness.findFirst({
        where: {
          userId: userId,
          date: { gte: todayDate },
          category: { not: "ok" },
        },
        orderBy: { date: "desc" },
      }) as Promise<{ id: string; category: string; feelScore: number; tags: unknown } | null>,
      prisma.goal.findFirst({ where: { userId: userId, deletedAt: null }, select: { id: true } }),
      prisma.trainingSession.findFirst({ where: { userId: userId }, select: { id: true } }),
    ])
  );

  if (didActivate) redirect("/week");

  const stravaConnected = !!stravaConnectionRaw;
  const isNewUser = !stravaConnected && !planRaw && !draftPlan && !anyGoalRow && !anySessionRow;

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

  if (!planRaw) {
    if (process.env.NODE_ENV !== "production")
      console.log(`[perf] week/total (no plan): ${Date.now() - pageStart}ms`);
    return (
      <main className="relative min-h-screen px-4 lg:px-6 xl:px-8 pt-0 pb-24 lg:pb-8">
        <div className="pt-6 pb-4">
          <div className="lg:rounded-2xl lg:bg-white/70 lg:backdrop-blur-sm lg:border lg:border-zinc-100/80 lg:shadow-sm lg:px-5 lg:py-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Training Week</p>
            <h1 className="text-[26px] font-bold tracking-tight text-zinc-900 leading-none">Week</h1>
          </div>
        </div>
        <PageWrapper>
          <div className="space-y-3">
            {isNewUser && <OnboardingCard />}
            <ActiveIssues initialIssues={activeIssues} />
            <div className="rounded-2xl bg-white border border-zinc-100 shadow-card px-4 py-4">
              <p className="text-sm font-medium text-zinc-700">No active plan</p>
              <p className="text-xs text-zinc-400 mt-0.5 mb-3">Generate a weekly training plan to get started</p>
              <ReplanButton mode="generate" />
            </div>
            {draftPlan && (
              <DraftPreview plan={draftPlan} todayStr={todayStr} />
            )}
          </div>
        </PageWrapper>
      </main>
    );
  }

  // Cast through unknown — Prisma 6 loses fields when same model appears twice in Promise.all
  const plan = planRaw as unknown as PlanWithSessions;
  const planId = plan.id;

  const sessionIds = plan.sessions.map((s) => s.id);

  // Compute weekly nutrition hash from plan sessions + nutrition profile
  const weeklyNutritionInput = {
    sessions: plan.sessions.map((s) => ({
      dateStr: toDateStr(s.scheduledDate),
      intensity: s.intensity,
      durationMin: s.durationMin,
      notes: s.notes,
    })),
    nutritionProfile: nutritionProfileRaw
      ? {
          nutritionGoal: nutritionProfileRaw.nutritionGoal,
          currentMealPattern: nutritionProfileRaw.currentMealPattern,
          stomachSensitive: nutritionProfileRaw.stomachSensitive,
          caffeineSensitive: nutritionProfileRaw.caffeineSensitive,
          preferredFoods: nutritionProfileRaw.preferredFoods,
          avoidFoods: nutritionProfileRaw.avoidFoods,
          supplements: nutritionProfileRaw.supplements,
          cookingTimePreference: nutritionProfileRaw.cookingTimePreference,
          calorieGoal: nutritionProfileRaw.calorieGoal,
          estimatedRestDayCalories: nutritionProfileRaw.estimatedRestDayCalories,
        }
      : null,
  };
  const weeklyNutritionHash = hashInputs({ weeklyNutritionVersion: 1, ...weeklyNutritionInput });

  // ── Step 3: session-dependent queries in parallel (1 DB round trip) ─────────
  type LinkRow = {
    id: string;
    sessionId: string;
    isPrimary: boolean;
    activity: {
      id: string;
      stravaActivityId: string;
      name: string;
      sportType: string;
      startDate: Date;
      distance: number;
      movingTime: number;
      elapsedTime: number;
      totalElevationGain: number;
      averageSpeed: number;
      averageHeartrate: number | null;
      maxHeartrate: number | null;
    };
  };
  type WpRow = {
    id: string;
    sessionId: string;
    planType: string;
    goal: string;
    target: string | null;
    blocks: unknown;
    rules: unknown;
    alternatives: unknown;
    summary: string | null;
  };
  type WfRow = {
    id: string;
    sessionId: string;
    adherenceLabel: string;
    summary: string;
    bullets: unknown;
    nextAdjustment: string | null;
    generatedAt: Date;
  };

  const [allLinksRaw, allWp, allWf, cachedWeeklyNutrition] = await timed("week/batch2", () =>
    Promise.all([
      stravaConnected
        ? (pc.sessionStravaActivityLink.findMany({
            where: { sessionId: { in: sessionIds } },
            // select only fields needed for card rendering — excludes rawJson
            include: { activity: { select: ACTIVITY_SELECT } },
            orderBy: { createdAt: "asc" },
          }) as Promise<LinkRow[]>)
        : Promise.resolve([] as LinkRow[]),
      pc.sessionWorkoutPlan.findMany({
        where: { sessionId: { in: sessionIds } },
      }) as Promise<WpRow[]>,
      pc.sessionWorkoutFeedback.findMany({
        where: { sessionId: { in: sessionIds } },
      }) as Promise<WfRow[]>,
      getCachedInsight<WeeklyNutritionFocus>({
        userId: userId,
        kind: "weekly-nutrition",
        scopeKey: planId,
        inputHash: weeklyNutritionHash,
      }),
    ])
  );

  // Cache miss → schedule generation AFTER response is sent (non-blocking)
  const weeklyNutritionFocus: WeeklyNutritionFocus | null = cachedWeeklyNutrition;
  if (!weeklyNutritionFocus) {
    const capturedInput = weeklyNutritionInput;
    const capturedHash = weeklyNutritionHash;
    const capturedPlanId = planId;
    after(async () => {
      try {
        const result = await generateWeeklyNutritionFocus(capturedInput);
        await setCachedInsight({
          userId: userId,
          kind: "weekly-nutrition",
          scopeKey: capturedPlanId,
          inputHash: capturedHash,
          payload: result,
        });
      } catch {
        // non-fatal — will retry on next navigation
      }
    });
  }

  if (process.env.NODE_ENV !== "production")
    console.log(`[perf] week/total: ${Date.now() - pageStart}ms`);

  // ── Build lookup maps ────────────────────────────────────────────────────────
  const stravaLinksBySession: Record<string, StravaLinkProp[]> = {};
  for (const l of allLinksRaw) {
    if (!stravaLinksBySession[l.sessionId]) stravaLinksBySession[l.sessionId] = [];
    stravaLinksBySession[l.sessionId].push({
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
    });
  }

  const workoutPlansBySession: Record<string, WorkoutPlanProp> = {};
  for (const wp of allWp) {
    workoutPlansBySession[wp.sessionId] = {
      id: wp.id,
      planType: wp.planType,
      goal: wp.goal,
      target: wp.target,
      blocks: wp.blocks as WorkoutBlock[],
      rules: wp.rules as string[],
      alternatives: wp.alternatives as string[] | null,
      summary: wp.summary,
    };
  }

  const workoutFeedbacksBySession: Record<string, WorkoutFeedbackProp> = {};
  for (const wf of allWf) {
    workoutFeedbacksBySession[wf.sessionId] = {
      id: wf.id,
      adherenceLabel: wf.adherenceLabel,
      summary: wf.summary,
      bullets: Array.isArray(wf.bullets) ? (wf.bullets as string[]) : [],
      nextAdjustment: wf.nextAdjustment,
      generatedAt: wf.generatedAt.toISOString(),
    };
  }

  const sessionsByDate: Record<string, SessionProp[]> = {};
  for (const s of plan.sessions) {
    const key = s.scheduledDate.toISOString().split("T")[0];
    if (!sessionsByDate[key]) sessionsByDate[key] = [];
    sessionsByDate[key].push({
      id: s.id,
      scheduledDate: key,
      preferredSlot: s.preferredSlot,
      planningType: s.planningType,
      status: s.status,
      durationMin: s.durationMin,
      intensity: s.intensity,
      notes: s.notes,
      distanceKm: s.distanceKm,
      targetPaceMinPerKm: s.targetPaceMinPerKm,
      targetHrZoneMin: s.targetHrZoneMin,
      targetHrZoneMax: s.targetHrZoneMax,
      subtype: s.subtype,
      checkIn: s.checkIn
        ? {
            id: s.checkIn.id,
            feelScore: s.checkIn.feelScore,
            notes: s.checkIn.notes,
            coachAdvice: s.checkIn.coachAdvice,
            resolvedAt: s.checkIn.resolvedAt?.toISOString() ?? null,
          }
        : null,
      stravaLinks: stravaLinksBySession[s.id] ?? [],
      stravaConnected,
      workoutPlan: workoutPlansBySession[s.id] ?? null,
      workoutFeedback: workoutFeedbacksBySession[s.id] ?? null,
      // HR analytics not loaded on card view — user can analyze stream on session detail
      hrAnalytics: null,
    });
  }

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(planRaw.startsAt);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().split("T")[0];
  });

  // Desktop header stats — computed from plan sessions (no extra queries)
  const plannedSessions = plan.sessions.filter((s) => s.status !== "skipped");
  const totalPlanMin = plannedSessions.reduce((t, s) => t + s.durationMin, 0);
  const hardCount = plannedSessions.filter((s) => s.intensity === "hard").length;

  return (
    <main className="relative min-h-screen px-4 lg:px-6 xl:px-8 pt-0 pb-24 lg:pb-8">
      {/* ── Plan header ──────────────────────────────────────────────── */}
      <div className="pt-6 pb-4">
        <div className="lg:rounded-2xl lg:bg-white/70 lg:backdrop-blur-sm lg:border lg:border-zinc-100/80 lg:shadow-sm lg:px-5 lg:py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Training Week</p>
              <h1 className="text-[26px] font-bold tracking-tight text-zinc-900 leading-none">Week</h1>
            </div>
            <div className="mt-1">
              <ReplanButton mode="replan" />
            </div>
          </div>
          {plan.focusSummary && <FocusSummary text={plan.focusSummary} />}
          {/* Desktop stats row */}
          {plannedSessions.length > 0 && (
            <div className="hidden lg:flex items-center gap-3 mt-3 flex-wrap">
              <span className="text-xs text-zinc-500">
                {plannedSessions.length} session{plannedSessions.length !== 1 ? "s" : ""}
              </span>
              <span className="text-zinc-300">·</span>
              <span className="text-xs text-zinc-500">{totalPlanMin} min total</span>
              {hardCount > 0 && (
                <>
                  <span className="text-zinc-300">·</span>
                  <span className="text-xs text-red-600 font-medium">{hardCount} hard</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <PageWrapper>
        <DashboardShell
          main={
            <div className="space-y-3">
              {/* Mobile-only context block: readiness, issues, change, nutrition */}
              <div className="lg:hidden space-y-3">
                {latestReadiness && <ReadinessBanner readiness={latestReadiness} />}
                <ActiveIssues initialIssues={activeIssues} />
                {plan.changeExplanation && <ChangeBlock explanation={plan.changeExplanation} />}
                <NutritionFocusBlock initialFocus={weeklyNutritionFocus} scopeKey={planId} />
              </div>

              {/* Week days — primary content, always in main column */}
              <StaggerList className="space-y-4">
                {weekDays.map((dateStr, i) => {
                  const daySessions = sessionsByDate[dateStr] ?? [];
                  const isPast = dateStr < todayStr;
                  const isToday = dateStr === todayStr;

                  return (
                    <StaggerItem key={dateStr}>
                      <div className={isToday ? "pl-3 border-l-2 border-indigo-200" : ""}>
                        {/* Day header */}
                        <div className={`flex items-center gap-2 mb-2 ${isPast ? "opacity-40" : ""}`}>
                          <span className={`text-sm font-semibold ${isToday ? "text-zinc-900" : "text-zinc-600"}`}>
                            {DOW[i]}
                          </span>
                          <span className="text-xs text-zinc-400">{dateStr.slice(5)}</span>
                          {isToday && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">
                              Today
                            </span>
                          )}
                        </div>

                        {/* Sessions or rest */}
                        {daySessions.length === 0 ? (
                          <p className={`text-xs py-1 ${isPast ? "text-zinc-300" : "text-zinc-400"}`}>Rest</p>
                        ) : (
                          <div className="space-y-2">
                            {daySessions.map((s) => (
                              <SessionCard key={s.id} session={s} todayStr={todayStr} />
                            ))}
                          </div>
                        )}

                        <div className="mt-2">
                          <ManualSessionForm defaultDate={dateStr} />
                        </div>
                      </div>
                    </StaggerItem>
                  );
                })}
              </StaggerList>

              {/* Draft preview — mobile-only inline (desktop version lives in side rail) */}
              {draftPlan && (
                <div className="lg:hidden">
                  <DraftPreview plan={draftPlan} todayStr={todayStr} />
                </div>
              )}
            </div>
          }
          side={
            <>
              {latestReadiness && <ReadinessBanner readiness={latestReadiness} />}
              <ActiveIssues initialIssues={activeIssues} />
              {plan.changeExplanation && <ChangeBlock explanation={plan.changeExplanation} />}
              <NutritionFocusBlock initialFocus={weeklyNutritionFocus} scopeKey={planId} />
              {draftPlan && <DraftPreview plan={draftPlan} todayStr={todayStr} />}
            </>
          }
        />
      </PageWrapper>
    </main>
  );
}

type DraftSession = {
  scheduledDate: Date;
  durationMin: number;
  intensity: string;
  notes: string | null;
  preferredSlot: string;
  distanceKm: number | null;
  targetPaceMinPerKm: string | null;
  targetHrZoneMin: number | null;
  targetHrZoneMax: number | null;
  subtype: string | null;
};

function DraftPreview({
  plan,
  todayStr,
}: {
  plan: { startsAt: Date; endsAt: Date; focusSummary: string | null; sessions: DraftSession[] };
  todayStr: string;
}) {
  const weekStartStr = toDateStr(plan.startsAt);
  if (weekStartStr <= todayStr) return null; // should have been auto-activated

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(plan.startsAt);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().split("T")[0];
  });

  const sessionsByDate: Record<string, DraftSession[]> = {};
  for (const s of plan.sessions) {
    const key = toDateStr(s.scheduledDate);
    if (!sessionsByDate[key]) sessionsByDate[key] = [];
    sessionsByDate[key].push(s);
  }

  return (
    <div className="mt-4 pt-4 border-t border-zinc-100 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-zinc-500">Next week · draft</p>
        <span className="text-xs text-zinc-400">{weekStartStr}</span>
      </div>
      {plan.focusSummary && (
        <div className="space-y-0.5">
          {normalizeCoachBullets(plan.focusSummary)
            .split("\n\n")
            .filter((l) => l.trim())
            .map((l) => l.replace(/^[•·]\s*/, "").trim())
            .filter(Boolean)
            .map((line, i) => (
              <p key={i} className="text-xs text-zinc-400 leading-relaxed">{line}</p>
            ))}
        </div>
      )}
      {weekDays.map((dateStr, i) => {
        const daySessions = sessionsByDate[dateStr] ?? [];
        return (
          <div key={dateStr}>
            <p className="mb-1 text-xs font-medium text-zinc-400">
              {DOW[i]} · {dateStr.slice(5)}
            </p>
            {daySessions.length === 0 ? (
              <p className="text-xs text-zinc-300">Rest</p>
            ) : (
              <div className="space-y-1">
                {daySessions.map((s, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-zinc-100 bg-white px-3 py-2"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-zinc-600">
                        {formatIntensity(s.intensity)}
                      </span>
                      <span className="text-xs text-zinc-400">{s.durationMin} min</span>
                      <span className="text-xs text-zinc-400">{formatSlot(s.preferredSlot)}</span>
                      {formatSessionTarget(s) && (
                        <span className="text-xs text-zinc-500">{formatSessionTarget(s)}</span>
                      )}
                      {s.notes && (
                        <span className="text-xs text-zinc-500">{s.notes.split(":")[0]}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
