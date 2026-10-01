import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn'

/**
 * Button — maps to DESIGN.md's Primary / Verification (Pass) / Destructive /
 * Secondary action set (docs/04-design-system.md §4.9). Minimum 48px touch
 * target is enforced by `min-h-12` regardless of visual padding, per the
 * mobile ergonomic-safe-zone requirement.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-control text-sm font-medium transition-colors ' +
    'min-h-12 px-4 disabled:pointer-events-none disabled:opacity-50 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2',
  {
    variants: {
      variant: {
        primary: 'bg-secondary text-white hover:bg-secondary-active',
        verify: 'bg-primary text-white hover:bg-primary-hover',
        destructive: 'border border-danger text-danger bg-white hover:bg-danger-bg',
        secondary: 'border border-outline-perimeter text-tertiary bg-white hover:bg-canvas',
        ghost: 'text-tertiary hover:bg-canvas',
      },
      size: {
        default: 'h-11',
        sm: 'h-9 px-3 text-xs',
        lg: 'h-12 px-6',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean
  /** Render as the single child element (e.g. a Next.js `<Link>`) instead of a `<button>`. */
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, asChild, children, ...props }, ref) => {
    if (asChild) {
      return (
        <Slot
          ref={ref as React.Ref<HTMLElement>}
          className={cn(buttonVariants({ variant, size }), className)}
          {...props}
        >
          {children}
        </Slot>
      )
    }
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && (
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
        )}
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'

export interface IconButtonProps extends ButtonProps {
  label: string
}

/** IconButton — always requires an accessible label; the icon alone is never sufficient. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, label, children, size = 'default', variant = 'ghost', ...props }, ref) => (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      aria-label={label}
      className={cn('aspect-square px-0', className)}
      {...props}
    >
      {children}
    </Button>
  ),
)
IconButton.displayName = 'IconButton'
