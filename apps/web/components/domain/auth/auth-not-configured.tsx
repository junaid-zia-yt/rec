import { Card, CardBody } from '@rqi/ui'

/**
 * Shown instead of a live auth form whenever `supabaseConfigured` is false
 * (this environment, always, today — no live Supabase project is
 * connected). Never renders a form that would silently fail; says plainly
 * what is missing, per "Never claim an external integration works until it
 * has been configured and tested."
 */
export function AuthNotConfigured() {
  return (
    <Card>
      <CardBody className="flex flex-col gap-2">
        <h1 className="text-tertiary text-lg font-semibold">Authentication is not configured</h1>
        <p className="text-muted text-sm">
          This environment has no Supabase project connected yet. Set{' '}
          <code className="rounded-badge bg-canvas px-1 py-0.5 text-xs">
            NEXT_PUBLIC_SUPABASE_URL
          </code>{' '}
          and{' '}
          <code className="rounded-badge bg-canvas px-1 py-0.5 text-xs">
            NEXT_PUBLIC_SUPABASE_ANON_KEY
          </code>{' '}
          to enable sign-in — see{' '}
          <code className="rounded-badge bg-canvas px-1 py-0.5 text-xs">supabase/README.md</code>.
        </p>
      </CardBody>
    </Card>
  )
}
