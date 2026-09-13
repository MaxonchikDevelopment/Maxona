import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserIdFromRequest } from "@/lib/auth/session";

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function minToHm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function fmtDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function fmtPace(movingTimeSec: number, distanceKm: number | null): string {
  if (!distanceKm || distanceKm <= 0) return "—";
  const secPerKm = movingTimeSec / distanceKm;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

export async function GET(request: NextRequest) {
  const userId = await getSessionUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const [availabilityWindows, scheduleEvents, latestWeekSummary] = await Promise.all([
    prisma.availabilityWindow.findMany({ where: { userId } }),
    prisma.scheduleEvent.findMany({
      where: { userId, startsAt: { gte: now, lte: in14Days } },
      orderBy: { startsAt: "asc" },
    }),
    prisma.weekSummary.findFirst({
      where: { userId },
      orderBy: { weekEnd: "desc" },
    }),
  ]);

  let usedFallback = false;
  let rangeStart: Date;
  let rangeEnd: Date;

  if (latestWeekSummary) {
    rangeStart = latestWeekSummary.weekStart;
    rangeEnd = latestWeekSummary.weekEnd;
  } else {
    usedFallback = true;
    rangeEnd = now;
    rangeStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  const sessionMetrics = await prisma.sessionMetrics.findMany({
    where: {
      session: {
        userId,
        scheduledDate: { gte: rangeStart, lte: rangeEnd },
      },
    },
    include: { session: true },
    orderBy: { session: { scheduledDate: "asc" } },
  });

  const lines: string[] = [];
  lines.push(`# Context export — ${fmtDate(now)}`);
  lines.push("");

  lines.push("## Availability");
  if (availabilityWindows.length === 0) {
    lines.push("No recurring availability windows configured.");
  } else {
    const sorted = [...availabilityWindows].sort(
      (a, b) => DAY_ORDER.indexOf(a.dayOfWeek) - DAY_ORDER.indexOf(b.dayOfWeek) || a.timeStartMin - b.timeStartMin
    );
    lines.push("| Day | Window |");
    lines.push("| --- | --- |");
    for (const w of sorted) {
      lines.push(`| ${w.dayOfWeek} | ${minToHm(w.timeStartMin)}–${minToHm(w.timeEndMin)} |`);
    }
  }
  lines.push("");
  lines.push("### Upcoming blocked / travel events (next 14 days)");
  if (scheduleEvents.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| Starts | Ends | Kind | Note |");
    lines.push("| --- | --- | --- | --- |");
    for (const e of scheduleEvents) {
      lines.push(
        `| ${e.startsAt.toISOString()} | ${e.endsAt.toISOString()} | ${e.kind} | ${e.note ?? "—"} |`
      );
    }
  }
  lines.push("");

  if (usedFallback) {
    lines.push(
      `## Last completed week (fallback: no WeekSummary yet — showing sessions from ${fmtDate(rangeStart)}–${fmtDate(rangeEnd)})`
    );
  } else {
    lines.push(`## Last completed week (${fmtDate(rangeStart)}–${fmtDate(rangeEnd)})`);
  }
  if (sessionMetrics.length === 0) {
    lines.push("No session metrics recorded in this range.");
  } else {
    lines.push("| date | distanceKm | pace | avgHr | efWhole | decouplingPct | cadenceSpm | powerAvg |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const m of sessionMetrics) {
      const decoupling = m.decouplingValid && m.decouplingPct != null ? `${m.decouplingPct.toFixed(1)}%` : "—";
      lines.push(
        `| ${fmtDate(m.session.scheduledDate)} | ${m.distanceKm.toFixed(2)} | ${fmtPace(m.movingTimeSec, m.distanceKm)} | ${m.avgHr?.toFixed(0) ?? "—"} | ${m.efWhole?.toFixed(3) ?? "—"} | ${decoupling} | ${m.cadenceSpm?.toFixed(0) ?? "—"} | ${m.powerAvg?.toFixed(0) ?? "—"} |`
      );
    }
  }
  lines.push("");

  if (latestWeekSummary?.narrativeMd) {
    lines.push(latestWeekSummary.narrativeMd);
    lines.push("");
  }

  lines.push("## Adherence");
  if (latestWeekSummary) {
    lines.push(`- planned: ${latestWeekSummary.planned}`);
    lines.push(`- done: ${latestWeekSummary.done}`);
    lines.push(`- skipped: ${latestWeekSummary.skipped}`);
    lines.push(`- adherenceByCount: ${latestWeekSummary.adherenceByCount}%`);
    lines.push(
      `- adherenceByDuration: ${latestWeekSummary.adherenceByDuration != null ? `${latestWeekSummary.adherenceByDuration}%` : "—"}`
    );
  } else {
    lines.push("No WeekSummary available yet — adherence figures cannot be computed.");
  }

  const markdown = lines.join("\n");

  return NextResponse.json({ markdown });
}
