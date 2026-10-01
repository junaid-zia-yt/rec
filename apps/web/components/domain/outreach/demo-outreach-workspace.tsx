'use client'

import { useState, useTransition } from 'react'
import { Alert, Button, Card, CardBody, SectionHeader, StatusBadge } from '@rqi/ui'
import {
  createDemoOutreachDraftAction,
  decideDemoOutreachDraftAction,
} from '@/lib/demo/demo-actions'

export interface DemoOutreachCandidateOption {
  id: string
  projectId: string
  fullName: string
  roleTitle: string
}

export interface DemoOutreachTemplateOption {
  id: string
  channel: 'email' | 'linkedin' | 'sms'
  name: string
}

export interface DemoOutreachDraftRow {
  id: string
  projectId: string
  candidateId: string
  candidateName: string
  roleTitle: string
  channel: 'email' | 'linkedin' | 'sms'
  subject: string | null
  body: string
  status: 'draft' | 'approved_not_sent' | 'rejected'
  createdAt: string
}

/**
 * Build Phase 18 priority #7 ("Implement outreach drafting and approval in
 * demo mode"). Replaces the Build Phase 1 static empty state (see
 * docs/client-feedback-reproduction-report.md §6 — this screen never
 * rendered anything, no matter what the demo data contained, because no
 * mock outreach activity existed at all). Only eligible candidates can be
 * drafted for (enforced server-side in lib/demo/engine.ts's
 * createDemoOutreachDraft — the "eligible" filter here is a UX
 * convenience, not the authority). No external provider is ever called:
 * "approve" is a pure state transition
 * (lib/demo/engine.ts's decideDemoOutreachDraft), never a send.
 */
export function DemoOutreachWorkspace({
  eligibleCandidates,
  templates,
  drafts,
}: {
  eligibleCandidates: DemoOutreachCandidateOption[]
  templates: DemoOutreachTemplateOption[]
  drafts: DemoOutreachDraftRow[]
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [selectedCandidateId, setSelectedCandidateId] = useState(eligibleCandidates[0]?.id ?? '')
  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0]?.id ?? '')

  function generateDraft() {
    const candidate = eligibleCandidates.find((c) => c.id === selectedCandidateId)
    if (!candidate || !selectedTemplateId) return
    const fd = new FormData()
    fd.set('projectId', candidate.projectId)
    fd.set('candidateId', candidate.id)
    fd.set('templateId', selectedTemplateId)
    startTransition(async () => {
      const result = await createDemoOutreachDraftAction(fd)
      setMessage({ tone: result.success ? 'success' : 'danger', text: result.message ?? '' })
    })
  }

  function decide(draftId: string, decision: 'approve' | 'reject') {
    const fd = new FormData()
    fd.set('draftId', draftId)
    fd.set('decision', decision)
    startTransition(async () => {
      const result = await decideDemoOutreachDraftAction(fd)
      setMessage({ tone: result.success ? 'success' : 'danger', text: result.message ?? '' })
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <Alert tone="warning" title="Demo mode — messages are not sent.">
        Approving a draft below only records a human decision in the audit log. No email,
        LinkedIn or SMS provider is ever called from this environment.
      </Alert>

      {message && <Alert tone={message.tone} title={message.text} />}

      <Card>
        <CardBody className="flex flex-col gap-3">
          <SectionHeader title="Draft new outreach" />
          {eligibleCandidates.length === 0 ? (
            <p className="text-muted text-sm">
              No candidate has passed every mandatory requirement yet. Outreach can only be
              drafted for a candidate who is eligible — run an evaluation first.
            </p>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex flex-1 flex-col gap-1 text-xs font-medium">
                Candidate
                <select
                  className="border-outline-perimeter rounded-control h-9 border px-2 text-sm"
                  value={selectedCandidateId}
                  onChange={(e) => setSelectedCandidateId(e.target.value)}
                >
                  {eligibleCandidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName} — {c.roleTitle}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-1 flex-col gap-1 text-xs font-medium">
                Template
                <select
                  className="border-outline-perimeter rounded-control h-9 border px-2 text-sm"
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button disabled={pending} loading={pending} onClick={generateDraft}>
                Generate draft
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      <section className="flex flex-col gap-3">
        <SectionHeader title={`Drafts (${drafts.length})`} />
        {drafts.length === 0 ? (
          <Card>
            <CardBody className="text-muted text-sm">No outreach drafts yet.</CardBody>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {drafts.map((draft) => (
              <Card key={draft.id}>
                <CardBody className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-tertiary text-sm font-semibold">
                        {draft.candidateName} · {draft.roleTitle}
                      </p>
                      <p className="text-muted text-xs uppercase tracking-wide">{draft.channel}</p>
                    </div>
                    <StatusBadge
                      status={
                        draft.status === 'approved_not_sent'
                          ? 'passed'
                          : draft.status === 'rejected'
                            ? 'failed'
                            : 'pending'
                      }
                    >
                      {draft.status.replace(/_/g, ' ')}
                    </StatusBadge>
                  </div>
                  {draft.subject && (
                    <p className="text-tertiary text-xs font-medium">Subject: {draft.subject}</p>
                  )}
                  <p className="text-muted whitespace-pre-line text-xs">{draft.body}</p>
                  {draft.status === 'draft' && (
                    <div className="flex gap-2">
                      <Button size="sm" disabled={pending} onClick={() => decide(draft.id, 'approve')}>
                        Approve (not sent)
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => decide(draft.id, 'reject')}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                  {draft.status === 'approved_not_sent' && (
                    <p className="text-muted text-xs italic">
                      Approved — demo mode, no message was sent.
                    </p>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
