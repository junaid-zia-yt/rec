import { describe, expect, it } from 'vitest'
import { isAuthPath, isPublicPath, requiresAuth, sanitizeRedirectPath } from './routing'

describe('route classification', () => {
  it('classifies auth screens', () => {
    expect(isAuthPath('/sign-in')).toBe(true)
    expect(isAuthPath('/forgot-password')).toBe(true)
    expect(isAuthPath('/reset-password')).toBe(true)
    expect(isAuthPath('/accept-invitation')).toBe(true)
    expect(isAuthPath('/dashboard')).toBe(false)
  })

  it('classifies public (non-auth) screens', () => {
    expect(isPublicPath('/unauthorized')).toBe(true)
    expect(isPublicPath('/auth/callback')).toBe(true)
    expect(isPublicPath('/sign-in')).toBe(false)
  })

  it('protects every app route by default (allowlist, not a denylist)', () => {
    expect(requiresAuth('/dashboard')).toBe(true)
    expect(requiresAuth('/candidates/cand-1')).toBe(true)
    // A brand-new route nobody has explicitly exempted is protected too.
    expect(requiresAuth('/some-future-route-nobody-added-to-any-list')).toBe(true)
  })

  it('does not protect auth screens, public screens, static assets, or API routes', () => {
    expect(requiresAuth('/sign-in')).toBe(false)
    expect(requiresAuth('/unauthorized')).toBe(false)
    expect(requiresAuth('/_next/static/chunk.js')).toBe(false)
    expect(requiresAuth('/api/webhook')).toBe(false)
  })
})

describe('sanitizeRedirectPath — open-redirect prevention', () => {
  it('accepts a normal internal path', () => {
    expect(sanitizeRedirectPath('/candidates/cand-1')).toBe('/candidates/cand-1')
  })

  it('falls back to /dashboard for an empty or missing path', () => {
    expect(sanitizeRedirectPath(undefined)).toBe('/dashboard')
    expect(sanitizeRedirectPath(null)).toBe('/dashboard')
    expect(sanitizeRedirectPath('')).toBe('/dashboard')
  })

  it('rejects a protocol-relative URL (//evil.example)', () => {
    expect(sanitizeRedirectPath('//evil.example.com')).toBe('/dashboard')
  })

  it('rejects an absolute URL to another host', () => {
    expect(sanitizeRedirectPath('https://evil.example.com/phish')).toBe('/dashboard')
    expect(sanitizeRedirectPath('http://evil.example.com')).toBe('/dashboard')
  })

  it('rejects a path not starting with a single slash', () => {
    expect(sanitizeRedirectPath('evil.example.com')).toBe('/dashboard')
    expect(sanitizeRedirectPath('/\\evil.example.com')).toBe('/dashboard')
  })

  it('rejects a javascript: pseudo-protocol smuggled as a path', () => {
    expect(sanitizeRedirectPath('javascript:alert(1)')).toBe('/dashboard')
  })
})
