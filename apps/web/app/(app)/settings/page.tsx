import Link from 'next/link'
import { AvatarInitials, Card, CardBody, PageHeader, SectionHeader, StatusBadge } from '@rqi/ui'
import { ChevronRight } from 'lucide-react'
import { DEMO_USER } from '@/lib/mock-data'
import { SignOutButton } from '@/components/domain/auth/sign-out-button'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'

export const metadata = { title: 'Settings' }

const ROLE_LABEL: Record<string, string> = {
  platform_admin: 'Platform admin',
  agency_admin: 'Agency admin',
  recruiter: 'Recruiter',
  client_decision_maker: 'Client decision maker',
  read_only_reviewer: 'Read-only reviewer',
}

/**
 * Settings — read-only account/organization summary. No editable form is
 * wired up in Build Phase 1 (authentication and account management are
 * out of scope — docs/19-mvp-scope.md), so every field here is display-only.
 *
 * Build Phase 12, Wave 5: added a real (non-demo) role lookup, gated
 * behind `supabaseConfigured` exactly like every other page in this app,
 * so the Workspace section below can show the admin-only "Job status" link
 * only to platform_admin/agency_admin — everything else on this page is
 * unchanged.
 */
export default async function SettingsPage() {
  const role = supabaseConfigured
    ? (await resolveActiveOrg((await requireAuth('/settings')).id)).role
    : DEMO_USER.role
  const canSeeJobStatus = role === 'platform_admin' || role === 'agency_admin'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Account, organization, and workspace preferences."
      />

      <section aria-labelledby="account-heading" className="flex flex-col gap-3">
        <SectionHeader title="Account" />
        <Card>
          <CardBody className="flex items-center gap-4">
            <AvatarInitials initials={DEMO_USER.avatarInitials} size="lg" tone="secondary" />
            <div>
              <p className="text-tertiary text-sm font-semibold">{DEMO_USER.fullName}</p>
              <p className="text-muted text-xs">{DEMO_USER.email}</p>
            </div>
            <StatusBadge status="neutral" className="ml-auto">
              {ROLE_LABEL[DEMO_USER.role] ?? DEMO_USER.role}
            </StatusBadge>
          </CardBody>
          <CardBody className="border-outline-cell flex items-center justify-between border-t pt-4">
            <p className="text-muted text-xs">
              {supabaseConfigured
                ? 'End your session on this device.'
                : 'Sign-out requires a configured Supabase project.'}
            </p>
            <SignOutButton disabled={!supabaseConfigured} />
          </CardBody>
        </Card>
      </section>

      <section aria-labelledby="organization-heading" className="flex flex-col gap-3">
        <SectionHeader title="Organization" />
        <Card>
          <Link
            href="/settings/team"
            className="hover:bg-canvas focus-visible:ring-secondary flex items-center justify-between p-4 text-sm focus-visible:outline-none focus-visible:ring-2"
          >
            <div>
              <p className="text-tertiary font-semibold">Team</p>
              <p className="text-muted text-xs">Manage members, roles, and invitations.</p>
            </div>
            <ChevronRight className="text-muted h-4 w-4" aria-hidden="true" />
          </Link>
        </Card>
      </section>

      <section aria-labelledby="workspace-heading" className="flex flex-col gap-3">
        <SectionHeader title="Workspace" />
        <Card>
          <Link
            href="/settings/notifications"
            className="hover:bg-canvas focus-visible:ring-secondary border-outline-cell flex items-center justify-between border-b p-4 text-sm focus-visible:outline-none focus-visible:ring-2"
          >
            <div>
              <p className="text-tertiary font-semibold">Notification preferences</p>
              <p className="text-muted text-xs">
                Choose which events notify you, in-app and by email.
              </p>
            </div>
            <ChevronRight className="text-muted h-4 w-4" aria-hidden="true" />
          </Link>
          {canSeeJobStatus && (
            <Link
              href="/settings/jobs"
              className="hover:bg-canvas focus-visible:ring-secondary flex items-center justify-between p-4 text-sm focus-visible:outline-none focus-visible:ring-2"
            >
              <div>
                <p className="text-tertiary font-semibold">Job status</p>
                <p className="text-muted text-xs">
                  Background job history and manual retries (admin only).
                </p>
              </div>
              <ChevronRight className="text-muted h-4 w-4" aria-hidden="true" />
            </Link>
          )}
          {!canSeeJobStatus && (
            <CardBody className="text-tertiary flex flex-col gap-2 text-sm">
              <p>
                Audit-log export is planned for a later build phase — see
                docs/06-roles-permissions.md.
              </p>
            </CardBody>
          )}
        </Card>
      </section>
    </div>
  )
}
