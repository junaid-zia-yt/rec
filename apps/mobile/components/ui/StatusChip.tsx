import { StyleSheet, Text, View } from 'react-native'
import { radius, spacing, statusColors, typeScale, type StatusColorKey } from '@/theme/tokens'

/**
 * §4.14 status chip. Never color-only (§4.18 accessibility note): always
 * pairs the color with a text label, and callers should pass a `label`
 * that already reads unambiguously without color (e.g. "Passed", not just
 * a checkmark) — this component does not invent icon glyphs since no icon
 * set is finalized yet (§4.8 [UNDETERMINED]).
 */
export function StatusChip({ status, label }: { status: StatusColorKey; label: string }) {
  const tone = statusColors[status]
  return (
    <View style={[styles.chip, { backgroundColor: tone.bg, borderColor: tone.border }]}>
      <Text style={[styles.label, { color: tone.text }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md12,
    paddingVertical: spacing.xs4,
  },
  label: {
    ...typeScale.labelMd,
  },
})
