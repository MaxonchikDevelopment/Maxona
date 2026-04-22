"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const SLOTS = ["morning", "daytime", "afternoon", "evening"] as const;
const INTENSITIES = ["easy", "moderate", "hard"] as const;
const EVENT_KINDS = ["blocked", "household", "calendar_busy", "travel"] as const;
const MODALITIES = ["hyrox", "running", "cycling", "swimming"] as const;

type AvailWindow = { id: string; dayOfWeek: string; timeStartMin: number; timeEndMin: number };
type ScheduleEv = { id: string; startsAt: string; endsAt: string; kind: string; note: string | null };
type RecSession = { id: string; dayOfWeek: string; preferredSlot: string; durationMin: number; intensity: string; notes: string | null };

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
};

export function SettingsClient({
  initialConstraints,
  userName,
  userTimezone,
}: {
  initialConstraints: Constraints;
  userName: string;
  userTimezone: string;
}) {
  const qc = useQueryClient();

  // --- Constraints ---
  const [maxMin, setMaxMin] = useState(String(initialConstraints.maxContinuousTrainingMinutes ?? 240));
  const [hoursTarget, setHoursTarget] = useState(String(initialConstraints.weeklyTrainingHoursTarget ?? ""));
  const [modalities, setModalities] = useState<string[]>(
    initialConstraints.allowedModalities ?? [...MODALITIES]
  );
  const [constraintsSaved, setConstraintsSaved] = useState(false);

  const saveConstraints = useMutation({
    mutationFn: () =>
      fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxContinuousTrainingMinutes: Number(maxMin) || 240,
          weeklyTrainingHoursTarget: hoursTarget ? Number(hoursTarget) : undefined,
          allowedModalities: modalities,
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

  const addRecSession = useMutation({
    mutationFn: () =>
      fetch("/api/recurring-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dayOfWeek: rsDay, preferredSlot: rsSlot, durationMin: Number(rsDuration), intensity: rsIntensity, notes: rsNotes || undefined }),
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
        <button
          onClick={() => saveConstraints.mutate()}
          disabled={saveConstraints.isPending}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {constraintsSaved ? "Saved" : saveConstraints.isPending ? "Saving..." : "Save constraints"}
        </button>
      </section>

      {/* Availability Windows */}
      <section className="space-y-3">
        <h2 className="font-semibold">Availability Windows</h2>
        <div className="space-y-1">
          {windows.map((w) => (
            <div key={w.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span className="font-mono uppercase">{w.dayOfWeek}</span>
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
            {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
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
        <h2 className="font-semibold">Fixed Weekly Sessions</h2>
        <p className="text-xs text-gray-500">Sessions added here are locked into every generated plan.</p>
        <div className="space-y-1">
          {recSessions.length === 0 && <p className="text-sm text-gray-400">None set.</p>}
          {recSessions.map((rs) => (
            <div key={rs.id} className="flex items-start justify-between rounded border px-3 py-2 text-sm">
              <div>
                <span className="font-mono uppercase">{rs.dayOfWeek}</span>
                <span className="mx-1 text-gray-400">·</span>
                <span>{rs.preferredSlot}</span>
                <span className="mx-1 text-gray-400">·</span>
                <span>{rs.durationMin} min</span>
                <span className="mx-1 text-gray-400">·</span>
                <span className="text-gray-500">{rs.intensity}</span>
                {rs.notes && <p className="text-xs text-gray-500 mt-0.5">{rs.notes}</p>}
              </div>
              <button onClick={() => delRecSession.mutate(rs.id)} className="text-red-400 text-xs ml-2">
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <select value={rsDay} onChange={(e) => setRsDay(e.target.value)}
            className="rounded border px-2 py-1.5 text-sm">
            {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
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
        </div>
        <input type="text" value={rsNotes} onChange={(e) => setRsNotes(e.target.value)}
          placeholder='Notes, e.g. "HYROX group class"'
          className="w-full rounded border px-3 py-1.5 text-sm" />
        <button
          onClick={() => addRecSession.mutate()}
          disabled={addRecSession.isPending}
          className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {addRecSession.isPending ? "Adding..." : "Add session"}
        </button>
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
