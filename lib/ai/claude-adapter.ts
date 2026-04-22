import Anthropic from "@anthropic-ai/sdk";
import type { AIAdapter, PlanningContext, PlanResult, PlannedSession } from "./adapter";

export class ClaudeAdapter implements AIAdapter {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async generatePlan(context: PlanningContext): Promise<PlanResult> {
    const response = await this.client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: [SUBMIT_PLAN_TOOL],
      tool_choice: { type: "tool", name: "submit_plan" },
      messages: [{ role: "user", content: buildUserPrompt(context) }],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("ClaudeAdapter: expected tool_use block in response");
    }

    const input = toolUse.input as SubmitPlanInput;

    return {
      focusSummary: input.focusSummary,
      sessions: input.sessions.map((s) => ({
        scheduledDate: new Date(s.scheduledDate),
        preferredSlot: s.preferredSlot as PlannedSession["preferredSlot"],
        planningType: s.planningType as PlannedSession["planningType"],
        durationMin: s.durationMin,
        intensity: s.intensity as PlannedSession["intensity"],
        notes: s.notes,
      })),
    };
  }
}

interface SubmitPlanInput {
  focusSummary: string;
  sessions: Array<{
    scheduledDate: string;
    preferredSlot: string;
    planningType: string;
    durationMin: number;
    intensity: string;
    notes?: string;
  }>;
}

const SYSTEM_PROMPT = `You are an adaptive sports training assistant. Generate a 7-day training plan.
Rules:
- Only schedule sessions within the user's availability windows
- Skip days with blocking ScheduleEvents
- Minimum 48h between hard sessions
- Do not increase total weekly volume by more than 10% over the previous week
- Respect maxContinuousTrainingMinutes from user constraints
- planningType meanings:
  - fixed: session cannot be moved or removed automatically
  - preferred: preserve if possible, but may be moved when necessary
  - generated: fully flexible, place where it fits best`;

const SUBMIT_PLAN_TOOL = {
  name: "submit_plan",
  description: "Submit the generated weekly training plan",
  input_schema: {
    type: "object",
    properties: {
      focusSummary: {
        type: "string",
        description: "One or two sentences on the week's training focus",
      },
      sessions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            scheduledDate: { type: "string", description: "YYYY-MM-DD" },
            preferredSlot: {
              type: "string",
              enum: ["morning", "daytime", "afternoon", "evening"],
            },
            planningType: {
              type: "string",
              enum: ["fixed", "preferred", "generated"],
            },
            durationMin: { type: "number" },
            intensity: {
              type: "string",
              enum: ["easy", "moderate", "hard"],
            },
            notes: { type: "string" },
          },
          required: [
            "scheduledDate",
            "preferredSlot",
            "planningType",
            "durationMin",
            "intensity",
          ],
        },
      },
    },
    required: ["focusSummary", "sessions"],
  },
} as const;

function buildUserPrompt(context: PlanningContext): string {
  return JSON.stringify(
    {
      weekStart: context.weekStart.toISOString().split("T")[0],
      replanReason: context.replanReason,
      user: {
        name: context.user.name,
        timezone: context.user.timezone,
        constraints: context.user.constraints,
      },
      goals: context.goals.map((g) => ({
        id: g.id,
        title: g.title,
        description: g.description,
        status: g.status,
      })),
      availabilityWindows: context.availabilityWindows.map((w) => ({
        dayOfWeek: w.dayOfWeek,
        timeStartMin: w.timeStartMin,
        timeEndMin: w.timeEndMin,
      })),
      scheduleEvents: context.scheduleEvents.map((e) => ({
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        kind: e.kind,
        note: e.note,
      })),
      previousWeek: {
        sessionCount: context.previousSessions.length,
        totalMinutes: context.previousSessions.reduce(
          (sum, s) => sum + s.durationMin,
          0
        ),
      },
    },
    null,
    2
  );
}
