import { StyleSheet, TextInput, type TextInputProps } from 'react-native'
import { colors, layout, radius, spacing, typeScale } from '@/theme/tokens'

export interface InputProps extends TextInputProps {
  invalid?: boolean
}

/** §4.10 form input: 44px height, white background, hairline border, 2px
 * focus ring (approximated with a border-color swap on focus — RN has no
 * native `:focus` pseudo-selector). */
export function Input({ invalid, style, onFocus, onBlur, ...rest }: InputProps) {
  return (
    <TextInput
      style={[styles.input, invalid && styles.invalid, style]}
      placeholderTextColor={colors.textMuted}
      aria-invalid={invalid}
      {...rest}
    />
  )
}

const styles = StyleSheet.create({
  input: {
    height: layout.inputHeight,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.outlinePerimeter,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md12,
    color: colors.tertiary,
    ...typeScale.bodyMd,
  },
  invalid: {
    borderColor: colors.errorText,
  },
})
