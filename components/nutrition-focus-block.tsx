"use client";
import { useAiInsight } from "@/lib/hooks/use-ai-insight";
import { AiGeneratingPlaceholder } from "@/components/ui/ai-generating-placeholder";
import { stripMarkdownBold } from "@/lib/format-bullets";
import type { WeeklyNutritionFocus } from "@/lib/ai/weekly-nutrition-focus";

export function NutritionFocusBlock({
  initialFocus,
  scopeKey,
}: {
  initialFocus: WeeklyNutritionFocus | null;
  scopeKey: string;
}) {
  const { data: focus } = useAiInsight<WeeklyNutritionFocus>({
    kind: "weekly-nutrition",
    scopeKey,
    initialData: initialFocus,
  });

  if (!focus || focus.bullets.length === 0) {
    return <AiGeneratingPlaceholder label="Weekly nutrition focus — generating…" tint="emerald" />;
  }

  return (
    <div className="rounded-2xl bg-emerald-50/70 border border-emerald-100 px-4 py-3 space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600">Weekly nutrition focus</p>
      <ul className="space-y-1">
        {focus.bullets.map((b, i) => (
          <li key={i} className="text-xs text-emerald-800">· {stripMarkdownBold(b)}</li>
        ))}
      </ul>
    </div>
  );
}
