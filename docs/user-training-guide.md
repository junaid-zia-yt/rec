# User Training Guide — Recruitment Quality Intelligence

Wave 2, Build Phase 16 ("Preparation for the two-role client POC"). Documentation only.

**Read this first:** every screen, route, and behavior named below is grounded in the real, code-verified 17-step journey trace in `docs/release-readiness.md` and the real screen list in `docs/03-screen-inventory.md` (Build Phase 12/13/14 implementation notes, not the original aspirational per-screen table). Where a workflow was consolidated, descoped, or built differently than the original Stitch design implied, this guide follows what was actually built. As of this writing, this environment has **no live Supabase project, no live Anthropic API key, and no live Resend/Apollo credentials** — training sessions run against whatever real, credentialed staging or production environment exists at the time, not this development sandbox. `docs/uat-plan.md` §1.4 also applies during any hands-on session with this platform: only synthetic data should ever be entered until a go-live decision has been made.

---

## Who this guide is for

Three roles use this platform day to day. Each gets its own section below:

- **Agency Administrator** — org setup, scorecard approval, oversight.
- **Recruiter** — the core, day-to-day workflow. This is the longest section because it is most of the platform's real work.
- **Dave (Client Decision-Maker / client reviewer)** — a plain-language section written for an operator, not an engineer.

Five named subsections — Scorecard Approval Guide, Candidate Evidence-Review Guide, Shortlist Decision Guide, POC Report Explanation, and Escalation Process — appear where they're most relevant and are cross-referenced from every role that touches them.

---

## 1. Agency Administrator

The Agency Administrator role (matrix name `agency_admin`) owns the organization — its clients, users, and every project in it. In practice, on a two-person agency like Dave's, the same person may act as both Agency Administrator and Recruiter; this section covers only what's _additional_ to the Recruiter role below, since Agency Admin is essentially a superset of recruiter capability plus approval and admin actions (`docs/06-roles-permissions.md` §6.1/§6.2).

### Org and user setup

- **Settings → User & role management**: invite users to your organization and assign each one a role (Agency Admin, Recruiter, Client Decision-Maker, Read-Only Reviewer). A Client Decision-Maker's account is scoped to exactly one client via their membership record — they will only ever see that client's projects and shortlists, never another client's, even within your same organization.
- **Settings → Integrations**: connect/disconnect providers (Apollo, email, calendar) and see real connection status, mode, account owner and last-sync time. This detail is visible only to Agency Admin and Platform Admin — every other role sees an honest "ask an agency admin" prompt instead of a blank or misleading list. **TA Tracker will never show as connected** — this is a deliberate, permanent scope decision (the platform does not invent an API for Dave's internal tracker), not a bug to chase.
- **Settings → Jobs**: an oversight screen for background processing jobs (CV parsing, matching runs, etc.) — status counts, a filterable list, and a manual-retry action for a failed job. It never shows a job's raw internal payload or error detail, only a short structured summary.

### Scorecard approval

See the **Scorecard Approval Guide** below — this is one of an Agency Admin's most important recurring actions, since a Recruiter can draft and propose a scorecard but never approve their own.

### Oversight: audit log and analytics

- **Audit log**: every sign-in, client/project/JD/requirement/scorecard/candidate/document-processing/matching/gate-override/review-decision/shortlist/client-decision/outreach/response/POC action is logged with actor, timestamp, and before/after state. Agency Admin sees this **org-wide** (every user's actions); a Recruiter sees only their own actions in the same log. Use this as your first stop whenever you need to reconstruct exactly what happened and when — see the **Escalation Process** below.
- **Analytics dashboard**: pipeline throughput, time-to-shortlist, and gate-fail-rate style metrics. On a freshly started org these will be near-zero — that's expected, not broken.

### Billing and awareness of integrations

Agency Admin holds full billing access (this is one of the few resources where Agency Admin, not Platform Admin, has full control). Awareness point for training: integrations (Apollo, email, calendar) only show real, working status once actually configured and tested with real credentials — **never assume an integration works from its presence in the settings list alone.**

---

## 2. Recruiter — the core day-to-day workflow

This is the detailed, step-by-step guide. It follows the real, code-verified journey in `docs/release-readiness.md` Part A, in order.

### 2.1 Create a project and bring in the job description

1. **Create a client** (if one doesn't already exist), then **create a recruitment project** under it. The project starts in `intake` status.
2. **Add the job description.** There are two paths, and only one is fully wired today:
   - **Paste text** — fully works end to end. Status becomes `parsed` and the text is immediately available to requirement extraction.
   - **Upload a file** (PDF/DOCX) — the file saves, but this environment has no text-extraction library wired in. The screen honestly tells you "text extraction is not yet available in this environment," and the JD stays in `draft` status — it does **not** proceed to requirement extraction. **Always use paste today.** This is a known, previously-disclosed limitation, not something to work around.

### 2.2 Extract and review requirements

3. Run **requirement extraction**. This is AI-assisted: the model proposes mandatory and preferred requirements from the JD text, each stored with `status: proposed` and `ai_generated: true`.
4. Open the **Requirement extraction review** screen and go through every proposed requirement. You can edit, remove, or add requirements manually — manually-added ones sit alongside AI-proposed ones with no special flag, because from here on both are just "the requirements," reviewed by a human either way.

**Why this matters:** nothing from this step becomes binding on its own. It's a draft proposal a human must look at before it ever reaches a scorecard.

### 2.3 Build and submit the scorecard

5. Open the **Scorecard builder** and set weighted criteria for the preferred requirements, plus which requirements are mandatory pass/fail gates. **Weights are set by you, the human — never by AI.** A default weighting can be AI-suggested, but it always lands as an editable draft, never applied automatically.
6. **Submit the scorecard for approval.** You cannot approve your own scorecard — see the **Scorecard Approval Guide** below for what happens next.

### 2.4 Add candidates and parse CVs

7. **Add a candidate.** Only the candidate's name is required; every other field is left blank rather than guessed — this is the "missing information marked unverified" rule applied at the very first data-entry point, before any AI is even involved.
8. **Upload the candidate's CV/document** and trigger **CV parsing**. This runs as a background job (it may take a moment, and its progress is visible) and produces a set of **extracted fields** — proposed values for experience, education, certifications, skills, etc., each tied to a source excerpt from the document.
9. **Review every extracted field before it counts.** See the **Candidate Evidence-Review Guide** below — this is one of the most important human-in-the-loop steps in the whole platform, and it's worth understanding _why_ it exists, not just _how_ to click through it: **the AI never invents evidence.** If the CV doesn't say something, the field stays unverified — it is never filled in with a plausible guess. Only fields you verify or edit, and then explicitly accept, are ever applied to the candidate's real record. A rejected or still-pending field can never leak into scoring.

### 2.5 Run matching: gates, then score

10. **Run a matching evaluation** for the candidate against the project's active scorecard. This produces two things, always in this order:
    - **Mandatory gate results** — a deterministic, rule-based pass/fail/insufficient_evidence for each mandatory requirement. This step is **not** an AI judgment call: the AI only proposes a draft suggestion during CV parsing, but the actual gate result is recomputed by fixed code from the evidence that's actually on file. **Zero evidence always resolves to `insufficient_evidence`, never to a pass** — regardless of what any model suggested.
    - **An evidence-backed match score** — only computed for candidates whose gates all pass. A candidate who fails a mandatory gate has no ranked score at all; they are structurally excluded from the ranked pool, not just ranked low.
11. Open the candidate's **evaluation view** to see the gate results and score breakdown, each mandatory result linked to the specific evidence it rests on. See `docs/08-candidate-scoring.md` for the full formula if you want the underlying detail — but the short version to remember and to explain to others: **overall match score can never be higher than what the mandatory gates allow.** A failed gate is a hard stop, enforced in the scoring logic itself, not just hidden in the UI.

### 2.6 Human quality review and overrides

12. Open **Quality review / score override** (one consolidated panel reached from the Shortlists tab, with an inline decision dialog — not three separate screens) for any candidate needing a human look, especially a borderline one.
13. Record your review decision: confirm, request more evidence, or **override** an AI-suggested criterion score or gate suggestion. **Every override requires a free-text reason** and is recorded with a full audit entry. An override is always shown in the UI as reviewer-adjusted — never presented as if it were raw AI output.
14. **Important interaction to understand:** overriding one gate does not automatically make the candidate eligible. Eligibility is recomputed from _every_ gate's effective result (its override if there is one, otherwise its deterministic result) — a candidate with one overridden-pass gate but another still-failing gate stays ineligible.

### 2.7 Outreach

15. Open **Outreach composer** for an eligible candidate. The AI drafts a personalized message and proposes supporting "evidence" citations pulled from the candidate's record.
16. **Before you approve, a deterministic check has already run automatically**: any evidence citation the draft claims that doesn't actually match the candidate's verified data is stripped out before you ever see it — a draft is never shown to you as evidence-backed when it isn't.
17. **Approve the draft before it sends.** Nothing goes out without this explicit human approval step.
18. Once a candidate replies (by any channel), **record the response** and confirm its classification (interested / not interested / needs follow-up, etc.).

### 2.8 Build and submit the shortlist

19. **Create a shortlist** for the project and add candidates to it. Two hard rules are enforced here, not just suggested:
    - The shortlist is capped at **2–3 candidates** by default (matches Core Principle #9 and Dave's own stated practice). Going beyond that requires a recorded authorizer and reason.
    - **A candidate who failed a mandatory gate cannot be added — full stop.** This is enforced twice: once in the app (with a clear message) and again, independently, at the database layer (a `BEFORE INSERT` trigger that would reject the row even if the app-layer check were somehow bypassed). This is Core Business Rule #6, and it is genuinely unbreakable from the UI.
20. **Submit the shortlist for client review.** Once sent, its internal recruiter notes, scoring methodology internals, and any non-shortlisted candidates stay invisible to the client — see the **Shortlist Decision Guide** for what the client sees from here.

### 2.9 Notes on document safety

Every uploaded CV or JD is treated as **untrusted data** throughout this whole pipeline. Nothing inside a candidate's own document — however it's phrased — can override the system's instructions or get treated as a command. If you ever see a CV that appears to be attempting a prompt-injection-style trick (a "probe" fixture like this exists in the platform's own test data for exactly this reason), it's worth flagging, but the pipeline is built to ignore it by design, not merely to catch it after the fact.

---

## 3. Dave — reading the platform as a client reviewer

_(Written for you directly, not as a technical manual.)_

You have one job on this platform, and it's the same job you already do: **look at a shortlist and decide whether you'd stand behind it.** You never touch the sourcing, the scoring math, or the internal recruiter notes — that's by design, not a missing feature (more on why below).

### What you'll actually see

When a recruiter sends you a shortlist, you'll see 2–3 candidate cards, each showing:

- **An overall match score** — a percentage, similar in spirit to your own algorithm's output.
- **Gates passed** (e.g., "2/2") — whether the candidate cleared every _must-have_ requirement for the role. A candidate who failed even one of these could never have reached you in the first place; the system physically blocks them from reaching a shortlist, at two separate levels of enforcement.
- **Evidence %** — how much of that score is backed by something concrete found in the candidate's actual CV or profile, as opposed to being unverified.
- **Completeness %** — how much of the scorecard has any information at all for this candidate.
- **The recruiter's note** — their own short written summary for you.

### What you will deliberately never see

- **Internal recruiter notes** — the recruiter's private working notes to themselves or their team.
- **Scoring methodology internals** — the weights, the formula, the AI's internal reasoning.
- **Any candidate who wasn't shortlisted or explicitly shared with you** — no long-list, no "also considered" pile.

This is a **deliberate design boundary**, not something the vendor hasn't built yet: it's the same principle you already apply in your own process — you show a client the shortlist, not your entire recruiting notebook. The platform enforces it at the code level (checked directly in the actual rendering code, not just assumed) so it can never leak by accident, even as new screens get added later.

### How to read an evidence-backed match versus your own percentage

Your own algorithm gives you a single number and you trust it because you built it and you know its track record. This platform's number is built differently, and it's worth knowing the difference when you're comparing the two during the POC:

- Every score is **broken into two separate numbers, always shown together**: the match score itself, and the evidence percentage behind it. You should never see one without the other.
- Nothing is scored higher because the AI "thinks" it's a good fit — every point contributing to the score has to trace back to something actually found in the candidate's documents. If it can't find something, that part of the scorecard is marked unverified and contributes zero, not a guess.
- A candidate can never appear on your shortlist with a failed must-have requirement, no matter how good the rest of their profile looks.

The point isn't that this number is "better" than yours in the abstract — the point of the POC is to actually test that side by side, on the same role, at the same time. See the **POC Report Explanation** below for how that comparison gets presented to you.

### Recording your decision

See the **Shortlist Decision Guide** immediately below — it covers exactly what happens when you choose accept, discuss, or reject.

---

## Scorecard Approval Guide

_(Primarily for Agency Admin; useful background for Recruiter too.)_

1. A Recruiter drafts requirements and builds a scorecard (weights, mandatory gates) for a project, then submits it for approval. A Recruiter can never approve their own submission — approval is Agency Admin-only, by design.
2. When you (Agency Admin) open a pending scorecard, you're reviewing the requirement snapshot exactly as the recruiter submitted it — not a live, possibly-since-edited version.
3. **Why weights are human-set, never AI-set:** the AI can propose a _starting_ weighting template when a scorecard is first drafted, but that's always a draft a human has to accept or change — the system never lets an AI-assigned weight become binding on its own. This matters because weights encode judgment calls about what matters most for a role, and that's explicitly a call the project's design reserves for a human (Core Principle #7).
4. **Approve** the scorecard, and it becomes `active` — this is what "frozen version" means: once a version is approved, every field on it except its own status is locked by a database-level rule. It can never be silently edited afterward.
5. **Why re-approval creates a new version instead of mutating history:** if a requirement needs to change after approval, the recruiter drafts a _new_ version instead. The old, approved version stays exactly as it was — because every candidate scored against it needs to stay auditable against the scorecard that actually produced their score. The platform shows "scored against Scorecard v1 (approved [date])" specifically so a later dispute about a score is answerable, not ambiguous.

---

## Candidate Evidence-Review Guide

_(Primarily for Recruiter; relevant background for Agency Admin oversight and — narrower — for Dave, who can see the evidence excerpt behind a shortlisted candidate even though he can never see the underlying CV file itself.)_

Every field the AI extracts from a CV — a job title, a certification, a tenure, anything — carries a **verification status**:

| Status     | What it means                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------ |
| `pending`  | Extracted by AI, not yet looked at by a human. Cannot be applied to the candidate's real record. |
| `verified` | A human confirmed the extracted value is correct as extracted.                                   |
| `edited`   | A human corrected the value; the corrected version is what gets used.                            |
| `rejected` | A human determined the extracted value is wrong or unsupported. It is discarded, not applied.    |

Alongside the status, each field shows:

- **The source excerpt** — the exact text from the candidate's document the AI pulled the value from, so you can check it yourself rather than take the AI's word for it.
- **A confidence score** — how directly the source text supports the value (an explicit stated fact like "managed P&L for 42 units" scores higher than something inferred, like "extensive multi-unit experience").

**Why an unverified field is never silently applied:** this is the single mechanism that makes the platform's "AI never invents evidence" promise real rather than aspirational. Only fields marked `verified` or `edited`, and then explicitly accepted, ever get copied into the candidate's actual profile — a `pending` or `rejected` field structurally cannot reach the record that later feeds scoring or outreach. This was directly verified in this platform's own code: the "accept" action only ever selects fields in exactly those two states.

---

## Shortlist Decision Guide

_(For Dave — the client decision-maker.)_

On a shortlist that's been sent to you, you have exactly three actions available, and no others (no editing, no building, no seeing what didn't make the list):

- **Accept** — you're satisfied with this candidate as a finalist. This is your positive sign-off.
- **Discuss** — you want to talk it through with the recruiter before deciding either way (e.g., a question about fit, timing, or something the evidence doesn't fully answer for you).
- **Reject** — this candidate isn't right for the role, in your judgment.

Each decision can carry a **comment**, which goes back to the recruiter as your explanation or context — this is how a "discuss" or "reject" actually gets acted on: the recruiter reads your comment and follows up, adjusts the search, or brings you an alternative. Your decision and comment are both recorded permanently against this shortlist, so there's always a record of what you decided and why, alongside the recruiter's own audit trail.

Nothing about your decision retroactively changes the candidate's score or evidence — those are fixed at the point they were computed. Your decision is a separate, human judgment layered on top, exactly as the platform's design intends (Core Principle #7/#8: AI recommends, a human decides, and no candidate reaches an end client without that decision).

---

## POC Report Explanation

The POC report screen is where you'll compare this platform's shortlist against your own manual process on the same role, run side by side over the same period. It's built to show:

- **Score / gates-passed / evidence-%** for the platform side, reported the same way everywhere else on the platform — never blended into one number.
- **How the two processes agree or disagree** on which candidates were disqualified and why (a "gate-decision agreement rate").
- **Whether the two processes tend to rank the same candidates highly** — this is measured as a _correlation_, not as "do the two percentages match exactly." Your algorithm and this platform's methodology are different systems; expecting the two numbers to mean the same thing wouldn't be a fair comparison.
- **A visible correlation-not-causation disclaimer, rendered directly on the report screen** — this is real, wired text, not a placeholder (confirmed in the platform's own code and tests). It exists because a correlation between two scoring methods agreeing on good candidates is not proof that either method _causes_ good hires — the report is built to avoid overclaiming, on purpose. Read the disclaimer as the platform being straight with you about what the numbers do and don't prove, not as boilerplate to skim past.

The report does not make the go/no-go call for you — per the POC's own rules (`docs/14-poc-specification.md`), **you make the final go/no-go decision**; the platform's metrics inform it, they never automate it.

---

## Escalation Process

**There is no formal support-ticketing system built into this platform yet.** Escalation today is a direct-contact process, not a built-in feature — don't expect a "submit a ticket" button, because there isn't one.

- **For a day-to-day workflow question or something that looks wrong** (a screen behaving unexpectedly, a step you're unsure how to do): contact your **Agency Admin** first. On a two-person agency, that may be the same person wearing a different hat, but the escalation path is still the same — workflow issues go to whoever holds the Agency Admin role before anyone else.
- **If a specific gate result or score looks wrong to you** — this is the one scenario with a clear, agreed answer, not a judgment call: **look at the evidence citation behind it.** Every gate result and every score traces back to a specific, quoted excerpt from a specific document. A dispute is resolved by pointing at that evidence together, not by arguing over the percentage in the abstract — this is the platform's own dispute-resolution principle (`docs/14-poc-specification.md` §14.16), agreed in advance specifically so a disagreement during the POC has a settled way to work through it rather than becoming a stuck argument.
- **For anything that looks like a security, privacy, or data issue** (candidate data visible to someone who shouldn't see it, a client seeing another client's data): escalate immediately to Agency Admin — this is exactly the kind of thing the audit log exists to let you reconstruct precisely (who did what, when).
