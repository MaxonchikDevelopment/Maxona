"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type StreamStatus = "idle" | "loading" | "done" | "no_stream" | "error";

type StreamResponse = {
  ok: boolean;
  status?: "created" | "existing" | "no_stream" | "error";
  message?: string;
  hasHeartrate?: boolean;
  sampleCount?: number;
};

export function AnalyzeStreamButton({
  activityId,
  sessionId,
}: {
  activityId: string;
  sessionId?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<StreamStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleAnalyze() {
    setState("loading");
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/strava/activities/${activityId}/streams`, {
        method: "POST",
      });
      const data: StreamResponse = await res.json();

      if (!res.ok || !data.ok) {
        setErrorMsg(data.message ?? "Failed to fetch stream.");
        setState("error");
        return;
      }

      if (data.status === "no_stream") {
        setState("no_stream");
        return;
      }

      // "created" or "existing" — stream is available
      router.refresh();
      setState("done");
    } catch {
      setErrorMsg("Network error. Try again.");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="space-y-1">
        <p className="text-[11px] text-green-600">Stream saved.</p>
        {sessionId && (
          <Link
            href={`/sessions/${sessionId}`}
            className="text-[11px] text-indigo-500 underline"
          >
            View HR analytics →
          </Link>
        )}
      </div>
    );
  }

  if (state === "no_stream") {
    return (
      <p className="text-[11px] text-gray-400">
        No detailed stream available for this activity.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <button
        onClick={handleAnalyze}
        disabled={state === "loading"}
        className="text-xs text-indigo-600 underline disabled:opacity-40"
      >
        {state === "loading" ? "Fetching stream…" : "Analyze Strava stream"}
      </button>
      {state === "error" && errorMsg && (
        <p className="text-[11px] text-red-500">{errorMsg}</p>
      )}
    </div>
  );
}
