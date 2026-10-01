# Design system implementation

This documents how `docs/04-design-system.md` (the extracted Stitch design
system) was turned into code for Build Phase 1: `packages/config` (tokens +
Tailwind preset) and `packages/ui` (~30 reusable components).

## Token source and provenance

Every token in `packages/config/src/tokens.ts` carries an inline
provenance comment:

- **`[CONFIRMED]`** (implicit, unmarked) — taken directly from a DESIGN.md value.
- **`[Doc A]`** / **`[Doc B]`** — taken from one specific source document where the
  two disagreed or only one covered it.
- **`[DEFAULT]`** — no DESIGN.md source specified this value; a reasonable,
  accessible default was chosen and is listed here and in
  "Differences from Stitch" below.
- **`[FLAG]`** — a value that should be re-verified (e.g. against WCAG
  contrast ratios) before this leaves Build Phase 1.

### Why two source documents

The uploaded Stitch designs described two visually different products
under the same project (`docs/02-asset-inventory.md`, `docs/20-decision-register.md`
D-01):

- **Doc B — "Executive Quality Verification Console"**: Space Grotesk +
  Geist typography, emerald/cobalt/navy palette, mobile-first. This is
  also the only document with a directly-accessible confirmed screenshot
  (`reference/stitch/screens/confirmed-01-shortlist-verification-matrix-mobile.png`).
- **Doc A — "Recruitment Quality Intelligence"**: Inter typography,
  cobalt-primary palette, a 12-column desktop grid with a 240px nav rail.

Decision D-01 resolved this as a hybrid: **Doc B is primary** for color,
typography, and mobile layout (it has the confirmed visual reference); **Doc
A is used only** for the desktop grid and the 240px navigation rail width,
since Doc B did not specify a desktop layout. This is why
`layout.desktopNavRailWidth` is tagged `[Doc A]` while `colors.primary` is
untagged/`[CONFIRMED]` from Doc B.

### Known `[DEFAULT]` / `[FLAG]` values

| Token                    | Value     | Why                                                                                                                                                                                                                                                         |
| ------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `colors.navSurface`      | `#1E293B` | Doc B doesn't define a nav hover/active surface; carried from Doc A's equivalent.                                                                                                                                                                           |
| `colors.textPlaceholder` | `#94A3B8` | `[FLAG]` — should be re-checked against WCAG AA contrast on white before this ships past Build Phase 1.                                                                                                                                                     |
| `breakpoints.tablet`     | `768px`   | Doc B uses a 600px breakpoint, Doc A uses 768px; 768px was chosen as the more common Tailwind convention and re-tested visually (see "Visual verification" in `docs/build-phase-1-report.md`).                                                              |
| `layout.inputHeight`     | `44px`    | Doc B specifies 44px universally; Doc A specifies 36px but only for dense desktop tables. 44px (`inputHeight`) is the default everywhere; `inputHeightDense` (36px) is reserved for a future dense-table context, not yet used by any Build Phase 1 screen. |

Where a screenshot could not be directly observed for the majority of
approved screens (24 of 25 `screen.png` uploads resolve to the same
file due to a tool limitation — see `docs/02-asset-inventory.md` §2.3),
layout for those screens was composed from the design system tokens and
the one confirmed screenshot's patterns, not invented from scratch. See
"Differences from Stitch" in `docs/build-phase-1-report.md` for the full
list of screens built this way.

## Tailwind integration

`packages/config/src/tailwind-preset.ts` exports a Tailwind `Config`
partial that apps consume via the `presets` array
(`apps/web/tailwind.config.ts`). It maps every token above onto
`theme.extend.colors` / `.borderRadius` / `.fontFamily` / `.boxShadow` /
`.spacing`, and `theme.screens` onto the breakpoints. Dark mode is
deliberately **not configured** (`darkMode` left `undefined` with an inline
comment) — neither Stitch design includes a dark theme, and the Build
Phase 1 brief explicitly says not to add one without a source.

## Components (`packages/ui`)

Every component in `packages/ui/src/components/`:

- Has no business/domain logic — a `StatusBadge` takes `status: 'passed' |
'pending' | 'failed' | 'neutral'`, never a `GateResult` or `ReviewDecision`
  from `@rqi/types`. Domain-aware usage (mapping a `GateResult` to a
  `StatusBadge` status) lives in `apps/web`.
- Never conveys status by color alone — `StatusBadge` always pairs an icon
  with the text label.
- Enforces the 48px minimum touch target on every interactive control
  (`min-h-12` baked into `buttonVariants`).
- Exposes visible `focus-visible` rings (Radix components' own, or the
  `globals.css` fallback for plain elements).
- `AvatarInitials` renders a rounded-**square** monogram, never a circle
  and never a photograph — there is no candidate-photo concept anywhere in
  this codebase, matching the "AI must never invent candidate
  qualifications or evidence" principle extended to "never imply a
  candidate photo exists."

Components deliberately avoided duplicating shadcn/ui primitives that
already exist and fit (Dialog, Checkbox, RadioGroup, Select, Switch, Tabs
are thin wrappers around the equivalent Radix primitive, styled with the
token system) rather than being written from scratch.

## Responsive strategy

- **Mobile-first** base styles, with `lg:` (1280px, the desktop grid
  breakpoint) overrides for the desktop nav rail / two-column layouts.
- The **desktop nav rail** (`DesktopNavRail`, 240px, `hidden lg:flex`) and
  **mobile bottom nav** (`MobileBottomNav`, 56px + safe-area, `lg:hidden`)
  are mutually exclusive at the `lg` breakpoint — never both visible.
- Tables that would overflow on mobile are avoided in favor of card lists
  (`CandidatesPage`, `ProjectsPage`) or a horizontally-scrollable
  `DataTableShell` with a fixed minimum width (the scorecard requirements
  table) rather than letting the page itself overflow.
- `prefers-reduced-motion: reduce` disables all animation/transition
  durations globally (`globals.css`).

## Extending the component set

Adding a new primitive: put it in `packages/ui/src/components/`, export it
from `packages/ui/src/index.ts`, and — if it introduces new color/spacing
needs — add the token to `packages/config/src/tokens.ts` first rather than
hardcoding a value in the component. If a shadcn/ui component covers the
need, wrap it (see `overlay.tsx`/`form-controls.tsx` for the pattern)
rather than reimplementing it.
