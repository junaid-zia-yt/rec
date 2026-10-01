---
SUPPLIED ASSET — verbatim, re-downloaded from the project on Build Phase 1 start.
Original project path: DESIGN.md (upload B, uploaded 2026-09-11T19:01:14Z)
This is the file the project's tooling resolves "DESIGN.md" to by default.
Treated as PRIMARY for mobile layout/components/typography per docs/20-decision-register.md D-01.
---

name: Executive Quality Verification Console
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#3d4a42'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#6d7a72'
  outline-variant: '#bccac0'
  surface-tint: '#006c4a'
  primary: '#006948'
  on-primary: '#ffffff'
  primary-container: '#00855d'
  on-primary-container: '#f5fff7'
  inverse-primary: '#68dba9'
  secondary: '#0051d5'
  on-secondary: '#ffffff'
  secondary-container: '#316bf3'
  on-secondary-container: '#fefcff'
  tertiary: '#545c72'
  on-tertiary: '#ffffff'
  tertiary-container: '#6c748b'
  on-tertiary-container: '#fefcff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#85f8c4'
  primary-fixed-dim: '#68dba9'
  on-primary-fixed: '#002114'
  on-primary-fixed-variant: '#005137'
  secondary-fixed: '#dbe1ff'
  secondary-fixed-dim: '#b4c5ff'
  on-secondary-fixed: '#00174b'
  on-secondary-fixed-variant: '#003ea8'
  tertiary-fixed: '#dae2fd'
  tertiary-fixed-dim: '#bec6e0'
  on-tertiary-fixed: '#131b2e'
  on-tertiary-fixed-variant: '#3f465c'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-xl: { fontFamily: Space Grotesk, fontSize: 32px, fontWeight: '700', lineHeight: 40px, letterSpacing: -0.03em }
  headline-lg: { fontFamily: Space Grotesk, fontSize: 26px, fontWeight: '700', lineHeight: 34px, letterSpacing: -0.025em }
  headline-lg-mobile: { fontFamily: Space Grotesk, fontSize: 22px, fontWeight: '700', lineHeight: 28px, letterSpacing: -0.02em }
  headline-md: { fontFamily: Space Grotesk, fontSize: 18px, fontWeight: '600', lineHeight: 24px, letterSpacing: -0.015em }
  headline-sm: { fontFamily: Space Grotesk, fontSize: 15px, fontWeight: '600', lineHeight: 20px, letterSpacing: -0.01em }
  body-lg: { fontFamily: Geist, fontSize: 16px, fontWeight: '400', lineHeight: 24px, letterSpacing: -0.01em }
  body-md: { fontFamily: Geist, fontSize: 14px, fontWeight: '400', lineHeight: 20px, letterSpacing: -0.005em }
  body-sm: { fontFamily: Geist, fontSize: 13px, fontWeight: '400', lineHeight: 18px, letterSpacing: 0em }
  label-md: { fontFamily: Geist, fontSize: 12px, fontWeight: '500', lineHeight: 16px, letterSpacing: 0.02em }
  label-sm: { fontFamily: Geist, fontSize: 11px, fontWeight: '600', lineHeight: 14px, letterSpacing: 0.04em }
  metric-display: { fontFamily: Space Grotesk, fontSize: 28px, fontWeight: '700', lineHeight: 32px, letterSpacing: -0.04em }
  metric-sm: { fontFamily: Space Grotesk, fontSize: 16px, fontWeight: '600', lineHeight: 20px, letterSpacing: -0.02em }
rounded: { sm: 0.125rem, DEFAULT: 0.25rem, md: 0.375rem, lg: 0.5rem, xl: 0.75rem, full: 9999px }
spacing: { gutter: 0.75rem, margin: 1rem, space-xs: 0.25rem, space-sm: 0.5rem, space-md: 0.75rem, space-lg: 1rem, space-xl: 1.5rem }

## Brand & Style
High-trust, evidence-based quality control console for executive search across retail, convenience store, and food service multi-unit leadership. Functions like an audit-grade verification terminal, not an algorithmic job board.
1. Quality before quantity — dense, highly filtered candidate intelligence over scrolling feeds.
2. Evidence before scoring — numbers/rankings always tethered to gate verifications and verifiable histories.
3. Human approval before submission — sign-offs, dossier submissions, disqualifications require explicit human intent via sticky verification action sheets.

## Colors
- Primary (`#059669` Emerald, fill `#10B981`, container `#ECFDF5`): verified truth, passed mandatory criteria, signed-off approvals.
- Secondary (`#2563EB` Cobalt, active `#1D4ED8`): interaction points, selection, active tabs, navigation.
- Tertiary (`#0F172A` Deep Navy): executive headings, top nav chrome, dividers.
- Surface: `#FFFFFF` base, `#F8FAFC` structural paneling, `#F1F5F9` nested cards.
- Pending/Risk: text `#D97706` on `#FEF3C7`, border `#FDE68A`.
- Failed mandatory: text `#DC2626` on `#FEF2F2`, border `#FECACA`.
- Outlines: `#E2E8F0` inner cells, `#CBD5E1` perimeters.

## Typography
Space Grotesk (display/numeric, subtle monospaced construction for scores) + Geist (body/reading, 13–14px compact).

## Layout & Spacing
4px base increment. Mobile (<600px): 4-column, 1rem margins, 0.75rem gutters, single-card stacks, sticky bottom overlays, horizontal-scrolling criterion rails. Tablet (600–1024px): 8-column, 1.5rem margins, 35/65 split-pane (list/detail). 48px min interactive height; 80px clearance above bottom nav for sticky approval bars.

## Elevation
L0 canvas flat `#F8FAFC`. L1 card: white, 1px `#E2E8F0` border, `0 1px 2px 0 rgba(15,23,42,.04)`. L2 app bar/rail: `0 4px 6px -1px rgba(15,23,42,.06)`. L3 sticky sheet/modal: `0 -4px 12px -2px rgba(15,23,42,.08)`, 1px `#CBD5E1` top border.

## Shapes
Cards/containers 8px radius. Badges/pills/tags 4px radius, 1px borders. Avatars: 6px rounded squares, never circular. Buttons/inputs 6px radius.

## Components
### Top Navigation App Bar
Deep Navy `#0F172A` or white with `#E2E8F0` hairline. Left: project breadcrumb + status badge. Right: notification bell (amber dot) + 36×36px monogram tile (navy container, white uppercase Geist text).

### Native Bottom Navigation Bar
5 destinations: Home, Projects, Candidates, Shortlists, More. Height 56px + safe area. White bg, `#E2E8F0` top border. Inactive: slate `#64748B`, 11px uppercase. Active: Cobalt `#2563EB`, 2px top indicator.

### Buttons
Min touch target 48×48px. Primary (Sign-Off/Proceed): solid `#2563EB`/white, active `#1D4ED8`. Verification/Pass: solid `#059669`. Destructive: outlined `#DC2626` on white, `#FEF2F2` active fill. Secondary: `#CBD5E1` border, `#0F172A` text, white fill.

### Verification Chips & Gate Badges
Passed: `#ECFDF5`/`#059669`/border `#A7F3D0`, checkmark icon. Pending: `#FEF3C7`/`#D97706`/border `#FDE68A`. Failed: `#FEF2F2`/`#DC2626`/border `#FECACA`.

### Candidate Dossier Cards
White, 1px `#E2E8F0` border, 8px radius. Header: monogram avatar + Space Grotesk name/scale line + overall rating badge (top-right). Body: grid of mandatory-gate status rows, green/red markers. Footer: verification timestamp + last human sign-off.

### Sticky Approval Bottom Sheets
Fixed above bottom nav. Secondary "Request Audit Evidence" + primary full-width "Sign-Off to Client Dossier." `#CBD5E1` top border.

### Inputs
Height 44px. White bg, `#CBD5E1` 1px border. Focus: 2px solid `#2563EB`, no outer halo. Typed values in Geist; threshold values right-aligned in Space Grotesk label style.
