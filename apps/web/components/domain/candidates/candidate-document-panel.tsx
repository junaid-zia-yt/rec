'use client'

import { useRef, useState, useTransition } from 'react'
import { Button, Card, FormField, Select, StatusBadge } from '@rqi/ui'
import type { CandidateDocument } from '@rqi/types'
import { uploadCandidateDocumentAction } from '@/lib/candidates/actions'

const DOC_TYPE_OPTIONS = [
  { value: 'cv', label: 'CV / Resume' },
  { value: 'cover_letter', label: 'Cover letter' },
  { value: 'reference', label: 'Reference' },
  { value: 'other', label: 'Other' },
]

/** CV upload + document version history — Build Phase 5 brief §"CV document management" / §UI: "CV upload", "Candidate document history". A new upload of the same doc type supersedes the prior version rather than deleting it. */
export function CandidateDocumentPanel({
  organizationId,
  candidateId,
  documents,
  canEdit,
}: {
  organizationId: string
  candidateId: string
  documents: CandidateDocument[]
  canEdit: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    const formData = new FormData(event.currentTarget)
    formData.set('organizationId', organizationId)
    formData.set('candidateId', candidateId)

    startTransition(async () => {
      const result = await uploadCandidateDocumentAction(formData)
      setMessage({
        tone: result.success ? 'success' : 'danger',
        text: result.message ?? 'Something went wrong.',
      })
      if (result.success) formRef.current?.reset()
    })
  }

  const byType = documents.reduce<Record<string, CandidateDocument[]>>((acc, doc) => {
    acc[doc.docType] = [...(acc[doc.docType] ?? []), doc]
    return acc
  }, {})

  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Document type" htmlFor="doc-type">
              <Select name="docType" defaultValue="cv" options={DOC_TYPE_OPTIONS} />
            </FormField>
            <FormField
              label="File"
              htmlFor="doc-file"
              required
              hint="PDF or Word (.docx), up to 10 MB."
            >
              <input
                id="doc-file"
                name="file"
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                required
                className="text-tertiary file:bg-secondary file:rounded-control w-full text-sm file:mr-3 file:border-0 file:px-3 file:py-2 file:text-sm file:text-white"
              />
            </FormField>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={pending}>
              Upload
            </Button>
          </div>
        </form>
      )}

      {documents.length === 0 ? (
        <p className="text-muted text-sm">No documents uploaded yet.</p>
      ) : (
        Object.entries(byType).map(([docType, docs]) => (
          <Card key={docType}>
            <div className="divide-outline-cell flex flex-col divide-y">
              {[...docs]
                .sort((a, b) => b.versionNo - a.versionNo)
                .map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-tertiary truncate text-sm font-medium">{doc.fileName}</p>
                      <p className="text-muted text-xs">
                        v{doc.versionNo} · {(doc.sizeBytes / 1024).toFixed(0)} KB
                      </p>
                    </div>
                    <StatusBadge status={doc.status === 'active' ? 'passed' : 'neutral'}>
                      {doc.status}
                    </StatusBadge>
                  </div>
                ))}
            </div>
          </Card>
        ))
      )}
    </div>
  )
}
