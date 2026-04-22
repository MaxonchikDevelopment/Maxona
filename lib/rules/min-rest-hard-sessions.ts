import type { Rule } from "@/lib/rules";
import { eachDayOfWeek, toDateStr } from "@/lib/rules";

export const minRestHardSessions: Rule = {
  name: "MinRestBetweenHardSessionsRule",
  apply({ previousSessions, weekStart }) {
    const blockedHardSessionDates: string[] = [];
    const weekDayStrs = eachDayOfWeek(weekStart).map(toDateStr);

    const recentHard = previousSessions.filter((s) => s.intensity === "hard");

    for (const session of recentHard) {
      for (let i = 1; i <= 2; i++) {
        const candidate = new Date(session.scheduledDate);
        candidate.setDate(candidate.getDate() + i);
        const dateStr = toDateStr(candidate);
        if (weekDayStrs.includes(dateStr)) {
          blockedHardSessionDates.push(dateStr);
        }
      }
    }

    return { blockedHardSessionDates };
  },
};
