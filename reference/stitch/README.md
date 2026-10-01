# Reference — Supplied Stitch & Discovery Assets

This directory preserves the client-supplied source material, unmodified in substance, for developer reference. **Nothing in `apps/` or `packages/` should ever import from here** — this is read-only reference, not a code dependency.

## Contents
- `DESIGN-B-executive-verification-console.md` — verbatim re-download of the `DESIGN.md` upload the project's file tool resolves to by default. **Primary source** for mobile layout, components, and typography (Space Grotesk/Geist), per `docs/20-decision-register.md` decision D-01.
- `DESIGN-A-recruitment-quality-intelligence.md` — the *other* `DESIGN.md` upload, reconstructed from search-result fragments because the project's file-access tool cannot distinguish two files sharing the same name and always resolves `DESIGN.md` to upload B (documented as a technical blocker in `docs/02-asset-inventory.md` §2.3 and, for this second file, in the header of this document itself). **Primary source** for the desktop 12-column grid and 240px navigation rail only; superseded by Doc B everywhere else.
- `MOM_Recruitment_Discovery_Call.md` — transcription of the discovery-call minutes; the `.docx` in the project remains canonical.
- `screens/confirmed-01-shortlist-verification-matrix-mobile.png` — the **only** one of 25 supplied Stitch screenshots individually accessible from this environment. All 25 were uploaded under the identical filename `screen.png`; the project's file tool deterministically resolves that name to this one file no matter how many times it's queried. The other 24 exist (confirmed via search) but their image bytes could not be retrieved this session.

## Known gap
Per `docs/20-decision-register.md` D-02, the client has been asked to re-upload the 24 remaining screens with distinct filenames. When they arrive, add them here as `screens/NN-<name>-<platform>.png` and update `docs/03-screen-inventory.md` and `docs/build-phase-1-report.md`'s "Deferred work" section — full screen-by-screen visual fidelity is gated on this, per Build Phase 1's scope.
