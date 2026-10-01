---
SUPPLIED ASSET — reconstructed from project_search snippets, NOT a raw re-download.
Original project path: DESIGN.md (upload A, uploaded 2026-09-11T19:00:54Z, doc id adf0ee7a…)
The project's file tool resolves the filename "DESIGN.md" to upload B only (both files share
that exact name); this file's content could only be recovered via search-result fragments,
which are near-complete but may have small gaps versus the true original. Do not treat this
as byte-identical to the source — treat it as a faithful best-effort transcription.
Carried forward for DESKTOP GRID/NAV-RAIL ONLY per docs/20-decision-register.md D-01;
superseded by Doc B for color/typography/mobile.
---

name: Recruitment Quality Intelligence
colors:
  surface: '#f8f9ff'
  on-surface: '#0b1c30'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  secondary: '#565e74'
  secondary-container: '#dae2fd'
  tertiary: '#006243'
  tertiary-container: '#007d57'
  error: '#ba1a1a'
  error-container: '#ffdad6'
  background: '#f8f9ff'
  on-background: '#0b1c30'
typography:
  display-lg: { fontFamily: Inter, fontSize: 32px, fontWeight: '700', lineHeight: 40px, letterSpacing: -0.02em }
  headline-xl: { fontFamily: Inter, fontSize: 24px, fontWeight: '600', lineHeight: 32px, letterSpacing: -0.015em }
  headline-lg: { fontFamily: Inter, fontSize: 20px, fontWeight: '600', lineHeight: 28px, letterSpacing: -0.01em }
  headline-md: { fontFamily: Inter, fontSize: 16px, fontWeight: '600', lineHeight: 24px, letterSpacing: -0.005em }
  body-lg: { fontFamily: Inter, fontSize: 15px, fontWeight: '400', lineHeight: 22px }
  body-md: { fontFamily: Inter, fontSize: 14px, fontWeight: '400', lineHeight: 20px }
  body-sm: { fontFamily: Inter, fontSize: 13px, fontWeight: '400', lineHeight: 18px }
  label-md: { fontFamily: Inter, fontSize: 12px, fontWeight: '600', lineHeight: 16px, letterSpacing: 0.02em }
  label-sm: { fontFamily: Inter, fontSize: 11px, fontWeight: '600', lineHeight: 14px, letterSpacing: 0.03em }
  data-tabular-lg: { fontFamily: Inter, fontSize: 18px, fontWeight: '600', lineHeight: 24px }
  data-tabular-md: { fontFamily: Inter, fontSize: 14px, fontWeight: '500', lineHeight: 20px }
rounded: { sm: 0.125rem, DEFAULT: 0.25rem, md: 0.375rem, lg: 0.5rem, xl: 0.75rem, full: 9999px }
spacing: { gutter: 1rem, gutter-desktop: 1.5rem, margin: 1rem, margin-tablet: 1.5rem, margin-desktop: 2rem, space-xxs: 0.125rem, space-xs: 0.25rem, space-sm: 0.5rem, space-md: 0.75rem, space-lg: 1rem, space-xl: 1.5rem, space-2xl: 2rem }

## Brand & Style
Authoritative, institutional-grade "Corporate/Modern" foundation for executive recruitment leadership. Rejects decorative flourishes and playful micro-interactions in favor of executive legibility, analytical precision, rapid defensible decision-making.

## Colors
- App canvas `#F8FAFC`, card/surface `#FFFFFF`, muted/table-header surface `#F1F5F9`.
- Primary shell/nav base `#0F172A` deep navy (left rail/header); nav hover/drawer surface `#1E293B`.
- Primary interactive `#2563EB` cobalt (active `#1D4ED8`) — primary executable actions, active nav, selection.
- Semantic: verified `#059669`/`#10B981`; missing-info/review-required `#D97706`/`#F59E0B`; disqualified `#DC2626`/`#EF4444`. Structural borders `#E2E8F0`.

## Typography
Inter across all tiers. All scored/tabular values enforce `font-feature-settings: "tnum" 1, "cv05" 1` for vertical column alignment. Headers use negative tracking (-0.01 to -0.02em); micro-labels/chips use positive tracking (+0.02 to +0.03em). Candidate-evaluation paragraph measure capped at 68 characters/line.

## Layout & Spacing (operational high-density grid)
- Desktop (≥1280px): 12-column fluid grid, 1.5rem (24px) gutters, 2rem (32px) outer margin. Persistent 240px collapsible navigation rail.
- Tablet/split view (768–1279px): 8-column, 1rem gutters, 1.5rem margin; side-by-side comparison collapses to stacked sheets.
- Mobile (<768px): single-column, 1rem lateral margins.
- Spacing: 8pt rhythm with 4pt intermediate tokens; space-xs/sm (4/8px) for badge clusters and label-input pairs; space-lg (16px) for evidence panels/profile cards; space-xl/2xl (24/32px) for structural module boundaries.

## Elevation
L0 canvas `#F8FAFC`, flat. L1 structural cards/data grids: white, 1px `#E2E8F0` border, `0 1px 2px 0 rgba(15,23,42,.05)`. L2 interactive flyouts/hover cards: `#CBD5E1` border, `0 4px 6px -1px rgba(15,23,42,.08), 0 2px 4px -2px rgba(15,23,42,.04)`. L3 modal dialogs/command bars: `0 20px 25px -5px rgba(15,23,42,.12), 0 8px 10px -6px rgba(15,23,42,.06)`, 40%-opacity slate overlay `rgba(15,23,42,.4)`.

## Shapes
Uniform "Soft" roundedness. Containers/cards/panels: 4px. Form controls/action triggers: 4px. Status pills/metric chips: full radial rounding (exception, for clickable-metadata vs. static-panel distinction).

## Components (from search fragments)
### Buttons
Primary: solid `#2563EB`/white, 4px radius, inset highlight `inset 0 1px 0 rgba(255,255,255,.15)`, hover `#1D4ED8`, 2px offset focus ring `#2563EB`. Secondary/outline: white bg, 1px `#E2E8F0` border, `#0F172A` text, hover bg `#F8FAFC`/border `#CBD5E1`. Destructive: solid `#DC2626`/white, irreversible actions only.

### Badges
Pill shape, 22px height, 6px lateral padding, 11px semi-bold tabular type. Qualified: `#ECFDF5`/1px `#A7F3D0`/text `#065F46`, 6px emerald dot. Review-required: `#FFFBEB`/1px `#FDE68A`/text `#92400E`, 6px amber dot. Failed: `#FEF2F2`/1px `#FECACA`/text `#991B1B`, 8px crimson diagonal-slash icon.

### Form Inputs
36px height (dense desktop entry). White bg, 1px `#CBD5E1` border. Focus: border `#2563EB` + `0 0 0 1px #2563EB` outline ring. Placeholder `#94A3B8`. Error: border `#DC2626`, inline 12px/500 error label beneath.

### Evidence-First Dossier Cards
Header banner separated by `#E2E8F0` divider: role/regional scope + holistic verification health score. Body prioritizes verifiable facts (store count, P&L accountability, compliance indices, audit timestamps). Labels 11px muted caps `#64748B`; values 14px semi-bold tabular `#0F172A`.
