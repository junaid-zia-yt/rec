import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '../lib/cn'
import { Button } from './button'

/** Dialog — Level 3 modal, reserved for actions needing a documented reason (docs/04-design-system.md §4.13). */
export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger

export function DialogContent({
  className,
  children,
  title,
  description,
}: {
  className?: string
  children: React.ReactNode
  title: string
  description?: string
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="bg-tertiary/40 data-[state=open]:animate-in data-[state=open]:fade-in fixed inset-0 z-50" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2',
          'rounded-card border-outline-cell shadow-level-3-modal border bg-white p-6',
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <DialogPrimitive.Title className="font-display text-tertiary text-lg font-semibold">
              {title}
            </DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="text-muted mt-1 text-sm">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close asChild>
            <button
              aria-label="Close dialog"
              className="rounded-control text-muted hover:bg-canvas focus-visible:ring-secondary p-1 focus-visible:outline-none focus-visible:ring-2"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

/**
 * ConfirmationDialog — the two-step human-confirmation pattern required for
 * gate disqualification / shortlist sign-off style actions
 * (docs/04-design-system.md's Sticky Approval Bottom Sheet, desktop/dialog variant).
 */
export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Drawer — a side-anchored panel for desktop secondary content. */
export function Drawer({
  open,
  onOpenChange,
  title,
  children,
  side = 'right',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: React.ReactNode
  side?: 'left' | 'right'
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="bg-tertiary/40 fixed inset-0 z-50" />
        <DialogPrimitive.Content
          className={cn(
            'shadow-level-3-modal fixed top-0 z-50 h-full w-full max-w-sm bg-white p-6',
            side === 'right' ? 'right-0' : 'left-0',
          )}
        >
          <div className="mb-4 flex items-center justify-between">
            <DialogPrimitive.Title className="font-display text-tertiary text-lg font-semibold">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <button aria-label="Close" className="rounded-control text-muted hover:bg-canvas p-1">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/**
 * BottomSheet — mobile equivalent of Drawer, anchored to the bottom, matching
 * the Stitch "Sticky Approval Bottom Sheet" pattern (docs/04-design-system.md).
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: React.ReactNode
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="bg-tertiary/40 fixed inset-0 z-50" />
        <DialogPrimitive.Content
          className={cn(
            'rounded-t-card border-outline-perimeter fixed inset-x-0 bottom-0 z-50 border-t',
            'shadow-level-3-sheet bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]',
          )}
        >
          <div className="bg-outline-cell mx-auto mb-3 h-1 w-10 rounded-full" aria-hidden="true" />
          <DialogPrimitive.Title className="font-display text-tertiary text-base font-semibold">
            {title}
          </DialogPrimitive.Title>
          <div className="mt-3">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
