# 02 — Existing Asset Inventory

## 2.1 Summary Table

| #    | File                                       | Type                         | Purpose                                                                                                                                                                         | Reusable?                                | Complete?                             | Conflicts?                                                 | Risks                                                                                   | Target Location                                           |
| ---- | ------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1    | `MOM_Recruitment_Discovery_Call.docx`      | Document                     | Discovery-call minutes; defines business need, POC terms, risks                                                                                                                 | Yes — source of truth for requirements   | Yes, as a meeting record (not a spec) | No                                                         | Contains no numeric success criteria (see §2.4) — must not be over-read as a formal SOW | `docs/source/` (reference only, not shipped)              |
| 2    | `DESIGN.md` (upload A, doc id `adf0ee7a…`) | Design tokens (YAML + prose) | "Recruitment Quality Intelligence" design system — Inter typeface, Corporate/Modern, `#2563EB` cobalt / `#059669` emerald / `#0F172A` navy, 12-col desktop grid, 240px nav rail | Partially — tokens are directly reusable | Yes, internally complete              | **Yes — conflicts with asset #3**                          | See §2.2                                                                                | `design-system/tokens.json` (pending conflict resolution) |
| 3    | `DESIGN.md` (upload B, doc id `3283f4ad…`) | Design tokens (YAML + prose) | "Executive Quality Verification Console" — Space Grotesk/Geist, mobile-first 4-col grid, same semantic colors but different primary/tertiary role assignment                    | Partially — tokens are directly reusable | Yes, internally complete              | **Yes — conflicts with asset #2**                          | See §2.2                                                                                | `design-system/tokens.json` (pending conflict resolution) |
| 4–28 | `screen.png` × 25                          | Image (Stitch export)        | Desktop + mobile UI screens for the platform                                                                                                                                    | Yes, as visual reference                 | Unknown per-file — see §2.3           | Unknown — cannot be checked file-to-file (tool limitation) | See §2.3 (technical blocker)                                                            | `design-reference/screens/`                               |

## 2.2 Conflict: Two Competing Design Systems

Both files are literally named `DESIGN.md` and were uploaded four minutes apart on 2026-09-11. They are **not versions of one file** — they are two structurally different design systems that happen to share a semantic color grammar (green = verified/passed, amber = pending/review, red = failed/disqualified, slate-navy = structural chrome). Beyond that, they diverge:

| Dimension      | Doc A — "Recruitment Quality Intelligence"         | Doc B — "Executive Quality Verification Console"                          |
| -------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| Typeface       | Inter (single family, all tiers)                   | Space Grotesk (display/numeric) + Geist (body)                            |
| Primary color  | `#004ac6` / `#2563eb` cobalt                       | `#006948` emerald (primary), cobalt demoted to secondary                  |
| Grid (desktop) | 12-column, 24px gutter, 240px collapsible nav rail | Not desktop-first; tablet split-pane 35/65                                |
| Grid (mobile)  | Not the stated focus                               | 4-column, 1rem margin, mobile-first                                       |
| Corner radius  | 4px uniform (cards, inputs, controls)              | 8px cards / 4px badges / 6px avatars (mixed)                              |
| Avatars        | Not specified                                      | Rounded-square monograms, explicitly never circular                       |
| Bottom nav     | Not specified (rail-based, desktop-oriented)       | 5-item fixed bottom bar: Home / Projects / Candidates / Shortlists / More |

**[TECHNICAL BLOCKER]** These cannot both be "the" design system. Building against the wrong one means redoing every styled component later. **[CLIENT CONFIRM — blocks Phase 3]**: which file is authoritative, or were these two different Stitch generations (e.g., an earlier desktop-oriented pass and a later mobile-verification pass) that should be _merged_, with Doc B's mobile/bottom-nav/console patterns governing mobile and Doc A's desktop grid governing desktop? Our default recommendation if no answer arrives before Phase 3 starts: **treat Doc B ("Executive Quality Verification Console") as authoritative**, because (a) it is the more recently uploaded of the two, (b) its component inventory (candidate dossier cards, verification chips, sticky approval sheets) maps directly onto the platform's mandatory-gate and human-approval workflows named in the project instructions, and (c) it explicitly specifies both mobile and tablet behavior, which Doc A does not. This is a **[RECOMMENDATION]**, not a decision — flag it back to the client before any component is built. See [[04-design-system]] and [[18-blocking-questions]] (Q-P0-02).

## 2.3 The 25 Screenshots — Access Limitation (Technical Blocker)

**[TECHNICAL BLOCKER]** All 25 image files were uploaded under the identical filename `screen.png`. The project file-access tool available to this analysis resolves a lookup by filename, and with 25 identically-named files it deterministically returns only the **first-uploaded** file (timestamp `2026-09-11T18:54:38Z`) no matter how many times it is queried; the other 24 files' bytes are not reachable through this tool. A `project_search` pass confirms the other 24 exist as distinct file records (distinct internal document IDs surfaced by search), but search does not return image content, and those IDs do not resolve directly to a viewable file — so it is not possible from this session to inspect them individually.

**What this means concretely:**

- [[03-screen-inventory]] is built from **one directly-observed screenshot** (a mobile "Shortlist / Verification Matrix — Finalist Comparison" screen — see §2.3.1) plus **inference** from (a) the component vocabulary described in both `DESIGN.md` files, (b) the 28 named product workflows in the project instructions, and (c) the MOM's description of the current manual process. Every screen in that inventory is labeled with its evidence class.
- We are **not** silently ignoring the other 24 files — this section is that disclosure, as the analysis brief requires.
- **[CLIENT CONFIRM — blocks Phase 3 and any pixel-accurate rebuild]**: please re-upload the 24 remaining screens with distinct filenames (e.g. `01-dashboard.png`, `02-scorecard.png`, …), ideally grouped by desktop/mobile and by workflow step. Until then, Phase 3 (Stitch design-system implementation) can proceed against the tokens and the one confirmed screen, but full screen-by-screen fidelity cannot be certified.

### 2.3.1 Confirmed Screen: "Shortlist — Verification Matrix / Finalist Comparison" (mobile)

Directly observed. Key elements, for use by [[03-screen-inventory]] and [[04-design-system]]:

- Top app bar: title "Quality Intelligence" + subtitle "Shortlists · Active Verification," a notification bell with numeric badge, and an avatar tile.
- Section header "VERIFICATION MATRIX" with a "3 Finalists" pill and headline "Evaluating 3 Top Finalists for Regional Operations Manager."
- Three ranked candidate summary tiles side by side, each with a rounded-square monogram avatar, overall score badge (96% / 94% / 92%), name, and rank.
- Stacked comparison cards, each a labeled section (icon + title + a small qualifier chip), containing 3-column data grids:
  - "Overall Match & Gates" — score, "X/5 Passed," "% Evidence."
  - "Leadership Scope" (req threshold shown as a chip) — site count, headcount (FTEs), P&L volume, each with a descriptor label like "Highest Span"/"Target met"/"Balanced."
  - "Experience & Domain" — years + domain descriptor + short free-text note (truncated with ellipsis).
  - "Location & Commute" — city, distance, drive time, HQ chip.
  - "Comp & Availability" — target salary chip, dollar figures per candidate with a colored pill (e.g. "Exact fit" green, "3-wk notice" green, "1-mo notice" neutral).
  - "Strengths & Operational Risks" — per-candidate bullet list with a "+" (strength, green) and a "⚠" (risk, amber/red) line, in prose.
- Sticky bottom bar: "Final Stage Calibration" label + "Quality Audit Ready" lock icon on the left, full-width primary button "Continue to Shortlist (3 Selected)" below it.
- Bottom tab bar: Home / Projects / Candidates / Shortlists (active) / More — five items, consistent with Doc B's spec.

This single screen already evidences several product requirements directly: mandatory-gate pass counts shown per candidate (not hidden by the overall score), an explicit "% Evidence" figure alongside every match score, and a human "Continue" action gating the shortlist — i.e., the UI itself enforces Core Product Principles #2, #3 and #6.

Related documents: [[03-screen-inventory]] · [[04-design-system]] · [[18-blocking-questions]]
