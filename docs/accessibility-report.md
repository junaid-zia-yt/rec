# Accessibility Audit — Build Phase 14, Wave 2b

**Scope:** apps/web (Next.js 16 / Tailwind / shadcn-Radix, `packages/ui`) and apps/mobile (Expo React Native, `components/ui`, the 16 real Phase-13 screens). UI/component files only — this wave ran in parallel with an AI-evaluation wave touching `lib/ai`, `lib/outreach`, `lib/copilot`, `lib/matching`.

**Method:** static code review + manual reasoning about keyboard/screen-reader behavior, plus a small standalone script computing WCAG contrast ratios from the actual documented hex values (`docs/04-design-system.md` §4.2) and their real in-code usage (font size/weight, not assumed). **This is not a live assistive-technology test** — there is no screen reader (VoiceOver/TalkBack/NVDA/JAWS), no real browser, and no physical iOS/Android device in this environment. Every finding below is either (a) a structural/code-level fact that's true regardless of AT (missing `accessibilityRole`, missing `scope="col"`, a computed contrast ratio) or (b) a well-established behavioral inference (e.g. "a bare `<Pressable>` is not announced with a role by VoiceOver/TalkBack unless `accessibilityRole` is set" — documented React Native/RN-a11y behavior, not observed firsthand here). Treat this report as a rigorous static audit that should still be followed by a real-device/AT pass before shipping to production.

---

## 1. Summary table

| #   | Area                                                                                                         | Platform     | Severity     | Status                                            |
| --- | ------------------------------------------------------------------------------------------------------------ | ------------ | ------------ | ------------------------------------------------- |
| 1   | Status-chip text contrast (passed/pending/failed) fails WCAG AA                                              | Web + Mobile | **Critical** | **Fixed**                                         |
| 2   | "Verify" button / WorkflowStepper white-on-fill text fails WCAG AA                                           | Web + Mobile | **Critical** | **Fixed**                                         |
| 3   | `text-primary` "success" banner text (used in ~17 forms) fails WCAG AA                                       | Web          | **Critical** | **Fixed** (same token as #1/#2)                   |
| 4   | No skip-to-content link — full header + nav rail must be tabbed through on every route                       | Web          | High         | **Fixed**                                         |
| 5   | Raw `<table>`s missing `scope="col"` on header cells                                                         | Web          | High         | **Fixed** (2 files)                               |
| 6   | Bare `Pressable`s with no `accessibilityRole`/`accessibilityLabel` (card rows, filter/tab chips, "View all") | Mobile       | High         | **Fixed** (4 screens)                             |
| 7   | `AvatarInitials` not hidden from the accessibility tree — redundant/out-of-context announcement              | Mobile       | Medium       | **Fixed**                                         |
| 8   | BottomSheet doesn't respect OS "Reduce Motion"; no modal announcement to AT                                  | Mobile       | High         | **Fixed**                                         |
| 9   | Placeholder text (`#94A3B8`) fails WCAG AA against white                                                     | Web + Mobile | Medium       | Tracked, not fixed                                |
| 10  | Hairline borders (input/card outline, status-chip border) under 3:1 non-text contrast                        | Web + Mobile | Low          | Tracked, not fixed                                |
| 11  | Global account-menu button has `aria-label` but no `aria-haspopup`/`aria-expanded` (menu itself unbuilt)     | Web          | Medium       | Tracked, not fixed (feature gap, not purely a11y) |
| 12  | Mobile verify-button pressed state used a too-light fill for white text                                      | Mobile       | Medium       | **Fixed** (bundled with #1/#2 token fix)          |

**Confirmed clean (no finding):**

- No `<div onClick>` / `<span onClick>` keyboard traps anywhere in `apps/web` — every `onClick` in the codebase is attached to a real `<button>`, `<a>`/`Link`, or a Radix primitive that renders one. (Verified by parsing every `<div|span|li|tr|td ...>` opening tag in `apps/web/components` and `apps/web/app` for an inline `onClick`, and separately walking back from every `onClick=` line to its nearest opening tag — zero matches.)
- No `outline-none`/`focus:outline-none` anywhere in `apps/web` without an accompanying `focus-visible:ring-*` replacement.
- `prefers-reduced-motion` is already handled globally in `apps/web/app/globals.css` (forces near-zero transition/animation duration).
- Radix-based primitives (`Dialog`, `Select`, `Checkbox`, `RadioGroup`, `Switch`, `Tabs`) in `packages/ui` are used correctly — no props/wrapping that would break Radix's built-in focus trap, `Escape`-to-close, or ARIA roles.
- `IconButton` (web) structurally requires a `label` prop — there's no code path to ship an icon-only button with no accessible name.
- `StatusBadge`/`StatusChip` (both platforms) already pair every status with a text label, never color alone — this was called out as a requirement in `docs/04-design-system.md` §4.18 and the implementation honors it.
- Mobile `Button`, `ListItem` enforce the 48×48 minimum touch target via `minHeight`/`minWidth: layout.minTouchTarget` in the `StyleSheet`, not just a comment — re-verified in the source, not just trusted from the Phase 13 report. Spot-checked 4 screens (`ProjectListScreen`, `CandidatePipelineScreen`, `NotificationsScreen`, `NotificationPreferencesScreen`) for a custom-sized touchable bypassing these primitives — none found.
- Mobile `NotificationPreferencesScreen`'s `Switch` controls already carry per-row `accessibilityLabel`s.
- Web forms (sign-in, invite member, gate-override reason, outreach cancel/opt-out reason, scorecard, candidate create/edit, client form) all use the shared `FormField` component, which always renders a real `<label htmlFor>` tied to the control's `id` — every sampled form field has a programmatic label. Required-field asterisks are `aria-hidden` (redundant with `required`).
- Web `DataTableShell` (the one properly-built accessible table shell in `packages/ui`) already does `scope="col"` + `sr-only` caption correctly — it just wasn't reused by the two ad-hoc `<table>`s found (now fixed to match).
- Mobile bottom-tab inactive label color (`#64748B` on white tab bar) is 4.76:1 — passes, despite `docs/04-design-system.md` §4.18 flagging this exact hex as a risk (the risk didn't materialize because the tab bar background is white, not the navy the doc worried about).
- Web desktop nav-rail inactive label (`text-white/70` on navy `#0F172A`) computes to ~9.1:1 once alpha-blended — comfortably passes; the design doc's contrast worry was about a _different_ token (`#64748B`) that the actual implementation doesn't use here.

---

## 2. Keyboard navigation (web)

**Method:** grepped every `onClick` in `apps/web/components` and `apps/web/app`, then walked back to the nearest JSX opening tag for each to confirm it's a `<button>`, `<a>`/`Link`, or a Radix-rendered interactive primitive.

**Result: clean.** No `<div>`/`<span>`/`<li>`/`<tr>`/`<td>` with an inline `onClick` was found anywhere in the sampled tree (`components/domain/**`, `app/**`), including the outreach workspace (18 `onClick`s), POC setup panel, scorecard editor, shortlist workspace, and copilot workspace — all attach to real interactive elements. The gate-override flow, outreach approve/reject, shortlist approve, and client decision actions (`candidate-evaluation-panel.tsx`, `outreach-sequence-workspace.tsx`, `shortlist-workspace-panel.tsx`) all use `<Button>`/`<button>`.

**Finding (High, fixed):** no skip-to-content link existed. `DesktopNavRail` renders 23 combined nav destinations before `<main>` in DOM order, and `TopNav` (search field, Help, Notifications, account menu) also precedes it — a keyboard user had to tab through all of that on **every single route change** to reach page content. WCAG 2.4.1 (Bypass Blocks). Fixed in `apps/web/components/domain/app-shell.tsx`: added a visually-hidden `<a href="#main-content">Skip to main content</a>` that becomes visible on focus, and gave `<main>` `id="main-content" tabIndex={-1}`.

---

## 3. Focus order (web)

Sampled dashboard, candidate evaluation/gate-override, scorecard builder/approval, outreach approval, shortlist workspace, client decision, and notifications. All use plain document-flow layout (flex/grid without `order`/absolute repositioning that would desync visual from DOM order). No finding.

---

## 4. Focus visibility (web)

Grepped every `outline-none`/`focus:outline-none`/`focus-visible:outline-none` occurrence in `apps/web/components` and `apps/web/app`: **every single one** is paired with a `focus-visible:ring-*` class in the same className. No finding — this is a case where the codebase already does the right thing consistently, via the shared `Button`, `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroupItem`, `Switch`, `TabsTrigger`, and `DialogPrimitive.Close` components in `packages/ui` all being built with `focus-visible:ring-2 focus-visible:ring-secondary`.

---

## 5. Labels (web + mobile)

**Web:** every sampled form (sign-in `components/domain/auth/sign-in-form.tsx`, invite-member, gate-override reason `candidate-evaluation-panel.tsx:227-244`, outreach cancel/opt-out reason `outreach-sequence-workspace.tsx:169-323`, scorecard requirement editor, notification preferences) routes through the shared `FormField` component (`packages/ui/src/components/form-controls.tsx:188-223`), which always renders `<label htmlFor={htmlFor}>` bound to the control's matching `id`. No unlabeled input found in the sample. The disabled global-search input (`top-nav.tsx`) has a `sr-only` label plus an `aria-describedby` hint explaining it's not yet implemented — good practice for a stub control.

**Mobile:** `Input` component doesn't itself require a label prop (it forwards `TextInputProps`, including `aria-invalid`), so labeling is the screen's responsibility. `NotificationPreferencesScreen`'s `Switch` rows do supply `accessibilityLabel`. Other form-bearing mobile screens weren't in the audited sample (Phase 13's 16 real screens skew toward list/detail/decision screens, not data-entry forms) — **not fully verified**, flagged for a follow-up pass if/when mobile data-entry screens (e.g. a mobile scorecard editor) are built.

---

## 6. Color contrast — computed ratios

Computed with the standard WCAG relative-luminance formula (sRGB → linearized → `0.2126R + 0.7152G + 0.0722B`, contrast = `(L1+0.05)/(L2+0.05)`), implemented as a throwaway Python script and cross-checked against the final values now also asserted by `apps/web/lib/a11y/contrast.test.ts` (vitest, runs in CI). Text-size thresholds applied per WCAG 1.4.3: **4.5:1** for normal text, **3:1** for large text (≥24px regular or ≥18.66px/14pt bold) or non-text UI components — checked against each color's _actual_ in-code font-size/weight, not assumed.

### Before (Doc B literal values — docs/04-design-system.md §4.2)

| Pair                                                                                       | Ratio           | Used as                                                                                           | Threshold                                                            | Result                                                                                                             |
| ------------------------------------------------------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `#059669` text on `#ECFDF5` (primary-container "success" banner, 14px/500)                 | 3.58:1          | Web: `text-primary` on `bg-primary-container` — ~17 form components' success/confirmation banners | 4.5:1                                                                | **FAIL**                                                                                                           |
| `#059669` StatusBadge/Chip "passed" text (11px web / 12px mobile, semibold)                | 3.58:1          | Web `StatusBadge`, Mobile `StatusChip`                                                            | 4.5:1                                                                | **FAIL**                                                                                                           |
| White text on `#059669` fill (14px/500, "verify" button + WorkflowStepper "complete" step) | 3.77:1          | Web `Button variant="verify"`, `WorkflowStepper`; Mobile `Button variant="verify"`                | 4.5:1                                                                | **FAIL**                                                                                                           |
| `#D97706` text on `#FEF3C7` (pending/warning chip, 11-12px)                                | 2.86:1          | Web/Mobile "pending"/"warning" StatusBadge/Chip, `Alert tone="warning"`                           | 4.5:1                                                                | **FAIL (worst case)**                                                                                              |
| `#DC2626` text on `#FEF2F2` (failed chip, 11-12px)                                         | 4.41:1          | Web/Mobile "failed" StatusBadge/Chip, `Alert tone="danger"`                                       | 4.5:1                                                                | FAIL (narrowly)                                                                                                    |
| White pressed-state text on `#10B981` (mobile verify button, pressed)                      | 2.54:1          | Mobile `Button variant="verify"` pressed                                                          | 4.5:1                                                                | **FAIL**                                                                                                           |
| `#94A3B8` placeholder on white                                                             | 2.56:1          | `Input`/`Textarea` placeholder text (both platforms)                                              | 4.5:1 (advisory — placeholder-only text isn't strictly WCAG-covered) | FAIL — pre-flagged in the design doc itself (§4.18, and `packages/config/src/tokens.ts`'s own `// [FLAG]` comment) |
| `#CBD5E1` border on white                                                                  | 1.48:1          | Input/card hairline borders                                                                       | 3:1 (non-text UI boundary)                                           | FAIL                                                                                                               |
| `#A7F3D0` chip border on white                                                             | 1.28:1          | StatusBadge decorative border                                                                     | 3:1                                                                  | FAIL                                                                                                               |
| `#64748B` on white (body/muted text)                                                       | 4.76:1          | `text-muted`, mobile tab-bar inactive label                                                       | 4.5:1                                                                | PASS                                                                                                               |
| `#0F172A` on white/canvas (headings)                                                       | 17.85 / 17.06:1 | headings                                                                                          | 4.5:1                                                                | PASS                                                                                                               |
| White on `#2563EB` / `#1D4ED8` (secondary buttons)                                         | 5.17 / 6.70:1   | primary/secondary action buttons                                                                  | 4.5:1                                                                | PASS                                                                                                               |
| `#DC2626` text on white (destructive button/link text)                                     | 4.83:1          | `text-danger` on white                                                                            | 4.5:1                                                                | PASS                                                                                                               |
| `text-white/70` on navy `#0F172A` (desktop nav rail inactive, alpha-blended ≈ `#B7B9BF`)   | 9.10:1          | `DesktopNavRail`                                                                                  | 4.5:1                                                                | PASS                                                                                                               |

### After (fixed values — this pass)

| Token                        | Old → New                                                                                                             | Ratio (worst-case usage)                                   | Result   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------- |
| `colors.primary` (text/fill) | `#059669` → `#047857` _(reused the existing, already-designer-approved `primaryHover` shade — not an invented color)_ | 5.21:1 on container, 5.48:1 on white, 5.48:1 white-on-fill | **PASS** |
| `colors.primaryHover`        | `#047857` → `#065F46` _(new — needed its own, further-darkened hover/pressed shade once `primary` was promoted)_      | 7.68:1 white-on-fill                                       | **PASS** |
| `colors.warningText`         | `#D97706` → `#92400E` _(Tailwind amber-800, same hue family)_                                                         | 6.37:1                                                     | **PASS** |
| `colors.errorText`           | `#DC2626` → `#B91C1C` _(Tailwind red-700)_                                                                            | 5.91:1 on bg, 6.47:1 on white                              | **PASS** |
| Mobile verify-pressed fill   | was `colors.primaryFill` (`#10B981`, 2.54:1) → now `colors.primaryHover` (`#065F46`)                                  | 7.68:1                                                     | **PASS** |

Changed in `packages/config/src/tokens.ts` (web) and `apps/mobile/theme/tokens.ts` (mobile) — one hex-value edit per token, hue family preserved, no other visual properties touched. This single, narrowly-scoped change fixes the status chips (both platforms), the verify button (both platforms), the WorkflowStepper "complete" state, `Alert` warning/danger tones, and every one of the ~17 web forms rendering a `text-primary` success banner — all of which shared the same underlying token. **Regression-guarded** by `apps/web/lib/a11y/contrast.test.ts` (5 vitest assertions computing ratios from the live `@rqi/config` export, not hardcoded pass/fail booleans).

**Not fixed (tracked):**

- **Placeholder text** (`#94A3B8`, 2.56:1) — Medium. WCAG doesn't strictly require placeholder-only text to meet AA (it's not the field's persistent accessible name), and every sampled field already has a real `<label>`/`accessibilityLabel` alongside its placeholder, so this isn't a blocking-workflow issue — but it was already self-flagged in `packages/config/src/tokens.ts` as a known gap and remains one. Recommend darkening to something like `#64748B` (already used for muted text, 4.76:1) in a follow-up pass, since that's a bigger, more deliberate palette decision than the emergency-chip fix above.
- **Hairline borders** (`#CBD5E1`/`#A7F3D0`, ~1.3-1.5:1) — Low. These are decorative separators (card edges, chip borders), not the sole means of identifying an interactive control's boundary — inputs and buttons also have a distinct fill/label — so WCAG 1.4.11's "necessary to identify" carve-out likely applies, but a low-vision user could still find cards/chips harder to visually parse. Flagged, not fixed, to keep this pass scoped to Critical/High.

---

## 7. Status not conveyed by color alone

**Clean on both platforms.** Web `StatusBadge` (`packages/ui/src/components/badge-avatar.tsx`) and Mobile `StatusChip` (`apps/mobile/components/ui/StatusChip.tsx`) both require a `children`/`label` prop and render it as real text every time; the web version additionally adds a Lucide check/✕/⚠ icon per status. Every call site sampled (candidate pipeline, gate rows, outreach status, shortlist status, job status, integrations, background jobs) passes a real label, never renders the badge with only a color swatch. This was an explicit requirement carried from the design doc (§4.18) and the implementation already honors it correctly — no fix needed.

---

## 8. Screen-reader structure

**Web:**

- Heading hierarchy: `PageHeader` renders `<h1>`, `SectionHeader` renders `<h2>` — sampled pages (shortlist detail, candidate evaluation, POC comparison) follow a consistent single-`h1`-per-page pattern with `h2`s for sections. No skipped levels found in the sample.
- Landmarks: `<main>` (now with `id="main-content"`), `<nav aria-label="Primary">` (both desktop rail and mobile bottom nav), `<nav aria-label="Breadcrumb">`, `<nav aria-label="Pagination">` — all present and labeled.
- Tables: `DataTableShell` was already correct. Two ad-hoc `<table>`s (`csv-import-review.tsx`, `poc-comparison-report.tsx`'s `ComparisonTable`) were missing `scope="col"` and a programmatic `<caption>` — **fixed** (added `scope="col"` to all header cells in both files, plus an `sr-only` caption; the four back-to-back comparison tables on the POC report — §4.18's explicitly-flagged highest-risk screen — now each get a distinct caption naming which comparison they are, e.g. "Quality result comparison for Store Supervisor", so a screen-reader user navigating by table doesn't hear four identical "table"s in a row).

**Mobile:**

- `ListItem` already sets `accessibilityRole={onPress ? 'button' : undefined}` — correct.
- **Finding (High, fixed):** several screens build their own card-row/chip `Pressable`s directly (bypassing `ListItem`) with no `accessibilityRole` or `accessibilityLabel` at all: `ProjectListScreen` (status-filter chips + the whole project card row), `ProjectDetailsScreen` (job rows, candidate rows, "View all" link), `CandidatePipelineScreen` (candidate card row), `CandidateEvaluationScreen` (job-picker chips). A bare RN `Pressable` is not announced with a role by VoiceOver/TalkBack without `accessibilityRole`, and a card row containing several separate `<Text>` children (name, status chip, counts) may be read as several disconnected fragments rather than one coherent stop, without a combined `accessibilityLabel`. Fixed all of the above: added `accessibilityRole="button"` plus a combined `accessibilityLabel` summarizing the row's content, and `accessibilityState={{ selected }}` on the two chip/tab-style pickers (status filter, job picker).
- **Finding (Medium, fixed):** `AvatarInitials` (mobile) rendered its initials as plain `<Text>` inside a `<View>` with no accessibility hiding, unlike its web counterpart (`aria-hidden="true"`) — a screen reader would announce e.g. "J D" immediately before the candidate's actual name, redundant and out of context. Fixed with `accessible={false}` + `importantForAccessibility="no-hide-descendants"`.
- **Not fully verified:** `NotificationsScreen`, `CopilotConversationWorkspaceScreen` already had some `accessibilityRole`s in place (verified by grep) but weren't individually walked screen-by-screen for label _quality_ (i.e. whether the label text is genuinely descriptive, not just present) — spot-checked, not exhaustive.

---

## 9. Dialog / sheet focus management

**Web:** every modal usage (`Dialog`, `ConfirmationDialog`, `Drawer`, `BottomSheet` in `packages/ui/src/components/overlay.tsx`) is built directly on `@radix-ui/react-dialog`, unmodified in the ways that would break its focus trap — no custom `onOpenAutoFocus`/`onCloseAutoFocus` overrides were found that disable Radix's default behavior (focus moves into the dialog on open, returns to the trigger on close, `Escape` closes, focus is trapped inside while open). No finding.

**Mobile (`BottomSheet.tsx`, wraps `@gorhom/bottom-sheet`):**

- **Finding (High, fixed):** gorhom's bottom sheet does not, by default, tell iOS/Android accessibility services that it's a modal surface — VoiceOver/TalkBack would not announce that a new "dialog-like" surface appeared, unlike Radix's Dialog on web. Fixed by adding `accessibilityViewIsModal` and an optional `accessibilityLabel` prop (callers should pass something like `"Approval actions"` describing the sheet's purpose — not yet threaded through every call site's props, since that's a per-screen content decision left to the screens that use it going forward).
- **Finding (High, fixed):** see §10 below — the sheet's open/close animation entirely ignored the OS reduce-motion setting.

---

## 10. Mobile touch targets

Re-verified in source, not trusted from the Phase 13 report:

- `Button`: `minHeight: layout.minTouchTarget` (48) + `minWidth: layout.minTouchTarget` in its base `StyleSheet` — enforced regardless of `variant`/`size` prop, can't be bypassed by a caller.
- `ListItem`: `minHeight: layout.minTouchTarget` in its row style.
- Spot-checked 4 real screens (`ProjectListScreen`, `CandidatePipelineScreen`, `NotificationsScreen`, `NotificationPreferencesScreen`) for a custom-sized `Pressable`/`TouchableOpacity` that bypasses these primitives and sets its own smaller touch area — none found; every custom `Pressable` in the sampled screens wraps a full-width `Card` row (comfortably over 48px) or the `StickyActionBar`'s `Button`s.
  No finding.

---

## 11. Reduced motion

**Web:** already fully handled — `apps/web/app/globals.css:10` has a `@media (prefers-reduced-motion: reduce)` block forcing `scroll-behavior: auto`, `transition-duration: .01ms`, `animation-duration: .01ms`, `animation-iteration-count: 1` on every element. This predates this wave; confirmed still correct.

**Mobile — Finding (High, fixed):** there was **no reduced-motion handling anywhere in `apps/mobile`** before this pass (`grep`'d for `AccessibilityInfo`, `isReduceMotionEnabled`, `reduceMotion`, `useReducedMotion` across the app — zero real usages). The only animated surface (`BottomSheet`, via `@gorhom/bottom-sheet` → `react-native-reanimated`) played its full spring/timing animation regardless of the OS "Reduce Motion" accessibility setting. This is a real, previously-unimplemented gap — reporting it honestly rather than downplaying it, per the brief.

Fixed in `apps/mobile/components/ui/BottomSheet.tsx`: a small `useReduceMotionSetting()` hook built on RN core's `AccessibilityInfo.isReduceMotionEnabled()` + the `reduceMotionChanged` event listener (deliberately _not_ Reanimated's own `useReducedMotion()` — that hook isn't implemented in the project's Jest mock for `react-native-reanimated` and broke every screen that renders a `BottomSheet` in tests; `AccessibilityInfo` is RN core, has no such mocking gap, and is the more portable choice if a second animation library is ever introduced). When reduce-motion is on, `animationConfigs={{ duration: 0 }}` is passed to gorhom's sheet, collapsing the open/close spring to an instant snap.

---

## 12. Verification

```
pnpm typecheck   → 6/6 packages pass, 0 errors
pnpm lint        → 0 errors (18 pre-existing warnings in apps/mobile/__tests__, all
                   `no-require-imports` in test files, unrelated to this pass)
pnpm test        → mobile: 26/26 suites, 98/98 tests passing
                   web:    105/105 test files passing
```

New/extended tests (added only where a fix carries real regression risk, per the brief — not padding):

- `apps/web/lib/a11y/contrast.test.ts` — **new**, 5 assertions computing WCAG contrast ratios live from the exported `@rqi/config` colors (not hardcoded booleans), guarding the token darkening in §6 against a future regression.
- `apps/mobile/__tests__/screens/ProjectListScreen.test.tsx` — **extended**, 2 new assertions: the project card row is queryable by `getByRole('button', { name: /Store Supervisor/ })`, and a status filter chip exposes `accessibilityRole="button"` + `accessibilityState.selected`, guarding the §8 mobile Pressable-labeling fix.

The `useReducedMotion`-vs-`AccessibilityInfo` swap in §11 was itself caught by this test run: the first implementation (Reanimated's hook) passed typecheck/lint but broke 7 test suites / 35 tests at runtime (`TypeError: useReducedMotion is not a function` inside every screen that renders a `BottomSheet` — `OutreachApprovalScreen`, `CandidateEvaluationScreen`, `ClientDecisionScreen`, `FinalShortlistScreen`, and the cross-screen `coreJourneys` test), which is exactly why "run the fix through tests before declaring it done" matters — this is noted here as evidence the verification step did real work, not just a formality.

---

## 13. What wasn't verified / couldn't be checked here

- **No real assistive technology.** No VoiceOver, TalkBack, NVDA, or JAWS exists in this environment. Every screen-reader-behavior claim above (announcement order, role naming, modal trapping) is inferred from documented RN/DOM accessibility semantics and Radix/gorhom's own documented behavior, not observed.
- **No real device or browser.** No physical iOS/Android hardware, no visual browser to confirm the skip-link's focus-visible styling actually renders as intended, no zoom-to-200%/reflow check (WCAG 1.4.10) was performed — the codebase's `overflow-x: hidden` on `html, body` plus consistent use of relative units (`rem`/`px` with responsive Tailwind breakpoints) suggests reflow should hold up, but this wasn't run in a real viewport.
- **Mobile data-entry screens beyond `NotificationPreferencesScreen`** weren't exhaustively checked for label coverage (see §5) — the 16 real Phase-13 screens skew toward list/detail/decision UI rather than long forms.
- **`BottomSheet`'s new `accessibilityLabel` prop** is defined but not yet threaded through every call site (`OutreachApprovalScreen`, `CandidateEvaluationScreen`, `ClientDecisionScreen`, `FinalShortlistScreen`) — each of those screens should pass a short description of that sheet's contents in a follow-up, now that the prop exists.
- **Medium/Low findings** (placeholder-text contrast, hairline-border contrast, the account-menu's missing `aria-haspopup`/`aria-expanded`) are recorded above as tracked but intentionally not fixed in this pass, per the brief's Critical/High-only fix scope.

---

## Related documents

[[04-design-system]] §4.2 (color palette), §4.18 (the design doc's own pre-existing a11y gap list — largely resolved by this pass) · [[16-testing-strategy]] · [[build-phase-13-report]] (mobile touch-target/four-states claims, re-verified in §10 rather than trusted)
