export const INJURY_KEYWORDS = [
  // English
  "injury", "injured", "pain", "hurt", "sore", "knee", "ankle", "back",
  "hip", "hamstring", "calf", "shin", "groin", "shoulder", "wrist", "foot",
  "muscle", "strain", "sprain", "tendon", "ligament",
  // Russian
  "боль", "болит", "болят", "травм", "колен", "лодыжк", "спин", "бедр", "плеч",
  // German
  "schmerz", "schmerzen", "verletzt", "verletzung", "knie", "knöchel", "rücken", "hüfte", "schulter",
];

export type CheckInCategory = "injury" | "fatigue" | "ok";

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
  if (/sleep|insomnia|tired|night/.test(lower)) result.push("poor_sleep");
  if (/stress|anxious|overwhelm/.test(lower)) result.push("stress");
  if (/travel|flight|jet/.test(lower)) result.push("travel");
  if (/soreness|doms|stiff/.test(lower)) result.push("soreness");
  if (/stomach|gut|nausea|sick|ill/.test(lower)) result.push("stomach");
  return result;
}
