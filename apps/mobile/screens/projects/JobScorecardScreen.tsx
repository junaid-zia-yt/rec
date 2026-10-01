import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Card, QueryStateView, ScreenContainer, StatusChip } from '@/components/ui'
import { useAuth } from '@/lib/auth/AuthProvider'
import { useQueryState } from '@/lib/data/useQueryState'
import { resolveActiveMembership } from '@/lib/data/org'
import { colors, spacing, statusColors, typeScale } from '@/theme/tokens'
import type { ProjectsStackParamList } from '@/navigation/types'

type Props = NativeStackScreenProps<ProjectsStackParamList, 'JobScorecard'>

interface RequirementRow {
  id: string
  name: string
  description: string
  type: string
  weight: number | null
  verificationStatus: string
}

interface ScorecardVersionInfo {
  versionNo: number
  status: string
  approvedAt: string | null
}

interface ScorecardData {
  jobId: string
  jobTitle: string
  projectTitle: string
  requirements: RequirementRow[]
  currentVersion: ScorecardVersionInfo | null
}

const MANDATORY_TYPES = new Set(['mandatory', 'disqualifying'])

const VERSION_STATUS_TONE: Record<string, keyof typeof statusColors> = {
  draft: 'pending',
  pending_approval: 'warning',
  active: 'passed',
  superseded: 'failed',
}

/**
 * Job scorecard (read-only) — Build Phase 13 Wave 3 brief: mandatory
 * pass/fail gates visually distinct from preferred/weighted requirements,
 * approval status, version. Every weight/status shown is read straight off
 * `job_requirements`/`scorecard_versions` — nothing here is computed or
 * invented (project rule: "AI must never invent candidate qualifications or
 * evidence" extends to never fabricating a scorecard number either). Mirrors
 * apps/web's /projects/[projectId]/scorecard page's data shape, minus the
 * editing/approval actions (out of scope this wave — read-only).
 */
export function JobScorecardScreen({ route }: Props) {
  const { projectId } = route.params
  const { user } = useAuth()

  const { status, data, error, refreshing, refresh } = useQueryState<ScorecardData | null>(
    async (supabase) => {
      if (!user) throw new Error('Not signed in.')

      const membership = await resolveActiveMembership(supabase, user.id)
      if (!membership) throw new Error('No active organization membership found.')

      const { data: projectRow, error: projectError } = await supabase
        .from('recruitment_projects')
        .select('id, role_title')
        .eq('id', projectId)
        .eq('organization_id', membership.organizationId)
        .maybeSingle()

      if (projectError) throw new Error(projectError.message)
      if (!projectRow) return null

      const { data: jobRow, error: jobError } = await supabase
        .from('jobs')
        .select('id, title')
        .eq('recruitment_project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (jobError) throw new Error(jobError.message)
      if (!jobRow) {
        return {
          jobId: '',
          jobTitle: '',
          projectTitle: projectRow.role_title,
          requirements: [],
          currentVersion: null,
        }
      }

      const [
        { data: requirementRows, error: requirementsError },
        { data: scorecardRow, error: scorecardError },
      ] = await Promise.all([
        supabase
          .from('job_requirements')
          .select('id, name, description, type, weight, verification_status')
          .eq('job_id', jobRow.id)
          .order('created_at', { ascending: true }),
        supabase.from('scorecards').select('id').eq('job_id', jobRow.id).maybeSingle(),
      ])

      if (requirementsError) throw new Error(requirementsError.message)
      if (scorecardError) throw new Error(scorecardError.message)

      let currentVersion: ScorecardVersionInfo | null = null
      if (scorecardRow) {
        const { data: versionRows, error: versionsError } = await supabase
          .from('scorecard_versions')
          .select('version_no, status, approved_at')
          .eq('scorecard_id', scorecardRow.id)
          .order('version_no', { ascending: false })
          .limit(1)

        if (versionsError) throw new Error(versionsError.message)
        const latest = versionRows?.[0]
        if (latest) {
          currentVersion = {
            versionNo: latest.version_no,
            status: latest.status,
            approvedAt: latest.approved_at,
          }
        }
      }

      return {
        jobId: jobRow.id,
        jobTitle: jobRow.title,
        projectTitle: projectRow.role_title,
        requirements: (requirementRows ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          type: r.type,
          weight: r.weight === null ? null : Number(r.weight),
          verificationStatus: r.verification_status,
        })),
        currentVersion,
      }
    },
    [projectId, user?.id],
    { isEmpty: (value) => value === null },
  )

  const mandatory = data?.requirements.filter((r) => MANDATORY_TYPES.has(r.type)) ?? []
  const preferred = data?.requirements.filter((r) => !MANDATORY_TYPES.has(r.type)) ?? []

  return (
    <ScreenContainer>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.secondary}
          />
        }
      >
        {status === 'loading' && <QueryStateView kind="loading" title="Loading scorecard…" />}
        {status === 'not_configured' && (
          <QueryStateView
            kind="not_configured"
            title="Not connected"
            description="This app isn't connected to a workspace yet."
          />
        )}
        {status === 'offline' && (
          <QueryStateView
            kind="offline"
            title="You're offline"
            description="Try again when you have a connection."
            onRetry={refresh}
          />
        )}
        {status === 'error' && (
          <QueryStateView
            kind="error"
            title="Couldn't load this scorecard"
            description={error ?? undefined}
            onRetry={refresh}
          />
        )}
        {status === 'empty' && (
          <QueryStateView
            kind="empty"
            title="Project not found"
            description="It may have been removed, or you may not have access to it."
          />
        )}

        {status === 'success' && data && !data.jobId && (
          <QueryStateView
            kind="empty"
            title="No job on this project yet"
            description="Add a job before a scorecard can be built."
          />
        )}

        {status === 'success' && data && data.jobId && (
          <>
            <View style={styles.header}>
              <Text style={styles.title}>{data.jobTitle}</Text>
              <Text style={styles.subtitle}>{data.projectTitle}</Text>
              {data.currentVersion ? (
                <View style={styles.versionRow}>
                  <StatusChip
                    status={VERSION_STATUS_TONE[data.currentVersion.status] ?? 'pending'}
                    label={`v${data.currentVersion.versionNo} · ${data.currentVersion.status.replace('_', ' ')}`}
                  />
                </View>
              ) : (
                <Text style={styles.noVersionText}>No scorecard version submitted yet.</Text>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Mandatory requirements</Text>
              <Text style={styles.sectionNote}>
                Pass/fail gates — a candidate who fails any of these cannot enter the ranked
                shortlist.
              </Text>
              {mandatory.length === 0 ? (
                <Card>
                  <Text style={styles.emptyText}>No mandatory requirements defined yet.</Text>
                </Card>
              ) : (
                mandatory.map((req) => (
                  <Card key={req.id} style={styles.requirementCard}>
                    <View style={styles.requirementHeader}>
                      <Text style={styles.requirementName}>{req.name}</Text>
                      <StatusChip status="failed" label="Mandatory" />
                    </View>
                    <Text style={styles.requirementDescription}>{req.description}</Text>
                    {req.verificationStatus === 'unverified' && (
                      <StatusChip status="warning" label="Unverified" />
                    )}
                  </Card>
                ))
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Preferred requirements</Text>
              <Text style={styles.sectionNote}>
                Weighted — contribute to the overall match score.
              </Text>
              {preferred.length === 0 ? (
                <Card>
                  <Text style={styles.emptyText}>No preferred requirements defined yet.</Text>
                </Card>
              ) : (
                preferred.map((req) => (
                  <Card key={req.id} style={styles.requirementCard}>
                    <View style={styles.requirementHeader}>
                      <Text style={styles.requirementName}>{req.name}</Text>
                      <Text style={styles.weightText}>
                        {req.weight === null ? 'Unweighted' : `${req.weight}%`}
                      </Text>
                    </View>
                    <Text style={styles.requirementDescription}>{req.description}</Text>
                    {req.verificationStatus === 'unverified' && (
                      <StatusChip status="warning" label="Unverified" />
                    )}
                  </Card>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.lg16,
    paddingBottom: spacing.xl24,
    gap: spacing.xl24,
  },
  header: {
    gap: spacing.xs4,
  },
  title: {
    ...typeScale.headlineLg,
    color: colors.tertiary,
  },
  subtitle: {
    ...typeScale.bodySm,
    color: colors.textMuted,
  },
  versionRow: {
    marginTop: spacing.xs4,
  },
  noVersionText: {
    ...typeScale.bodySm,
    color: colors.textMuted,
    marginTop: spacing.xs4,
  },
  section: {
    gap: spacing.sm8,
  },
  sectionHeading: {
    ...typeScale.headlineSm,
    color: colors.tertiary,
  },
  sectionNote: {
    ...typeScale.bodySm,
    color: colors.textMuted,
    marginTop: -spacing.xs4,
  },
  requirementCard: {
    gap: spacing.xs4,
    marginBottom: spacing.sm8,
  },
  requirementHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm8,
  },
  requirementName: {
    ...typeScale.bodyMd,
    fontFamily: 'Geist_500Medium',
    color: colors.tertiary,
    flex: 1,
  },
  requirementDescription: {
    ...typeScale.bodySm,
    color: colors.textMuted,
  },
  weightText: {
    ...typeScale.headlineSm,
    color: colors.secondary,
  },
  emptyText: {
    ...typeScale.bodySm,
    color: colors.textMuted,
  },
})
