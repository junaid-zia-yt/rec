import { describe, expect, it } from 'vitest'
import { render, screen } from '@rqi/testing'
import PocWorkspacePage from './page'

describe('PocWorkspacePage', () => {
  // This test environment has no live Supabase configuration
  // (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY unset — see apps/web/lib/env.ts), so
  // supabaseConfigured is false and the page must take its early
  // !supabaseConfigured branch without ever calling requireAuth/
  // resolveActiveOrg/loadPocBenchmarks — same convention as
  // apps/web/app/(app)/outreach/page.test.tsx.
  it('renders the !supabaseConfigured empty state without crashing or requiring auth', async () => {
    render(await PocWorkspacePage())
    expect(screen.getByText('POC Benchmarks')).toBeInTheDocument()
    expect(screen.getByText('No POC benchmarks yet')).toBeInTheDocument()
    expect(screen.getByText(/requires a live database connection/i)).toBeInTheDocument()
  })
})
