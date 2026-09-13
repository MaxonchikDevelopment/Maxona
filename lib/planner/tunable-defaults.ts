import { prisma } from "@/lib/prisma";
import type { TunableDefaults } from "@prisma/client";

const INITIAL_RATIONALE =
  "Initial defaults — not yet athlete-tuned, pending first week of data.";

// Conservative starting point, not derived from this athlete's data yet.
// hrDisciplinePct: share of planned session time expected to sit inside the
// prescribed HR zone before a session is flagged as off-target.
// efStopThresholdPct: aerobic decoupling % (see lib/analytics/run-metrics.ts)
// above which a long/key session is flagged as a stop-signal — validated
// FIT reference runs sit at 6.63%/10.54%, so 8% sits between them.
// jumpRatioCeiling: max allowed week-over-week volume increase, mirrors the
// existing MaxWeeklyVolumeIncreaseRule (+10%) from the deterministic rules engine.
const INITIAL_DEFAULTS = {
  hrDisciplinePct: 80,
  efStopThresholdPct: 8,
  jumpRatioCeiling: 1.1,
};

export async function getOrCreateTunableDefaults(userId: string): Promise<TunableDefaults> {
  const latest = await prisma.tunableDefaults.findFirst({
    where: { userId },
    orderBy: { revisedAt: "desc" },
  });
  if (latest) return latest;

  return prisma.tunableDefaults.create({
    data: {
      userId,
      ...INITIAL_DEFAULTS,
      rationale: INITIAL_RATIONALE,
    },
  });
}
