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

  async function handleFetch() {
    setState("loading");
    setErrorMsg(null);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(`/api/strava/activities/${activityId}/streams`, {
        method: "POST",
        signal: controller.signal,
      });

      let data: StreamResponse;
      try {
        data = await res.json();
      } catch {
        setErrorMsg("Invalid response. Try again.");
        setState("error");
        return;
      }

      if (!res.ok || !data.ok) {
        setErrorMsg(data.message ?? "Could not fetch stream. Try syncing Strava again.");
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
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setErrorMsg("Stream fetch timed out. Try again later.");
      } else {
        setErrorMsg("Could not fetch stream. Try syncing Strava again.");
      }
      setState("error");
    } finally {
      clearTimeout(timeout);
    }
  }

  if (state === "done") {
    return (
      <div className="space-y-1">
        <p className="text-[11px] text-green-600">HR stream saved.</p>
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
        No HR stream available for this activity.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <button
        onClick={handleFetch}
        disabled={state === "loading"}
        className="text-xs text-indigo-600 underline disabled:opacity-40"
      >
        {state === "loading" ? "Fetching HR stream…" : "Fetch HR stream"}
      </button>
      {state === "error" && errorMsg && (
        <p className="text-[11px] text-red-500">{errorMsg}</p>
      )}
    </div>
  );
}
