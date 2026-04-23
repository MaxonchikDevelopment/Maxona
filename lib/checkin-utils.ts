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
