import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from 'react-native'
import { colors, layout, radius, spacing, typeScale } from '@/theme/tokens'

type Variant = 'primary' | 'secondary' | 'verify' | 'destructive'

export interface ButtonProps extends Omit<PressableProps, 'style'> {
  variant?: Variant
  loading?: boolean
  children: string
}

/**
 * §4.9 button variants: primary (solid secondary/cobalt), verify (solid
 * primary/emerald "verification/pass" action), destructive (outlined
 * error/red), secondary (outlined neutral). Minimum touch target is
 * 48x48px regardless of visual size (§4.9) — baked in here via
 * `minHeight`/`minWidth` + centered content, never left to callers.
 */
export function Button({ variant = 'primary', loading, disabled, children, ...rest }: ButtonProps) {
  const variantStyle = VARIANT_STYLES[variant]

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        variantStyle.container,
        pressed && !disabled && variantStyle.pressed,
        (disabled || loading) && styles.disabled,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variantStyle.text.color as string} />
      ) : (
        <Text style={[styles.label, variantStyle.text]}>{children}</Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    minHeight: layout.minTouchTarget,
    minWidth: layout.minTouchTarget,
    borderRadius: radius.input,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg16,
  },
  label: {
    ...typeScale.bodyMd,
    fontFamily: 'Geist_500Medium',
  },
  disabled: {
    opacity: 0.5,
  },
})

const VARIANT_STYLES = {
  primary: {
    container: { backgroundColor: colors.secondary },
    pressed: { backgroundColor: colors.secondaryActive },
    text: { color: colors.white },
  },
  verify: {
    container: { backgroundColor: colors.primary },
    // [A11Y FIX] was colors.primaryFill (#10B981) — 2.54:1 for white pressed-state
    // text, well under WCAG AA. primaryHover is the darkened, audited shade.
    pressed: { backgroundColor: colors.primaryHover },
    text: { color: colors.white },
  },
  secondary: {
    container: {
      backgroundColor: colors.white,
      borderWidth: 1,
      borderColor: colors.outlinePerimeter,
    },
    pressed: { backgroundColor: colors.surfaceNested },
    text: { color: colors.tertiary },
  },
  destructive: {
    container: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.errorText },
    pressed: { backgroundColor: colors.errorBg },
    text: { color: colors.errorText },
  },
} satisfies Record<Variant, { container: object; pressed: object; text: { color: string } }>
