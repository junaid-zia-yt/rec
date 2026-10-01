'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@rqi/ui'
import { createShortlistAction } from '@/lib/shortlists/shortlist-actions'

export function StartShortlistButton({
  organizationId,
  recruitmentProjectId,
  jobId,
  clientId,
}: {
  organizationId: string
  recruitmentProjectId: string
  jobId: string
  clientId: string
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <Button
      variant="primary"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const fd = new FormData()
          fd.set('organizationId', organizationId)
          fd.set('recruitmentProjectId', recruitmentProjectId)
          fd.set('jobId', jobId)
          fd.set('clientId', clientId)
          const outcome = await createShortlistAction(fd)
          if (outcome.success) router.refresh()
        })
      }
    >
      Start shortlist
    </Button>
  )
}
