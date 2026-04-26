"use client";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export type StravaConnectionProp = {
  stravaAthleteId: string;
  createdAt: string;
} | null;

function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const min = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}

export function StravaSettings({ initialConnection }: { initialConnection: StravaConnectionProp }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [connection, setConnection] = useState(initialConnection);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ created: number; skipped: number } | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    const status = searchParams.get("strava");
    if (status === "connected") setFlash("Connected to Strava.");
    if (status === "denied") setFlash("Strava connection cancelled.");
    if (status === "error") setFlash("Strava connection failed — try again.");
  }, [searchParams]);

  async function sync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/strava/sync?force=1", { method: "POST" });
      const data = await res.json();
      setSyncResult(data);
    } finally {
      setSyncing(false);
      router.refresh();
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      await fetch("/api/strava/disconnect", { method: "DELETE" });
      setConnection(null);
      router.refresh();
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">Strava</span>
        {connection ? (
          <span className="text-xs text-green-600 font-medium">Connected</span>
        ) : (
          <span className="text-xs text-gray-400">Not connected</span>
        )}
      </div>

      {flash && (
        <p className="text-xs text-blue-600">{flash}</p>
      )}

      {connection ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">Athlete ID: {connection.stravaAthleteId}</p>

          <div className="flex gap-2">
            <button
              onClick={sync}
              disabled={syncing}
              className="rounded border px-3 py-1.5 text-xs text-gray-700 disabled:opacity-50"
            >
              {syncing ? "Syncing..." : "Sync activities"}
            </button>
            <button
              onClick={disconnect}
              disabled={disconnecting}
              className="rounded border border-red-200 px-3 py-1.5 text-xs text-red-600 disabled:opacity-50"
            >
              {disconnecting ? "Disconnecting..." : "Disconnect"}
            </button>
          </div>

          {syncResult && (
            <p className="text-xs text-gray-500">
              Synced: {syncResult.created} new · {syncResult.skipped} already stored
            </p>
          )}
        </div>
      ) : (
        <a
          href="/api/strava/connect"
          className="inline-block rounded bg-orange-500 px-4 py-1.5 text-xs font-medium text-white"
        >
          Connect Strava
        </a>
      )}
    </div>
  );
}

// Compact display of activity metrics — reusable in other components
export function formatActivityLine(a: {
  name: string;
  sportType: string;
  distance: number;
  movingTime: number;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
}): string {
  const parts: string[] = [];
  if (a.distance > 0) parts.push(formatDistance(a.distance));
  if (a.movingTime > 0) parts.push(formatDuration(a.movingTime));
  if (a.averageHeartrate) parts.push(`HR avg ${Math.round(a.averageHeartrate)}`);
  if (a.maxHeartrate) parts.push(`max ${Math.round(a.maxHeartrate)}`);
  return parts.join(" · ");
}
