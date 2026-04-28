import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export type WeeklyNutritionFocus = {
  bullets: string[];
};

export type WeeklyNutritionFocusInput = {
  sessions: Array<{
    dateStr: string;
    intensity: string;
    durationMin: number;
    notes: string | null;
  }>;
  nutritionProfile?: {
    nutritionGoal?: string | null;
    currentMealPattern?: string | null;
    stomachSensitive?: boolean;
    caffeineSensitive?: boolean;
    preferredFoods?: string | null;
    avoidFoods?: string | null;
    supplements?: string | null;
    cookingTimePreference?: string | null;
    calorieGoal?: string | null;
    estimatedRestDayCalories?: number | null;
  } | null;
};

const FALLBACK: WeeklyNutritionFocus = {
  bullets: [
    "Fuel hard sessions with carbs 2–3h before",
    "Protein + carbs within 2h after each training session",
    "Aim for 2–3 L water on training days",
    "Keep meals simple on rest days — focus on recovery",
  ],
};

export async function generateWeeklyNutritionFocus(
  input: WeeklyNutritionFocusInput
): Promise<WeeklyNutritionFocus> {
  if (input.sessions.length === 0) return FALLBACK;

  const sessionLines = input.sessions.map(
    (s) =>
      `${s.dateStr}: ${s.intensity} · ${s.durationMin}min${s.notes ? ` · ${s.notes.split(":")[0]}` : ""}`
  );

  const p = input.nutritionProfile;
  const profileParts: string[] = [];
  if (p?.nutritionGoal) profileParts.push(`Goal: ${p.nutritionGoal}`);
  if (p?.currentMealPattern) profileParts.push(`Meal pattern: ${p.currentMealPattern}`);
  if (p?.stomachSensitive) profileParts.push("Stomach sensitive");
  if (p?.caffeineSensitive) profileParts.push("Caffeine sensitive");
  if (p?.preferredFoods) profileParts.push(`Easy staples: ${p.preferredFoods}`);
  if (p?.avoidFoods) profileParts.push(`Avoid: ${p.avoidFoods}`);
  if (p?.supplements) profileParts.push(`Supplements: ${p.supplements}`);
  if (p?.cookingTimePreference) profileParts.push(`Cooking style: ${p.cookingTimePreference}`);
  if (p?.calorieGoal) profileParts.push(`Calorie goal: ${p.calorieGoal.replace("_", " ")}`);
  if (p?.estimatedRestDayCalories) profileParts.push(`Rest-day calorie target: ${p.estimatedRestDayCalories} kcal`);

  const prompt = `You are a practical sports nutrition coach. Based on this week's training, write 3–4 concise weekly fueling priorities.

Training this week:
${sessionLines.join("\n")}

${profileParts.length > 0 ? `Athlete profile:\n${profileParts.join("\n")}` : "No nutrition profile — use generic safe advice."}

Rules:
- Identify which days need most fueling — name them (e.g. "Sunday long run: highest fuel day")
- For evening training days, mention using lunch as the main fueling meal
- Flag hard or long sessions (75+ min or hard intensity) as key fueling days
- If rest days exist, remind to keep meals regular and avoid under-fueling
- If nutritionGoal or meal pattern suggests under-fueling risk, call it out
- Keep week-level view — no per-day calorie tables
- Each bullet max 20 words. Practical, coach-style language. No medical claims.
- Return exactly 3 or 4 bullets.

Return ONLY valid JSON:
{ "bullets": ["...", "...", "..."] }`;

  try {
    const message = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("");

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return FALLBACK;

    const parsed = JSON.parse(jsonMatch[0]) as Partial<WeeklyNutritionFocus>;
    if (Array.isArray(parsed.bullets) && parsed.bullets.length >= 2) {
      return { bullets: parsed.bullets.slice(0, 4) };
    }
    return FALLBACK;
  } catch {
    return FALLBACK;
  }
}
