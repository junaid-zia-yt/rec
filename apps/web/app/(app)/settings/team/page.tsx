import Link from 'next/link'
import { AvatarInitials, Card, CardBody, PageHeader, SectionHeader, StatusBadge } from '@rqi/ui'
import { DEMO_INVITATIONS, DEMO_TEAM_MEMBERS } from '@/lib/mock-data'
import { InviteMemberForm } from '@/components/domain/auth/invite-member-form'
import { supabaseConfigured } from '@/lib/env'
import { requireAuth, resolveActiveOrg } from '@/lib/auth/session'

export const metadata = { title: 'Team' }

const ROLE_LABEL: Record<string, string> = {
  platform_admin: 'Platform admin',
  agency_admin: 'Agency admin',
  recruiter: 'Recruiter',
  client_decision_maker: 'Client decision maker',
  read_only_reviewer: 'Read-only reviewer',
}

function initialsFor(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

/**
 * Team / organization settings shell — Build Phase 2 brief §9. Renders
 * against `DEMO_TEAM_MEMBERS`/`DEMO_INVITATIONS` (no live Supabase project
 * is connected in this environment, so there is nothing real to query yet);
 * the invite form below posts to the real `createInvitationAction` server
 * action and is functional once Supabase is configured, but is disabled
 * here with that stated plainly rather than silently failing.
 */
export default async function TeamSettingsPage() {
  // requireAuth()/resolveActiveOrg() are no-ops-that-redirect only once
  // Supabase is actually configured (see lib/auth/session.ts); in demo mode
  // (this environment, today) this resolves to null and the form below
  // renders its "not configured" state instead of attempting a write.
  const activeOrgId = supabaseConfigured
    ? (await resolveActiveOrg((await requireAuth('/settings/team')).id)).organizationId
    : null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team"
        description="Manage who has access to this organization and what they can do."
      />

      <div className="flex flex-col-reverse gap-6 lg:flex-row">
        <div className="flex flex-1 flex-col gap-6">
          <section aria-labelledby="members-heading" className="flex flex-col gap-3">
            <SectionHeader title="Members" />
            <Card>
              <ul className="divide-outline-cell divide-y">
                {DEMO_TEAM_MEMBERS.map((member) => (
                  <li key={member.membershipId} className="flex items-center gap-3 p-4">
                    <AvatarInitials initials={initialsFor(member.fullName)} tone="secondary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-tertiary truncate text-sm font-semibold">
                        {member.fullName}
                      </p>
                      <p className="text-muted truncate text-xs">{member.email}</p>
                    </div>
                    <StatusBadge status={member.status === 'active' ? 'passed' : 'failed'}>
                      {ROLE_LABEL[member.role] ?? member.role}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            </Card>
          </section>

          <section aria-labelledby="invitations-heading" className="flex flex-col gap-3">
            <SectionHeader title="Pending invitations" />
            {DEMO_INVITATIONS.length === 0 ? (
              <Card>
                <CardBody className="text-muted text-sm">No pending invitations.</CardBody>
              </Card>
            ) : (
              <Card>
                <ul className="divide-outline-cell divide-y">
                  {DEMO_INVITATIONS.map((invitation) => (
                    <li key={invitation.id} className="flex items-center gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-tertiary truncate text-sm font-semibold">
                          {invitation.email}
                        </p>
                      </div>
                      <StatusBadge status="pending">
                        {ROLE_LABEL[invitation.role] ?? invitation.role}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
        </div>

        <div className="w-full lg:w-80 lg:shrink-0">
          <SectionHeader title="Invite a team member" className="mb-3" />
          {supabaseConfigured && activeOrgId ? (
            <InviteMemberForm organizationId={activeOrgId} />
          ) : (
            <Card>
              <CardBody className="text-muted text-sm">
                Inviting new members requires a configured Supabase project. See{' '}
                <Link href="/integrations" className="text-secondary font-medium hover:underline">
                  Integrations
                </Link>{' '}
                for connection status.
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
