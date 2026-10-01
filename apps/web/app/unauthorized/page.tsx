import Link from 'next/link'
import { Button, Card, CardBody } from '@rqi/ui'
import { ShieldAlert } from 'lucide-react'

export const metadata = { title: 'Unauthorized' }

/**
 * Shown when an authenticated user is not a member of the requested
 * organization, or their role does not grant access to a resource
 * (docs/12-security-compliance.md §12.3). Deliberately generic — it does
 * not say what would have been visible, matching the "safe generic
 * authentication errors" requirement extended to authorization.
 */
export default function UnauthorizedPage() {
  return (
    <div className="bg-canvas flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardBody className="flex flex-col items-center gap-3 text-center">
          <ShieldAlert className="text-danger h-8 w-8" aria-hidden="true" />
          <h1 className="text-tertiary text-lg font-semibold">You don&apos;t have access</h1>
          <p className="text-muted text-sm">
            You&apos;re signed in, but you don&apos;t have permission to view this. If you think
            this is a mistake, ask your organization admin.
          </p>
          <Button asChild className="mt-2 w-full">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </CardBody>
      </Card>
    </div>
  )
}
