import type { Rule } from "@/lib/rules";
import { eachDayOfWeek, toDateStr, toDayOfWeek } from "@/lib/rules";

export const noOutsideAvailability: Rule = {
  name: "NoWorkoutOutsideAvailabilityRule",
  apply({ availabilityWindows, weekStart }) {
    const blockedDates: string[] = [];

    for (const day of eachDayOfWeek(weekStart)) {
      const dow = toDayOfWeek(day);
      const hasWindow = availabilityWindows.some((w) => w.dayOfWeek === dow);
      if (!hasWindow) blockedDates.push(toDateStr(day));
    }

    return { blockedDates };
  },
};
