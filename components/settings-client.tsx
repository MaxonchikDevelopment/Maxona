"use client";
import { useState, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { StravaSettings } from "@/components/strava-settings";
import type { StravaConnectionProp } from "@/components/strava-settings";

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

  // --- Training Constraints ---
  const [maxMin, setMaxMin] = useState(String(initialConstraints.maxContinuousTrainingMinutes ?? 240));
  const [hoursTarget, setHoursTarget] = useState(String(initialConstraints.weeklyTrainingHoursTarget ?? ""));
  const [modalities, setModalities] = useState<string[]>(
    initialConstraints.allowedModalities ?? [...MODALITIES]
  );

  // --- Athlete Preferences ---
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

  // --- Training Profile ---
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

  // --- Hybrid Race Profile ---
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

  // --- Nutrition Profile ---
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

  // --- Availability Windows ---
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

  // --- Schedule Events ---
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

  // --- Recurring Sessions ---
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

  return (
    <main className="p-4 space-y-8">
      <h1 className="text-xl font-bold">Settings</h1>

      {/* Profile */}
      <section className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-gray-400">Name</p>
        <p>{userName}</p>
        <p className="text-xs uppercase tracking-wide text-gray-400 mt-2">Timezone</p>
        <p>{userTimezone}</p>
      </section>

      {/* Training Constraints */}
      <section className="space-y-3">
        <h2 className="font-semibold">Training Constraints</h2>
        <div className="space-y-2">
          <label className="block text-sm">
            Max continuous training (min)
            <input
              type="number"
              value={maxMin}
              onChange={(e) => setMaxMin(e.target.value)}
              className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm">
            Weekly hours target
            <input
              type="number"
              value={hoursTarget}
              onChange={(e) => setHoursTarget(e.target.value)}
              placeholder="e.g. 8"
              className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
            />
          </label>
          <div className="text-sm">
            <p className="mb-1">Allowed modalities</p>
            <div className="flex flex-wrap gap-2">
              {MODALITIES.map((m) => (
                <label key={m} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={modalities.includes(m)}
                    onChange={() => toggleModality(m)}
                  />
                  {m}
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Athlete Preferences */}
      <section className="space-y-5">
        <h2 className="font-semibold">Preferences</h2>

        {/* Running */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">Running</p>
          <p className="text-xs text-gray-400">Standard distances: 5, 10, 15, 21 km</p>
          <label className="block text-sm">
            Easy / recovery run (km)
            <input
              type="number"
              value={easyRunKm}
              onChange={(e) => setEasyRunKm(e.target.value)}
              placeholder="e.g. 10"
              className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm">
            Tempo / interval run (km)
            <input
              type="number"
              value={tempoRunKm}
              onChange={(e) => setTempoRunKm(e.target.value)}
              placeholder="e.g. 10"
              className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm">
            Long run distance (km)
            <input
              type="number"
              value={longRunKm}
              onChange={(e) => setLongRunKm(e.target.value)}
              placeholder="e.g. 21"
              className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm">
            Long run target time (min)
            <input
              type="number"
              value={longRunDuration}
              onChange={(e) => setLongRunDuration(e.target.value)}
              placeholder="e.g. 110"
              className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
            />
          </label>
        </div>

        {/* Cycling */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">Cycling</p>
          <label className="block text-sm">
            Easy / recovery ride (min)
            <input
              type="number"
              value={easyRideDuration}
              onChange={(e) => setEasyRideDuration(e.target.value)}
              placeholder="e.g. 60"
              className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm">
            Long ride (min)
            <input
              type="number"
              value={longRideDuration}
              onChange={(e) => setLongRideDuration(e.target.value)}
              placeholder="e.g. 120"
              className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm">
            Minimum ride length (min)
            <input
              type="number"
              value={minCyclingDuration}
              onChange={(e) => setMinCyclingDuration(e.target.value)}
              placeholder="e.g. 60"
              className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
            />
          </label>
        </div>

        {/* HYROX */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">HYROX</p>
          <label className="block text-sm">
            Max sessions per week
            <input
              type="number"
              value={maxHyrox}
              onChange={(e) => setMaxHyrox(e.target.value)}
              placeholder="e.g. 2"
              className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
            />
          </label>
          <div className="text-sm">
            <p className="mb-1">Preferred days</p>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d) => (
                <label key={d} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={hyroxDays.includes(d)}
                    onChange={() => toggleHyroxDay(d)}
                  />
                  {DAY_LABELS[d]}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Other */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={avoidFriday}
            onChange={(e) => setAvoidFriday(e.target.checked)}
          />
          Avoid Friday evening training
        </label>

        <button
          onClick={() => saveConstraints.mutate()}
          disabled={saveConstraints.isPending}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {constraintsSaved ? "Saved" : saveConstraints.isPending ? "Saving..." : "Save preferences"}
        </button>
      </section>

      {/* Availability Windows */}
      <section className="space-y-3">
        <h2 className="font-semibold">Availability Windows</h2>
        <div className="space-y-1">
          {windows.map((w) => (
            <div key={w.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span className="font-mono">{DAY_LABELS[w.dayOfWeek] ?? w.dayOfWeek}</span>
              <span className="text-gray-500">{minsToTime(w.timeStartMin)}–{minsToTime(w.timeEndMin)}</span>
              <button
                onClick={() => delWindow.mutate(w.id)}
                className="text-red-400 text-xs"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <select value={newDay} onChange={(e) => setNewDay(e.target.value)}
            className="rounded border px-2 py-1.5 text-sm">
            {DAYS.map((d) => <option key={d} value={d}>{DAY_LABELS[d]}</option>)}
          </select>
          <input type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)}
            className="rounded border px-2 py-1.5 text-sm" />
          <input type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)}
            className="rounded border px-2 py-1.5 text-sm" />
          <button
            onClick={() => addWindow.mutate()}
            disabled={addWindow.isPending}
            className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </section>

      {/* Schedule Events (Blocks) */}
      <section className="space-y-3">
        <h2 className="font-semibold">Schedule Blocks</h2>
        <div className="space-y-1">
          {events.length === 0 && <p className="text-sm text-gray-400">No blocks set.</p>}
          {events.map((ev) => (
            <div key={ev.id} className="flex items-start justify-between rounded border px-3 py-2 text-sm">
              <div>
                <span className="font-mono text-xs">{ev.startsAt.slice(0, 10)}</span>
                <span className="mx-1 text-gray-400">→</span>
                <span className="font-mono text-xs">{ev.endsAt.slice(0, 10)}</span>
                <span className="ml-2 rounded bg-gray-100 px-1 text-xs">{ev.kind}</span>
                {ev.note && <p className="text-gray-500 text-xs mt-0.5">{ev.note}</p>}
              </div>
              <button onClick={() => delEvent.mutate(ev.id)} className="text-red-400 text-xs ml-2">
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <div className="flex gap-2 flex-wrap">
            <div className="flex flex-col text-xs gap-0.5">
              <span>Start</span>
              <input type="datetime-local" value={evStart} onChange={(e) => setEvStart(e.target.value)}
                className="rounded border px-2 py-1.5 text-sm" />
            </div>
            <div className="flex flex-col text-xs gap-0.5">
              <span>End</span>
              <input type="datetime-local" value={evEnd} onChange={(e) => setEvEnd(e.target.value)}
                className="rounded border px-2 py-1.5 text-sm" />
            </div>
            <div className="flex flex-col text-xs gap-0.5">
              <span>Kind</span>
              <select value={evKind} onChange={(e) => setEvKind(e.target.value)}
                className="rounded border px-2 py-1.5 text-sm">
                {EVENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
          </div>
          <input
            type="text"
            value={evNote}
            onChange={(e) => setEvNote(e.target.value)}
            placeholder="Note (optional)"
            className="w-full rounded border px-3 py-1.5 text-sm"
          />
          <button
            onClick={() => addEvent.mutate()}
            disabled={addEvent.isPending || !evStart || !evEnd}
            className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {addEvent.isPending ? "Adding..." : "Add block"}
          </button>
        </div>
      </section>

      {/* Recurring Sessions */}
      <section className="space-y-3">
        <h2 className="font-semibold">Recurring Sessions</h2>
        <div className="space-y-1">
          {recSessions.length === 0 && <p className="text-sm text-gray-400">None set.</p>}
          {recSessions.map((rs) => (
            <div key={rs.id} className="flex items-start justify-between rounded border px-3 py-2 text-sm">
              <div>
                <span className="font-mono">{DAY_LABELS[rs.dayOfWeek] ?? rs.dayOfWeek}</span>
                <span className="mx-1 text-gray-400">·</span>
                <span>{rs.preferredSlot}</span>
                <span className="mx-1 text-gray-400">·</span>
                <span>{rs.durationMin} min</span>
                <span className="mx-1 text-gray-400">·</span>
                <span className="text-gray-500">{rs.intensity}</span>
                <span className="ml-2 rounded px-1 text-xs font-medium" style={{
                  background: rs.planningType === "fixed" ? "#f3f4f6" : "#eff6ff",
                  color: rs.planningType === "fixed" ? "#374151" : "#2563eb",
                }}>
                  {rs.planningType === "fixed" ? "fixed" : "optional"}
                </span>
                {rs.notes && <p className="text-xs text-gray-500 mt-0.5">{rs.notes}</p>}
              </div>
              <button onClick={() => delRecSession.mutate(rs.id)} className="text-red-400 text-xs ml-2">
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <div className="flex gap-2 items-end flex-wrap">
            <select value={rsDay} onChange={(e) => setRsDay(e.target.value)}
              className="rounded border px-2 py-1.5 text-sm">
              {DAYS.map((d) => <option key={d} value={d}>{DAY_LABELS[d]}</option>)}
            </select>
            <select value={rsSlot} onChange={(e) => setRsSlot(e.target.value)}
              className="rounded border px-2 py-1.5 text-sm">
              {SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input type="number" value={rsDuration} onChange={(e) => setRsDuration(e.target.value)}
              placeholder="min" className="w-20 rounded border px-2 py-1.5 text-sm" />
            <select value={rsIntensity} onChange={(e) => setRsIntensity(e.target.value)}
              className="rounded border px-2 py-1.5 text-sm">
              {INTENSITIES.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
            <select value={rsPlanningType} onChange={(e) => setRsPlanningType(e.target.value)}
              className="rounded border px-2 py-1.5 text-sm">
              <option value="fixed">fixed</option>
              <option value="preferred">optional</option>
            </select>
          </div>
          <input type="text" value={rsNotes} onChange={(e) => setRsNotes(e.target.value)}
            placeholder='Notes, e.g. "HYROX group class"'
            className="w-full rounded border px-3 py-1.5 text-sm" />
          <p className="text-xs text-gray-400">
            <strong>fixed</strong> = always in plan · <strong>optional</strong> = planner chooses if useful
          </p>
          <button
            onClick={() => addRecSession.mutate()}
            disabled={addRecSession.isPending}
            className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {addRecSession.isPending ? "Adding..." : "Add session"}
          </button>
        </div>
      </section>

      {/* Training Profile */}
      <section className="space-y-3">
        <h2 className="font-semibold">Training Profile</h2>
        <p className="text-xs text-gray-400">Used to personalise HR zones in generated workout plans.</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">
            Resting HR
            <input type="number" value={restingHr} onChange={(e) => setRestingHr(e.target.value)}
              placeholder="e.g. 52" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
          </label>
          <label className="block text-sm">
            Max HR
            <input type="number" value={maxHr} onChange={(e) => setMaxHr(e.target.value)}
              placeholder="e.g. 185" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
          </label>
          <label className="block text-sm">
            Easy HR min
            <input type="number" value={easyHrMin} onChange={(e) => setEasyHrMin(e.target.value)}
              placeholder="e.g. 130" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
          </label>
          <label className="block text-sm">
            Easy HR max
            <input type="number" value={easyHrMax} onChange={(e) => setEasyHrMax(e.target.value)}
              placeholder="e.g. 150" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
          </label>
          <label className="block text-sm">
            Tempo HR min
            <input type="number" value={tempoHrMin} onChange={(e) => setTempoHrMin(e.target.value)}
              placeholder="e.g. 151" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
          </label>
          <label className="block text-sm">
            Tempo HR max
            <input type="number" value={tempoHrMax} onChange={(e) => setTempoHrMax(e.target.value)}
              placeholder="e.g. 165" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
          </label>
          <label className="block text-sm">
            Threshold HR
            <input type="number" value={thresholdHr} onChange={(e) => setThresholdHr(e.target.value)}
              placeholder="e.g. 166" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
          </label>
          <label className="block text-sm">
            Zone method
            <select value={zoneMethod} onChange={(e) => setZoneMethod(e.target.value)}
              className="mt-1 block w-full rounded border px-2 py-1 text-sm">
              <option value="estimated">Estimated (Karvonen)</option>
              <option value="manual">Manual</option>
            </select>
          </label>
        </div>
        <button
          onClick={() => saveTrainingProfile.mutate()}
          disabled={saveTrainingProfile.isPending}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {trainingProfileSaved ? "Saved" : saveTrainingProfile.isPending ? "Saving..." : "Save training profile"}
        </button>
      </section>

      {/* Hybrid Race Profile */}
      <section className="space-y-3">
        <h2 className="font-semibold">Hybrid Race Profile</h2>
        <p className="text-xs text-gray-400">Default format for station-circuit workout plans.</p>
        <p className="text-xs text-gray-400">
          Rounds = full repeats of all stations. Stations = exercises inside one round.
        </p>
        <p className="text-xs text-gray-400">
          Typical: 3 rounds × 8 stations, 60s work / 20s transition.
        </p>
        <label className="block text-sm">
          Default format
          <select value={hybridFormat} onChange={(e) => setHybridFormat(e.target.value)}
            className="mt-1 block w-full rounded border px-2 py-1.5 text-sm">
            {HYBRID_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hybridInclRun}
            onChange={(e) => setHybridInclRun(e.target.checked)} />
          Include running between stations by default
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="block text-sm">
            Work (sec)
            <input type="number" value={hybridWorkSec} onChange={(e) => setHybridWorkSec(e.target.value)}
              className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
          </label>
          <label className="block text-sm">
            Rest / transition (sec)
            <input type="number" value={hybridRestSec} onChange={(e) => setHybridRestSec(e.target.value)}
              className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
          </label>
          <label className="block text-sm">
            Rounds
            <span className="block text-[10px] text-gray-400">= full repeats of all stations</span>
            <input type="number" value={hybridRounds} onChange={(e) => setHybridRounds(e.target.value)}
              className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
          </label>
        </div>
        <label className="block text-sm">
          Notes
          <input type="text" value={hybridNotes} onChange={(e) => setHybridNotes(e.target.value)}
            placeholder="e.g. preferred equipment, race goal distance…"
            className="mt-1 block w-full rounded border px-2 py-1.5 text-sm" />
        </label>
        <button
          onClick={() => saveHybridProfile.mutate()}
          disabled={saveHybridProfile.isPending}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {hybridProfileSaved ? "Saved" : saveHybridProfile.isPending ? "Saving..." : "Save Hybrid Race profile"}
        </button>
      </section>

      {/* Nutrition Profile */}
      <section className="space-y-4">
        <div>
          <h2 className="font-semibold">Nutrition Profile</h2>
          <p className="text-xs text-gray-400 mt-0.5">Personalises daily and weekly fueling guidance.</p>
        </div>

        {/* Section 1 — Routine */}
        <div className="space-y-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Routine</p>
          <label className="block text-sm">
            Current meal pattern
            <input
              type="text"
              value={nutMealPattern}
              onChange={(e) => setNutMealPattern(e.target.value)}
              placeholder="e.g. 3 meals, skip breakfast, IF 16:8…"
              className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm">
            Nutrition goal
            <input
              type="text"
              value={nutGoal}
              onChange={(e) => setNutGoal(e.target.value)}
              placeholder="e.g. better energy, avoid under-fueling, body recomp…"
              className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
            />
          </label>
        </div>

        {/* Section 2 — Pre-workout tolerance */}
        <div className="space-y-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Pre-workout tolerance</p>
          <label className="block text-sm">
            Min gap after main meal before workout (hours)
            <input
              type="number"
              min={1}
              max={6}
              value={nutMealGap}
              onChange={(e) => setNutMealGap(e.target.value)}
              placeholder="e.g. 2"
              className="mt-1 block w-24 rounded border px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm">
            Pre-workout snack tolerance
            <input
              type="text"
              value={nutSnackTolerance}
              onChange={(e) => setNutSnackTolerance(e.target.value)}
              placeholder="e.g. handles solid food fine, liquid only, nothing within 1h…"
              className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
            />
          </label>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={nutStomach}
                onChange={(e) => setNutStomach(e.target.checked)}
              />
              Stomach sensitive
              <span className="text-xs text-gray-400">— keep pre-workout food very light</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={nutCaffeine}
                onChange={(e) => setNutCaffeine(e.target.checked)}
              />
              Caffeine sensitive
            </label>
          </div>
        </div>

        {/* Section 3 — Foods that work */}
        <div className="space-y-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Foods that work</p>
          <label className="block text-sm">
            Preferred foods / easy staples
            <input
              type="text"
              value={nutPreferredFoods}
              onChange={(e) => setNutPreferredFoods(e.target.value)}
              placeholder="e.g. oats, eggs, rice, sweet potato…"
              className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm">
            Foods to avoid
            <input
              type="text"
              value={nutAvoidFoods}
              onChange={(e) => setNutAvoidFoods(e.target.value)}
              placeholder="e.g. dairy, gluten, nuts…"
              className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm">
            Preferred pre-workout snack
            <input
              type="text"
              value={nutPreSnack}
              onChange={(e) => setNutPreSnack(e.target.value)}
              placeholder="e.g. banana + peanut butter"
              className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm">
            Preferred post-workout meal
            <input
              type="text"
              value={nutPostMeal}
              onChange={(e) => setNutPostMeal(e.target.value)}
              placeholder="e.g. rice + chicken + veggies"
              className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
            />
          </label>
        </div>

        {/* Section 4 — Energy estimate */}
        <div className="space-y-2.5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Energy estimate</p>
            <p className="text-xs text-gray-400 mt-0.5">Used only for rough daily guidance. This is not calorie tracking.</p>
          </div>
          <label className="block text-sm">
            Body weight (kg)
            <input
              type="number"
              min={30}
              max={200}
              step={0.5}
              value={nutBodyWeight}
              onChange={(e) => setNutBodyWeight(e.target.value)}
              placeholder="e.g. 78"
              className="mt-1 block w-24 rounded border px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm">
            Estimated rest-day calories
            <input
              type="number"
              min={1000}
              max={5000}
              step={50}
              value={nutRestCalories}
              onChange={(e) => setNutRestCalories(e.target.value)}
              placeholder="e.g. 2300"
              className="mt-1 block w-32 rounded border px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm">
            Goal
            <select
              value={nutCalorieGoal}
              onChange={(e) => setNutCalorieGoal(e.target.value)}
              className="mt-1 block w-48 rounded border px-3 py-1.5 text-sm"
            >
              <option value="maintain">Maintain</option>
              <option value="slight_surplus">Slight surplus</option>
              <option value="slight_deficit">Slight deficit</option>
            </select>
          </label>
        </div>

        {/* Section 5 — Optional details */}
        <div className="space-y-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Optional details</p>
          <label className="block text-sm">
            Supplements
            <input
              type="text"
              value={nutSupplements}
              onChange={(e) => setNutSupplements(e.target.value)}
              placeholder="e.g. creatine, magnesium, vitamin D…"
              className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm">
            Cooking style / time preference
            <input
              type="text"
              value={nutCookingPref}
              onChange={(e) => setNutCookingPref(e.target.value)}
              placeholder="e.g. quick meals under 20 min, batch cook weekends…"
              className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm">
            Diet notes
            <textarea
              value={nutDietNotes}
              onChange={(e) => setNutDietNotes(e.target.value)}
              placeholder="e.g. plant-based, low-carb, intermittent fasting…"
              rows={2}
              className="mt-1 block w-full rounded border px-3 py-1.5 text-sm"
            />
          </label>
        </div>

        <button
          onClick={() => saveNutritionProfile.mutate()}
          disabled={saveNutritionProfile.isPending}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {nutritionSaved
            ? "Saved"
            : saveNutritionProfile.isPending
            ? "Saving..."
            : "Save nutrition profile"}
        </button>
      </section>

      {/* Strava */}
      <section className="space-y-3">
        <h2 className="font-semibold">Strava</h2>
        <Suspense fallback={null}>
          <StravaSettings initialConnection={initialStravaConnection} />
        </Suspense>
      </section>

      {/* Logout */}
      <form action="/api/auth/logout" method="post">
        <button type="submit" className="w-full rounded border py-2 text-sm text-red-500">
          Log out
        </button>
      </form>
    </main>
  );
}
