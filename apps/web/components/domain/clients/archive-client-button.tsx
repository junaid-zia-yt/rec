'use client'

import { useState, useTransition } from 'react'
import { Button } from '@rqi/ui'
import { archiveClientAction } from '@/lib/clients/actions'

export function ArchiveClientButton({
  organizationId,
  clientId,
}: {
  organizationId: string
  clientId: string
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function handleArchive() {
    if (
      !window.confirm(
        'Archive this client? Its data is kept, but it will no longer appear as active.',
      )
    ) {
      return
    }
    setMessage(null)
    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('clientId', clientId)
    startTransition(async () => {
      const result = await archiveClientAction(formData)
      setMessage(result.message ?? null)
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="destructive" onClick={handleArchive} loading={pending}>
        Archive client
      </Button>
      {message && (
        <p role="status" className="text-muted text-xs">
          {message}
        </p>
      )}
    </div>
  )
}
