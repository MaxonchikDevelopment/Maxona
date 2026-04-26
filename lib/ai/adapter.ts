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

export type { ExecutionDelta };

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
}

export interface PlannedSession {
  scheduledDate: Date;
  preferredSlot: TimeSlot;
  planningType: SessionPlanningType;
  durationMin: number;
  intensity: SessionIntensity;
  notes?: string;
}

export interface PlanResult {
  focusSummary: string;
  changeExplanation?: string;
  sessions: PlannedSession[];
}

export interface AIAdapter {
  generatePlan(context: PlanningContext): Promise<PlanResult>;
}
