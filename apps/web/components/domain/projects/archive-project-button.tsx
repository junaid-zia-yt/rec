'use client'

import { useState, useTransition } from 'react'
import { Button } from '@rqi/ui'
import { archiveProjectAction } from '@/lib/projects/actions'

export function ArchiveProjectButton({
  organizationId,
  projectId,
  clientId,
}: {
  organizationId: string
  projectId: string
  clientId: string
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function handleArchive() {
    if (
      !window.confirm(
        'Archive this project? Its data is kept, but it will no longer appear as active.',
      )
    ) {
      return
    }
    setMessage(null)
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('projectId', projectId)
    formData.set('clientId', clientId)
    startTransition(async () => {
      const result = await archiveProjectAction(formData)
      setMessage(result.message ?? null)
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="destructive" onClick={handleArchive} loading={pending}>
        Archive project
      </Button>
      {message && (
        <p role="status" className="text-muted text-xs">
          {message}
        </p>
      )}
    </div>
  )
}
