import { prisma } from "@/lib/prisma";
import { SessionCard } from "@/components/session-card";
import { ReplanButton } from "@/components/replan-button";
import type { SessionProp } from "@/components/session-card";

export const dynamic = "force-dynamic";

const USER_ID = "user_maxon";
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function WeekPage() {
  const plan = await prisma.trainingPlan.findFirst({
    where: { userId: USER_ID, status: "active" },
    include: {
      sessions: {
        include: { checkIn: true },
        orderBy: [{ scheduledDate: "asc" }, { preferredSlot: "asc" }],
      },
    },
  });

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
        ? { id: s.checkIn.id, feelScore: s.checkIn.feelScore, notes: s.checkIn.notes }
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
      {weekDays.map((dateStr, i) => {
        const daySessions = sessionsByDate[dateStr] ?? [];
        return (
          <div key={dateStr}>
            <p className="mb-1 text-sm font-semibold text-gray-400">
              {DOW[i]} · {dateStr}
            </p>
            {daySessions.length === 0 ? (
              <p className="text-sm text-gray-400">Rest</p>
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
