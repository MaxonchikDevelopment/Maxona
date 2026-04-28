import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export type NutritionAdvice = {
  before: string[];
  during: string[];
  after: string[];
  hydration: string[];
  summary: string;
  timingNote?: string;
};

export type NutritionAdviceInput = {
  sessions: Array<{
    intensity: string;
    durationMin: number;
    notes: string | null;
  }>;
  readiness?: {
    feelScore: number;
    notes: string | null;
    tags: string[];
    category: string;
  } | null;
  nutritionProfile?: {
    dietNotes?: string | null;
    avoidFoods?: string | null;
    preferredPreWorkoutSnack?: string | null;
    preferredPostWorkoutMeal?: string | null;
    caffeineSensitive?: boolean;
    stomachSensitive?: boolean;
    currentMealPattern?: string | null;
    nutritionGoal?: string | null;
    minHoursAfterMainMealBeforeWorkout?: number | null;
    preWorkoutSnackTolerance?: string | null;
    preferredFoods?: string | null;
    supplements?: string | null;
    cookingTimePreference?: string | null;
  } | null;
};

const REST_DAY_ADVICE: NutritionAdvice = {
  before: [],
  during: [],
  after: [],
  hydration: ["Aim for 2–3 L water today", "Consistent sipping helps recovery"],
  summary: "Rest day — focus on balanced meals and steady hydration.",
};

const FALLBACK: NutritionAdvice = {
  before: ["Light snack 60–90 min before: banana, toast, or oats"],
  during: [],
  after: ["Protein + carbs within 2h post-workout"],
  hydration: ["Aim for 2–3 L water today; sip consistently"],
  summary: "Standard fueling — keep it simple and consistent.",
};

export async function generateNutritionAdvice(
  input: NutritionAdviceInput
): Promise<NutritionAdvice> {
  if (input.sessions.length === 0) return REST_DAY_ADVICE;

  const p = input.nutritionProfile;
  const isStomachSensitive = p?.stomachSensitive ?? false;
  const poorRecovery =
    input.readiness?.tags?.some((t) =>
      ["alcohol", "poor_sleep", "sickness"].includes(t)
    ) ?? false;

  const profileParts: string[] = [];
  if (p?.currentMealPattern) profileParts.push(`Meal pattern: ${p.currentMealPattern}`);
  if (p?.nutritionGoal) profileParts.push(`Nutrition goal: ${p.nutritionGoal}`);
  if (p?.dietNotes) profileParts.push(`Diet notes: ${p.dietNotes}`);
  if (p?.avoidFoods) profileParts.push(`Avoid: ${p.avoidFoods}`);
  if (p?.preferredFoods) profileParts.push(`Preferred foods / easy staples: ${p.preferredFoods}`);
  if (p?.preferredPreWorkoutSnack) profileParts.push(`Preferred pre-workout snack: ${p.preferredPreWorkoutSnack}`);
  if (p?.preWorkoutSnackTolerance) profileParts.push(`Pre-workout snack tolerance: ${p.preWorkoutSnackTolerance}`);
  if (p?.preferredPostWorkoutMeal) profileParts.push(`Preferred post-workout meal: ${p.preferredPostWorkoutMeal}`);
  if (p?.minHoursAfterMainMealBeforeWorkout != null)
    profileParts.push(`Min gap after main meal before workout: ${p.minHoursAfterMainMealBeforeWorkout}h`);
  if (p?.supplements) profileParts.push(`Supplements (routine): ${p.supplements}`);
  if (p?.cookingTimePreference) profileParts.push(`Cooking preference: ${p.cookingTimePreference}`);
  if (p?.caffeineSensitive) profileParts.push("Caffeine sensitive");
  if (isStomachSensitive) profileParts.push("Stomach sensitive — keep pre-workout food very light");

  const readinessParts: string[] = [];
  if (input.readiness) {
    readinessParts.push(`Feel score: ${input.readiness.feelScore}/6`);
    if (input.readiness.notes) readinessParts.push(`Notes: ${input.readiness.notes}`);
    if (input.readiness.tags.length)
      readinessParts.push(`Tags: ${input.readiness.tags.join(", ")}`);
  }

  const sessionParts = input.sessions.map(
    (s) => `${s.intensity} · ${s.durationMin} min${s.notes ? ` · ${s.notes}` : ""}`
  );

  const hasMinGap = p?.minHoursAfterMainMealBeforeWorkout != null;

  const prompt = `You are a practical sports nutrition coach. Generate compact, actionable fueling advice for today.

Sessions today:
${sessionParts.join("\n")}

${readinessParts.length > 0 ? `Readiness today:\n${readinessParts.join("\n")}` : "No readiness check-in."}

${profileParts.length > 0 ? `Athlete nutrition profile:\n${profileParts.join("\n")}` : "No nutrition profile — use generic safe advice."}

Rules:
- No medical claims.
- Stomach sensitive → keep pre-workout food very light and conservative.
- Poor recovery signals (alcohol, poor_sleep, sickness tags) → emphasize hydration + conservative fueling.
- Easy session < 60 min → simple advice, no during-session food; return [] for "during".
- Hard or long session (75+ min, or hard intensity) → include carbs and hydration guidance.
- If preferredFoods or preferredPreWorkoutSnack exist, use them as examples in before/after bullets.
- If supplements exist, include one short reminder bullet in "after" (routine only, no claims).
- If meal pattern suggests skipping breakfast and nutritionGoal mentions energy or under-fueling, suggest a small practical breakfast in "before".
- If minHoursAfterMainMealBeforeWorkout is set, ${hasMinGap ? "include a timingNote about the gap" : "omit timingNote"}.
- Max 2 bullets per section. Each bullet max 15 words.
- summary: one sentence max 20 words describing today's fueling focus.
- timingNote: only include if meal timing guidance is relevant (e.g. min gap rule applies). Otherwise omit.

Return ONLY valid JSON, no other text:
{
  "before": ["..."],
  "during": [],
  "after": ["..."],
  "hydration": ["..."],
  "summary": "one sentence",
  "timingNote": "optional one sentence or omit key"
}`;

  try {
    const message = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
      max_tokens: 450,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("");

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return FALLBACK;

    const parsed = JSON.parse(jsonMatch[0]) as Partial<NutritionAdvice>;
    return {
      before: Array.isArray(parsed.before) && parsed.before.length > 0
        ? parsed.before
        : FALLBACK.before,
      during: Array.isArray(parsed.during) ? parsed.during : [],
      after: Array.isArray(parsed.after) && parsed.after.length > 0
        ? parsed.after
        : FALLBACK.after,
      hydration: Array.isArray(parsed.hydration) && parsed.hydration.length > 0
        ? parsed.hydration
        : FALLBACK.hydration,
      summary:
        typeof parsed.summary === "string" ? parsed.summary : FALLBACK.summary,
      timingNote:
        typeof parsed.timingNote === "string" && parsed.timingNote.trim()
          ? parsed.timingNote
          : undefined,
    };
  } catch {
    return FALLBACK;
  }
}
