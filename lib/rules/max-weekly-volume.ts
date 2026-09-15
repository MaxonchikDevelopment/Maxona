import type { Rule } from "@/lib/rules";

// Base for first week with no history: ~7 h suits marathon + HYROX training
const BASE_WEEKLY_MINUTES = 420;

export function buildMaxWeeklyVolumeRule(jumpRatioCeiling: number): Rule {
  return {
    name: "MaxWeeklyVolumeIncreaseRule",
    apply({ previousSessions }) {
      const previousTotal = previousSessions.reduce(
        (sum, s) => sum + s.durationMin,
        0
      );
      const base = previousTotal > 0 ? previousTotal : BASE_WEEKLY_MINUTES;
      return { maxWeeklyMinutes: Math.round(base * jumpRatioCeiling) };
    },
  };
}
