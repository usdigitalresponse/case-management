import {
  getBillingRuleSettings,
  getCase,
  getCaseInvoices,
  getInvoiceImport,
  getMyInvoice,
  getMergePreview,
  listPersonMerges,
  listPossibleDuplicates,
  listPossibleDuplicateCases,
  getOwnDemoRole,
  getPerson,
  searchPeople,
  getPortalBillingRules,
  getProviderDocuments,
  findCaseMatches,
  listAuthProviders,
  listDemoAccounts,
  listReceiptChannels,
  getPreauthorizationRequest,
  getReviewSettings,
  getStaffRoles,
  getThresholdSettings,
  listBillableProfessionals,
  listDecisionReasonSettings,
  listInvoiceImports,
  listMileageRates,
  listMyCases,
  listMyInvoices,
  listMyTimeEntries,
  listProfessionalKinds,
  listRequestableProviders,
  listReviewPeople,
  listTimeCategoryRates,
  listUploadCases,
  type BillableProfessional,
  type InvoiceImportDetail,
  type PortalInvoice,
  getInvoiceForReview,
  getPreauthorizationUsage,
  getReferenceData,
  listCases,
  getCaseCounts,
  getCaseOverview,
  type CaseRequest,
  listCounties,
  listDecisionReasons,
  listInvoiceIntake,
  listPeople,
  listPreauthorizationRequests,
  listRecentCaseChanges,
  listReviewQueue,
  listVendors,
  queueCounts as getQueueCounts,
  type MyInvoicesRequest,
  type PeopleRequest,
  type QueueRequest,
} from './api/client';
import type { Resource } from './hooks/useResource';
import type { BatchedResource } from './hooks/useBatchedResource';

const resource = <T>(definition: Resource<T>) => definition;
const edited = <T>(definition: Resource<T>) => ({ ...definition, fresh: true });

// Cached reads shared by pages and their route loaders, so both use one key.
const batched = <T, Summary>(definition: Omit<BatchedResource<T, Summary>, 'batched'>): BatchedResource<T, Summary> => ({ ...definition, batched: true });

// One page's invoices (./queueRequests.ts), a batch at a time.
export const reviewQueue = (query: QueueRequest) =>
  batched({ key: ['review-queue', query], load: (after) => listReviewQueue(query, after), keepPrevious: true });

export const queueCounts = resource({ key: ['queue-counts'], load: getQueueCounts });

export const invoiceIntake = resource({ key: ['invoice-intake'], load: listInvoiceIntake });

export const invoiceForReview = (invoiceId: string) =>
  edited({ key: ['invoice-review', invoiceId], load: () => getInvoiceForReview(invoiceId) });

export const decisionReasons = resource({ key: ['decision-reasons'], load: listDecisionReasons, reference: true });

// A case list (./caseRequests.ts), a batch at a time.
export const cases = (query: CaseRequest) => batched({ key: ['cases', query], load: (after) => listCases(query, after), keepPrevious: true });

export const caseCounts = resource({ key: ['case-counts'], load: getCaseCounts });

export const caseOverview = resource({ key: ['case-overview'], load: getCaseOverview });

export const recentCaseChanges = resource({ key: ['recent-case-changes'], load: listRecentCaseChanges });

export const counties = resource({ key: ['counties'], load: () => listCounties().then((result) => result.counties), reference: true });

// People by name (./pages/People.tsx), a batch at a time.
export const people = (query: PeopleRequest) => batched({ key: ['people', query], load: (after) => listPeople(query, after), keepPrevious: true });

export const referenceData = resource({ key: ['reference-data'], load: getReferenceData, reference: true });

export const preauthorizationRequests = (filter: { status: string; countyId?: string; caseId?: string }) =>
  batched({
    key: ['preauthorization-requests', filter.status, filter.countyId ?? null, filter.caseId ?? null],
    load: (after) => listPreauthorizationRequests(filter, after),
    keepPrevious: true,
  });

export function thisYear() {
  const year = new Date().getFullYear();
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export const preauthorizationUsage = (period: { from: string; to: string }) =>
  resource({ key: ['preauthorization-usage', period.from, period.to], load: () => getPreauthorizationUsage(period), keepPrevious: true });

// The sender's own invoices (./portal/PortalInvoiceList.tsx), a batch at a time.
export const myInvoices = (query: MyInvoicesRequest = { show: 'list' }) =>
  batched({ key: ['my-invoices', query], load: (after) => listMyInvoices(query, after), keepPrevious: true });

export const myCaseInvoices = (caseId: string, withWithdrawn: boolean) => myInvoices({ caseId, show: withWithdrawn ? 'all' : 'current' });

// Read by pages that edit what they load.
export const professionalKinds = edited({ key: ['professional-kinds'], load: () => listProfessionalKinds().then((result) => result.kinds) });

export const ownDemoRole = edited({ key: ['own-demo-role'], load: getOwnDemoRole });

export const mileageRates = edited({ key: ['mileage-rates'], load: () => listMileageRates().then((result) => result.rates) });

export const timeCategoryRates = edited({ key: ['time-category-rates'], load: () => listTimeCategoryRates().then((result) => result.rates) });

export const billingRuleSettings = edited({ key: ['billing-rule-settings'], load: getBillingRuleSettings });

export const reviewSettings = edited({ key: ['review-settings'], load: getReviewSettings });

export const reviewPeople = edited({ key: ['review-people'], load: listReviewPeople });

export const decisionReasonSettings = edited({ key: ['decision-reason-settings'], load: listDecisionReasonSettings });

export const staffRoles = edited({ key: ['staff-roles'], load: getStaffRoles });

export const thresholdSettings = edited({ key: ['threshold-settings'], load: getThresholdSettings });

export const caseDetail = (caseId: string) => edited({ key: ['case', caseId], load: () => getCase(caseId) });

export const caseInvoices = (caseId: string) => edited({ key: ['case-invoices', caseId], load: () => getCaseInvoices(caseId) });

// A case's invoices, newest first, a batch at a time.
export const caseInvoiceList = (caseId: string) => {
  const query: QueueRequest = { view: 'all', caseId, sort: 'newest' };
  return batched({ key: ['case-invoice-list', query], load: (after) => listReviewQueue(query, after), fresh: true });
};

export const person = (professionalId: string) => edited({ key: ['person', professionalId], load: () => getPerson(professionalId) });

export const personInvoices = (query: QueueRequest) =>
  batched({ key: ['person-invoices', query], load: (after) => listReviewQueue(query, after), fresh: true, keepPrevious: true });

export const myCases = edited({ key: ['my-cases'], load: listMyCases });

export const myTimeEntries = (caseId: string) =>
  edited({ key: ['my-time-entries', caseId], load: () => listMyTimeEntries(caseId).then((result) => result.timeEntries) });

export const myInvoice = (invoiceId: string) => edited({ key: ['my-invoice', invoiceId], load: () => getMyInvoice(invoiceId) });

export const billableProfessionals = (caseId: string | null) =>
  edited({ key: ['billable-professionals', caseId], load: () => listBillableProfessionals(caseId).then((result) => result.professionals) });

export const uploadCases = edited({ key: ['upload-cases'], load: () => listUploadCases().then((result) => result.cases) });

export const invoiceImports = edited({ key: ['invoice-imports'], load: () => listInvoiceImports().then((result) => result.imports) });

export interface ImportReviewData {
  importDetail: InvoiceImportDetail;
  invoice: PortalInvoice | null;
  timekeepers: BillableProfessional[];
}

export const importReview = (importId: string) =>
  edited({
    key: ['import-review', importId],
    load: async (): Promise<ImportReviewData> => {
      const importDetail = await getInvoiceImport(importId);
      const [invoice, timekeepers] = await Promise.all([
        importDetail.invoiceId ? getMyInvoice(importDetail.invoiceId) : Promise.resolve(null),
        // A file held in intake has no case: staff may match any provider.
        listBillableProfessionals(importDetail.caseId).then((result) => result.professionals),
      ]);
      return { importDetail, invoice, timekeepers };
    },
  });

export const myPreauthorizationRequests = batched({ key: ['my-preauthorization-requests'], load: (after) => listPreauthorizationRequests({}, after), fresh: true });

export const requestableProviders = edited({ key: ['requestable-providers'], load: listRequestableProviders });

export const preauthorizationRequest = (requestId: string) =>
  edited({ key: ['preauthorization-request', requestId], load: () => getPreauthorizationRequest(requestId) });

export const providerDocuments = (professionalId: string) =>
  edited({ key: ['provider-documents', professionalId], load: () => getProviderDocuments(professionalId) });

export const caseMatches = (invoiceId: string, caseNumber: string) =>
  edited({ key: ['case-matches', invoiceId, caseNumber], load: () => findCaseMatches(invoiceId) });


export const receiptChannels = resource({ key: ['receipt-channels'], load: () => listReceiptChannels().then((result) => result.channels), reference: true });

export const portalBillingRules = resource({ key: ['portal-billing-rules'], load: getPortalBillingRules, reference: true });

export const authProviders = resource({ key: ['auth-providers'], load: listAuthProviders, reference: true });

export const demoAccounts = resource({ key: ['demo-accounts'], load: listDemoAccounts, reference: true });

export const providerList = (query: string) =>
  batched({ key: ['provider-list', query], load: (after) => listVendors(query, after), keepPrevious: true });

export const personRecords = (query: string) =>
  batched({ key: ['person-records', query], load: (after) => searchPeople(query, after), keepPrevious: true });

// Possible duplicate people and merges; acted on from their pages.
export const possibleDuplicates = edited({ key: ['possible-duplicates'], load: () => listPossibleDuplicates().then((result) => result.duplicates) });

export const personMerges = edited({ key: ['person-merges'], load: () => listPersonMerges().then((result) => result.merges) });

export const possibleDuplicateCases = edited({
  key: ['possible-duplicate-cases'],
  load: () => listPossibleDuplicateCases().then((result) => result.duplicates),
});

export const mergePreview = (keptPersonId: string, retiredPersonIds: string[]) =>
  edited({ key: ['merge-preview', keptPersonId, ...retiredPersonIds], load: () => getMergePreview(keptPersonId, retiredPersonIds) });
