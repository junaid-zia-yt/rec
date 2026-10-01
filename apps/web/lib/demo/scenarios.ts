import 'server-only'
import type { CandidateEvidenceBundleItem } from '@/lib/ai/matching-provider'
import type { FrozenRequirement } from '@rqi/types'

/**
 * Build Phase 18 — private-demo seed scenarios (brief step 10: "Prepare
 * realistic demo data"). Two complete, entirely fictional recruitment
 * projects for Dave's business (retail + convenience/food-service), each
 * with a full job description, an approved scorecard, mandatory and
 * preferred requirements, and enough candidates to exercise every rule the
 * client's feedback asked us to repair:
 *
 * - at least one candidate FAILS a mandatory gate (excluded from ranking,
 *   no matter how strong the rest of their profile looks)
 * - at least one candidate has NO evidence for a mandatory requirement
 *   (insufficient_evidence — never guessed as a pass)
 * - at least one candidate has a genuinely CONFLICTING pair of evidence
 *   items for the same requirement
 * - at least three eligible candidates land at different overall scores
 *
 * Every requirement/evidence item here is deliberately worded so the real,
 * already-shipped deterministic pipeline (gates.ts / scoring.ts /
 * evaluate.ts, driven by SampleAssessmentMatchingProvider — see
 * lib/matching/demo-sample-assessment-provider.ts) produces the intended
 * result. Nothing in this file is a pre-computed score: apps/web/lib/demo/
 * engine.ts runs every one of these candidates through the real pipeline
 * the same way a live "Run evaluation" click does.
 */

export interface DemoRequirementSeed extends FrozenRequirement {
  description: string
  category: string
}

export interface DemoCandidateSeed {
  id: string
  fullName: string
  currentTitle: string
  currentCompany: string
  location: string
  yearsExperience: number
  email: string
  phone: string
  source: 'linkedin' | 'referral' | 'apollo' | 'manual' | 'csv_import' | 'job_board' | 'other'
  /** requirementId -> evidence items backing (or contradicting) that requirement. Omit a requirementId entirely to model "no evidence was ever captured" (drives insufficient_evidence honestly, never a guess). */
  evidenceByRequirement: Record<string, CandidateEvidenceBundleItem[]>
}

export interface DemoJobSeed {
  id: string
  title: string
  department: string
  location: string
  employmentType: string
  salaryMin: number
  salaryMax: number
  jobDescriptionText: string
  requirements: DemoRequirementSeed[]
}

export interface DemoProjectSeed {
  id: string
  clientId: string
  clientName: string
  clientVertical: string
  roleTitle: string
  job: DemoJobSeed
  candidateIds: string[]
}

export const DEMO_ORG_ID = 'ccaa99ca-6d50-545a-a50b-1773d96f96fa'
export const DEMO_ACTOR_NAME = 'Dana Reyes (demo)'

// ---------------------------------------------------------------------------
// Project 1 — Retail leadership role
// ---------------------------------------------------------------------------

const P1_REQ_PL: DemoRequirementSeed = {
  requirementId: '53533e5b-4896-5089-9480-d57008d1cf7d',
  name: '5+ years multi-unit retail management experience',
  description: 'Direct P&L or operational ownership of at least three retail locations at once.',
  category: 'experience',
  type: 'mandatory',
  weight: null,
}
const P1_REQ_LICENSE: DemoRequirementSeed = {
  requirementId: '4cc4f768-8934-5f76-841c-b71616450ad4',
  name: 'Valid state driver\'s license',
  description: 'Required for regular multi-site travel across the territory.',
  category: 'compliance',
  type: 'mandatory',
  weight: null,
}
const P1_REQ_BILINGUAL: DemoRequirementSeed = {
  requirementId: '08516de3-f2b7-5f2e-9f0e-4d067b09850a',
  name: 'Bilingual English/Spanish',
  description: 'Preferred for territories with majority Spanish-speaking frontline staff.',
  category: 'communication',
  type: 'preferred',
  weight: 50,
}
const P1_REQ_SHRINK: DemoRequirementSeed = {
  requirementId: 'bf42e325-4a81-5072-98ce-23a57ff32dd4',
  name: 'Inventory shrink reduction experience',
  description: 'A documented track record of reducing inventory shrink across managed sites.',
  category: 'operations',
  type: 'preferred',
  weight: 50,
}

const P1_REQUIREMENTS = [P1_REQ_PL, P1_REQ_LICENSE, P1_REQ_BILINGUAL, P1_REQ_SHRINK]

function ev(
  text: string,
  opts: { direct?: boolean; sourceKind?: CandidateEvidenceBundleItem['sourceKind'] } = {},
): CandidateEvidenceBundleItem {
  return {
    sourceKind: opts.sourceKind ?? 'experience',
    sourceId: null,
    text,
    isDirectStatement: opts.direct ?? true,
  }
}

const P1_CANDIDATES: DemoCandidateSeed[] = [
  {
    id: '83979151-0f96-57dc-8f36-026ea0453389',
    fullName: 'Sarah Mitchell',
    currentTitle: 'Regional Director, Retail Ops',
    currentCompany: 'Northgate Retail Holdings',
    location: 'Columbus, OH',
    yearsExperience: 11,
    email: 'sarah.mitchell@example.com',
    phone: '+1 (614) 555-0142',
    source: 'linkedin',
    evidenceByRequirement: {
      [P1_REQ_PL.requirementId]: [
        ev('Directed P&L and operations for 42 retail locations across a three-state territory for 6 years.'),
      ],
      [P1_REQ_LICENSE.requirementId]: [ev('Holds a valid Ohio driver\'s license, current through 2029.')],
      [P1_REQ_BILINGUAL.requirementId]: [ev('Fluent in English and Spanish; conducts store visits in both languages.')],
      [P1_REQ_SHRINK.requirementId]: [
        ev('Reduced inventory shrink from 2.1% to 0.9% across her 42-site portfolio over 18 months.'),
      ],
    },
  },
  {
    id: 'bcfe36fa-ddf2-549c-8bd8-b1382c8a7c1a',
    fullName: 'James Carter',
    currentTitle: 'Multi-Unit Operations Manager',
    currentCompany: 'QuickStop Convenience',
    location: 'Dayton, OH',
    yearsExperience: 9,
    email: 'james.carter@example.com',
    phone: '+1 (614) 555-0198',
    source: 'referral',
    evidenceByRequirement: {
      [P1_REQ_PL.requirementId]: [ev('Managed P&L for 28 convenience/retail locations over 5 years.')],
      [P1_REQ_LICENSE.requirementId]: [ev('Valid driver\'s license on file, renewed 2025.')],
      [P1_REQ_SHRINK.requirementId]: [
        ev('Store audit reports show a general downward shrink trend during his tenure.', { direct: false }),
      ],
      // No evidence at all for bilingual — preferred criterion contributes 0, never guessed.
    },
  },
  {
    id: 'f6b02f2f-30f3-5e5b-9401-9d4c558db230',
    fullName: 'Maria Rodriguez',
    currentTitle: 'Area Supervisor',
    currentCompany: 'Harborline Food Service',
    location: 'Cincinnati, OH',
    yearsExperience: 10,
    email: 'maria.rodriguez@example.com',
    phone: '+1 (614) 555-0176',
    source: 'apollo',
    evidenceByRequirement: {
      [P1_REQ_PL.requirementId]: [ev('Supervised operations across 15 sites, reporting into the district P&L owner.')],
      [P1_REQ_LICENSE.requirementId]: [ev('Confirmed valid driver\'s license during reference check.')],
      [P1_REQ_BILINGUAL.requirementId]: [
        ev('Resume lists "conversational Spanish" under languages.', { direct: false }),
      ],
    },
  },
  {
    id: '5b4a63e1-8d78-578a-991b-22d306eda601',
    fullName: 'Derek Holloway',
    currentTitle: 'Store Manager',
    currentCompany: 'Fairview Stores Inc.',
    location: 'Indianapolis, IN',
    yearsExperience: 8,
    email: 'derek.holloway@example.com',
    phone: '+1 (317) 555-0111',
    source: 'linkedin',
    evidenceByRequirement: {
      [P1_REQ_PL.requirementId]: [ev('Managed P&L across 30 sites for 4 years, strong same-store sales growth.')],
      [P1_REQ_LICENSE.requirementId]: [
        ev('FAIL: driver\'s license suspended in 2025 following a DUI conviction; not currently reinstated.'),
      ],
      [P1_REQ_BILINGUAL.requirementId]: [ev('Bilingual English/Spanish, confirmed in interview.')],
      [P1_REQ_SHRINK.requirementId]: [ev('Cut shrink by 1.2 points across his region.')],
    },
  },
  {
    id: '30560d36-9961-510d-84f6-925555009b06',
    fullName: 'Priya Natarajan',
    currentTitle: 'Store Manager',
    currentCompany: 'Metro Grocery Co-op',
    location: 'Cleveland, OH',
    yearsExperience: 6,
    email: 'priya.n@example.com',
    phone: '+1 (216) 555-0155',
    source: 'manual',
    evidenceByRequirement: {
      // No evidence captured yet for multi-unit P&L — sourced via cold outreach, CV not yet parsed.
      [P1_REQ_LICENSE.requirementId]: [ev('Valid driver\'s license, confirmed by recruiter.')],
    },
  },
  {
    id: '0aed2ad3-44eb-58b0-9a30-5009b3f3ed7e',
    fullName: 'Tomás Alvarez',
    currentTitle: 'Senior District Manager',
    currentCompany: 'Northgate Retail Holdings',
    location: 'Columbus, OH',
    yearsExperience: 13,
    email: 'tomas.alvarez@example.com',
    phone: '+1 (614) 555-0133',
    source: 'referral',
    evidenceByRequirement: {
      [P1_REQ_PL.requirementId]: [ev('Owns P&L for 55 sites across two districts, 7 years in the role.')],
      [P1_REQ_LICENSE.requirementId]: [ev('Valid driver\'s license, clean record.')],
      [P1_REQ_BILINGUAL.requirementId]: [ev('Native Spanish speaker, fully bilingual with English.')],
      [P1_REQ_SHRINK.requirementId]: [ev('Led a shrink-reduction initiative that saved $1.4M annually across his district.')],
    },
  },
  {
    id: '406ea180-58d8-57b1-9f9c-5259d4a1189a',
    fullName: 'Renee Okafor',
    currentTitle: 'Operations Manager',
    currentCompany: 'Fairview Stores Inc.',
    location: 'Indianapolis, IN',
    yearsExperience: 7,
    email: 'renee.okafor@example.com',
    phone: '+1 (317) 555-0177',
    source: 'job_board',
    evidenceByRequirement: {
      [P1_REQ_PL.requirementId]: [ev('Managed P&L for 6 stores over 6 years, consistent budget-to-actual performance.')],
      [P1_REQ_LICENSE.requirementId]: [ev('Valid driver\'s license confirmed.')],
      [P1_REQ_SHRINK.requirementId]: [ev('Reduced shrink 0.4 points across her stores last fiscal year.')],
    },
  },
]

// ---------------------------------------------------------------------------
// Project 2 — Convenience / food-service leadership role
// ---------------------------------------------------------------------------

const P2_REQ_CERT: DemoRequirementSeed = {
  requirementId: '0e9fe518-4c96-5d17-998e-5d8df677da60',
  name: 'Current food-safety handler certification',
  description: 'A valid, unexpired food-safety handler certification (e.g. ServSafe).',
  category: 'compliance',
  type: 'mandatory',
  weight: null,
}
const P2_REQ_SHIFT: DemoRequirementSeed = {
  requirementId: '4ab70425-5b53-5230-b5b9-1e36629f0873',
  name: 'Available for overnight/weekend shift rotation',
  description: 'Sites run 24 hours; the role requires rotating overnight and weekend coverage.',
  category: 'availability',
  type: 'mandatory',
  weight: null,
}
const P2_REQ_POS: DemoRequirementSeed = {
  requirementId: '4bf8d33e-677e-516d-833b-6f4e9915fb71',
  name: 'POS / inventory system experience',
  description: 'Hands-on experience with a point-of-sale and inventory management system.',
  category: 'systems',
  type: 'preferred',
  weight: 50,
}
const P2_REQ_QSR: DemoRequirementSeed = {
  requirementId: 'cbc61d8c-7b0d-56f2-8545-fb5c7a0e0668',
  name: '1+ years convenience or QSR supervision',
  description: 'Direct supervisory experience in convenience retail or quick-service food.',
  category: 'experience',
  type: 'preferred',
  weight: 50,
}

const P2_REQUIREMENTS = [P2_REQ_CERT, P2_REQ_SHIFT, P2_REQ_POS, P2_REQ_QSR]

const P2_CANDIDATES: DemoCandidateSeed[] = [
  {
    id: 'f16ec645-59cc-5e46-8ba5-cc8c8f34a30b',
    fullName: 'Angela Brooks',
    currentTitle: 'Assistant Manager',
    currentCompany: 'Harborline Food Service',
    location: 'Cincinnati, OH',
    yearsExperience: 5,
    email: 'angela.brooks@example.com',
    phone: '+1 (513) 555-0121',
    source: 'linkedin',
    evidenceByRequirement: {
      [P2_REQ_CERT.requirementId]: [ev('Holds a current ServSafe Food Protection Manager certification, expires 2029.', { sourceKind: 'certification' })],
      [P2_REQ_SHIFT.requirementId]: [ev('Has worked overnight and weekend rotations for the past 3 years.')],
      [P2_REQ_POS.requirementId]: [ev('Daily hands-on use of Square POS and inventory ordering system.')],
      [P2_REQ_QSR.requirementId]: [ev('4 years supervising a 24-hour convenience location.')],
    },
  },
  {
    id: '7572eb31-5200-5c6c-b975-e9e4d2776dcf',
    fullName: 'DeShawn Price',
    currentTitle: 'Shift Supervisor',
    currentCompany: 'QuickStop Convenience',
    location: 'Dayton, OH',
    yearsExperience: 3,
    email: 'deshawn.price@example.com',
    phone: '+1 (937) 555-0119',
    source: 'referral',
    evidenceByRequirement: {
      [P2_REQ_CERT.requirementId]: [ev('Current food-safety handler card, valid through 2027.', { sourceKind: 'certification' })],
      [P2_REQ_SHIFT.requirementId]: [ev('Confirmed available for any shift, including overnight.')],
      [P2_REQ_POS.requirementId]: [ev('Trained new hires on the store\'s POS and stock system.')],
      // No evidence for QSR supervision tenure — contributes 0, not guessed.
    },
  },
  {
    id: '1e1edcc3-ade9-515a-906c-eefb8c82e502',
    fullName: 'Linh Tran',
    currentTitle: 'Store Associate',
    currentCompany: 'Metro Grocery Co-op',
    location: 'Cleveland, OH',
    yearsExperience: 4,
    email: 'linh.tran@example.com',
    phone: '+1 (216) 555-0188',
    source: 'apollo',
    evidenceByRequirement: {
      [P2_REQ_CERT.requirementId]: [ev('FAIL: food-safety handler certification expired in early 2024 and has not been renewed.', { sourceKind: 'certification' })],
      [P2_REQ_SHIFT.requirementId]: [ev('Available weekends; overnight availability not confirmed.')],
      [P2_REQ_POS.requirementId]: [ev('Used a basic register system, limited inventory exposure.')],
      [P2_REQ_QSR.requirementId]: [ev('2 years as a shift lead at a QSR location.')],
    },
  },
  {
    id: '9770111c-1d3b-5b72-96f9-f1de2d86ce31',
    fullName: 'Omar Haddad',
    currentTitle: 'Convenience Store Manager',
    currentCompany: 'Fairview Stores Inc.',
    location: 'Indianapolis, IN',
    yearsExperience: 6,
    email: 'omar.haddad@example.com',
    phone: '+1 (317) 555-0144',
    source: 'job_board',
    evidenceByRequirement: {
      [P2_REQ_CERT.requirementId]: [ev('Certification on file with HR, believed current.', { direct: false, sourceKind: 'certification' })],
      [P2_REQ_SHIFT.requirementId]: [ev('Manager notes indicate general shift flexibility.', { direct: false })],
      [P2_REQ_POS.requirementId]: [ev('Some exposure to POS reporting during manager training.', { direct: false })],
      [P2_REQ_QSR.requirementId]: [
        // Deliberately conflicting pair: one direct statement, one indirect/inferred — the
        // deterministic provider flags this as a genuine conflict for a reviewer to resolve.
        ev('Supervised a QSR counter team for 14 months.'),
        ev('LinkedIn headline says "restaurant enthusiast" — supervisory scope unclear.', { direct: false }),
      ],
    },
  },
  {
    id: 'ffd024e4-aedf-5d7c-9a8e-332ea727cb4e',
    fullName: 'Katie Sullivan',
    currentTitle: 'Team Member',
    currentCompany: 'QuickStop Convenience',
    location: 'Dayton, OH',
    yearsExperience: 2,
    email: 'katie.sullivan@example.com',
    phone: '+1 (937) 555-0166',
    source: 'csv_import',
    evidenceByRequirement: {
      [P2_REQ_CERT.requirementId]: [ev('Current food-safety card on file, expires 2028.', { sourceKind: 'certification' })],
      // No evidence at all for shift availability — never captured, honestly unverified.
      [P2_REQ_POS.requirementId]: [ev('Operates the POS daily as a team member.')],
    },
  },
  {
    id: '75276f21-8ec5-52a7-b69a-0072241c0bd5',
    fullName: 'Victor Nguyen',
    currentTitle: 'Assistant Store Leader',
    currentCompany: 'Harborline Food Service',
    location: 'Cincinnati, OH',
    yearsExperience: 5,
    email: 'victor.nguyen@example.com',
    phone: '+1 (513) 555-0177',
    source: 'linkedin',
    evidenceByRequirement: {
      [P2_REQ_CERT.requirementId]: [ev('Current ServSafe certification, verified copy on file.', { sourceKind: 'certification' })],
      [P2_REQ_SHIFT.requirementId]: [ev('Regularly covers overnight and weekend shifts as assistant leader.')],
      [P2_REQ_POS.requirementId]: [ev('Manages POS configuration and weekly inventory counts.')],
      [P2_REQ_QSR.requirementId]: [ev('3 years supervising a convenience/food-service counter team.')],
    },
  },
  {
    id: '025679ae-1abc-5a41-80e8-7c329f6a2812',
    fullName: 'Brianna Foster',
    currentTitle: 'Shift Lead',
    currentCompany: 'Metro Grocery Co-op',
    location: 'Cleveland, OH',
    yearsExperience: 3,
    email: 'brianna.foster@example.com',
    phone: '+1 (216) 555-0199',
    source: 'referral',
    evidenceByRequirement: {
      [P2_REQ_CERT.requirementId]: [ev('Holds a current food-handler certification.', { sourceKind: 'certification' })],
      [P2_REQ_SHIFT.requirementId]: [ev('Available for overnight and weekend rotation, confirmed at interview.')],
      [P2_REQ_QSR.requirementId]: [ev('18 months as shift lead at a convenience location.')],
      // No POS evidence captured.
    },
  },
]

export const DEMO_SCENARIOS: DemoProjectSeed[] = [
  {
    id: '19bd1f07-3f5c-5da1-9868-0320eb989d00',
    clientId: 'e9724cf5-f9a2-5e3b-bcc4-9ccf05635d86',
    clientName: 'Northfield Retail Group',
    clientVertical: 'Retail',
    roleTitle: 'Regional Store Leader',
    job: {
      id: 'a55aa77b-fc89-5e05-a350-a94cbb8ae637',
      title: 'Regional Store Leader',
      department: 'Store Operations',
      location: 'Columbus, OH',
      employmentType: 'full_time',
      salaryMin: 95000,
      salaryMax: 115000,
      jobDescriptionText:
        'Regional Store Leader — own P&L and day-to-day operations for 25+ retail locations across the assigned territory. Must have 5+ years of multi-unit retail management experience and a valid driver\'s license for regular site travel. Bilingual English/Spanish and a track record reducing inventory shrink are strong pluses.',
      requirements: P1_REQUIREMENTS,
    },
    candidateIds: P1_CANDIDATES.map((c) => c.id),
  },
  {
    id: '120d7dc1-e805-53cd-ae37-15be53bdcdbd',
    clientId: '0f461bd2-108f-59a7-806a-9ef1d1516319',
    clientName: 'Harborline Food Service Group',
    clientVertical: 'Food Service',
    roleTitle: 'Convenience & Food Service Shift Leader',
    job: {
      id: '640d3966-a154-55bc-8706-08665996573d',
      title: 'Convenience & Food Service Shift Leader',
      department: 'Store Operations',
      location: 'Cincinnati, OH',
      employmentType: 'full_time',
      salaryMin: 42000,
      salaryMax: 52000,
      jobDescriptionText:
        'Convenience & Food Service Shift Leader — run a 24-hour convenience/food-service counter, covering overnight and weekend rotations. A current food-safety handler certification is required. POS/inventory system experience and prior convenience or QSR supervision are preferred.',
      requirements: P2_REQUIREMENTS,
    },
    candidateIds: P2_CANDIDATES.map((c) => c.id),
  },
]

export const DEMO_CANDIDATE_SEEDS: DemoCandidateSeed[] = [...P1_CANDIDATES, ...P2_CANDIDATES]

export const DEMO_OUTREACH_TEMPLATES = [
  {
    id: 'tmpl-email-intro',
    channel: 'email' as const,
    name: 'Introduction — email',
    subject: 'Opportunity: {{roleTitle}} at {{clientName}}',
    body:
      'Hi {{firstName}},\n\nI\'m reaching out about the {{roleTitle}} role with {{clientName}}. Your background at {{currentCompany}} stood out — would you be open to a short call this week?\n\nBest,\n{{recruiterName}}',
  },
  {
    id: 'tmpl-linkedin-intro',
    channel: 'linkedin' as const,
    name: 'Introduction — LinkedIn message',
    subject: null,
    body:
      'Hi {{firstName}} — I\'m recruiting for the {{roleTitle}} role at {{clientName}} and your experience at {{currentCompany}} looks like a strong fit. Open to a quick chat?',
  },
  {
    id: 'tmpl-sms-followup',
    channel: 'sms' as const,
    name: 'Follow-up — SMS',
    subject: null,
    body:
      'Hi {{firstName}}, following up on the {{roleTitle}} opportunity at {{clientName}}. Let me know if you have 15 min this week — {{recruiterName}}',
  },
]
