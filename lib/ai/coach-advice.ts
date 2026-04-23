import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateCoachAdvice(params: {
  feelScore: number;
  notes: string | null;
  sessionIntensity: string;
  sessionDurationMin: number;
  sessionNotes: string | null;
}): Promise<string | null> {
  if (params.feelScore > 2) return null;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `Sports coach. Athlete reported a rough session.

Session: ${params.sessionIntensity} · ${params.sessionDurationMin}min${params.sessionNotes ? ` · ${params.sessionNotes}` : ""}
Feel score: ${params.feelScore}/5
Notes: ${params.notes ? `"${params.notes}"` : "(none)"}

Give 2–3 concrete next-step suggestions. Rules:
- Each ≤ 15 words, sport-specific, NOT generic
- No "listen to your body" or "rest is important"
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
