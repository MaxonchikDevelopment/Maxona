import type { ScheduleEvent } from "@prisma/client";
import type { PlannedSession, ParsedPreferences } from "@/lib/ai/adapter";

type Modality = "hyrox" | "running" | "cycling" | "swimming";
type DayName = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

const DAY_OFFSET: Record<DayName, number> = {
  monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
  friday: 4, saturday: 5, sunday: 6,
};

const DAY_PATTERNS: Array<{ re: RegExp; day: DayName }> = [
  { re: /\bmonday\b/g, day: "monday" },
  { re: /\bmon\b/g, day: "monday" },
  { re: /\btuesday\b/g, day: "tuesday" },
  { re: /\btue\b/g, day: "tuesday" },
  { re: /\bwednesday\b/g, day: "wednesday" },
  { re: /\bwed\b/g, day: "wednesday" },
  { re: /\bthursday\b/g, day: "thursday" },
  { re: /\bthu\b/g, day: "thursday" },
  { re: /\bfriday\b/g, day: "friday" },
  { re: /\bfri\b/g, day: "friday" },
  { re: /\bsaturday\b/g, day: "saturday" },
  { re: /\bsat\b/g, day: "saturday" },
  { re: /\bsunday\b/g, day: "sunday" },
  { re: /\bsun\b/g, day: "sunday" },
];

const MODALITY_PATTERNS: Array<{ re: RegExp; modality: Modality }> = [
  { re: /\bhyrox\b/g, modality: "hyrox" },
  { re: /\brunning\b/g, modality: "running" },
  { re: /\bruns?\b/g, modality: "running" },
  { re: /\bcycling\b/g, modality: "cycling" },
  { re: /\bbike\b/g, modality: "cycling" },
  { re: /\bride\b/g, modality: "cycling" },
  { re: /\bswimming\b/g, modality: "swimming" },
  { re: /\bswims?\b/g, modality: "swimming" },
];

function normalizeModality(word: string): Modality | null {
  const l = word.toLowerCase().replace(/\s+ride$/, ""); // "bike ride" → "bike"
  if (l === "hyrox") return "hyrox";
  if (["run", "runs", "running"].includes(l)) return "running";
  if (["cycling", "bike", "ride", "rides", "bicycle", "biking", "riding"].includes(l)) return "cycling";
  if (["swim", "swims", "swimming"].includes(l)) return "swimming";
  return null;
}

export function parseTrainingPreferences(text: string): ParsedPreferences {
  const lower = text.toLowerCase();

  // ── Sacrifice patterns ───────────────────────────────────────────────────────
  const sacrificedModalities: string[] = [];
  const sacrificeREs = [
    /\b(hyrox|running|runs?|cycling|bike|ride|swimming|swims?)\s+can\s+be\s+sacrificed\b/g,
    /\bsacrifice\s+(?:the\s+)?(hyrox|running|runs?|cycling|bike|ride|swimming|swims?)\b/g,
    /\bskip\s+(?:the\s+)?(hyrox|running|runs?|cycling|bike|ride|swimming|swims?)\s+this\s+week\b/g,
  ];
  for (const re of sacrificeREs) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower)) !== null) {
      const mod = normalizeModality(m[1]);
      if (mod && !sacrificedModalities.includes(mod)) sacrificedModalities.push(mod);
    }
  }

  // ── Token positions ──────────────────────────────────────────────────────────
  const dayMentions: Array<{ index: number; day: DayName }> = [];
  const modalityMentions: Array<{ index: number; modality: Modality }> = [];

  for (const { re, day } of DAY_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower)) !== null) {
      dayMentions.push({ index: m.index, day });
    }
  }
  for (const { re, modality } of MODALITY_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower)) !== null) {
      modalityMentions.push({ index: m.index, modality });
    }
  }

  // Collapse "bike ride" and similar two-token matches into one
  const dedupedModalities: typeof modalityMentions = [];
  for (const mm of modalityMentions) {
    const overlap = dedupedModalities.some(
      (dm) => dm.modality === mm.modality && Math.abs(dm.index - mm.index) < 12
    );
    if (!overlap) dedupedModalities.push(mm);
  }

  // ── Associate days with modalities (proximity ≤ 80 chars) ───────────────────
  const explicitDayRequests: Array<{ day: string; modality: string }> = [];
  const seenKeys = new Set<string>();

  for (const mm of dedupedModalities) {
    for (const dm of dayMentions) {
      if (Math.abs(dm.index - mm.index) > 80) continue;
      const key = `${dm.day}|${mm.modality}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        explicitDayRequests.push({ day: dm.day, modality: mm.modality });
      }
    }
  }

  // ── Desired modalities ("at least one/two easy X") ───────────────────────────
  const desiredModalities: Array<{ modality: string; minCount: number; intensityHint?: string }> = [];
  const desireRe =
    /\bat\s+least\s+(one|two|three|a|an|1|2|3)\s+(?:(easy|light|moderate|hard)\s+)?(hyrox|run(?:ning)?|cycling|bike\s+ride|swim(?:ming)?)\b/g;
  desireRe.lastIndex = 0;
  let dm: RegExpExecArray | null;
  while ((dm = desireRe.exec(lower)) !== null) {
    const countWord = dm[1];
    const intensityWord = dm[2];
    const mod = normalizeModality(dm[3]);
    if (!mod) continue;
    const count = ["one", "a", "an", "1"].includes(countWord) ? 1
      : ["two", "2"].includes(countWord) ? 2 : 1;
    const intensity =
      intensityWord === "easy" || intensityWord === "light" ? "easy"
      : intensityWord === "moderate" ? "moderate"
      : intensityWord === "hard" ? "hard"
      : undefined;
    desiredModalities.push({ modality: mod, minCount: count, ...(intensity && { intensityHint: intensity }) });
  }

  return { explicitDayRequests, desiredModalities, sacrificedModalities };
}

// ── Enforcement ──────────────────────────────────────────────────────────────

const MODALITY_DEFAULTS: Record<Modality, {
  notes: string;
  durationMin: number;
  intensity: "easy" | "moderate" | "hard";
  preferredSlot: "morning" | "daytime" | "afternoon" | "evening";
}> = {
  hyrox:    { notes: "HYROX group class: user-requested", durationMin: 75, intensity: "hard",     preferredSlot: "evening" },
  running:  { notes: "running: easy run",                  durationMin: 60, intensity: "easy",     preferredSlot: "morning" },
  cycling:  { notes: "cycling: easy ride",                 durationMin: 60, intensity: "easy",     preferredSlot: "morning" },
  swimming: { notes: "swimming: steady pace",              durationMin: 45, intensity: "easy",     preferredSlot: "morning" },
};

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function getNotesModality(notes: string | null | undefined): Modality | null {
  const n = (notes ?? "").toLowerCase();
  if (n.includes("hyrox")) return "hyrox";
  if (n.startsWith("running")) return "running";
  if (n.startsWith("cycling")) return "cycling";
  if (n.startsWith("swimming")) return "swimming";
  return null;
}

export function enforceExplicitPreferences(
  sessions: PlannedSession[],
  prefs: ParsedPreferences,
  weekStart: Date,
  scheduleEvents: ScheduleEvent[],
  blockedHardDates: string[],
  userConstraints: Record<string, unknown>
): PlannedSession[] {
  if (prefs.explicitDayRequests.length === 0 && prefs.sacrificedModalities.length === 0) {
    return sessions;
  }

  let result = [...sessions];
  const blockedHardSet = new Set(blockedHardDates);
  const maxHyrox = (userConstraints.maxHyroxPerWeek as number | undefined) ?? 3;

  const dayToDate: Record<string, string> = {};
  for (const [dayName, offset] of Object.entries(DAY_OFFSET) as Array<[DayName, number]>) {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + offset);
    dayToDate[dayName] = toDateStr(d);
  }

  for (const req of prefs.explicitDayRequests) {
    const date = dayToDate[req.day];
    if (!date) continue;

    const reqModality = req.modality as Modality;
    if (!MODALITY_DEFAULTS[reqModality]) continue;

    // Already has this modality today?
    if (result.some((s) => toDateStr(s.scheduledDate) === date && getNotesModality(s.notes) === reqModality)) {
      continue;
    }

    // Hard-blocked by a schedule event (blocked or household kind)?
    const dayStart = new Date(date + "T00:00:00.000Z");
    const dayEnd = new Date(date + "T23:59:59.999Z");
    const isScheduleBlocked = scheduleEvents.some(
      (e) =>
        e.startsAt <= dayEnd &&
        e.endsAt >= dayStart &&
        (e.kind === "blocked" || e.kind === "household")
    );
    if (isScheduleBlocked) continue;

    // HYROX weekly cap
    if (reqModality === "hyrox") {
      const hyroxCount = result.filter((s) => getNotesModality(s.notes) === "hyrox").length;
      if (hyroxCount >= maxHyrox) continue;
    }

    // Two-a-day cap: if day already has 2 sessions, try removing one sacrificed session first
    const sameDaySessions = result.filter((s) => toDateStr(s.scheduledDate) === date);
    if (sameDaySessions.length >= 2) {
      const sacrificeIdx = result.findIndex(
        (s) =>
          toDateStr(s.scheduledDate) === date &&
          prefs.sacrificedModalities.includes(getNotesModality(s.notes) ?? "")
      );
      if (sacrificeIdx >= 0) {
        result.splice(sacrificeIdx, 1);
      } else {
        continue;
      }
    }

    const defaults = MODALITY_DEFAULTS[reqModality];
    let intensity: PlannedSession["intensity"] = defaults.intensity as PlannedSession["intensity"];

    // Downgrade if hard sessions are blocked on this date
    if (intensity === "hard" && blockedHardSet.has(date)) {
      intensity = "moderate";
    }

    // Avoid back-to-back hard sessions
    if (intensity === "hard") {
      const prevDay = toDateStr(new Date(new Date(date).setUTCDate(new Date(date).getUTCDate() - 1)));
      const nextDay = toDateStr(new Date(new Date(date).setUTCDate(new Date(date).getUTCDate() + 1)));
      const adjacentHard = result.some(
        (s) =>
          (toDateStr(s.scheduledDate) === prevDay || toDateStr(s.scheduledDate) === nextDay) &&
          s.intensity === "hard"
      );
      if (adjacentHard) intensity = "moderate";
    }

    // Avoid slot collision with an existing same-day session
    const usedSlots = result
      .filter((s) => toDateStr(s.scheduledDate) === date)
      .map((s) => s.preferredSlot);
    const allSlots: PlannedSession["preferredSlot"][] = ["morning", "afternoon", "evening", "daytime"];
    let preferredSlot: PlannedSession["preferredSlot"] =
      defaults.preferredSlot as PlannedSession["preferredSlot"];
    if (usedSlots.includes(preferredSlot)) {
      preferredSlot = allSlots.find((sl) => !usedSlots.includes(sl)) ?? preferredSlot;
    }

    result.push({
      scheduledDate: new Date(date + "T00:00:00.000Z"),
      preferredSlot,
      planningType: "generated",
      durationMin: defaults.durationMin,
      intensity,
      notes: defaults.notes,
    });
  }

  return result;
}
