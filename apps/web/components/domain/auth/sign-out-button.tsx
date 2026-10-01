'use client'

import { useTransition } from 'react'
import { Button } from '@rqi/ui'
import { signOutAction } from '@/lib/auth/actions'

export function SignOutButton({ disabled }: { disabled?: boolean }) {
  const [pending, startTransition] = useTransition()

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      loading={pending}
      disabled={disabled}
      onClick={() => startTransition(async () => signOutAction())}
    >
      Sign out
    </Button>
  )
}
