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
  const l = word.toLowerCase().replace(/\s+ride$/, "");
  if (l === "hyrox") return "hyrox";
  if (["run", "runs", "running"].includes(l)) return "running";
  if (["cycling", "bike", "ride", "rides", "bicycle", "biking", "riding"].includes(l)) return "cycling";
  if (["swim", "swims", "swimming"].includes(l)) return "swimming";
  return null;
}

export function parseTrainingPreferences(text: string): ParsedPreferences {
  const lower = text.toLowerCase();

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

  const dedupedModalities: typeof modalityMentions = [];
  for (const mm of modalityMentions) {
    const overlap = dedupedModalities.some(
      (dm) => dm.modality === mm.modality && Math.abs(dm.index - mm.index) < 12
    );
    if (!overlap) dedupedModalities.push(mm);
  }

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
}> = {
  hyrox:    { notes: "HYROX group class: user-requested", durationMin: 75, intensity: "hard" },
  running:  { notes: "running: easy run",                  durationMin: 60, intensity: "easy" },
  cycling:  { notes: "cycling: easy ride",                 durationMin: 60, intensity: "easy" },
  swimming: { notes: "swimming: steady pace",              durationMin: 45, intensity: "easy" },
};

// Weekday → evening, weekend → morning (Issue 4)
function getDefaultSlotForDate(date: string): "morning" | "evening" {
  const dow = new Date(date + "T00:00:00Z").getUTCDay(); // 0=Sun, 6=Sat
  return dow === 0 || dow === 6 ? "morning" : "evening";
}

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

function isScheduleBlockedAllDay(date: string, scheduleEvents: ScheduleEvent[]): boolean {
  const dayStart = new Date(date + "T00:00:00.000Z");
  const dayEnd = new Date(date + "T23:59:59.999Z");
  return scheduleEvents.some(
    e => e.startsAt <= dayEnd && e.endsAt >= dayStart &&
      (e.kind === "blocked" || e.kind === "household")
  );
}

function pickSlot(
  date: string,
  usedSlots: string[],
  hintBlockedSlots: Set<string>,
  preferHint?: string
): PlannedSession["preferredSlot"] {
  const dayDefault = getDefaultSlotForDate(date);
  const ALL: PlannedSession["preferredSlot"][] = ["morning", "afternoon", "evening", "daytime"];

  // Try: hint → day default → any free slot
  const candidates = [
    preferHint as PlannedSession["preferredSlot"] | undefined,
    dayDefault as PlannedSession["preferredSlot"],
    ...ALL,
  ].filter((s): s is PlannedSession["preferredSlot"] => !!s);

  for (const slot of candidates) {
    if (!usedSlots.includes(slot) && !hintBlockedSlots.has(slot)) return slot;
  }
  return dayDefault as PlannedSession["preferredSlot"];
}

export function enforceExplicitPreferences(
  sessions: PlannedSession[],
  prefs: ParsedPreferences,
  weekStart: Date,
  scheduleEvents: ScheduleEvent[],
  blockedHardDates: string[],
  userConstraints: Record<string, unknown>
): { sessions: PlannedSession[]; unmetPreferences: string[] } {
  const hasWork =
    prefs.explicitDayRequests.length > 0 ||
    prefs.sacrificedModalities.length > 0 ||
    prefs.desiredModalities.length > 0 ||
    (prefs.availabilityHints?.length ?? 0) > 0;

  if (!hasWork) return { sessions, unmetPreferences: [] };

  const unmetPreferences: string[] = [];
  const blockedHardSet = new Set(blockedHardDates);
  const maxHyrox = (userConstraints.maxHyroxPerWeek as number | undefined) ?? 3;

  // Build day→date map for the week
  const dayToDate: Record<string, string> = {};
  for (const [dayName, offset] of Object.entries(DAY_OFFSET) as Array<[DayName, number]>) {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + offset);
    dayToDate[dayName] = toDateStr(d);
  }

  // Build per-day hint-blocked slots lookup
  const dayHintBlocked = new Map<string, Set<string>>();
  for (const hint of prefs.availabilityHints ?? []) {
    const date = dayToDate[hint.day];
    if (!date) continue;
    if (!dayHintBlocked.has(date)) dayHintBlocked.set(date, new Set());
    for (const slot of hint.blockedSlots) dayHintBlocked.get(date)!.add(slot);
  }

  let result = [...sessions];

  // ── Step 1: Remove sacrificed modalities (non-fixed sessions) ──────────────
  if (prefs.sacrificedModalities.length > 0) {
    const sacrificedSet = new Set(prefs.sacrificedModalities);
    result = result.filter(s => {
      if (s.planningType === "fixed") return true;
      const mod = getNotesModality(s.notes);
      return !mod || !sacrificedSet.has(mod);
    });
  }

  // Track which date|modality keys were satisfied via explicit day requests
  // so we don't remove them in the maxCount pass later
  const explicitDayKeys = new Set<string>();

  // ── Step 2: Enforce explicit day requests ─────────────────────────────────
  for (const req of prefs.explicitDayRequests) {
    const date = dayToDate[req.day as DayName];
    if (!date) continue;

    const reqModality = req.modality as Modality;
    if (!MODALITY_DEFAULTS[reqModality]) continue;

    // Already satisfied?
    if (result.some(s => toDateStr(s.scheduledDate) === date && getNotesModality(s.notes) === reqModality)) {
      explicitDayKeys.add(`${date}|${reqModality}`);
      continue;
    }

    // All-day schedule block?
    if (isScheduleBlockedAllDay(date, scheduleEvents)) {
      unmetPreferences.push(`${reqModality} on ${req.day} skipped — day is schedule-blocked`);
      continue;
    }

    // HYROX weekly cap
    if (reqModality === "hyrox") {
      const hyroxCount = result.filter(s => getNotesModality(s.notes) === "hyrox").length;
      if (hyroxCount >= maxHyrox) {
        unmetPreferences.push(`${reqModality} on ${req.day} skipped — weekly HYROX cap (${maxHyrox})`);
        continue;
      }
    }

    // Two-a-day cap: try removing a sacrificed session first
    const sameDaySessions = result.filter(s => toDateStr(s.scheduledDate) === date);
    if (sameDaySessions.length >= 2) {
      const sacrificeIdx = result.findIndex(
        s => toDateStr(s.scheduledDate) === date &&
          s.planningType !== "fixed" &&
          prefs.sacrificedModalities.includes(getNotesModality(s.notes) ?? "")
      );
      if (sacrificeIdx >= 0) {
        result.splice(sacrificeIdx, 1);
      } else {
        unmetPreferences.push(`${reqModality} on ${req.day} skipped — two-a-day conflict`);
        continue;
      }
    }

    const defaults = MODALITY_DEFAULTS[reqModality];
    const usedSlots = result.filter(s => toDateStr(s.scheduledDate) === date).map(s => s.preferredSlot);
    const hintBlocked = dayHintBlocked.get(date) ?? new Set<string>();

    const preferredSlot = pickSlot(date, usedSlots, hintBlocked, req.slotHint);

    let intensity: PlannedSession["intensity"] =
      (req.intensityHint as PlannedSession["intensity"] | undefined) ??
      (defaults.intensity as PlannedSession["intensity"]);

    if (intensity === "hard" && blockedHardSet.has(date)) intensity = "moderate";

    if (intensity === "hard") {
      const prevDay = toDateStr(new Date(new Date(date).setUTCDate(new Date(date).getUTCDate() - 1)));
      const nextDay = toDateStr(new Date(new Date(date).setUTCDate(new Date(date).getUTCDate() + 1)));
      const adjacentHard = result.some(
        s => (toDateStr(s.scheduledDate) === prevDay || toDateStr(s.scheduledDate) === nextDay) &&
          s.intensity === "hard"
      );
      if (adjacentHard) intensity = "moderate";
    }

    result.push({
      scheduledDate: new Date(date + "T00:00:00.000Z"),
      preferredSlot,
      planningType: "generated",
      durationMin: defaults.durationMin,
      intensity,
      notes: defaults.notes,
    });
    explicitDayKeys.add(`${date}|${reqModality}`);
  }

  // ── Step 3: Enforce desiredModalities minCount ────────────────────────────
  for (const desired of prefs.desiredModalities) {
    const mod = desired.modality as Modality;
    if (!MODALITY_DEFAULTS[mod]) continue;

    const currentCount = result.filter(s => getNotesModality(s.notes) === mod).length;
    const needed = desired.minCount - currentCount;
    if (needed <= 0) continue;

    // Candidate days: preferredDays first, then all week days in order
    const preferredDays = desired.preferredDays ?? [];
    const allWeekDays = Object.keys(DAY_OFFSET) as DayName[];
    // Weekend-first ordering for "easy ride" type requests
    const weekendFirst: DayName[] = ["saturday", "sunday", "monday", "tuesday", "thursday", "friday", "wednesday"];
    const candidateDays = [
      ...preferredDays.filter(d => VALID_DAY_NAMES.has(d)) as DayName[],
      ...weekendFirst,
      ...allWeekDays,
    ];

    let inserted = 0;
    const seenCandidates = new Set<string>();

    for (const day of candidateDays) {
      if (inserted >= needed) break;
      if (seenCandidates.has(day)) continue;
      seenCandidates.add(day);

      const date = dayToDate[day as DayName];
      if (!date) continue;

      // Skip if already has this modality
      if (result.some(s => toDateStr(s.scheduledDate) === date && getNotesModality(s.notes) === mod)) continue;

      // Skip if all-day schedule block
      if (isScheduleBlockedAllDay(date, scheduleEvents)) continue;

      // Skip if two-a-day
      if (result.filter(s => toDateStr(s.scheduledDate) === date).length >= 2) continue;

      const defaults = MODALITY_DEFAULTS[mod];
      const usedSlots = result.filter(s => toDateStr(s.scheduledDate) === date).map(s => s.preferredSlot);
      const hintBlocked = dayHintBlocked.get(date) ?? new Set<string>();

      const preferredSlot = pickSlot(date, usedSlots, hintBlocked, desired.preferredSlot);

      let intensity: PlannedSession["intensity"] =
        (desired.intensityHint as PlannedSession["intensity"] | undefined) ??
        (defaults.intensity as PlannedSession["intensity"]);
      if (intensity === "hard" && blockedHardSet.has(date)) intensity = "moderate";

      result.push({
        scheduledDate: new Date(date + "T00:00:00.000Z"),
        preferredSlot,
        planningType: "generated",
        durationMin: defaults.durationMin,
        intensity,
        notes: defaults.notes,
      });
      inserted++;
    }

    if (inserted < needed) {
      unmetPreferences.push(`Could not place all requested ${mod} sessions (needed ${needed}, placed ${inserted})`);
    }
  }

  // ── Step 4: Enforce desiredModalities maxCount ────────────────────────────
  for (const desired of prefs.desiredModalities) {
    if (!desired.maxCount) continue;
    const mod = desired.modality as Modality;

    const currentCount = result.filter(s => getNotesModality(s.notes) === mod).length;
    const excess = currentCount - desired.maxCount;
    if (excess <= 0) continue;

    // Remove excess: skip fixed sessions and explicitly-day-requested sessions
    let removed = 0;
    for (let i = result.length - 1; i >= 0 && removed < excess; i--) {
      const s = result[i];
      if (getNotesModality(s.notes) !== mod) continue;
      if (s.planningType === "fixed") continue;
      const key = `${toDateStr(s.scheduledDate)}|${mod}`;
      if (explicitDayKeys.has(key)) continue;
      result.splice(i, 1);
      removed++;
    }
  }

  if (process.env.NODE_ENV !== "production") {
    const summary = result.reduce((acc: Record<string, string[]>, s) => {
      const d = toDateStr(s.scheduledDate);
      if (!acc[d]) acc[d] = [];
      acc[d].push(`${getNotesModality(s.notes) ?? s.intensity}(${s.preferredSlot})`);
      return acc;
    }, {});
    console.log("[preference-enforcement] sessions:", JSON.stringify(summary));
    if (unmetPreferences.length > 0) console.log("[preference-enforcement] unmet:", unmetPreferences);
  }

  return { sessions: result, unmetPreferences };
}

const VALID_DAY_NAMES = new Set<string>(Object.keys(DAY_OFFSET));
