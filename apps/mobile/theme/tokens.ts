/**
 * Design tokens transcribed from docs/04-design-system.md (the resolved
 * palette/type/spacing/radius, Doc B primary + Doc A desktop overlay) —
 * the RN analogue of packages/config/src/tokens.ts (web's Tailwind theme
 * extension). React Native has no CSS/Tailwind, so these are exported as
 * plain TS objects consumed directly by components and StyleSheets.
 *
 * Do not invent new values here — if a screen needs something not listed,
 * add it to docs/04-design-system.md first (or flag it [UNDETERMINED]),
 * then mirror it here, per the design doc's own §4.19 tokenization
 * recommendation ("ship the resolved values... so a future rebrand only
 * touches one file").
 */

// ---------------------------------------------------------------------------
// 4.2 — Color palette
// ---------------------------------------------------------------------------
export const colors = {
  // Primary / Verified (passed gates, sign-offs, certified milestones)
  // [A11Y FIX — Build Phase 14 accessibility audit, docs/accessibility-report.md]
  // Mirrors the same web token fix in packages/config/src/tokens.ts: Doc B's
  // literal #059669 fails WCAG AA 4.5:1 as StatusChip text and as white-on-fill
  // "verify" button text (3.58:1 / 3.77:1). Promoted to the darker,
  // already-in-palette shade; `primaryHover` is a new, further-darkened
  // pressed-state shade (was reusing `primaryFill`, which is too light for
  // white text — 2.54:1). See docs/accessibility-report.md §6 for ratios.
  primary: '#047857',
  primaryFill: '#10B981',
  primaryHover: '#065F46',
  primaryContainer: '#ECFDF5',

  // Secondary / Interactive (buttons, links, selection, active tab)
  secondary: '#2563EB',
  secondaryActive: '#1D4ED8',

  // Tertiary / Structural (headings, top nav chrome, dividers)
  tertiary: '#0F172A',
  tertiaryAlt: '#1E293B',

  // Surfaces
  surfaceBase: '#FFFFFF',
  surfaceCanvas: '#F8FAFC',
  surfaceNested: '#F1F5F9',

  // Warning / Pending
  // [A11Y FIX] same rationale as web: #D97706 on warningBg was 2.86:1.
  warningText: '#92400E',
  warningBg: '#FEF3C7',
  warningBorder: '#FDE68A',

  // Error / Failed
  // [A11Y FIX] same rationale as web: #DC2626 on errorBg was 4.41:1.
  errorText: '#B91C1C',
  errorBg: '#FEF2F2',
  errorBorder: '#FECACA',

  // Outline
  outlineCell: '#E2E8F0',
  outlinePerimeter: '#CBD5E1',

  // Text
  textMuted: '#94A3B8',
  textInactiveNav: '#64748B',

  white: '#FFFFFF',
} as const

/** §4.14 — Status chip colors (passed/pending/failed), semantic and kept
 * separate from the raw palette above so components reference intent, not
 * hex values. */
export const statusColors = {
  passed: { bg: colors.primaryContainer, text: colors.primary, border: '#A7F3D0' },
  pending: { bg: colors.warningBg, text: colors.warningText, border: colors.warningBorder },
  failed: { bg: colors.errorBg, text: colors.errorText, border: colors.errorBorder },
  warning: { bg: colors.warningBg, text: colors.warningText, border: colors.warningBorder },
} as const
export type StatusColorKey = keyof typeof statusColors

// ---------------------------------------------------------------------------
// 4.3 / 4.4 — Typography
// ---------------------------------------------------------------------------
/** Font family names as registered by expo-font in theme/fonts.ts. Space
 * Grotesk for headlines/metrics, Geist for body/labels (§4.3). */
export const fontFamily = {
  headlineBold: 'SpaceGrotesk_700Bold',
  headlineSemibold: 'SpaceGrotesk_600SemiBold',
  headlineMedium: 'SpaceGrotesk_500Medium',
  bodyRegular: 'Geist_400Regular',
  bodyMedium: 'Geist_500Medium',
  bodySemibold: 'Geist_600SemiBold',
} as const

/** §4.4 type hierarchy (fontSize/lineHeight in px, mirroring the doc's
 * "32/40" shorthand). Mobile uses the mobile headline-lg figure (22/28). */
export const typeScale = {
  headlineXl: { fontSize: 32, lineHeight: 40, fontFamily: fontFamily.headlineBold },
  headlineLg: { fontSize: 22, lineHeight: 28, fontFamily: fontFamily.headlineBold },
  headlineMd: { fontSize: 18, lineHeight: 24, fontFamily: fontFamily.headlineSemibold },
  headlineSm: { fontSize: 15, lineHeight: 20, fontFamily: fontFamily.headlineSemibold },
  bodyLg: { fontSize: 16, lineHeight: 24, fontFamily: fontFamily.bodyRegular },
  bodyMd: { fontSize: 14, lineHeight: 20, fontFamily: fontFamily.bodyRegular },
  bodySm: { fontSize: 13, lineHeight: 18, fontFamily: fontFamily.bodyRegular },
  labelMd: { fontSize: 12, lineHeight: 16, fontFamily: fontFamily.bodyMedium },
  labelSm: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: fontFamily.bodyMedium,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
  metricDisplay: { fontSize: 28, lineHeight: 32, fontFamily: fontFamily.headlineBold },
  metricSm: { fontSize: 16, lineHeight: 20, fontFamily: fontFamily.headlineSemibold },
} as const

// ---------------------------------------------------------------------------
// 4.5 — Spacing (4px base rhythm)
// ---------------------------------------------------------------------------
export const spacing = {
  xs4: 4,
  sm8: 8,
  md12: 12,
  lg16: 16,
  xl24: 24,
} as const

/** Mobile-specific layout constants (§4.5, §4.9, §4.10, §4.15). */
export const layout = {
  outerMargin: 16,
  gutter: 12,
  minTouchTarget: 48,
  inputHeight: 44,
  bottomNavHeight: 56,
} as const

// ---------------------------------------------------------------------------
// 4.6 — Border radius
// ---------------------------------------------------------------------------
export const radius = {
  card: 8, // rounded-md — cards/containers
  badge: 4, // rounded-sm — badges/pills/tags (except status chips, see below)
  avatar: 6, // rounded squares — never circular, per §4.6
  input: 6, // inputs/buttons
  pill: 9999, // full — status chips only (§4.14's one exception to the 4-8px rule)
} as const

// ---------------------------------------------------------------------------
// 4.7 — Elevation (RN shadow props; iOS uses shadow*, Android uses elevation)
// ---------------------------------------------------------------------------
export const elevation = {
  l0: {},
  l1: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
    borderWidth: 1,
    borderColor: colors.outlineCell,
  },
  l2: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  l3: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
    borderTopWidth: 1,
    borderTopColor: colors.outlinePerimeter,
  },
} as const

export const tokens = {
  colors,
  statusColors,
  fontFamily,
  typeScale,
  spacing,
  layout,
  radius,
  elevation,
}
export default tokens
