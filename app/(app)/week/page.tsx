import { prisma } from "@/lib/prisma";
import { SessionCard } from "@/components/session-card";
import { ReplanButton } from "@/components/replan-button";
import type { SessionProp } from "@/components/session-card";

export const dynamic = "force-dynamic";

const USER_ID = "user_maxon";
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

  if (!plan) {
    return (
      <main className="p-4">
        <h1 className="mb-4 text-xl font-bold">Week</h1>
        <p className="mb-4 text-gray-500">No active plan.</p>
        <ReplanButton mode="generate" />
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
    </main>
  );
}
