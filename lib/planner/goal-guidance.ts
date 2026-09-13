// Pure, framework-agnostic goal-weighting algorithm — shared between the
// orchestrator (server, feeds the planner prompt) and the Goals page (client,
// renders "how your goals shape the week") so both surfaces agree.

export type GoalPhase = "base" | "build" | "taper";

export interface GoalGuidanceInput {
  id: string;
  title: string;
  discipline: string | null;
  targetDate: string | null; // YYYY-MM-DD
  priority: number | null;
}

export interface PerGoalGuidance {
  id: string;
  title: string;
  discipline: string | null;
  daysUntil: number | null;
  phase: GoalPhase;
  weight: number; // normalized fraction of week's training emphasis, sums to ~1
}

export interface GoalGuidance {
  primaryFocus: PerGoalGuidance | null;
  perGoal: PerGoalGuidance[];
  taperGoal: PerGoalGuidance | null;
}

const PRIORITY_WEIGHT: Record<number, number> = { 1: 3, 2: 2, 3: 1 };
const UNSET_PRIORITY_WEIGHT = 1;
const UNSET_PRIORITY_RANK = 4; // below P3 for tier purposes

function daysUntil(targetDateStr: string, todayStr: string): number {
  const [ty, tm, td] = targetDateStr.split("-").map(Number);
  const [ny, nm, nd] = todayStr.split("-").map(Number);
  const target = Date.UTC(ty, tm - 1, td);
  const today = Date.UTC(ny, nm - 1, nd);
  return Math.round((target - today) / 86400000);
}

function derivePhase(days: number | null): GoalPhase {
  if (days === null) return "base"; // undated goals never taper
  if (days <= 14) return "taper";
  if (days <= 56) return "build";
  return "base";
}

// Rises as the target date nears; undated goals get no proximity boost.
function proximityMultiplier(days: number | null): number {
  if (days === null) return 1;
  const clamped = Math.max(days, 0);
  if (clamped <= 14) return 2.5;
  if (clamped <= 56) return 1.6;
  return 1;
}

export function computeGoalGuidance(
  goals: GoalGuidanceInput[],
  todayStr: string
): GoalGuidance {
  if (goals.length === 0) {
    return { primaryFocus: null, perGoal: [], taperGoal: null };
  }

  const meta = goals.map((g) => {
    const days = g.targetDate ? daysUntil(g.targetDate, todayStr) : null;
    const phase = derivePhase(days);
    const priorityFactor =
      g.priority != null ? PRIORITY_WEIGHT[g.priority] ?? UNSET_PRIORITY_WEIGHT : UNSET_PRIORITY_WEIGHT;
    const rank = g.priority ?? UNSET_PRIORITY_RANK;
    const rawWeight = priorityFactor * proximityMultiplier(days);
    return { ...g, days, phase, rank, rawWeight };
  });

  const totalWeight = meta.reduce((sum, g) => sum + g.rawWeight, 0) || 1;
  const perGoal: PerGoalGuidance[] = meta.map((g) => ({
    id: g.id,
    title: g.title,
    discipline: g.discipline,
    daysUntil: g.days,
    phase: g.phase,
    weight: Math.round((g.rawWeight / totalWeight) * 100) / 100,
  }));

  const minRank = Math.min(...meta.map((g) => g.rank));
  const topTier = meta
    .filter((g) => g.rank === minRank)
    .sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity));
  const primaryMeta = topTier[0];
  const primaryFocus = perGoal.find((g) => g.id === primaryMeta.id) ?? null;

  const taperMeta = meta
    .filter((g) => g.phase === "taper")
    .sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity))[0];
  const taperGoal = taperMeta ? perGoal.find((g) => g.id === taperMeta.id) ?? null : null;

  return { primaryFocus, perGoal, taperGoal };
}
