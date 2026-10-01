import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Build Phase 15 Wave 2 — the staging Basic Auth gate in proxy.ts. Each test
 * re-imports proxy.ts fresh (vi.resetModules) since it reads
 * stagingBasicAuthConfigured from lib/env.ts at import time, same convention
 * as lib/env.test.ts.
 */
async function loadProxy() {
  const mod = await import('./proxy')
  return mod.proxy
}

function requestTo(path: string, authorizationHeader?: string): NextRequest {
  const headers = new Headers()
  if (authorizationHeader) headers.set('authorization', authorizationHeader)
  return new NextRequest(new Request(`http://localhost:3000${path}`, { headers }))
}

describe('proxy staging Basic Auth gate', () => {
  it('is a no-op when neither staging Basic Auth var is set', async () => {
    vi.resetModules()
    const original = { ...process.env }
    delete process.env.STAGING_BASIC_AUTH_USER
    delete process.env.STAGING_BASIC_AUTH_PASSWORD

    const proxy = await loadProxy()
    const response = await proxy(requestTo('/dashboard'))

    expect(response.status).not.toBe(401)
    process.env = original
  })

  it('is a no-op when only one of the two vars is set', async () => {
    vi.resetModules()
    const original = { ...process.env }
    process.env.STAGING_BASIC_AUTH_USER = 'demo'
    delete process.env.STAGING_BASIC_AUTH_PASSWORD

    const proxy = await loadProxy()
    const response = await proxy(requestTo('/dashboard'))

    expect(response.status).not.toBe(401)
    process.env = original
  })

  it('rejects a request with no credentials once both vars are set', async () => {
    vi.resetModules()
    const original = { ...process.env }
    process.env.STAGING_BASIC_AUTH_USER = 'demo'
    process.env.STAGING_BASIC_AUTH_PASSWORD = 'letmein'

    const proxy = await loadProxy()
    const response = await proxy(requestTo('/dashboard'))

    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toMatch(/^Basic /)
    process.env = original
  })

  it('rejects a request with wrong credentials once both vars are set', async () => {
    vi.resetModules()
    const original = { ...process.env }
    process.env.STAGING_BASIC_AUTH_USER = 'demo'
    process.env.STAGING_BASIC_AUTH_PASSWORD = 'letmein'

    const proxy = await loadProxy()
    const response = await proxy(requestTo('/dashboard', `Basic ${btoa('demo:wrong-password')}`))

    expect(response.status).toBe(401)
    process.env = original
  })

  it('allows a request with correct credentials once both vars are set', async () => {
    vi.resetModules()
    const original = { ...process.env }
    process.env.STAGING_BASIC_AUTH_USER = 'demo'
    process.env.STAGING_BASIC_AUTH_PASSWORD = 'letmein'

    const proxy = await loadProxy()
    const response = await proxy(requestTo('/dashboard', `Basic ${btoa('demo:letmein')}`))

    expect(response.status).not.toBe(401)
    process.env = original
  })
})
