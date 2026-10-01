import { forwardRef, useEffect, useState, type PropsWithChildren } from 'react'
import GorhomBottomSheet, { BottomSheetView, type BottomSheetProps } from '@gorhom/bottom-sheet'
import { AccessibilityInfo, StyleSheet } from 'react-native'
import { colors, elevation, radius, spacing } from '@/theme/tokens'

/**
 * Mirrors the OS-level "Reduce Motion" setting. Uses RN core's
 * `AccessibilityInfo` (not Reanimated's `useReducedMotion`) so this doesn't
 * depend on the animation library's own mock in tests, and works the same
 * way the rest of the app would query the setting.
 */
function useReduceMotionSetting(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false)
  useEffect(() => {
    let mounted = true
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((enabled) => mounted && setReduceMotion(enabled))
      .catch(() => {})
    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (enabled) => {
      if (mounted) setReduceMotion(enabled)
    })
    return () => {
      mounted = false
      subscription?.remove?.()
    }
  }, [])
  return reduceMotion
}

export type AppBottomSheetRef = GorhomBottomSheet

/**
 * Thin wrapper around @gorhom/bottom-sheet, themed to §4.7's L3 sticky
 * sheet spec (top hairline border, near-zero-blur elevation) — used for the
 * "sticky approval sheet" pattern called out throughout docs/04-design-
 * system.md (§4.1, §4.11) as one of the three first-priority shared
 * components. Forwards its ref so callers can call `.expand()`/`.close()`.
 */
export const BottomSheet = forwardRef<
  GorhomBottomSheet,
  PropsWithChildren<
    Pick<BottomSheetProps, 'snapPoints' | 'index' | 'onChange' | 'enablePanDownToClose'>
  > & {
    /** Announced by the screen reader when the sheet opens (VoiceOver/TalkBack
     * don't otherwise announce that a new modal surface appeared — item #5 of
     * the Build Phase 14 accessibility audit). Pass a short description of
     * what the sheet contains, e.g. "Approval actions". */
    accessibilityLabel?: string
  }
>(function BottomSheet(
  { children, snapPoints, index = -1, onChange, enablePanDownToClose = true, accessibilityLabel },
  ref,
) {
  // [A11Y FIX] gorhom/bottom-sheet's open/close spring was otherwise entirely
  // unaffected by the OS "Reduce Motion" setting (item #10 of the audit —
  // this was a real, unimplemented gap on mobile, unlike web's globals.css
  // which already handles `prefers-reduced-motion`).
  const reduceMotion = useReduceMotionSetting()

  return (
    <GorhomBottomSheet
      ref={ref}
      index={index}
      snapPoints={snapPoints ?? ['40%', '80%']}
      onChange={onChange}
      enablePanDownToClose={enablePanDownToClose}
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.handle}
      style={elevation.l3}
      animationConfigs={reduceMotion ? { duration: 0 } : undefined}
      accessibilityLabel={accessibilityLabel}
      // Tells screen readers this is a modal surface, so they trap/announce
      // focus the way a Dialog does on web (Radix handles this for web;
      // gorhom does not do it by default on native).
      accessibilityViewIsModal
    >
      <BottomSheetView style={styles.content}>{children}</BottomSheetView>
    </GorhomBottomSheet>
  )
})

const styles = StyleSheet.create({
  background: {
    backgroundColor: colors.surfaceBase,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
  },
  handle: {
    backgroundColor: colors.outlinePerimeter,
  },
  content: {
    padding: spacing.lg16,
  },
})
