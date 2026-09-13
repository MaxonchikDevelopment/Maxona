import type {
  Goal,
  AvailabilityWindow,
  ScheduleEvent,
  TrainingSession,
  TimeSlot,
  SessionPlanningType,
  SessionIntensity,
} from "@prisma/client";
import type { CheckInCategory } from "@/lib/checkin-utils";
import type { ExecutionDelta } from "@/lib/planner/execution-delta";
import type { GoalGuidance } from "@/lib/planner/goal-guidance";

export type { ExecutionDelta };
export type { GoalGuidance };

export interface ParsedTemporalConstraint {
  day: string;
  slot: string | null;
  type: "available_only" | "blocked";
}

export interface RecentCheckIn {
  sessionId: string;
  sessionDate: string;
  sessionIntensity: SessionIntensity;
  feelScore: number;
  notes: string | null;
  resolvedAt: string | null;
  category: CheckInCategory;
}

export interface CurrentWeekDoneSession {
  date: string;
  durationMin: number;
  intensity: SessionIntensity;
  notes: string | null;
  status: string;
  executionDelta?: ExecutionDelta;
}

export interface FixedSession {
  date: string;
  preferredSlot: string;
  durationMin: number;
  intensity: string;
  notes: string | null;
}

export interface OptionalSlot {
  date: string;
  preferredSlot: string;
  durationMin: number;
  intensity: string;
  notes: string | null;
}

export interface WeeklyReview {
  recoveryScore?: number;
  priorities?: string[];
  familyConstraints?: string;
  trainingPreferencesText?: string;
  parsedConstraints?: ParsedTemporalConstraint[];
  // Structured pre-plan check-in (planner context only; not yet persisted —
  // a WeekSummary migration would make these first-class history).
  fatigue?: number; // 1 fresh → 5 wrecked
  soreness?: number; // 1 none → 5 severe
  motivation?: number; // 1 low → 5 high
  sorenessAreas?: string[];
}

export interface ParsedPreferences {
  explicitDayRequests: Array<{ day: string; modality: string; intensityHint?: string; slotHint?: string }>;
  desiredModalities: Array<{ modality: string; minCount: number; maxCount?: number; intensityHint?: string; preferredDays?: string[]; preferredSlot?: string }>;
  sacrificedModalities: string[];
  availabilityHints?: Array<{ day: string; blockedSlots: string[] }>;
}

export interface ReadinessEntry {
  date: string;
  feelScore: number;
  category: string;
  tags: string[];
  notes: string | null;
}

export interface ReadinessSummary {
  latestEntry?: ReadinessEntry;
  activeWarnings: ReadinessEntry[];
  affectsRemainingWeek: boolean;
}

// Compact per-week retrospective drawn from persisted WeekSummary rows, oldest
// → newest, fed to the planner as a multi-week trend signal.
export interface WeekHistoryEntry {
  weekStart: string;
  adherenceByCount: number;
  hardDone: number;
  hardPlanned: number;
  avgFeelScore: number | null;
  mainLimiter: string | null;
  carryForward: string[];
}

export interface PlanningContext {
  user: {
    id: string;
    name: string;
    timezone: string;
    constraints: Record<string, unknown>;
  };
  goals: Goal[];
  availabilityWindows: AvailabilityWindow[];
  scheduleEvents: ScheduleEvent[];
  previousSessions: TrainingSession[];
  recentCheckIns: RecentCheckIn[];
  thisWeekCheckIns: RecentCheckIn[];
  weekStart: Date;
  todayStr: string;
  currentWeekDoneSessions: CurrentWeekDoneSession[];
  fixedSessions: FixedSession[];
  optionalSlots: OptionalSlot[];
  safetyBlockedSessions?: FixedSession[];
  weeklyReview?: WeeklyReview;
  replanReason?: string;
  readinessSummary?: ReadinessSummary;
  parsedPreferences?: ParsedPreferences;
  goalGuidance?: GoalGuidance;
  weekHistory?: WeekHistoryEntry[];
}

export interface PlannedSession {
  scheduledDate: Date;
  preferredSlot: TimeSlot;
  planningType: SessionPlanningType;
  durationMin: number;
  intensity: SessionIntensity;
  notes?: string;
  // Structured supplement to `notes`, filled when the session type supports
  // a concrete target (running/cycling); left undefined otherwise (e.g. strength).
  // Not yet persisted — TrainingSession/SessionWorkoutPlan have no columns for
  // these, so they are dropped after generation until a migration adds them.
  distanceKm?: number;
  targetPaceMinPerKm?: string;
  targetHrZone?: { min: number; max: number };
  subtype?: string;
}

export interface PlanResult {
  focusSummary: string;
  changeExplanation?: string;
  sessions: PlannedSession[];
}

export interface AIAdapter {
  generatePlan(context: PlanningContext): Promise<PlanResult>;
}
