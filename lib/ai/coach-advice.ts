import Anthropic from "@anthropic-ai/sdk";
import type { CheckInCategory } from "@/lib/checkin-utils";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface StravaSessionMetrics {
  activityCount: number;
  sportMix: string[];
  totalDistance: number;
  totalMovingTime: number;
  totalElapsedTime: number;
  totalElevationGain: number;
  pauseTime: number;
  pauseRatio: number;
  avgHeartrateMean: number | null;
  maxHeartrateMax: number | null;
  averageSpeedMean: number | null;
  elevationPerKm: number | null;
  actualVsPlannedDurationDeltaMin: number | null;
  splitSession: boolean;
}

export interface WorkoutAnalytics {
  hardSessionsThisWeek: number;
  minutesDoneThisWeek: number;
  backToBackHardRisk: boolean;
  nextPlannedSession: { date: string; intensity: string; notes: string | null } | null;
  plannerMode: "protecting" | "reducing" | "maintaining" | "building" | null;
  isLongRunWeek: boolean;
  isHyroxHeavyWeek: boolean;
  stravaMetrics?: StravaSessionMetrics;
}

function buildAnalyticsSummary(a: WorkoutAnalytics): string {
  const parts: string[] = [
    `Hard sessions this week: ${a.hardSessionsThisWeek} · ${a.minutesDoneThisWeek} min done`,
  ];
  if (a.backToBackHardRisk) parts.push("Back-to-back hard load: YES");
  if (a.nextPlannedSession) {
    const ns = a.nextPlannedSession;
    parts.push(`Next planned: ${ns.date} ${ns.intensity}${ns.notes ? ` · ${ns.notes}` : ""}`);
  }
  if (a.plannerMode && a.plannerMode !== "maintaining") parts.push(`Planner stance: ${a.plannerMode}`);
  if (a.isLongRunWeek) parts.push("Long run week: yes");
  if (a.isHyroxHeavyWeek) parts.push("HYROX-heavy week: yes (≥2 sessions)");
  if (a.stravaMetrics) {
    const sm = a.stravaMetrics;
    const segs: string[] = [sm.sportMix.join("+")];
    if (sm.totalDistance > 0) segs.push(`${(sm.totalDistance / 1000).toFixed(1)}km`);
    if (sm.totalMovingTime > 0) {
      segs.push(`${Math.floor(sm.totalMovingTime / 60)}min moving`);
      const breakMin = Math.round(sm.pauseTime / 60);
      if (breakMin >= 5) {
        const pauseFlag = sm.pauseRatio > 0.15 ? ` [HIGH PAUSE: ${Math.round(sm.pauseRatio * 100)}%]` : "";
        segs.push(`${breakMin}min stopped${pauseFlag}`);
      }
    }
    if (sm.averageSpeedMean && sm.averageSpeedMean > 0 && sm.totalDistance > 0) {
      const isRunning = sm.sportMix.some((sp) => /run/i.test(sp));
      if (isRunning) {
        const paceSecPerKm = 1000 / sm.averageSpeedMean;
        const paceMin = Math.floor(paceSecPerKm / 60);
        const paceSec = Math.round(paceSecPerKm % 60);
        segs.push(`pace ${paceMin}:${String(paceSec).padStart(2, "0")}/km`);
      } else {
        segs.push(`avg ${(sm.averageSpeedMean * 3.6).toFixed(1)}km/h`);
      }
    }
    if (sm.avgHeartrateMean) segs.push(`HR avg ${Math.round(sm.avgHeartrateMean)}`);
    if (sm.maxHeartrateMax) segs.push(`max HR ${Math.round(sm.maxHeartrateMax)}`);
    if (sm.totalElevationGain > 0) {
      const elevPerKmStr = sm.elevationPerKm !== null && sm.elevationPerKm >= 10
        ? ` (${Math.round(sm.elevationPerKm)}m/km)`
        : "";
      segs.push(`${Math.round(sm.totalElevationGain)}m elev${elevPerKmStr}`);
    }
    if (sm.actualVsPlannedDurationDeltaMin !== null) {
      const delta = Math.round(sm.actualVsPlannedDurationDeltaMin);
      if (Math.abs(delta) >= 5) {
        segs.push(delta >= 0 ? `+${delta}min vs plan` : `${delta}min vs plan`);
      }
    }
    parts.push(`Strava${sm.splitSession ? " (split session)" : ""}: ${segs.join(" · ")}`);
  }
  return parts.map((p) => `- ${p}`).join("\n");
}

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
  analytics?: WorkoutAnalytics;
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

  const analyticsBlock = params.analytics
    ? `\nWorkout analytics:\n${buildAnalyticsSummary(params.analytics)}`
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
Context: ${context}${weekContext}${analyticsBlock}

Give 2–3 concrete next-step suggestions. Rules:
- Each ≤ 20 words, sport-specific, actionable
- No "listen to your body" or "rest is important"
- For injury: suggest specific movement alternatives or targeted mobility work
- For fatigue: tie to weekly load from analytics — e.g. "After ${params.analytics?.hardSessionsThisWeek ?? "X"} hard sessions / ${params.analytics?.minutesDoneThisWeek ?? "Y"} min this week, …"
- If back-to-back hard load or high weekly minutes: suggest recovery alternatives specifically
- Reference the specific sport or body part mentioned
- If Strava data shows distance or pace: reference the actual numbers (e.g. "5.2km at 6:10/km") — skip HR if not in the analytics block
- If Strava shows "HIGH PAUSE" flag: reference fragmented session pattern specifically
- If Strava shows elevation per km (e.g. "35m/km"): mention hill load if it contributed to difficulty
- If Strava shows "-Xmin vs plan": briefly acknowledge short execution before giving recovery advice
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
Notes: ${params.notes ? `"${params.notes}"` : "(none)"}${weekContext}${analyticsBlock}

Give 1–2 short coach observations. Rules:
- Each ≤ 20 words
- Default tone: neutral and analytical — 4/6 is workable and normal, not a warning sign
- Reference load trend or hard session count only if back-to-back hard risk is confirmed or hardSessionsThisWeek ≥ 3; otherwise stay positive or neutral
- If load is light: lean positive — athlete is pacing well
- Reference next planned session from analytics if available — does this session position well for it?
- If Strava data present: briefly note actual distance or pace vs session type; skip HR if not in analytics block
- If Strava shows "HIGH PAUSE": note the stopping pattern — useful data even at 4/6
- If Strava shows elevation per km (Xm/km) and it is ≥ 15: briefly note the hill component
- If Strava shows "+Xmin vs plan" or "-Xmin vs plan": reference execution vs planned duration
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
Notes: ${params.notes ? `"${params.notes}"` : "(none)"}${weekContext}${analyticsBlock}

Give 1–2 short coach observations. Rules:
- Each ≤ 20 words
- Analytical, not generic praise — reference load, sport, or recovery context
- If hardSessionsThisWeek ≥ 2 or back-to-back hard: note stacking risk despite good feel
- If next planned session is hard and near: mention whether this session positions well for it
- If planner stance is protecting/reducing: acknowledge the positive rebound while keeping context
- If Strava data shows distance or pace: reference the specific number (e.g. "7.1km at 5:05/km"); skip HR commentary if not shown in analytics block
- If Strava shows elevation per km (Xm/km): credit the hill stimulus explicitly
- If Strava shows "+Xmin vs plan": note strong execution over target
- If Strava shows "HIGH PAUSE" despite good feel: still flag the stopping pattern as worth watching
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

// ─── Daily Readiness Coach Advice ─────────────────────────────────────────────

export async function generateReadinessCoachAdvice(params: {
  feelScore: number;
  notes: string | null;
  tags: string[];
  category: CheckInCategory;
}): Promise<string | null> {
  const tagStr = params.tags.length > 0 ? `Tags: ${params.tags.join(", ")}` : "";

  try {
    if (params.feelScore <= 3) {
      const context =
        params.category === "injury"
          ? "Athlete reports possible injury or pain — physical issue."
          : "Athlete reports fatigue, poor recovery, or systemic stress — not an injury.";

      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: `Sports coach. Athlete submitted a daily readiness check-in (not after a session).

Daily readiness score: ${params.feelScore}/6
Notes: ${params.notes ? `"${params.notes}"` : "(none)"}
${tagStr}
Context: ${context}

Give 1–2 concrete suggestions for managing today and tomorrow's training. Rules:
- Each ≤ 20 words
- Actionable and specific to the tags/notes if present (e.g. alcohol → hydration; poor_sleep → nap; travel → easy only)
- For injury: suggest modified load or targeted recovery for tomorrow's session
- Format: "• [suggestion]"
No intro. No preamble.`,
          },
        ],
      });

      const block = response.content.find((b) => b.type === "text");
      return block?.type === "text" ? block.text.trim() : null;
    }

    if (params.feelScore === 4) {
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 120,
        messages: [
          {
            role: "user",
            content: `Sports coach. Athlete submitted a daily readiness check-in.

Daily readiness score: 4/6
Notes: ${params.notes ? `"${params.notes}"` : "(none)"}
${tagStr}

Give 1 short analytical observation about today's readiness. Rules:
- ≤ 20 words
- Treat 4/6 as okay and workable — not a warning, not a problem
- Only reference tags if they add context; do not over-explain normal fatigue
- Tone: neutral to mildly positive — athlete is ready to train
- Format: "• [observation]"
No intro. No preamble.`,
          },
        ],
      });

      const block = response.content.find((b) => b.type === "text");
      return block?.type === "text" ? block.text.trim() : null;
    }

    // feelScore >= 5
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 120,
      messages: [
        {
          role: "user",
          content: `Sports coach. Athlete submitted a daily readiness check-in.

Daily readiness score: ${params.feelScore}/6
Notes: ${params.notes ? `"${params.notes}"` : "(none)"}
${tagStr}

Give 1 short positive observation about readiness for tomorrow's training. Rules:
- ≤ 20 words
- Specific, not generic praise
- Format: "• [observation]"
No intro. No preamble.`,
        },
      ],
    });

    const block = response.content.find((b) => b.type === "text");
    return block?.type === "text" ? block.text.trim() : null;
  } catch (err) {
    console.error("[coach-advice] generateReadinessCoachAdvice failed:", err);
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
  readinessSignal?: { date: string; feelScore: number; category: string; tags: string[]; notes: string | null };
  plannerMode?: "protecting" | "reducing" | "maintaining" | "building";
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
      payload.readinessSignal
        ? `Daily readiness: ${payload.readinessSignal.date} feel=${payload.readinessSignal.feelScore}/6 category=${payload.readinessSignal.category}${payload.readinessSignal.tags.length > 0 ? ` tags=${payload.readinessSignal.tags.join(",")}` : ""}${payload.readinessSignal.notes ? ` "${payload.readinessSignal.notes}"` : ""}`
        : null,
      payload.injurySignals.length > 0
        ? `ACTIVE injury: ${payload.injurySignals.map((s) => `${s.date} feel=${s.feelScore}/6${s.notes ? ` "${s.notes}"` : ""}`).join(", ")}`
        : null,
      payload.fatigueSignals.length > 0
        ? `ACTIVE fatigue: ${payload.fatigueSignals.map((s) => `${s.date} feel=${s.feelScore}/6${s.notes ? ` "${s.notes}"` : ""}`).join(", ")}`
        : null,
      payload.plannerMode ? `Planner stance: ${payload.plannerMode}` : null,
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
- Anchor tone to the planner stance: protecting → explain what's being avoided; reducing → explain fatigue context; building → explain load increase; maintaining → confirm stability
- Reference check-in or readiness feel score when relevant; mention tags (poor_sleep, alcohol, etc.) if they drove the change
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
