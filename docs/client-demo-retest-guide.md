# Client demo retest guide

**For Dave — Build Phase 18.** Numbered steps to retest every item from your feedback. Each step says what you should see. If any step doesn't match, that's a genuine bug we want to know about — please note the step number when you report it.

Before you start, on the **Shortlists** page click **"Reset demo data"** — this restores the two seeded projects to a known starting state so these steps produce the results described below.

---

## 1. Candidate matching and sorting

1. Go to **Candidates**, open **Sarah Mitchell**.
2. Click the **Evaluation** tab.
3. Click **Run evaluation** (or **Re-evaluate** if already run).
   - You should see a banner: *"Demonstration evaluation — live AI is not connected."*
   - You should see a green **eligible** badge, an overall score, and every mandatory gate ("5+ years multi-unit retail management experience," "Valid state driver's license") marked **Passed**.
4. Go back to Candidates, open **Derek Holloway**, run his evaluation the same way.
   - You should see a red **ineligible** badge — his driver's license requirement fails (his evidence explicitly states it was suspended). His score does not matter; a failed mandatory gate makes him ineligible regardless of any other strength.
5. Go back to Candidates, open **Priya Natarajan**, run her evaluation.
   - You should see **pending verification** — she has no evidence at all captured for the multi-unit P&L requirement. This is never guessed as a pass; missing information is shown as unverified.
6. Go to **Shortlists**, open **Regional Store Leader**.
   - Eligible candidates (Sarah, and others you've evaluated) appear in the "Eligible candidates" section, sorted by score. Derek and Priya appear separately, under "Not eligible for this shortlist" — never ranked above an eligible candidate.

## 2. Shortlisting

1. Still on the shortlist workspace for **Regional Store Leader**, find Sarah Mitchell under "Eligible candidates."
2. Click **Mark reviewed**, then click **Add to shortlist**.
   - She moves into the "On the shortlist" section at rank #1, and the counter at the top updates to "1/3 shortlisted."
3. Repeat for two more eligible candidates (evaluate, mark reviewed, add) until the shortlist shows "3/3 shortlisted."
4. Try to add a fourth eligible, reviewed candidate.
   - The **Add to shortlist** button is disabled — the system enforces a maximum of three shortlisted candidates, on the server, not just in the UI.
5. Click **Remove** on any shortlisted candidate.
   - They return to the "Eligible candidates" list and the counter decreases.

## 3. Candidate sourcing

1. Go to **Candidates** → **Add candidate**.
2. Fill in the manual-entry form (name is required; other fields are optional) and submit.
   - You'll see a confirmation, and the new candidate appears in the Candidates list under the project you selected.
3. Try the **CSV import** tab with a small CSV of names/emails.
   - Rows import; a duplicate email or phone against an existing candidate is skipped and reported, never silently duplicated.
4. What this demo does **not** claim to do: connect to LinkedIn, Apollo, a job board, or the TA Tracker system. Any screen that would normally source from one of those shows an honest "integration not connected in this private demonstration" message rather than fabricated results.

## 4. Outreach

1. Go to **Outreach**.
   - Banner reads *"Demo mode — messages are not sent."*
2. Pick an eligible candidate (one you've evaluated and who passed every mandatory gate) and a template, then click **Generate draft**.
   - A draft appears below with the subject/body filled in from the candidate and project details.
3. Click **Approve (not sent)**.
   - The draft's status changes to "approved not sent." No email, LinkedIn message, or SMS is ever actually sent from this environment — approval only records a human decision.
4. Try generating a draft for a candidate who hasn't been evaluated, or who failed a mandatory gate. You won't be able to — outreach can only be drafted for a candidate who has passed every mandatory requirement, enforced on the server.

## 5. Project flow

1. Go to **Projects**, open **Regional Store Leader**.
   - The stepper at the top ("Job description," "Requirements," "Scorecard approved," "Candidates added," "Candidates evaluated," "Shortlist built," "Outreach drafted") reflects what has actually happened in your session — steps you complete above (evaluating a candidate, building a shortlist, drafting outreach) move the stepper forward live.
2. Click **View activity**.
   - Every action you took above — each evaluation, review, shortlist addition, and outreach draft/decision — appears here with a timestamp and actor name. This is the project's audit trail.

## 6. AI functionality

Throughout every screen above, wherever a result came from the deterministic demo pipeline rather than a live Anthropic model call, it is labelled *"Demonstration evaluation — live AI is not connected."* This is by design — see `docs/demo-limitations.md` for the full, honest account of what does and doesn't require live infrastructure.

---

## When you're done

Click **"Reset demo data"** again on the Shortlists page to restore the original scenario for the next person who tests this.

If anything above didn't match what's described, please tell us the step number and what you saw instead — that's exactly the kind of report that made this repair phase possible.
