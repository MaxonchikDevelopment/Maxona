import type { Rule } from "@/lib/rules";
import { eachDayOfWeek, toDateStr } from "@/lib/rules";

export const noConflictSchedule: Rule = {
  name: "NoWorkoutOnConflictingScheduleEventRule",
  apply({ scheduleEvents, weekStart }) {
    const blockedDates: string[] = [];

    for (const day of eachDayOfWeek(weekStart)) {
      const dayStart = new Date(day);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(day);
      dayEnd.setHours(23, 59, 59, 999);

      const blocked = scheduleEvents.some(
        (e) =>
          (e.kind === "blocked" || e.kind === "travel") &&
          new Date(e.startsAt) <= dayEnd &&
          new Date(e.endsAt) >= dayStart
      );

      if (blocked) blockedDates.push(toDateStr(day));
    }

    return { blockedDates };
  },
};
