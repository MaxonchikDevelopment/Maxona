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
}): Promise<string | null> {
  if (params.feelScore > 3) return null;

  const context =
    params.category === "injury"
      ? "Athlete reports possible injury or pain — this is a physical issue."
      : "Athlete reports exhaustion, fatigue, or poor performance — NOT an injury, just a rough day.";

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `Sports coach. Athlete reported a rough session.

Session: ${params.sessionIntensity} · ${params.sessionDurationMin}min${params.sessionNotes ? ` · ${params.sessionNotes}` : ""}
Feel score: ${params.feelScore}/6
Notes: ${params.notes ? `"${params.notes}"` : "(none)"}
Context: ${context}

Give 2–3 concrete next-step suggestions. Rules:
- Each ≤ 15 words, sport-specific, NOT generic
- No "listen to your body" or "rest is important"
- For injury: suggest specific modifications or alternatives (e.g. swap running for pool running)
- For fatigue: suggest recovery strategies tied to the session type (e.g. easy spin tomorrow instead of intervals)
- Format: "• [suggestion]"
No intro. No preamble.`,
        },
      ],
    });

    const block = response.content.find((b) => b.type === "text");
    return block?.type === "text" ? block.text.trim() : null;
  } catch {
    return null;
  }
}
