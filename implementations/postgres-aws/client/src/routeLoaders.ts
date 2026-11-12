import type { LoaderFunctionArgs, ShouldRevalidateFunction } from 'react-router';
import type { AuthenticatedUser } from './api/client';
import { queryClient } from './queryClient';
import { resourceQuery, type Resource } from './hooks/useResource';
import { batchedQuery, type BatchedResource } from './hooks/useBatchedResource';
import * as resources from './resources';
import { caseListRequest, clientsRequest, peopleRequest, preauthorizationRequestsRequest } from './caseRequests';
import { alternateRequest, exportsRequest, finishedRequest, personRequest, searchRequest, toReviewRequest } from './queueRequests';

// Past this, a slow load shows the new page with its own loading state instead of holding the old one.
const MAX_WAIT_MS = 2_000;

// A new router's first page has no page to hold, so it shows at once and loads there.
let firstLoad = true;
export function nextLoadIsFirst() {
  firstLoad = true;
}

// Holds the old page until data loads; current cached lists skip that, `fresh` resources always refetch.
type Preloaded = Resource<unknown> | BatchedResource<unknown, unknown>;

// A batched list's first batch.
function load(resource: Preloaded, fresh: boolean) {
  if ('batched' in resource) {
    return fresh
      ? queryClient.fetchInfiniteQuery({ ...batchedQuery(resource), staleTime: 0 }).catch(() => undefined)
      : queryClient.prefetchInfiniteQuery(batchedQuery(resource));
  }
  return fresh ? queryClient.fetchQuery({ ...resourceQuery(resource), staleTime: 0 }).catch(() => undefined) : queryClient.prefetchQuery(resourceQuery(resource));
}

export function preload(list: (args: LoaderFunctionArgs) => Preloaded[], { searchParams = [] as string[] } = {}) {
  const loader = async (args: LoaderFunctionArgs) => {
    const loads = list(args).map((resource) =>
      resource.fresh ? load(resource, true) : (queryClient.getQueryState(resource.key)?.isInvalidated ?? true) ? load(resource, false) : undefined,
    );
    if (firstLoad) {
      firstLoad = false;
      return null;
    }
    await Promise.race([Promise.all(loads), new Promise((resolve) => setTimeout(resolve, MAX_WAIT_MS))]);
    return null;
  };
  // Other query-string changes are the page's own filters.
  const shouldRevalidate: ShouldRevalidateFunction = ({ currentUrl, nextUrl, defaultShouldRevalidate }) =>
    defaultShouldRevalidate &&
    (currentUrl.pathname !== nextUrl.pathname ||
      searchParams.some((name) => currentUrl.searchParams.get(name) !== nextUrl.searchParams.get(name)));
  return { loader, shouldRevalidate };
}

const param = (args: LoaderFunctionArgs, name: string) => args.params[name] as string;
const searchOf = (args: LoaderFunctionArgs) => new URL(args.request.url).searchParams;
const searched = (args: LoaderFunctionArgs) => searchOf(args).get('q')?.trim() ?? '';

export function staffLoaders(user: () => AuthenticatedUser | null) {
  return {
    toReview: preload((args) => [resources.reviewQueue(toReviewRequest(searchOf(args))), resources.invoiceIntake, resources.counties]),
    finished: preload((args) => [resources.reviewQueue(finishedRequest(searchOf(args))), resources.counties]),
    exports: preload((args) => [resources.reviewQueue(exportsRequest(searchOf(args))), resources.counties]),
    review: preload(({ params }) => [resources.invoiceForReview(params.invoiceId as string), resources.decisionReasons]),
    overview: preload(() => [resources.caseOverview, resources.recentCaseChanges]),
    cases: preload((args) =>
      searchOf(args).get('tab') === 'duplicates'
        ? [resources.possibleDuplicateCases]
        : [resources.cases(caseListRequest(searchOf(args))), resources.counties, resources.possibleDuplicateCaseCount],
    ),
    people: preload((args) =>
      searchOf(args).get('tab') === 'duplicates'
        ? [resources.possibleDuplicates, resources.personMerges]
        : [resources.people(peopleRequest(searchOf(args))), resources.possibleDuplicateCount],
    ),
    clients: preload((args) => [resources.cases(clientsRequest(searchOf(args)))]),
    organizations: preload(() => [resources.referenceData, resources.caseCounts]),
    preauthorizations: preload(({ request }) => {
      const params = new URL(request.url).searchParams;
      if (params.get('view') === 'county') return [resources.preauthorizationUsage(resources.thisYear())];
      return [resources.preauthorizationRequests(preauthorizationRequestsRequest(params).filter)];
    }, { searchParams: ['view'] }),
    alternateOpen: preload((args) => [resources.reviewQueue(alternateRequest('open', searchOf(args))), resources.counties]),
    alternateFinished: preload((args) => [resources.reviewQueue(alternateRequest('finished', searchOf(args))), resources.counties]),
    search: preload((args) => (searched(args) ? [resources.reviewQueue(searchRequest(searchOf(args))), resources.counties] : []), { searchParams: ['q'] }),
    providers: preload((args) => [resources.providerList(searched(args))], { searchParams: ['q'] }),
    mergePeople: preload(
      ({ request }) => {
        const params = new URL(request.url).searchParams;
        const keep = params.get('keep');
        const retire = params.get('retire');
        return keep && retire ? [resources.mergePreview(keep, retire.split(','))] : [];
      },
      { searchParams: ['keep', 'retire'] },
    ),
    personRecords: preload((args) => (searched(args) ? [resources.personRecords(searched(args))] : []), { searchParams: ['q'] }),
    settings: preload((args) => [
      resources.externalUsers(searchOf(args).get('externalQ') ?? ''),
      resources.professionalKinds,
      resources.reviewSettings,
      resources.reviewPeople,
      resources.decisionReasonSettings,
      resources.mileageRates,
      resources.timeCategoryRates,
      resources.thresholdSettings,
      resources.billingRuleSettings,
      ...(user()?.isAdmin ? [resources.staffRoles, resources.delegateOffices] : []),
      ...(user()?.demoMode ? [resources.ownDemoRole] : []),
    ], { searchParams: ['externalQ'] }),
    caseDetail: preload((args) => [resources.caseDetail(param(args, 'caseId')), resources.caseInvoices(param(args, 'caseId')), resources.caseInvoiceList(param(args, 'caseId'))]),
    person: preload((args) => {
      const professionalId = param(args, 'professionalId');
      return [resources.person(professionalId), resources.personInvoices(personRequest(professionalId, searchOf(args)))];
    }),
    preauthorizationRequest: preload((args) => [resources.preauthorizationRequest(param(args, 'requestId'))]),
    ...sharedLoaders,
  };
}

// Pages in both the staff app and the portal.
const sharedLoaders = {
  intake: preload(() => [resources.invoiceIntake, resources.myInvoices({ show: 'case_drafts' })]),
  newCase: preload(() => [resources.referenceData]),
  uploadByPerson: preload(() => [resources.billableProfessionals(null)]),
  uploadByCase: preload(() => [resources.uploadCases, resources.billableProfessionals(null)]),
  invoice: preload((args) => [resources.myInvoice(param(args, 'invoiceId')), resources.myCases]),
  invoiceDetail: preload((args) => [resources.myInvoice(param(args, 'invoiceId'))]),
  imports: preload(() => [resources.myCases, resources.invoiceImports]),
  importReview: preload((args) => [resources.importReview(param(args, 'importId'))]),
};

export const portalLoaders = {
  ...sharedLoaders,
  invoices: preload(() => [resources.myInvoices()]),
  cases: preload(() => [resources.myCases]),
  caseDetail: preload((args) => {
    const caseId = param(args, 'caseId');
    return [resources.myCases, resources.myCaseInvoices(caseId, false), resources.billableProfessionals(caseId), resources.myTimeEntries(caseId)];
  }),
  preauthorizations: preload(() => [resources.myPreauthorizationRequests]),
  preauthorizationRequest: preload((args) => [resources.preauthorizationRequest(param(args, 'requestId'))]),
  newInvoice: preload(() => [resources.myCases]),
};
