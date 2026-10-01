import { describe, expect, it } from 'vitest'
import { colors } from '@rqi/config'

/**
 * [A11Y REGRESSION GUARD — Build Phase 14 accessibility audit,
 * docs/accessibility-report.md §6]
 *
 * The literal Doc B hex values for the passed/pending/failed status-chip
 * text and the "verify" action's white-on-fill button text failed WCAG AA
 * (4.5:1 for this non-bold 11-14px text): 3.58:1, 2.86:1, 4.41:1and 3.77:1
 * respectively (in that order). The design tokens were darkened to fix this (see
 * packages/config/src/tokens.ts). This test computes the ratios itself
 * (not a hardcoded pass/fail flag) so a future token change that
 * reintroduces a contrast regression fails CI instead of silently shipping —
 * status-chip legibility is core-principle-critical (a mandatory-gate
 * failure must never be hard to read).
 */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function srgbToLinear(c: number): number {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

const WCAG_AA_NORMAL_TEXT = 4.5

describe('status-chip / verify-action color contrast (WCAG AA)', () => {
  it('passed status text meets 4.5:1 against its container background', () => {
    expect(contrastRatio(colors.primary, colors.primaryContainer)).toBeGreaterThanOrEqual(
      WCAG_AA_NORMAL_TEXT,
    )
  })

  it('pending/warning status text meets 4.5:1 against its background', () => {
    expect(contrastRatio(colors.warningText, colors.warningBg)).toBeGreaterThanOrEqual(
      WCAG_AA_NORMAL_TEXT,
    )
  })

  it('failed status text meets 4.5:1 against its background', () => {
    expect(contrastRatio(colors.errorText, colors.errorBg)).toBeGreaterThanOrEqual(
      WCAG_AA_NORMAL_TEXT,
    )
  })

  it('white "verify" button/stepper text meets 4.5:1 against the primary fill', () => {
    expect(contrastRatio('#FFFFFF', colors.primary)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT)
  })

  it('white "verify" hover/pressed text meets 4.5:1 against the darker fill', () => {
    expect(contrastRatio('#FFFFFF', colors.primaryHover)).toBeGreaterThanOrEqual(
      WCAG_AA_NORMAL_TEXT,
    )
  })
})
