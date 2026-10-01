import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native'
import { colors, layout, spacing, typeScale } from '@/theme/tokens'

export interface ListItemProps {
  title: string
  subtitle?: string
  trailing?: React.ReactNode
  onPress?: (event: GestureResponderEvent) => void
}

/** A single-row list item (project row, notification row, etc.) meeting
 * the 48x48 minimum touch target by construction. */
export function ListItem({ title, subtitle, trailing, onPress }: ListItemProps) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && onPress ? styles.pressed : null]}
    >
      <View style={styles.textColumn}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.minTouchTarget,
    paddingVertical: spacing.sm8,
    gap: spacing.md12,
  },
  pressed: {
    backgroundColor: colors.surfaceNested,
  },
  textColumn: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typeScale.bodyMd,
    fontFamily: 'Geist_500Medium',
    color: colors.tertiary,
  },
  subtitle: {
    ...typeScale.bodySm,
    color: colors.textMuted,
  },
})
