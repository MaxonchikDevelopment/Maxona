import { prisma } from "@/lib/prisma";
import { SessionCard } from "@/components/session-card";
import { ActiveIssues } from "@/components/active-issues";
import { DailyReadinessCard } from "@/components/daily-readiness-card";
import { categorizeCheckIn } from "@/lib/checkin-utils";
import type { SessionProp } from "@/components/session-card";
import type { ReadinessProp } from "@/components/daily-readiness-card";
import type { IssueItem } from "@/components/active-issues";

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

  const [sessions, injuryCheckIns, readinessRecord] = await Promise.all([
    prisma.trainingSession.findMany({
      where: {
        userId: USER_ID,
        scheduledDate: todayDate,
        plan: { status: "active" },
      },
      include: { checkIn: true },
      orderBy: { preferredSlot: "asc" },
    }),
    prisma.checkIn.findMany({
      where: { userId: USER_ID, resolvedAt: null, feelScore: { lte: 3 } },
      include: { session: true },
      orderBy: { occurredAt: "desc" },
    }),
    prisma.dailyReadiness.findUnique({
      where: { userId_date: { userId: USER_ID, date: todayDate } },
    }),
  ]);

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

  return (
    <main className="p-4 space-y-3">
      <h1 className="mb-4 text-xl font-bold">Today</h1>
      <ActiveIssues initialIssues={activeIssues} />
      <DailyReadinessCard initialReadiness={readinessProp} todayStr={todayStr} />
      {props.length === 0 ? (
        <p className="text-gray-500">Rest day — nothing scheduled.</p>
      ) : (
        <div className="space-y-3">
          {props.map((s) => (
            <SessionCard key={s.id} session={s} todayStr={todayStr} />
          ))}
        </div>
      )}
    </main>
  );
}
