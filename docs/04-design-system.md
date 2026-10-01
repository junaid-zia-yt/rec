# 04 — Design System Extraction

Source: both `DESIGN.md` uploads (see conflict in [[02-asset-inventory]] §2.2) plus the one confirmed screenshot. Values below are **[CONFIRMED]** where a `DESIGN.md` states them explicitly; anything not stated is marked **[UNDETERMINED]**.

## 4.1 Recommended Resolution

Per [[02-asset-inventory]] §2.2, this document treats **Doc B ("Executive Quality Verification Console")** as the primary source, since its component set (dossier cards, gate badges, sticky approval sheets) maps directly onto the mandatory-gate/evidence/approval workflow, and it specifies mobile behavior explicitly, matching the one confirmed screenshot. Doc A's 12-column desktop grid and 240px nav rail are carried forward for **desktop layout only**, since Doc B does not specify a desktop grid. **[CLIENT CONFIRM before Phase 3.]**

## 4.2 Color Palette (Doc B, primary)

| Token                   | Hex                                                      | Use                                           |
| ----------------------- | -------------------------------------------------------- | --------------------------------------------- |
| Primary / Verified      | `#059669` (fill `#10B981`, container `#ECFDF5`)          | Passed gates, sign-offs, certified milestones |
| Secondary / Interactive | `#2563EB` (active `#1D4ED8`)                             | Buttons, links, selection, active tab         |
| Tertiary / Structural   | `#0F172A`                                                | Headings, top nav chrome, dividers            |
| Surface                 | `#FFFFFF` base, `#F8FAFC` canvas, `#F1F5F9` nested cards | Backgrounds                                   |
| Warning / Pending       | text `#D97706`, bg `#FEF3C7`, border `#FDE68A`           | Pending verification, review-required         |
| Error / Failed          | text `#DC2626`, bg `#FEF2F2`, border `#FECACA`           | Mandatory-requirement failure                 |
| Outline                 | `#E2E8F0` (cells), `#CBD5E1` (perimeter)                 | Hairline borders                              |

Doc A uses a materially different assignment (`#004ac6`/`#2563eb` as primary, emerald demoted to tertiary) — **[UNDETERMINED]** which is canonical; see conflict above. Semantic meaning (green=pass, amber=pending, red=fail) is consistent across both docs and is safe to adopt regardless of resolution.

## 4.3 Typography

**Doc B (primary):** Space Grotesk for headlines/metrics (700/600 weight, tight negative tracking −0.01 to −0.03em), Geist for body/labels (13–16px). A dedicated `metric-display` style (28px/700) exists specifically for match-score numerals.
**Doc A (desktop alt):** Inter across all tiers with `tnum`/`cv05` tabular-figure features enforced on every scored value — this feature flag is worth keeping regardless of which family wins, since vertical alignment of percentage columns is explicitly called out as a requirement in both docs.
**[RECOMMENDATION]** Adopt Space Grotesk + Geist (Doc B) but keep Doc A's tabular-number CSS feature settings applied to Geist for score/metric columns.

## 4.4 Type Hierarchy

`headline-xl` 32/40 → `headline-lg` 26/34 (22/28 mobile) → `headline-md` 18/24 → `headline-sm` 15/20 → `body-lg` 16/24 → `body-md` 14/20 → `body-sm` 13/18 → `label-md` 12/16 → `label-sm` 11/14 uppercase-tracked → `metric-display` 28/32 / `metric-sm` 16/20.

## 4.5 Spacing

4px base rhythm: `space-xs` 4px, `space-sm` 8px, `space-md` 12px, `space-lg` 16px, `space-xl` 24px. Outer canvas margin 16px mobile (1rem), gutter 12px (0.75rem). Desktop (Doc A): 24px gutter, 32px outer margin, 240px nav rail.

## 4.6 Border Radius

Cards/containers 8px (`rounded-md`); badges/pills/tags 4px (`rounded-sm`); avatars 6px **rounded squares — never circular** (explicit, both docs agree conceptually that avatars carry an "executive dossier" identity rather than a consumer look); inputs/buttons 6px.

## 4.7 Shadows / Elevation

Flat, hairline-bordered, near-zero blur — deliberately _not_ a consumer "floating card" look:

- L0 canvas: flat, no shadow.
- L1 card: `0 1px 2px 0 rgba(15,23,42,.04)` + 1px `#E2E8F0` border.
- L2 app bar / floating rail: `0 4px 6px -1px rgba(15,23,42,.06)`.
- L3 sticky approval sheet / modal: `0 -4px 12px -2px rgba(15,23,42,.08)` with a 1px `#CBD5E1` top border (bottom sheets) or a 40%-opacity navy scrim (modals, per Doc A).

## 4.8 Icons

**[UNDETERMINED]** — no icon set is named in either file. The one confirmed screenshot shows simple line icons (checklist, badge, briefcase, location pin, wallet, scale) at roughly 16–20px alongside section headers. **[RECOMMENDATION]** Lucide (MIT-licensed, ships as a shadcn/ui default) as a close visual match, pending client sign-off.

## 4.9 Buttons

Primary (`Sign-Off / Proceed`): solid `#2563EB`, white text, active `#1D4ED8`. Verification/pass action: solid `#059669`. Destructive (`Disqualify`): outlined `#DC2626` on white, `#FEF2F2` active fill. Secondary: `#CBD5E1` border, `#0F172A` text, white fill. Minimum touch target 48×48px regardless of visual size (mobile).

## 4.10 Form Inputs

44px height (Doc B) / 36px (Doc A, desktop-density) — **[UNDETERMINED]**, recommend 44px universal for touch-target consistency, 36px only in dense desktop tables. White background, `#CBD5E1` 1px border, 2px `#2563EB` focus ring with **no** outer blur halo. Typed values in Geist; threshold/requirement values right-aligned in Space Grotesk label style — this pairing is a deliberate way of visually distinguishing "what the candidate has" from "what the role requires," and should be treated as a component contract, not a stylistic accident.

## 4.11 Cards

**Candidate Dossier Card:** white, 1px `#E2E8F0` border, 8px radius; header = monogram avatar + Space Grotesk name/scale line + top-right overall rating badge; body = grid of mandatory-gate status rows with green/red markers; footer = verification timestamp + last human sign-off. This card is the single most load-bearing component in the system — it is the visual unit that must, by construction, make a failed mandatory gate impossible to miss (Core Principle #4/#5).

## 4.12 Tables

**[UNDETERMINED]** — no literal data-table spec beyond "tabular clarity" and Doc A's `#F1F5F9` header row convention with tabular-figure alignment for numeric columns. Recommend shadcn/ui `Table` primitive with Doc A's header/row tokens layered on top.

## 4.13 Dialogs / Modals

Doc A: L3 elevation, `0 20px 25px -5px rgba(15,23,42,.12)`, 40%-opacity navy scrim, used for "vetting confirmation," "candidate rejection documentation," "executive approval prompts" — i.e., modals are reserved for actions that need a documented reason, consistent with the audit-trail requirement.

## 4.14 Status Labels / Chips

Passed: `#ECFDF5` / `#059669` / border `#A7F3D0`, checkmark icon. Pending: `#FEF3C7` / `#D97706` / border `#FDE68A`. Failed: `#FEF2F2` / `#DC2626` / border `#FECACA`. Pill radius: full (`rounded-full`) — the one explicit exception to the 4–8px radius rule, used specifically to separate "static structural panel" from "dynamic clickable metadata," per Doc A.

## 4.15 Navigation

Mobile: 56px bottom bar + safe-area inset, 5 fixed destinations (Home/Projects/Candidates/Shortlists/More), active item cobalt with 2px top indicator. Desktop (Doc A): 240px collapsible left rail, deep-navy `#0F172A`/`#1E293B`.

## 4.16 Responsive Breakpoints

Mobile <600px (Doc B) / <768px (Doc A) — **[UNDETERMINED — minor conflict]**, recommend 768px as the mobile/tablet break to match Tailwind's default `md`. Tablet 600–1024px (Doc B, 8-col, 35/65 split) or 768–1279px (Doc A, 8-col). Desktop ≥1280px (Doc A, 12-col, 240px rail).

## 4.17 Desktop vs. Mobile Behavior

Desktop favors dense split-pane comparison (list + detail); mobile favors stacked single-column cards with sticky bottom actions and horizontal-scrolling criterion rails. Both patterns are visible in the docs; only the mobile pattern is visually confirmed (§2.3.1 of [[02-asset-inventory]]).

## 4.18 Accessibility Concerns **[GAP — not addressed in either DESIGN.md]**

- No stated contrast ratios; `#94A3B8` placeholder text on white and `#64748B` inactive nav labels should be checked against WCAG AA before build (both are borderline at small sizes).
- No stated focus-order or screen-reader guidance for the dense multi-column comparison grid (screen 18) — this is the highest-risk screen for a11y given its data density; needs a dedicated pass (see [[16-testing-strategy]]).
- Full color-only status signaling (chip color) should be paired with the icon/text label already present in the mock (checkmark, "⚠") to stay non-color-dependent — the current design already does this, which is good practice; preserve it in code.

## 4.19 Tokenization Recommendation

Ship the resolved palette/type/spacing/radius values as a single Tailwind theme extension (`tailwind.config.ts`) plus CSS custom properties for anything shadcn/ui components consume at runtime, so a future rebrand only touches one file. Build the candidate dossier card, gate badge, and sticky approval sheet as the first three shared components — every other screen composes from them.

Related documents: [[02-asset-inventory]] · [[03-screen-inventory]] · [[16-testing-strategy]] · [[18-blocking-questions]]
