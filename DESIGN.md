# Maxona — Design Sprint 1

## Mood

Calm premium athletic assistant. Personal and focused, not clinical.
Slightly ahead of its time, but never sci-fi. Trustworthy. Alive.

References (mood only, not brand): Oura calm, Whoop athletic, Linear precision, Apple Health readability.

---

## Colors

Page background: `#F8F8F7` — warm off-white, not pure white or gray.
Cards: `bg-white` over this surface so they read as elevated.
Borders: `border-zinc-100` — very subtle, not heavy.

### Semantic palette

| Signal       | Background    | Text           | Border         |
|--------------|---------------|----------------|----------------|
| Easy         | emerald-50    | emerald-700    | emerald-100    |
| Moderate     | amber-50      | amber-700      | amber-100      |
| Hard         | red-50        | red-700        | red-100        |
| Coach/AI     | indigo-50     | indigo-700     | indigo-100     |
| Nutrition    | emerald-50/60 | emerald-700    | emerald-100    |
| Recovery warn| amber-50      | amber-700      | amber-100      |
| Issue/injury | orange-50     | orange-700     | orange-200     |
| Strava       | orange accent | orange-500     | —              |
| Done         | —             | emerald-600    | —              |
| Upcoming     | —             | zinc-400       | —              |

### Intensity border accent (left edge on session cards)

- easy → `border-l-emerald-400`
- moderate → `border-l-amber-400`
- hard → `border-l-red-400`
- rest/other → `border-l-zinc-200`

---

## Surfaces / Cards

Standard card:
```
rounded-2xl bg-white border border-zinc-100 shadow-card
```

Inner block / sub-section:
```
rounded-xl bg-zinc-50 border border-zinc-100
```

Tinted info block (coach, nutrition, warnings):
```
rounded-xl bg-{color}-50 border border-{color}-100
```

Shadow token: `shadow-card` = `0 1px 4px 0 rgba(0,0,0,0.06)`.

Avoid:
- Heavy drop shadows
- Multiple nested cards
- Glassmorphism / heavy blur
- Random gradients

---

## Typography

| Role             | Size  | Weight    | Color      |
|------------------|-------|-----------|------------|
| Page title       | 26px  | bold      | zinc-900   |
| Section heading  | 10px  | semibold  | zinc-400   |
| Card heading     | 13px  | semibold  | zinc-800   |
| Body / session   | 13px  | medium    | zinc-700   |
| Secondary        | 12px  | regular   | zinc-500   |
| Meta / label     | 10px  | regular   | zinc-400   |
| Chip label       | 10px  | semibold  | varies     |

Section headings: `text-[10px] font-semibold uppercase tracking-widest text-zinc-400`

Anti-patterns:
- No `text-gray-*` — use `zinc-*` for neutrals
- No walls of same-size text
- No `text-[10px]` for anything actionable (min 12px for tap targets)

---

## Spacing / Rhythm

- Page padding: `px-4`
- Page top: `pt-6`
- Card padding: `p-4` (standard), `px-3 py-2.5` (compact)
- Section gap: `space-y-3`
- Inner card gap: `space-y-2`
- Chip/tag gap: `gap-1.5`

---

## Motion (motion/react)

```ts
import { motion } from "motion/react"
```

### Page entrance
```tsx
<motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}>
```

### Card/list stagger
```tsx
variants={{
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2 } }
}}
```

### Button hover/press
```tsx
whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
```

Rules:
- All durations ≤ 300ms
- Entrance: fade + small y offset (6px max)
- No bouncy spring on content cards
- Stagger delay: 0.05s–0.07s per item
- Never animate layout-shifting properties (height, width changes)
- Respect prefers-reduced-motion via `transition={{ duration: 0 }}` or CSS

---

## Motion & Liquid Glass Polish (Design Sprint 3)

### Glass surfaces — when and where

Use glass only on nav, hero headers, and selected context panels. Normal content cards stay `bg-white` — legibility over atmosphere.

Glass recipe:
```
rounded-2xl bg-white/70 backdrop-blur-sm border border-zinc-100/80 shadow-sm
```

Apply on desktop (`lg:`) only via responsive prefix — mobile stays plain.

### Ambient background

Static CSS radial gradients — no animation, no JS. Very low opacity (≤ 6%). Only indigo + emerald to match semantic palette. Applied via `.page-ambient` utility on Today and Week `<main>`.

### Motion rules

- Card hover/press: only on compact/actionable cards, never on full interactive surfaces
- Hover lift: `y: -1px` — barely perceptible
- Tap: `scale: 0.98` (compact cards), `scale: 0.995` (expanded)
- Nav active indicator: `layoutId` shared layout — slides between tabs
- All durations: hover/press 120–180ms, nav 200–250ms

### Duration table

| Trigger              | Duration    |
|----------------------|-------------|
| hover lift / press   | 150ms tween |
| compact card tap     | 150ms tween |
| nav active slide     | 220ms tween |
| card enter (stagger) | 220ms tween |
| page enter           | 280ms tween |

### Anti-patterns

- No `backdrop-blur` on content-heavy session cards
- No large blur values (`backdrop-blur-xl`) on anything except nav
- No bouncing springs (`type: "spring"` with visible overshoot)
- No infinite animations — even subtle ones
- No gradient on every surface — reserve for hero/ambient
- No animation that shifts layout (height, width, flex)
- Contrast must remain readable over any glass surface

### Skip action style

"Skip" is a destructive-adjacent secondary action. Style as muted text button:
- `text-xs text-zinc-400 hover:text-zinc-600 transition-colors`
- Never a filled button, never indigo
- Shows a `…` placeholder while pending (loading state)
- Disabled while request is in flight
- Does not appear for done or already-skipped sessions

---

## Bottom Nav

- Fixed bottom, `bg-white/95 backdrop-blur-sm`
- Active state: thin top-border line + full-opacity text
- Inactive: `text-zinc-400`
- Min tap target: 44px height
- No icons — label-only (clean, dense)

---

## Component Conventions (Today / Week)

### Today page
1. Hero header: day name large, date secondary, readiness pill if exists
2. DailyReadinessCard — always first content card
3. SessionCard(s) — primary content, accented left border
4. ImplicationBanner (if active) — amber tinted, inline
5. NutritionCard — secondary, tinted green
6. ManualSessionForm — last
7. ActiveIssues — bottom, orange border-left accent

### Week page
1. Plan header: "Week" title, replan button right
2. Focus summary if present — tinted block
3. Day rows: DOW label + date + "Today" chip if current
4. Past days: muted opacity, no border accent
5. Current day: slightly more prominent label
6. Session cards per day
7. DraftPreview at bottom

### Anti-patterns
- No `text-gray-*` — switch to `zinc-*`
- No plain `rounded border` — use `rounded-2xl` with explicit border color
- No hardcoded `bg-blue-50` for coach (use `bg-indigo-50`)
- No `text-blue-600` for primary actions — use `text-indigo-600`

---

## Session Card Result Visibility (Design Sprint 4)

### Skipped sessions
- Notes render exactly once — inside the skipped branch, not also above it
- Add a muted helper line "Skipped — not completed" below the notes
- Skipped status label appears in the card header; no redundant body text

### Completed sessions — inline results
- Compact metric pills (Dist / Time / Pace or Speed / Avg HR / Elev) appear at the top of the done card body, before check-in notes
- Pills use a `rounded-xl bg-zinc-50 border border-zinc-100` subpanel — glass-adjacent but readable
- Primary Strava activity drives the pill data; no additional fetching required
- CoachView / session detail page remains intact for full analytics
- `ExecutionSummaryBlock` stays below pills for detailed plan-vs-actual comparison
- `WorkoutFeedbackSection` stays below execution summary for AI coach narrative

### Capitalization
- `session.intensity` uses CSS `capitalize` (already done)
- `session.preferredSlot` wrapped in `<span className="capitalize">` — view layer only, data unchanged
- Sport labels in `ExecutionSummaryBlock` are normalized (Running / Cycling / Swimming / HYROX)

### Atmosphere gradient (Design Sprint 4)
- Gradient lives on `body` with `background-attachment: fixed`
- Always viewport-relative — never clipped by the page container or desktop nav
- `page-ambient` class kept as empty no-op for markup compatibility
- Both indigo and emerald blobs extend slightly outside the viewport (negative / >100% positions) so no hard edge is visible at the header

### Color language for result blocks
- All result/feedback sub-panels use `zinc-*` neutrals (not `gray-*`)
- `ExecutionSummaryBlock`: `bg-zinc-50 border-zinc-100`
- `WorkoutFeedbackSection`: `bg-zinc-50 border-zinc-100`
- Adherence label "Longer than planned" uses `text-indigo-600` (not blue)
- "Different sport" uses `text-purple-600`

---

## Responsive Dashboard Layout

Maxona is mobile-first. The desktop layout is an enhancement layer, not a redesign.

### Breakpoints

| Viewport  | Layout                        | Nav                    |
|-----------|-------------------------------|------------------------|
| Mobile    | Single column, current flow   | Bottom nav             |
| lg (1024+)| Two-column dashboard grid     | Top sticky nav, no bottom nav |
| xl (1280+)| Wider container (max-w-7xl)   | Same as lg             |

### Container

```
max-w-md            mobile (≤1024px)
max-w-6xl lg:px-6   desktop standard
max-w-7xl xl:px-8   wide desktop
```

### Content grid (lg+)

```
lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6 lg:items-start
```

- Left / main column: primary daily or weekly content
- Right / side rail: contextual secondary content (nutrition, issues, coach context)
- Side rail width: `360px` fixed — wide enough to read, narrow enough to not dominate

### Today — desktop composition

Main column: `DailyReadinessCard` → sessions → implication banner → `ManualSessionForm`
Side rail: `OnboardingCard` (new users) → `NutritionCard` → `ActiveIssues`

### Week — desktop composition

Main column: day-by-day weekly board (full session cards, `ManualSessionForm` per day)
Side rail: readiness banner → `ActiveIssues` → change explanation → weekly nutrition focus → draft preview

### Rules

- Mobile single column is always the source of truth — desktop grid is layered on top
- Items that appear in the desktop side rail are hidden with `lg:hidden` in the mobile main flow, and revealed in the `hidden lg:flex` side rail — no double rendering visible to users
- Hero headers stay full-width above the grid (no grid split at header level)
- Side rail is not sticky — natural scroll, no z-index complexity
- Desktop nav is sticky top-0 — stays visible while scrolling long pages
- Avoid enterprise density: keep card padding unchanged, don't cram more info per card
- Preserve the calm premium athletic mood at all viewport sizes
- No horizontal scrolling at any width
- Side rail items should feel like "coach's notes", not a busy dashboard widget panel

---

## Sprint 5 — Full App UI/UX Consolidation

### Core rule
Today and Week are the reference standard. Every other main page (Settings, Goals, Review, Session detail) must match the same visual language — glass cards, zinc palette, premium athletic typography, ambient gradient, responsive dashboard layout.

### Page rules
- **Settings / Goals / Review / Session detail**: not stretched mobile forms. Use `DashboardShell` grid or side rail on desktop.
- **Desktop**: use space intentionally — hero headers, cards, side rails, metric grids. Not one long vertical list.
- **Mobile**: single column, full-width, compact, usable.
- **Liquid/glass background**: body-level, `background-attachment: fixed`. No clipping at header, nav, or container edge.
- **Desktop nav**: `bg-white/80 backdrop-blur-md` — glass over the ambient gradient, not an opaque stripe.

### Content rules
- **Completed sessions**: `CompactMetricPills` always present for done + Strava sessions. Above check-in notes.
- **Nutrition guidance**: concrete meals with grams + approximate calories from AI. Cache-busted with `nutritionAdviceVersion` field in input hash.
- **Skipped sessions**: notes render once in the skipped branch. Main notes block is suppressed (`!isSkipped` guard already in place).
- **Focus summary (Week)**: render bullets as separate compact lines with `·` prefix — never join with `" · "`.
- **Capitalization**: intensity and slot labels use CSS `capitalize` — view layer only, stored data unchanged.
- **Adherence / quality labels**: use `text-indigo-600` (not blue). "Different sport" uses `text-purple-600`.

### Anti-patterns to avoid
- `text-gray-*` — always `text-zinc-*`
- `rounded border` without explicit color — use `rounded-2xl border border-zinc-100`
- `bg-gray-50` — use `bg-zinc-50`
- `bg-blue-50` / `text-blue-600` for coach notes — use `bg-indigo-50` / `text-indigo-600`
- Enterprise dashboard density — keep card padding, don't cram more per card
- Nested cards inside cards (one level of nesting max)
- Purple/pink/neon gradients or heavy colored borders
- Flat text hierarchy — use zinc shade variation (zinc-900 → zinc-700 → zinc-500 → zinc-400)
- Repeated identical white boxes with no visual hierarchy
- AI-slop patterns: every section a purple card, every insight a gradient pill

---

## Sprint 6 — Usability, Nav, and Settings Polish

### Nav
- Desktop nav: floating glass pill (`bg-white/60 backdrop-blur-md`) positioned in page flow (`py-3`), not a sticky bar. Active item gets `bg-white/80 shadow-sm` background; underline indicator sits inside the pill at `bottom-0.5`.
- Nav label: `/review` is labelled **"Review"** (not "Plan") — it shows current-week stats and the replan action.
- Bottom nav (mobile): same "Review" label.

### Hero headers
- Tighter: `pt-4 pb-3` outer + `py-3` desktop wrapper (was `pt-6 pb-4` / `py-4`).
- Day name and date on same baseline: `<h1>` + `<span>` in a flex row.
- Session count subtitle moved up, inline under the day name row.
- Readiness pill: `text-xs` (was `text-sm`), `px-2.5 py-1`.

### Replan button
- `rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100` — distinguishable from content cards, matches coach palette.

### Label capitalization
- `lib/format-labels.ts` — `formatIntensity`, `formatSlot`, `formatSportLabel` helpers.
- Replace all `capitalize` CSS on intensity/slot with these helpers. Stored values (lowercase) are untouched.

### Review page — column order
- Mobile: action card first, stats below (stats are secondary to the action).
- Desktop: action card in main column (left), stats in side rail (right).
- Session details collapsible on desktop side rail to keep it compact.

### Goals guidance card
- Collapsed by default (shows first 2 tips). "▼ more" / "▲ less" toggle. Reduces initial noise.

### Settings restructure
- Column order: Nutrition Profile in main column on desktop; Training Profile + Constraints + Advanced HYROX in side rail.
- Mobile order: Training Profile → Constraints → Nutrition → Advanced Scheduling → Advanced HYROX → Strava → Account.
- `CollapsibleSection` wrapper for Advanced Scheduling and Advanced HYROX — start collapsed, reduce cognitive load.
- HR zones grouped by zone with color-coded labels (emerald → amber → red) and a gradient strip visual.
- HYROX constraints compact: max/week + preferred days on same row.
- Helper copy at top: "Start with Training Profile + Nutrition. Advanced scheduling is optional."

---

## Sprint 7 — Strava + Settings Usability Rules

### Strava multi-activity aggregation
- Multiple Strava activities attached to one session must aggregate in display: combined distance, moving time, elevation; weighted-average HR; max HR = max of all.
- `CompactMetricPills` always aggregates all linked activities. A compact "N activities" badge appears when more than one is linked.
- `ExecutionSummaryBlock` already aggregates (passes all links to `deriveExecutionSummary`).

### Automatic stream fetch
- Stream fetch is triggered immediately after an activity is attached (fire-and-forget via `POST /api/strava/activities/[id]/streams`).
- Do NOT fetch streams on page render or during layout — only after explicit user attach action.
- Manual "Fetch HR stream" button (`AnalyzeStreamButton`) remains as fallback.
- If stream already exists, the route is a no-op (returns `status: "existing"`).

### Inline mini analytics
- When `session.hrAnalytics` exists, session cards (Today/Week) show a compact `MiniHrSparkline` — SVG line chart only, no zone bars, no stat grid.
- `SessionAnalytics` (full view with zones, stat cards, insights) is reserved for session detail pages.
- If stream is not available, the metric pills + `AnalyzeStreamButton` fallback are shown.

### Desktop nav
- Fixed position (`fixed top-0 left-0 right-0`), centered floating glass pill (`flex justify-center`).
- `pointer-events-none` on wrapper, `pointer-events-auto` on pill — gradient never clips.
- Layout container adds `lg:pt-14` to clear the fixed nav.

### Settings — what belongs where
- Helper line ("Start with Training Profile + Nutrition…") removed — visual hierarchy makes the order clear.
- Training Profile: primary inputs (Resting HR, Max HR, Threshold HR, Zone method) always visible. Advanced zone bounds (Easy min/max, Tempo min/max) collapsed unless values exist.
- Training Constraints: compact inline chip-style inputs for Running/Cycling defaults; HYROX section centered with day chips centered.
- Nutrition Profile: all long text fields use `<textarea>` with natural wrapping. No horizontal scrolling. Fields grouped: Routine · Training fueling · Foods that work · Energy estimate · Supplements & notes.
- Advanced Scheduling remains collapsed by default — does not dominate the Settings view.

### Capitalization
- View-layer only; stored values are lowercase and unchanged.

---

## Sprint 9 — Final Polish Rules

### Nutrition advice must be concrete enough to cook from
- Nutrition Today must show practical meal rows: Breakfast / Lunch / Dinner / Snack / Pre-workout / Post-workout.
- Each meal row includes a suggestion title, approximate grams per ingredient, and approximate kcal.
- `mealTiming` items render as: `{label} — {suggestion} (~{approxCalories} kcal)` followed by per-ingredient lines.
- If the AI call fails, `makeFallback(energy)` generates deterministic meals from the calorie target — never empty.
- Rest days without a nutrition profile (no calorie target) may show a simpler text-only summary.

### Nutrition cache version
- Bump `nutritionAdviceVersion` in `today/page.tsx` whenever the prompt or response schema changes.
- Current version: **4**. Increment to force all users to regenerate stale cache.
- Do NOT delete cache rows manually; the version bump makes them stale automatically.

### Settings numeric default cells — consistent alignment
- Running / Cycling / HYROX default chip cells all use the same left-aligned `flex flex-wrap gap-2` layout.
- No group should be `text-center` or `flex justify-center` while others are left-aligned.
- "Preferred days" label and day chips follow the same left-aligned flow as all other chip groups.
- Cell sizing: `px-2.5 py-1.5 rounded-xl border border-zinc-200 bg-zinc-50` — same for all groups.

### Strava inline analytics — stay compact
- Completed Strava-linked session cards show aggregated metric summary (CompactMetricPills).
- MiniHrSparkline appears only when `session.hrAnalytics` is populated — never fetched on render.
- No additional chart libraries. Compact SVG sparkline only.

---

## Sprint 8 — Settings Visual Consistency Rules

### Settings as a cockpit, not a spreadsheet
- Settings should feel like a calm setup surface — not a clinical data-entry form.
- Section headings follow the same ALL CAPS tracking-widest zinc-400 pattern used everywhere.
- Sub-section labels use `text-xs font-semibold text-zinc-500` — one step quieter.
- Save buttons sit at the bottom of their card with no additional decoration.

### HR profile — visual but calm
- Zone distribution is shown as a thin segmented effort track (5px height, rounded-full).
- Zones are labeled above the track (not inside colored boxes): Rest / Easy / Tempo / Thresh / Max.
- BPM anchor values (resting, threshold, max) appear below the track only when values are set.
- Enclosed in a subtle `bg-zinc-50/60 border border-zinc-100 rounded-xl` panel.
- No emoji, no heavy animation, no childish bar-chart look.
- Advanced manual zone bounds (Easy min/max, Tempo min/max) stay collapsed unless values exist.

### Numeric default cells — equal-size, quiet
- Running / Cycling / HYROX defaults use compact inline chip cells (`rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1.5`).
- Numeric values inside chips use `font-medium text-zinc-700` — not semibold, not zinc-800.
- All chip inputs share consistent width (`w-10` standard, `w-8` for single-digit counters).
- Unit labels use `text-[10px] text-zinc-400`.

### Nutrition fields
- Long text fields (meal pattern, goal, foods, snack tolerance, supplements) always use `<textarea>` — no horizontal scroll.
- Compact numeric/select fields (body weight, rest-day calories, calorie goal) use a 2-col grid + full-width select row.
- Checkboxes (stomach sensitive, caffeine sensitive) are on their own rows, not mixed into flex-wrap with inputs.

### Advanced fields — optional, not dominant
- Advanced Scheduling and Advanced HYROX defaults use `CollapsibleSection` — collapsed by default.
- Collapsible header: `text-xs font-semibold text-zinc-500` with a muted `▲/▼` toggle label.
- Content inside uses the same `rounded-xl bg-zinc-50 border border-zinc-100` card style as everywhere else.

### Palette rules (Settings)
- All neutrals: zinc-* (never gray-* or slate-*).
- Coach / AI elements: indigo-50 / indigo-600.
- Preferred planning type chip: `bg-indigo-50 text-indigo-600` (not blue).
- Strava accent: orange-500 (handled by StravaSettings component).
