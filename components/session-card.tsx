"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { StravaPanel } from "@/components/strava-panel";
import type { StravaLinkProp } from "@/components/strava-panel";
import { ExecutionSummaryBlock } from "@/components/execution-summary-block";

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
  stravaLinks?: StravaLinkProp[];
  stravaConnected?: boolean;
};

// Keyword list mirrors lib/checkin-utils.ts — kept inline to avoid server-only imports in client bundle
const INJURY_KEYWORDS = [
  "injury", "injured", "pain", "hurt", "sore", "knee", "ankle", "back",
  "hip", "hamstring", "calf", "shin", "groin", "shoulder", "wrist", "foot",
  "muscle", "strain", "sprain", "tendon", "ligament",
  "боль", "болит", "болят", "травм", "колен", "лодыжк", "спин", "бедр", "плеч",
  "schmerz", "schmerzen", "verletzt", "verletzung", "knie", "knöchel", "rücken", "hüfte", "schulter",
];

function classifyCheckIn(feelScore: number, notes: string | null): "injury" | "fatigue" | "ok" {
  if (feelScore >= 4) return "ok";
  const lower = (notes ?? "").toLowerCase();
  if (INJURY_KEYWORDS.some((kw) => lower.includes(kw))) return "injury";
  return "fatigue";
}

function staticHint(
  category: "injury" | "fatigue" | "ok",
  feelScore: number
): string | null {
  if (category === "injury") return "Possible injury noted — mark resolved when feeling better.";
  if (category === "fatigue") return "Tough day — load adjusted for next session.";
  if (feelScore >= 5) return "Strong session — plan unchanged.";
  return null;
}

export function SessionCard({
  session,
  todayStr,
}: {
  session: SessionProp;
  todayStr?: string;
}) {
  const router = useRouter();
  const [checkIn, setCheckIn] = useState<CheckInProp | null>(session.checkIn);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [feelScore, setFeelScore] = useState(session.checkIn?.feelScore ?? 4);
  const [notes, setNotes] = useState(session.checkIn?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(session.status === "done" || !!session.checkIn);
  const isFuture = todayStr ? session.scheduledDate > todayStr : false;

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
    router.refresh();
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
    router.refresh();
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
    router.refresh();
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
    router.refresh();
  }

  function startEdit() {
    setFeelScore(checkIn?.feelScore ?? 4);
    setNotes(checkIn?.notes ?? "");
    setEditing(true);
    setOpen(true);
  }

  const isResolved = !!checkIn?.resolvedAt;
  const category = checkIn ? classifyCheckIn(checkIn.feelScore, checkIn.notes) : "ok";
  const isInjury = category === "injury";
  const coachAdvice = checkIn?.coachAdvice ?? null;
  const hint = !isResolved && !coachAdvice ? staticHint(category, checkIn?.feelScore ?? 4) : null;
  const isPositiveAdvice = (checkIn?.feelScore ?? 0) >= 5;

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
          {session.planningType === "manual" && (
            <span className="ml-2 rounded bg-purple-50 px-1 text-xs text-purple-500">manual</span>
          )}
        </div>
        {done ? (
          <div className="flex items-center gap-2">
            <span className={`text-sm ${isResolved ? "text-gray-400" : "text-green-600"}`}>
              {isResolved
                ? "Done · resolved"
                : checkIn
                ? `Done · ${checkIn.feelScore}/6`
                : "Done"}
            </span>
            {!editing && (
              <button onClick={startEdit} className="text-xs text-gray-400 underline">
                edit
              </button>
            )}
          </div>
        ) : isFuture ? (
          <span className="text-xs text-gray-400">Upcoming</span>
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
          {/* Execution summary — factual actual vs plan, when Strava attached */}
          {(session.stravaLinks?.length ?? 0) > 0 && (
            <ExecutionSummaryBlock
              session={{ durationMin: session.durationMin, notes: session.notes }}
              stravaLinks={session.stravaLinks!}
            />
          )}
          {/* Coach advice — bad sessions: amber; good sessions: green */}
          {coachAdvice && !isResolved && (
            <div className={`rounded px-2 py-1.5 ${isPositiveAdvice ? "bg-green-50" : "bg-amber-50"}`}>
              <p className={`text-xs font-medium mb-0.5 ${isPositiveAdvice ? "text-green-700" : "text-amber-700"}`}>Coach</p>
              <p className={`text-xs whitespace-pre-line ${isPositiveAdvice ? "text-green-800" : "text-amber-800"}`}>{coachAdvice}</p>
            </div>
          )}
          {/* Fallback static hint */}
          {hint && (
            <p className="text-xs text-amber-600">{hint}</p>
          )}
          {/* Resolve/reopen — injury ONLY, not fatigue */}
          {isInjury && !isResolved && (
            <button
              onClick={resolveIssue}
              disabled={submitting}
              className="text-xs text-green-600 underline disabled:opacity-50"
            >
              Mark issue resolved
            </button>
          )}
          {isInjury && isResolved && (
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

      {/* Strava activity links */}
      {session.stravaConnected && (
        <StravaPanel
          sessionId={session.id}
          sessionDate={session.scheduledDate}
          sessionDurationMin={session.durationMin}
          sessionNotes={session.notes}
          sessionSlot={session.preferredSlot}
          initialLinks={session.stravaLinks ?? []}
          stravaConnected={session.stravaConnected}
        />
      )}

      {/* Check-in / edit form */}
      {open && (
        <div className="space-y-2 border-t pt-2">
          <p className="text-xs text-gray-400">How did it feel? (1 = terrible, 6 = great)</p>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5, 6].map((n) => (
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
