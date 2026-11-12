// Synthetic data for page tests, typed as the API returns it.
import type { AuthenticatedUser, BillableProfessional, InvoiceReview, InvoiceReviewLine, LineDecision, PortalInvoice, QueuedInvoice } from '../api/client';

export const REVIEWER: AuthenticatedUser = {
  userAccountId: 'u-reviewer',
  email: 'reviewer@example.test',
  displayName: 'Rae Reviewer',
  authType: 'sso',
  isAdmin: false,
  isStaff: true,
  reviewPermissions: { reviewLines: true, signOff: false, reassign: false, changeSettings: false },
  demoMode: false,
};

export const SENDER: AuthenticatedUser = {
  userAccountId: 'u-sender',
  email: 'sender@example.test',
  displayName: 'Sam Sender',
  authType: 'email-code',
  isAdmin: false,
  isStaff: false,
  reviewPermissions: null,
  demoMode: false,
};

export function reviewLine(overrides: Partial<InvoiceReviewLine> = {}): InvoiceReviewLine {
  return {
    invoiceLineId: 'line-1',
    lineTypeCode: 'time',
    amount: '300.00',
    serviceDate: '2026-08-04',
    description: 'Client meeting',
    quantity: '2.00',
    unitRate: '150.00',
    statedAmount: null,
    billedRate: '150.00',
    configuredRate: '150.00',
    rateSource: null,
    caseRateId: null,
    rateType: null,
    rateProfessionalId: null,
    rateKindId: null,
    rateKindDisplayName: null,
    rateLimit: null,
    rateLimitSource: null,
    expenseTypeCode: null,
    tripId: null,
    timeCategory: null,
    tripOrigin: null,
    tripDestination: null,
    roundTrip: false,
    routeDistance: null,
    routeCheckedAt: null,
    timekeeperLabel: null,
    proposedTimekeeperName: null,
    proposedTimekeeperEmail: null,
    timekeeperProfessionalId: 'p-sender',
    timekeeperDisplayName: 'Sam Sender',
    taskCode: null,
    activityCode: null,
    expenseCode: null,
    sourceTimeEntryId: null,
    sourceLocation: null,
    sourceActivityOn: null,
    sourceDurationHours: null,
    sourceDescription: null,
    decisionOutcomeCode: null,
    decisionOutcomeDisplayName: null,
    decisionApprovedAmount: null,
    decisionReason: null,
    decidedByDisplayName: null,
    decidedAt: null,
    decision: null,
    history: [],
    working: null,
    ...overrides,
  };
}

export function approved(line: InvoiceReviewLine): LineDecision {
  return {
    outcomeCode: 'approved',
    outcomeDisplayName: 'Approved',
    approvedAmount: line.amount,
    approvedQuantity: line.quantity,
    approvedRate: line.unitRate,
    reasonCode: null,
    reasonDisplayName: null,
    note: null,
    timeLogOverride: null,
    decidedByDisplayName: REVIEWER.displayName,
    decidedAt: '2026-09-02T15:00:00Z',
  };
}

export function queuedInvoice(overrides: Partial<QueuedInvoice> = {}): QueuedInvoice {
  return {
    invoiceId: 'inv-1',
    caseId: 'case-1',
    caseClientDisplayName: 'Client A',
    caseExternalReference: null,
    professionalId: 'p-sender',
    professionalDisplayName: 'Sam Sender',
    professionalKindDisplayName: 'Attorney',
    submittedByUserAccountId: SENDER.userAccountId,
    submittedByDisplayName: 'Sam Sender',
    statusId: 'status-under-review',
    statusCode: 'under_review',
    statusDisplayName: 'Under review',
    submittedAt: '2026-09-01T12:00:00Z',
    submittedTotal: '300.00',
    periodStart: '2026-08-01',
    periodEnd: '2026-08-31',
    receivedViaDisplayName: 'Portal',
    receivedOn: '2026-09-01',
    proposedCase: null,
    proposedProvider: null,
    caseNumberAsTyped: '26-CR-0001',
    caseNumberCorrected: null,
    invoiceNumber: null,
    countyId: null,
    countyDisplayName: null,
    enteredInReview: false,
    caseChoice: null,
    chosenCaseId: null,
    newCaseClientName: null,
    linesVersion: 1,
    linesChangedAt: null,
    linesChangedByUserAccountId: null,
    returnedReason: null,
    completedAt: null,
    ...overrides,
  };
}

export function invoiceReview(overrides: Partial<InvoiceReview> = {}): InvoiceReview {
  const lines = overrides.lines ?? [reviewLine()];
  return {
    invoice: queuedInvoice(),
    preauthorization: null,
    overPreauthorized: false,
    overrunExplanations: [],
    caseNumber: '26-CR-0001',
    otherCaseNumbers: [],
    lines,
    ruleFindings: [],
    round: null,
    approvedTotal: null,
    signOffs: [],
    questions: [],
    assignments: { reviewer: { userAccountId: REVIEWER.userAccountId, displayName: REVIEWER.displayName }, signOff: [] },
    nextSignOff: null,
    signOffStarted: false,
    fileSource: null,
    submitterChanges: null,
    approvedRate: null,
    caseNumberMatches: { same: 0, close: 0 },
    sameDayTravel: [],
    billingOverlaps: [],
    entryOpen: false,
    linesChangedByDisplayName: null,
    discardable: false,
    decidedByEnterer: false,
    senderEmail: 'sender@example.test',
    timeLog: null,
    caseRates: [],
    caseRatesChangedSinceSent: [],
    mileageDismissals: [],
    ...overrides,
  };
}

export const SENDER_PROFESSIONAL: BillableProfessional = {
  professionalId: 'p-sender',
  displayName: 'Sam Sender',
  isSelf: true,
  kindDisplayName: 'Attorney',
  rates: [{ hourlyRate: '150.00', effectiveFrom: '2026-01-01' }],
};

// What the line editor loads: who may be billed for, counties and billing rules.
export function lineEditorRoutes() {
  const professionals = { professionals: [SENDER_PROFESSIONAL] };
  return {
    'GET /api/portal/billable-professionals': professionals,
    'GET /api/portal/cases/:caseId/billable-professionals': professionals,
    'GET /api/portal/counties': { counties: [] },
    'GET /api/portal/billing-rules': { rules: [], codes: [], mileageRates: [], timeCategoryRates: [] },
  };
}

// A sender's draft filed by person: no case yet, the case number as typed.
export function portalInvoice(overrides: Partial<PortalInvoice> = {}): PortalInvoice {
  const { decidedByDisplayName: _, ...line } = reviewLine();
  return {
    invoice: queuedInvoice({ caseId: null, caseClientDisplayName: null, statusCode: 'draft', statusDisplayName: 'Draft', submittedAt: null }),
    decisionComments: [],
    caseNumber: null,
    otherCaseNumbers: [],
    submissionAttempt: null,
    approvedTotal: null,
    lines: [line],
    import: null,
    deletable: true,
    ruleFindings: [],
    fileSource: null,
    submitterChanges: null,
    questions: [],
    canAnswer: false,
    overrun: null,
    billingOverlaps: [],
    overrunExplanations: [],
    ...overrides,
  };
}

// What AuthProvider loads first: the user, and sign-in options with no organization name.
export function signedIn(user: AuthenticatedUser) {
  return {
    'GET /auth/me': user,
    'GET /auth/providers': { providers: [], demoLoginEnabled: false, externalDemoLoginEnabled: false, organizationName: null },
  };
}
