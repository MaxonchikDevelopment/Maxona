import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { SessionCard } from "@/components/session-card";
import { ActiveIssues } from "@/components/active-issues";
import { DailyReadinessCard } from "@/components/daily-readiness-card";
import { SignalsHistory } from "@/components/signals-history";
import { categorizeCheckIn } from "@/lib/checkin-utils";
import { activateDraftIfReady } from "@/lib/planner/rollover";
import type { SessionProp } from "@/components/session-card";
import type { ReadinessProp } from "@/components/daily-readiness-card";
import type { IssueItem } from "@/components/active-issues";
import type { SignalHistoryItem } from "@/components/signals-history";

export const dynamic = "force-dynamic";

const USER_ID = "user_maxon";

function buildImplicationLine(
  readiness: ReadinessProp | null,
  activeIssues: IssueItem[],
  latestCheckIn: { feelScore: number; category: string; sessionNotes: string | null } | null,
  nextPlanned: { intensity: string; notes: string | null } | null
): string | null {
  const nextLabel =
    nextPlanned?.notes?.split(":")[0].trim() ??
    (nextPlanned ? nextPlanned.intensity : null);

  // 1. Active injury from past check-ins
  if (activeIssues.length > 0) {
    const issue = activeIssues[0];
    const issueLabel = issue.sessionNotes?.split(":")[0].trim() ?? "injury";
    if (nextPlanned && nextPlanned.intensity === "hard") {
      return `${issueLabel} still active — ${nextLabel} moved to easy`;
    }
    return `${issueLabel} still active — hard sessions blocked`;
  }

  // 2. Today's workout check-in was bad
  if (latestCheckIn && latestCheckIn.feelScore <= 3) {
    if (latestCheckIn.category === "injury") {
      const sport = latestCheckIn.sessionNotes?.split(":")[0].trim() ?? "session";
      if (nextPlanned) {
        return `Injury flagged in ${sport} — ${nextLabel} stays easy or rest`;
      }
      return "Injury flagged — next session stays easy";
    }
    if (latestCheckIn.category === "fatigue") {
      if (nextPlanned) {
        return `Fatigue noted today — ${nextLabel} kept lighter`;
      }
      return "Fatigue noted — next session kept lighter";
    }
  }

  // 3. Readiness-based signals
  if (!readiness) return null;

  if (readiness.category === "injury" && readiness.feelScore <= 3) {
    return "Possible injury flagged — plan will protect next sessions";
  }
  if (readiness.category === "fatigue" && readiness.feelScore <= 3) {
    if (nextPlanned) {
      return `Fatigue noted — ${nextLabel} stays lighter`;
    }
    return "Fatigue noted — next session kept lighter";
  }
  if ((readiness.tags as string[]).some((t) => ["alcohol", "poor_sleep"].includes(t))) {
    if (nextPlanned) {
      return `Poor recovery signal — ${nextLabel} may be shorter`;
    }
    return "Poor recovery signal — tomorrow's session may be shorter";
  }

  // 4. All good with next session reference
  if (nextPlanned && readiness.feelScore >= 5) {
    return `Plan on track — ${nextLabel} ahead`;
  }

  return null;
}

export default async function TodayPage() {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID } });

  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: user.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  // Shared rollover — activates next-week draft if its Monday has arrived,
  // regardless of which page the user opened first.
  if (await activateDraftIfReady(USER_ID, todayStr)) {
    redirect("/today");
  }

  const [y, m, d] = todayStr.split("-").map(Number);
  const todayDate = new Date(Date.UTC(y, m - 1, d));

  // 7-day signal window (includes today)
  const sevenDaysAgo = new Date(todayDate);
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);

  const [sessions, injuryCheckIns, readinessRecord, nextPlannedSession, historyReadiness, historyCheckIns] =
    await Promise.all([
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
      prisma.trainingSession.findFirst({
        where: {
          userId: USER_ID,
          plan: { status: "active" },
          status: "planned",
          scheduledDate: { gt: todayDate },
        },
        orderBy: { scheduledDate: "asc" },
      }),
      prisma.dailyReadiness.findMany({
        where: { userId: USER_ID, date: { gte: sevenDaysAgo } },
        orderBy: { date: "desc" },
      }),
      prisma.checkIn.findMany({
        where: {
          userId: USER_ID,
          occurredAt: { gte: sevenDaysAgo },
        },
        include: { session: true },
        orderBy: { occurredAt: "desc" },
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

  // Worst (lowest feel) check-in from today's sessions
  const todayCheckIn = sessions
    .filter((s) => s.checkIn)
    .map((s) => ({
      feelScore: s.checkIn!.feelScore,
      category: categorizeCheckIn(s.checkIn!.feelScore, s.checkIn!.notes),
      sessionNotes: s.notes,
    }))
    .sort((a, b) => a.feelScore - b.feelScore)[0] ?? null;

  const nextPlanned = nextPlannedSession
    ? { intensity: nextPlannedSession.intensity, notes: nextPlannedSession.notes }
    : null;

  const implicationLine = buildImplicationLine(readinessProp, activeIssues, todayCheckIn, nextPlanned);

  // Signal tier: unresolved injury first, resolved injury, fatigue, ok last.
  // Within same tier, most recent date first. This surfaces meaningful signals
  // before bland neutral entries, keeping the list useful when capped.
  function signalTier(item: { category: string; resolvedAt: string | null }): number {
    if (item.category === "injury" && !item.resolvedAt) return 0;
    if (item.category === "injury") return 1;
    if (item.category === "fatigue") return 2;
    return 3;
  }

  // Build history items (last 7 days), capped at 7
  const historyItems: SignalHistoryItem[] = [
    ...historyReadiness.map((r) => ({
      date: r.date.toISOString().split("T")[0],
      source: "readiness" as const,
      feelScore: r.feelScore,
      category: r.category,
      notePreview: r.notes ? r.notes.slice(0, 60) : null,
      sessionLabel: null,
      resolvedAt: null,
    })),
    ...historyCheckIns.map((ci) => ({
      date: ci.session.scheduledDate.toISOString().split("T")[0],
      source: "workout" as const,
      feelScore: ci.feelScore,
      category: categorizeCheckIn(ci.feelScore, ci.notes),
      notePreview: ci.notes ? ci.notes.slice(0, 60) : null,
      sessionLabel: ci.session.notes?.split(":")[0].trim() ?? null,
      resolvedAt: ci.resolvedAt?.toISOString() ?? null,
    })),
  ]
    .sort((a, b) => {
      const tierDiff = signalTier(a) - signalTier(b);
      if (tierDiff !== 0) return tierDiff;
      return b.date.localeCompare(a.date);
    })
    .slice(0, 7);

  return (
    <main className="p-4 space-y-3">
      <h1 className="text-xl font-bold">Today</h1>
      <DailyReadinessCard initialReadiness={readinessProp} todayStr={todayStr} />
      {props.length === 0 ? (
        <p className="text-sm text-gray-500">Rest day — nothing scheduled.</p>
      ) : (
        <div className="space-y-3">
          {props.map((s) => (
            <SessionCard key={s.id} session={s} todayStr={todayStr} />
          ))}
        </div>
      )}
      <ActiveIssues initialIssues={activeIssues} />
      {implicationLine && (
        <p className="text-xs text-gray-500 px-1">{implicationLine}</p>
      )}
      {historyItems.length > 0 && (
        <SignalsHistory items={historyItems} />
      )}
    </main>
  );
}
