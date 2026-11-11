import type { LoaderFunctionArgs, ShouldRevalidateFunction } from 'react-router';
import type { AuthenticatedUser } from './api/client';
import { queryClient } from './queryClient';
import { resourceQuery, type Resource } from './hooks/useCachedResource';
import * as resources from './resources';

// Past this, a slow load shows the new page with its own loading state instead of holding the old one.
const MAX_WAIT_MS = 2_000;

// A new router's first page has no page to hold, so it shows at once and loads there.
let firstLoad = true;
export function nextLoadIsFirst() {
  firstLoad = true;
}

// Holds the old page until data loads; current cached lists skip that, `current` and `fresh` always refetch.
export function preload(list: (args: LoaderFunctionArgs) => Resource<unknown>[], { current = false, searchParams = [] as string[] } = {}) {
  const loader = async (args: LoaderFunctionArgs) => {
    const loads = list(args).map((resource) =>
      current || resource.fresh
        ? queryClient.fetchQuery({ ...resourceQuery(resource), staleTime: 0 }).catch(() => undefined)
        : (queryClient.getQueryState(resource.key)?.isInvalidated ?? true)
          ? queryClient.prefetchQuery(resourceQuery(resource))
          : undefined,
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

const current = { current: true };
const param = (args: LoaderFunctionArgs, name: string) => args.params[name] as string;

export function staffLoaders(user: () => AuthenticatedUser | null) {
  return {
    toReview: preload(() => [resources.reviewQueue('open'), resources.invoiceIntake, resources.counties]),
    finished: preload(() => [resources.reviewQueue('all'), resources.counties]),
    exports: preload(() => [resources.reviewQueue('finished'), resources.counties]),
    review: preload(({ params }) => [resources.invoiceForReview(params.invoiceId as string), resources.decisionReasons]),
    overview: preload(() => [resources.cases, resources.recentCaseChanges]),
    cases: preload(() => [resources.cases, resources.counties]),
    people: preload(() => [resources.people]),
    clients: preload(() => [resources.cases]),
    organizations: preload(() => [resources.referenceData, resources.cases]),
    preauthorizations: preload(({ request }) => {
      const params = new URL(request.url).searchParams;
      if (params.get('view') === 'county') return [resources.preauthorizationUsage(resources.thisYear())];
      return [
        resources.preauthorizationRequests({
          status: params.get('status') ?? 'open',
          countyId: params.get('countyId') ?? undefined,
          caseId: params.get('caseId') ?? undefined,
        }),
      ];
    }, { searchParams: ['view'] }),
    settings: preload(() => [
      resources.professionalKinds,
      resources.reviewSettings,
      resources.reviewPeople,
      resources.decisionReasonSettings,
      resources.mileageRates,
      resources.timeCategoryRates,
      resources.thresholdSettings,
      resources.billingRuleSettings,
      ...(user()?.isAdmin ? [resources.staffRoles] : []),
      ...(user()?.demoMode ? [resources.ownDemoRole] : []),
    ], current),
    caseDetail: preload((args) => [resources.caseDetail(param(args, 'caseId')), resources.caseInvoices(param(args, 'caseId'))], current),
    person: preload((args) => {
      const day = new URL(args.request.url).searchParams.get('day') ?? '';
      const professionalId = param(args, 'professionalId');
      return [resources.person(professionalId), resources.personInvoices(professionalId, /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined)];
    }, current),
    preauthorizationRequest: preload((args) => [resources.preauthorizationRequest(param(args, 'requestId'))], current),
    ...sharedLoaders,
  };
}

// Pages in both the staff app and the portal.
const sharedLoaders = {
  intake: preload(() => [resources.invoiceIntake, resources.myInvoices], current),
  newCase: preload(() => [resources.referenceData], current),
  uploadByPerson: preload(() => [resources.billableProfessionals(null)], current),
  uploadByCase: preload(() => [resources.uploadCases, resources.billableProfessionals(null)], current),
  invoice: preload((args) => [resources.myInvoice(param(args, 'invoiceId')), resources.myCases], current),
  invoiceDetail: preload((args) => [resources.myInvoice(param(args, 'invoiceId'))], current),
  imports: preload(() => [resources.myCases, resources.invoiceImports], current),
  importReview: preload((args) => [resources.importReview(param(args, 'importId'))], current),
};

export const portalLoaders = {
  ...sharedLoaders,
  invoices: preload(() => [resources.myInvoices], current),
  cases: preload(() => [resources.myCases], current),
  caseDetail: preload((args) => {
    const caseId = param(args, 'caseId');
    return [resources.myCases, resources.myCaseInvoices(caseId), resources.billableProfessionals(caseId), resources.myTimeEntries(caseId)];
  }, current),
  preauthorizations: preload(() => [resources.myPreauthorizationRequests], current),
  preauthorizationRequest: preload((args) => [resources.preauthorizationRequest(param(args, 'requestId'))], current),
};
