"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const HIDE_KEY = "maxona_onboarding_hidden";

export function OnboardingCard() {
  // null = not yet read from localStorage (avoids hydration mismatch)
  const [hidden, setHidden] = useState<boolean | null>(null);

  useEffect(() => {
    setHidden(localStorage.getItem(HIDE_KEY) === "1");
  }, []);

  if (hidden === null || hidden) return null;

  return (
    <div className="rounded border border-blue-100 bg-blue-50 px-3 py-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-400">
            Getting started
          </p>
          <p className="text-sm font-semibold text-blue-900 mt-0.5">Welcome to Maxona</p>
        </div>
        <button
          onClick={() => {
            localStorage.setItem(HIDE_KEY, "1");
            setHidden(true);
          }}
          className="text-xs text-blue-400 hover:text-blue-600 shrink-0 mt-1"
        >
          Hide
        </button>
      </div>
      <p className="text-xs text-blue-700">
        Follow these steps to get your first AI training plan.
      </p>
      <ol className="space-y-1.5">
        <li className="flex items-start gap-2 text-xs text-blue-800">
          <span className="font-semibold text-blue-400 shrink-0 w-4">1.</span>
          <span>
            <Link href="/settings" className="font-medium underline underline-offset-2">
              Settings
            </Link>
            {" — fill training profile, availability, and constraints"}
          </span>
        </li>
        <li className="flex items-start gap-2 text-xs text-blue-800">
          <span className="font-semibold text-blue-400 shrink-0 w-4">2.</span>
          <span>
            <Link href="/goals" className="font-medium underline underline-offset-2">
              Goals
            </Link>
            {" — add discipline, target date, and priority"}
          </span>
        </li>
        <li className="flex items-start gap-2 text-xs text-blue-800">
          <span className="font-semibold text-blue-400 shrink-0 w-4">3.</span>
          <span>Connect Strava (optional) — Settings → Strava</span>
        </li>
        <li className="flex items-start gap-2 text-xs text-blue-800">
          <span className="font-semibold text-blue-400 shrink-0 w-4">4.</span>
          <span>
            <Link href="/review" className="font-medium underline underline-offset-2">
              Generate plan
            </Link>
            {" — create your first weekly training plan"}
          </span>
        </li>
        <li className="flex items-start gap-2 text-xs text-blue-800">
          <span className="font-semibold text-blue-400 shrink-0 w-4">5.</span>
          <span>Use daily readiness check-ins before each session</span>
        </li>
      </ol>
    </div>
  );
}
