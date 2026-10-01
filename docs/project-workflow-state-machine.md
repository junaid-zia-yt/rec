# Project workflow state machine

**Build Phase 18.** Defines the canonical recruitment-project lifecycle referenced throughout the Build Phase 18 client-feedback repair (`docs/build-phase-18-client-feedback-repair-report.md`), and reconciles the brief's suggested granular lifecycle with the schema the codebase already ships.

## Why this document exists

Dave's feedback item "Project flow" traced back to a concrete defect (`docs/client-feedback-reproduction-report.md` §4): the project detail page's `WorkflowStepper` was a hardcoded array —

```ts
steps={[
  { label: 'Intake', status: 'complete' },
  { label: 'Requirements', status: 'complete' },
  { label: 'Scorecard', status: 'complete' },
  ...
]}
```

— so every project showed "Intake / Requirements / Scorecard" as permanently complete, regardless of what had actually happened. The `recruitment_projects.status` column was real (`supabase/migrations/0009`, `packages/types`) but nothing ever wrote to it, and nothing validated a transition before writing to it.

## Design decision: keep the existing enum, add two layers on top of it

The Build Phase 18 brief suggested a longer, more granular status list (Draft / Requirements pending / Scorecard pending / Sourcing / Shortlisting / Client review / Closed / Archived, or similar). Per the project instructions ("Do not redesign the interface without explaining why" and "reconcile the finding... rather than blindly adopting suggested names"), this build phase did **not** replace the existing 5-value database enum. Migrating a live column's enum is a schema change with real data-migration cost, and the actual defect (a stepper that lied) does not require it.

Instead, `apps/web/lib/projects/workflow-state-machine.ts` adds two things the codebase was missing:

### 1. A transition table — coarse status, server-enforced

```ts
export const PROJECT_STATUSES: ProjectStatus[] = [
  'intake', 'sourcing', 'shortlisting', 'client_review', 'closed',
]

export const PROJECT_STATUS_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  intake:         ['sourcing', 'closed'],
  sourcing:       ['shortlisting', 'closed'],
  shortlisting:   ['client_review', 'closed'],
  client_review:  ['closed'],
  closed:         [],
}
```

Every edge is forward-only except "close," which is reachable from any state (an agency can cancel a role at any time). Reopening a closed project, or moving shortlisting back to sourcing, is a deliberate business decision the UI must express explicitly — this table never allows it silently.

`validateProjectStatusTransition(current, next, signals)` checks the edge exists **and** that the real-world precondition for that edge is met:

| Transition | Required signal |
|---|---|
| `intake` → `sourcing` | `scorecardApproved` |
| `sourcing` → `shortlisting` | `hasEvaluatedCandidate` (at least one completed evaluation) |
| `shortlisting` → `client_review` | `shortlistSubmitted` |
| anything → `closed` | always allowed |

This function is called from both the live path (a future live `transitionProjectStatusAction`, not yet wired to a UI control — see Known limitations) and the demo path (`lib/demo/engine.ts`'s `transitionDemoProjectStatus`, wired to `transitionDemoProjectStatusAction`). Both paths call the exact same function.

### 2. A finer-grained, signal-derived stage display

The brief's real ask — "the stepper should reflect the true state of the project" — is served by a second, independent function:

```ts
export function computeWorkflowStageStatuses(signals: WorkflowStageSignals): WorkflowStepDisplay[]
```

It derives seven stage statuses (`jd`, `requirements`, `scorecard`, `candidates`, `evaluation`, `shortlist`, `outreach`) from real signals — never a hardcoded array:

```ts
interface WorkflowStageSignals {
  jobDescriptionAdded: boolean
  requirementsConfirmed: boolean
  scorecardApproved: boolean
  candidatesAdded: boolean
  candidatesEvaluated: boolean
  eligibleCandidateExists: boolean
  shortlistBuilt: boolean
  outreachDrafted: boolean
}
```

Each step is `complete` if its signal is true; the first false signal becomes `current`; everything after it is `upcoming`. In the private demo, `apps/web/lib/demo/engine.ts`'s `getDemoProjectStageSignals(projectId)` computes these signals from the actual in-memory candidate/evaluation/shortlist/outreach state and feeds them to `computeWorkflowStageStatuses` — so the stepper on `/projects/[projectId]` now genuinely reflects what has happened in that browser session, not a fixed narrative.

## Where this is wired in

- `apps/web/app/(app)/projects/[projectId]/page.tsx` — demo-mode branch calls `getDemoProjectStageSignals` and renders its result through the shared `WorkflowStepper` component; live-mode branch is unchanged (still the Build Phase 1 fixed six-step array pending a live-mode signal loader — see Known limitations).
- `apps/web/lib/demo/engine.ts`'s `transitionDemoProjectStatus` — calls `validateProjectStatusTransition` before writing `project.status`, and records an audit + activity entry either way.
- `apps/web/lib/demo/demo-actions.ts`'s `transitionDemoProjectStatusAction` — the `'use server'` wrapper Zod-validates the target status against the same 5-value enum before calling the engine function.

## Negative-test coverage

`apps/web/lib/demo/engine.test.ts` (`describe('demo engine — project status transitions')`) asserts:

- An invalid edge (`intake` → `client_review`) is rejected.
- A structurally valid edge whose precondition is unmet (`sourcing` → `shortlisting` with zero evaluated candidates) is rejected.
- A valid edge whose precondition is met succeeds.

## Known limitations

- **Live-mode UI**: the project detail page's live-mode branch still renders the Build Phase 1 fixed six-item stepper — `computeWorkflowStageStatuses` is not yet fed by a live-mode signal loader (would require a new query joining jobs/requirements/scorecards/candidates/shortlists/outreach for the project). The **demo-mode** stepper, which is what Dave evaluated, is fully live-computed. Wiring the live-mode loader is a follow-up, not a blocker for demo sign-off.
- **No UI control to transition status yet**: `transitionDemoProjectStatusAction` exists and is tested, but no button on `/projects/[projectId]` currently calls it — project status currently only advances implicitly (it starts at `sourcing` for both seeded demo projects). A "Move to shortlisting" / "Submit for client review" control is a natural next addition once a recruiter workflow needs it explicitly, rather than inferring it from other actions.
