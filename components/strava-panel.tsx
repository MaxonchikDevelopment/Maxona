"use client";
import { useState } from "react";

export type StravaActivitySummary = {
  id: string;
  stravaActivityId: string;
  name: string;
  sportType: string;
  startDate: string;
  distance: number;
  movingTime: number;
  elapsedTime: number;
  totalElevationGain: number;
  averageSpeed: number;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
};

export type StravaLinkProp = {
  id: string;
  isPrimary: boolean;
  activity: StravaActivitySummary;
};

function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const min = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}

function activityLine(a: StravaActivitySummary): string {
  const parts: string[] = [a.sportType];
  if (a.distance > 0) parts.push(fmtDist(a.distance));
  if (a.movingTime > 0) parts.push(fmtTime(a.movingTime));
  if (a.averageHeartrate) parts.push(`HR ${Math.round(a.averageHeartrate)}`);
  return parts.join(" · ");
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function StravaPanel({
  sessionId,
  sessionDate,
  initialLinks,
  stravaConnected,
}: {
  sessionId: string;
  sessionDate: string;
  initialLinks: StravaLinkProp[];
  stravaConnected: boolean;
}) {
  const [links, setLinks] = useState<StravaLinkProp[]>(initialLinks);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [available, setAvailable] = useState<StravaActivitySummary[]>([]);
  const [loadingPicker, setLoadingPicker] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // activityId being acted on

  if (!stravaConnected) return null;

  async function openPicker() {
    setPickerOpen(true);
    setLoadingPicker(true);
    try {
      const res = await fetch(
        `/api/strava/activities?sessionDate=${sessionDate}&excludeSessionId=${sessionId}`
      );
      const data: StravaActivitySummary[] = await res.json();
      setAvailable(data);
    } finally {
      setLoadingPicker(false);
    }
  }

  async function attach(activityId: string) {
    setBusy(activityId);
    try {
      const isFirstLink = links.length === 0;
      const res = await fetch(`/api/sessions/${sessionId}/strava-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stravaActivityId: activityId, isPrimary: isFirstLink }),
      });
      const newLink: StravaLinkProp = await res.json();
      setLinks((prev) => [...prev, newLink]);
      setAvailable((prev) => prev.filter((a) => a.id !== activityId));
    } finally {
      setBusy(null);
    }
  }

  async function detach(linkId: string) {
    setBusy(linkId);
    try {
      await fetch(`/api/sessions/${sessionId}/strava-links/${linkId}`, { method: "DELETE" });
      setLinks((prev) => prev.filter((l) => l.id !== linkId));
    } finally {
      setBusy(null);
    }
  }

  async function setPrimary(linkId: string) {
    setBusy(linkId);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/strava-links/${linkId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPrimary: true }),
      });
      const updated: StravaLinkProp = await res.json();
      setLinks((prev) =>
        prev.map((l) => ({
          ...l,
          isPrimary: l.id === updated.id,
        }))
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border-t pt-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-orange-500">
          Strava
        </span>
        <button
          onClick={pickerOpen ? () => setPickerOpen(false) : openPicker}
          className="text-[10px] text-gray-400 underline"
        >
          {pickerOpen ? "close" : "+ Attach"}
        </button>
      </div>

      {/* Linked activities */}
      {links.map((link) => (
        <div key={link.id} className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              {link.isPrimary && (
                <span className="text-[9px] text-orange-400 font-bold">★</span>
              )}
              <span className="text-xs font-medium text-gray-700 truncate">{link.activity.name}</span>
            </div>
            <p className="text-[10px] text-gray-400">{activityLine(link.activity)}</p>
          </div>
          <div className="flex shrink-0 gap-1.5 items-center">
            {!link.isPrimary && links.length > 1 && (
              <button
                onClick={() => setPrimary(link.id)}
                disabled={busy === link.id}
                className="text-[10px] text-gray-400 disabled:opacity-40"
                title="Set as primary"
              >
                ☆
              </button>
            )}
            <button
              onClick={() => detach(link.id)}
              disabled={busy === link.id}
              className="text-[10px] text-red-400 underline disabled:opacity-40"
            >
              ×
            </button>
          </div>
        </div>
      ))}

      {/* Picker */}
      {pickerOpen && (
        <div className="mt-1 space-y-1 border rounded p-2 bg-gray-50">
          {loadingPicker ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : available.length === 0 ? (
            <p className="text-xs text-gray-400">No unattached activities within ±2 days.</p>
          ) : (
            available.map((a) => (
              <div key={a.id} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-700 truncate">{a.name}</p>
                  <p className="text-[10px] text-gray-400">
                    {shortDate(a.startDate)} · {activityLine(a)}
                  </p>
                </div>
                <button
                  onClick={() => attach(a.id)}
                  disabled={busy === a.id}
                  className="shrink-0 text-xs text-blue-600 underline disabled:opacity-40"
                >
                  {busy === a.id ? "…" : "Attach"}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
