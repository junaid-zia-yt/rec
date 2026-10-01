'use client'

import { useState, useTransition } from 'react'
import { Button, Card, CardBody, FormField, Input } from '@rqi/ui'
import { createClientAction, updateClientAction } from '@/lib/clients/actions'
import type { Client } from '@rqi/types'

/** Create/edit client form — Build Phase 3 brief §"Client management". Same component for both: passing `client` switches it into edit mode. */
export function ClientForm({
  organizationId,
  client,
  onSaved,
}: {
  organizationId: string
  client?: Client
  onSaved?: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = client
        ? await updateClientAction(formData)
        : await createClientAction(formData)
      setMessage({
        tone: result.success ? 'success' : 'danger',
        text: result.message ?? (result.success ? 'Saved.' : 'Something went wrong.'),
      })
      if (result.success) onSaved?.()
    })
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        {message && (
          <p
            role={message.tone === 'danger' ? 'alert' : 'status'}
            className={
              message.tone === 'danger'
                ? 'rounded-card bg-danger-bg text-danger px-3 py-2 text-sm font-medium'
                : 'rounded-card bg-primary-container text-primary px-3 py-2 text-sm font-medium'
            }
          >
            {message.text}
          </p>
        )}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <input type="hidden" name="organizationId" value={organizationId} />
          {client && <input type="hidden" name="clientId" value={client.id} />}
          <FormField label="Client name" htmlFor="client-form-name" required>
            <Input
              id="client-form-name"
              name="name"
              required
              defaultValue={client?.name}
              placeholder="e.g. Northfield Retail Group"
            />
          </FormField>
          <FormField
            label="Vertical"
            htmlFor="client-form-vertical"
            hint="e.g. Retail, Convenience Store, Food Service"
          >
            <Input id="client-form-vertical" name="vertical" defaultValue={client?.vertical} />
          </FormField>
          <FormField label="Primary contact name" htmlFor="client-form-contact-name">
            <Input
              id="client-form-contact-name"
              name="primaryContactName"
              defaultValue={client?.primaryContactName ?? ''}
            />
          </FormField>
          <FormField label="Primary contact email" htmlFor="client-form-contact-email">
            <Input
              id="client-form-contact-email"
              name="primaryContactEmail"
              type="email"
              defaultValue={client?.primaryContactEmail ?? ''}
            />
          </FormField>
          <FormField label="Primary contact phone" htmlFor="client-form-contact-phone">
            <Input
              id="client-form-contact-phone"
              name="primaryContactPhone"
              type="tel"
              defaultValue={client?.primaryContactPhone ?? ''}
            />
          </FormField>
          <Button type="submit" loading={pending} className="w-full">
            {client ? 'Save changes' : 'Create client'}
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}
