"use client";
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 20; // ~60s of polling — a fresh page load retries after that

// Polls the AiInsightCache status endpoint until a background-generated payload
// shows up, then stops. `initialData` is what the server already had cached
// (often null on a cache miss) so the first render has no flash of "loading"
// when content is already available.
export function useAiInsight<T>({
  kind,
  scopeKey,
  initialData,
}: {
  kind: string;
  scopeKey: string;
  initialData: T | null;
}) {
  const attempts = useRef(0);

  return useQuery({
    queryKey: ["ai-insight", kind, scopeKey],
    queryFn: async (): Promise<T | null> => {
      attempts.current += 1;
      const res = await fetch(
        `/api/insights/status?kind=${encodeURIComponent(kind)}&scopeKey=${encodeURIComponent(scopeKey)}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      return (data.payload as T | null) ?? null;
    },
    initialData,
    refetchInterval: (query) =>
      query.state.data || attempts.current >= MAX_POLL_ATTEMPTS ? false : POLL_INTERVAL_MS,
    refetchOnWindowFocus: false,
  });
}
