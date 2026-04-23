import { prisma } from "@/lib/prisma";
import { SessionCard } from "@/components/session-card";
import type { SessionProp } from "@/components/session-card";

export const dynamic = "force-dynamic";

const USER_ID = "user_maxon";

export default async function TodayPage() {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID } });

  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: user.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = todayStr.split("-").map(Number);
  const todayDate = new Date(Date.UTC(y, m - 1, d));

  const sessions = await prisma.trainingSession.findMany({
    where: {
      userId: USER_ID,
      scheduledDate: todayDate,
      plan: { status: "active" },
    },
    include: { checkIn: true },
    orderBy: { preferredSlot: "asc" },
  });

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
  }));

  return (
    <main className="p-4">
      <h1 className="mb-4 text-xl font-bold">Today</h1>
      {props.length === 0 ? (
        <p className="text-gray-500">Rest day — nothing scheduled.</p>
      ) : (
        <div className="space-y-3">
          {props.map((s) => (
            <SessionCard key={s.id} session={s} />
          ))}
        </div>
      )}
    </main>
  );
}
