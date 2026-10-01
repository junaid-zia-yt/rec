import type { Config } from 'tailwindcss'
import { colors, radius, breakpoints } from './tokens'

/**
 * Shared Tailwind preset — every app extends this rather than redefining
 * tokens locally, so a future rebrand only touches this one file
 * (docs/04-design-system.md §4.19).
 */
const preset: Partial<Config> = {
  darkMode: undefined, // Dark mode intentionally not implemented — not present in either
  // supplied DESIGN.md and not in the approved requirements (Build Phase 1 brief §4).
  theme: {
    screens: {
      sm: '480px',
      md: breakpoints.tablet,
      lg: breakpoints.desktop,
      xl: '1440px',
    },
    extend: {
      colors: {
        primary: {
          DEFAULT: colors.primary,
          fill: colors.primaryFill,
          container: colors.primaryContainer,
          hover: colors.primaryHover,
        },
        secondary: {
          DEFAULT: colors.secondary,
          active: colors.secondaryActive,
        },
        tertiary: colors.tertiary,
        navSurface: colors.navSurface,
        surface: colors.surface,
        canvas: colors.canvas,
        cardNested: colors.cardNested,
        warning: {
          DEFAULT: colors.warningText,
          bg: colors.warningBg,
          border: colors.warningBorder,
        },
        danger: {
          DEFAULT: colors.errorText,
          bg: colors.errorBg,
          border: colors.errorBorder,
        },
        outline: {
          cell: colors.outlineCell,
          perimeter: colors.outlinePerimeter,
        },
        muted: colors.textMuted,
        placeholder: colors.textPlaceholder,
      },
      borderRadius: {
        badge: radius.badge,
        card: radius.card,
        avatar: radius.avatar,
        control: radius.control,
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'level-1': '0 1px 2px 0 rgba(15, 23, 42, 0.04)',
        'level-2': '0 4px 6px -1px rgba(15, 23, 42, 0.06)',
        'level-3-sheet': '0 -4px 12px -2px rgba(15, 23, 42, 0.08)',
        'level-3-modal':
          '0 20px 25px -5px rgba(15, 23, 42, 0.12), 0 8px 10px -6px rgba(15, 23, 42, 0.06)',
      },
      spacing: {
        18: '4.5rem',
      },
    },
  },
}

export default preset
