'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { Alert, Button, FormField, Select, StatusBadge } from '@rqi/ui'
import type { CsvRowValidation } from '@rqi/types'
import { parseCandidateCsv } from '@/lib/candidates/csv-import'
import { importCandidatesFromCsvAction } from '@/lib/candidates/actions'

/**
 * CSV import review — Build Phase 5 brief §"Candidate creation" ("CSV
 * import") + §UI ("CSV import review"). Parsing and per-row validation both
 * happen client-side (lib/candidates/csv-import.ts, the same pure function
 * the server re-validates with) so a recruiter can see and fix problems
 * before anything is committed; nothing is written until "Import valid
 * rows" is pressed, and only the rows marked valid at that point are sent.
 */
export function CsvImportReview({
  organizationId,
  projects,
}: {
  organizationId: string
  projects: { id: string; name: string; clientId: string }[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [rows, setRows] = useState<CsvRowValidation[]>([])
  const [headerError, setHeaderError] = useState<string | null>(null)
  const [projectId, setProjectId] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selectedProject = projects.find((p) => p.id === projectId)
  const validCount = rows.filter((r) => r.valid).length

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const result = parseCandidateCsv(text)
    setHeaderError(result.headerError)
    setRows(result.rows)
    setMessage(null)
  }

  function handleImport() {
    const validRows = rows.filter((r) => r.valid).map((r) => r.row)
    if (validRows.length === 0) return

    const formData = new FormData()
    formData.set('organizationId', organizationId)
    formData.set('rows', JSON.stringify(validRows))
    if (selectedProject) {
      formData.set('projectId', selectedProject.id)
      formData.set('projectClientId', selectedProject.clientId)
    }

    startTransition(async () => {
      const result = await importCandidatesFromCsvAction(formData)
      setMessage({
        tone: result.success ? 'success' : 'danger',
        text: result.message ?? 'Something went wrong.',
      })
      if (result.success) {
        setRows([])
        if (fileInputRef.current) fileInputRef.current.value = ''
        router.push('/candidates')
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
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

      <FormField
        label="CSV file"
        htmlFor="csv-file"
        hint="Columns: full_name (required), email, phone, current_title, current_company, location."
      >
        <input
          ref={fileInputRef}
          id="csv-file"
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          className="text-tertiary file:bg-secondary file:rounded-control w-full text-sm file:mr-3 file:border-0 file:px-3 file:py-2 file:text-sm file:text-white"
        />
      </FormField>

      <FormField label="Assign imported candidates to a project (optional)" htmlFor="csv-project">
        <Select
          value={projectId}
          onValueChange={setProjectId}
          options={[
            { value: '', label: 'Not assigned yet' },
            ...projects.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
      </FormField>

      {headerError && (
        <Alert tone="danger" title="This file can't be read">
          {headerError}
        </Alert>
      )}

      {rows.length > 0 && (
        <>
          <div className="border-outline-cell overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                CSV import review — one row per candidate to be imported
              </caption>
              <thead className="bg-canvas text-muted text-xs uppercase">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Row
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Name
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Email
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Title
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-outline-cell divide-y">
                {rows.map((row) => (
                  <tr key={row.row.rowNumber}>
                    <td className="text-muted px-3 py-2">{row.row.rowNumber}</td>
                    <td className="text-tertiary px-3 py-2">{row.row.fullName || '—'}</td>
                    <td className="text-muted px-3 py-2">{row.row.primaryEmail || '—'}</td>
                    <td className="text-muted px-3 py-2">{row.row.currentTitle || '—'}</td>
                    <td className="px-3 py-2">
                      {row.valid ? (
                        <StatusBadge status="passed">Valid</StatusBadge>
                      ) : (
                        <StatusBadge status="failed" title={row.errors.join('; ')}>
                          {row.errors[0] ?? 'Invalid'}
                        </StatusBadge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-muted text-sm">
              {validCount} of {rows.length} row(s) valid and ready to import.
            </p>
            <Button
              type="button"
              onClick={handleImport}
              loading={pending}
              disabled={validCount === 0}
            >
              Import valid rows
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
