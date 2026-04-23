import Anthropic from "@anthropic-ai/sdk";
import type { CheckInCategory } from "@/lib/checkin-utils";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateCoachAdvice(params: {
  feelScore: number;
  notes: string | null;
  sessionIntensity: string;
  sessionDurationMin: number;
  sessionNotes: string | null;
  category: CheckInCategory;
  recentContext?: Array<{
    date: string;
    intensity: string;
    notes: string | null;
    feelScore?: number;
    category?: string;
  }>;
}): Promise<string | null> {
  if (params.feelScore > 3) return null;

  const context =
    params.category === "injury"
      ? "Athlete reports possible injury or pain — this is a physical issue."
      : "Athlete reports exhaustion, fatigue, or poor performance — NOT an injury, just a rough day.";

  const weekContext =
    params.recentContext && params.recentContext.length > 0
      ? `\nRecent sessions this week:\n${params.recentContext
          .map(
            (s) =>
              `- ${s.date}: ${s.intensity} ${s.notes ?? ""}${s.feelScore != null ? ` (feel ${s.feelScore}/6)` : ""}${s.category && s.category !== "ok" ? ` [${s.category}]` : ""}`
          )
          .join("\n")}`
      : "";

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 250,
      messages: [
        {
          role: "user",
          content: `Sports coach. Athlete reported a rough session.

Session: ${params.sessionIntensity} · ${params.sessionDurationMin}min${params.sessionNotes ? ` · ${params.sessionNotes}` : ""}
Feel score: ${params.feelScore}/6
Notes: ${params.notes ? `"${params.notes}"` : "(none)"}
Context: ${context}${weekContext}

Give 2–3 concrete next-step suggestions. Rules:
- Each ≤ 20 words, sport-specific, actionable
- No "listen to your body" or "rest is important"
- For injury: suggest specific movement alternatives or targeted mobility work
- For fatigue: tie suggestions to the weekly load shown above (e.g. "after X sessions this week, …")
- Reference the specific sport or body part mentioned
- Format: "• [suggestion]"
No intro. No preamble.`,
        },
      ],
    });

    const block = response.content.find((b) => b.type === "text");
    return block?.type === "text" ? block.text.trim() : null;
  } catch (err) {
    console.error("[coach-advice] generateCoachAdvice failed:", err);
    return null;
  }
}
