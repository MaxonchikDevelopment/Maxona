import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { requireSessionUserIdFromCookies } from "@/lib/auth/session";
import Link from "next/link";
import { buildHrZones } from "@/lib/training/zones";
import { deriveWorkoutIntent } from "@/lib/ai/workout-plan";
import { ExecutionSummaryBlock } from "@/components/execution-summary-block";
import { CoachViewActions } from "@/components/coach-view-actions";
import { WorkoutFeedbackSection } from "@/components/workout-feedback-section";
import { SessionAnalytics } from "@/components/session-analytics";
import { AnalyzeStreamButton } from "@/components/analyze-stream-button";
import { buildHrAnalytics } from "@/lib/analytics/hr-stream";
import { PageWrapper } from "@/components/ui/page-wrapper";
import type { WorkoutFeedbackProp } from "@/components/workout-feedback-section";
import type { WorkoutBlock } from "@/components/session-card";

export const dynamic = "force-dynamic";

function intensityChip(intensity: string) {
  if (intensity === "easy") return "bg-emerald-50 text-emerald-700";
  if (intensity === "hard") return "bg-red-50 text-red-700";
  return "bg-amber-50 text-amber-700";
}

function borderColor(intensity: string) {
  if (intensity === "easy") return "border-emerald-200";
  if (intensity === "hard") return "border-red-300";
  return "border-amber-200";
}

const STATUS_COLOR: Record<string, string> = {
  planned: "text-zinc-500",
  done: "text-emerald-600",
  skipped: "text-zinc-400",
};

const INTENT_LABEL: Record<string, string> = {
  recovery_run: "Recovery run",
  aerobic_base: "Aerobic base",
  tempo_run: "Tempo run",
  marathon_pace: "Marathon pace",
  long_run: "Long run",
  recovery_ride: "Recovery ride",
  aerobic_ride: "Aerobic ride",
  technique_swim: "Technique swim",
  endurance_swim: "Endurance swim",
  hybrid_engine: "Hybrid engine",
  hybrid_race_prep: "Hybrid race prep",
  hybrid_strength: "Hybrid strength",
  hybrid_technique: "Hybrid technique",
};

function planTypeLabel(planType: string): string {
  return planType.replace(/_/g, " ").replace(/hybrid /i, "Hybrid ");
}

export default async function SessionCoachViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userId = await requireSessionUserIdFromCookies();
  const { id } = await params;

  const session = await prisma.trainingSession.findFirst({
    where: { id, userId },
    include: {
      checkIn: true,
      workoutPlan: true,
      workoutFeedback: true,
      stravaLinks: {
        include: { activity: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!session) notFound();

  const trainingProfile = await prisma.userTrainingProfile.findUnique({
    where: { userId },
  });

  const plan = session.workoutPlan;
  const blocks = plan ? (plan.blocks as WorkoutBlock[]) : [];
  const rules = plan ? (plan.rules as string[]) : [];
  const alternatives = plan ? (plan.alternatives as string[] | null) : null;

  const dateStr = session.scheduledDate.toISOString().split("T")[0];
  const planType = plan?.planType ?? derivePlanType(session.notes);
  const workoutIntent = deriveWorkoutIntent(session.notes, session.intensity, planType);
  const intentLabel = INTENT_LABEL[workoutIntent];

  const zones = trainingProfile ? buildHrZones(trainingProfile) : null;

  const rawFeedback = session.workoutFeedback;
  const initialFeedback: WorkoutFeedbackProp | null = rawFeedback
    ? {
        id: rawFeedback.id,
        adherenceLabel: rawFeedback.adherenceLabel,
        summary: rawFeedback.summary,
        bullets: Array.isArray(rawFeedback.bullets)
          ? (rawFeedback.bullets as string[])
          : [],
        nextAdjustment: rawFeedback.nextAdjustment,
        generatedAt: rawFeedback.generatedAt.toISOString(),
      }
    : null;

  const stravaLinks = session.stravaLinks.map((l) => ({
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
  }));

  const primaryLink =
    session.status === "done"
      ? session.stravaLinks.find((l) => l.isPrimary) ?? session.stravaLinks[0] ?? null
      : null;

  const activityWithStream = primaryLink
    ? await prisma.stravaActivity.findUnique({
        where: { id: primaryLink.activity.id },
        select: {
          id: true,
          calories: true,
          stream: {
            select: {
              time: true,
              heartrate: true,
            },
          },
        },
      })
    : null;

  const hrAnalytics = (() => {
    if (!activityWithStream?.stream) return null;
    const { time, heartrate } = activityWithStream.stream;
    if (!Array.isArray(time) || !Array.isArray(heartrate)) return null;
    return buildHrAnalytics(
      time as number[],
      heartrate as number[],
      trainingProfile,
      session.intensity
    );
  })();

  return (
    <main className="relative min-h-screen px-4 lg:px-6 xl:px-8 pt-0 pb-24 lg:pb-8">
      {/* ── Back nav + hero ────────────────────────────────────────── */}
      <div className="pt-6 pb-4">
        <div className="lg:rounded-2xl lg:bg-white/70 lg:backdrop-blur-sm lg:border lg:border-zinc-100/80 lg:shadow-sm lg:px-5 lg:py-4">
          <div className="flex items-center gap-2 text-xs text-zinc-400 mb-3">
            <Link href="/today" className="hover:text-zinc-600 transition-colors">
              Today
            </Link>
            <span className="text-zinc-200">·</span>
            <Link href="/week" className="hover:text-zinc-600 transition-colors">
              Week
            </Link>
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">
            Session
          </p>
          <h1 className="text-[26px] font-bold tracking-tight text-zinc-900 leading-none">
            {session.notes ?? dateStr}
          </h1>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="text-xs text-zinc-400">{dateStr}</span>
            <span className="text-zinc-200">·</span>
            <span className={`text-xs capitalize font-medium ${STATUS_COLOR[session.status] ?? "text-zinc-500"}`}>
              {session.status}
            </span>
          </div>
        </div>
      </div>

      <PageWrapper>
        <div className="space-y-3">
          {/* A: Session chips */}
          <div className="rounded-2xl bg-white border border-zinc-100 shadow-card p-4">
            <div className="flex flex-wrap gap-2 items-center text-xs">
              <span className={`rounded-full px-2.5 py-1 capitalize font-semibold text-[11px] ${intensityChip(session.intensity)}`}>
                {session.intensity}
              </span>
              <span className="rounded-full bg-zinc-50 border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-500">
                {session.durationMin} min
              </span>
              <span className="rounded-full bg-zinc-50 border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-500 capitalize">
                {session.preferredSlot}
              </span>
              {session.planningType === "fixed" && (
                <span className="rounded-full bg-zinc-100 border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-500">
                  Fixed
                </span>
              )}
              {session.planningType === "preferred" && (
                <span className="rounded-full bg-indigo-50 border border-indigo-100 px-2.5 py-1 text-[11px] font-medium text-indigo-600">
                  Optional
                </span>
              )}
              {intentLabel && (
                <span className="rounded-full bg-indigo-50 border border-indigo-100 px-2.5 py-1 text-[11px] font-medium text-indigo-600">
                  {intentLabel}
                </span>
              )}
            </div>
          </div>

          {/* B: Coach overview */}
          {plan ? (
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50 shadow-card p-4 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-400">
                Coach overview
              </p>
              <p className="text-sm font-medium text-indigo-900">{plan.goal}</p>
              {plan.target && (
                <p className="text-xs font-medium text-indigo-700">{plan.target}</p>
              )}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-indigo-500">
                <span>Type: {planTypeLabel(plan.planType)}</span>
              </div>
              {zones && (
                <p className="text-[10px] text-indigo-400 pt-0.5">
                  Z1 {zones.z1.min}–{zones.z1.max} · Z2 {zones.z2.min}–{zones.z2.max} · Z3{" "}
                  {zones.z3.min}–{zones.z3.max} · Z4 {zones.z4.min}–{zones.z4.max} bpm
                </p>
              )}
              {plan.summary && (
                <p className="text-xs text-indigo-600 italic">{plan.summary}</p>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-6 text-center">
              <p className="text-sm text-zinc-400">No workout plan yet.</p>
              <p className="text-xs text-zinc-300 mt-1">
                Generate one below to see the full briefing.
              </p>
            </div>
          )}

          {/* C: Workout blocks */}
          {blocks.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 px-0.5">
                Workout
              </p>
              {blocks.map((block, i) => (
                <div
                  key={i}
                  className={`rounded-xl border-l-[3px] bg-zinc-50 px-3 py-2.5 space-y-1 ${borderColor(block.intensity)}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-zinc-800">{block.label}</span>
                    <span className="text-xs text-zinc-400">{block.durationMin}m</span>
                    <span className={`text-[10px] capitalize rounded-full px-2 py-0.5 font-semibold ${intensityChip(block.intensity)}`}>
                      {block.intensity}
                    </span>
                    {block.zone && (
                      <span className="text-[10px] font-mono text-indigo-500">{block.zone}</span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-600 leading-relaxed">{block.description}</p>
                  {block.cue && (
                    <p className="text-[11px] text-indigo-600 italic">↳ {block.cue}</p>
                  )}
                  {block.stationCues && block.stationCues.length > 0 && (
                    <div className="pt-1 space-y-0.5">
                      {block.stationCues.map((cue, j) => (
                        <p key={j} className="text-[11px] text-zinc-500">
                          {j + 1}. {cue}
                        </p>
                      ))}
                    </div>
                  )}
                  {block.successCriteria && (
                    <p className="text-[11px] text-emerald-600">✓ {block.successCriteria}</p>
                  )}
                  {block.modification && (
                    <p className="text-[11px] text-amber-600">
                      ⬇ If conditions degrade: {block.modification}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* D: Rules */}
          {rules.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 px-0.5">
                Rules
              </p>
              <div className="rounded-2xl bg-white border border-zinc-100 shadow-card px-4 py-3 space-y-1.5">
                {rules.map((r, i) => (
                  <p key={i} className="text-xs text-zinc-600 flex items-start gap-1.5">
                    <span className="text-zinc-300 mt-0.5 shrink-0">·</span>
                    <span>{r}</span>
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* E: Alternatives */}
          {alternatives && alternatives.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 px-0.5">
                Alternatives
              </p>
              <div className="rounded-2xl bg-white border border-zinc-100 shadow-card px-4 py-3 space-y-1.5">
                {alternatives.map((a, i) => (
                  <p key={i} className="text-xs text-zinc-600 flex items-start gap-1.5">
                    <span className="text-zinc-300 mt-0.5 shrink-0">·</span>
                    <span>{a}</span>
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Execution summary */}
          {session.status === "done" && stravaLinks.length > 0 && (
            <ExecutionSummaryBlock
              session={{ durationMin: session.durationMin, notes: session.notes }}
              stravaLinks={stravaLinks}
            />
          )}

          {/* HR Analytics */}
          {session.status === "done" && (
            <div className="rounded-2xl bg-white border border-zinc-100 shadow-card p-4 space-y-3">
              {stravaLinks.length === 0 ? (
                <p className="text-xs text-zinc-400">
                  Attach a Strava activity to see heart-rate analytics.
                </p>
              ) : !activityWithStream?.stream ? (
                <AnalyzeStreamButton activityId={activityWithStream?.id ?? primaryLink!.activity.id} />
              ) : !hrAnalytics ? (
                <p className="text-xs text-zinc-400">
                  Heart-rate stream not available for this activity.
                </p>
              ) : (
                <SessionAnalytics
                  analytics={hrAnalytics}
                  calories={activityWithStream.calories}
                />
              )}
            </div>
          )}

          {/* After workout / Workout feedback */}
          <WorkoutFeedbackSection
            sessionId={id}
            initialFeedback={initialFeedback}
            sessionIsDone={session.status === "done"}
            hasCheckIn={!!session.checkIn}
          />

          {/* Actions */}
          <CoachViewActions sessionId={id} hasPlan={!!plan} />
        </div>
      </PageWrapper>
    </main>
  );
}

function derivePlanType(notes: string | null): string {
  const lower = (notes ?? "").toLowerCase();
  if (lower.startsWith("running")) return "running";
  if (lower.startsWith("cycling")) return "cycling";
  if (lower.startsWith("swimming")) return "swimming";
  if (
    lower.includes("hyrox") ||
    lower.includes("hybrid") ||
    lower.includes("station") ||
    lower.includes("circuit") ||
    lower.startsWith("strength")
  )
    return "hybrid_station_circuit";
  return "other";
}
