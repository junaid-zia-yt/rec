import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import * as SelectPrimitive from '@radix-ui/react-select'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '../lib/cn'

/** Input — 44px universal touch-safe height (docs/20-decision-register.md D-15). */
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'rounded-control border-outline-perimeter text-tertiary h-11 w-full border bg-white px-3 text-sm',
      'placeholder:text-placeholder',
      'focus-visible:ring-secondary focus-visible:border-secondary focus-visible:outline-none focus-visible:ring-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'aria-[invalid=true]:border-danger',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'rounded-control border-outline-perimeter text-tertiary min-h-24 w-full border bg-white px-3 py-2 text-sm',
      'placeholder:text-placeholder',
      'focus-visible:ring-secondary focus-visible:border-secondary focus-visible:outline-none focus-visible:ring-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

/** SearchField — Input with a leading search icon, used for candidate/project search. */
export const SearchField = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <div className="relative">
    <Search
      className="text-muted pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
      aria-hidden="true"
    />
    <Input ref={ref} type="search" className={cn('pl-9', className)} {...props} />
  </div>
))
SearchField.displayName = 'SearchField'

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'border-outline-perimeter h-4 w-4 shrink-0 rounded-sm border bg-white',
      'focus-visible:ring-secondary focus-visible:outline-none focus-visible:ring-2',
      'data-[state=checked]:bg-secondary data-[state=checked]:border-secondary',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-white">
      <Check className="h-3 w-3" aria-hidden="true" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = 'Checkbox'

export const RadioGroup = RadioGroupPrimitive.Root

export const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    className={cn(
      'border-outline-perimeter h-4 w-4 shrink-0 rounded-full border bg-white',
      'focus-visible:ring-secondary focus-visible:outline-none focus-visible:ring-2',
      'data-[state=checked]:border-secondary',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
      <span className="bg-secondary h-2 w-2 rounded-full" />
    </RadioGroupPrimitive.Indicator>
  </RadioGroupPrimitive.Item>
))
RadioGroupItem.displayName = 'RadioGroupItem'

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent',
      'bg-outline-perimeter data-[state=checked]:bg-secondary transition-colors',
      'focus-visible:ring-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'shadow-level-1 block h-5 w-5 rounded-full bg-white transition-transform',
        'data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0.5',
      )}
    />
  </SwitchPrimitive.Root>
))
Switch.displayName = 'Switch'

export interface SelectOption {
  value: string
  label: string
}

export function Select({
  options,
  placeholder,
  ...props
}: {
  options: SelectOption[]
  placeholder?: string
} & React.ComponentPropsWithoutRef<typeof SelectPrimitive.Root>) {
  return (
    <SelectPrimitive.Root {...props}>
      <SelectPrimitive.Trigger
        className={cn(
          'rounded-control border-outline-perimeter flex h-11 w-full items-center justify-between border',
          'text-tertiary bg-white px-3 text-sm',
          'focus-visible:ring-secondary focus-visible:outline-none focus-visible:ring-2',
          'data-[placeholder]:text-placeholder',
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="text-muted h-4 w-4" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="rounded-control border-outline-cell shadow-level-2 z-50 overflow-hidden border bg-white"
          position="popper"
          sideOffset={4}
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className={cn(
                  'rounded-badge relative flex h-9 cursor-pointer select-none items-center px-3 text-sm',
                  'data-[highlighted]:bg-canvas outline-none data-[state=checked]:font-medium',
                )}
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

/** FormField — label + control + help/error text, the composition every form uses. */
export function FormField({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-tertiary text-sm font-medium">
        {label}
        {required && (
          <span className="text-danger" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && <p className="text-muted text-xs">{hint}</p>}
      {error && (
        <p className="text-danger text-xs font-medium" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
