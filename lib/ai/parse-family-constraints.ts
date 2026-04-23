import Anthropic from "@anthropic-ai/sdk";
import type { ParsedTemporalConstraint } from "./adapter";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function parseFamilyConstraints(
  text: string,
  todayStr: string,
): Promise<ParsedTemporalConstraint[]> {
  if (!text.trim()) return [];
  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `Parse schedule constraints for a weekly training planner. Today: ${todayStr}.

Text: "${text}"

Return a JSON array. Each object:
{"day":"mon|tue|wed|thu|fri|sat|sun","slot":"morning|daytime|afternoon|evening|null","type":"available_only|blocked"}

Rules:
- "Saturday only morning" → {"day":"sat","slot":"morning","type":"available_only"}
- "Friday evening unavailable" → {"day":"fri","slot":"evening","type":"blocked"}
- "Sunday free until 11" → {"day":"sun","slot":"morning","type":"available_only"}
- Session-type hints like "HYROX must be Wednesday" → skip (not a temporal block)
- Skip days that are already past relative to today
- Handle English, Russian (суббота утром = Saturday morning), German (Samstag Morgen)
Return ONLY the JSON array, nothing else.`,
        },
      ],
    });

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return [];
    const parsed = JSON.parse(block.text.trim());
    return Array.isArray(parsed) ? (parsed as ParsedTemporalConstraint[]) : [];
  } catch {
    return [];
  }
}
