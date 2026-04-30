"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function AnalyzeStreamButton({ activityId }: { activityId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleAnalyze() {
    setState("loading");
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/strava/activities/${activityId}/streams`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.reason ?? data.error ?? "Failed to fetch stream");
        setState("error");
        return;
      }
      router.refresh();
    } catch {
      setErrorMsg("Network error");
      setState("error");
    }
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
      {errorMsg && (
        <p className="text-[11px] text-red-500">{errorMsg}</p>
      )}
    </div>
  );
}
