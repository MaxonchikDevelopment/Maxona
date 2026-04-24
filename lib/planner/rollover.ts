import { prisma } from "@/lib/prisma";

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

  const active = await prisma.trainingPlan.findFirst({
    where: { userId, status: "active" },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    if (active) {
      await tx.trainingPlan.update({
        where: { id: active.id },
        data: { status: "archived" },
      });
    }
    await tx.trainingPlan.update({
      where: { id: draft.id },
      data: { status: "active" },
    });
  });

  return true;
}
