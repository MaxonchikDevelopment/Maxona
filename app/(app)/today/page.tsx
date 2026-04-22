import { prisma } from "@/lib/prisma";
import { SessionCard } from "@/components/session-card";
import type { SessionProp } from "@/components/session-card";

export const dynamic = "force-dynamic";

const USER_ID = "user_maxon";

export default async function TodayPage() {
  const now = new Date();
  const todayDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );

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
      ? { id: s.checkIn.id, feelScore: s.checkIn.feelScore, notes: s.checkIn.notes }
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
