'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, FormField, Input, Select } from '@rqi/ui'
import type { Role } from '@rqi/types'
import type { CopilotProjectOption } from '@/lib/copilot/load'
import { startCopilotConversationAction } from '@/lib/copilot/copilot-actions'

/**
 * "Start a new conversation" form (Build Phase 11 Wave 4, Task C). Mirrors
 * apps/web/components/domain/poc/create-benchmark-form.tsx's exact
 * client-component shape: a controlled Select feeding a hidden input,
 * useTransition around the server action call, router.push to the new
 * conversation on success.
 */
export function CopilotStartForm({
  organizationId,
  role,
  projectOptions,
}: {
  organizationId: string
  role: Role
  projectOptions: CopilotProjectOption[]
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<{ success: boolean; message?: string } | null>(null)
  const [projectId, setProjectId] = useState('')

  // recruiter/client_decision_maker conversations are always pinned to one
  // project (0031's copilot_conversations_scope_by_role CHECK) — the same
  // requirement startCopilotConversationAction enforces server-side. An
  // agency_admin conversation may be org-wide, so the picker is optional
  // for that role only.
  const projectRequired = role === 'recruiter' || role === 'client_decision_maker'
  const canSubmit = !projectRequired || Boolean(projectId)

  if (projectRequired && projectOptions.length === 0) {
    return (
      <Alert
        tone="warning"
        title="No recruitment project is available to scope a conversation to."
      />
    )
  }

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(formRef.current!)
        if (!projectId) fd.delete('recruitmentProjectId')
        startTransition(async () => {
          const outcome = await startCopilotConversationAction(fd)
          setResult(outcome)
          if (outcome.success && outcome.conversationId) {
            router.push(`/copilot/${outcome.conversationId}`)
          }
        })
      }}
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="recruitmentProjectId" value={projectId} />

      {result && !result.success && (
        <Alert tone="danger" title={result.message ?? 'Could not start this conversation.'} />
      )}

      {projectOptions.length > 0 && (
        <FormField label="Recruitment project" htmlFor="copilot-project" required={projectRequired}>
          <Select
            value={projectId}
            onValueChange={setProjectId}
            options={projectOptions.map((p) => ({ value: p.id, label: p.roleTitle }))}
            placeholder={projectRequired ? 'Select a project' : 'Org-wide (optional)'}
          />
        </FormField>
      )}

      <FormField
        label="Title (optional)"
        htmlFor="copilot-title"
        hint="A short label to help you find this conversation later."
      >
        <Input
          id="copilot-title"
          name="title"
          maxLength={200}
          placeholder="e.g. Store Manager shortlist questions"
        />
      </FormField>

      <div>
        <Button type="submit" variant="primary" disabled={pending || !canSubmit}>
          {pending ? 'Starting…' : 'Start conversation'}
        </Button>
      </div>
    </form>
  )
}
