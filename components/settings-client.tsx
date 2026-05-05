"use client";
import { useState, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { StravaSettings } from "@/components/strava-settings";
import type { StravaConnectionProp } from "@/components/strava-settings";
import { PageWrapper, StaggerList, StaggerItem } from "@/components/ui/page-wrapper";

export type NutritionProfileProp = {
  dietNotes: string | null;
  avoidFoods: string | null;
  preferredBreakfast: string | null;
  preferredPreWorkoutSnack: string | null;
  preferredPostWorkoutMeal: string | null;
  caffeineSensitive: boolean;
  stomachSensitive: boolean;
  currentMealPattern: string | null;
  nutritionGoal: string | null;
  minHoursAfterMainMealBeforeWorkout: number | null;
  preWorkoutSnackTolerance: string | null;
  preferredFoods: string | null;
  supplements: string | null;
  cookingTimePreference: string | null;
  bodyWeightKg: number | null;
  estimatedRestDayCalories: number | null;
  calorieGoal: string | null;
};

export type TrainingProfileProp = {
  restingHr: number | null;
  maxHr: number | null;
  easyHrMin: number | null;
  easyHrMax: number | null;
  tempoHrMin: number | null;
  tempoHrMax: number | null;
  thresholdHr: number | null;
  zoneMethod: string;
};

export type HybridProfileProp = {
  defaultFormat: string;
  includesRunningDefault: boolean;
  stationWorkSec: number;
  stationRestSec: number;
  defaultRounds: number;
  notes: string | null;
};

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_LABELS: Record<string, string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
};
const SLOTS = ["morning", "daytime", "afternoon", "evening"] as const;
const INTENSITIES = ["easy", "moderate", "hard"] as const;
const EVENT_KINDS = ["blocked", "household", "calendar_busy", "travel"] as const;
const MODALITIES = ["hyrox", "running", "cycling", "swimming"] as const;

type AvailWindow = { id: string; dayOfWeek: string; timeStartMin: number; timeEndMin: number };
type ScheduleEv = { id: string; startsAt: string; endsAt: string; kind: string; note: string | null };
type RecSession = {
  id: string;
  dayOfWeek: string;
  preferredSlot: string;
  planningType: string;
  durationMin: number;
  intensity: string;
  notes: string | null;
};

function minsToTime(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function timeToMins(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

type Constraints = {
  maxContinuousTrainingMinutes?: number;
  weeklyTrainingHoursTarget?: number;
  allowedModalities?: string[];
  avoidFridayEvening?: boolean;
  preferredEasyRideDurationMin?: number;
  preferredLongRideDurationMin?: number;
  preferredLongRunDurationMin?: number;
  minMeaningfulCyclingDurationMin?: number;
  maxHyroxPerWeek?: number;
  preferredHyroxDays?: string[];
  preferredEasyRunKm?: number;
  preferredTempoRunKm?: number;
  preferredLongRunKm?: number;
};

const HYBRID_FORMATS = [
  { value: "station_circuit", label: "Station circuit" },
  { value: "run_station_intervals", label: "Run + station intervals" },
  { value: "race_simulation", label: "Race simulation" },
  { value: "strength_focus", label: "Strength focus" },
  { value: "engine_focus", label: "Engine focus" },
  { value: "technique", label: "Technique" },
] as const;

// ── Shared styling helpers ────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-300";
const selectCls =
  "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-300";
const labelCls = "block text-xs font-medium text-zinc-500 mb-1";
const sectionHeadingCls = "text-[10px] font-semibold uppercase tracking-widest text-zinc-400";
const cardCls = "rounded-2xl bg-white border border-zinc-100 shadow-card p-4 space-y-4";
const saveBtnCls =
  "rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 transition-colors disabled:opacity-50";
const savedBtnCls =
  "rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white";

// ── Collapsible section wrapper ───────────────────────────────────────────────
function CollapsibleSection({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl bg-white border border-zinc-100 shadow-card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-xs font-semibold text-zinc-500">{label}</span>
        <span className="text-[10px] text-zinc-400">{open ? "▲ hide" : "▼ show"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-zinc-100 pt-3">
          {children}
        </div>
      )}
    </div>
  );
}

export function SettingsClient({
  initialConstraints,
  userName,
  userTimezone,
  initialStravaConnection,
  initialTrainingProfile,
  initialHybridProfile,
  initialNutritionProfile,
}: {
  initialConstraints: Constraints;
  userName: string;
  userTimezone: string;
  initialStravaConnection: StravaConnectionProp;
  initialTrainingProfile?: TrainingProfileProp | null;
  initialHybridProfile?: HybridProfileProp | null;
  initialNutritionProfile?: NutritionProfileProp | null;
}) {
  const qc = useQueryClient();

  // ── Training Constraints ──────────────────────────────────────────────────
  const [maxMin, setMaxMin] = useState(String(initialConstraints.maxContinuousTrainingMinutes ?? 240));
  const [hoursTarget, setHoursTarget] = useState(String(initialConstraints.weeklyTrainingHoursTarget ?? ""));
  const [modalities, setModalities] = useState<string[]>(
    initialConstraints.allowedModalities ?? [...MODALITIES]
  );

  // ── Athlete Preferences ───────────────────────────────────────────────────
  const [avoidFriday, setAvoidFriday] = useState(initialConstraints.avoidFridayEvening ?? false);
  const [easyRideDuration, setEasyRideDuration] = useState(
    String(initialConstraints.preferredEasyRideDurationMin ?? "")
  );
  const [longRideDuration, setLongRideDuration] = useState(
    String(initialConstraints.preferredLongRideDurationMin ?? "")
  );
  const [longRunDuration, setLongRunDuration] = useState(
    String(initialConstraints.preferredLongRunDurationMin ?? "")
  );
  const [minCyclingDuration, setMinCyclingDuration] = useState(
    String(initialConstraints.minMeaningfulCyclingDurationMin ?? "")
  );
  const [maxHyrox, setMaxHyrox] = useState(String(initialConstraints.maxHyroxPerWeek ?? ""));
  const [hyroxDays, setHyroxDays] = useState<string[]>(
    initialConstraints.preferredHyroxDays ?? []
  );
  const [easyRunKm, setEasyRunKm] = useState(String(initialConstraints.preferredEasyRunKm ?? ""));
  const [tempoRunKm, setTempoRunKm] = useState(String(initialConstraints.preferredTempoRunKm ?? ""));
  const [longRunKm, setLongRunKm] = useState(String(initialConstraints.preferredLongRunKm ?? ""));
  const [constraintsSaved, setConstraintsSaved] = useState(false);

  // ── Training Profile ──────────────────────────────────────────────────────
  const ip = initialTrainingProfile;
  const [restingHr, setRestingHr] = useState(String(ip?.restingHr ?? ""));
  const [maxHr, setMaxHr] = useState(String(ip?.maxHr ?? ""));
  const [easyHrMin, setEasyHrMin] = useState(String(ip?.easyHrMin ?? ""));
  const [easyHrMax, setEasyHrMax] = useState(String(ip?.easyHrMax ?? ""));
  const [tempoHrMin, setTempoHrMin] = useState(String(ip?.tempoHrMin ?? ""));
  const [tempoHrMax, setTempoHrMax] = useState(String(ip?.tempoHrMax ?? ""));
  const [thresholdHr, setThresholdHr] = useState(String(ip?.thresholdHr ?? ""));
  const [zoneMethod, setZoneMethod] = useState(ip?.zoneMethod ?? "estimated");
  const [trainingProfileSaved, setTrainingProfileSaved] = useState(false);

  const saveTrainingProfile = useMutation({
    mutationFn: () =>
      fetch("/api/settings/training-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restingHr: restingHr || undefined,
          maxHr: maxHr || undefined,
          easyHrMin: easyHrMin || undefined,
          easyHrMax: easyHrMax || undefined,
          tempoHrMin: tempoHrMin || undefined,
          tempoHrMax: tempoHrMax || undefined,
          thresholdHr: thresholdHr || undefined,
          zoneMethod,
        }),
      }).then((r) => r.json()),
    onSuccess: () => {
      setTrainingProfileSaved(true);
      setTimeout(() => setTrainingProfileSaved(false), 2000);
    },
  });

  // ── Hybrid Race Profile ───────────────────────────────────────────────────
  const ih = initialHybridProfile;
  const [hybridFormat, setHybridFormat] = useState(ih?.defaultFormat ?? "station_circuit");
  const [hybridInclRun, setHybridInclRun] = useState(ih?.includesRunningDefault ?? false);
  const [hybridWorkSec, setHybridWorkSec] = useState(String(ih?.stationWorkSec ?? 60));
  const [hybridRestSec, setHybridRestSec] = useState(String(ih?.stationRestSec ?? 20));
  const [hybridRounds, setHybridRounds] = useState(String(ih?.defaultRounds ?? 3));
  const [hybridNotes, setHybridNotes] = useState(ih?.notes ?? "");
  const [hybridProfileSaved, setHybridProfileSaved] = useState(false);

  const saveHybridProfile = useMutation({
    mutationFn: () =>
      fetch("/api/settings/hybrid-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultFormat: hybridFormat,
          includesRunningDefault: hybridInclRun,
          stationWorkSec: Number(hybridWorkSec) || 60,
          stationRestSec: Number(hybridRestSec) || 20,
          defaultRounds: Number(hybridRounds) || 3,
          notes: hybridNotes || undefined,
        }),
      }).then((r) => r.json()),
    onSuccess: () => {
      setHybridProfileSaved(true);
      setTimeout(() => setHybridProfileSaved(false), 2000);
    },
  });

  // ── Nutrition Profile ─────────────────────────────────────────────────────
  const in_ = initialNutritionProfile;
  const [nutDietNotes, setNutDietNotes] = useState(in_?.dietNotes ?? "");
  const [nutAvoidFoods, setNutAvoidFoods] = useState(in_?.avoidFoods ?? "");
  const [nutBreakfast, setNutBreakfast] = useState(in_?.preferredBreakfast ?? "");
  const [nutPreSnack, setNutPreSnack] = useState(in_?.preferredPreWorkoutSnack ?? "");
  const [nutPostMeal, setNutPostMeal] = useState(in_?.preferredPostWorkoutMeal ?? "");
  const [nutCaffeine, setNutCaffeine] = useState(in_?.caffeineSensitive ?? false);
  const [nutStomach, setNutStomach] = useState(in_?.stomachSensitive ?? false);
  const [nutMealPattern, setNutMealPattern] = useState(in_?.currentMealPattern ?? "");
  const [nutGoal, setNutGoal] = useState(in_?.nutritionGoal ?? "");
  const [nutMealGap, setNutMealGap] = useState(String(in_?.minHoursAfterMainMealBeforeWorkout ?? ""));
  const [nutSnackTolerance, setNutSnackTolerance] = useState(in_?.preWorkoutSnackTolerance ?? "");
  const [nutPreferredFoods, setNutPreferredFoods] = useState(in_?.preferredFoods ?? "");
  const [nutSupplements, setNutSupplements] = useState(in_?.supplements ?? "");
  const [nutCookingPref, setNutCookingPref] = useState(in_?.cookingTimePreference ?? "");
  const [nutBodyWeight, setNutBodyWeight] = useState(String(in_?.bodyWeightKg ?? ""));
  const [nutRestCalories, setNutRestCalories] = useState(String(in_?.estimatedRestDayCalories ?? ""));
  const [nutCalorieGoal, setNutCalorieGoal] = useState(in_?.calorieGoal ?? "maintain");
  const [nutritionSaved, setNutritionSaved] = useState(false);

  const saveNutritionProfile = useMutation({
    mutationFn: () =>
      fetch("/api/nutrition/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dietNotes: nutDietNotes || null,
          avoidFoods: nutAvoidFoods || null,
          preferredBreakfast: nutBreakfast || null,
          preferredPreWorkoutSnack: nutPreSnack || null,
          preferredPostWorkoutMeal: nutPostMeal || null,
          caffeineSensitive: nutCaffeine,
          stomachSensitive: nutStomach,
          currentMealPattern: nutMealPattern || null,
          nutritionGoal: nutGoal || null,
          minHoursAfterMainMealBeforeWorkout: nutMealGap ? Number(nutMealGap) : null,
          preWorkoutSnackTolerance: nutSnackTolerance || null,
          preferredFoods: nutPreferredFoods || null,
          supplements: nutSupplements || null,
          cookingTimePreference: nutCookingPref || null,
          bodyWeightKg: nutBodyWeight ? Number(nutBodyWeight) : null,
          estimatedRestDayCalories: nutRestCalories ? Number(nutRestCalories) : null,
          calorieGoal: nutCalorieGoal || null,
        }),
      }).then((r) => r.json()),
    onSuccess: () => {
      setNutritionSaved(true);
      setTimeout(() => setNutritionSaved(false), 2000);
    },
  });

  const saveConstraints = useMutation({
    mutationFn: () =>
      fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxContinuousTrainingMinutes: Number(maxMin) || 240,
          weeklyTrainingHoursTarget: hoursTarget ? Number(hoursTarget) : undefined,
          allowedModalities: modalities,
          avoidFridayEvening: avoidFriday,
          preferredEasyRideDurationMin: easyRideDuration ? Number(easyRideDuration) : undefined,
          preferredLongRideDurationMin: longRideDuration ? Number(longRideDuration) : undefined,
          preferredLongRunDurationMin: longRunDuration ? Number(longRunDuration) : undefined,
          minMeaningfulCyclingDurationMin: minCyclingDuration ? Number(minCyclingDuration) : undefined,
          maxHyroxPerWeek: maxHyrox ? Number(maxHyrox) : undefined,
          preferredHyroxDays: hyroxDays.length > 0 ? hyroxDays : undefined,
          preferredEasyRunKm: easyRunKm ? Number(easyRunKm) : undefined,
          preferredTempoRunKm: tempoRunKm ? Number(tempoRunKm) : undefined,
          preferredLongRunKm: longRunKm ? Number(longRunKm) : undefined,
        }),
      }).then((r) => r.json()),
    onSuccess: () => {
      setConstraintsSaved(true);
      setTimeout(() => setConstraintsSaved(false), 2000);
    },
  });

  function toggleModality(m: string) {
    setModalities((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
    );
  }

  function toggleHyroxDay(d: string) {
    setHyroxDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  }

  // ── Availability Windows ──────────────────────────────────────────────────
  const { data: windows = [] } = useQuery<AvailWindow[]>({
    queryKey: ["availability"],
    queryFn: () => fetch("/api/availability").then((r) => r.json()),
  });
  const [newDay, setNewDay] = useState<string>("mon");
  const [newStart, setNewStart] = useState("06:00");
  const [newEnd, setNewEnd] = useState("08:00");

  const addWindow = useMutation({
    mutationFn: () =>
      fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dayOfWeek: newDay, timeStartMin: timeToMins(newStart), timeEndMin: timeToMins(newEnd) }),
      }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["availability"] }),
  });

  const delWindow = useMutation({
    mutationFn: (id: string) => fetch(`/api/availability/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["availability"] }),
  });

  // ── Schedule Events ───────────────────────────────────────────────────────
  const { data: events = [] } = useQuery<ScheduleEv[]>({
    queryKey: ["schedule-events"],
    queryFn: () => fetch("/api/schedule-events").then((r) => r.json()),
  });
  const [evStart, setEvStart] = useState("");
  const [evEnd, setEvEnd] = useState("");
  const [evKind, setEvKind] = useState<string>("blocked");
  const [evNote, setEvNote] = useState("");

  const addEvent = useMutation({
    mutationFn: () =>
      fetch("/api/schedule-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startsAt: evStart, endsAt: evEnd, kind: evKind, note: evNote || undefined }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedule-events"] });
      setEvStart(""); setEvEnd(""); setEvNote("");
    },
  });

  const delEvent = useMutation({
    mutationFn: (id: string) => fetch(`/api/schedule-events/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedule-events"] }),
  });

  // ── Recurring Sessions ────────────────────────────────────────────────────
  const { data: recSessions = [] } = useQuery<RecSession[]>({
    queryKey: ["recurring-sessions"],
    queryFn: () => fetch("/api/recurring-sessions").then((r) => r.json()),
  });
  const [rsDay, setRsDay] = useState<string>("tue");
  const [rsSlot, setRsSlot] = useState<string>("evening");
  const [rsDuration, setRsDuration] = useState("75");
  const [rsIntensity, setRsIntensity] = useState<string>("hard");
  const [rsNotes, setRsNotes] = useState("HYROX group class");
  const [rsPlanningType, setRsPlanningType] = useState<string>("fixed");

  const addRecSession = useMutation({
    mutationFn: () =>
      fetch("/api/recurring-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayOfWeek: rsDay,
          preferredSlot: rsSlot,
          durationMin: Number(rsDuration),
          intensity: rsIntensity,
          notes: rsNotes || undefined,
          planningType: rsPlanningType,
        }),
      }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring-sessions"] }),
  });

  const delRecSession = useMutation({
    mutationFn: (id: string) => fetch(`/api/recurring-sessions/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring-sessions"] }),
  });

  // ── Shared sub-sections ───────────────────────────────────────────────────

  const TrainingProfileSection = (
    <div className={cardCls}>
      <div className="space-y-0.5">
        <p className={sectionHeadingCls}>Training profile</p>
        <p className="text-xs text-zinc-400">HR zones for personalised workout plans.</p>
      </div>

      {/* HR ladder visual */}
      <div className="rounded-xl bg-gradient-to-r from-zinc-50 via-emerald-50/60 via-amber-50/40 to-red-50/60 border border-zinc-100 px-3 py-2">
        <div className="flex items-center text-[9px] font-semibold uppercase tracking-wide">
          <span className="flex-1 text-zinc-400">Rest</span>
          <span className="flex-1 text-emerald-600">Easy</span>
          <span className="flex-1 text-amber-600">Tempo</span>
          <span className="flex-1 text-red-600">Threshold</span>
          <span className="flex-1 text-right text-red-800">Max</span>
        </div>
      </div>

      {/* Resting / Max */}
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className={labelCls}>Resting HR</span>
          <input type="number" value={restingHr} onChange={(e) => setRestingHr(e.target.value)} placeholder="e.g. 52" className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className={labelCls}>Max HR</span>
          <input type="number" value={maxHr} onChange={(e) => setMaxHr(e.target.value)} placeholder="e.g. 185" className={inputCls} />
        </label>
      </div>

      {/* Easy zone */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide">Easy zone</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className={labelCls}>Min BPM</span>
            <input type="number" value={easyHrMin} onChange={(e) => setEasyHrMin(e.target.value)} placeholder="e.g. 130" className={inputCls} />
          </label>
          <label className="space-y-1">
            <span className={labelCls}>Max BPM</span>
            <input type="number" value={easyHrMax} onChange={(e) => setEasyHrMax(e.target.value)} placeholder="e.g. 150" className={inputCls} />
          </label>
        </div>
      </div>

      {/* Tempo zone */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide">Tempo zone</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className={labelCls}>Min BPM</span>
            <input type="number" value={tempoHrMin} onChange={(e) => setTempoHrMin(e.target.value)} placeholder="e.g. 151" className={inputCls} />
          </label>
          <label className="space-y-1">
            <span className={labelCls}>Max BPM</span>
            <input type="number" value={tempoHrMax} onChange={(e) => setTempoHrMax(e.target.value)} placeholder="e.g. 165" className={inputCls} />
          </label>
        </div>
      </div>

      {/* Threshold + zone method */}
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className={labelCls + " text-red-600"}>Threshold HR</span>
          <input type="number" value={thresholdHr} onChange={(e) => setThresholdHr(e.target.value)} placeholder="e.g. 166" className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className={labelCls}>Zone method</span>
          <select value={zoneMethod} onChange={(e) => setZoneMethod(e.target.value)} className={selectCls}>
            <option value="estimated">Estimated</option>
            <option value="manual">Manual</option>
          </select>
        </label>
      </div>

      <button
        onClick={() => saveTrainingProfile.mutate()}
        disabled={saveTrainingProfile.isPending}
        className={trainingProfileSaved ? savedBtnCls : saveBtnCls}
      >
        {trainingProfileSaved ? "Saved ✓" : saveTrainingProfile.isPending ? "Saving…" : "Save training profile"}
      </button>
    </div>
  );

  const TrainingConstraintsSection = (
    <div className={cardCls}>
      <p className={sectionHeadingCls}>Training constraints</p>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className={labelCls}>Max continuous (min)</span>
          <input type="number" value={maxMin} onChange={(e) => setMaxMin(e.target.value)} className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className={labelCls}>Weekly hours target</span>
          <input type="number" value={hoursTarget} onChange={(e) => setHoursTarget(e.target.value)} placeholder="e.g. 8" className={inputCls} />
        </label>
      </div>

      {/* Modalities */}
      <div>
        <p className={labelCls + " mb-2"}>Allowed modalities</p>
        <div className="flex flex-wrap gap-2">
          {MODALITIES.map((m) => (
            <label
              key={m}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium cursor-pointer transition-colors ${
                modalities.includes(m)
                  ? "bg-zinc-900 text-white border-zinc-900"
                  : "border-zinc-200 text-zinc-600 hover:border-zinc-400"
              }`}
            >
              <input type="checkbox" checked={modalities.includes(m)} onChange={() => toggleModality(m)} className="sr-only" />
              <span className={m === "hyrox" ? "" : "capitalize"}>{m === "hyrox" ? "HYROX" : m}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Running */}
      <div className="space-y-2 pt-1 border-t border-zinc-100">
        <p className="text-xs font-semibold text-zinc-500">Running</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Easy (km)", value: easyRunKm, set: setEasyRunKm, placeholder: "e.g. 10" },
            { label: "Tempo (km)", value: tempoRunKm, set: setTempoRunKm, placeholder: "e.g. 10" },
            { label: "Long run (km)", value: longRunKm, set: setLongRunKm, placeholder: "e.g. 21" },
            { label: "Long run (min)", value: longRunDuration, set: setLongRunDuration, placeholder: "e.g. 110" },
          ].map(({ label, value, set, placeholder }) => (
            <label key={label} className="space-y-1">
              <span className={labelCls}>{label}</span>
              <input type="number" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} className={inputCls} />
            </label>
          ))}
        </div>
      </div>

      {/* Cycling */}
      <div className="space-y-2 pt-1 border-t border-zinc-100">
        <p className="text-xs font-semibold text-zinc-500">Cycling</p>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Easy (min)", value: easyRideDuration, set: setEasyRideDuration, placeholder: "e.g. 60" },
            { label: "Long (min)", value: longRideDuration, set: setLongRideDuration, placeholder: "e.g. 120" },
            { label: "Min (min)", value: minCyclingDuration, set: setMinCyclingDuration, placeholder: "e.g. 60" },
          ].map(({ label, value, set, placeholder }) => (
            <label key={label} className="space-y-1">
              <span className={labelCls}>{label}</span>
              <input type="number" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} className={inputCls} />
            </label>
          ))}
        </div>
      </div>

      {/* HYROX — compact: max + days in same row */}
      <div className="space-y-2 pt-1 border-t border-zinc-100">
        <p className="text-xs font-semibold text-zinc-500">HYROX</p>
        <div className="flex items-start gap-4 flex-wrap">
          <label className="space-y-1 w-24 shrink-0">
            <span className={labelCls}>Max / week</span>
            <input type="number" value={maxHyrox} onChange={(e) => setMaxHyrox(e.target.value)} placeholder="e.g. 2" className={inputCls} />
          </label>
          <div className="flex-1 min-w-0">
            <p className={labelCls + " mb-2"}>Preferred days</p>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d) => (
                <label
                  key={d}
                  className={`flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium cursor-pointer transition-colors ${
                    hyroxDays.includes(d)
                      ? "bg-zinc-900 text-white border-zinc-900"
                      : "border-zinc-200 text-zinc-600 hover:border-zinc-400"
                  }`}
                >
                  <input type="checkbox" checked={hyroxDays.includes(d)} onChange={() => toggleHyroxDay(d)} className="sr-only" />
                  {DAY_LABELS[d]}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={() => saveConstraints.mutate()}
        disabled={saveConstraints.isPending}
        className={constraintsSaved ? savedBtnCls : saveBtnCls}
      >
        {constraintsSaved ? "Saved ✓" : saveConstraints.isPending ? "Saving…" : "Save constraints"}
      </button>
    </div>
  );

  // ── Nutrition Profile card ────────────────────────────────────────────────
  const NutritionSection = (
    <div className={cardCls}>
      <div className="space-y-0.5">
        <p className={sectionHeadingCls}>Nutrition profile</p>
        <p className="text-xs text-zinc-400">Personalises daily and weekly fueling guidance.</p>
      </div>

      {/* Routine */}
      <div className="space-y-2.5 pt-1 border-t border-zinc-100">
        <p className="text-xs font-semibold text-zinc-500">Routine</p>
        <label className="space-y-1 block">
          <span className={labelCls}>Current meal pattern</span>
          <input type="text" value={nutMealPattern} onChange={(e) => setNutMealPattern(e.target.value)} placeholder="e.g. 3 meals, skip breakfast, IF 16:8…" className={inputCls} />
        </label>
        <label className="space-y-1 block">
          <span className={labelCls}>Nutrition goal</span>
          <input type="text" value={nutGoal} onChange={(e) => setNutGoal(e.target.value)} placeholder="e.g. better energy, avoid under-fueling…" className={inputCls} />
        </label>
      </div>

      {/* Pre-workout tolerance */}
      <div className="space-y-2.5 pt-1 border-t border-zinc-100">
        <p className="text-xs font-semibold text-zinc-500">Pre-workout tolerance</p>
        <label className="space-y-1 block w-32">
          <span className={labelCls}>Min gap after main meal (h)</span>
          <input type="number" min={1} max={6} value={nutMealGap} onChange={(e) => setNutMealGap(e.target.value)} placeholder="e.g. 2" className={inputCls} />
        </label>
        <label className="space-y-1 block">
          <span className={labelCls}>Pre-workout snack tolerance</span>
          <input type="text" value={nutSnackTolerance} onChange={(e) => setNutSnackTolerance(e.target.value)} placeholder="e.g. handles solid food fine, liquid only…" className={inputCls} />
        </label>
        <div className="space-y-2">
          <label className="flex items-center gap-2.5 text-sm text-zinc-700 cursor-pointer">
            <input type="checkbox" checked={nutStomach} onChange={(e) => setNutStomach(e.target.checked)} className="rounded border-zinc-300" />
            Stomach sensitive
            <span className="text-xs text-zinc-400">— very light pre-workout</span>
          </label>
          <label className="flex items-center gap-2.5 text-sm text-zinc-700 cursor-pointer">
            <input type="checkbox" checked={nutCaffeine} onChange={(e) => setNutCaffeine(e.target.checked)} className="rounded border-zinc-300" />
            Caffeine sensitive
          </label>
        </div>
      </div>

      {/* Foods */}
      <div className="space-y-2.5 pt-1 border-t border-zinc-100">
        <p className="text-xs font-semibold text-zinc-500">Foods that work</p>
        {[
          { label: "Preferred foods / staples", value: nutPreferredFoods, set: setNutPreferredFoods, placeholder: "e.g. oats, eggs, rice, sweet potato…" },
          { label: "Foods to avoid", value: nutAvoidFoods, set: setNutAvoidFoods, placeholder: "e.g. dairy, gluten, nuts…" },
          { label: "Preferred pre-workout snack", value: nutPreSnack, set: setNutPreSnack, placeholder: "e.g. banana + peanut butter" },
          { label: "Preferred breakfast", value: nutBreakfast, set: setNutBreakfast, placeholder: "e.g. oats with fruit" },
          { label: "Preferred post-workout meal", value: nutPostMeal, set: setNutPostMeal, placeholder: "e.g. rice + chicken + veggies" },
        ].map(({ label, value, set, placeholder }) => (
          <label key={label} className="space-y-1 block">
            <span className={labelCls}>{label}</span>
            <input type="text" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} className={inputCls} />
          </label>
        ))}
      </div>

      {/* Energy estimate */}
      <div className="space-y-2.5 pt-1 border-t border-zinc-100">
        <div>
          <p className="text-xs font-semibold text-zinc-500">Energy estimate</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">Rough daily guidance only — not calorie tracking.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className={labelCls}>Body weight (kg)</span>
            <input type="number" min={30} max={200} step={0.5} value={nutBodyWeight} onChange={(e) => setNutBodyWeight(e.target.value)} placeholder="e.g. 78" className={inputCls} />
          </label>
          <label className="space-y-1">
            <span className={labelCls}>Rest-day calories</span>
            <input type="number" min={1000} max={5000} step={50} value={nutRestCalories} onChange={(e) => setNutRestCalories(e.target.value)} placeholder="e.g. 2300" className={inputCls} />
          </label>
        </div>
        <label className="space-y-1 block">
          <span className={labelCls}>Calorie goal</span>
          <select value={nutCalorieGoal} onChange={(e) => setNutCalorieGoal(e.target.value)} className={selectCls}>
            <option value="maintain">Maintain</option>
            <option value="slight_surplus">Slight surplus</option>
            <option value="slight_deficit">Slight deficit</option>
          </select>
        </label>
      </div>

      {/* Optional details */}
      <div className="space-y-2.5 pt-1 border-t border-zinc-100">
        <p className="text-xs font-semibold text-zinc-500">Optional details</p>
        <label className="space-y-1 block">
          <span className={labelCls}>Supplements</span>
          <input type="text" value={nutSupplements} onChange={(e) => setNutSupplements(e.target.value)} placeholder="e.g. creatine, magnesium, vitamin D…" className={inputCls} />
        </label>
        <label className="space-y-1 block">
          <span className={labelCls}>Cooking style / time preference</span>
          <input type="text" value={nutCookingPref} onChange={(e) => setNutCookingPref(e.target.value)} placeholder="e.g. quick meals under 20 min…" className={inputCls} />
        </label>
        <label className="space-y-1 block">
          <span className={labelCls}>Diet notes</span>
          <textarea value={nutDietNotes} onChange={(e) => setNutDietNotes(e.target.value)} placeholder="e.g. plant-based, low-carb, intermittent fasting…" rows={2} className={inputCls + " resize-none"} />
        </label>
      </div>

      <button
        onClick={() => saveNutritionProfile.mutate()}
        disabled={saveNutritionProfile.isPending}
        className={nutritionSaved ? savedBtnCls : saveBtnCls}
      >
        {nutritionSaved ? "Saved ✓" : saveNutritionProfile.isPending ? "Saving…" : "Save nutrition profile"}
      </button>
    </div>
  );

  // ── Advanced scheduling (collapsed) ──────────────────────────────────────
  const AdvancedSchedulingSection = (
    <CollapsibleSection label="Advanced scheduling">
      <p className="text-xs text-zinc-400">Availability windows, schedule blocks, and recurring sessions. These are optional — the planner uses sensible defaults if not set.</p>

      {/* Avoid Friday Evening */}
      <label className="flex items-center gap-2.5 text-sm text-zinc-700 cursor-pointer">
        <input type="checkbox" checked={avoidFriday} onChange={(e) => setAvoidFriday(e.target.checked)} className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-300" />
        Avoid Friday evening training
      </label>

      {/* Availability Windows */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-zinc-500">Availability windows</p>
        <p className="text-[10px] text-zinc-400">Recurring time slots when training is possible.</p>
        <div className="space-y-1.5">
          {windows.length === 0 && <p className="text-xs text-zinc-400">No windows set.</p>}
          {windows.map((w) => (
            <div key={w.id} className="flex items-center justify-between rounded-xl bg-zinc-50 border border-zinc-100 px-3 py-2">
              <span className="text-sm font-medium text-zinc-700">{DAY_LABELS[w.dayOfWeek] ?? w.dayOfWeek}</span>
              <span className="text-xs text-zinc-500">{minsToTime(w.timeStartMin)}–{minsToTime(w.timeEndMin)}</span>
              <button onClick={() => delWindow.mutate(w.id)} className="text-xs text-zinc-400 hover:text-red-500 transition-colors">Remove</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <select value={newDay} onChange={(e) => setNewDay(e.target.value)} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-300">
            {DAYS.map((d) => <option key={d} value={d}>{DAY_LABELS[d]}</option>)}
          </select>
          <input type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-300" />
          <input type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-300" />
          <button onClick={() => addWindow.mutate()} disabled={addWindow.isPending} className={saveBtnCls}>Add</button>
        </div>
      </div>

      {/* Schedule Blocks */}
      <div className="space-y-2 pt-2 border-t border-zinc-100">
        <p className="text-xs font-semibold text-zinc-500">Schedule blocks</p>
        <p className="text-[10px] text-zinc-400">One-off periods when training is blocked.</p>
        <div className="space-y-1.5">
          {events.length === 0 && <p className="text-xs text-zinc-400">No blocks set.</p>}
          {events.map((ev) => (
            <div key={ev.id} className="flex items-start justify-between rounded-xl bg-zinc-50 border border-zinc-100 px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-zinc-600">{ev.startsAt.slice(0, 10)}</span>
                  <span className="text-zinc-300">→</span>
                  <span className="text-xs font-mono text-zinc-600">{ev.endsAt.slice(0, 10)}</span>
                  <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-medium text-zinc-600">{ev.kind}</span>
                </div>
                {ev.note && <p className="text-xs text-zinc-500 mt-0.5">{ev.note}</p>}
              </div>
              <button onClick={() => delEvent.mutate(ev.id)} className="text-xs text-zinc-400 hover:text-red-500 transition-colors ml-2 shrink-0">Remove</button>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <div className="flex gap-2 flex-wrap items-end">
            <div className="space-y-1">
              <span className={labelCls}>Start</span>
              <input type="datetime-local" value={evStart} onChange={(e) => setEvStart(e.target.value)} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-300" />
            </div>
            <div className="space-y-1">
              <span className={labelCls}>End</span>
              <input type="datetime-local" value={evEnd} onChange={(e) => setEvEnd(e.target.value)} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-300" />
            </div>
            <div className="space-y-1">
              <span className={labelCls}>Kind</span>
              <select value={evKind} onChange={(e) => setEvKind(e.target.value)} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-300">
                {EVENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
          </div>
          <input type="text" value={evNote} onChange={(e) => setEvNote(e.target.value)} placeholder="Note (optional)" className={inputCls} />
          <button onClick={() => addEvent.mutate()} disabled={addEvent.isPending || !evStart || !evEnd} className={saveBtnCls}>
            {addEvent.isPending ? "Adding…" : "Add block"}
          </button>
        </div>
      </div>

      {/* Recurring Sessions */}
      <div className="space-y-2 pt-2 border-t border-zinc-100">
        <p className="text-xs font-semibold text-zinc-500">Recurring sessions</p>
        <p className="text-[10px] text-zinc-400">Weekly fixed sessions (e.g. HYROX class). Fixed sessions are always in the plan.</p>
        <div className="space-y-1.5">
          {recSessions.length === 0 && <p className="text-xs text-zinc-400">None set.</p>}
          {recSessions.map((rs) => (
            <div key={rs.id} className="flex items-start justify-between rounded-xl bg-zinc-50 border border-zinc-100 px-3 py-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 flex-wrap text-xs">
                  <span className="font-semibold text-zinc-700">{DAY_LABELS[rs.dayOfWeek] ?? rs.dayOfWeek}</span>
                  <span className="text-zinc-400">·</span>
                  <span className="capitalize text-zinc-600">{rs.preferredSlot}</span>
                  <span className="text-zinc-400">·</span>
                  <span className="text-zinc-600">{rs.durationMin} min</span>
                  <span className="text-zinc-400">·</span>
                  <span className="capitalize text-zinc-600">{rs.intensity}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${rs.planningType === "fixed" ? "bg-zinc-100 text-zinc-600" : "bg-indigo-50 text-indigo-600"}`}>
                    {rs.planningType === "fixed" ? "fixed" : "optional"}
                  </span>
                </div>
                {rs.notes && <p className="text-xs text-zinc-500">{rs.notes}</p>}
              </div>
              <button onClick={() => delRecSession.mutate(rs.id)} className="text-xs text-zinc-400 hover:text-red-500 transition-colors ml-2 shrink-0">Remove</button>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <div className="flex gap-2 items-end flex-wrap">
            <select value={rsDay} onChange={(e) => setRsDay(e.target.value)} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-300">
              {DAYS.map((d) => <option key={d} value={d}>{DAY_LABELS[d]}</option>)}
            </select>
            <select value={rsSlot} onChange={(e) => setRsSlot(e.target.value)} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-300">
              {SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input type="number" value={rsDuration} onChange={(e) => setRsDuration(e.target.value)} placeholder="min" className="w-20 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-300" />
            <select value={rsIntensity} onChange={(e) => setRsIntensity(e.target.value)} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-300">
              {INTENSITIES.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
            <select value={rsPlanningType} onChange={(e) => setRsPlanningType(e.target.value)} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-300">
              <option value="fixed">fixed</option>
              <option value="preferred">optional</option>
            </select>
          </div>
          <input type="text" value={rsNotes} onChange={(e) => setRsNotes(e.target.value)} placeholder='Notes, e.g. "HYROX group class"' className={inputCls} />
          <p className="text-[10px] text-zinc-400">
            <strong>fixed</strong> = always in plan · <strong>optional</strong> = planner chooses if useful
          </p>
          <button onClick={() => addRecSession.mutate()} disabled={addRecSession.isPending} className={saveBtnCls}>
            {addRecSession.isPending ? "Adding…" : "Add session"}
          </button>
        </div>
      </div>
    </CollapsibleSection>
  );

  // ── Advanced HYROX workout defaults (collapsed) ───────────────────────────
  const AdvancedHyroxSection = (
    <CollapsibleSection label="Advanced HYROX workout defaults">
      <p className="text-[10px] text-zinc-400">Default format for station-circuit workout plans. Typical: 3 rounds × 8 stations, 60s work / 20s transition.</p>

      <label className="space-y-1 block">
        <span className={labelCls}>Default format</span>
        <select value={hybridFormat} onChange={(e) => setHybridFormat(e.target.value)} className={selectCls}>
          {HYBRID_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </label>

      <label className="flex items-center gap-2.5 text-sm text-zinc-700 cursor-pointer">
        <input type="checkbox" checked={hybridInclRun} onChange={(e) => setHybridInclRun(e.target.checked)} className="rounded border-zinc-300" />
        Include running between stations by default
      </label>

      <div className="grid grid-cols-3 gap-3">
        <label className="space-y-1">
          <span className={labelCls}>Work (sec)</span>
          <input type="number" value={hybridWorkSec} onChange={(e) => setHybridWorkSec(e.target.value)} className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className={labelCls}>Rest (sec)</span>
          <input type="number" value={hybridRestSec} onChange={(e) => setHybridRestSec(e.target.value)} className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className={labelCls}>Rounds</span>
          <input type="number" value={hybridRounds} onChange={(e) => setHybridRounds(e.target.value)} className={inputCls} />
        </label>
      </div>

      <label className="space-y-1 block">
        <span className={labelCls}>Notes</span>
        <input type="text" value={hybridNotes} onChange={(e) => setHybridNotes(e.target.value)} placeholder="e.g. preferred equipment, race goal distance…" className={inputCls} />
      </label>

      <button
        onClick={() => saveHybridProfile.mutate()}
        disabled={saveHybridProfile.isPending}
        className={hybridProfileSaved ? savedBtnCls : saveBtnCls}
      >
        {hybridProfileSaved ? "Saved ✓" : saveHybridProfile.isPending ? "Saving…" : "Save HYROX defaults"}
      </button>
    </CollapsibleSection>
  );

  // ── Strava + Account (compact) ────────────────────────────────────────────
  const StravaSection = (
    <div className={cardCls}>
      <p className={sectionHeadingCls}>Strava connection</p>
      <Suspense fallback={null}>
        <StravaSettings initialConnection={initialStravaConnection} />
      </Suspense>
    </div>
  );

  const AccountSection = (
    <div className="rounded-2xl bg-white border border-zinc-100 shadow-card px-4 py-3 space-y-3">
      <p className={sectionHeadingCls}>Account</p>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-500">Name</span>
          <span className="font-medium text-zinc-800">{userName}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-500">Timezone</span>
          <span className="font-medium text-zinc-800 text-xs">{userTimezone}</span>
        </div>
      </div>
      <form action="/api/auth/logout" method="post">
        <button type="submit" className="w-full rounded-xl border border-zinc-200 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors">
          Log out
        </button>
      </form>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <main className="relative min-h-screen px-4 lg:px-6 xl:px-8 pt-0 pb-24 lg:pb-8">
      {/* ── Hero header ──────────────────────────────────────────────── */}
      <div className="pt-4 pb-3">
        <div className="lg:rounded-2xl lg:bg-white/60 lg:backdrop-blur-sm lg:border lg:border-zinc-100/80 lg:shadow-sm lg:px-5 lg:py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-0.5">Maxona</p>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 leading-none">Settings</h1>
          <p className="text-sm text-zinc-500 mt-1">Tune Maxona around your body, schedule, and constraints.</p>
        </div>
      </div>

      <PageWrapper>
        {/* Helper copy */}
        <p className="text-xs text-zinc-400 mb-4">Start with <strong className="text-zinc-600">Training Profile</strong> + <strong className="text-zinc-600">Nutrition</strong>. Advanced scheduling is optional.</p>

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6 lg:items-start">
          {/* ── Main column: Nutrition Profile + Advanced scheduling ────── */}
          <StaggerList className="space-y-4">
            {/* Mobile: Training + Constraints first */}
            <div className="lg:hidden space-y-4">
              <StaggerItem>{TrainingProfileSection}</StaggerItem>
              <StaggerItem>{TrainingConstraintsSection}</StaggerItem>
            </div>

            <StaggerItem>{NutritionSection}</StaggerItem>
            <StaggerItem>{AdvancedSchedulingSection}</StaggerItem>

            {/* Mobile: Advanced HYROX + Strava + Account at bottom */}
            <div className="lg:hidden space-y-4">
              <StaggerItem>{AdvancedHyroxSection}</StaggerItem>
              <StaggerItem>{StravaSection}</StaggerItem>
              <StaggerItem>{AccountSection}</StaggerItem>
            </div>
          </StaggerList>

          {/* ── Side rail: Training Profile + Constraints + Strava + Account */}
          <aside className="hidden lg:flex lg:flex-col lg:gap-4 mt-0">
            {TrainingProfileSection}
            {TrainingConstraintsSection}
            {AdvancedHyroxSection}
            {StravaSection}
            {AccountSection}
          </aside>
        </div>
      </PageWrapper>
    </main>
  );
}
