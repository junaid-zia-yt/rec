/**
 * @rqi/types — shared domain types for the UI foundation (Build Phase 1).
 *
 * These are deliberately database-free: no Supabase client, no query builder,
 * nothing imported from @supabase/*. They exist so apps/web can render real,
 * strictly-typed shapes against mock data now, and be pointed at a real data
 * layer later without a rewrite of any component. See docs/21-implementation-contract.md
 * §21.9 and docs/07-data-model.md for the entities these are modeled on.
 *
 * Status/enum unions are kept separate from their display labels (labels live
 * in apps/web's presentation layer) per the Build Phase 1 brief.
 */
import { z } from 'zod'

export * from './permissions'

// ---------------------------------------------------------------------------
// Enums / status unions (data shape only — no display strings here)
// ---------------------------------------------------------------------------

export const UserRole = z.enum([
  'platform_admin',
  'agency_admin',
  'recruiter',
  'client_decision_maker',
  'read_only_reviewer',
])
export type UserRole = z.infer<typeof UserRole>

export const ProjectStatus = z.enum([
  'intake',
  'sourcing',
  'shortlisting',
  'client_review',
  'closed',
])
export type ProjectStatus = z.infer<typeof ProjectStatus>

export const RequirementType = z.enum([
  'mandatory',
  'preferred',
  'informational',
  'disqualifying',
  'requires_clarification',
])
export type RequirementType = z.infer<typeof RequirementType>

/** Requirement types that are pass/fail gates, never percentage-weighted (Build Phase 4 brief §"Scoring validation"). */
export const UNWEIGHTED_REQUIREMENT_TYPES: RequirementType[] = [
  'mandatory',
  'disqualifying',
  'informational',
  'requires_clarification',
]

export const ScorecardStatus = z.enum(['draft', 'approved', 'archived'])
export type ScorecardStatus = z.infer<typeof ScorecardStatus>

export const PipelineStage = z.enum([
  'sourced',
  'gated',
  'reviewed',
  'shortlisted',
  'submitted',
  'rejected',
])
export type PipelineStage = z.infer<typeof PipelineStage>

export const GateResult = z.enum(['pass', 'fail', 'insufficient_evidence'])
export type GateResult = z.infer<typeof GateResult>

export const VerificationStatus = z.enum(['verified', 'unverified', 'disputed'])
export type VerificationStatus = z.infer<typeof VerificationStatus>

export const ReviewDecision = z.enum(['approved', 'overridden', 'rejected'])
export type ReviewDecision = z.infer<typeof ReviewDecision>

export const OutreachStatus = z.enum(['draft', 'approved', 'sent', 'failed'])
export type OutreachStatus = z.infer<typeof OutreachStatus>

export const ShortlistStatus = z.enum(['draft', 'submitted', 'decided'])
export type ShortlistStatus = z.infer<typeof ShortlistStatus>

export const NotificationType = z.enum([
  'review_pending',
  'gate_failed',
  'client_decision',
  'outreach_response',
])
export type NotificationType = z.infer<typeof NotificationType>

// ---------------------------------------------------------------------------
// Core entities — mirrors docs/07-data-model.md, UI-foundation subset only
// ---------------------------------------------------------------------------

export const UserSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  email: z.string().email(),
  role: UserRole,
  avatarInitials: z.string().max(2),
})
export type User = z.infer<typeof UserSchema>

export const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
})
export type Organization = z.infer<typeof OrganizationSchema>

export const ClientStatus = z.enum(['active', 'inactive'])
export type ClientStatus = z.infer<typeof ClientStatus>

export const ClientSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  vertical: z.string(),
  primaryContactName: z.string().nullable(),
  primaryContactEmail: z.string().email().nullable(),
  primaryContactPhone: z.string().nullable(),
  status: ClientStatus,
  createdAt: z.string(),
})
export type Client = z.infer<typeof ClientSchema>

export const RecruitmentProjectSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  roleTitle: z.string(),
  vertical: z.string(),
  status: ProjectStatus,
  isPoc: z.boolean(),
  targetShortlistSize: z.number().int().min(1).max(3),
  matchThreshold: z.number().min(0).max(100),
  archivedAt: z.string().nullable(),
  /** Explicit per-project opt-in (Build Phase 4 brief §PERMISSIONS): default false — see docs/06-roles-permissions.md §6.2's base "Client Decision-Maker: –" grant on Scorecards. Only an agency_admin may set this. */
  clientCanApproveScorecards: z.boolean(),
  createdAt: z.string(),
})
export type RecruitmentProject = z.infer<typeof RecruitmentProjectSchema>

export const WorkplaceArrangement = z.enum(['on_site', 'hybrid', 'remote'])
export type WorkplaceArrangement = z.infer<typeof WorkplaceArrangement>

export const EmploymentType = z.enum([
  'full_time',
  'part_time',
  'contract',
  'temporary',
  'seasonal',
])
export type EmploymentType = z.infer<typeof EmploymentType>

export const JobStatus = z.enum(['open', 'filled', 'cancelled'])
export type JobStatus = z.infer<typeof JobStatus>

export const JobSchema = z.object({
  id: z.string(),
  recruitmentProjectId: z.string(),
  organizationId: z.string(),
  title: z.string(),
  department: z.string().nullable(),
  industry: z.string().nullable(),
  employmentType: EmploymentType,
  workplaceArrangement: WorkplaceArrangement,
  location: z.string(),
  commutingRadiusMiles: z.number().int().nonnegative().nullable(),
  salaryMin: z.number().nonnegative().nullable(),
  salaryMax: z.number().nonnegative().nullable(),
  currency: z.string().length(3),
  workAuthorizationRequired: z.string().nullable(),
  sponsorshipAvailable: z.boolean(),
  targetStartDate: z.string().nullable(),
  hiringManagerNotes: z.string().nullable(),
  maxShortlistSize: z.number().int().min(1).max(3),
  minMatchThreshold: z.number().min(0).max(100),
  status: JobStatus,
  createdAt: z.string(),
})
export type Job = z.infer<typeof JobSchema>

export const JobDescriptionSource = z.enum(['pasted', 'uploaded_pdf', 'uploaded_docx'])
export type JobDescriptionSource = z.infer<typeof JobDescriptionSource>

export const JobDescriptionStatus = z.enum(['draft', 'parsed', 'reviewed'])
export type JobDescriptionStatus = z.infer<typeof JobDescriptionStatus>

export const JobDescriptionSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  organizationId: z.string(),
  source: JobDescriptionSource,
  rawText: z.string().nullable(),
  fileStoragePath: z.string().nullable(),
  fileName: z.string().nullable(),
  fileMimeType: z.string().nullable(),
  fileSizeBytes: z.number().int().nonnegative().nullable(),
  fileChecksumSha256: z.string().nullable(),
  versionNo: z.number().int().positive(),
  status: JobDescriptionStatus,
  createdAt: z.string(),
})
export type JobDescription = z.infer<typeof JobDescriptionSchema>

export const ProjectAssignmentRole = z.enum(['lead_recruiter', 'recruiter'])
export type ProjectAssignmentRole = z.infer<typeof ProjectAssignmentRole>

export const ProjectAssignmentSchema = z.object({
  id: z.string(),
  recruitmentProjectId: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  assignmentRole: ProjectAssignmentRole,
  createdAt: z.string(),
})
export type ProjectAssignment = z.infer<typeof ProjectAssignmentSchema>

export const ProjectActivitySchema = z.object({
  id: z.string(),
  recruitmentProjectId: z.string(),
  actorName: z.string(),
  action: z.string(),
  summary: z.string(),
  createdAt: z.string(),
})
export type ProjectActivity = z.infer<typeof ProjectActivitySchema>

export const DocumentUploadStatus = z.enum(['active', 'superseded', 'rejected'])
export type DocumentUploadStatus = z.infer<typeof DocumentUploadStatus>

export const DocumentUploadSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  ownerType: z.enum(['job_description', 'candidate_document']),
  ownerId: z.string(),
  storagePath: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  checksumSha256: z.string(),
  status: DocumentUploadStatus,
  uploadedBy: z.string(),
  createdAt: z.string(),
})
export type DocumentUpload = z.infer<typeof DocumentUploadSchema>

export const RequirementSourceStatus = z.enum(['proposed', 'reviewed', 'manually_added'])
export type RequirementSourceStatus = z.infer<typeof RequirementSourceStatus>

export const JobRequirementSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  jobDescriptionId: z.string().nullable(),
  organizationId: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  type: RequirementType,
  /** Percentage weight (0–100), preferred requirements only — see UNWEIGHTED_REQUIREMENT_TYPES. */
  weight: z.number().min(0).max(100).nullable(),
  evidenceExpected: z.string(),
  sourceText: z.string().nullable(),
  sourceLocation: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  verificationStatus: VerificationStatus,
  reviewerNotes: z.string().nullable(),
  status: RequirementSourceStatus,
  aiGenerated: z.boolean(),
  createdAt: z.string(),
})
export type JobRequirement = z.infer<typeof JobRequirementSchema>

export const ScorecardSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  organizationId: z.string(),
  name: z.string(),
  status: ScorecardStatus,
  currentVersionId: z.string().nullable(),
  createdAt: z.string(),
})
export type Scorecard = z.infer<typeof ScorecardSchema>

export const ScorecardVersionStatus = z.enum(['draft', 'pending_approval', 'active', 'superseded'])
export type ScorecardVersionStatus = z.infer<typeof ScorecardVersionStatus>

export const ScorecardVersionSchema = z.object({
  id: z.string(),
  scorecardId: z.string(),
  organizationId: z.string(),
  versionNo: z.number().int().positive(),
  status: ScorecardVersionStatus,
  /** Snapshot of requirement ids + weights/types at approval time — immutable once active (Build Phase 4 brief §"Scoring validation"). */
  requirementSnapshot: z.array(
    z.object({
      requirementId: z.string(),
      type: RequirementType,
      weight: z.number().min(0).max(100).nullable(),
    }),
  ),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type ScorecardVersion = z.infer<typeof ScorecardVersionSchema>

export const ScorecardApprovalDecision = z.enum(['approved', 'rejected', 'changes_requested'])
export type ScorecardApprovalDecision = z.infer<typeof ScorecardApprovalDecision>

export const ScorecardApprovalSchema = z.object({
  id: z.string(),
  scorecardVersionId: z.string(),
  organizationId: z.string(),
  approverId: z.string(),
  approverName: z.string(),
  decision: ScorecardApprovalDecision,
  reason: z.string().nullable(),
  createdAt: z.string(),
})
export type ScorecardApproval = z.infer<typeof ScorecardApprovalSchema>

export const AIRunStatus = z.enum(['success', 'error', 'rejected_by_validation'])
export type AIRunStatus = z.infer<typeof AIRunStatus>

export const AIWorkflowType = z.enum(['requirement_extraction'])
export type AIWorkflowType = z.infer<typeof AIWorkflowType>

export const AIRunSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  workflowType: AIWorkflowType,
  model: z.string(),
  promptVersion: z.string(),
  status: AIRunStatus,
  inputRef: z.string(),
  outputJson: z.unknown().nullable(),
  errorMessage: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  costUsd: z.number().nonnegative().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  retryOfRunId: z.string().nullable(),
  /** Caller-supplied dedupe key so a retried request never double-runs the model (Build Phase 4 brief §"AI operations": Idempotency). */
  idempotencyKey: z.string().nullable(),
  createdAt: z.string(),
})
export type AIRun = z.infer<typeof AIRunSchema>

export const AIPromptVersionSchema = z.object({
  id: z.string(),
  workflowType: AIWorkflowType,
  version: z.string(),
  template: z.string(),
  status: z.enum(['active', 'deprecated']),
  createdAt: z.string(),
})
export type AIPromptVersion = z.infer<typeof AIPromptVersionSchema>

/**
 * Structured shape a requirement-extraction AI call must return — the exact
 * schema handed to the model AND validated on receipt (Build Phase 4 brief
 * §AI WORKFLOW steps 4–6). Deliberately conservative: every field the human
 * reviewer needs to judge AI trust is required, not optional.
 */
export const ExtractedRequirementSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  category: z.string().min(1).max(100),
  type: RequirementType,
  /** Null for unweighted types; a 0–100 integer for `preferred`. The model proposes it, but the deterministic total-must-equal-100 check happens outside this schema. */
  weight: z.number().min(0).max(100).nullable(),
  evidenceExpected: z.string().min(1).max(500),
  /** A verbatim quote from the source JD text — never paraphrased, so a reviewer can Ctrl-F it. */
  sourceText: z.string().min(1).max(1000),
  sourceLocation: z.string().max(200).nullable(),
  confidence: z.number().min(0).max(1),
})
export type ExtractedRequirement = z.infer<typeof ExtractedRequirementSchema>

export const RequirementExtractionOutputSchema = z.object({
  requirements: z.array(ExtractedRequirementSchema).max(60),
  /** Free-text notes on anything the model could not confidently extract — never a reason to invent a requirement. */
  unresolvedNotes: z.array(z.string().max(500)).max(20),
})
export type RequirementExtractionOutput = z.infer<typeof RequirementExtractionOutputSchema>

export const RequirementExtractionResultStatus = z.enum([
  'pending',
  'completed',
  'failed_validation',
  'error',
])
export type RequirementExtractionResultStatus = z.infer<typeof RequirementExtractionResultStatus>

export const RequirementExtractionResultSchema = z.object({
  id: z.string(),
  jobDescriptionId: z.string(),
  organizationId: z.string(),
  aiRunId: z.string().nullable(),
  status: RequirementExtractionResultStatus,
  requirementCount: z.number().int().nonnegative(),
  createdAt: z.string(),
})
export type RequirementExtractionResult = z.infer<typeof RequirementExtractionResultSchema>

export const CandidateSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  avatarInitials: z.string().max(2),
  currentTitle: z.string().nullable(),
  yearsExperience: z.number().nullable(),
  source: z.enum(['linkedin', 'referral', 'apollo', 'manual']),
})
export type Candidate = z.infer<typeof CandidateSchema>

export const MandatoryGateResultSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  requirementId: z.string(),
  requirementLabel: z.string(),
  result: GateResult,
})
export type MandatoryGateResult = z.infer<typeof MandatoryGateResultSchema>

export const EvidenceItemSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  requirementId: z.string(),
  excerpt: z.string(),
  sourceDocumentName: z.string(),
  verificationStatus: VerificationStatus,
  confidence: z.number().min(0).max(1).nullable(),
})
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>

export const CandidateMatchSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  jobId: z.string(),
  scorecardVersionId: z.string(),
  overallScore: z.number().min(0).max(100).nullable(),
  evidencePercent: z.number().min(0).max(100),
  completenessPercent: z.number().min(0).max(100),
  gatesPassed: z.number().int().nonnegative(),
  gatesTotal: z.number().int().nonnegative(),
  stage: PipelineStage,
})
export type CandidateMatch = z.infer<typeof CandidateMatchSchema>

export const HumanReviewSchema = z.object({
  id: z.string(),
  candidateMatchId: z.string(),
  reviewerName: z.string(),
  decision: ReviewDecision,
  reason: z.string().nullable(),
  decidedAt: z.string(),
})
export type HumanReview = z.infer<typeof HumanReviewSchema>

export const OutreachActivitySchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  channel: z.enum(['email', 'linkedin', 'sms']),
  status: OutreachStatus,
  subject: z.string().nullable(),
  sentAt: z.string().nullable(),
})
export type OutreachActivity = z.infer<typeof OutreachActivitySchema>

export const ShortlistSchema = z.object({
  id: z.string(),
  recruitmentProjectId: z.string(),
  status: ShortlistStatus,
  candidateIds: z.array(z.string()).max(3),
})
export type Shortlist = z.infer<typeof ShortlistSchema>

/** LEGACY Build Phase 1 demo schema backing mock-data.ts's DEMO_COMPARISON grid (a candidate-comparison view) — NOT the Build Phase 10 POC process-benchmark schema. See PocBenchmarkSchema/PocMetricDataPointSchema/PocResultSchema etc. below for the real, DB-aligned client-baseline-vs-vendor-assisted comparison types this name might otherwise be confused with. */
export const POCMetricSchema = z.object({
  id: z.string(),
  recruitmentProjectId: z.string(),
  label: z.string(),
  vendorValue: z.number(),
  clientValue: z.number().nullable(),
  unit: z.enum(['percent', 'hours', 'count']),
})
export type POCMetric = z.infer<typeof POCMetricSchema>

export const NotificationSchema = z.object({
  id: z.string(),
  type: NotificationType,
  message: z.string(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
})
export type Notification = z.infer<typeof NotificationSchema>

export const AuditEventSchema = z.object({
  id: z.string(),
  actorName: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  createdAt: z.string(),
})
export type AuditEvent = z.infer<typeof AuditEventSchema>

// ---------------------------------------------------------------------------
// Candidate Foundation (Build Phase 5) — docs/07-data-model.md §7.1/§7.4.
//
// `CandidatePipelineStage` is deliberately a NEW, separate enum from the
// existing `PipelineStage` above ('sourced'|'gated'|'reviewed'|'shortlisted'
// |'submitted'|'rejected'), which docs/07-data-model.md §7.1 defines for the
// not-yet-built `candidate_role_matches` table (a candidate×job AI-scoring
// instance — out of scope this phase: "Do not implement AI CV parsing or
// match scoring yet"). This phase's stage tracks a candidate's overall
// journey through a project, independent of any score. See
// docs/build-phase-5-report.md for the full rationale.
// ---------------------------------------------------------------------------

export const CandidatePipelineStage = z.enum([
  'discovered',
  'eligibility_check',
  'scored',
  'quality_review',
  'outreach',
  'shortlisted',
  'rejected',
  'withdrawn',
])
export type CandidatePipelineStage = z.infer<typeof CandidatePipelineStage>

/** Sequential "active" stages a candidate normally moves forward through one step at a time — everything except the two terminal stages. */
export const ACTIVE_CANDIDATE_PIPELINE_STAGES: CandidatePipelineStage[] = [
  'discovered',
  'eligibility_check',
  'scored',
  'quality_review',
  'outreach',
  'shortlisted',
]

export const TERMINAL_CANDIDATE_PIPELINE_STAGES: CandidatePipelineStage[] = [
  'rejected',
  'withdrawn',
]

export const CandidateStatus = z.enum(['active', 'archived', 'merged', 'deletion_requested'])
export type CandidateStatus = z.infer<typeof CandidateStatus>

export const WorkplacePreference = z.enum(['remote', 'hybrid', 'onsite', 'flexible'])
export type WorkplacePreference = z.infer<typeof WorkplacePreference>

export const CompensationPeriod = z.enum(['annual', 'hourly', 'daily', 'monthly'])
export type CompensationPeriod = z.infer<typeof CompensationPeriod>

export const ContactPointType = z.enum(['email', 'phone', 'linkedin', 'other'])
export type ContactPointType = z.infer<typeof ContactPointType>

export const CandidateSourceChannel = z.enum([
  'linkedin',
  'referral',
  'apollo',
  'manual',
  'csv_import',
  'job_board',
  'other',
])
export type CandidateSourceChannel = z.infer<typeof CandidateSourceChannel>

export const CandidateDocumentType = z.enum(['cv', 'cover_letter', 'reference', 'other'])
export type CandidateDocumentType = z.infer<typeof CandidateDocumentType>

export const SkillProficiency = z.enum(['beginner', 'intermediate', 'advanced', 'expert'])
export type SkillProficiency = z.infer<typeof SkillProficiency>

export const CandidateRecordSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  fullName: z.string().min(1),
  primaryEmail: z.string().nullable(),
  primaryPhone: z.string().nullable(),
  status: CandidateStatus,
  mergedIntoCandidateId: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type CandidateRecord = z.infer<typeof CandidateRecordSchema>

export const CandidateProfileSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  currentTitle: z.string().nullable(),
  currentCompany: z.string().nullable(),
  summary: z.string().nullable(),
  location: z.string().nullable(),
  workAuthorization: z.string().nullable(),
  compensationMin: z.number().nullable(),
  compensationMax: z.number().nullable(),
  compensationCurrency: z.string(),
  compensationPeriod: CompensationPeriod.nullable(),
  availabilityDate: z.string().nullable(),
  availabilityNotes: z.string().nullable(),
  noticePeriodDays: z.number().int().nullable(),
  workplacePreference: WorkplacePreference.nullable(),
  yearsExperience: z.number().nullable(),
  /** Internal only — never sent to a client_decision_maker caller (apps/web/lib/candidates/visibility.ts). */
  recruiterNotes: z.string().nullable(),
  /** The one note field a client reviewer may see. */
  clientVisibleNotes: z.string().nullable(),
})
export type CandidateProfile = z.infer<typeof CandidateProfileSchema>

/** The client-safe projection of CandidateProfile — omits recruiterNotes entirely rather than nulling it, so a serialization bug can't leak the field back in. */
export type ClientVisibleCandidateProfile = Omit<CandidateProfile, 'recruiterNotes'>

export const CandidateContactPointSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  type: ContactPointType,
  value: z.string(),
  isPrimary: z.boolean(),
})
export type CandidateContactPoint = z.infer<typeof CandidateContactPointSchema>

export const CandidateDocumentSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  documentUploadId: z.string(),
  docType: CandidateDocumentType,
  versionNo: z.number().int().positive(),
  status: z.enum(['active', 'superseded', 'rejected']),
  fileName: z.string(),
  checksumSha256: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.string(),
})
export type CandidateDocument = z.infer<typeof CandidateDocumentSchema>

export const CandidateExperienceSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  company: z.string().min(1),
  title: z.string().min(1),
  location: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  isCurrent: z.boolean(),
  description: z.string().nullable(),
})
export type CandidateExperience = z.infer<typeof CandidateExperienceSchema>

export const CandidateEducationSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  institution: z.string().min(1),
  degree: z.string().nullable(),
  fieldOfStudy: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
})
export type CandidateEducation = z.infer<typeof CandidateEducationSchema>

export const CandidateCertificationSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  name: z.string().min(1),
  issuingBody: z.string().nullable(),
  issuedDate: z.string().nullable(),
  expiresDate: z.string().nullable(),
})
export type CandidateCertification = z.infer<typeof CandidateCertificationSchema>

export const CandidateSkillSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  skillName: z.string().min(1),
  proficiency: SkillProficiency.nullable(),
  yearsExperience: z.number().nullable(),
})
export type CandidateSkill = z.infer<typeof CandidateSkillSchema>

export const CandidateSourceSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  recruitmentProjectId: z.string().nullable(),
  channel: CandidateSourceChannel,
  sourceDetail: z.string().nullable(),
  sourcedAt: z.string(),
})
export type CandidateSource = z.infer<typeof CandidateSourceSchema>

export const CandidateProjectEntrySchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  recruitmentProjectId: z.string(),
  jobId: z.string().nullable(),
  currentStage: CandidatePipelineStage,
  clientVisible: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type CandidateProjectEntry = z.infer<typeof CandidateProjectEntrySchema>

export const CandidatePipelineEventSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  recruitmentProjectId: z.string(),
  fromStage: CandidatePipelineStage.nullable(),
  toStage: CandidatePipelineStage,
  actorName: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
})
export type CandidatePipelineEvent = z.infer<typeof CandidatePipelineEventSchema>

export const ConsentStatus = z.enum(['granted', 'withdrawn', 'unknown'])
export type ConsentStatus = z.infer<typeof ConsentStatus>

export const CandidateConsentSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  consentStatus: ConsentStatus,
  consentRecordedAt: z.string().nullable(),
  deletionRequested: z.boolean(),
  deletionRequestedAt: z.string().nullable(),
  deletionReason: z.string().nullable(),
})
export type CandidateConsent = z.infer<typeof CandidateConsentSchema>

/** One row of a reviewed CSV import — Build Phase 5 brief §"CSV import review". Deterministic validation only, never AI. */
export const CsvCandidateRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  fullName: z.string().min(1, 'Full name is required.'),
  primaryEmail: z.string().email('Not a valid email.').or(z.literal('')).nullable(),
  primaryPhone: z.string().nullable(),
  currentTitle: z.string().nullable(),
  currentCompany: z.string().nullable(),
  location: z.string().nullable(),
})
export type CsvCandidateRow = z.infer<typeof CsvCandidateRowSchema>

export const CsvRowValidationSchema = z.object({
  row: CsvCandidateRowSchema,
  valid: z.boolean(),
  errors: z.array(z.string()),
})
export type CsvRowValidation = z.infer<typeof CsvRowValidationSchema>

/** A possible-duplicate suggestion surfaced to a recruiter — Build Phase 5 brief §"Deduplication". Never a merge decision itself; always requires a human. */
export const DuplicateMatchBasis = z.enum([
  'exact_email',
  'exact_phone',
  'document_checksum',
  'fuzzy',
])
export type DuplicateMatchBasis = z.infer<typeof DuplicateMatchBasis>

export const DuplicateCandidateSuggestionSchema = z.object({
  candidateId: z.string(),
  matchedCandidateId: z.string(),
  basis: DuplicateMatchBasis,
  /** 0-1; only present for a fuzzy suggestion — exact bases are always confidence 1. */
  score: z.number().min(0).max(1),
})
export type DuplicateCandidateSuggestion = z.infer<typeof DuplicateCandidateSuggestionSchema>

// ---------------------------------------------------------------------------
// AI Candidate Document Processing — Build Phase 6 brief. Two concerns kept
// deliberately distinct, matching the DB schema (supabase/migrations/0022):
//   1. The AI OUTPUT schema (CandidateExtractionOutputSchema) — what the
//      model itself must produce, validated with Zod immediately on receipt,
//      before anything touches the database (docs/09-ai-architecture.md).
//   2. The stored ROW schemas (CandidateDocumentProcessingJobSchema,
//      CandidateExtractedFieldSchema) — one processing attempt, and one
//      evidence row per extracted-or-unknown field, matching
//      candidate_document_processing_jobs / candidate_extracted_fields.
// ---------------------------------------------------------------------------

export const CandidateDocumentProcessingStatus = z.enum([
  'queued',
  'extracting_text',
  'needs_ocr',
  'parsing',
  'awaiting_review',
  'completed',
  'failed',
])
export type CandidateDocumentProcessingStatus = z.infer<typeof CandidateDocumentProcessingStatus>

export const TextExtractionMethod = z.enum(['deterministic', 'ocr'])
export type TextExtractionMethod = z.infer<typeof TextExtractionMethod>

export const ProcessingErrorKind = z.enum([
  'corrupted_file',
  'unsupported_format',
  'size_limit_exceeded',
  'ocr_not_configured',
  'ai_not_configured',
  'timeout',
  'network',
  'provider_error',
  'validation_failed',
])
export type ProcessingErrorKind = z.infer<typeof ProcessingErrorKind>

export const CandidateDocumentProcessingJobSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  candidateDocumentId: z.string(),
  status: CandidateDocumentProcessingStatus,
  textExtractionMethod: TextExtractionMethod.nullable(),
  extractedCharCount: z.number().int().nullable(),
  errorKind: ProcessingErrorKind.nullable(),
  errorMessage: z.string().nullable(),
  aiRunId: z.string().nullable(),
  promptVersion: z.string().nullable(),
  model: z.string().nullable(),
  retried: z.boolean(),
  attemptNo: z.number().int().positive(),
  reprocessOfJobId: z.string().nullable(),
  reprocessReason: z.string().nullable(),
  requestedBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
})
export type CandidateDocumentProcessingJob = z.infer<typeof CandidateDocumentProcessingJobSchema>

export const ExtractedFieldGroup = z.enum([
  'contact',
  'profile',
  'experience',
  'education',
  'certification',
  'skill',
])
export type ExtractedFieldGroup = z.infer<typeof ExtractedFieldGroup>

/** Distinct from ConsentStatus — this is a human reviewer's decision on one AI-proposed field, brief §EVIDENCE RULES/§HUMAN CONTROL: "AI-extracted data must remain pending until reviewed." */
export const FieldVerificationStatus = z.enum(['pending', 'verified', 'rejected', 'edited'])
export type FieldVerificationStatus = z.infer<typeof FieldVerificationStatus>

export const CandidateExtractedFieldSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  processingJobId: z.string(),
  fieldGroup: ExtractedFieldGroup,
  fieldKey: z.string(),
  itemIndex: z.number().int().nonnegative().nullable(),
  extractedValue: z.unknown().nullable(),
  /** false means the brief's "unknown" — no value, no excerpt, no confidence, never a guess. */
  hasEvidence: z.boolean(),
  sourceDocumentId: z.string().nullable(),
  sourceLocation: z.string().nullable(),
  sourceExcerpt: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  verificationStatus: FieldVerificationStatus,
  editedValue: z.unknown().nullable(),
  reviewerId: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  /** When this field's value was actually written into candidate_profiles/candidate_experiences/etc — AI PIPELINE step 10, never destroying the original document. */
  appliedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type CandidateExtractedField = z.infer<typeof CandidateExtractedFieldSchema>

/**
 * A single evidence-wrapped scalar the model extracts (brief §EVIDENCE
 * RULES applied to a fullName/location/title-shaped field, not a repeated
 * group). `hasEvidence: false` is the model's explicit "unknown" — the
 * schema-level mirror of candidate_extracted_fields_unknown_shape's DB
 * constraint (0022): value/sourceExcerpt/confidence must all be null
 * together when hasEvidence is false, never a partial guess.
 */
function extractedScalarField<T extends z.ZodTypeAny>(valueSchema: T) {
  return z
    .object({
      value: valueSchema.nullable(),
      hasEvidence: z.boolean(),
      sourceExcerpt: z.string().nullable(),
      sourceLocation: z.string().nullable(),
      confidence: z.number().min(0).max(1).nullable(),
    })
    .refine(
      (field) =>
        field.hasEvidence ||
        (field.value === null && field.sourceExcerpt === null && field.confidence === null),
      {
        message:
          'hasEvidence=false must carry no value, excerpt, or confidence — return unknown, never a partial guess.',
      },
    )
}

const ExtractedContactSchema = z.object({
  type: ContactPointType,
  value: z.string().min(1),
  sourceExcerpt: z.string(),
  sourceLocation: z.string().nullable(),
  confidence: z.number().min(0).max(1),
})

const ExtractedEmploymentHistoryItemSchema = z.object({
  company: z.string().min(1),
  title: z.string().min(1),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  isCurrent: z.boolean(),
  responsibilities: z.array(z.string()).max(30),
  sourceExcerpt: z.string(),
  sourceLocation: z.string().nullable(),
  confidence: z.number().min(0).max(1),
})

const ExtractedSkillItemSchema = z.object({
  skillName: z.string().min(1),
  sourceExcerpt: z.string(),
  sourceLocation: z.string().nullable(),
  confidence: z.number().min(0).max(1),
})

const ExtractedEducationItemSchema = z.object({
  institution: z.string().min(1),
  degree: z.string().nullable(),
  fieldOfStudy: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  sourceExcerpt: z.string(),
  sourceLocation: z.string().nullable(),
  confidence: z.number().min(0).max(1),
})

const ExtractedCertificationItemSchema = z.object({
  name: z.string().min(1),
  issuingBody: z.string().nullable(),
  issuedDate: z.string().nullable(),
  expiresDate: z.string().nullable(),
  sourceExcerpt: z.string(),
  sourceLocation: z.string().nullable(),
  confidence: z.number().min(0).max(1),
})

const ExtractedIndustryExposureItemSchema = z.object({
  industry: z.string().min(1),
  sourceExcerpt: z.string(),
  sourceLocation: z.string().nullable(),
  confidence: z.number().min(0).max(1),
})

/**
 * The strict structured schema every CV-parsing model call must produce
 * (brief §AI PIPELINE step 6/7, §EXTRACT's exact field list). Every list
 * item carries its own evidence (an empty array = "found nothing", which is
 * different from the "unknown" scalar case); every scalar is
 * evidence-wrapped so the model can honestly report "not stated" instead of
 * inventing a value — most importantly for workAuthorization/compensation/
 * availability, which the brief requires be populated "only when explicitly
 * stated" (enforced primarily by the prompt, since "explicitness" is not a
 * schema-checkable property — see lib/ai/candidate-prompt.ts).
 */
export const CandidateExtractionOutputSchema = z.object({
  fullName: extractedScalarField(z.string().min(1)),
  contactDetails: z.array(ExtractedContactSchema).max(10),
  location: extractedScalarField(z.string().min(1)),
  currentTitle: extractedScalarField(z.string().min(1)),
  currentCompany: extractedScalarField(z.string().min(1)),
  employmentHistory: z.array(ExtractedEmploymentHistoryItemSchema).max(40),
  skills: z.array(ExtractedSkillItemSchema).max(60),
  education: z.array(ExtractedEducationItemSchema).max(20),
  certifications: z.array(ExtractedCertificationItemSchema).max(20),
  industryExposure: z.array(ExtractedIndustryExposureItemSchema).max(15),
  leadershipScope: extractedScalarField(z.string().min(1)),
  pnlResponsibility: extractedScalarField(z.string().min(1)),
  /** Brief §EXTRACT: "Work authorization only when explicitly stated." */
  workAuthorization: extractedScalarField(z.string().min(1)),
  /** Brief §EXTRACT: "Compensation only when explicitly stated." */
  compensation: extractedScalarField(z.string().min(1)),
  /** Brief §EXTRACT: "Availability only when explicitly stated." */
  availability: extractedScalarField(z.string().min(1)),
  /** Anything the model noticed but could not confidently structure — mirrors RequirementExtractionOutputSchema's unresolvedNotes convention. */
  unresolvedNotes: z.array(z.string()).max(20),
})
export type CandidateExtractionOutput = z.infer<typeof CandidateExtractionOutputSchema>
export type ExtractedScalarField<T = unknown> = {
  value: T | null
  hasEvidence: boolean
  sourceExcerpt: string | null
  sourceLocation: string | null
  confidence: number | null
}

// ---------------------------------------------------------------------------
// Candidate Matching (Build Phase 7) — docs/08-candidate-scoring.md,
// docs/07-data-model.md §7.9, supabase/migrations/0027.
//
// These are the REAL, DB-aligned schemas for the matching pipeline —
// deliberately named apart from the Build Phase 1/2 UI-mockup placeholders
// above (`CandidateMatchSchema`, `MandatoryGateResultSchema`,
// `EvidenceItemSchema`, `HumanReviewSchema`, `ReviewDecision`), which remain
// as the shape `apps/web/lib/mock-data.ts`'s DEMO_* fixtures use for the
// existing demo-mode screens and are left untouched by this phase.
// ---------------------------------------------------------------------------

/** System defaults for the brief's "configurable, never hardcoded" quality thresholds — resolved per-scorecard by apps/web/lib/matching/thresholds.ts, which falls back to these only when a scorecard has no override (supabase/migrations/0027). Never referenced directly from scoring logic. */
export const DEFAULT_RANKED_CONSIDERATION_THRESHOLD_PCT = 90
export const DEFAULT_PREFERRED_SHORTLIST_THRESHOLD_PCT = 95
/** Structural guarantees, not configurable numbers (docs/10-ai-evaluation-guardrails.md §10.13) — listed here for reference, not stored per-scorecard. */
export const MANDATORY_GATE_COMPLIANCE_PCT = 100
export const MAX_TOLERATED_UNSUPPORTED_CLAIMS = 0

export const MatchingRunStatus = z.enum([
  'queued',
  'evaluating_gates',
  'assessing_semantic',
  'scoring',
  'completed',
  'failed',
])
export type MatchingRunStatus = z.infer<typeof MatchingRunStatus>

export const MatchingTriggerReason = z.enum([
  'initial_evaluation',
  'scorecard_version_changed',
  'candidate_document_updated',
  'manual_reevaluation',
])
export type MatchingTriggerReason = z.infer<typeof MatchingTriggerReason>

export const MatchingErrorKind = z.enum([
  'ai_not_configured',
  'timeout',
  'network',
  'provider_error',
  'validation_failed',
  'internal_error',
])
export type MatchingErrorKind = z.infer<typeof MatchingErrorKind>

export const MatchingRunSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  candidateId: z.string(),
  jobId: z.string(),
  recruitmentProjectId: z.string(),
  scorecardId: z.string(),
  scorecardVersionId: z.string(),
  status: MatchingRunStatus,
  triggerReason: MatchingTriggerReason,
  triggerNote: z.string().nullable(),
  aiRunId: z.string().nullable(),
  errorKind: MatchingErrorKind.nullable(),
  errorMessage: z.string().nullable(),
  requestedBy: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type MatchingRun = z.infer<typeof MatchingRunSchema>

/** Deterministic per-mandatory-requirement outcome (docs/08-candidate-scoring.md §8.5). Reuses the existing `GateResult` enum (`pass`/`fail`/`insufficient_evidence`) already defined above for the demo mock layer — same three values, now the real deterministic-layer output. */
export const MandatoryDeterministicResult = GateResult

/** The brief's five displayed mandatory-gate states — distinct from, and derived from, `MandatoryDeterministicResult` (see supabase/migrations/0027 for the exact derivation/override rules). */
export const MandatoryGateState = z.enum([
  'passed',
  'failed',
  'unknown',
  'requires_verification',
  'human_override',
])
export type MandatoryGateState = z.infer<typeof MandatoryGateState>

export const CandidateEligibility = z.enum(['eligible', 'ineligible', 'pending_verification'])
export type CandidateEligibility = z.infer<typeof CandidateEligibility>

export const MatchReviewStatus = z.enum([
  'pending',
  'approved_for_outreach',
  'rejected',
  'requires_verification',
  'escalated',
])
export type MatchReviewStatus = z.infer<typeof MatchReviewStatus>

/** The current-state projection for one (candidate, job) pair — what the shortlist/pipeline UI actually reads (supabase/migrations/0027, docs/08-candidate-scoring.md). Shows eligibility, score, evidence coverage, completeness, confidence and review status SEPARATELY, per the brief: "Do not combine these into one misleading number." */
export const CandidateRoleMatchSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  candidateId: z.string(),
  jobId: z.string(),
  recruitmentProjectId: z.string(),
  scorecardVersionId: z.string(),
  latestMatchingRunId: z.string(),
  eligibility: CandidateEligibility,
  /** NULL whenever eligibility is not 'eligible' — enforced at the DB layer, not just here. */
  overallScore: z.number().min(0).max(100).nullable(),
  evidenceCoveragePct: z.number().min(0).max(100),
  dataCompletenessPct: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1).nullable(),
  reviewStatus: MatchReviewStatus,
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type CandidateRoleMatch = z.infer<typeof CandidateRoleMatchSchema>

export const MatchGateResultSchema = z.object({
  id: z.string(),
  matchingRunId: z.string(),
  candidateRoleMatchId: z.string(),
  requirementId: z.string(),
  requirementName: z.string(),
  deterministicResult: MandatoryDeterministicResult,
  aiSuggestedResult: MandatoryDeterministicResult.nullable(),
  aiSuggestionNote: z.string().nullable(),
  riskNotes: z.array(z.string()).default([]),
  state: MandatoryGateState,
  verificationRequestedBy: z.string().nullable(),
  verificationRequestedAt: z.string().nullable(),
  verificationNote: z.string().nullable(),
  overrideResult: z.enum(['pass', 'fail']).nullable(),
  overrideBy: z.string().nullable(),
  overrideReason: z.string().nullable(),
  overrideEvidenceNote: z.string().nullable(),
  overrideAt: z.string().nullable(),
  createdAt: z.string(),
})
export type MatchGateResult = z.infer<typeof MatchGateResultSchema>

export const RequirementEvidenceSourceKind = z.enum([
  'experience',
  'education',
  'certification',
  'skill',
  'extracted_field',
  'profile',
])
export type RequirementEvidenceSourceKind = z.infer<typeof RequirementEvidenceSourceKind>

export const MatchRequirementEvidenceSchema = z.object({
  id: z.string(),
  matchingRunId: z.string(),
  candidateRoleMatchId: z.string(),
  requirementId: z.string(),
  candidateId: z.string(),
  sourceKind: RequirementEvidenceSourceKind,
  sourceExperienceId: z.string().nullable(),
  sourceEducationId: z.string().nullable(),
  sourceCertificationId: z.string().nullable(),
  sourceSkillId: z.string().nullable(),
  sourceExtractedFieldId: z.string().nullable(),
  excerpt: z.string().min(1),
  location: z.string().nullable(),
  relevanceScore: z.number().min(0).max(1).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  isDirectStatement: z.boolean(),
  createdAt: z.string(),
})
export type MatchRequirementEvidence = z.infer<typeof MatchRequirementEvidenceSchema>

export const MatchScoringBreakdownSchema = z.object({
  id: z.string(),
  matchingRunId: z.string(),
  candidateRoleMatchId: z.string(),
  requirementId: z.string(),
  requirementName: z.string(),
  weight: z.number().min(0).max(100),
  rawScore: z.number().min(0).max(1).nullable(),
  confidenceDiscount: z.number().min(0).max(1),
  effectiveScore: z.number().min(0).max(1).nullable(),
  weightedContribution: z.number(),
  hasEvidence: z.boolean(),
  riskNotes: z.array(z.string()).default([]),
  createdAt: z.string(),
})
export type MatchScoringBreakdown = z.infer<typeof MatchScoringBreakdownSchema>

export const MatchHumanReviewDecision = z.enum([
  'approved_for_outreach',
  'rejected',
  'requires_verification',
  'gate_overridden',
  'escalated',
  'note_added',
])
export type MatchHumanReviewDecision = z.infer<typeof MatchHumanReviewDecision>

export const MatchHumanReviewSchema = z.object({
  id: z.string(),
  candidateRoleMatchId: z.string(),
  matchingRunId: z.string(),
  reviewerId: z.string(),
  decision: MatchHumanReviewDecision,
  reason: z.string().nullable(),
  createdAt: z.string(),
})
export type MatchHumanReview = z.infer<typeof MatchHumanReviewSchema>

export const MatchReviewDecisionSchema = z.object({
  id: z.string(),
  humanReviewId: z.string(),
  field: z.string(),
  beforeValue: z.unknown().nullable(),
  afterValue: z.unknown().nullable(),
  reason: z.string().min(1),
  createdAt: z.string(),
})
export type MatchReviewDecisionRecord = z.infer<typeof MatchReviewDecisionSchema>

// ---------------------------------------------------------------------------
// Build Phase 8 — Human Review and Shortlisting (supabase/migrations/0028,
// docs/07-data-model.md §7.1). Deliberately named apart from the legacy
// Build Phase 1/2 demo mock schemas above (`ShortlistSchema`,
// `ShortlistStatus`, `HumanReviewSchema`) — those still back
// mock-data.ts's DEMO_SHORTLIST fixture and are left untouched; these are
// the real, DB-aligned schemas.
// ---------------------------------------------------------------------------

export const VerificationRequestStatus = z.enum(['open', 'resolved', 'cancelled'])
export type VerificationRequestStatus = z.infer<typeof VerificationRequestStatus>

/** Candidate-level "Request verification" workflow object (Build Phase 8 brief). Distinct from MatchGateResult's per-gate verificationRequested* fields — this is the trackable open/resolved entity a reviewer's decision creates. */
export const VerificationRequestSchema = z.object({
  id: z.string(),
  candidateRoleMatchId: z.string(),
  humanReviewId: z.string().nullable(),
  requirementId: z.string().nullable(),
  requestedBy: z.string(),
  requestNote: z.string().min(1),
  status: VerificationRequestStatus,
  resolvedBy: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  resolutionNote: z.string().nullable(),
  createdAt: z.string(),
})
export type VerificationRequest = z.infer<typeof VerificationRequestSchema>

/** Mirrors the Build Phase 8 brief's workflow tail exactly: Proposed Shortlist -> Internal Approval -> Client Review -> Accepted/Discuss/Rejected. */
export const ShortlistRecordStatus = z.enum([
  'draft',
  'pending_internal_approval',
  'internally_approved',
  'sent_to_client',
  'accepted',
  'discuss',
  'rejected',
])
export type ShortlistRecordStatus = z.infer<typeof ShortlistRecordStatus>

/** One shortlist header per job (supabase/migrations/0028). Mutable "current state"; ShortlistVersionSchema below is the immutable-snapshot history. */
export const ShortlistRecordSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  recruitmentProjectId: z.string(),
  jobId: z.string(),
  clientId: z.string(),
  status: ShortlistRecordStatus,
  maxCandidates: z.number().int().positive(),
  overrideMaxCandidates: z.boolean(),
  overrideBy: z.string().nullable(),
  overrideReason: z.string().nullable(),
  currentVersionId: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ShortlistRecord = z.infer<typeof ShortlistRecordSchema>

export const ShortlistVersionStatus = z.enum([
  'draft',
  'submitted',
  'internally_approved',
  'sent_to_client',
  'superseded',
])
export type ShortlistVersionStatus = z.infer<typeof ShortlistVersionStatus>

/** Immutable snapshot per shortlist submission cycle (mirrors ScorecardVersion). ShortlistCandidateSchema rows belong to exactly one version, so a client decision always points at a fixed, unchangeable candidate set. */
export const ShortlistVersionSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  shortlistId: z.string(),
  versionNumber: z.number().int().positive(),
  status: ShortlistVersionStatus,
  submittedBy: z.string().nullable(),
  submittedAt: z.string().nullable(),
  internallyApprovedBy: z.string().nullable(),
  internallyApprovedAt: z.string().nullable(),
  sentToClientBy: z.string().nullable(),
  sentToClientAt: z.string().nullable(),
  note: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
})
export type ShortlistVersion = z.infer<typeof ShortlistVersionSchema>

/** Candidates on one ShortlistVersion. matchingRunId/scorecardVersionId are frozen at add-time (brief: "preserve candidate evaluation version"). recruiterNote is internal-only — never returned to a client_decision_maker caller (apps/web/lib/shortlists/visibility.ts). */
export const ShortlistCandidateSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  shortlistVersionId: z.string(),
  candidateRoleMatchId: z.string(),
  candidateId: z.string(),
  matchingRunId: z.string(),
  scorecardVersionId: z.string(),
  rank: z.number().int().positive(),
  recruiterNote: z.string().nullable(),
  addedBy: z.string().nullable(),
  addedAt: z.string(),
})
export type ShortlistCandidate = z.infer<typeof ShortlistCandidateSchema>

/** Client-safe projection of ShortlistCandidateSchema (no recruiterNote, no internal ids beyond what the client-review UI needs). Produced by apps/web/lib/shortlists/visibility.ts, never sent to the DB. */
export const ClientSafeShortlistCandidateSchema = ShortlistCandidateSchema.omit({
  recruiterNote: true,
})
export type ClientSafeShortlistCandidate = z.infer<typeof ClientSafeShortlistCandidateSchema>

export const ClientDecisionKind = z.enum(['accept', 'discuss', 'reject'])
export type ClientDecisionKind = z.infer<typeof ClientDecisionKind>

/** Append-only client Accept/Discuss/Reject record against one frozen ShortlistVersion (Build Phase 8 brief §"Client decisions": "require rejection or discussion notes"). */
export const ClientDecisionSchema = z.object({
  id: z.string(),
  shortlistId: z.string(),
  shortlistVersionId: z.string(),
  clientId: z.string(),
  decidedBy: z.string(),
  decision: ClientDecisionKind,
  notes: z.string().nullable(),
  createdAt: z.string(),
})
export type ClientDecisionRecord = z.infer<typeof ClientDecisionSchema>

/** Shortlist-scoped activity feed (mirrors ProjectActivity). clientVisible gates whether a client_decision_maker caller may ever see this row (brief: "Do not expose private recruiter notes to clients"). */
export const ShortlistActivitySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  shortlistId: z.string(),
  actorId: z.string().nullable(),
  action: z.string(),
  summary: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  clientVisible: z.boolean(),
  createdAt: z.string(),
})
export type ShortlistActivityEntry = z.infer<typeof ShortlistActivitySchema>

/** Candidate interest tri-state added to candidate_project_entries (Build Phase 8 brief workflow step "Candidate Interest Confirmed"). Recorded by a recruiter from an outreach response, never inferred by AI. */
export const CandidateInterestStatus = z.enum(['unknown', 'interested', 'declined'])
export type CandidateInterestStatus = z.infer<typeof CandidateInterestStatus>

// ---------------------------------------------------------------------------
// Build Phase 9 — Outreach (supabase/migrations/0029, docs/07-data-model.md
// §7.1/§7.2). Deliberately named apart from the legacy Build Phase 1/2 demo
// mock schemas above (`OutreachStatus`, `ShortlistStatus`, `NotificationType`
// stay untouched — they back mock-data.ts's DEMO_* fixtures); these are the
// real, DB-aligned schemas. Channel adapters, AI drafting and send/receive
// plumbing are next-wave work — this file only types the schema this
// migration laid down.
// ---------------------------------------------------------------------------

/** A candidate contact/communication channel. LinkedIn is always a manual recruiter workflow (docs/11-integration-plan.md §11.3) — never automated sending, regardless of this type existing as a channel value. */
export const CommunicationChannel = z.enum(['email', 'phone', 'linkedin', 'sms'])
export type CommunicationChannel = z.infer<typeof CommunicationChannel>

/** Per (candidate, channel) opt-in/opt-out status (supabase/migrations/0029). Distinct from the existing CandidateConsent-style record — a candidate can opt out of SMS while staying reachable by email. The deterministic, never-AI-overridable opt-out source of truth. */
export const CommunicationPreferenceStatus = z.enum(['opted_in', 'opted_out', 'unknown'])
export type CommunicationPreferenceStatus = z.infer<typeof CommunicationPreferenceStatus>

export const CommunicationPreferenceConsentSource = z.enum([
  'candidate_request',
  'recruiter_recorded',
  'response_classification',
  'import',
])
export type CommunicationPreferenceConsentSource = z.infer<
  typeof CommunicationPreferenceConsentSource
>

export const CommunicationPreferenceSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  candidateId: z.string(),
  channel: CommunicationChannel,
  status: CommunicationPreferenceStatus,
  consentSource: CommunicationPreferenceConsentSource.nullable(),
  optedOutAt: z.string().nullable(),
  optedOutReason: z.string().nullable(),
  optedOutBy: z.string().nullable(),
  updatedBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type CommunicationPreference = z.infer<typeof CommunicationPreferenceSchema>

/** Org-level reusable per-channel message template (supabase/migrations/0029). Not candidate-specific. */
export const OutreachTemplateSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string().min(1),
  channel: CommunicationChannel,
  subjectTemplate: z.string().nullable(),
  bodyTemplate: z.string().min(1),
  description: z.string().nullable(),
  isActive: z.boolean(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type OutreachTemplate = z.infer<typeof OutreachTemplateSchema>

export const OutreachSequenceStatus = z.enum(['active', 'completed', 'cancelled'])
export type OutreachSequenceStatus = z.infer<typeof OutreachSequenceStatus>

/** One outreach plan per candidate_role_match (supabase/migrations/0029). Requires the underlying match to already be review_status = 'approved_for_outreach' — enforced by a DB trigger, not just this type. */
export const OutreachSequenceSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  candidateRoleMatchId: z.string(),
  candidateId: z.string(),
  recruitmentProjectId: z.string(),
  jobId: z.string(),
  name: z.string().nullable(),
  status: OutreachSequenceStatus,
  startedBy: z.string().nullable(),
  startedAt: z.string(),
  cancelledBy: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type OutreachSequence = z.infer<typeof OutreachSequenceSchema>

/** Brief-exact 9-value status machine (Build Phase 9 brief §FUNCTIONAL REQUIREMENTS #8): drafted -> awaiting_approval -> approved -> scheduled -> sent -> delivered/failed -> responded, or cancelled at any point before sent. */
export const OutreachMessageStatus = z.enum([
  'drafted',
  'awaiting_approval',
  'approved',
  'scheduled',
  'sent',
  'delivered',
  'failed',
  'responded',
  'cancelled',
])
export type OutreachMessageStatus = z.infer<typeof OutreachMessageStatus>

/** Who authored the current draft_body — never a blend, so "was this AI or recruiter-written" is always answerable. */
export const OutreachMessageGeneratedBy = z.enum(['ai', 'recruiter'])
export type OutreachMessageGeneratedBy = z.infer<typeof OutreachMessageGeneratedBy>

/** One evidence reference backing a personalized claim in an outreach draft (Build Phase 9 brief functional requirement #2: "Show which candidate evidence was used for personalization"). Shape is intentionally loose here — the next wave's AI drafting code defines and validates the concrete reference fields (e.g. requirementEvidenceId, sourceKind, excerpt) before persisting; this type only guarantees the array exists and its entries are objects, never that any particular field is present. */
export const OutreachPersonalizationEvidenceItemSchema = z.record(z.string(), z.unknown())
export type OutreachPersonalizationEvidenceItem = z.infer<
  typeof OutreachPersonalizationEvidenceItemSchema
>

/** One drafted/sent outreach message (supabase/migrations/0029). draft_body/subject are AI- or recruiter-authored outbound content — contrast with CandidateResponse.rawResponseText below, which is untrusted candidate-authored text. Two DB triggers make the approval requirement (functional requirement #3) and the opt-out hard-gate (functional requirement #10) unbypassable independent of this type. */
export const OutreachMessageSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  outreachSequenceId: z.string(),
  candidateId: z.string(),
  recruitmentProjectId: z.string(),
  candidateRoleMatchId: z.string(),
  templateId: z.string().nullable(),
  contactPointId: z.string().nullable(),
  channel: CommunicationChannel,
  status: OutreachMessageStatus,
  subject: z.string().nullable(),
  draftBody: z.string().min(1),
  personalizationEvidence: z.array(OutreachPersonalizationEvidenceItemSchema),
  generatedBy: OutreachMessageGeneratedBy,
  aiRunId: z.string().nullable(),
  editedByHuman: z.boolean(),
  senderUserId: z.string().nullable(),
  senderAccountIdentifier: z.string().nullable(),
  scheduledAt: z.string().nullable(),
  sentAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  failedAt: z.string().nullable(),
  failureReason: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelledBy: z.string().nullable(),
  cancelReason: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type OutreachMessage = z.infer<typeof OutreachMessageSchema>

export const OutreachApprovalDecision = z.enum(['approved', 'rejected', 'changes_requested'])
export type OutreachApprovalDecision = z.infer<typeof OutreachApprovalDecision>

/** Append-only recruiter review/approval record for one OutreachMessage (Build Phase 9 brief functional requirement #3). The DB trigger enforcing the outreach_messages status machine reads decision = 'approved' rows from here. */
export const OutreachApprovalSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  outreachMessageId: z.string(),
  approverId: z.string(),
  decision: OutreachApprovalDecision,
  reason: z.string().nullable(),
  editedBeforeApproval: z.boolean(),
  createdAt: z.string(),
})
export type OutreachApproval = z.infer<typeof OutreachApprovalSchema>

export const CommunicationEventDirection = z.enum(['outbound', 'inbound'])
export type CommunicationEventDirection = z.infer<typeof CommunicationEventDirection>

export const CommunicationEventType = z.enum([
  'queued',
  'sent',
  'delivered',
  'opened',
  'bounced',
  'failed',
  'inbound_reply',
  'manual_note',
])
export type CommunicationEventType = z.infer<typeof CommunicationEventType>

/** Append-only provider/delivery event log per OutreachMessage (supabase/migrations/0029). rawPayload is UNTRUSTED — provider webhook bodies and inbound message text are data, never instructions (docs/10-ai-evaluation-guardrails.md). */
export const CommunicationEventSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  outreachMessageId: z.string(),
  candidateId: z.string(),
  recruitmentProjectId: z.string(),
  channel: CommunicationChannel,
  direction: CommunicationEventDirection,
  eventType: CommunicationEventType,
  provider: z.string().nullable(),
  providerMessageId: z.string().nullable(),
  rawPayload: z.record(z.string(), z.unknown()),
  occurredAt: z.string(),
  recordedBy: z.string().nullable(),
  createdAt: z.string(),
})
export type CommunicationEvent = z.infer<typeof CommunicationEventSchema>

/** Build Phase 9 brief functional requirement #9's six classification values. Used for both the AI's reviewable suggestion and the human-confirmed authoritative value on CandidateResponse below. */
export const CandidateResponseClassification = z.enum([
  'interested',
  'not_interested',
  'needs_more_info',
  'follow_up_later',
  'opt_out',
  'ambiguous',
])
export type CandidateResponseClassification = z.infer<typeof CandidateResponseClassification>

/** Inbound candidate reply + classification (supabase/migrations/0029). rawResponseText is UNTRUSTED candidate-authored data — never treated as instructions by any AI call that reads it. aiSuggestedClassification is informational only; confirmedClassification (human-set, requires reviewedBy/reviewedAt together) is the sole authoritative value and the only one that can ever trigger the opt-out hard gate (brief: "AI classification must be reviewable and must not override opt-out rules"). */
export const CandidateResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  candidateId: z.string(),
  recruitmentProjectId: z.string(),
  outreachMessageId: z.string().nullable(),
  channel: CommunicationChannel,
  rawResponseText: z.string().min(1),
  receivedAt: z.string(),
  aiSuggestedClassification: CandidateResponseClassification.nullable(),
  aiConfidence: z.number().min(0).max(1).nullable(),
  aiRunId: z.string().nullable(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  confirmedClassification: CandidateResponseClassification.nullable(),
  reviewNote: z.string().nullable(),
  createdAt: z.string(),
})
export type CandidateResponse = z.infer<typeof CandidateResponseSchema>

// ---------------------------------------------------------------------------
// Build Phase 10 — POC Benchmark and Reporting (supabase/migrations/0030,
// docs/14-poc-specification.md). Deliberately named apart from the legacy
// Build Phase 1/2 demo mock schema `POCMetricSchema` above (which backs
// mock-data.ts's DEMO_COMPARISON fixture for an unrelated *candidate*
// comparison grid — see that schema's own comment) and from
// mock-data.ts's DEMO_COMPARISON itself; these are the real, DB-aligned
// schemas for the *process* (client-baseline vs. vendor-assisted)
// comparison this migration lays down. The analytics engine that populates
// PocMetric/PocResult rows from live data, and the report UI, are
// next-wave work — this file only types the schema.
// ---------------------------------------------------------------------------

export const PocBenchmarkStatus = z.enum(['setup', 'in_progress', 'completed', 'decided'])
export type PocBenchmarkStatus = z.infer<typeof PocBenchmarkStatus>

/** One POC comparison definition per client engagement (supabase/migrations/0030). Deliberately not tied to a single recruitment_project — the two live roles being benchmarked are PocRole rows, each pointing at its own job/project (see that migration's header note reconciling with the original docs/07-data-model.md §7.2 sketch). */
export const PocBenchmarkSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  clientId: z.string(),
  name: z.string().min(1),
  status: PocBenchmarkStatus,
  /** Shared start time both sides source from (docs/14-poc-specification.md §14.5) — a fair "same conditions" test requires this be identical for both processes. */
  startTime: z.string().nullable(),
  /** "Agreed search boundaries" (§14.5) — geography, source pools, whatever was explicitly agreed. Freeform jsonb by design; the next wave's UI defines the concrete shape it renders/collects. */
  searchBoundaries: z.record(z.string(), z.unknown()),
  notes: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type PocBenchmark = z.infer<typeof PocBenchmarkSchema>

/** "Two live roles: one standard, one senior_or_difficult" (docs/14-poc-specification.md §14.2). */
export const PocRoleType = z.enum(['standard', 'senior_or_difficult'])
export type PocRoleType = z.infer<typeof PocRoleType>

/** Exactly the two live roles a benchmark compares (supabase/migrations/0030). The role-mix invariant (exactly one of each PocRoleType) is enforced once the parent benchmark leaves status='setup' — a database trigger, not this type. */
export const PocRoleSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  pocBenchmarkId: z.string(),
  jobId: z.string(),
  recruitmentProjectId: z.string(),
  roleType: PocRoleType,
  label: z.string().nullable(),
  notes: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type PocRole = z.infer<typeof PocRoleSchema>

export const PocProcessType = z.enum(['client_baseline', 'vendor_assisted'])
export type PocProcessType = z.infer<typeof PocProcessType>

export const PocParticipantStatus = z.enum(['not_started', 'in_progress', 'completed'])
export type PocParticipantStatus = z.infer<typeof PocParticipantStatus>

/** The two processes compared per role: the client's own current process (client_baseline) vs. this platform's (vendor_assisted) — docs/14-poc-specification.md §14.3. shortlistId links the vendor_assisted side to a real Shortlist once one exists; the existing shortlist max-candidates=3 cap is reused, never duplicated (supabase/migrations/0030 header note). */
export const PocParticipantSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  pocBenchmarkId: z.string(),
  pocRoleId: z.string(),
  processType: PocProcessType,
  shortlistId: z.string().nullable(),
  status: PocParticipantStatus,
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  notes: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type PocParticipant = z.infer<typeof PocParticipantSchema>

/** Client's self-reported raw inputs for their own (client_baseline) process — candidate counts, timings, recruiter hours (supabase/migrations/0030). Append-only at the DB layer: "preserve original inputs" — a correction is a new row via correctionOfBaselineId, never an in-place edit, so this type has no updatedAt. */
export const PocBaselineSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  pocBenchmarkId: z.string(),
  pocRoleId: z.string(),
  pocParticipantId: z.string(),
  candidatesSourcedCount: z.number().int().min(0).nullable(),
  candidatesReviewedCount: z.number().int().min(0).nullable(),
  shortlistCandidateCount: z.number().int().min(0).nullable(),
  timeToFirstQualifiedHours: z.number().min(0).nullable(),
  timeToShortlistHours: z.number().min(0).nullable(),
  recruiterHoursSpent: z.number().min(0).nullable(),
  reportedByUserId: z.string().nullable(),
  reportedByLabel: z.string().nullable(),
  notes: z.string().nullable(),
  correctionOfBaselineId: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
})
export type PocBaseline = z.infer<typeof PocBaselineSchema>

/** GLOBAL (no organizationId), versioned, platform-owned catalog of POC comparison metrics (supabase/migrations/0030, Build Phase 10 brief §METRICS/§ANALYTICS RULES: "define calculation logic centrally... version metric definitions"). The actual calculation CODE lives in the next wave's TypeScript, keyed by (metricKey, version) — this type only carries the auditable definition/versioning record. Immutable once any PocResult references it (DB trigger), except `status`. */
export const MetricDefinitionCategory = z.enum([
  'speed',
  'quality',
  'evidence',
  'human_acceptance',
  'candidate_response',
  'progression',
  'effort',
  'errors',
])
export type MetricDefinitionCategory = z.infer<typeof MetricDefinitionCategory>

export const MetricUnit = z.enum(['percent', 'hours', 'count', 'ratio', 'boolean'])
export type MetricUnit = z.infer<typeof MetricUnit>

export const MetricDefinitionSchema = z.object({
  id: z.string(),
  metricKey: z.string().min(1),
  version: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().min(1),
  calculationNotes: z.string().min(1),
  category: MetricDefinitionCategory,
  unit: MetricUnit,
  appliesToSide: z.enum(['vendor', 'client', 'both']),
  status: z.enum(['active', 'deprecated']),
  publishedBy: z.string().nullable(),
  publishedAt: z.string(),
  createdAt: z.string(),
})
export type MetricDefinition = z.infer<typeof MetricDefinitionSchema>

export const PocMetricSource = z.enum([
  'platform_computed',
  'client_reported',
  'manual_recruiter_entry',
  'ai_derived',
])
export type PocMetricSource = z.infer<typeof PocMetricSource>

/** Raw/intermediate data points (either side) that a PocResult is computed from (supabase/migrations/0030, brief §ANALYTICS RULES: "preserve original inputs"). Append-only at the DB layer — a correction is a new row via supersedesMetricId, never an UPDATE, so this type has no updatedAt. Deliberately named `PocMetricDataPointSchema`, not `PocMetricSchema`, to stay unambiguous next to the legacy `POCMetricSchema` above (unrelated candidate-comparison demo data backing mock-data.ts's DEMO_COMPARISON). */
export const PocMetricDataPointSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  pocBenchmarkId: z.string(),
  pocRoleId: z.string(),
  pocParticipantId: z.string(),
  metricDefinitionId: z.string(),
  metricDefinitionVersion: z.number().int().positive(),
  dataPointKey: z.string().min(1),
  valueNumeric: z.number().nullable(),
  valueText: z.string().nullable(),
  valueJsonb: z.record(z.string(), z.unknown()).nullable(),
  unit: MetricUnit.nullable(),
  source: PocMetricSource,
  supersedesMetricId: z.string().nullable(),
  notes: z.string().nullable(),
  recordedBy: z.string().nullable(),
  recordedAt: z.string(),
  createdAt: z.string(),
})
export type PocMetricDataPoint = z.infer<typeof PocMetricDataPointSchema>

export const PocExclusionSide = z.enum(['vendor', 'client', 'both'])
export type PocExclusionSide = z.infer<typeof PocExclusionSide>

export const PocExclusionType = z.enum([
  'duplicate_across_sides',
  'out_of_search_boundary',
  'other',
])
export type PocExclusionType = z.infer<typeof PocExclusionType>

/** Duplicate-candidate / out-of-search-boundary exclusions, each with a mandatory reason (docs/14-poc-specification.md §14.6, brief §ANALYTICS RULES: "explain excluded records" — never silently dropped). Append-only at the DB layer — a reversal is a new row via reversesExclusionId. candidateId is nullable since a client-side candidate may never exist in this platform's `candidates` table at all; candidateReferenceLabel is the free-text fallback (the DB CHECK requires at least one of the two). */
export const PocExclusionSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  pocBenchmarkId: z.string(),
  pocRoleId: z.string(),
  candidateId: z.string().nullable(),
  candidateReferenceLabel: z.string().nullable(),
  side: PocExclusionSide,
  exclusionType: PocExclusionType,
  reason: z.string().min(1),
  /** docs/14-poc-specification.md §14.6: a duplicate still counts toward each side's SPEED metric even while excluded from the quality-differentiation comparison. */
  stillCountsTowardSpeed: z.boolean(),
  reversesExclusionId: z.string().nullable(),
  excludedBy: z.string(),
  excludedAt: z.string(),
  createdAt: z.string(),
})
export type PocExclusion = z.infer<typeof PocExclusionSchema>

export const PocResultSide = z.enum(['vendor', 'client'])
export type PocResultSide = z.infer<typeof PocResultSide>

/** Brief §METRICS: "Do not invent missing results. Use Pending / Not Available / Not Measured instead of fabricated values." Mirrored by a DB CHECK constraint (poc_results_value_matches_status) that makes it structurally impossible for a non-'computed' status to carry a value, and requires 'computed' to carry one. */
export const PocResultStatus = z.enum(['computed', 'pending', 'not_available', 'not_measured'])
export type PocResultStatus = z.infer<typeof PocResultStatus>

/** Computed comparison output per (role, metric, side) (supabase/migrations/0030). See PocResultStatus's comment for the "never fabricate a missing value" guarantee this type + its backing DB CHECK enforce together. Note: a value shown alongside another here must never be presented as correlation implying causation in the report UI — a presentation-layer concern this schema cannot itself enforce. */
export const PocResultSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  pocBenchmarkId: z.string(),
  pocRoleId: z.string(),
  metricDefinitionId: z.string(),
  metricDefinitionVersion: z.number().int().positive(),
  side: PocResultSide,
  status: PocResultStatus,
  value: z.number().nullable(),
  valueUnit: MetricUnit.nullable(),
  /** References into PocMetric/PocBaseline rows this value was computed from — never the calculation formula itself, which lives in the next wave's TypeScript. */
  calculationInputRef: z.array(z.record(z.string(), z.unknown())),
  computedAt: z.string().nullable(),
  computedBy: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type PocResult = z.infer<typeof PocResultSchema>

export const PocDecisionValue = z.enum(['proceed_to_paid_pilot', 'extend_poc', 'do_not_proceed'])
export type PocDecisionValue = z.infer<typeof PocDecisionValue>

/** One CURRENT decision per benchmark, append-only history (supabase/migrations/0030) — mirrors ClientDecision/OutreachApproval's append-only shape. The row's existence IS the recorded authorized approval: notes, approvedBy and approvedAt are all required (brief: "Require decision notes and authorized approval"). See packages/types/src/permissions.ts's poc_reports matrix comment for which role(s) may create one. */
export const PocDecisionSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  pocBenchmarkId: z.string(),
  decision: PocDecisionValue,
  notes: z.string().min(1),
  approvedBy: z.string(),
  approvedAt: z.string(),
  isCurrent: z.boolean(),
  supersedesDecisionId: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
})
export type PocDecision = z.infer<typeof PocDecisionSchema>

// ---------------------------------------------------------------------------
// AI semantic-assist output (matching pipeline step 6: "Use AI only to
// assess semantic relevance and explain evidence"). One call per matching
// run, covering every requirement (mandatory + preferred) in the frozen
// scorecard snapshot — mirrors RequirementExtractionOutputSchema's
// single-call-per-document shape. AI proposes; it never sets the stored
// gate result or the final weighted score (docs/08-candidate-scoring.md
// §8.1/§8.3) — those are computed deterministically by
// apps/web/lib/matching/{gates,scoring}.ts from this output plus the
// retrieved evidence.
// ---------------------------------------------------------------------------

export const MatchAssessmentEvidenceRefSchema = z.object({
  sourceKind: RequirementEvidenceSourceKind,
  /** Id of the specific candidate_experiences/_education/_certifications/_skills/candidate_extracted_fields row this excerpt came from, when the evidence-retrieval step supplied one; null for a 'profile'-sourced excerpt. */
  sourceId: z.string().nullable(),
  excerpt: z.string().min(1),
  location: z.string().nullable(),
  isDirectStatement: z.boolean(),
})
export type MatchAssessmentEvidenceRef = z.infer<typeof MatchAssessmentEvidenceRefSchema>

export const MatchRequirementAssessmentSchema = z.object({
  requirementId: z.string().min(1),
  requirementType: z.enum(['mandatory', 'preferred']),
  /** Layer C: semantic-similarity strength, 0-1. Null when the model found no relevant evidence at all — never guessed (docs/08-candidate-scoring.md §8.7). */
  relevanceScore: z.number().min(0).max(1).nullable(),
  /** Layer D input: the model's own confidence in relevanceScore, combining similarity strength + directness + source reliability (§8.6). Independent of relevanceScore itself so a low-confidence-but-plausible match can be distinguished from a confident one. */
  confidence: z.number().min(0).max(1).nullable(),
  /** Only meaningful when requirementType = 'mandatory' — the AI's DRAFT suggestion, never the stored authoritative result (§8.1: "AI only proposes... a deterministic re-check confirms"). Null for a preferred requirement. */
  gateSuggestion: GateResult.nullable(),
  explanation: z.string().max(2000),
  evidenceRefs: z.array(MatchAssessmentEvidenceRefSchema).max(10),
  /** e.g. "12-month notice-period conflict with the role's start date" — workflow #11 risk detection. Omitted (empty array) rather than fabricated when nothing is actually supported by evidence. */
  riskNotes: z.array(z.string()).max(5),
})
export type MatchRequirementAssessment = z.infer<typeof MatchRequirementAssessmentSchema>

export const CandidateMatchAIOutputSchema = z.object({
  assessments: z.array(MatchRequirementAssessmentSchema).max(60),
  /** Anything the model noticed but could not tie to a specific requirement — mirrors RequirementExtractionOutputSchema/CandidateExtractionOutputSchema's unresolvedNotes convention. */
  unresolvedNotes: z.array(z.string()).max(20),
})
export type CandidateMatchAIOutput = z.infer<typeof CandidateMatchAIOutputSchema>

// ---------------------------------------------------------------------------
// Deterministic pipeline input/output shapes — pure data, no Zod needed on
// the output side (these are computed, not parsed), but the input shape is
// still worth naming so gates.ts/scoring.ts have a stable, documented
// contract independent of the DB row shape above.
// ---------------------------------------------------------------------------

/** One frozen requirement from a scorecard_versions.requirement_snapshot, as the deterministic gate/scoring engine consumes it. */
export interface FrozenRequirement {
  requirementId: string
  name: string
  type: 'mandatory' | 'preferred'
  /** 0-100, preferred requirements only (mirrors job_requirements.weight). */
  weight: number | null
}

export interface MandatoryGateComputation {
  requirementId: string
  requirementName: string
  deterministicResult: GateResult
  hasAnyEvidence: boolean
}

export interface ScoringCriterionComputation {
  requirementId: string
  requirementName: string
  weight: number
  rawScore: number | null
  confidenceDiscount: number
  effectiveScore: number | null
  weightedContribution: number
  hasEvidence: boolean
}

export interface WeightedScoreResult {
  /** Null when the candidate is not eligible (a failed/unresolved mandatory gate) — never computed in that case (docs/08-candidate-scoring.md §8.3). */
  overallScore: number | null
  evidenceCoveragePct: number
  dataCompletenessPct: number
  confidence: number | null
  criteria: ScoringCriterionComputation[]
}

// ---------------------------------------------------------------------------
// Recruiter AI Copilot (Build Phase 11, Wave 1) — supabase/migrations/0031.
// Governing brief: a permission-aware, evidence-grounded copilot that may
// summarize/explain/draft/suggest but must never make the final hiring
// decision, alter candidate records without confirmation, override
// mandatory gates, approve outreach, submit a shortlist, reveal
// cross-tenant data, reveal hidden recruiter notes to clients, or invent
// evidence. See 0031's header comment for the full schema reasoning this
// wave's types mirror 1:1.
// ---------------------------------------------------------------------------

/** A conversation's scoping data-classification — the brief's "data classification" requirement made concrete. 'restricted_notes_excluded' is mandatory (never 'standard') for a client_decision_maker conversation (0031 CHECK constraint) — see this migration's "HIDDEN RECRUITER NOTES" header note for what it excludes (candidate_profiles.recruiter_notes, never client-visible). */
export const CopilotDataClassification = z.enum(['standard', 'restricted_notes_excluded'])
export type CopilotDataClassification = z.infer<typeof CopilotDataClassification>

export const CopilotConversationStatus = z.enum(['active', 'archived', 'ended'])
export type CopilotConversationStatus = z.infer<typeof CopilotConversationStatus>

/** One row per copilot chat thread (supabase/migrations/0031). roleAtCreation/clientId/recruitmentProjectId/dataClassification are an IMMUTABLE snapshot of the conversation's authorized scope taken at creation — never widened by a later role change (DB trigger-enforced). clientId/recruitmentProjectId are null only for the org-wide roles (platform_admin/agency_admin/read_only_reviewer); a recruiter or client_decision_maker conversation is always pinned to one project. IMPORTANT for callers: this snapshot is NOT a substitute for a live permission re-check on every message — a role can be narrowed or revoked after a conversation starts, which this snapshot alone cannot catch (0031's header note). */
export const CopilotConversationSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  roleAtCreation: UserRole,
  clientId: z.string().nullable(),
  recruitmentProjectId: z.string().nullable(),
  dataClassification: CopilotDataClassification,
  status: CopilotConversationStatus,
  title: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type CopilotConversation = z.infer<typeof CopilotConversationSchema>

export const CopilotMessageRole = z.enum(['user', 'assistant', 'system_note'])
export type CopilotMessageRole = z.infer<typeof CopilotMessageRole>

/** A citation into one already-authorized platform record (the brief's "citations to authorized records" mechanism) — never a citation into an untrusted document or an invented source. `kind` is deliberately a broad, extensible string union rather than a closed table-name enum, since wave 2/3 will add retrieval sources incrementally; validate the specific `kind` values a given tool call may legally cite at the application layer, not here. */
export const CopilotCitationSchema = z.object({
  kind: z.enum([
    'job_requirement',
    'scorecard_version',
    'candidate_extracted_field',
    'candidate_role_match',
    'requirement_evidence',
    'human_review',
    'shortlist_candidate',
    'outreach_message',
    'candidate_response',
    'poc_result',
    'poc_decision',
  ]),
  id: z.string(),
  /** A short, verbatim excerpt or label from the cited record — never paraphrased or fabricated (mirrors the outreach-drafting evidence-citation discipline in docs/09-ai-architecture.md §9.7's validateOutreachDraftEvidence()). */
  excerpt: z.string().nullable(),
})
export type CopilotCitation = z.infer<typeof CopilotCitationSchema>

/** One turn per row, append-only (supabase/migrations/0031). A `user` turn always carries `content`; an `assistant` turn may be a pure tool-call turn with no prose yet (content null). `citations` grounds this message's claims in already-authorized records — see CopilotCitationSchema. See 0031's TRUST NOTE: `content` on a `user` row is the org's own authenticated user, not the brief's primary prompt-injection concern (retrieved documents are), but the orchestration layer must still frame it as untrusted data in the model call, same as every other workflow in docs/09-ai-architecture.md §9.1. */
export const CopilotMessageSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  copilotConversationId: z.string(),
  role: CopilotMessageRole,
  content: z.string().nullable(),
  citations: z.array(CopilotCitationSchema),
  aiRunId: z.string().nullable(),
  sequenceNumber: z.number().int().nonnegative(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
})
export type CopilotMessage = z.infer<typeof CopilotMessageSchema>

/** The tool allowlist — one entry per copilot capability the brief lists (13 total), DB-CHECK-enforced independently of the application-layer allowlist wave 2 also builds (0031's header note). This is a closed union on purpose: a future wave adding a capability extends both this union and the DB migration together, never just one. */
export const CopilotToolName = z.enum([
  'summarize_recruitment_project',
  'explain_scorecard',
  'find_missing_job_requirements',
  'summarize_candidate',
  'explain_candidate_match',
  'compare_approved_candidates',
  'identify_missing_evidence',
  'draft_verification_questions',
  'draft_interview_questions',
  'draft_outreach_message',
  'summarize_candidate_responses',
  'explain_poc_metrics',
  'suggest_next_workflow_action',
])
export type CopilotToolName = z.infer<typeof CopilotToolName>

/** 'pending' exists for schema completeness / a future async execution model only — see 0031's table comment. In normal synchronous use a persisted row is always 'valid'/'invalid'/'error'. */
export const CopilotToolOutputValidationStatus = z.enum(['pending', 'valid', 'invalid', 'error'])
export type CopilotToolOutputValidationStatus = z.infer<typeof CopilotToolOutputValidationStatus>

/** One tool invocation inside an assistant turn (supabase/migrations/0031). `resourceOwnershipValidated` must be explicitly true before code may trust `output` — the DB itself refuses to persist `outputValidationStatus: 'valid'` with `resourceOwnershipValidated: false` (copilot_tool_calls_valid_requires_ownership CHECK), so this is a structural guarantee, not just a convention callers must remember. `requiresConfirmation`/`confirmedAt`/`confirmedBy` are the propose -> confirm mutation scaffolding for wave 2's future mutation tools — no mutation tool exists yet as of this wave. A denied call (`denied: true`) always carries `denialReason` and never carries `output`. */
export const CopilotToolCallSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  copilotConversationId: z.string(),
  copilotMessageId: z.string(),
  toolName: CopilotToolName,
  input: z.record(z.string(), z.unknown()),
  output: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).nullable(),
  outputValidationStatus: CopilotToolOutputValidationStatus,
  resourceOwnershipValidated: z.boolean(),
  denied: z.boolean(),
  denialReason: z.string().nullable(),
  requiresConfirmation: z.boolean(),
  confirmedAt: z.string().nullable(),
  confirmedBy: z.string().nullable(),
  aiRunId: z.string().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  createdAt: z.string(),
})
export type CopilotToolCall = z.infer<typeof CopilotToolCallSchema>

/** Persisted, auditable per-(organization, user, day) rate-limit and cost-tracking state (supabase/migrations/0031) — chosen over an in-memory limiter because this is a serverless (Vercel) stack. Counts are monotonic: a client can never reset its own usage by re-upserting a lower value (DB trigger-enforced). */
export const CopilotUsageCounterSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  windowDate: z.string(),
  messageCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
  rateLimitedCount: z.number().int().nonnegative(),
  updatedAt: z.string(),
})
export type CopilotUsageCounter = z.infer<typeof CopilotUsageCounterSchema>

// ---------------------------------------------------------------------------
// Build Phase 12, Wave 1 — Integrations, durable jobs, notifications
// (supabase/migrations/0032). Schema + types foundation only — the job
// engine, integration adapter clients, webhook route handlers and
// notification dispatch are later waves' work; see 0032's header comment
// for the full reasoning these types mirror 1:1, especially "TA TRACKER
// MODE HONESTY" and "PERMISSION-SAFE DEEP LINKS".
// ---------------------------------------------------------------------------

export const BackgroundJobType = z.enum([
  'document_processing',
  'ai_extraction',
  'candidate_evaluation',
  'notification_dispatch',
  'email_delivery',
  'integration_sync',
  'report_generation',
])
export type BackgroundJobType = z.infer<typeof BackgroundJobType>

/** 'dead_lettered' means max_attempts was exhausted and the job will never auto-retry again (manual retry only); 'failed' means this attempt errored and another automatic retry may still be scheduled. There is no separate "retrying" status — a job awaiting its next backoff attempt is still 'queued' (with `nextAttemptAt` in the future). */
export const BackgroundJobStatus = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'dead_lettered',
  'cancelled',
])
export type BackgroundJobStatus = z.infer<typeof BackgroundJobStatus>

/** One durable background job (supabase/migrations/0032). `idempotencyKey` is unique per (organizationId, jobType) at the DB layer — a duplicate enqueue is rejected, never silently double-processed. `correlationId` cross-references `audit_events` rows sharing the same id rather than duplicating an audit mechanism. `payload`/`lastError` are protected, RLS-scoped database storage; the brief's "no sensitive payloads in ordinary logs" requirement is an application-code discipline (never write these columns' contents to a plaintext console/observability log), which this type alone cannot enforce. */
export const BackgroundJobSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  jobType: BackgroundJobType,
  status: BackgroundJobStatus,
  payload: z.record(z.string(), z.unknown()),
  correlationId: z.string(),
  idempotencyKey: z.string().nullable(),
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().min(1),
  nextAttemptAt: z.string().nullable(),
  failureReason: z.string().nullable(),
  lastError: z.record(z.string(), z.unknown()).nullable(),
  deadLetteredAt: z.string().nullable(),
  manuallyRetriedBy: z.string().nullable(),
  manuallyRetriedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type BackgroundJob = z.infer<typeof BackgroundJobSchema>

export const IntegrationProvider = z.enum([
  'ta_tracker',
  'apollo',
  'google_calendar',
  'microsoft_calendar',
  'sms',
])
export type IntegrationProvider = z.infer<typeof IntegrationProvider>

/** Only meaningful when provider is 'ta_tracker' — every other provider has exactly one real integration shape and leaves this null (0032 CHECK). 'api' is the mode the project instructions forbid ever faking: docs/11-integration-plan.md §11.2 confirms no TA Tracker API, documentation or credentials exist. 'csv_import_export' and 'secure_manual_exchange' need no vendor-specific knowledge and CAN be legitimately built and connected. */
export const IntegrationConnectionMode = z.enum([
  'api',
  'csv_import_export',
  'secure_manual_exchange',
])
export type IntegrationConnectionMode = z.infer<typeof IntegrationConnectionMode>

/** 'pending_documentation' is specifically for TA Tracker's API mode — the only status besides 'not_connected' that mode may ever report (0032's integration_connections_ta_tracker_api_mode_honesty CHECK forbids 'connected'/'sync_error'/'disconnected' for provider='ta_tracker' + mode='api', structurally, independent of application code). */
export const IntegrationConnectionStatus = z.enum([
  'not_connected',
  'pending_documentation',
  'connected',
  'sync_error',
  'disconnected',
])
export type IntegrationConnectionStatus = z.infer<typeof IntegrationConnectionStatus>

export const IntegrationSyncStatus = z.enum(['success', 'partial', 'failed'])
export type IntegrationSyncStatus = z.infer<typeof IntegrationSyncStatus>

/** One (organization, provider) integration connection (supabase/migrations/0032). See this file's header note above ("TA TRACKER MODE HONESTY") — a provider='ta_tracker'/mode='api' row can never report status 'connected'/'sync_error'/'disconnected' in this environment; that is a database-level impossibility, not an application convention. `accountOwnerLabel` is honestly nullable: docs/18-blocking-questions.md Q-P1-01 (client-owned vs agency-owned accounts) is an unresolved business question, never defaulted to a guess. */
export const IntegrationConnectionSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  provider: IntegrationProvider,
  mode: IntegrationConnectionMode.nullable(),
  status: IntegrationConnectionStatus,
  accountOwnerLabel: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  lastSyncStatus: IntegrationSyncStatus.nullable(),
  lastSyncError: z.string().nullable(),
  connectedBy: z.string().nullable(),
  connectedAt: z.string().nullable(),
  disconnectedAt: z.string().nullable(),
  disconnectedBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type IntegrationConnection = z.infer<typeof IntegrationConnectionSchema>

export const WebhookProcessingStatus = z.enum([
  'received',
  'processed',
  'rejected_invalid_signature',
  'duplicate_ignored',
  'error',
])
export type WebhookProcessingStatus = z.infer<typeof WebhookProcessingStatus>

/** Inbound webhook dedup + signature-validation record (supabase/migrations/0032). `rawPayload` is UNTRUSTED provider/candidate-originated data — mirrors CommunicationEventSchema's rawPayload convention exactly; never treated as instructions, only ever parsed as inert data. The DB's UNIQUE (provider, externalEventId) index (nulls excluded) is the literal mechanism behind duplicate-webhook detection — this type only carries the shape, not the guarantee. This table has no client-writable RLS grant at all: a later wave's webhook route handler writes it via the Supabase service role (see 0032's table comment), never the caller's own session, since an inbound webhook has no authenticated platform user to scope an RLS check against. */
export const WebhookEventSchema = z.object({
  id: z.string(),
  organizationId: z.string().nullable(),
  provider: z.string(),
  externalEventId: z.string().nullable(),
  signatureValid: z.boolean(),
  rawPayload: z.record(z.string(), z.unknown()),
  processingStatus: WebhookProcessingStatus,
  processedAt: z.string().nullable(),
  relatedJobId: z.string().nullable(),
  createdAt: z.string(),
})
export type WebhookEvent = z.infer<typeof WebhookEventSchema>

/** The brief's exact 8 notification events (supabase/migrations/0032 CHECK-allowlisted). */
export const NotificationEventType = z.enum([
  'scorecard_awaiting_approval',
  'candidate_awaiting_review',
  'verification_requested',
  'outreach_awaiting_approval',
  'candidate_responded',
  'shortlist_awaiting_client_decision',
  'integration_failed',
  'poc_completed',
])
export type NotificationEventType = z.infer<typeof NotificationEventType>

/** One in-app/email notification (supabase/migrations/0032), strictly own-recipient-visible. Named `NotificationRecord` (not `Notification`) to avoid colliding with the pre-existing LEGACY Build Phase 1 demo `NotificationSchema`/`Notification` above (backs `apps/web/lib/mock-data.ts`'s `DEMO_NOTIFICATIONS` — not DB-aligned, not this table). `resourceType`/`resourceId` are the PERMISSION-SAFE DEEP LINK mechanism — deliberately not a raw URL: a later wave's route handler must re-validate the CURRENT recipient's access to this (resourceType, resourceId) pair at click time, exactly as lib/copilot/resource-ownership.ts already does for copilot tool calls. `readAt` null means unread; it is the only field a recipient may ever change after creation (DB trigger-enforced). */
export const NotificationRecordSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  recipientUserId: z.string(),
  eventType: NotificationEventType,
  title: z.string(),
  body: z.string().nullable(),
  resourceType: z.string().nullable(),
  resourceId: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
})
export type NotificationRecord = z.infer<typeof NotificationRecordSchema>

/** Per-(user, eventType) notification channel preference (supabase/migrations/0032). `emailEnabled` defaults false — opt-in, not opt-out — since sending unwanted email is a worse failure mode than a missed one; a missing row is read by application code as {inAppEnabled: true, emailEnabled: false}, the same default this schema's row starts from. Strictly own-user CRUD. */
export const NotificationPreferenceSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  eventType: NotificationEventType,
  inAppEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type NotificationPreference = z.infer<typeof NotificationPreferenceSchema>
