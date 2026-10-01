import { describe, expect, it } from 'vitest'

/**
 * Environment validation (Build Phase 1 brief §10 + §3): a missing optional
 * service credential must not crash the module, and demoMode must reflect
 * that. Each test re-imports the module fresh (vi.resetModules) since
 * lib/env.ts reads process.env at import time.
 */
describe('env', () => {
  it('parses with no service credentials set and reports demo mode', async () => {
    vi.resetModules()
    const original = { ...process.env }
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.RESEND_API_KEY

    const { env, demoMode } = await import('./env')

    expect(env.NEXT_PUBLIC_APP_URL).toBe('http://localhost:3000')
    expect(demoMode).toBe(true)

    process.env = original
  })

  it('leaves demo mode off once a real service credential is present', async () => {
    vi.resetModules()
    const original = { ...process.env }
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'

    const { demoMode } = await import('./env')
    expect(demoMode).toBe(false)

    process.env = original
  })

  it('supabaseConfigured is false until both the URL and anon key are set', async () => {
    vi.resetModules()
    const original = { ...process.env }
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    const { supabaseConfigured } = await import('./env')
    expect(supabaseConfigured).toBe(false)

    process.env = original
  })

  it('supabaseConfigured stays false with only the URL set (anon key also required)', async () => {
    vi.resetModules()
    const original = { ...process.env }
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    const { supabaseConfigured } = await import('./env')
    expect(supabaseConfigured).toBe(false)

    process.env = original
  })

  it('supabaseConfigured is true once both are set', async () => {
    vi.resetModules()
    const original = { ...process.env }
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'

    const { supabaseConfigured } = await import('./env')
    expect(supabaseConfigured).toBe(true)

    process.env = original
  })

  it('supabaseAdminConfigured requires the service role key, not the anon key', async () => {
    vi.resetModules()
    const original = { ...process.env }
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
    delete process.env.SUPABASE_SERVICE_ROLE_KEY

    const { supabaseAdminConfigured } = await import('./env')
    expect(supabaseAdminConfigured).toBe(false)

    process.env = original
  })

  it('anthropicConfigured is false with no key set', async () => {
    vi.resetModules()
    const original = { ...process.env }
    delete process.env.ANTHROPIC_API_KEY

    const { anthropicConfigured } = await import('./env')
    expect(anthropicConfigured).toBe(false)

    process.env = original
  })

  it('anthropicConfigured is true once a key is set', async () => {
    vi.resetModules()
    const original = { ...process.env }
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'

    const { anthropicConfigured } = await import('./env')
    expect(anthropicConfigured).toBe(true)

    process.env = original
  })

  it('demoModeEnabled is false when NEXT_PUBLIC_DEMO_MODE is unset', async () => {
    vi.resetModules()
    const original = { ...process.env }
    delete process.env.NEXT_PUBLIC_DEMO_MODE

    const { demoModeEnabled } = await import('./env')
    expect(demoModeEnabled).toBe(false)

    process.env = original
  })

  it('demoModeEnabled is false for any value other than the exact string "true"', async () => {
    vi.resetModules()
    const original = { ...process.env }
    process.env.NEXT_PUBLIC_DEMO_MODE = '1'

    const { demoModeEnabled } = await import('./env')
    expect(demoModeEnabled).toBe(false)

    process.env = original
  })

  it('demoModeEnabled is true when NEXT_PUBLIC_DEMO_MODE is exactly "true"', async () => {
    vi.resetModules()
    const original = { ...process.env }
    process.env.NEXT_PUBLIC_DEMO_MODE = 'true'

    const { demoModeEnabled } = await import('./env')
    expect(demoModeEnabled).toBe(true)

    process.env = original
  })
})
