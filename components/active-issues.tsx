"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export type IssueItem = {
  checkInId: string;
  sessionId: string;
  sessionDate: string;
  sessionIntensity: string;
  sessionNotes: string | null;
  feelScore: number;
  notes: string | null;
};

const DOW_LABELS: Record<number, string> = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };

function shortDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return `${DOW_LABELS[d.getUTCDay()]} ${d.getUTCDate()} ${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })}`;
}

export function ActiveIssues({ initialIssues }: { initialIssues: IssueItem[] }) {
  const router = useRouter();
  const [issues, setIssues] = useState(initialIssues);
  const [resolving, setResolving] = useState<string | null>(null);

  // Sync local state when server re-renders with fresh props (e.g. after router.refresh())
  useEffect(() => {
    setIssues(initialIssues);
  }, [initialIssues]);

  if (issues.length === 0) return null;

  async function resolve(issue: IssueItem) {
    setResolving(issue.checkInId);
    try {
      const res = await fetch(`/api/sessions/${issue.sessionId}/checkin`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved: true }),
      });
      if (res.ok) {
        setIssues((prev) => prev.filter((i) => i.checkInId !== issue.checkInId));
        router.refresh();
      }
    } finally {
      setResolving(null);
    }
  }

  return (
    <div className="rounded border-l-2 border-orange-400 bg-orange-50 px-3 py-2 space-y-2">
      <p className="text-xs font-semibold text-orange-700">
        Active issue{issues.length > 1 ? "s" : ""}{issues.length > 1 ? ` · ${issues.length}` : ""}
      </p>
      {issues.map((issue) => {
        const label = issue.sessionNotes?.split(":")[0].trim() ?? issue.sessionIntensity;
        return (
          <div key={issue.checkInId} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-orange-900">{label}</p>
              <p className="text-xs text-orange-700">
                {shortDateLabel(issue.sessionDate)} · feel {issue.feelScore}/6
                {issue.notes ? ` — ${issue.notes}` : ""}
              </p>
            </div>
            <button
              onClick={() => resolve(issue)}
              disabled={resolving === issue.checkInId}
              className="shrink-0 text-xs text-green-700 underline disabled:opacity-40"
            >
              Resolve
            </button>
          </div>
        );
      })}
    </div>
  );
}
