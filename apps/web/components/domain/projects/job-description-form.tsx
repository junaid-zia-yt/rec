'use client'

import { useRef, useState, useTransition } from 'react'
import { Button, FormField, Textarea } from '@rqi/ui'
import {
  pasteJobDescriptionAction,
  uploadJobDescriptionAction,
} from '@/lib/job-descriptions/actions'

/** Job-description intake — Build Phase 3 brief §"Job-description intake": paste text, or upload a PDF/DOCX. Only approved formats are accepted client-side too (a courtesy check — the server action re-validates independently and is the actual gate). */
export function JobDescriptionForm({
  organizationId,
  projectId,
  projectClientId,
  jobId,
}: {
  organizationId: string
  projectId: string
  projectClientId: string
  jobId: string
}) {
  const [mode, setMode] = useState<'paste' | 'upload'>('paste')
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    const formData = new FormData(event.currentTarget)
    formData.set('organizationId', organizationId)
    formData.set('projectId', projectId)
    formData.set('projectClientId', projectClientId)
    formData.set('jobId', jobId)

    startTransition(async () => {
      const result =
        mode === 'paste'
          ? await pasteJobDescriptionAction(formData)
          : await uploadJobDescriptionAction(formData)
      setMessage({
        tone: result.success ? 'success' : 'danger',
        text: result.message ?? (result.success ? 'Saved.' : 'Something went wrong.'),
      })
      if (result.success) formRef.current?.reset()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="border-outline-cell inline-flex w-fit rounded-full border p-1">
        <button
          type="button"
          onClick={() => setMode('paste')}
          aria-pressed={mode === 'paste'}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
            mode === 'paste' ? 'bg-secondary text-white' : 'text-muted'
          }`}
        >
          Paste text
        </button>
        <button
          type="button"
          onClick={() => setMode('upload')}
          aria-pressed={mode === 'upload'}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
            mode === 'upload' ? 'bg-secondary text-white' : 'text-muted'
          }`}
        >
          Upload file
        </button>
      </div>

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

      <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {mode === 'paste' ? (
          <FormField label="Job description text" htmlFor="jd-text" required>
            <Textarea
              id="jd-text"
              name="text"
              rows={12}
              required
              placeholder="Paste the full job description here…"
            />
          </FormField>
        ) : (
          <FormField
            label="Job description file"
            htmlFor="jd-file"
            required
            hint="PDF or Word (.docx), up to 10 MB. Executable files are always rejected."
          >
            <input
              id="jd-file"
              name="file"
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              required
              className="text-tertiary file:bg-secondary file:rounded-control w-full text-sm file:mr-3 file:border-0 file:px-3 file:py-2 file:text-sm file:text-white"
            />
          </FormField>
        )}

        <div className="flex justify-end">
          <Button type="submit" loading={pending}>
            {mode === 'paste' ? 'Save job description' : 'Upload job description'}
          </Button>
        </div>
      </form>
    </div>
  )
}
