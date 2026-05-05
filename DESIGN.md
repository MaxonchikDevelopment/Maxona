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
