import { prisma } from "@/lib/prisma";
import { persistWeekSummary } from "@/lib/week-summary";

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
    await persistWeekSummary(prisma, userId, outgoingPlan, outgoingPlan.sessions, readiness);
  }

  return true;
}
