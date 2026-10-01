'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, FormField, Input, Select, Textarea } from '@rqi/ui'
import { createPocBenchmarkAction } from '@/lib/poc/poc-actions'
import type { PocClientOption } from '@/lib/poc/load'
import { stripEmptyFormFields } from './form-data-utils'

/** POC setup — "create benchmark" form (Task C, screen 1 of 9: "POC setup"). */
export function CreateBenchmarkForm({
  organizationId,
  clients,
}: {
  organizationId: string
  clients: PocClientOption[]
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<{ success: boolean; message?: string } | null>(null)
  const [clientId, setClientId] = useState('')

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(formRef.current!)
        const startTimeLocal = fd.get('startTime')
        if (typeof startTimeLocal === 'string' && startTimeLocal) {
          fd.set('startTime', new Date(startTimeLocal).toISOString())
        } else {
          fd.delete('startTime')
        }
        stripEmptyFormFields(fd)
        startTransition(async () => {
          const outcome = await createPocBenchmarkAction(fd)
          setResult(outcome)
          if (outcome.success) {
            formRef.current?.reset()
            setClientId('')
            router.refresh()
          }
        })
      }}
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="clientId" value={clientId} />

      {result && (
        <Alert tone={result.success ? 'success' : 'danger'} title={result.message ?? ''} />
      )}

      <FormField label="Client" htmlFor="poc-client">
        <Select
          value={clientId}
          onValueChange={setClientId}
          options={clients.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="Select a client"
        />
      </FormField>

      <FormField label="Benchmark name" htmlFor="poc-name" required>
        <Input
          id="poc-name"
          name="name"
          placeholder="e.g. Acme Retail — Q3 POC"
          required
          maxLength={300}
        />
      </FormField>

      <FormField
        label="Shared start time"
        htmlFor="poc-start"
        hint="Both processes must start from the same moment (docs/14-poc-specification.md §14.5) — you can set this now or before activating."
      >
        <Input id="poc-start" name="startTime" type="datetime-local" />
      </FormField>

      <FormField label="Notes" htmlFor="poc-notes">
        <Textarea id="poc-notes" name="notes" maxLength={2000} rows={2} />
      </FormField>

      <div>
        <Button type="submit" variant="primary" disabled={pending || !clientId}>
          {pending ? 'Creating…' : 'Create POC benchmark'}
        </Button>
      </div>
    </form>
  )
}
