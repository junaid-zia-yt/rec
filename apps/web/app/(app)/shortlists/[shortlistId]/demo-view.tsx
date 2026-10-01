'use client'

import { notFound } from 'next/navigation'
import { useState, useTransition } from 'react'
import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react'
import { Alert, AvatarInitials, Breadcrumbs, Button, Card, CardBody, StatusBadge } from '@rqi/ui'
import {
  markDemoCandidateReviewedAction,
  shortlistDemoCandidateAction,
  removeDemoShortlistCandidateAction,
  submitDemoShortlistAction,
} from '@/lib/demo/demo-actions'

export interface DemoShortlistCandidateRow {
  id: string
  fullName: string
  currentTitle: string | null
  currentCompany: string | null
  reviewStatus: 'pending_review' | 'reviewed'
  isShortlisted: boolean
  shortlistRank: number | null
  evaluation: {
    status: 'completed' | 'failed'
    eligibility: 'eligible' | 'ineligible' | 'pending_verification' | null
    overallScore: number | null
    evidenceCoveragePct: number | null
    gatesPassed: number
    gatesTotal: number
  } | null
}

/**
 * Build Phase 18 (brief priority #4: "Repair the dead 'Continue to
 * Shortlist' action"). Replaces the Build Phase 1 static
 * Verification-Matrix fixture with the demo engine's real candidates for
 * this project — eligible candidates can be marked reviewed and added to
 * the shortlist (server-enforced max 3 / no duplicates / eligible-only, via
 * shortlistDemoCandidateAction -> lib/demo/engine.ts's
 * shortlistDemoCandidate, the SAME rule function the live path uses). See
 * docs/client-feedback-reproduction-report.md §3 — the previous "Continue
 * to Shortlist" button had no onClick at all.
 */
export function ShortlistDemoView({
  shortlistId,
  roleTitle,
  clientName,
  maxCandidates,
  eligible,
  notEligible,
  shortlisted,
  shortlistStatus,
}: {
  shortlistId: string
  roleTitle: string | null
  clientName: string | null
  maxCandidates: number
  eligible: DemoShortlistCandidateRow[]
  notEligible: DemoShortlistCandidateRow[]
  shortlisted: DemoShortlistCandidateRow[]
  shortlistStatus: string
}) {
  if (!roleTitle) notFound()

  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)

  function run(action: () => Promise<{ success: boolean; message?: string }>) {
    startTransition(async () => {
      const result = await action()
      setMessage({ tone: result.success ? 'success' : 'danger', text: result.message ?? '' })
    })
  }

  function markReviewed(candidateId: string) {
    const fd = new FormData()
    fd.set('projectId', shortlistId)
    fd.set('candidateId', candidateId)
    run(() => markDemoCandidateReviewedAction(fd))
  }

  function addToShortlist(candidateId: string) {
    const fd = new FormData()
    fd.set('projectId', shortlistId)
    fd.set('candidateId', candidateId)
    run(() => shortlistDemoCandidateAction(fd))
  }

  function removeFromShortlist(candidateId: string) {
    const fd = new FormData()
    fd.set('projectId', shortlistId)
    fd.set('candidateId', candidateId)
    run(() => removeDemoShortlistCandidateAction(fd))
  }

  function submit() {
    const fd = new FormData()
    fd.set('projectId', shortlistId)
    run(() => submitDemoShortlistAction(fd))
  }

  return (
    <div className="flex flex-col gap-6 pb-28">
      <Breadcrumbs items={[{ label: 'Shortlists', href: '/shortlists' }, { label: roleTitle }]} />

      <div>
        <div className="mb-1 flex items-center gap-2">
          <span className="text-secondary text-xs font-bold uppercase tracking-wide">
            Shortlist workspace (private demo)
          </span>
          <StatusBadge status="pending">{shortlisted.length}/{maxCandidates} shortlisted</StatusBadge>
        </div>
        <h1 className="font-display text-tertiary text-[22px] font-bold leading-7 lg:text-[26px]">
          {roleTitle}
        </h1>
        <p className="text-muted mt-1 text-sm">{clientName}</p>
      </div>

      {message && <Alert tone={message.tone} title={message.text} />}

      <Alert tone="info" title="Demonstration evaluation — live AI is not connected.">
        Gate results and scores below come from the same deterministic pipeline the live system
        uses, run against fictional demo evidence.
      </Alert>

      {/* Current shortlist */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-secondary h-4 w-4" aria-hidden="true" />
          <h2 className="font-display text-tertiary text-sm font-semibold">
            On the shortlist ({shortlisted.length}/{maxCandidates})
          </h2>
        </div>
        {shortlisted.length === 0 ? (
          <Card>
            <CardBody className="text-muted text-sm">
              No candidates on the shortlist yet. Add an eligible, reviewed candidate below.
            </CardBody>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {shortlisted
              .slice()
              .sort((a, b) => (a.shortlistRank ?? 0) - (b.shortlistRank ?? 0))
              .map((row) => (
                <Card key={row.id}>
                  <CardBody className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <AvatarInitials
                        initials={row.fullName
                          .split(' ')
                          .map((p) => p[0])
                          .slice(0, 2)
                          .join('')}
                        tone="secondary"
                      />
                      <div>
                        <p className="text-tertiary text-sm font-semibold">
                          #{row.shortlistRank} {row.fullName}
                        </p>
                        <p className="text-muted text-xs">
                          {row.evaluation?.overallScore ?? '—'}% match ·{' '}
                          {row.evaluation?.evidenceCoveragePct ?? 0}% evidence
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => removeFromShortlist(row.id)}
                    >
                      Remove
                    </Button>
                  </CardBody>
                </Card>
              ))}
          </div>
        )}
        <Button
          disabled={pending || shortlisted.length === 0 || shortlistStatus !== 'draft'}
          loading={pending}
          onClick={submit}
        >
          {shortlistStatus === 'draft' || shortlistStatus === 'not_started'
            ? `Continue to Shortlist (${shortlisted.length} selected)`
            : `Shortlist ${shortlistStatus.replace(/_/g, ' ')}`}
        </Button>
      </section>

      {/* Eligible candidates available to add */}
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-tertiary text-sm font-semibold">
          Eligible candidates ({eligible.length})
        </h2>
        {eligible.length === 0 ? (
          <Card>
            <CardBody className="text-muted text-sm">
              No candidates have passed every mandatory requirement yet. Run an evaluation from a
              candidate&rsquo;s profile first.
            </CardBody>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {eligible
              .filter((c) => !c.isShortlisted)
              .map((row) => (
                <Card key={row.id}>
                  <CardBody className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-tertiary text-sm font-semibold">{row.fullName}</p>
                      <p className="text-muted text-xs">
                        {row.currentTitle ?? 'Unverified'} · {row.currentCompany ?? 'Unverified'}
                      </p>
                      <p className="text-muted mt-1 text-xs">
                        {row.evaluation?.overallScore ?? '—'}% match · {row.evaluation?.gatesPassed}/
                        {row.evaluation?.gatesTotal} gates ·{' '}
                        {row.reviewStatus === 'reviewed' ? 'Reviewed' : 'Pending review'}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {row.reviewStatus !== 'reviewed' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={pending}
                          onClick={() => markReviewed(row.id)}
                        >
                          Mark reviewed
                        </Button>
                      )}
                      <Button
                        size="sm"
                        disabled={pending || row.reviewStatus !== 'reviewed' || shortlisted.length >= maxCandidates}
                        onClick={() => addToShortlist(row.id)}
                      >
                        Add to shortlist
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              ))}
          </div>
        )}
      </section>

      {/* Ineligible / pending candidates — shown honestly, never rankable */}
      {notEligible.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-tertiary text-sm font-semibold">
            Not eligible for this shortlist ({notEligible.length})
          </h2>
          <div className="flex flex-col gap-2">
            {notEligible.map((row) => (
              <Card key={row.id}>
                <CardBody className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-tertiary text-sm font-semibold">{row.fullName}</p>
                    <p className="text-muted text-xs">
                      {row.evaluation ? 'Evaluated' : 'Not evaluated yet'}
                    </p>
                  </div>
                  {row.evaluation?.eligibility === 'ineligible' ? (
                    <StatusBadge status="failed">
                      <XCircle className="mr-1 inline h-3 w-3" aria-hidden="true" />
                      Failed mandatory gate
                    </StatusBadge>
                  ) : (
                    <StatusBadge status="pending">
                      <CheckCircle2 className="mr-1 inline h-3 w-3" aria-hidden="true" />
                      Awaiting evidence
                    </StatusBadge>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
