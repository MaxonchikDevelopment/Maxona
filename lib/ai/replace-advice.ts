import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ReplaceAlternative {
  label: string;
  durationMin: number;
  rationale: string;
}

interface PlannedSessionContext {
  intensity: string;
  durationMin: number;
  notes: string | null;
}

interface ReadinessContext {
  feelScore: number;
  category: string;
  notes: string | null;
}

interface RecentSessionContext {
  date: string;
  intensity: string;
  notes: string | null;
  feelScore?: number;
}

function buildContextLines(
  plannedSession: PlannedSessionContext,
  readiness?: ReadinessContext | null,
  recentSessions?: RecentSessionContext[]
): string {
  const lines = [
    `Planned session: ${plannedSession.intensity} · ${plannedSession.durationMin}min${plannedSession.notes ? ` · ${plannedSession.notes}` : ""}`,
  ];
  if (readiness) {
    lines.push(
      `Readiness: feel ${readiness.feelScore}/6, category=${readiness.category}${readiness.notes ? `, notes="${readiness.notes}"` : ""}`
    );
  }
  if (recentSessions && recentSessions.length > 0) {
    lines.push(
      `Recent sessions:\n${recentSessions
        .map(
          (s) =>
            `- ${s.date}: ${s.intensity}${s.notes ? ` · ${s.notes}` : ""}${s.feelScore != null ? ` (feel ${s.feelScore}/6)` : ""}`
        )
        .join("\n")}`
    );
  }
  return lines.join("\n");
}

const SUGGEST_ALTERNATIVES_TOOL = {
  name: "submit_alternatives",
  description: "Submit a short list of alternative workout options",
  input_schema: {
    type: "object" as const,
    properties: {
      alternatives: {
        type: "array",
        description: "2-3 alternative workouts, ordered best-fit first",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Short name, e.g. 'Easy 30min run'" },
            durationMin: { type: "number" },
            rationale: { type: "string", description: "≤ 15 words: why this fits today" },
          },
          required: ["label", "durationMin", "rationale"],
        },
      },
    },
    required: ["alternatives"],
  },
} as const;

function fallbackAlternatives(plannedSession: PlannedSessionContext): ReplaceAlternative[] {
  const dur = plannedSession.durationMin;
  const easyDur = Math.max(20, Math.round(dur * 0.6));
  return [
    {
      label: `Easy ${plannedSession.intensity === "easy" ? "session" : "version"}, ~${easyDur}min`,
      durationMin: easyDur,
      rationale: "Similar time, lower load",
    },
    { label: "Mobility / recovery", durationMin: Math.min(30, dur), rationale: "Keeps consistency without adding strain" },
    { label: "Rest today", durationMin: 0, rationale: "Full rest, resume next planned session" },
  ];
}

export async function generateReplaceSuggestions(params: {
  plannedSession: PlannedSessionContext;
  readiness?: ReadinessContext | null;
  recentSessions?: RecentSessionContext[];
}): Promise<ReplaceAlternative[]> {
  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      tools: [SUGGEST_ALTERNATIVES_TOOL],
      tool_choice: { type: "tool", name: "submit_alternatives" },
      messages: [
        {
          role: "user",
          content: `Sports coach. Athlete can't do their planned session and wants alternative ideas that fit today.

${buildContextLines(params.plannedSession, params.readiness, params.recentSessions)}

Give 2-3 short alternative workout options. Rules:
- Respect readiness: if fatigue/injury signals present, favor lower-intensity or shorter options
- Stay within or below the planned duration unless readiness is strong (feel ≥5) and no injury/fatigue signals
- Keep labels short and concrete (sport + effort, e.g. "Easy 30min bike")
- Rationale ≤ 15 words each`,
        },
      ],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return fallbackAlternatives(params.plannedSession);

    const raw = toolUse.input as { alternatives?: ReplaceAlternative[] };
    const alternatives = Array.isArray(raw.alternatives) ? raw.alternatives.slice(0, 3) : [];
    return alternatives.length > 0 ? alternatives : fallbackAlternatives(params.plannedSession);
  } catch (err) {
    console.error("[replace-advice] generateReplaceSuggestions failed:", err);
    return fallbackAlternatives(params.plannedSession);
  }
}

export async function generateReplaceSanityCheck(params: {
  plannedSession: PlannedSessionContext;
  replacementDescription: string;
  reason?: string | null;
  readiness?: ReadinessContext | null;
  recentSessions?: RecentSessionContext[];
}): Promise<string> {
  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `Sports coach. Athlete is swapping their planned session for something else.

${buildContextLines(params.plannedSession, params.readiness, params.recentSessions)}
Doing instead: ${params.replacementDescription}${params.reason ? ` (reason: ${params.reason})` : ""}

Give a short sanity-check on this swap. Rules:
- 1-2 bullets, each ≤ 20 words
- Confirm if reasonable, or flag one concrete adjustment (load, intensity, or timing)
- Reference readiness or recent load only if it changes the verdict
- Format: "• [point]"
No intro. No preamble.`,
        },
      ],
    });

    const block = response.content.find((b) => b.type === "text");
    const text = block?.type === "text" ? block.text.trim() : null;
    return text || "Noted — logged as your session for today.";
  } catch (err) {
    console.error("[replace-advice] generateReplaceSanityCheck failed:", err);
    return "Noted — logged as your session for today.";
  }
}
