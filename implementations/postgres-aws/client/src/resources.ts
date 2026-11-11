import {
  getBillingRuleSettings,
  getCase,
  getCaseInvoices,
  getInvoiceImport,
  getMyInvoice,
  getOwnDemoRole,
  getPerson,
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
  listCounties,
  listDecisionReasons,
  listInvoiceIntake,
  listPeople,
  listPreauthorizationRequests,
  listRecentCaseChanges,
  listReviewQueue,
  listVendors,
} from './api/client';
import type { Resource } from './hooks/useResource';

const resource = <T>(definition: Resource<T>) => definition;
const edited = <T>(definition: Resource<T>) => ({ ...definition, fresh: true });

// Cached reads shared by pages and their route loaders, so both use one key.
export const reviewQueue = (view: 'open' | 'finished' | 'all') =>
  resource({ key: ['review-queue', view], load: () => listReviewQueue(view) });

export const invoiceIntake = edited({ key: ['invoice-intake'], load: listInvoiceIntake });

export const invoiceForReview = (invoiceId: string) =>
  edited({ key: ['invoice-review', invoiceId], load: () => getInvoiceForReview(invoiceId) });

export const decisionReasons = resource({ key: ['decision-reasons'], load: listDecisionReasons, reference: true });

export const cases = resource({ key: ['cases'], load: listCases });

export const recentCaseChanges = resource({ key: ['recent-case-changes'], load: listRecentCaseChanges });

export const counties = resource({ key: ['counties'], load: () => listCounties().then((result) => result.counties), reference: true });

export const people = resource({ key: ['people'], load: () => listPeople().then((result) => result.people) });

export const referenceData = resource({ key: ['reference-data'], load: getReferenceData, reference: true });

export const providers = resource({ key: ['providers'], load: () => listVendors('') });

export const preauthorizationRequests = (filter: { status: string; countyId?: string; caseId?: string }) =>
  resource({
    key: ['preauthorization-requests', filter.status, filter.countyId ?? null, filter.caseId ?? null],
    load: () => listPreauthorizationRequests(filter),
    keepPrevious: true,
  });

export function thisYear() {
  const year = new Date().getFullYear();
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export const preauthorizationUsage = (period: { from: string; to: string }) =>
  resource({ key: ['preauthorization-usage', period.from, period.to], load: () => getPreauthorizationUsage(period), keepPrevious: true });

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

export const person = (professionalId: string) => edited({ key: ['person', professionalId], load: () => getPerson(professionalId) });

export const personInvoices = (professionalId: string, day: string | undefined) =>
  edited({ key: ['person-invoices', professionalId, day ?? null], load: () => listReviewQueue('all', { professionalId, day }) });

export const myInvoices = edited({ key: ['my-invoices'], load: () => listMyInvoices().then((result) => result.invoices) });

export const myCases = edited({ key: ['my-cases'], load: listMyCases });

export const myCaseInvoices = (caseId: string) =>
  edited({ key: ['my-case-invoices', caseId], load: () => listMyInvoices(caseId).then((result) => result.invoices) });

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

export const myPreauthorizationRequests = edited({ key: ['my-preauthorization-requests'], load: () => listPreauthorizationRequests() });

export const requestableProviders = edited({ key: ['requestable-providers'], load: listRequestableProviders });

export const preauthorizationRequest = (requestId: string) =>
  edited({ key: ['preauthorization-request', requestId], load: () => getPreauthorizationRequest(requestId) });

export const providerDocuments = (professionalId: string) =>
  edited({ key: ['provider-documents', professionalId], load: () => getProviderDocuments(professionalId) });

export const caseMatches = (invoiceId: string, caseNumber: string) =>
  edited({ key: ['case-matches', invoiceId, caseNumber], load: () => findCaseMatches(invoiceId) });

export const vendorSearch = (query: string) =>
  resource({ key: ['vendor-search', query], load: () => listVendors(query), keepPrevious: true });

export const invoiceSearch = (query: string) =>
  resource({ key: ['invoice-search', query], load: () => listReviewQueue('all', { q: query }), keepPrevious: true });

export const receiptChannels = resource({ key: ['receipt-channels'], load: () => listReceiptChannels().then((result) => result.channels), reference: true });

export const portalBillingRules = resource({ key: ['portal-billing-rules'], load: getPortalBillingRules, reference: true });

export const authProviders = resource({ key: ['auth-providers'], load: listAuthProviders, reference: true });

export const demoAccounts = resource({ key: ['demo-accounts'], load: listDemoAccounts, reference: true });
