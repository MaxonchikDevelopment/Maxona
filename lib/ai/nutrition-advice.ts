import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export type NutritionAdvice = {
  before: string[];
  during: string[];
  after: string[];
  hydration: string[];
  summary: string;
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
  } | null;
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
  if (input.sessions.length === 0) return FALLBACK;

  const isStomachSensitive = input.nutritionProfile?.stomachSensitive ?? false;
  const poorRecovery =
    input.readiness?.tags?.some((t) =>
      ["alcohol", "poor_sleep", "sickness"].includes(t)
    ) ?? false;

  const profileParts: string[] = [];
  if (input.nutritionProfile?.dietNotes)
    profileParts.push(`Diet notes: ${input.nutritionProfile.dietNotes}`);
  if (input.nutritionProfile?.avoidFoods)
    profileParts.push(`Avoid: ${input.nutritionProfile.avoidFoods}`);
  if (input.nutritionProfile?.preferredPreWorkoutSnack)
    profileParts.push(`Preferred pre-workout snack: ${input.nutritionProfile.preferredPreWorkoutSnack}`);
  if (input.nutritionProfile?.preferredPostWorkoutMeal)
    profileParts.push(`Preferred post-workout meal: ${input.nutritionProfile.preferredPostWorkoutMeal}`);
  if (input.nutritionProfile?.caffeineSensitive)
    profileParts.push("Caffeine sensitive");
  if (isStomachSensitive) profileParts.push("Stomach sensitive — keep food very light");

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

  const prompt = `You are a practical sports nutrition coach. Generate compact, actionable fueling advice.

Sessions today:
${sessionParts.join("\n")}

${readinessParts.length > 0 ? `Readiness today:\n${readinessParts.join("\n")}` : "No readiness check-in."}

${profileParts.length > 0 ? `Athlete nutrition profile:\n${profileParts.join("\n")}` : "No nutrition profile — use generic safe advice."}

Rules:
- No medical claims.
- Stomach sensitive or stomach in profile → keep food very light and conservative.
- Poor recovery signals (alcohol, poor_sleep, sickness tags) → emphasize hydration + conservative fueling.
- Easy session < 60 min → simple advice, no during-session food needed; return [] for "during".
- Hard or long session (75+ min, or hard intensity) → include carbs and hydration guidance.
- Max 2 bullets per section. Each bullet max 15 words.
- If during-session fueling is not needed, return [] for "during".

Return ONLY valid JSON, no other text:
{
  "before": ["..."],
  "during": [],
  "after": ["..."],
  "hydration": ["..."],
  "summary": "one sentence max 20 words"
}`;

  try {
    const message = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
      max_tokens: 400,
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
    };
  } catch {
    return FALLBACK;
  }
}
