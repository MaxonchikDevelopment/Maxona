import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { SessionCard } from "@/components/session-card";
import { ActiveIssues } from "@/components/active-issues";
import { ReplanButton } from "@/components/replan-button";
import { categorizeCheckIn } from "@/lib/checkin-utils";
import type { SessionProp } from "@/components/session-card";
import type { IssueItem } from "@/components/active-issues";

export const dynamic = "force-dynamic";

const USER_ID = "user_maxon";
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

export default async function WeekPage() {
  const [user, plan] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: USER_ID } }),
    prisma.trainingPlan.findFirst({
      where: { userId: USER_ID, status: "active" },
      include: {
        sessions: {
          include: { checkIn: true },
          orderBy: [{ scheduledDate: "asc" }, { preferredSlot: "asc" }],
        },
      },
    }),
  ]);

  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: user.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  // Check for a draft plan whose week has started — auto-activate it
  const draftPlan = await prisma.trainingPlan.findFirst({
    where: { userId: USER_ID, status: "draft" },
    orderBy: { startsAt: "desc" },
    include: {
      sessions: {
        include: { checkIn: true },
        orderBy: [{ scheduledDate: "asc" }, { preferredSlot: "asc" }],
      },
    },
  });

  if (draftPlan && todayStr >= toDateStr(draftPlan.startsAt)) {
    await prisma.$transaction(async (tx) => {
      if (plan) {
        await tx.trainingPlan.update({ where: { id: plan.id }, data: { status: "archived" } });
      }
      await tx.trainingPlan.update({ where: { id: draftPlan.id }, data: { status: "active" } });
    });
    redirect("/week");
  }

  // Active injury check-ins (across all time — injury tracking is persistent)
  const injuryCheckIns = await prisma.checkIn.findMany({
    where: { userId: USER_ID, resolvedAt: null, feelScore: { lte: 3 } },
    include: { session: true },
    orderBy: { occurredAt: "desc" },
  });

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

  if (!plan) {
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

      <ActiveIssues initialIssues={activeIssues} />

      {plan.focusSummary && (
        <p className="text-sm italic text-gray-600">{plan.focusSummary}</p>
      )}
      {plan.changeExplanation && (
        <div className="rounded border-l-2 border-blue-400 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          <p className="font-medium mb-1">What changed:</p>
          <p className="whitespace-pre-line">{plan.changeExplanation}</p>
        </div>
      )}

      {weekDays.map((dateStr, i) => {
        const daySessions = sessionsByDate[dateStr] ?? [];
        const isPast = dateStr < todayStr;
        const allDone =
          daySessions.length > 0 &&
          daySessions.every((s) => s.status === "done" || s.status === "skipped");
        const showCompact = isPast && allDone;

        return (
          <div key={dateStr}>
            <p
              className={`mb-1 ${
                showCompact
                  ? "text-xs text-gray-400"
                  : "text-sm font-semibold text-gray-400"
              }`}
            >
              {DOW[i]} · {dateStr}
            </p>
            {daySessions.length === 0 ? (
              <p className={showCompact ? "text-xs text-gray-300" : "text-sm text-gray-400"}>
                Rest
              </p>
            ) : showCompact ? (
              <div className="flex flex-wrap gap-1.5">
                {daySessions.map((s) => (
                  <span
                    key={s.id}
                    className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500"
                  >
                    {s.intensity} · {s.durationMin}min
                    {s.checkIn ? ` · ${s.checkIn.feelScore}/6` : ""}
                    {s.notes ? ` · ${s.notes.split(":")[0]}` : ""}
                  </span>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {daySessions.map((s) => (
                  <SessionCard key={s.id} session={s} />
                ))}
              </div>
            )}
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
        <p className="text-xs italic text-gray-400">{plan.focusSummary}</p>
      )}
      {weekDays.map((dateStr, i) => {
        const daySessions = sessionsByDate[dateStr] ?? [];
        return (
          <div key={dateStr}>
            <p className="text-xs text-gray-400 mb-0.5">
              {DOW[i]} · {dateStr}
            </p>
            {daySessions.length === 0 ? (
              <p className="text-xs text-gray-300">Rest</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {daySessions.map((s, idx) => (
                  <span
                    key={idx}
                    className="rounded bg-gray-50 border border-gray-200 px-2 py-0.5 text-xs text-gray-500"
                  >
                    {s.intensity} · {s.durationMin}min
                    {s.notes ? ` · ${s.notes.split(":")[0]}` : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
