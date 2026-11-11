import {
  getBillingRuleSettings,
  getCase,
  getCaseInvoices,
  getInvoiceImport,
  getMyInvoice,
  getOwnDemoRole,
  getPerson,
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
import type { Resource } from './hooks/useCachedResource';

const resource = <T>(definition: Resource<T>) => definition;

// Cached reads shared by pages and their route loaders, so both use one key.
export const reviewQueue = (view: 'open' | 'finished' | 'all') =>
  resource({ key: ['review-queue', view], load: () => listReviewQueue(view) });

export const invoiceIntake = resource({ key: ['invoice-intake'], load: listInvoiceIntake });

export const invoiceForReview = (invoiceId: string) =>
  resource({ key: ['invoice-review', invoiceId], load: () => getInvoiceForReview(invoiceId), fresh: true });

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

// Read by pages that edit what they load, through useApiResource.
export const professionalKinds = resource({ key: ['professional-kinds'], load: () => listProfessionalKinds().then((result) => result.kinds) });

export const ownDemoRole = resource({ key: ['own-demo-role'], load: getOwnDemoRole });

export const mileageRates = resource({ key: ['mileage-rates'], load: () => listMileageRates().then((result) => result.rates) });

export const timeCategoryRates = resource({ key: ['time-category-rates'], load: () => listTimeCategoryRates().then((result) => result.rates) });

export const billingRuleSettings = resource({ key: ['billing-rule-settings'], load: getBillingRuleSettings });

export const reviewSettings = resource({ key: ['review-settings'], load: getReviewSettings });

export const reviewPeople = resource({ key: ['review-people'], load: listReviewPeople });

export const decisionReasonSettings = resource({ key: ['decision-reason-settings'], load: listDecisionReasonSettings });

export const staffRoles = resource({ key: ['staff-roles'], load: getStaffRoles });

export const thresholdSettings = resource({ key: ['threshold-settings'], load: getThresholdSettings });

export const caseDetail = (caseId: string) => resource({ key: ['case', caseId], load: () => getCase(caseId) });

export const caseInvoices = (caseId: string) => resource({ key: ['case-invoices', caseId], load: () => getCaseInvoices(caseId) });

export const person = (professionalId: string) => resource({ key: ['person', professionalId], load: () => getPerson(professionalId) });

export const personInvoices = (professionalId: string, day: string | undefined) =>
  resource({ key: ['person-invoices', professionalId, day ?? null], load: () => listReviewQueue('all', { professionalId, day }) });

export const myInvoices = resource({ key: ['my-invoices'], load: () => listMyInvoices().then((result) => result.invoices) });

export const myCases = resource({ key: ['my-cases'], load: listMyCases });

export const myCaseInvoices = (caseId: string) =>
  resource({ key: ['my-case-invoices', caseId], load: () => listMyInvoices(caseId).then((result) => result.invoices) });

export const myTimeEntries = (caseId: string) =>
  resource({ key: ['my-time-entries', caseId], load: () => listMyTimeEntries(caseId).then((result) => result.timeEntries) });

export const myInvoice = (invoiceId: string) => resource({ key: ['my-invoice', invoiceId], load: () => getMyInvoice(invoiceId) });

export const billableProfessionals = (caseId: string | null) =>
  resource({ key: ['billable-professionals', caseId], load: () => listBillableProfessionals(caseId).then((result) => result.professionals) });

export const uploadCases = resource({ key: ['upload-cases'], load: () => listUploadCases().then((result) => result.cases) });

export const invoiceImports = resource({ key: ['invoice-imports'], load: () => listInvoiceImports().then((result) => result.imports) });

export interface ImportReviewData {
  importDetail: InvoiceImportDetail;
  invoice: PortalInvoice | null;
  timekeepers: BillableProfessional[];
}

export const importReview = (importId: string) =>
  resource({
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

export const myPreauthorizationRequests = resource({ key: ['my-preauthorization-requests'], load: () => listPreauthorizationRequests() });

export const requestableProviders = resource({ key: ['requestable-providers'], load: listRequestableProviders });

export const preauthorizationRequest = (requestId: string) =>
  resource({ key: ['preauthorization-request', requestId], load: () => getPreauthorizationRequest(requestId) });
