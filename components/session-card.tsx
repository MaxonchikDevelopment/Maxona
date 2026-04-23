"use client";
import { useState } from "react";

export type CheckInProp = {
  id: string;
  feelScore: number;
  notes: string | null;
  coachAdvice: string | null;
  resolvedAt: string | null;
};

export type SessionProp = {
  id: string;
  scheduledDate: string;
  preferredSlot: string;
  planningType: string;
  status: string;
  durationMin: number;
  intensity: string;
  notes: string | null;
  checkIn: CheckInProp | null;
};

function staticHint(feelScore: number, resolved: boolean): string | null {
  if (resolved) return null;
  if (feelScore <= 2) return "Tough session — mark as resolved once you're feeling better.";
  if (feelScore === 3) return null;
  return "Solid session — good signal for the planner.";
}

export function SessionCard({ session }: { session: SessionProp }) {
  const [checkIn, setCheckIn] = useState<CheckInProp | null>(session.checkIn);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [feelScore, setFeelScore] = useState(session.checkIn?.feelScore ?? 3);
  const [notes, setNotes] = useState(session.checkIn?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(session.status === "done" || !!session.checkIn);

  async function submitCheckIn() {
    setSubmitting(true);
    const res = await fetch(`/api/sessions/${session.id}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feelScore, notes }),
    });
    const data = await res.json();
    setCheckIn(data);
    setDone(true);
    setOpen(false);
    setEditing(false);
    setSubmitting(false);
  }

  async function updateCheckIn() {
    if (!checkIn) return;
    setSubmitting(true);
    const res = await fetch(`/api/sessions/${session.id}/checkin`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feelScore, notes }),
    });
    const data = await res.json();
    setCheckIn(data);
    setEditing(false);
    setOpen(false);
    setSubmitting(false);
  }

  async function resolveIssue() {
    if (!checkIn) return;
    setSubmitting(true);
    const res = await fetch(`/api/sessions/${session.id}/checkin`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved: true }),
    });
    const data = await res.json();
    setCheckIn(data);
    setSubmitting(false);
  }

  async function reopenIssue() {
    if (!checkIn) return;
    setSubmitting(true);
    const res = await fetch(`/api/sessions/${session.id}/checkin`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved: false }),
    });
    const data = await res.json();
    setCheckIn(data);
    setSubmitting(false);
  }

  function startEdit() {
    setFeelScore(checkIn?.feelScore ?? 3);
    setNotes(checkIn?.notes ?? "");
    setEditing(true);
    setOpen(true);
  }

  const isResolved = !!checkIn?.resolvedAt;
  const isLowFeel = !!checkIn && checkIn.feelScore <= 2;
  const coachAdvice = checkIn?.coachAdvice ?? null;
  const hint = !isResolved && !coachAdvice ? staticHint(checkIn?.feelScore ?? 3, isResolved) : null;

  return (
    <div className="space-y-2 rounded border p-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium capitalize">{session.intensity}</span>
          <span className="ml-2 text-sm text-gray-500">
            {session.durationMin} min · {session.preferredSlot}
          </span>
          {session.planningType === "fixed" && (
            <span className="ml-2 rounded bg-gray-100 px-1 text-xs text-gray-500">fixed</span>
          )}
          {session.planningType === "preferred" && (
            <span className="ml-2 rounded bg-blue-50 px-1 text-xs text-blue-500">optional</span>
          )}
        </div>
        {done ? (
          <div className="flex items-center gap-2">
            <span className={`text-sm ${isResolved ? "text-gray-400" : "text-green-600"}`}>
              {isResolved ? "Done · resolved" : `Done · ${checkIn?.feelScore ?? ""}/5`}
            </span>
            {!editing && (
              <button onClick={startEdit} className="text-xs text-gray-400 underline">
                edit
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={() => {
              setEditing(false);
              setOpen(true);
            }}
            className="text-sm text-blue-600"
          >
            Check in
          </button>
        )}
      </div>

      {session.notes && (
        <p className="text-sm text-gray-600">{session.notes}</p>
      )}

      {/* Existing check-in summary (when not editing) */}
      {done && !open && checkIn && (
        <div className="space-y-1">
          {checkIn.notes && (
            <p className="text-xs text-gray-500 italic">&ldquo;{checkIn.notes}&rdquo;</p>
          )}
          {/* Coach advice (LLM-generated, only for bad check-ins) */}
          {coachAdvice && !isResolved && (
            <div className="rounded bg-amber-50 px-2 py-1.5">
              <p className="text-xs font-medium text-amber-700 mb-0.5">Coach</p>
              <p className="text-xs text-amber-800 whitespace-pre-line">{coachAdvice}</p>
            </div>
          )}
          {/* Fallback static hint */}
          {hint && (
            <p className="text-xs text-amber-600">{hint}</p>
          )}
          {isLowFeel && !isResolved && (
            <button
              onClick={resolveIssue}
              disabled={submitting}
              className="text-xs text-green-600 underline disabled:opacity-50"
            >
              Mark issue resolved
            </button>
          )}
          {isResolved && (
            <button
              onClick={reopenIssue}
              disabled={submitting}
              className="text-xs text-gray-400 underline disabled:opacity-50"
            >
              Reopen issue
            </button>
          )}
        </div>
      )}

      {/* Check-in / edit form */}
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
            placeholder="Notes (optional — mention injuries if any)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded border px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={editing ? updateCheckIn : submitCheckIn}
              disabled={submitting}
              className="flex-1 rounded bg-black py-1 text-sm text-white disabled:opacity-50"
            >
              {submitting ? "Saving..." : editing ? "Update" : "Save"}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setEditing(false);
              }}
              className="rounded border px-3 py-1 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
