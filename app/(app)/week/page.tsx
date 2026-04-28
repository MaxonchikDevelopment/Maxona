import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { SessionCard } from "@/components/session-card";
import { ActiveIssues } from "@/components/active-issues";
import { ReplanButton } from "@/components/replan-button";
import { ManualSessionForm } from "@/components/manual-session-form";
import { categorizeCheckIn } from "@/lib/checkin-utils";
import { activateDraftIfReady } from "@/lib/planner/rollover";
import { normalizeCoachBullets, stripMarkdownBold } from "@/lib/format-bullets";
import { generateWeeklyNutritionFocus } from "@/lib/ai/weekly-nutrition-focus";
import type { WeeklyNutritionFocus } from "@/lib/ai/weekly-nutrition-focus";
import type { SessionProp, WorkoutPlanProp, WorkoutBlock } from "@/components/session-card";
import type { IssueItem } from "@/components/active-issues";
import type { StravaLinkProp } from "@/components/strava-panel";

// Explicit type covering only what this page uses — bypasses Prisma 6 inference bug
// when two same-model findFirst calls are in the same Promise.all.
type PlanWithSessions = {
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

const USER_ID = "user_maxon";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const READINESS_TAG_LABELS: Record<string, string> = {
  alcohol: "Alcohol",
  poor_sleep: "Poor sleep",
  stress: "Stress",
  travel: "Travel",
  soreness: "Soreness",
  stomach: "Stomach",
};

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

export default async function WeekPage() {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID } });

  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: user.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  // Shared rollover — activates next-week draft if its Monday has arrived.
  // Fires from any main route so the user never sees a stale active plan.
  if (await activateDraftIfReady(USER_ID, todayStr)) {
    redirect("/week");
  }

  const stravaConnection = await prisma.stravaConnection.findUnique({ where: { userId: USER_ID } });
  const stravaConnected = !!stravaConnection;

  const [planRaw, draftPlan, injuryCheckIns] = await Promise.all([
    prisma.trainingPlan.findFirst({
      where: { userId: USER_ID, status: "active" },
      include: {
        sessions: {
          include: { checkIn: true },
          orderBy: [{ scheduledDate: "asc" }, { preferredSlot: "asc" }],
        },
      },
    }),
    prisma.trainingPlan.findFirst({
      where: { userId: USER_ID, status: "draft" },
      orderBy: { startsAt: "desc" },
      include: {
        sessions: {
          include: { checkIn: true },
          orderBy: [{ scheduledDate: "asc" }, { preferredSlot: "asc" }],
        },
      },
    }),
    prisma.checkIn.findMany({
      where: { userId: USER_ID, resolvedAt: null, feelScore: { lte: 3 } },
      include: { session: true },
      orderBy: { occurredAt: "desc" },
    }),
  ]);

  // Readiness chip: only today's non-ok signal is relevant on the week view.
  // Yesterday's readiness is stale — hide it so it doesn't linger as a false warning.
  const todayDate = new Date(todayStr + "T00:00:00Z");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pc = prisma as any;

  const [latestReadiness, nutritionProfileRaw] = await Promise.all([
    planRaw
      ? pc.dailyReadiness.findFirst({
          where: {
            userId: USER_ID,
            date: { gte: todayDate },
            category: { not: "ok" },
          },
          orderBy: { date: "desc" },
        }) as Promise<{ id: string; category: string; feelScore: number; tags: unknown } | null>
      : Promise.resolve(null),
    pc.nutritionProfile.findUnique({ where: { userId: USER_ID } }) as Promise<{
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
  ]);

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
    return (
      <main className="p-4 space-y-4">
        <h1 className="mb-4 text-xl font-bold">Week</h1>
        <ActiveIssues initialIssues={activeIssues} />
        <p className="text-gray-500">No active plan.</p>
        <ReplanButton mode="generate" />
        {draftPlan && (
          <DraftPreview plan={draftPlan} todayStr={todayStr} />
        )}
      </main>
    );
  }

  // Cast through unknown — Prisma 6 loses fields when same model appears twice in Promise.all
  const plan = planRaw as unknown as PlanWithSessions;

  const sessionIds = plan.sessions.map((s) => s.id);

  // Batch-load Strava links for all sessions — avoids doubly-nested include type issues
  const stravaLinksBySession: Record<string, StravaLinkProp[]> = {};
  const workoutPlansBySession: Record<string, WorkoutPlanProp> = {};

  if (stravaConnected) {
    const allLinks = await pc.sessionStravaActivityLink.findMany({
      where: { sessionId: { in: sessionIds } },
      include: { activity: true },
      orderBy: { createdAt: "asc" },
    }) as Array<{ id: string; sessionId: string; isPrimary: boolean; activity: { id: string; stravaActivityId: string; name: string; sportType: string; startDate: Date; distance: number; movingTime: number; elapsedTime: number; totalElevationGain: number; averageSpeed: number; averageHeartrate: number | null; maxHeartrate: number | null } }>;
    for (const l of allLinks) {
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
  }

  {
    const allWp = await pc.sessionWorkoutPlan.findMany({
      where: { sessionId: { in: sessionIds } },
    }) as Array<{ id: string; sessionId: string; planType: string; goal: string; target: string | null; blocks: unknown; rules: unknown; alternatives: unknown; summary: string | null }>;
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
  }

  // Generate weekly nutrition focus in parallel with session data assembly
  let weeklyNutritionFocus: WeeklyNutritionFocus | null = null;
  try {
    weeklyNutritionFocus = await generateWeeklyNutritionFocus({
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
    });
  } catch {
    weeklyNutritionFocus = null;
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
    });
  }

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(plan.startsAt);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().split("T")[0];
  });

  return (
    <main className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Week</h1>
        <ReplanButton mode="replan" />
      </div>

      {latestReadiness && (
        <div className="flex flex-wrap items-center gap-1.5 rounded bg-amber-50 px-2.5 py-1 text-xs text-amber-700">
          <span className="font-medium">
            {latestReadiness.category === "injury" ? "Injury" : "Fatigue"} · {latestReadiness.feelScore}/6
          </span>
          {(latestReadiness.tags as string[]).length > 0 && (
            <>
              <span>·</span>
              <span>
                {(latestReadiness.tags as string[])
                  .map((t) => READINESS_TAG_LABELS[t] ?? t)
                  .join(", ")}
              </span>
            </>
          )}
        </div>
      )}

      <ActiveIssues initialIssues={activeIssues} />

      {plan.focusSummary && (
        <div className="rounded border border-blue-100 bg-blue-50 px-3 py-2.5 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-400">Coach focus</p>
          <ul className="space-y-1">
            {normalizeCoachBullets(plan.focusSummary)
              .split("\n\n")
              .filter((l) => l.trim())
              .map((line, i) => (
                <li key={i} className="text-xs text-blue-800">
                  · {line.replace(/^[•·]\s*/, "")}
                </li>
              ))}
          </ul>
        </div>
      )}
      {plan.changeExplanation && (
        <div className="rounded border-l-2 border-blue-400 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          <p className="font-medium mb-1">What changed:</p>
          <div className="space-y-1">
            {normalizeCoachBullets(plan.changeExplanation)
              .split("\n\n")
              .filter((l) => l.trim())
              .map((line, i) => (
                <p key={i}>{line}</p>
              ))}
          </div>
        </div>
      )}

      {weeklyNutritionFocus && weeklyNutritionFocus.bullets.length > 0 && (
        <div className="rounded border border-green-100 bg-green-50 px-3 py-2.5 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-green-600">Weekly nutrition focus</p>
          <ul className="space-y-1">
            {weeklyNutritionFocus.bullets.map((b, i) => (
              <li key={i} className="text-xs text-green-800">· {stripMarkdownBold(b)}</li>
            ))}
          </ul>
        </div>
      )}

      {weekDays.map((dateStr, i) => {
        const daySessions = sessionsByDate[dateStr] ?? [];
        const isPast = dateStr < todayStr;

        return (
          <div key={dateStr}>
            <p
              className={`mb-1 text-sm font-semibold ${
                isPast ? "text-gray-300" : "text-gray-400"
              }`}
            >
              {DOW[i]} · {dateStr}
              {isPast && <span className="ml-1.5 text-xs font-normal text-gray-300">past</span>}
            </p>
            {daySessions.length === 0 ? (
              <p className={isPast ? "text-xs text-gray-300" : "text-sm text-gray-400"}>Rest</p>
            ) : (
              <div className="space-y-2">
                {daySessions.map((s) => (
                  <SessionCard key={s.id} session={s} todayStr={todayStr} />
                ))}
              </div>
            )}
            <div className="mt-1.5">
              <ManualSessionForm defaultDate={dateStr} />
            </div>
          </div>
        );
      })}

      {draftPlan && <DraftPreview plan={draftPlan} todayStr={todayStr} />}
    </main>
  );
}

type DraftSession = {
  scheduledDate: Date;
  durationMin: number;
  intensity: string;
  notes: string | null;
  preferredSlot: string;
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
    <div className="mt-6 border-t pt-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-500">Next week · draft</p>
        <span className="text-xs text-gray-400">{weekStartStr}</span>
      </div>
      {plan.focusSummary && (
        <div className="space-y-1">
          {normalizeCoachBullets(plan.focusSummary)
            .split("\n\n")
            .filter((l) => l.trim())
            .map((line, i) => (
              <p key={i} className="text-xs text-gray-400">{line}</p>
            ))}
        </div>
      )}
      {weekDays.map((dateStr, i) => {
        const daySessions = sessionsByDate[dateStr] ?? [];
        return (
          <div key={dateStr}>
            <p className="mb-0.5 text-xs text-gray-400">
              {DOW[i]} · {dateStr}
            </p>
            {daySessions.length === 0 ? (
              <p className="text-xs text-gray-300">Rest</p>
            ) : (
              <div className="space-y-1">
                {daySessions.map((s, idx) => (
                  <div
                    key={idx}
                    className="rounded border border-gray-100 bg-gray-50 px-2.5 py-1.5"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium capitalize text-gray-600">
                        {s.intensity}
                      </span>
                      <span className="text-xs text-gray-400">{s.durationMin}min</span>
                      <span className="text-xs text-gray-400 capitalize">{s.preferredSlot}</span>
                      {s.notes && (
                        <span className="text-xs text-gray-500">{s.notes.split(":")[0]}</span>
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
