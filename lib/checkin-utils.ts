export const INJURY_KEYWORDS = [
  // English — specific injury/pain indicators only
  // Excludes broad words: "sore", "hurt", "back", "muscle", "shoulder", "foot", "hip", "hamstring", "calf", "groin", "wrist"
  "injury", "injured",
  "pain", "sharp pain", "pulled",
  "strain", "sprain", "tendon", "ligament",
  "knee", "ankle", "shin",
  // Russian — specific injury/pain indicators only
  "боль", "болит", "болят", "травм", "колен", "лодыжк", "голен",
  // German — specific
  "schmerz", "schmerzen", "verletzt", "verletzung", "knie", "knöchel",
];

export type CheckInCategory = "injury" | "fatigue" | "ok";

// Intended feelScore (1-6) → signal mapping — keep any threshold logic
// downstream consistent with this: 1-3 = poor/fatigue-or-injury signal,
// 4 = neutral/fair, 5-6 = good. Higher is always better; never invert.
export function categorizeCheckIn(
  feelScore: number,
  notes: string | null,
): CheckInCategory {
  if (feelScore >= 4) return "ok";
  const lower = (notes ?? "").toLowerCase();
  if (INJURY_KEYWORDS.some((kw) => lower.includes(kw))) return "injury";
  return "fatigue";
}

export const READINESS_TAGS = [
  "alcohol",
  "poor_sleep",
  "stress",
  "travel",
  "soreness",
  "stomach",
] as const;

export type ReadinessTag = typeof READINESS_TAGS[number];

export function inferTagsFromNotes(notes: string | null): ReadinessTag[] {
  const lower = (notes ?? "").toLowerCase();
  const result: ReadinessTag[] = [];
  if (/alcohol|beer|wine|spirit|hangover|drink/.test(lower)) result.push("alcohol");
  // "tired" alone is too broad (training fatigue, not sleep); "night" alone matches too much.
  // Bare "sleep" was previously matched here, which meant ANY mention of sleep —
  // including good news like "sleep score 85" or "slept great" — got tagged
  // poor_sleep. Only match phrasing that is actually negative.
  if (/insomnia|no sleep|poor sleep|bad sleep|slept badly|slept poorly|trouble sleeping|couldn't sleep|didn't sleep|woke up (tired|exhausted|multiple times|several times)/.test(lower))
    result.push("poor_sleep");
  if (/stress|anxious|overwhelm/.test(lower)) result.push("stress");
  if (/travel|flight|jet/.test(lower)) result.push("travel");
  if (/soreness|doms|stiff/.test(lower)) result.push("soreness");
  if (/stomach|gut|nausea|sick|ill/.test(lower)) result.push("stomach");
  return result;
}
