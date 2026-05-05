"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const HIDE_KEY = "maxona_onboarding_hidden";

export function OnboardingCard() {
  const [hidden, setHidden] = useState<boolean | null>(null);

  useEffect(() => {
    setHidden(localStorage.getItem(HIDE_KEY) === "1");
  }, []);

  if (hidden === null || hidden) return null;

  return (
    <div className="rounded-2xl bg-indigo-50 border border-indigo-100 px-4 py-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-400">
            Getting started
          </p>
          <p className="text-sm font-semibold text-indigo-900 mt-0.5">Welcome to Maxona</p>
        </div>
        <button
          onClick={() => {
            localStorage.setItem(HIDE_KEY, "1");
            setHidden(true);
          }}
          className="text-xs text-indigo-400 hover:text-indigo-600 shrink-0 mt-0.5 transition-colors"
        >
          Hide
        </button>
      </div>
      <p className="text-xs text-indigo-700">
        Follow these steps to get your first AI training plan.
      </p>
      <ol className="space-y-2">
        <li className="flex items-start gap-2.5 text-xs text-indigo-800">
          <span className="font-semibold text-indigo-400 shrink-0 w-4 tabular-nums">1.</span>
          <span>
            <Link href="/settings" className="font-semibold underline underline-offset-2 hover:text-indigo-600 transition-colors">
              Settings
            </Link>
            {" — fill training profile, availability, and constraints"}
          </span>
        </li>
        <li className="flex items-start gap-2.5 text-xs text-indigo-800">
          <span className="font-semibold text-indigo-400 shrink-0 w-4 tabular-nums">2.</span>
          <span>
            <Link href="/goals" className="font-semibold underline underline-offset-2 hover:text-indigo-600 transition-colors">
              Goals
            </Link>
            {" — add discipline, target date, and priority"}
          </span>
        </li>
        <li className="flex items-start gap-2.5 text-xs text-indigo-800">
          <span className="font-semibold text-indigo-400 shrink-0 w-4 tabular-nums">3.</span>
          <span>Connect Strava (optional) — Settings → Strava</span>
        </li>
        <li className="flex items-start gap-2.5 text-xs text-indigo-800">
          <span className="font-semibold text-indigo-400 shrink-0 w-4 tabular-nums">4.</span>
          <span>
            <Link href="/review" className="font-semibold underline underline-offset-2 hover:text-indigo-600 transition-colors">
              Generate plan
            </Link>
            {" — create your first weekly training plan"}
          </span>
        </li>
        <li className="flex items-start gap-2.5 text-xs text-indigo-800">
          <span className="font-semibold text-indigo-400 shrink-0 w-4 tabular-nums">5.</span>
          <span>Use daily readiness check-ins before each session</span>
        </li>
      </ol>
    </div>
  );
}
