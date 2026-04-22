"use client";
import { useState } from "react";

export type SessionProp = {
  id: string;
  scheduledDate: string;
  preferredSlot: string;
  planningType: string;
  status: string;
  durationMin: number;
  intensity: string;
  notes: string | null;
  checkIn: { id: string; feelScore: number; notes: string | null } | null;
};

export function SessionCard({ session }: { session: SessionProp }) {
  const [open, setOpen] = useState(false);
  const [feelScore, setFeelScore] = useState(3);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(session.status === "done" || !!session.checkIn);

  async function submitCheckIn() {
    setSubmitting(true);
    await fetch(`/api/sessions/${session.id}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feelScore, notes }),
    });
    setDone(true);
    setOpen(false);
    setSubmitting(false);
  }

  return (
    <div className="space-y-2 rounded border p-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium capitalize">{session.intensity}</span>
          <span className="ml-2 text-sm text-gray-500">
            {session.durationMin} min · {session.preferredSlot}
          </span>
        </div>
        {done ? (
          <span className="text-sm text-green-600">Done ✓</span>
        ) : (
          <button onClick={() => setOpen(true)} className="text-sm text-blue-600">
            Check in
          </button>
        )}
      </div>
      {session.notes && (
        <p className="text-sm text-gray-600">{session.notes}</p>
      )}
      {open && (
        <div className="space-y-2 border-t pt-2">
          <p className="text-xs text-gray-400">How did it feel? (1 = terrible, 5 = great)</p>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setFeelScore(n)}
                className={`h-8 w-8 rounded border text-sm ${
                  feelScore === n ? "bg-black text-white" : ""
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded border px-2 py-1 text-sm"
          />
          <button
            onClick={submitCheckIn}
            disabled={submitting}
            className="w-full rounded bg-black py-1 text-sm text-white disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
