export type SuggestionLabel = "Best match" | "Possible match" | "Same day";

const SPORT_KEYWORDS: Array<{ keywords: string[]; sportTypes: string[] }> = [
  {
    keywords: ["run", "running", "5k", "10k", "half", "marathon", "jog", "long run"],
    sportTypes: ["Run", "TrailRun", "VirtualRun"],
  },
  {
    keywords: ["hyrox", "gym", "strength", "weights", "lifting", "crossfit", "wod"],
    sportTypes: ["WeightTraining", "Workout", "CrossFit"],
  },
  {
    keywords: ["bike", "cycling", "cycle", "ride", "zwift", "gravel"],
    sportTypes: ["Ride", "VirtualRide", "GravelRide", "MountainBikeRide"],
  },
  {
    keywords: ["swim", "pool", "open water"],
    sportTypes: ["Swim", "OpenWaterSwim"],
  },
  {
    keywords: ["walk", "hike", "hiking"],
    sportTypes: ["Walk", "Hike"],
  },
  {
    keywords: ["yoga", "mobility", "stretch", "flexibility"],
    sportTypes: ["Yoga"],
  },
  {
    keywords: ["row", "rowing", "erg"],
    sportTypes: ["Rowing", "Elliptical"],
  },
];

const SLOT_HOURS: Record<string, [number, number]> = {
  morning: [5, 10],
  daytime: [10, 14],
  afternoon: [14, 18],
  evening: [18, 23],
};

function inferSportTypes(notes: string | null): string[] {
  if (!notes) return [];
  const lower = notes.toLowerCase();
  for (const entry of SPORT_KEYWORDS) {
    if (entry.keywords.some((kw) => lower.includes(kw))) return entry.sportTypes;
  }
  return [];
}

function dayDiff(sessionDateStr: string, activityStartDate: Date | string): number {
  const [sy, sm, sd] = sessionDateStr.split("-").map(Number);
  const sessionMs = Date.UTC(sy, sm - 1, sd);
  const d = new Date(activityStartDate);
  const activityMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.abs(Math.round((activityMs - sessionMs) / 86_400_000));
}

export function scoreCandidate(
  session: { scheduledDate: string; durationMin: number; notes: string | null; preferredSlot: string },
  activity: { sportType: string; startDate: Date | string; movingTime: number },
  alreadyLinkedElsewhere: boolean
): number {
  let score = 0;

  // Date proximity — primary signal
  const diff = dayDiff(session.scheduledDate, activity.startDate);
  if (diff === 0) score += 50;
  else if (diff === 1) score += 20;
  else if (diff === 2) score += 5;

  // Sport type compatibility from session notes
  const expectedSports = inferSportTypes(session.notes);
  if (expectedSports.length > 0 && expectedSports.includes(activity.sportType)) score += 30;

  // Duration plausibility (movingTime vs plannedMin)
  if (session.durationMin > 0 && activity.movingTime > 0) {
    const ratio = activity.movingTime / (session.durationMin * 60);
    if (ratio >= 0.8 && ratio <= 1.3) score += 15;
    else if (ratio >= 0.5 && ratio <= 2.0) score += 5;
    else if (ratio < 0.2 || ratio > 3.0) score -= 10;
  }

  // Preferred slot vs activity start hour (UTC approximation)
  const slotRange = SLOT_HOURS[session.preferredSlot];
  if (slotRange) {
    const hour = new Date(activity.startDate).getUTCHours();
    if (hour >= slotRange[0] && hour < slotRange[1]) score += 10;
  }

  // Soft penalty — activity already claimed by another session
  if (alreadyLinkedElsewhere) score -= 40;

  return score;
}

export function labelForScore(score: number): SuggestionLabel | null {
  if (score >= 75) return "Best match";
  if (score >= 45) return "Possible match";
  if (score >= 20) return "Same day";
  return null;
}
