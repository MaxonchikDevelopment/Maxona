"use client";
import { useState } from "react";
import { useAiInsight } from "@/lib/hooks/use-ai-insight";
import { AiGeneratingPlaceholder } from "@/components/ui/ai-generating-placeholder";
import type { NutritionAdvice, MealTimingItem } from "@/lib/ai/nutrition-advice";

function EnergyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs text-emerald-800">
      <span className="text-emerald-600">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function MealTimelineCard({ meal }: { meal: MealTimingItem }) {
  return (
    <div className="shrink-0 w-[112px] lg:w-auto rounded-xl bg-emerald-100/50 border border-emerald-100 px-2.5 py-2 space-y-0.5">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-emerald-500">{meal.time}</p>
      <p className="text-xs font-medium text-emerald-800 leading-tight">{meal.label}</p>
      <p className="text-[10px] text-emerald-700 leading-snug line-clamp-2">{meal.suggestion}</p>
      {meal.approxCalories != null && (
        <p className="text-[10px] text-emerald-600">~{meal.approxCalories} kcal</p>
      )}
    </div>
  );
}

function MealDetailRow({ meal }: { meal: MealTimingItem }) {
  const hasItems = (meal.items?.length ?? 0) > 0;
  return (
    <div className="space-y-0.5">
      <div className="flex gap-2 text-xs text-emerald-800">
        <span className="shrink-0 font-medium text-emerald-600 w-10">{meal.time}</span>
        <span className="flex-1">
          <span className="font-medium">{meal.label}</span>
          {" — "}
          {meal.suggestion}
          {meal.approxCalories != null && (
            <span className="text-emerald-600"> (~{meal.approxCalories} kcal)</span>
          )}
        </span>
      </div>
      {hasItems && (
        <div className="ml-12 space-y-0.5">
          {meal.items!.map((item, i) => (
            <p key={i} className="text-[11px] text-emerald-700">
              · {item.name} — {item.amount}
              {item.kcal != null && (
                <span className="text-emerald-500"> ({item.kcal} kcal)</span>
              )}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function NutritionCard({
  initialAdvice,
  scopeKey,
}: {
  initialAdvice: NutritionAdvice | null;
  scopeKey: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data: advice } = useAiInsight<NutritionAdvice>({
    kind: "daily-nutrition",
    scopeKey,
    initialData: initialAdvice,
  });

  if (!advice) {
    return <AiGeneratingPlaceholder label="Nutrition today — generating…" tint="emerald" />;
  }

  const hasEnergy = advice.energy != null;
  const hasMeals = advice.mealTiming.length > 0;
  const hasBefore = advice.before.length > 0;
  const hasDuring = advice.during.length > 0;
  const hasAfter = advice.after.length > 0;
  const hasHydration = advice.hydration.length > 0;
  const mealTotal = advice.mealTiming.reduce((sum, m) => sum + (m.approxCalories ?? 0), 0);
  const hasDetails = hasMeals || hasBefore || hasDuring || hasAfter || hasHydration || !!advice.timingNote;

  return (
    <div className="rounded-2xl bg-emerald-50/70 border border-emerald-100 px-4 py-3 space-y-2.5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600 mb-0.5">Nutrition today</p>
        <p className="text-xs font-medium text-emerald-800">{advice.summary}</p>
      </div>

      {hasEnergy && (
        <div className="flex items-center justify-between rounded-xl bg-emerald-100/50 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600">
            Target today {mealTotal > 0 && hasMeals ? `· ${advice.mealTiming.length} meals` : ""}
          </span>
          <span className="text-sm font-semibold text-emerald-800 tabular-nums">
            ≈{advice.energy!.targetCalories.toLocaleString()} kcal
          </span>
        </div>
      )}

      {hasMeals && (
        <div className="flex gap-2 overflow-x-auto pb-0.5 -mx-0.5 px-0.5 lg:grid lg:grid-cols-4 lg:overflow-visible lg:gap-1.5">
          {advice.mealTiming.map((meal, i) => (
            <MealTimelineCard key={i} meal={meal} />
          ))}
        </div>
      )}

      {hasDetails && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full text-left text-[11px] font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
        >
          {expanded ? "▲ Hide full meal plan" : "▼ Show full meal plan"}
        </button>
      )}

      {expanded && (
        <div className="space-y-2.5 max-h-72 overflow-y-auto pr-0.5 border-t border-emerald-100 pt-2.5">
          {hasEnergy && (
            <div className="rounded-xl bg-emerald-100/50 px-3 py-2 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600">Energy estimate</p>
              <EnergyRow label="Passive" value={`≈${advice.energy!.passiveCalories.toLocaleString()} kcal`} />
              {advice.energy!.activeCalories > 0 && (
                <EnergyRow label="Training" value={`+${advice.energy!.activeCalories.toLocaleString()} kcal`} />
              )}
              {mealTotal > 0 && (
                <EnergyRow label="Meal total" value={`≈${mealTotal.toLocaleString()} kcal`} />
              )}
              <p className="text-[10px] text-emerald-600 italic">{advice.energy!.balanceNote}</p>
            </div>
          )}

          {hasMeals && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600">Meal timing</p>
              {advice.mealTiming.map((meal, i) => (
                <MealDetailRow key={i} meal={meal} />
              ))}
            </div>
          )}

          {(hasBefore || hasDuring || hasAfter) && (
            <div className="space-y-1">
              {hasBefore &&
                advice.before.map((b, i) => (
                  <p key={i} className="text-xs text-emerald-800">
                    <span className="font-medium">Before:</span> {b}
                  </p>
                ))}
              {hasDuring &&
                advice.during.map((d, i) => (
                  <p key={i} className="text-xs text-emerald-800">
                    <span className="font-medium">During:</span> {d}
                  </p>
                ))}
              {hasAfter &&
                advice.after.map((a, i) => (
                  <p key={i} className="text-xs text-emerald-800">
                    <span className="font-medium">After:</span> {a}
                  </p>
                ))}
            </div>
          )}

          {hasHydration && (
            <div className="space-y-0.5">
              {advice.hydration.map((h, i) => (
                <p key={i} className="text-xs text-emerald-800">· {h}</p>
              ))}
            </div>
          )}

          {advice.timingNote && <p className="text-xs text-emerald-700 italic">{advice.timingNote}</p>}
        </div>
      )}

      {!hasEnergy && (
        <p className="text-[10px] text-emerald-600 italic">
          Add rest-day calorie target in Settings → Nutrition Profile for rough energy estimates.
        </p>
      )}
    </div>
  );
}
