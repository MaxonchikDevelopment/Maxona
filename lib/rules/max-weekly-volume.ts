import type { Rule } from "@/lib/rules";

const BASE_WEEKLY_MINUTES = 120;
const MAX_INCREASE_FACTOR = 1.1;

export const maxWeeklyVolume: Rule = {
  name: "MaxWeeklyVolumeIncreaseRule",
  apply({ previousSessions }) {
    const previousTotal = previousSessions.reduce(
      (sum, s) => sum + s.durationMin,
      0
    );
    const base = previousTotal > 0 ? previousTotal : BASE_WEEKLY_MINUTES;
    return { maxWeeklyMinutes: Math.round(base * MAX_INCREASE_FACTOR) };
  },
};
