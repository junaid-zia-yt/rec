import type {
  RecruitmentProject,
  Candidate,
  CandidateMatch,
  MandatoryGateResult,
  EvidenceItem,
  Shortlist,
  POCMetric,
  Notification,
  AuditEvent,
  User,
  Client,
  Job,
  JobDescription,
  ProjectActivity,
  JobRequirement,
  Scorecard,
  CandidateRecord,
  CandidateProfile,
  CandidateContactPoint,
  CandidateDocument,
  CandidateExperience,
  CandidateEducation,
  CandidateCertification,
  CandidateSkill,
  CandidateSource,
  CandidateProjectEntry,
  CandidatePipelineEvent,
  CandidateConsent,
} from '@rqi/types'

/**
 * DEMO DATA — Build Phase 1 mock-data boundary (docs/22-build-phase-1-plan.md
 * task BP1-06/BP1-08, Build Phase 1 brief §7–8).
 *
 * This is the ONLY place fixture data is defined for the web app. Pages must
 * import from here, never inline their own copies. Every value is either
 * invented placeholder content or, for the two sample roles, taken directly
 * from the approved POC roles in docs/14-poc-specification.md — nothing here
 * represents a real candidate, a real client, or real evidence, and none of
 * it is written by an AI workflow (no AI workflow exists yet in this phase).
 *
 * When Phase 2+ wires up a real data layer, this file is deleted; every
 * import site is a search for `mock-data` away from being pointed at the
 * real thing.
 */

export const DEMO_USER: User = {
  id: 'user-demo-1',
  fullName: 'Dana Reyes',
  email: 'dana@example-agency.com',
  role: 'agency_admin',
  avatarInitials: 'DR',
}

/**
 * Team/invitation shell content (Build Phase 2 brief §9's "team-member and
 * invitation UI shell"). Mirrors the shape of an `organization_memberships`
 * + `user_profiles` join, but is mock data only — no live Supabase project
 * is connected, so /settings/team always renders this, never a real query.
 */
export interface DemoTeamMember {
  membershipId: string
  fullName: string
  email: string
  role: User['role']
  status: 'active' | 'revoked'
}

export const DEMO_TEAM_MEMBERS: DemoTeamMember[] = [
  {
    membershipId: 'mem-1',
    fullName: 'Dana Reyes',
    email: 'dana@example-agency.com',
    role: 'agency_admin',
    status: 'active',
  },
  {
    membershipId: 'mem-2',
    fullName: 'Priya Nandakumar',
    email: 'priya@example-agency.com',
    role: 'recruiter',
    status: 'active',
  },
  {
    membershipId: 'mem-3',
    fullName: 'Marcus Webb',
    email: 'marcus@northfield-retail.example',
    role: 'client_decision_maker',
    status: 'active',
  },
]

export interface DemoInvitation {
  id: string
  email: string
  role: User['role']
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
}

export const DEMO_INVITATIONS: DemoInvitation[] = [
  {
    id: 'inv-1',
    email: 'alicia@example-agency.com',
    role: 'read_only_reviewer',
    status: 'pending',
  },
]

export const DEMO_CLIENTS: Client[] = [
  {
    id: 'client-1',
    organizationId: 'org-1',
    name: 'Northfield Retail Group',
    vertical: 'Retail',
    primaryContactName: 'Marcus Webb',
    primaryContactEmail: 'marcus@northfield-retail.example',
    primaryContactPhone: null,
    status: 'active',
    createdAt: '2026-09-01T09:00:00.000Z',
  },
  {
    id: 'client-2',
    organizationId: 'org-1',
    name: 'Harborline Food Service Group',
    vertical: 'Food Service',
    primaryContactName: 'Elena Vasquez',
    primaryContactEmail: 'elena@harborline.example',
    primaryContactPhone: null,
    status: 'active',
    createdAt: '2026-09-03T09:00:00.000Z',
  },
]

export const DEMO_PROJECTS: RecruitmentProject[] = [
  {
    id: 'proj-1',
    organizationId: 'org-1',
    clientId: 'client-1',
    clientName: 'Northfield Retail Group',
    roleTitle: 'Regional Operations Manager',
    vertical: 'Retail',
    status: 'shortlisting',
    isPoc: true,
    targetShortlistSize: 3,
    matchThreshold: 70,
    archivedAt: null,
    clientCanApproveScorecards: false,
    createdAt: '2026-09-10T09:00:00.000Z',
  },
  {
    id: 'proj-2',
    organizationId: 'org-1',
    clientId: 'client-2',
    clientName: 'Harborline Food Service Group',
    roleTitle: 'Director of Food Service',
    vertical: 'Food Service',
    status: 'sourcing',
    isPoc: true,
    targetShortlistSize: 3,
    matchThreshold: 70,
    archivedAt: null,
    clientCanApproveScorecards: false,
    createdAt: '2026-09-12T09:00:00.000Z',
  },
]

export const DEMO_JOBS: Job[] = [
  {
    id: 'job-1',
    recruitmentProjectId: 'proj-1',
    organizationId: 'org-1',
    title: 'Regional Operations Manager',
    department: 'Store Operations',
    industry: 'Retail',
    employmentType: 'full_time',
    workplaceArrangement: 'on_site',
    location: 'Columbus, OH',
    commutingRadiusMiles: 40,
    salaryMin: 95000,
    salaryMax: 115000,
    currency: 'USD',
    workAuthorizationRequired: 'US work authorization required',
    sponsorshipAvailable: false,
    targetStartDate: '2026-11-01',
    hiringManagerNotes: 'Needs multi-unit P&L experience in convenience retail.',
    maxShortlistSize: 3,
    minMatchThreshold: 70,
    status: 'open',
    createdAt: '2026-09-10T09:05:00.000Z',
  },
]

export const DEMO_JOB_DESCRIPTIONS: JobDescription[] = [
  {
    id: 'jd-1',
    jobId: 'job-1',
    organizationId: 'org-1',
    source: 'pasted',
    rawText:
      'Regional Operations Manager — oversee P&L and day-to-day operations for 40+ retail locations...',
    fileStoragePath: null,
    fileName: null,
    fileMimeType: null,
    fileSizeBytes: null,
    fileChecksumSha256: null,
    versionNo: 1,
    status: 'parsed',
    createdAt: '2026-09-10T09:10:00.000Z',
  },
]

export const DEMO_JOB_REQUIREMENTS: JobRequirement[] = [
  {
    id: 'req-1',
    jobId: 'job-1',
    jobDescriptionId: 'jd-1',
    organizationId: 'org-1',
    name: 'Multi-unit retail P&L experience',
    description: 'At least 3 years managing P&L across 25+ retail locations.',
    category: 'experience',
    type: 'mandatory',
    weight: null,
    evidenceExpected: 'CV entry showing multi-unit P&L ownership for 25+ sites.',
    sourceText: 'Must have managed P&L across a minimum of 25 retail locations.',
    sourceLocation: 'paragraph 2',
    confidence: 0.92,
    verificationStatus: 'unverified',
    reviewerNotes: null,
    status: 'reviewed',
    aiGenerated: true,
    createdAt: '2026-09-10T09:15:00.000Z',
  },
  {
    id: 'req-2',
    jobId: 'job-1',
    jobDescriptionId: 'jd-1',
    organizationId: 'org-1',
    name: 'Valid food-safety certification',
    description: 'A current, unexpired food-safety handler certification.',
    category: 'compliance',
    type: 'mandatory',
    weight: null,
    evidenceExpected: 'Certification document or CV mention with issue date.',
    sourceText: 'Valid food-safety certification is required.',
    sourceLocation: 'paragraph 3',
    confidence: 0.95,
    verificationStatus: 'unverified',
    reviewerNotes: null,
    status: 'proposed',
    aiGenerated: true,
    createdAt: '2026-09-10T09:15:00.000Z',
  },
  {
    id: 'req-3',
    jobId: 'job-1',
    jobDescriptionId: 'jd-1',
    organizationId: 'org-1',
    name: 'Bilingual English/Spanish',
    description: 'Preferred but not required for candidate consideration.',
    category: 'communication',
    type: 'preferred',
    weight: 60,
    evidenceExpected: 'CV or interview note indicating Spanish fluency.',
    sourceText: 'Bilingual (English/Spanish) is a plus.',
    sourceLocation: 'paragraph 4',
    confidence: 0.8,
    verificationStatus: 'unverified',
    reviewerNotes: null,
    status: 'reviewed',
    aiGenerated: true,
    createdAt: '2026-09-10T09:15:00.000Z',
  },
  {
    id: 'req-4',
    jobId: 'job-1',
    jobDescriptionId: 'jd-1',
    organizationId: 'org-1',
    name: 'Tenure in current role',
    description: 'At least 2 years in current position preferred.',
    category: 'stability',
    type: 'preferred',
    weight: 40,
    evidenceExpected: 'CV dates showing 2+ years in current role.',
    sourceText: 'Candidates with 2+ years tenure in their current role are preferred.',
    sourceLocation: 'paragraph 5',
    confidence: 0.75,
    verificationStatus: 'unverified',
    reviewerNotes: null,
    status: 'reviewed',
    aiGenerated: true,
    createdAt: '2026-09-10T09:15:00.000Z',
  },
]

export const DEMO_SCORECARDS: Scorecard[] = [
  {
    id: 'scorecard-1',
    jobId: 'job-1',
    organizationId: 'org-1',
    name: 'Regional Operations Manager scorecard',
    status: 'draft',
    currentVersionId: null,
    createdAt: '2026-09-10T09:20:00.000Z',
  },
]

export const DEMO_PROJECT_ACTIVITY: ProjectActivity[] = [
  {
    id: 'act-1',
    recruitmentProjectId: 'proj-1',
    actorName: 'Dana Reyes',
    action: 'project.created',
    summary: 'Created project "Regional Operations Manager".',
    createdAt: '2026-09-10T09:00:00.000Z',
  },
  {
    id: 'act-2',
    recruitmentProjectId: 'proj-1',
    actorName: 'Dana Reyes',
    action: 'job_description.uploaded',
    summary: 'Pasted job description (version 1).',
    createdAt: '2026-09-10T09:10:00.000Z',
  },
]

export const DEMO_CANDIDATES: Candidate[] = [
  {
    id: 'cand-1',
    fullName: 'Sarah Mitchell',
    avatarInitials: 'SM',
    currentTitle: 'Regional Director, Retail Ops',
    yearsExperience: 11,
    source: 'linkedin',
  },
  {
    id: 'cand-2',
    fullName: 'James Carter',
    avatarInitials: 'JC',
    currentTitle: 'Multi-Unit Operations Manager',
    yearsExperience: 9,
    source: 'referral',
  },
  {
    id: 'cand-3',
    fullName: 'Maria Rodriguez',
    avatarInitials: 'MR',
    currentTitle: 'Area Supervisor',
    yearsExperience: 10,
    source: 'apollo',
  },
]

export const DEMO_CANDIDATE_MATCHES: CandidateMatch[] = [
  {
    id: 'match-1',
    candidateId: 'cand-1',
    jobId: 'job-1',
    scorecardVersionId: 'sv-1',
    overallScore: 96,
    evidencePercent: 100,
    completenessPercent: 100,
    gatesPassed: 5,
    gatesTotal: 5,
    stage: 'shortlisted',
  },
  {
    id: 'match-2',
    candidateId: 'cand-2',
    jobId: 'job-1',
    scorecardVersionId: 'sv-1',
    overallScore: 94,
    evidencePercent: 92,
    completenessPercent: 90,
    gatesPassed: 5,
    gatesTotal: 5,
    stage: 'shortlisted',
  },
  {
    id: 'match-3',
    candidateId: 'cand-3',
    jobId: 'job-1',
    scorecardVersionId: 'sv-1',
    overallScore: 92,
    evidencePercent: 88,
    completenessPercent: 85,
    gatesPassed: 5,
    gatesTotal: 5,
    stage: 'shortlisted',
  },
]

export const DEMO_GATE_RESULTS: MandatoryGateResult[] = [
  {
    id: 'gate-1',
    candidateId: 'cand-1',
    requirementId: 'req-1',
    requirementLabel: 'Multi-unit span ≥ 25 sites',
    result: 'pass',
  },
  {
    id: 'gate-2',
    candidateId: 'cand-1',
    requirementId: 'req-2',
    requirementLabel: 'Valid food-safety certification',
    result: 'pass',
  },
]

export const DEMO_EVIDENCE: EvidenceItem[] = [
  {
    id: 'ev-1',
    candidateId: 'cand-1',
    requirementId: 'req-1',
    excerpt: 'Directed P&L and operations for 42 retail locations across a three-state territory.',
    sourceDocumentName: 'Sarah_Mitchell_Resume_v2.pdf',
    verificationStatus: 'verified',
    confidence: 0.95,
  },
]

export const DEMO_SHORTLIST: Shortlist = {
  id: 'shortlist-1',
  recruitmentProjectId: 'proj-1',
  status: 'draft',
  candidateIds: ['cand-1', 'cand-2', 'cand-3'],
}

export const DEMO_POC_METRICS: POCMetric[] = [
  {
    id: 'poc-m-1',
    recruitmentProjectId: 'proj-1',
    label: 'Time to shortlist (hours)',
    vendorValue: 18,
    clientValue: 46,
    unit: 'hours',
  },
  {
    id: 'poc-m-2',
    recruitmentProjectId: 'proj-1',
    label: 'Evidence coverage',
    vendorValue: 100,
    clientValue: null,
    unit: 'percent',
  },
  {
    id: 'poc-m-3',
    recruitmentProjectId: 'proj-1',
    label: 'Mandatory-gate compliance',
    vendorValue: 100,
    clientValue: null,
    unit: 'percent',
  },
]

export const DEMO_NOTIFICATIONS: Notification[] = [
  {
    id: 'notif-1',
    type: 'review_pending',
    message: 'Maria Rodriguez is awaiting quality review for Regional Operations Manager.',
    createdAt: '2026-09-17T14:20:00.000Z',
    readAt: null,
  },
  {
    id: 'notif-2',
    type: 'client_decision',
    message: 'Northfield Retail Group approved the Regional Operations Manager shortlist.',
    createdAt: '2026-09-16T10:05:00.000Z',
    readAt: '2026-09-16T11:00:00.000Z',
  },
]

export const DEMO_AUDIT_EVENTS: AuditEvent[] = [
  {
    id: 'audit-1',
    actorName: 'Dana Reyes',
    action: 'shortlist.finalized',
    entityType: 'shortlist',
    entityId: 'shortlist-1',
    createdAt: '2026-09-17T16:00:00.000Z',
  },
]

/**
 * Comparison-grid data for the Shortlist Verification Matrix screen
 * (reference/stitch/screens/confirmed-01-shortlist-verification-matrix-mobile.png).
 * Kept alongside the other fixtures rather than inline in the page component,
 * per the Build Phase 1 brief's "centralize temporary demo fixtures" rule.
 */
export interface ComparisonRow {
  candidateId: string
  siteCount: string
  siteCountNote: string
  headcount: string
  plVolume: string
  yearsExperience: string
  domain: string
  domainNote: string
  city: string
  distance: string
  driveTime: string
  targetSalary: string
  compValue: string
  compNote: string
  noticePeriod: string
  strengths: string[]
  risks: string[]
}

export const DEMO_COMPARISON: ComparisonRow[] = [
  {
    candidateId: 'cand-1',
    siteCount: '42 Sites',
    siteCountNote: 'Highest Span',
    headcount: '180 FTEs',
    plVolume: '$65M',
    yearsExperience: '11 Yrs',
    domain: 'Retail + C-Ops',
    domainNote: 'Deep dual background in high-traffic multi-unit retail.',
    city: 'Dallas',
    distance: '12 miles',
    driveTime: '~20m drive',
    targetSalary: '$175k',
    compValue: 'Exact fit',
    compNote: '2-mo notice',
    noticePeriod: 'warning',
    strengths: ['Largest multi-site scale (42 units) and certified 100% evidence audit.'],
    risks: ['Extended 2-month notice period delay.'],
  },
  {
    candidateId: 'cand-2',
    siteCount: '28 Sites',
    siteCountNote: 'Target met',
    headcount: '120 FTEs',
    plVolume: '$48M',
    yearsExperience: '9 Yrs',
    domain: 'C-Store Pure',
    domainNote: 'Specialized operational background in convenience retail.',
    city: 'Fort Worth',
    distance: '32 miles',
    driveTime: '~40m drive',
    targetSalary: '$170k',
    compValue: '-$5k below',
    compNote: '3-wk notice',
    noticePeriod: 'ok',
    strengths: ['Direct 9-year pure convenience chain domain mastery; fastest start (3 weeks).'],
    risks: ['W2 salary verification artifact pending upload.'],
  },
  {
    candidateId: 'cand-3',
    siteCount: '35 Sites',
    siteCountNote: 'Balanced',
    headcount: '145 FTEs',
    plVolume: '$52M',
    yearsExperience: '10 Yrs',
    domain: 'Supermarket',
    domainNote: 'Multi-unit retail leader with extensive P&L exposure.',
    city: 'Dallas',
    distance: '8 miles',
    driveTime: '~15m drive',
    targetSalary: '$180k',
    compValue: '+$5k premium',
    compNote: '1-mo notice',
    noticePeriod: 'ok',
    strengths: ['Highest documented P&L turnaround (+14% EBITDA in 18mo). Closest commute.'],
    risks: ['Less fast-food/hot-dispense convenience operational depth.'],
  },
]

export const DEMO_DASHBOARD_SUMMARY = {
  activePocRoles: DEMO_PROJECTS.filter((p) => p.isPoc).length,
  candidatesDiscovered: 14,
  candidatesInQualityReview: 2,
  shortlistedCandidates: 3,
}

// ---------------------------------------------------------------------------
// Candidate Foundation (Build Phase 5) demo fixtures.
//
// cand-1/cand-2/cand-3 reuse the SAME ids as the lightweight DEMO_CANDIDATES/
// DEMO_CANDIDATE_MATCHES above (Build Phase 1's scoring-preview fixtures,
// kept untouched — see docs/build-phase-5-report.md for why the two
// coexist) so links from the Projects/Shortlists screens into
// /candidates/[id] keep resolving to the same person. cand-4 and cand-5 are
// new: cand-4 demonstrates a candidate sourced before any project
// assignment, and cand-5 is a deliberate near-duplicate of cand-2 so the
// duplicate-resolution screen has something real to show.
// ---------------------------------------------------------------------------

export const DEMO_CANDIDATE_RECORDS: CandidateRecord[] = [
  {
    id: 'cand-1',
    organizationId: 'org-1',
    fullName: 'Sarah Mitchell',
    primaryEmail: 'sarah.mitchell@example.com',
    primaryPhone: '+1 (614) 555-0142',
    status: 'active',
    mergedIntoCandidateId: null,
    createdBy: 'user-demo-1',
    createdAt: '2026-09-11T14:00:00.000Z',
    updatedAt: '2026-09-11T14:00:00.000Z',
  },
  {
    id: 'cand-2',
    organizationId: 'org-1',
    fullName: 'James Carter',
    primaryEmail: 'james.carter@example.com',
    primaryPhone: '+1 (614) 555-0198',
    status: 'active',
    mergedIntoCandidateId: null,
    createdBy: 'user-demo-1',
    createdAt: '2026-09-11T14:10:00.000Z',
    updatedAt: '2026-09-11T14:10:00.000Z',
  },
  {
    id: 'cand-3',
    organizationId: 'org-1',
    fullName: 'Maria Rodriguez',
    primaryEmail: 'maria.rodriguez@example.com',
    primaryPhone: '+1 (614) 555-0176',
    status: 'active',
    mergedIntoCandidateId: null,
    createdBy: 'user-demo-1',
    createdAt: '2026-09-11T14:20:00.000Z',
    updatedAt: '2026-09-11T14:20:00.000Z',
  },
  {
    id: 'cand-4',
    organizationId: 'org-1',
    fullName: 'Priya Natarajan',
    primaryEmail: 'priya.n@example.com',
    primaryPhone: null,
    status: 'active',
    mergedIntoCandidateId: null,
    createdBy: 'user-demo-2',
    createdAt: '2026-09-14T10:00:00.000Z',
    updatedAt: '2026-09-14T10:00:00.000Z',
  },
  {
    id: 'cand-5',
    organizationId: 'org-1',
    fullName: 'Jimmy Carter',
    primaryEmail: null,
    primaryPhone: '+1 (614) 555-0198',
    status: 'active',
    mergedIntoCandidateId: null,
    createdBy: 'user-demo-2',
    createdAt: '2026-09-15T09:00:00.000Z',
    updatedAt: '2026-09-15T09:00:00.000Z',
  },
]

export const DEMO_CANDIDATE_PROFILES: CandidateProfile[] = [
  {
    id: 'profile-1',
    candidateId: 'cand-1',
    currentTitle: 'Regional Director, Retail Ops',
    currentCompany: 'Northgate Retail Holdings',
    summary: '11 years of multi-unit retail operations leadership.',
    location: 'Columbus, OH',
    workAuthorization: 'US Citizen',
    compensationMin: 105000,
    compensationMax: 125000,
    compensationCurrency: 'USD',
    compensationPeriod: 'annual',
    availabilityDate: '2026-11-01',
    availabilityNotes: 'Two weeks after offer.',
    noticePeriodDays: 14,
    workplacePreference: 'hybrid',
    yearsExperience: 11,
    recruiterNotes:
      'Strong references from two prior regional VPs — verify compensation expectation before submitting.',
    clientVisibleNotes:
      'Proven multi-state P&L owner with a track record of same-store sales growth.',
  },
  {
    id: 'profile-2',
    candidateId: 'cand-2',
    currentTitle: 'Multi-Unit Operations Manager',
    currentCompany: 'QuickStop Convenience',
    summary: '9 years managing convenience and fuel retail locations.',
    location: 'Dayton, OH',
    workAuthorization: 'US Citizen',
    compensationMin: 85000,
    compensationMax: 100000,
    compensationCurrency: 'USD',
    compensationPeriod: 'annual',
    availabilityDate: null,
    availabilityNotes: 'Flexible.',
    noticePeriodDays: 21,
    workplacePreference: 'onsite',
    yearsExperience: 9,
    recruiterNotes: 'Candidate mentioned a competing offer in progress — move quickly.',
    clientVisibleNotes:
      'Deep convenience-retail operations background across a 30+ site footprint.',
  },
  {
    id: 'profile-3',
    candidateId: 'cand-3',
    currentTitle: 'Area Supervisor',
    currentCompany: 'Harborline Food Service',
    summary: '10 years in food-service area supervision.',
    location: 'Cincinnati, OH',
    workAuthorization: 'US Citizen',
    compensationMin: 80000,
    compensationMax: 95000,
    compensationCurrency: 'USD',
    compensationPeriod: 'annual',
    availabilityDate: '2026-10-15',
    availabilityNotes: null,
    noticePeriodDays: 14,
    workplacePreference: 'onsite',
    yearsExperience: 10,
    recruiterNotes: null,
    clientVisibleNotes: 'Consistent performer with strong food-safety compliance record.',
  },
  {
    id: 'profile-4',
    candidateId: 'cand-4',
    currentTitle: 'Store Manager',
    currentCompany: 'Metro Grocery Co-op',
    summary: null,
    location: 'Cleveland, OH',
    workAuthorization: null,
    compensationMin: null,
    compensationMax: null,
    compensationCurrency: 'USD',
    compensationPeriod: null,
    availabilityDate: null,
    availabilityNotes: null,
    noticePeriodDays: null,
    workplacePreference: null,
    yearsExperience: null,
    recruiterNotes: 'Sourced via cold outreach — not yet assigned to a project.',
    clientVisibleNotes: null,
  },
  {
    id: 'profile-5',
    candidateId: 'cand-5',
    currentTitle: 'Ops Manager',
    currentCompany: 'QuickStop Convenience',
    summary: null,
    location: 'Dayton, OH',
    workAuthorization: null,
    compensationMin: null,
    compensationMax: null,
    compensationCurrency: 'USD',
    compensationPeriod: null,
    availabilityDate: null,
    availabilityNotes: null,
    noticePeriodDays: null,
    workplacePreference: null,
    yearsExperience: null,
    recruiterNotes: 'Possible duplicate of James Carter — same phone number, similar name/company.',
    clientVisibleNotes: null,
  },
]

export const DEMO_CANDIDATE_CONTACT_POINTS: CandidateContactPoint[] = [
  {
    id: 'contact-1',
    candidateId: 'cand-1',
    type: 'email',
    value: 'sarah.mitchell@example.com',
    isPrimary: true,
  },
  {
    id: 'contact-2',
    candidateId: 'cand-1',
    type: 'phone',
    value: '+1 (614) 555-0142',
    isPrimary: true,
  },
  {
    id: 'contact-3',
    candidateId: 'cand-2',
    type: 'email',
    value: 'james.carter@example.com',
    isPrimary: true,
  },
  {
    id: 'contact-4',
    candidateId: 'cand-2',
    type: 'phone',
    value: '+1 (614) 555-0198',
    isPrimary: true,
  },
  {
    id: 'contact-5',
    candidateId: 'cand-3',
    type: 'email',
    value: 'maria.rodriguez@example.com',
    isPrimary: true,
  },
]

export const DEMO_CANDIDATE_DOCUMENTS: CandidateDocument[] = [
  {
    id: 'cdoc-1',
    candidateId: 'cand-1',
    documentUploadId: 'upload-1',
    docType: 'cv',
    versionNo: 1,
    status: 'active',
    fileName: 'Sarah_Mitchell_Resume_v2.pdf',
    checksumSha256: 'demo-checksum-cand1-v1',
    sizeBytes: 182_400,
    createdAt: '2026-09-11T14:05:00.000Z',
  },
]

export const DEMO_CANDIDATE_EXPERIENCES: CandidateExperience[] = [
  {
    id: 'exp-1',
    candidateId: 'cand-1',
    company: 'Northgate Retail Holdings',
    title: 'Regional Director, Retail Ops',
    location: 'Columbus, OH',
    startDate: '2021-03-01',
    endDate: null,
    isCurrent: true,
    description:
      'Directed P&L and operations for 42 retail locations across a three-state territory.',
  },
  {
    id: 'exp-2',
    candidateId: 'cand-1',
    company: 'Fairview Stores Inc.',
    title: 'District Manager',
    location: 'Indianapolis, IN',
    startDate: '2016-06-01',
    endDate: '2021-02-28',
    isCurrent: false,
    description: 'Managed 12 stores; grew same-store sales 8% year over year.',
  },
]

export const DEMO_CANDIDATE_EDUCATION: CandidateEducation[] = [
  {
    id: 'edu-1',
    candidateId: 'cand-1',
    institution: 'Ohio State University',
    degree: 'B.S.',
    fieldOfStudy: 'Business Administration',
    startDate: '2008-08-01',
    endDate: '2012-05-01',
  },
]

export const DEMO_CANDIDATE_CERTIFICATIONS: CandidateCertification[] = [
  {
    id: 'cert-1',
    candidateId: 'cand-3',
    name: 'ServSafe Food Protection Manager',
    issuingBody: 'National Restaurant Association',
    issuedDate: '2024-01-15',
    expiresDate: '2029-01-15',
  },
]

export const DEMO_CANDIDATE_SKILLS: CandidateSkill[] = [
  {
    id: 'skill-1',
    candidateId: 'cand-1',
    skillName: 'P&L Management',
    proficiency: 'expert',
    yearsExperience: 11,
  },
  {
    id: 'skill-2',
    candidateId: 'cand-1',
    skillName: 'Multi-Unit Operations',
    proficiency: 'expert',
    yearsExperience: 9,
  },
  {
    id: 'skill-3',
    candidateId: 'cand-2',
    skillName: 'Convenience Retail Operations',
    proficiency: 'advanced',
    yearsExperience: 9,
  },
]

export const DEMO_CANDIDATE_SOURCES: CandidateSource[] = [
  {
    id: 'src-1',
    candidateId: 'cand-1',
    recruitmentProjectId: 'proj-1',
    channel: 'linkedin',
    sourceDetail: null,
    sourcedAt: '2026-09-11T14:00:00.000Z',
  },
  {
    id: 'src-2',
    candidateId: 'cand-2',
    recruitmentProjectId: 'proj-1',
    channel: 'referral',
    sourceDetail: 'Referred by hiring manager',
    sourcedAt: '2026-09-11T14:10:00.000Z',
  },
  {
    id: 'src-3',
    candidateId: 'cand-3',
    recruitmentProjectId: 'proj-1',
    channel: 'apollo',
    sourceDetail: null,
    sourcedAt: '2026-09-11T14:20:00.000Z',
  },
  {
    id: 'src-4',
    candidateId: 'cand-4',
    recruitmentProjectId: null,
    channel: 'manual',
    sourceDetail: 'Cold outreach',
    sourcedAt: '2026-09-14T10:00:00.000Z',
  },
  {
    id: 'src-5',
    candidateId: 'cand-5',
    recruitmentProjectId: 'proj-1',
    channel: 'csv_import',
    sourceDetail: 'Vendor candidate list',
    sourcedAt: '2026-09-15T09:00:00.000Z',
  },
]

export const DEMO_CANDIDATE_PROJECT_ENTRIES: CandidateProjectEntry[] = [
  {
    id: 'cpe-1',
    candidateId: 'cand-1',
    recruitmentProjectId: 'proj-1',
    jobId: 'job-1',
    currentStage: 'shortlisted',
    clientVisible: true,
    createdAt: '2026-09-11T14:00:00.000Z',
    updatedAt: '2026-09-18T09:00:00.000Z',
  },
  {
    id: 'cpe-2',
    candidateId: 'cand-2',
    recruitmentProjectId: 'proj-1',
    jobId: 'job-1',
    currentStage: 'shortlisted',
    clientVisible: true,
    createdAt: '2026-09-11T14:10:00.000Z',
    updatedAt: '2026-09-18T09:00:00.000Z',
  },
  {
    id: 'cpe-3',
    candidateId: 'cand-3',
    recruitmentProjectId: 'proj-1',
    jobId: 'job-1',
    currentStage: 'shortlisted',
    clientVisible: true,
    createdAt: '2026-09-11T14:20:00.000Z',
    updatedAt: '2026-09-18T09:00:00.000Z',
  },
  {
    id: 'cpe-5',
    candidateId: 'cand-5',
    recruitmentProjectId: 'proj-1',
    jobId: 'job-1',
    currentStage: 'discovered',
    clientVisible: false,
    createdAt: '2026-09-15T09:00:00.000Z',
    updatedAt: '2026-09-15T09:00:00.000Z',
  },
]

export const DEMO_CANDIDATE_PIPELINE_EVENTS: CandidatePipelineEvent[] = [
  {
    id: 'cpev-1',
    candidateId: 'cand-1',
    recruitmentProjectId: 'proj-1',
    fromStage: null,
    toStage: 'discovered',
    actorName: 'Dana Reyes',
    reason: null,
    createdAt: '2026-09-11T14:00:00.000Z',
  },
  {
    id: 'cpev-2',
    candidateId: 'cand-1',
    recruitmentProjectId: 'proj-1',
    fromStage: 'discovered',
    toStage: 'eligibility_check',
    actorName: 'Dana Reyes',
    reason: null,
    createdAt: '2026-09-12T09:00:00.000Z',
  },
  {
    id: 'cpev-3',
    candidateId: 'cand-1',
    recruitmentProjectId: 'proj-1',
    fromStage: 'eligibility_check',
    toStage: 'scored',
    actorName: 'Dana Reyes',
    reason: null,
    createdAt: '2026-09-13T09:00:00.000Z',
  },
  {
    id: 'cpev-4',
    candidateId: 'cand-1',
    recruitmentProjectId: 'proj-1',
    fromStage: 'scored',
    toStage: 'quality_review',
    actorName: 'Dana Reyes',
    reason: null,
    createdAt: '2026-09-15T09:00:00.000Z',
  },
  {
    id: 'cpev-5',
    candidateId: 'cand-1',
    recruitmentProjectId: 'proj-1',
    fromStage: 'quality_review',
    toStage: 'outreach',
    actorName: 'Dana Reyes',
    reason: null,
    createdAt: '2026-09-16T09:00:00.000Z',
  },
  {
    id: 'cpev-6',
    candidateId: 'cand-1',
    recruitmentProjectId: 'proj-1',
    fromStage: 'outreach',
    toStage: 'shortlisted',
    actorName: 'Dana Reyes',
    reason: null,
    createdAt: '2026-09-18T09:00:00.000Z',
  },
  {
    id: 'cpev-7',
    candidateId: 'cand-5',
    recruitmentProjectId: 'proj-1',
    fromStage: null,
    toStage: 'discovered',
    actorName: 'Jordan Lee',
    reason: null,
    createdAt: '2026-09-15T09:00:00.000Z',
  },
]

export const DEMO_CANDIDATE_CONSENTS: CandidateConsent[] = [
  {
    id: 'consent-1',
    candidateId: 'cand-1',
    consentStatus: 'granted',
    consentRecordedAt: '2026-09-11T14:00:00.000Z',
    deletionRequested: false,
    deletionRequestedAt: null,
    deletionReason: null,
  },
  {
    id: 'consent-2',
    candidateId: 'cand-2',
    consentStatus: 'granted',
    consentRecordedAt: '2026-09-11T14:10:00.000Z',
    deletionRequested: false,
    deletionRequestedAt: null,
    deletionReason: null,
  },
  {
    id: 'consent-3',
    candidateId: 'cand-3',
    consentStatus: 'unknown',
    consentRecordedAt: null,
    deletionRequested: false,
    deletionRequestedAt: null,
    deletionReason: null,
  },
]
