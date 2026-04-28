import Anthropic from "@anthropic-ai/sdk";
import type { DayEnergyEstimate } from "@/lib/nutrition/energy-estimate";

const client = new Anthropic();

export type MealTimingItem = {
  time: string;
  label: string;
  suggestion: string;
  approxCalories: number | null;
};

export type NutritionAdvice = {
  summary: string;
  energy: DayEnergyEstimate | null;
  mealTiming: MealTimingItem[];
  before: string[];
  during: string[];
  after: string[];
  hydration: string[];
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
    preferredBreakfast?: string | null;
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
    bodyWeightKg?: number | null;
    estimatedRestDayCalories?: number | null;
    calorieGoal?: string | null;
  } | null;
  energy?: DayEnergyEstimate | null;
};

const REST_DAY_ADVICE: NutritionAdvice = {
  summary: "Rest day — focus on balanced meals and steady hydration.",
  energy: null,
  mealTiming: [],
  before: [],
  during: [],
  after: [],
  hydration: ["Aim for 2–3 L water today", "Consistent sipping helps recovery"],
};

const FALLBACK: NutritionAdvice = {
  summary: "Standard fueling — keep it simple and consistent.",
  energy: null,
  mealTiming: [],
  before: ["Light snack 60–90 min before: banana, toast, or oats"],
  during: [],
  after: ["Protein + carbs within 2h post-workout"],
  hydration: ["Aim for 2–3 L water today; sip consistently"],
};

export async function generateNutritionAdvice(
  input: NutritionAdviceInput
): Promise<NutritionAdvice> {
  const isRestDay = input.sessions.length === 0;
  if (isRestDay && !input.energy) return REST_DAY_ADVICE;

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
  if (p?.preferredBreakfast) profileParts.push(`Preferred breakfast: ${p.preferredBreakfast}`);
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

  const energyContext = input.energy
    ? `Energy estimate: passive ${input.energy.passiveCalories} kcal + training ${input.energy.activeCalories} kcal = target ${input.energy.targetCalories} kcal (${input.energy.balanceNote})`
    : "No calorie estimate available (bodyWeightKg or estimatedRestDayCalories missing).";

  const prompt = `You are a practical sports nutrition coach. Generate compact, actionable fueling advice for today.

${isRestDay ? "Today is a REST DAY — no training scheduled." : `Sessions today:\n${sessionParts.join("\n")}`}

${readinessParts.length > 0 ? `Readiness today:\n${readinessParts.join("\n")}` : "No readiness check-in."}

${profileParts.length > 0 ? `Athlete nutrition profile:\n${profileParts.join("\n")}` : "No nutrition profile — use generic safe advice."}

${energyContext}

${poorRecovery ? "⚠️ Poor recovery signals detected — emphasise hydration and conservative fueling." : ""}

Rules:
- No medical claims.
- Stomach sensitive → keep pre-workout food very light.
- Easy session < 60 min → simple advice; return [] for "during".
- Hard or long session (75+ min, or hard intensity) → include carbs and hydration guidance.
- If workout is in the evening: lunch should be the main fueling meal; avoid heavy dinner before training; suggest light snack 60–90 min before if tolerated.
- Rest day: focus on regular meals, protein, carbs, hydration.
- If meal pattern suggests skipping breakfast and goal mentions energy / under-fueling: suggest a small breakfast option.
- Stomach sensitive: prefer rice, toast, banana, rice cakes before training.
- caffeineSensitive → do not recommend caffeine.
- Use preferredFoods and user staples for concrete suggestions first (rice, chicken, pasta, fish, bulgur, couscous, vegetables, olive oil, oats).
- Suggest realistic quick-cook meals. Cooking times: ${p?.cookingTimePreference ?? "no preference"}.

mealTiming: suggest 2–4 practical meals for TODAY ONLY. Each item:
- "time": HH:MM (24h, realistic for the day)
- "label": e.g. "Breakfast", "Lunch", "Pre-workout snack", "Dinner", "Post-workout meal"
- "suggestion": one sentence: what exactly to cook/eat (use user's preferred foods)
- "approxCalories": integer approximate kcal, or null if cannot estimate

before / after / hydration: max 2 bullets each, max 15 words each.
summary: one sentence max 20 words describing today's fueling focus.
timingNote: only if meal timing guidance is relevant. Otherwise omit.

Return ONLY valid JSON:
{
  "summary": "...",
  "mealTiming": [
    { "time": "12:00", "label": "Lunch", "suggestion": "...", "approxCalories": 750 }
  ],
  "before": ["..."],
  "during": [],
  "after": ["..."],
  "hydration": ["..."],
  "timingNote": "optional"
}`;

  try {
    const message = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
      max_tokens: 700,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("");

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ...FALLBACK, energy: input.energy ?? null };

    const parsed = JSON.parse(jsonMatch[0]) as Partial<NutritionAdvice>;

    const mealTiming: MealTimingItem[] = Array.isArray(parsed.mealTiming)
      ? parsed.mealTiming
          .filter((m) => m && typeof m === "object" && m.time && m.label && m.suggestion)
          .slice(0, 4)
          .map((m) => ({
            time: String(m.time),
            label: String(m.label),
            suggestion: String(m.suggestion),
            approxCalories: typeof m.approxCalories === "number" ? m.approxCalories : null,
          }))
      : [];

    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : FALLBACK.summary,
      energy: input.energy ?? null,
      mealTiming,
      before: Array.isArray(parsed.before) && parsed.before.length > 0 ? parsed.before : (isRestDay ? [] : FALLBACK.before),
      during: Array.isArray(parsed.during) ? parsed.during : [],
      after: Array.isArray(parsed.after) && parsed.after.length > 0 ? parsed.after : (isRestDay ? [] : FALLBACK.after),
      hydration: Array.isArray(parsed.hydration) && parsed.hydration.length > 0
        ? parsed.hydration
        : FALLBACK.hydration,
      timingNote:
        typeof parsed.timingNote === "string" && parsed.timingNote.trim()
          ? parsed.timingNote
          : undefined,
    };
  } catch {
    return { ...FALLBACK, energy: input.energy ?? null };
  }
}
