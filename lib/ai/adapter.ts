import type {
  Goal,
  AvailabilityWindow,
  ScheduleEvent,
  TrainingSession,
  TimeSlot,
  SessionPlanningType,
  SessionIntensity,
} from "@prisma/client";

export interface RecentCheckIn {
  sessionId: string;
  sessionDate: string;
  sessionIntensity: SessionIntensity;
  feelScore: number;
  notes: string | null;
}

export interface CurrentWeekDoneSession {
  date: string;
  durationMin: number;
  intensity: SessionIntensity;
  notes: string | null;
  status: string;
}

export interface FixedSession {
  date: string;
  preferredSlot: string;
  durationMin: number;
  intensity: string;
  notes: string | null;
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
  replanReason?: string;
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
