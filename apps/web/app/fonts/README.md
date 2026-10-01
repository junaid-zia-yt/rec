# Self-hosted fonts

`geist-latin-wght-normal.woff2` and `space-grotesk-latin-wght-normal.woff2`
are the variable-weight, latin-subset woff2 files from the `@fontsource-variable/geist`
and `@fontsource-variable/space-grotesk` npm packages (both MIT-licensed,
sourced from the original Vercel Geist and Google Fonts Space Grotesk
releases).

They are vendored here and loaded with `next/font/local` (see
`app/layout.tsx`) instead of `next/font/google`, because this build
environment's outbound network access does not include
`fonts.googleapis.com` (only npm registries and GitHub are reachable). Using
`next/font/local` also means the production app never makes a runtime
request to Google Fonts at all — a strictly better outcome for reliability,
not just a workaround for this sandbox. See
`docs/build-phase-1-report.md` "Differences from Stitch" / "Known
limitations" for the full explanation.

To update these files, bump `@fontsource-variable/geist` /
`@fontsource-variable/space-grotesk` in a scratch install and re-copy the
`files/*-latin-wght-normal.woff2` asset from each package.
