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
  const weekContext =
    params.recentContext && params.recentContext.length > 0
      ? `\nRecent sessions this week:\n${params.recentContext
          .map(
            (s) =>
              `- ${s.date}: ${s.intensity} ${s.notes ?? ""}${s.feelScore != null ? ` (feel ${s.feelScore}/6)` : ""}${s.category && s.category !== "ok" ? ` [${s.category}]` : ""}`
          )
          .join("\n")}`
      : "";

  if (params.feelScore <= 3) {
    const context =
      params.category === "injury"
        ? "Athlete reports possible injury or pain — this is a physical issue."
        : "Athlete reports exhaustion, fatigue, or poor performance — NOT an injury, just a rough day.";

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

  // feelScore === 4: analytical observation — week-aware, mildly cautionary or positive
  if (params.feelScore === 4) {
    try {
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        messages: [
          {
            role: "user",
            content: `Sports coach. Athlete reported an average session — not bad, not great.

Session: ${params.sessionIntensity} · ${params.sessionDurationMin}min${params.sessionNotes ? ` · ${params.sessionNotes}` : ""}
Feel score: 4/6
Notes: ${params.notes ? `"${params.notes}"` : "(none)"}${weekContext}

Give 1–2 short coach observations. Rules:
- Each ≤ 20 words
- Analytical: note readiness level, load trend, or what 4/6 signals about fatigue or adaptation
- Mildly cautionary if sessions are stacking; mildly positive if load has been light or it's a taper phase
- No generic praise or alarm — reference the specific session type and weekly context above
- Format: "• [observation]"
No intro. No preamble.`,
          },
        ],
      });

      const block = response.content.find((b) => b.type === "text");
      return block?.type === "text" ? block.text.trim() : null;
    } catch (err) {
      console.error("[coach-advice] neutral advice failed:", err);
      return null;
    }
  }

  // feelScore >= 5: positive analytical coach advice
  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      messages: [
        {
          role: "user",
          content: `Sports coach. Athlete reported a strong session.

Session: ${params.sessionIntensity} · ${params.sessionDurationMin}min${params.sessionNotes ? ` · ${params.sessionNotes}` : ""}
Feel score: ${params.feelScore}/6
Notes: ${params.notes ? `"${params.notes}"` : "(none)"}${weekContext}

Give 1–2 short coach observations. Rules:
- Each ≤ 20 words
- Analytical, not generic praise — reference load, sport, or recovery context
- One observation may be cautionary if stacking risk exists (back-to-back hard sessions, high weekly volume)
- Format: "• [observation]"
No intro. No preamble.`,
        },
      ],
    });

    const block = response.content.find((b) => b.type === "text");
    return block?.type === "text" ? block.text.trim() : null;
  } catch (err) {
    console.error("[coach-advice] positive advice failed:", err);
    return null;
  }
}

// ─── Change Explanation ────────────────────────────────────────────────────────

export interface ChangeSummaryPayload {
  replanReason?: string;
  doneSessionsThisWeek: Array<{ date: string; label: string; intensity: string }>;
  latestCheckIn?: { date: string; feelScore: number; notes: string | null; category: string };
  injurySignals: Array<{ date: string; feelScore: number; notes: string | null }>;
  fatigueSignals: Array<{ date: string; feelScore: number; notes: string | null }>;
  safetyBlockedSessions: Array<{ date: string; day: string; label: string }>;
  removedSessions: Array<{ date: string; day: string; label: string; reason: string }>;
  addedSessions: Array<{ date: string; day: string; label: string; intensity: string }>;
  remainingPlannedSessions: Array<{ date: string; day: string; label: string; intensity: string; durationMin: number }>;
  weeklyReviewPriority?: string;
}

function buildFallbackBullets(payload: ChangeSummaryPayload): string {
  const bullets: string[] = [];

  for (const s of payload.safetyBlockedSessions) {
    if (bullets.length >= 4) break;
    const ci = payload.injurySignals[0];
    bullets.push(
      `• ${s.day} ${s.label} removed — injury rest window${ci ? ` (feel ${ci.feelScore}/6)` : ""}; avoids aggravating injury`
    );
  }

  for (const s of payload.removedSessions) {
    if (bullets.length >= 4) break;
    bullets.push(`• ${s.day} ${s.label} removed — ${s.reason}`);
  }

  for (const s of payload.addedSessions) {
    if (bullets.length >= 4) break;
    bullets.push(`• ${s.day} ${s.label} added`);
  }

  if (bullets.length < 2) {
    if (payload.injurySignals.length > 0 && payload.safetyBlockedSessions.length === 0) {
      bullets.push(
        `• Hard sessions limited — active injury (feel ${payload.injurySignals[0].feelScore}/6); easy/moderate only to protect recovery`
      );
    } else if (payload.fatigueSignals.length > 0) {
      const count = payload.fatigueSignals.length;
      bullets.push(
        `• Load eased — ${count} fatigue signal${count > 1 ? "s" : ""} (feel ${payload.fatigueSignals[0].feelScore}/6); better to train fresh than exhausted`
      );
    }
  }

  if (payload.weeklyReviewPriority && bullets.length < 4) {
    bullets.push(`• Focus: ${payload.weeklyReviewPriority.toLowerCase()}`);
  }

  if (bullets.length === 0) {
    bullets.push(`• No changes to remaining sessions this week — ${payload.replanReason ?? "manual replan"}`);
  }

  return bullets.slice(0, 4).join("\n");
}

export async function renderChangeExplanation(payload: ChangeSummaryPayload): Promise<string> {
  try {
    const doneStr =
      payload.doneSessionsThisWeek.length > 0
        ? payload.doneSessionsThisWeek.map((s) => `${s.date} ${s.label} (${s.intensity})`).join(", ")
        : "none yet";

    const removed = [
      ...payload.safetyBlockedSessions.map((s) => `${s.day} ${s.label} [injury-blocked]`),
      ...payload.removedSessions.map((s) => `${s.day} ${s.label} [${s.reason}]`),
    ];
    const added = payload.addedSessions.map((s) => `${s.day} ${s.label} (${s.intensity})`);
    const remaining = payload.remainingPlannedSessions.map(
      (s) => `${s.day} ${s.label} (${s.intensity}, ${s.durationMin}min)`
    );

    const lines = [
      `Done this week: ${doneStr}`,
      payload.latestCheckIn
        ? `Latest check-in: ${payload.latestCheckIn.date} feel=${payload.latestCheckIn.feelScore}/6 category=${payload.latestCheckIn.category}${payload.latestCheckIn.notes ? ` "${payload.latestCheckIn.notes}"` : ""}`
        : null,
      payload.injurySignals.length > 0
        ? `ACTIVE injury: ${payload.injurySignals.map((s) => `${s.date} feel=${s.feelScore}/6${s.notes ? ` "${s.notes}"` : ""}`).join(", ")}`
        : null,
      payload.fatigueSignals.length > 0
        ? `ACTIVE fatigue: ${payload.fatigueSignals.map((s) => `${s.date} feel=${s.feelScore}/6${s.notes ? ` "${s.notes}"` : ""}`).join(", ")}`
        : null,
      `Sessions removed: ${removed.length > 0 ? removed.join("; ") : "none"}`,
      `Sessions added: ${added.length > 0 ? added.join("; ") : "none"}`,
      `Remaining plan: ${remaining.length > 0 ? remaining.join("; ") : "rest of week clear"}`,
      payload.weeklyReviewPriority ? `Focus priority: ${payload.weeklyReviewPriority}` : null,
      payload.replanReason ? `Replan reason: ${payload.replanReason}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `Sports coach. Write "What changed" for a training plan replan. Explain what changed AND why it helps performance or recovery.

${lines}

Rules:
- 3–4 bullets max
- Each ≤ 25 words
- Only reference sessions listed above — never invent sessions
- Explain WHY the change helps (recovery, taper, load balance, specificity)
- Reference check-in feel score or body state when relevant
- Sound like an experienced coach, not a template
- Format: "• [bullet]"
No intro. No preamble.`,
        },
      ],
    });

    const block = response.content.find((b) => b.type === "text");
    const text = block?.type === "text" ? block.text.trim() : null;
    return text ?? buildFallbackBullets(payload);
  } catch (err) {
    console.error("[coach-advice] renderChangeExplanation failed:", err);
    return buildFallbackBullets(payload);
  }
}
