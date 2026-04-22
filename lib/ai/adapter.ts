import type {
  Goal,
  AvailabilityWindow,
  ScheduleEvent,
  TrainingSession,
  TimeSlot,
  SessionPlanningType,
  SessionIntensity,
} from "@prisma/client";

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
  weekStart: Date;
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
  sessions: PlannedSession[];
}

export interface AIAdapter {
  generatePlan(context: PlanningContext): Promise<PlanResult>;
}
