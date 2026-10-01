# 18 — Blocking Questions

## P0 — Blocks Architecture

**Q-P0-01: What are the numeric POC success criteria?**
Why it matters: the MOM itself flags "equal or better quality" as too subjective to avoid a disputed outcome. Blocks: [[14-poc-specification]] execution and the whole go/no-go decision the engagement hinges on. Recommended default if unanswered: adopt our proposed thresholds in [[10-ai-evaluation-guardrails]] §10.13 / [[14-poc-specification]] §14.14, explicitly labeled as vendor-proposed pending client agreement.

**Q-P0-02: Which DESIGN.md is authoritative — or should the two be merged?**
Why it matters: two structurally different design systems were uploaded under the same filename ([[02-asset-inventory]] §2.2); building against the wrong one wastes the entire Phase 3 effort. Blocks: Phase 3 (Stitch design-system implementation). Recommended default: Doc B ("Executive Quality Verification Console") governs mobile + component vocabulary, Doc A's desktop grid/nav-rail governs desktop, per our stated reasoning.

**Q-P0-03: Can the 24 remaining screenshots be re-uploaded with distinct, ideally descriptive filenames?**
Why it matters: only 1 of 25 screens could be individually inspected due to a filename-collision limitation ([[02-asset-inventory]] §2.3); the screen inventory and pixel-fidelity claims are currently built mostly from inference. Blocks: full Phase 3 fidelity, [[03-screen-inventory]] completeness. Recommended default: proceed with token-level Phase 3 work now; treat full-fidelity screen implementation as gated per-screen on receiving that screen's image.

**Q-P0-04: Does human-oversight-in-employment-decision regulation (e.g., bias-audit laws) apply to this client's jurisdiction(s)?**
Why it matters: materially changes whether bias testing ([[10-ai-evaluation-guardrails]] §10.7) and evidence/explainability requirements are "best practice" or "legal requirement," and may add compliance scope before any production launch. Blocks: [[12-security-compliance]] finalization, production-launch readiness. Recommended default: treat as a legal requirement until a lawyer says otherwise (conservative default, since the downside of over-building this is far smaller than under-building it).

## P1 — Blocks Implementation

**Q-P1-01: Whose LinkedIn/Apollo/outreach accounts will be used — client-owned or agency-owned?**
Why it matters: asked directly in the discovery call and left unanswered (MOM §8); affects data ownership, compliance posture, and the Integrations screen's account-ownership model. Blocks: Phase 14, and the POC's outreach step ([[14-poc-specification]] §14.7). Recommended default: client-owned accounts, agency operates on the client's behalf under a documented authorization — lowest data-ownership risk for the client.

**Q-P1-02: Which two roles will be used for the POC, and can the JDs be shared now?**
Why it matters: MOM action item #4 (client-owned), not yet delivered. Blocks: [[14-poc-specification]] cannot start. Recommended default: none — this genuinely requires the client.

**Q-P1-03: Is there an SMS provider preference, or should SMS be deferred?**
Why it matters: SMS is a named outreach channel in the client's current process (MOM §3.2) but isn't in the approved technology stack. Blocks: Phase 10 scope. Recommended default: defer SMS past the POC; email-only outreach for the initial build.

**Q-P1-04: What retention period should apply to candidate personal data?**
Why it matters: no period was specified; affects [[12-security-compliance]] §12.8 and the deletion/soft-delete implementation. Recommended default: 24 months from last activity, configurable per org.

## P2 — Needed Before Production

**Q-P2-01: Does the client want a data-processing agreement / candidate privacy notice drafted, and by whom (agency's counsel vs. vendor)?**
Why it matters: [[12-security-compliance]] §12.7 flags lawful-processing basis as unresolved. Recommended default: agency's own counsel owns this; vendor supplies the technical facts needed to draft it.

**Q-P2-02: What is the actual geographic scope of candidate sourcing (US-only vs. the broader Caribbean/MENA/Europe scope raised in the vendor's own pitch)?**
Why it matters: determines whether GDPR/UK-GDPR exposure applies ([[12-security-compliance]] §12.18). Recommended default: assume international scope is possible and build the more conservative posture, since narrowing later is easier than retrofitting compliance.

**Q-P2-03: Will TA Tracker technical documentation, DB access, or an export format ever become available?**
Why it matters: gates all TA Tracker integration work; currently fully unresolved. Recommended default: build the platform to be self-sufficient (not dependent on TA Tracker data) for the POC and initial paid engagement; treat TA Tracker sync as a distinct, separately-scoped future project.

## P3 — Can Be Decided Later

**Q-P3-01: Should Google Calendar, Microsoft Calendar, or both be supported for interview scheduling?**
Recommended default: defer past initial launch; manual scheduling is sufficient for the POC and early paid usage.

**Q-P3-02: What pricing model will the agency ultimately propose to its own end clients, and does that affect any platform feature (e.g., a billing/usage view for the agency itself)?**
Why it matters: MOM notes pricing was deferred until after the POC. Recommended default: no billing UI is required for the POC; add only once a commercial model is agreed.

Related documents: all — this document is the synthesis of every open question raised across [[01-project-context]] through [[17-deployment-operations]].
