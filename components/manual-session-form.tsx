"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const MODALITIES = [
  { value: "running", label: "Running" },
  { value: "cycling", label: "Cycling" },
  { value: "swimming", label: "Swimming" },
  { value: "hyrox", label: "HYROX" },
  { value: "strength", label: "Strength" },
  { value: "other", label: "Other" },
];

const INTENSITIES = [
  { value: "easy", label: "Easy" },
  { value: "moderate", label: "Mod" },
  { value: "hard", label: "Hard" },
];

const SLOTS = [
  { value: "morning", label: "Morning" },
  { value: "daytime", label: "Daytime" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
];

export function ManualSessionForm({ defaultDate }: { defaultDate: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [modality, setModality] = useState("running");
  const [durationMin, setDurationMin] = useState(60);
  const [intensity, setIntensity] = useState("easy");
  const [preferredSlot, setPreferredSlot] = useState("morning");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, modality, durationMin, intensity, preferredSlot, notes }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data as { error?: string } | null)?.error ?? "Failed to add workout");
      }
      setOpen(false);
      setNotes("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded border border-dashed border-gray-300 py-1.5 text-xs text-gray-400 hover:border-gray-400 hover:text-gray-600"
      >
        + Add workout
      </button>
    );
  }

  return (
    <div className="rounded border bg-gray-50 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">Add workout</p>
        <button onClick={() => setOpen(false)} className="text-xs text-gray-400">
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-0.5 block text-xs text-gray-500">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded border px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="mb-0.5 block text-xs text-gray-500">Duration (min)</label>
          <input
            type="number"
            value={durationMin}
            min={1}
            max={600}
            onChange={(e) => setDurationMin(parseInt(e.target.value) || 60)}
            className="w-full rounded border px-2 py-1 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="mb-0.5 block text-xs text-gray-500">Sport</label>
        <div className="flex flex-wrap gap-1.5">
          {MODALITIES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setModality(m.value)}
              className={`rounded border px-2.5 py-1 text-xs ${
                modality === m.value ? "border-black bg-black text-white" : "border-gray-300"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-0.5 block text-xs text-gray-500">Intensity</label>
          <div className="flex gap-1">
            {INTENSITIES.map((i) => (
              <button
                key={i.value}
                type="button"
                onClick={() => setIntensity(i.value)}
                className={`flex-1 rounded border py-1 text-xs ${
                  intensity === i.value ? "border-black bg-black text-white" : "border-gray-300"
                }`}
              >
                {i.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-0.5 block text-xs text-gray-500">Slot</label>
          <select
            value={preferredSlot}
            onChange={(e) => setPreferredSlot(e.target.value)}
            className="w-full rounded border px-2 py-1 text-xs"
          >
            {SLOTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-0.5 block text-xs text-gray-500">Notes (optional)</label>
        <input
          type="text"
          placeholder="e.g. tempo run, 10km, recovery ride"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded border px-2 py-1 text-sm"
        />
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button
        onClick={submit}
        disabled={submitting}
        className="w-full rounded bg-black py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitting ? "Adding…" : "Add workout"}
      </button>
    </div>
  );
}
