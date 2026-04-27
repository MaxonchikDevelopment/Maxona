import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { buildHrZones } from "@/lib/training/zones";
import { deriveWorkoutIntent } from "@/lib/ai/workout-plan";
import { ExecutionSummaryBlock } from "@/components/execution-summary-block";
import { CoachViewActions } from "@/components/coach-view-actions";
import { WorkoutFeedbackSection } from "@/components/workout-feedback-section";
import type { WorkoutFeedbackProp } from "@/components/workout-feedback-section";
import type { WorkoutBlock } from "@/components/session-card";

export const dynamic = "force-dynamic";

const USER_ID = "user_maxon";

function intensityChip(intensity: string) {
  if (intensity === "easy") return "bg-green-50 text-green-700";
  if (intensity === "hard") return "bg-red-50 text-red-700";
  return "bg-amber-50 text-amber-700";
}

function borderColor(intensity: string) {
  if (intensity === "easy") return "border-green-200";
  if (intensity === "hard") return "border-red-300";
  return "border-amber-200";
}

const STATUS_COLOR: Record<string, string> = {
  planned: "text-gray-500",
  done: "text-green-600",
  skipped: "text-gray-400",
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
  const { id } = await params;

  const session = await prisma.trainingSession.findFirst({
    where: { id, userId: USER_ID },
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
    where: { userId: USER_ID },
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

  return (
    <main className="p-4 space-y-4 max-w-lg mx-auto">
      {/* Back nav */}
      <div className="flex items-center gap-3 text-sm text-gray-400">
        <Link href="/today" className="underline">
          Today
        </Link>
        <span className="text-gray-200">·</span>
        <Link href="/week" className="underline">
          Week
        </Link>
      </div>

      {/* A: Session header */}
      <div className="rounded border p-4 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-1">
          <p className="text-sm font-semibold text-gray-700">{dateStr}</p>
          <span
            className={`text-xs capitalize ${STATUS_COLOR[session.status] ?? "text-gray-500"}`}
          >
            {session.status}
          </span>
        </div>

        {session.notes && (
          <p className="text-base font-medium text-gray-800">{session.notes}</p>
        )}

        <div className="flex flex-wrap gap-2 items-center text-xs">
          <span
            className={`rounded px-1.5 py-0.5 capitalize font-medium ${intensityChip(session.intensity)}`}
          >
            {session.intensity}
          </span>
          <span className="text-gray-500">{session.durationMin} min</span>
          <span className="text-gray-400 capitalize">{session.preferredSlot}</span>
          {session.planningType === "fixed" && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500">fixed</span>
          )}
          {session.planningType === "preferred" && (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-500">optional</span>
          )}
          {intentLabel && (
            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-600">
              {intentLabel}
            </span>
          )}
        </div>
      </div>

      {/* B: Coach overview card */}
      {plan ? (
        <div className="rounded border border-indigo-100 bg-indigo-50 p-4 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-400">
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
        <div className="rounded border border-dashed border-gray-200 p-4 text-center">
          <p className="text-sm text-gray-400">No workout plan yet.</p>
          <p className="text-xs text-gray-300 mt-1">
            Generate one below to see the full briefing.
          </p>
        </div>
      )}

      {/* C: Workout blocks timeline */}
      {blocks.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Workout
          </p>
          {blocks.map((block, i) => (
            <div
              key={i}
              className={`rounded border-l-[3px] bg-gray-50 px-3 py-2.5 space-y-1 ${borderColor(block.intensity)}`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-800">{block.label}</span>
                <span className="text-xs text-gray-400">{block.durationMin}m</span>
                <span
                  className={`text-[10px] capitalize rounded px-1.5 py-0.5 ${intensityChip(block.intensity)}`}
                >
                  {block.intensity}
                </span>
                {block.zone && (
                  <span className="text-[10px] font-mono text-indigo-500">{block.zone}</span>
                )}
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">{block.description}</p>
              {block.cue && (
                <p className="text-[11px] text-indigo-600 italic">↳ {block.cue}</p>
              )}
              {block.stationCues && block.stationCues.length > 0 && (
                <div className="pt-1 space-y-0.5">
                  {block.stationCues.map((cue, j) => (
                    <p key={j} className="text-[11px] text-gray-500">
                      {j + 1}. {cue}
                    </p>
                  ))}
                </div>
              )}
              {block.successCriteria && (
                <p className="text-[11px] text-green-600">✓ {block.successCriteria}</p>
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
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Rules
          </p>
          <div className="rounded border bg-gray-50 px-3 py-2 space-y-1">
            {rules.map((r, i) => (
              <p key={i} className="text-xs text-gray-600">
                • {r}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* E: Alternatives */}
      {alternatives && alternatives.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Alternatives
          </p>
          <div className="rounded border bg-gray-50 px-3 py-2 space-y-1">
            {alternatives.map((a, i) => (
              <p key={i} className="text-xs text-gray-600">
                • {a}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Execution summary (done + Strava attached) */}
      {session.status === "done" && stravaLinks.length > 0 && (
        <ExecutionSummaryBlock
          session={{ durationMin: session.durationMin, notes: session.notes }}
          stravaLinks={stravaLinks}
        />
      )}

      {/* G: After workout / Workout feedback */}
      <WorkoutFeedbackSection
        sessionId={id}
        initialFeedback={initialFeedback}
        sessionIsDone={session.status === "done"}
        hasCheckIn={!!session.checkIn}
      />

      {/* H: Actions */}
      <CoachViewActions sessionId={id} hasPlan={!!plan} />
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
