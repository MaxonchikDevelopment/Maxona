import { prisma } from "@/lib/prisma";
import { persistWeekSummary } from "@/lib/week-summary";
import { getOrCreateTunableDefaults } from "@/lib/planner/tunable-defaults";
import { reviewTunableDefaults, clampTunableProposal } from "@/lib/ai/tunable-review";
import type { WeekHistoryEntry } from "@/lib/ai/adapter";

/**
 * Activates the next-week draft plan if its start date has arrived.
 * Called from any page that needs up-to-date plan data so rollover
 * is not gated on the user visiting /week first.
 *
 * Returns true when a rollover happened (caller should redirect to
 * re-render the page with fresh data).
 */
export async function activateDraftIfReady(
  userId: string,
  todayStr: string,
): Promise<boolean> {
  const draft = await prisma.trainingPlan.findFirst({
    where: { userId, status: "draft" },
    orderBy: { startsAt: "desc" },
    select: { id: true, startsAt: true },
  });

  if (!draft) return false;

  const draftStartStr = draft.startsAt.toISOString().split("T")[0];
  if (todayStr < draftStartStr) return false;

  // Capture the plan about to be archived so we can freeze its retrospective.
  // Read before the activation transaction — a summary failure must never block rollover.
  const outgoingPlan = await prisma.trainingPlan.findFirst({
    where: { userId, status: "active" },
    orderBy: { startsAt: "desc" },
    include: {
      sessions: {
        include: {
          checkIn: true,
          stravaLinks: { include: { activity: true }, orderBy: { createdAt: "asc" } },
          metrics: true,
        },
      },
    },
  });

  await prisma.$transaction(async (tx) => {
    // Archive ALL active plans — guards against the synthetic-test multi-active edge case.
    await tx.trainingPlan.updateMany({
      where: { userId, status: "active" },
      data: { status: "archived" },
    });
    await tx.trainingPlan.update({
      where: { id: draft.id },
      data: { status: "active" },
    });
  });

  // Best-effort, post-transaction: persist the outgoing week's retrospective.
  // Kept outside the activation tx so a compute/write failure can never roll
  // back the rollover; idempotent via the WeekSummary @@unique upsert.
  if (outgoingPlan) {
    const readiness = await prisma.dailyReadiness.findMany({
      where: { userId, date: { gte: outgoingPlan.startsAt, lte: outgoingPlan.endsAt } },
    });
    const persisted = await persistWeekSummary(prisma, userId, outgoingPlan, outgoingPlan.sessions, readiness);
    if (persisted) {
      await reviewTunablesIfDue(userId, outgoingPlan.startsAt);
    }
  }

  return true;
}

/**
 * Silent weekly TunableDefaults review — best-effort, never blocks rollover.
 * Skips silently (no row written) when the archived week had zero done
 * sessions; there's nothing to revise thresholds against.
 */
async function reviewTunablesIfDue(userId: string, weekStart: Date): Promise<void> {
  try {
    const weekSummary = await prisma.weekSummary.findUnique({
      where: { userId_weekStart: { userId, weekStart } },
    });
    if (!weekSummary || weekSummary.done <= 0) return;

    const [current, weekSummaryHistory] = await Promise.all([
      getOrCreateTunableDefaults(userId),
      prisma.weekSummary.findMany({
        where: { userId, weekStart: { lt: weekStart } },
        orderBy: { weekStart: "desc" },
        take: 4,
      }),
    ]);

    const weekHistory: WeekHistoryEntry[] = [...weekSummaryHistory].reverse().map((w) => {
      const signals = (w.signals ?? {}) as {
        mainLimiter?: string | null;
        avgDecouplingPct?: number;
        decouplingSessionCount?: number;
        avgEfWhole?: number;
        efSessionCount?: number;
      };
      return {
        weekStart: w.weekStart.toISOString().split("T")[0],
        adherenceByCount: w.adherenceByCount,
        hardDone: w.hardDone,
        hardPlanned: w.hardPlanned,
        avgFeelScore: w.avgFeelScore,
        mainLimiter: signals.mainLimiter ?? null,
        carryForward: w.carryForward,
        ...(signals.avgDecouplingPct != null && {
          avgDecouplingPct: signals.avgDecouplingPct,
          decouplingSessionCount: signals.decouplingSessionCount,
        }),
        ...(signals.avgEfWhole != null && {
          avgEfWhole: signals.avgEfWhole,
          efSessionCount: signals.efSessionCount,
        }),
      };
    });

    const proposal = await reviewTunableDefaults(current, weekSummary, weekHistory);
    const clamped = clampTunableProposal(proposal);

    await prisma.tunableDefaults.create({
      data: { userId, ...clamped },
    });
  } catch (err) {
    console.error("[rollover] reviewTunablesIfDue failed:", err);
  }
}
