# Demo Script — Private Client Demonstration (20–25 minutes)

Date: 2026-09-29
For: Dave (private, no-commitment demonstration — not a sales pitch dressed as a product review)

Goal: show the **quality-before-quantity workflow end to end**, honestly, at a pace Dave can follow in a single sitting. Every screen shown carries the "Private Demonstration — Sample Data" banner; call attention to it once at the start, then let it recede into the background.

Reset the demo data (`docs/private-client-demo-guide.md` §4) before this meeting so the walkthrough below matches exactly what's on screen.

---

## 0. Framing (1 minute)

Say, in your own words: _"This is a private look at the product, running on made-up data — no real candidates, no real clients, nothing live yet. It's here so you can see how the workflow actually behaves, not just slides. Everything you see today is either a real calculation the system just ran, or something clearly marked as a placeholder for a step we haven't turned on yet."_

Point out the banner once. Move on.

## 1. The core idea, in one sentence (1 minute)

_"The system is built around one rule: a candidate who fails something mandatory never makes it onto the shortlist you see — no matter how good they look otherwise. Everything after that is about making the ranking of who's left explainable, not a black box."_

## 2. Job intake and requirement extraction (3–4 minutes)

- Open **Projects → District Manager, Convenience Retail**. Show the pasted job description and the extracted requirements: two mandatory (5+ years multi-unit convenience retail management experience; valid driver's license) and two preferred, weighted (P&L ownership across multiple locations — 70; loss-prevention program experience — 30).
- Say: _"A recruiter pastes or uploads the JD, and the system proposes requirements split into mandatory pass/fail gates and weighted preferred criteria. A human reviews and approves this scorecard before anything is scored against it — that's what 'approved' status on the scorecard means."_
- If time allows, briefly show the **Shift Lead, Quick Serve Restaurant** role the same way — it's a smaller, "easier" role, deliberately included so Dave sees the workflow handle both a straightforward front-line role and a more senior, judgment-heavy one.

## 3. Mandatory gates in action (4–5 minutes) — the centerpiece

Open the candidate list for **District Manager**. Walk through, by name, the five fictional candidates:

- **Victor Multiunit** and **Faye Districtworth** — clear passes. Open one candidate's evaluation panel and show the evidence excerpt behind the "5+ years multi-unit convenience retail management experience" gate — a real quoted excerpt from the candidate's (fictional) experience record, not a made-up summary.
- **Owen Norenewal** — clear mandatory-gate fail. Show that his driver's license requirement is marked failed (license suspended, not reinstated), and that this candidate **does not appear in the shortlist**, regardless of his otherwise-qualifying experience. Say: _"This is Core Rule #6 — mandatory failure means out, full stop, before any ranking happens."_
- **Callum Noverify** — missing-information case. Show that the driver's-license gate is marked `insufficient_evidence` / pending verification, not a guessed pass or fail, because there's simply no evidence either way. Say: _"If the information isn't there, the system says so — it doesn't assume the best case to keep a candidate in the running."_

## 4. Evidence-based scoring and the borderline case (4–5 minutes)

- Open **Priti Scopeblur**'s evaluation panel — mandatory gates pass, but her preferred "P&L ownership across multiple locations" claim is flagged: the resume states a 4-store cluster, but an indirect reference note suggests it may have been closer to 2 stores under informal oversight. Show that this conflict is surfaced, not resolved by the system.
- Show her review status: **requires verification**, with a recorded human reason — _"asking the candidate to confirm directly before this goes further, even though mandatory gates already pass cleanly."_
- Say: _"The system doesn't pick a side when evidence conflicts. It surfaces the conflict and asks a person to make the call, with a reason that gets recorded. Nothing goes to a client without a human decision behind it."_

## 5. The shortlist (2–3 minutes)

- Open the **District Manager** shortlist — built only from candidates who passed every mandatory gate, capped at 3.
- Say: _"This is deliberate — the goal isn't the biggest possible list, it's the smallest list a client can trust. Two or three strong, evidenced candidates beats ten unverified ones."_

## 6. Outreach preview (2 minutes)

- Open the drafted outreach message for the shortlisted candidate. Point out it is explicitly marked **draft** and was never sent — email sending is disabled in this demo by design.
- Say: _"In a live environment, this draft would go through a human review before anything is sent, using your own connected email or outreach accounts — nothing here has ever sent a real message."_

## 7. Desktop and mobile (2 minutes)

- Resize the browser (or switch devices) to show the same District Manager review on a phone-width screen — same information, same banner, adapted layout.
- Say: _"Recruiters reviewing candidates from the field or between meetings get the same evidence and the same gates on mobile, not a stripped-down view."_

## 8. Sample analytics (1–2 minutes)

- Open the **POC/analytics** view showing the two roles side by side — candidates evaluated, gate pass rates, shortlist sizes.
- Say: _"This is the kind of comparison view a real proof-of-concept would build out further, once it's running against your actual roles."_

## 9. Close (1 minute)

Say: _"That's the full loop — job in, evidence-backed scoring, mandatory gates enforced automatically, a human making every final call, a short trustworthy shortlist out. Nothing you saw today touched a real candidate or a real inbox. If this is useful, the next step is a small, controlled proof-of-concept on two of your real roles — I'll walk you through what that looks like."_ → hand off to `docs/post-demo-conversion-plan.md`.

---

## If something breaks mid-demo

Don't improvise a workaround that could look like faking a result. Say plainly that something isn't behaving as expected, move to the next section, and follow up afterward. Never click through a raw error state without narrating what happened.

## Related documents

`docs/private-client-demo-guide.md` · `docs/demo-limitations.md` · `docs/post-demo-conversion-plan.md`
