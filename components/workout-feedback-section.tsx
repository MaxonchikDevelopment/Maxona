"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { stripMarkdownBold } from "@/lib/format-bullets";

export type WorkoutFeedbackProp = {
  id: string;
  adherenceLabel: string;
  summary: string;
  bullets: string[];
  nextAdjustment: string | null;
  generatedAt: string;
};

const ADHERENCE_COLOR: Record<string, string> = {
  matched: "text-green-600",
  slightly_short: "text-amber-600",
  clearly_short: "text-red-500",
  longer_than_planned: "text-blue-600",
  different_sport: "text-purple-600",
  modified_due_fatigue: "text-amber-600",
  no_strava: "text-gray-400",
  unknown: "text-gray-400",
};

export const ADHERENCE_LABEL: Record<string, string> = {
  matched: "Matched",
  slightly_short: "Slightly short",
  clearly_short: "Clearly short",
  longer_than_planned: "Longer than planned",
  different_sport: "Different sport",
  modified_due_fatigue: "Modified (fatigue/illness)",
  no_strava: "No Strava data",
  unknown: "Unknown",
};

export function WorkoutFeedbackSection({
  sessionId,
  initialFeedback,
  sessionIsDone,
  hasCheckIn,
}: {
  sessionId: string;
  initialFeedback: WorkoutFeedbackProp | null;
  sessionIsDone: boolean;
  hasCheckIn: boolean;
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<WorkoutFeedbackProp | null>(initialFeedback);
  const [loading, setLoading] = useState(false);

  async function analyze() {
    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/workout-feedback`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setFeedback({
          id: data.id,
          adherenceLabel: data.adherenceLabel,
          summary: data.summary,
          bullets: Array.isArray(data.bullets) ? (data.bullets as string[]) : [],
          nextAdjustment: data.nextAdjustment ?? null,
          generatedAt: data.generatedAt,
        });
        router.refresh();
      }
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }

  if (!sessionIsDone) {
    return (
      <div className="rounded border border-dashed border-gray-100 p-3 text-center">
        <p className="text-xs text-gray-300">Feedback appears after check-in.</p>
      </div>
    );
  }

  if (!hasCheckIn) {
    return (
      <div className="rounded border border-dashed border-gray-100 p-3 text-center">
        <p className="text-xs text-gray-300">
          Complete a check-in to generate workout feedback.
        </p>
      </div>
    );
  }

  if (feedback) {
    const color = ADHERENCE_COLOR[feedback.adherenceLabel] ?? "text-gray-400";
    const label = ADHERENCE_LABEL[feedback.adherenceLabel] ?? feedback.adherenceLabel;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            After workout
          </p>
          <button
            onClick={analyze}
            disabled={loading}
            className="text-[10px] text-gray-400 underline disabled:opacity-40"
          >
            {loading ? "Analyzing…" : "Regenerate"}
          </button>
        </div>
        <div className="rounded border bg-gray-50 px-3 py-2.5 space-y-1.5">
          <span className={`text-xs font-medium ${color}`}>{label}</span>
          <p className="text-xs text-gray-700">{stripMarkdownBold(feedback.summary)}</p>
          {feedback.bullets.length > 0 && (
            <div className="space-y-0.5">
              {feedback.bullets.map((b, i) => (
                <p key={i} className="text-[11px] text-gray-500">
                  • {stripMarkdownBold(b)}
                </p>
              ))}
            </div>
          )}
          {feedback.nextAdjustment && (
            <p className="text-[11px] text-indigo-600 italic pt-0.5">
              Next: {stripMarkdownBold(feedback.nextAdjustment)}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        After workout
      </p>
      <button
        onClick={analyze}
        disabled={loading}
        className="w-full rounded border border-dashed border-gray-200 py-2 text-sm text-gray-400 hover:border-gray-300 disabled:opacity-50"
      >
        {loading ? "Analyzing…" : "Analyze workout"}
      </button>
    </div>
  );
}
