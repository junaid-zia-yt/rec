import type { PropsWithChildren } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { colors, spacing, typeScale } from '@/theme/tokens'

export function FormField({ label, children }: PropsWithChildren<{ label: string }>) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.xs4,
  },
  label: {
    ...typeScale.labelMd,
    color: colors.tertiary,
    textTransform: 'none',
  },
})
