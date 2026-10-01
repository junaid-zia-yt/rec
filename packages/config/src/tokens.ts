/**
 * Resolved Stitch design tokens — Build Phase 1 (docs/22-build-phase-1-plan.md BP1-07).
 *
 * Source: reference/stitch/DESIGN-B-executive-verification-console.md (PRIMARY —
 * color, typography, mobile layout, components) + reference/stitch/DESIGN-A-...md
 * (desktop 12-column grid + 240px nav rail only). See docs/20-decision-register.md
 * D-01 for why this hybrid was chosen, and docs/04-design-system.md for the full
 * extraction and rationale.
 *
 * Every value below traces to one of: [CONFIRMED] a DESIGN.md value, or
 * [DEFAULT] a value neither DESIGN.md specified, called out inline and in
 * docs/build-phase-1-report.md "Differences from Stitch" — never silently guessed.
 */

export const colors = {
  // Primary / verified (Doc B) — passed gates, sign-offs, certified milestones
  // [A11Y FIX — Build Phase 14 accessibility audit, docs/accessibility-report.md]
  // Doc B's literal #059669 fails WCAG AA (4.5:1) as text on primaryContainer
  // (3.58:1) and as white-on-fill text on the "verify" button / stepper
  // (3.77:1) — both are non-bold text under the 18px/14px-bold "large text"
  // threshold, so the 4.5:1 normal-text minimum applies. Promoted the
  // already-designer-approved `primaryHover` shade to DEFAULT (reusing an
  // existing palette value rather than inventing a new one) and gave hover
  // its own, further-darkened shade. Hue/semantics unchanged — computed
  // ratios are in docs/accessibility-report.md §6.
  primary: '#047857',
  primaryFill: '#10B981',
  primaryContainer: '#ECFDF5',
  primaryHover: '#065F46',

  // Secondary / interactive (Doc B) — buttons, links, selection, active tab
  secondary: '#2563EB',
  secondaryActive: '#1D4ED8',

  // Tertiary / structural (Doc B) — headings, top nav chrome, dividers
  tertiary: '#0F172A',
  navSurface: '#1E293B', // [DEFAULT — not in Doc B, carried from Doc A's nav-hover surface]

  // Surfaces
  surface: '#FFFFFF',
  canvas: '#F8FAFC',
  cardNested: '#F1F5F9',

  // Warning / pending
  // [A11Y FIX] Doc B's #D97706 on warningBg is 2.86:1 (fails 4.5:1 for the
  // status-chip/label text it's used as). Darkened to the equivalent
  // Tailwind amber-800 shade — same hue family, 6.37:1.
  warningText: '#92400E',
  warningBg: '#FEF3C7',
  warningBorder: '#FDE68A',

  // Error / failed mandatory requirement
  // [A11Y FIX] Doc B's #DC2626 on errorBg is 4.41:1 (fails 4.5:1 by a hair
  // for status-chip text). Darkened to Tailwind red-700, 5.91:1, with margin.
  errorText: '#B91C1C',
  errorBg: '#FEF2F2',
  errorBorder: '#FECACA',

  // Outlines
  outlineCell: '#E2E8F0',
  outlinePerimeter: '#CBD5E1',

  // Text
  textMuted: '#64748B',
  textPlaceholder: '#94A3B8', // [FLAG — docs/04-design-system.md §4.18: verify WCAG AA before final ship]
} as const

export const typography = {
  headlineXl: {
    fontFamily: 'var(--font-display)',
    fontSize: '32px',
    fontWeight: '700',
    lineHeight: '40px',
    letterSpacing: '-0.03em',
  },
  headlineLg: {
    fontFamily: 'var(--font-display)',
    fontSize: '26px',
    fontWeight: '700',
    lineHeight: '34px',
    letterSpacing: '-0.025em',
  },
  headlineLgMobile: {
    fontFamily: 'var(--font-display)',
    fontSize: '22px',
    fontWeight: '700',
    lineHeight: '28px',
    letterSpacing: '-0.02em',
  },
  headlineMd: {
    fontFamily: 'var(--font-display)',
    fontSize: '18px',
    fontWeight: '600',
    lineHeight: '24px',
    letterSpacing: '-0.015em',
  },
  headlineSm: {
    fontFamily: 'var(--font-display)',
    fontSize: '15px',
    fontWeight: '600',
    lineHeight: '20px',
    letterSpacing: '-0.01em',
  },
  bodyLg: {
    fontFamily: 'var(--font-body)',
    fontSize: '16px',
    fontWeight: '400',
    lineHeight: '24px',
    letterSpacing: '-0.01em',
  },
  bodyMd: {
    fontFamily: 'var(--font-body)',
    fontSize: '14px',
    fontWeight: '400',
    lineHeight: '20px',
    letterSpacing: '-0.005em',
  },
  bodySm: {
    fontFamily: 'var(--font-body)',
    fontSize: '13px',
    fontWeight: '400',
    lineHeight: '18px',
  },
  labelMd: {
    fontFamily: 'var(--font-body)',
    fontSize: '12px',
    fontWeight: '500',
    lineHeight: '16px',
    letterSpacing: '0.02em',
  },
  labelSm: {
    fontFamily: 'var(--font-body)',
    fontSize: '11px',
    fontWeight: '600',
    lineHeight: '14px',
    letterSpacing: '0.04em',
  },
  metricDisplay: {
    fontFamily: 'var(--font-display)',
    fontSize: '28px',
    fontWeight: '700',
    lineHeight: '32px',
    letterSpacing: '-0.04em',
  },
  metricSm: {
    fontFamily: 'var(--font-display)',
    fontSize: '16px',
    fontWeight: '600',
    lineHeight: '20px',
    letterSpacing: '-0.02em',
  },
} as const

export const radius = {
  sm: '0.125rem', // 2px — badge/tag borders where noted
  DEFAULT: '0.25rem',
  badge: '0.25rem', // 4px
  card: '0.5rem', // 8px
  avatar: '0.375rem', // 6px — rounded square, never circular
  control: '0.375rem', // 6px — buttons/inputs
  full: '9999px', // pills/status chips only
} as const

export const spacing = {
  xs: '0.25rem', // 4px
  sm: '0.5rem', // 8px
  md: '0.75rem', // 12px
  lg: '1rem', // 16px
  xl: '1.5rem', // 24px
  '2xl': '2rem', // 32px — [Doc A] structural module boundaries, desktop only
  gutterMobile: '0.75rem',
  marginMobile: '1rem',
  marginDesktop: '2rem', // [Doc A]
} as const

export const shadows = {
  level1: '0 1px 2px 0 rgba(15, 23, 42, 0.04)',
  level2: '0 4px 6px -1px rgba(15, 23, 42, 0.06)',
  level3Sheet: '0 -4px 12px -2px rgba(15, 23, 42, 0.08)',
  level3Modal: '0 20px 25px -5px rgba(15, 23, 42, 0.12), 0 8px 10px -6px rgba(15, 23, 42, 0.06)', // [Doc A]
} as const

export const breakpoints = {
  // [DEFAULT] 768px chosen over Doc B's 600px / Doc A's 768px split — see
  // docs/04-design-system.md §4.16 and docs/20-decision-register.md D-15.
  mobile: '0px',
  tablet: '768px',
  desktop: '1280px', // [Doc A] 12-column grid activates here
} as const

export const layout = {
  desktopNavRailWidth: '240px', // [Doc A]
  mobileBottomNavHeight: '56px', // [Doc B]
  mobileBottomNavSafeAreaClearance: '80px', // [Doc B]
  minTouchTarget: '48px', // [Doc B]
  inputHeight: '44px', // [DEFAULT — universal; Doc B says 44px, Doc A says 36px for dense desktop tables only. See D-15.]
  inputHeightDense: '36px', // [Doc A] — dense desktop data-table contexts only
} as const
