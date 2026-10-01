import { StyleSheet, Text, View } from 'react-native'
import { colors, radius, typeScale } from '@/theme/tokens'

/**
 * Minimal initials avatar. No AvatarInitials component existed under
 * components/ui/ yet when this wave started (checked first, per the task
 * brief) — built locally; flagged for reconciliation if the parallel wave
 * lands a near-duplicate. Never circular per §4.6 (avatars are rounded
 * squares, not circles).
 */
export function AvatarInitials({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  return (
    // [A11Y FIX] Decorative monogram — the candidate/user's name is always
    // rendered as real text alongside this avatar, so without hiding it a
    // screen reader announces a redundant, out-of-context "J D" before the
    // actual name (mirrors the web AvatarInitials' `aria-hidden`, badge-avatar.tsx).
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.circle, { width: size, height: size, borderRadius: radius.avatar }]}
    >
      <Text style={[typeScale.labelMd, styles.label]}>{initials || '?'}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  circle: {
    backgroundColor: colors.tertiaryAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: colors.white,
  },
})
