import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createBrowserRouter, Link, Navigate, NavLink, Outlet, RouterProvider, useLocation, useNavigate, useNavigation, type RouteObject } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './AuthContext';
import { MERGE_PEOPLE_PATH, searchPath } from './staffPaths';
import { RETIRED_INTAKE_PATH, NEW_INVOICE_PATH, STAFF_UPLOAD_PATH, UPLOAD_PATH } from './portal/useShell';
import { EXTERNAL_SYSTEM_NAME } from './externalSystem';
import { Notice } from './components/ui/Notice';
import { buttonClass } from './components/ui/Button';
import { Tag } from './components/ui/Tag';
import { AppBrand, PRODUCT_NAME } from './components/AppBrand';
import { queryClient, refreshCacheOnDataChange } from './queryClient';
import { nextLoadIsFirst, portalLoaders, staffLoaders } from './routeLoaders';
import { useResource } from './hooks/useResource';
import { caseCounts, queueCounts } from './resources';
import { portalRoutes } from './portal/ExternalPortalApp';
import { page, pageWith } from './lazyPage';
import type { AuthenticatedUser } from './api/client';
import { ScrollRestorationPerSignIn } from './components/ScrollRestorationPerSignIn';
import { TourProvider } from './tour/TourContext';
import { TourChrome } from './tour/GuidePanel';

// The landing page files invoices by who sent them; the earlier queue, led
// by case and client, stays here.
const ALTERNATE_HOME_PATH = '/home-alternate';

// Only in StaffShell; the signed-out screen is LoginPage's.
function TopBar({ displayName, onLogout }: { displayName: string; onLogout: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  function search(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (q) {
      navigate(searchPath(q));
    }
  }

  return (
    <>
      <a className="usa-skipnav" href="#main-content">Skip to main content</a>
      <header className="app-header">
        <AppBrand to="/" section={PRODUCT_NAME}>
          <Tag tone="info">Works beside your {EXTERNAL_SYSTEM_NAME}</Tag>
        </AppBrand>
        <form className="header-search" role="search" onSubmit={search}>
          <label className="usa-sr-only" htmlFor="header-search-input">Search invoices</label>
          <input
            id="header-search-input"
            type="search"
            placeholder="Search by name or case number"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </form>
        <div className="header-actions">
          <span className="user-name">{displayName}</span>
          <button type="button" className="link-button" onClick={onLogout}>Sign out</button>
        </div>
      </header>
    </>
  );
}

function useQueueCounts() {
  const { data: queue } = useResource(queueCounts);
  const { data: cases } = useResource(caseCounts);
  return useMemo(() => (queue ? { ...queue, openCases: cases?.open ?? null } : null), [queue, cases]);
}

function Sidebar({ showSettings }: { showSettings: boolean }) {
  const location = useLocation();
  const counts = useQueueCounts();
  const onQueue = location.pathname === '/';
  const show = new URLSearchParams(location.search).get('show');
  const mineActive = onQueue && show === 'mine';
  const allActive = onQueue && !mineActive;

  return (
    <aside className="app-sidebar">
      <nav aria-label="Main navigation">
        <div className="nav-group">
          <NavLink
            to={STAFF_UPLOAD_PATH}
            end
            className={buttonClass('primary')}
            title="Upload invoices received by email or from other tools"
          >
            <span aria-hidden="true">+</span> Upload invoices
          </NavLink>
        </div>
        {/* Case overview, Intake, other person records and /home-alternate still work by address. */}
        <div className="nav-group">
          <h2>Invoices</h2>
          <NavLink to="/invoice-overview" end>Invoice overview</NavLink>
          <Link to="/" className={allActive ? 'active' : undefined}>
            To review{counts && <span className="nav-count">{counts.all}</span>}
          </Link>
          <Link to="/?show=mine" className={mineActive ? 'active' : undefined}>
            Assigned to you{counts && <span className="nav-count">{counts.mine}</span>}
          </Link>
          <NavLink to="/finished" end>Finished</NavLink>
        </div>
        <div className="nav-group">
          <h2>Look up</h2>
          <NavLink to="/preauthorizations">Pre-authorizations</NavLink>
          <NavLink to="/cases" end>
            All cases{counts?.openCases != null && <span className="nav-count">{counts.openCases}</span>}
          </NavLink>
          {/* Everyone who bills (design K30); /vendors still works by address until Settings has providers. */}
          <NavLink to="/people">Providers</NavLink>
          <NavLink to="/clients" end>Clients</NavLink>
          <NavLink to="/organizations" end>Organizations</NavLink>
          <NavLink to="/exports" end>Exports</NavLink>
        </div>
        <div className="nav-group">
          <h2>Your {EXTERNAL_SYSTEM_NAME}</h2>
          <button type="button" disabled title="Not connected yet">Open in a new tab <span aria-hidden="true">↗</span></button>
        </div>
        {showSettings && (
          <div className="nav-group">
            <h2>Administration</h2>
            <NavLink to="/settings" end>Settings</NavLink>
          </div>
        )}
      </nav>
    </aside>
  );
}

// Old staff /new-invoice links, ?case= included, open Intake.
// Possible duplicates were once their own page; they are now tabs of People and All cases.
function PossibleDuplicatesRedirect() {
  const params = new URLSearchParams(useLocation().search);
  const cases = params.get('show') === 'cases';
  params.delete('show');
  params.set('tab', 'duplicates');
  return <Navigate to={`${cases ? '/cases' : '/people'}?${params.toString()}`} replace />;
}

function OldMergeRedirect() {
  const { search } = useLocation();
  return <Navigate to={`${MERGE_PEOPLE_PATH}${search}`} replace />;
}


function StaffShell() {
  const { user, logout } = useAuth();
  const loadingPage = useNavigation().state === 'loading';
  if (!user) return null;
  return (
    <>
      <TopBar displayName={user.displayName} onLogout={() => void logout()} />
      <div className="app-layout">
        {/* Everyone has Settings on demo servers, to change their own role there. */}
        <Sidebar showSettings={Boolean(user.isAdmin || user.demoMode)} />
        <ScrollRestorationPerSignIn />
        <main id="main-content" className="app-main" tabIndex={-1} aria-busy={loadingPage}>
          {loadingPage && <div className="page-loading" aria-hidden="true" />}
          <Outlet />
        </main>
      </div>
      <TourChrome app="staff" />
    </>
  );
}

// Keeps the sidebar and top bar when a page fails to render.
function PageError() {
  return <Notice tone="danger">Something went wrong showing this page. Please refresh to try again.</Notice>;
}

function staffRoutes(user: () => AuthenticatedUser | null): RouteObject[] {
  const loaders = staffLoaders(user);
  return [
    {
      element: <StaffShell />,
      // Shown for the moment before a new router's first page.
      HydrateFallback: () => null,
      children: [
        {
          errorElement: <PageError />,
          children: [
            { path: '/', ...page(() => import('./pages/InvoicesToReview')), ...loaders.toReview },
            { path: ALTERNATE_HOME_PATH, ...pageWith(() => import('./pages/ReviewQueue'), { view: 'open' }), ...loaders.alternateOpen },
            { path: `${ALTERNATE_HOME_PATH}/finished`, ...pageWith(() => import('./pages/ReviewQueue'), { view: 'finished' }), ...loaders.alternateFinished },
            { path: '/finished', ...page(() => import('./pages/FinishedInvoices')), ...loaders.finished },
            { path: '/search', ...page(() => import('./pages/SearchResults')), ...loaders.search },
            { path: '/people', ...page(() => import('./pages/People')), ...loaders.people },
            { path: MERGE_PEOPLE_PATH, ...page(() => import('./pages/MergePeople')), ...loaders.mergePeople },
            { path: '/people/:professionalId', ...page(() => import('./pages/PersonPage')), ...loaders.person },
            { path: '/billing/:invoiceId', ...page(() => import('./pages/InvoiceReview')), ...loaders.review },
            { path: '/exports', ...page(() => import('./pages/Exports')), ...loaders.exports },
            // The upload and the portal invoice and import pages it links to, in the staff shell.
            {
              element: <div className="portal-main"><Outlet /></div>,
              children: [
                { path: STAFF_UPLOAD_PATH, ...page(() => import('./pages/UploadInvoices')), ...loaders.uploadByPerson },
                { path: '/invoices/:invoiceId/check', ...pageWith(() => import('./portal/InvoiceSubmission'), { byPerson: true }), ...loaders.invoiceDetail },
                { path: '/portal/invoices/:invoiceId', ...page(() => import('./portal/PortalInvoiceDetail')), ...loaders.invoiceDetail },
                { path: '/portal/imports', ...page(() => import('./portal/PortalBulkImport')), ...loaders.imports },
                { path: '/portal/imports/:importId', ...page(() => import('./portal/PortalImportReview')), ...loaders.importReview },
              ],
            },
            // Retired with the case-based form and upload: cases are added through invoices.
            { path: RETIRED_INTAKE_PATH, element: <Navigate to="/" replace /> },
            { path: NEW_INVOICE_PATH, element: <Navigate to={STAFF_UPLOAD_PATH} replace /> },
            { path: UPLOAD_PATH, element: <Navigate to={STAFF_UPLOAD_PATH} replace /> },
            { path: '/cases/new', element: <Navigate to="/cases" replace /> },
            { path: '/cases', ...page(() => import('./pages/CaseList')), ...loaders.cases },
            { path: '/cases/:caseId', ...page(() => import('./pages/CaseDetail')), ...loaders.caseDetail },
            // Providers are changed in Settings (design K51).
            { path: '/vendors', element: <Navigate to="/settings#settings-providers" replace /> },
            { path: '/preauthorizations', ...page(() => import('./pages/Preauthorizations')), ...loaders.preauthorizations },
            { path: '/preauthorizations/:requestId', lazy: async () => ({ Component: (await import('./pages/Preauthorizations')).StaffPreauthorizationRequest }), ...loaders.preauthorizationRequest },
            { path: '/settings', ...page(() => import('./pages/Settings')), ...loaders.settings },
            { path: '/overview', ...page(() => import('./pages/Overview')), ...loaders.overview },
            { path: '/invoice-overview', ...page(() => import('./pages/InvoiceOverview')), ...loaders.invoiceOverview },
            { path: '/possible-duplicates', element: <PossibleDuplicatesRedirect /> },
            { path: '/possible-duplicates/merge', element: <OldMergeRedirect /> },
            { path: '/person-records', ...page(() => import('./pages/PeopleDirectory')), ...loaders.personRecords },
            { path: '/clients', ...page(() => import('./pages/ClientsDirectory')), ...loaders.clients },
            { path: '/organizations', ...page(() => import('./pages/OrganizationsDirectory')), ...loaders.organizations },
            { path: '*', element: <><h1>Page not found</h1><Link to="/">Back to your invoices</Link></> },
          ],
        },
      ],
    },
  ];
}

const routesFor: Record<Audience, () => RouteObject[]> = {
  'signed-out': () => [
    {
      HydrateFallback: () => null,
      errorElement: <PageError />,
      children: [
        { path: '/submit', ...page(() => import('./portal/PortalSignIn')) },
        { path: '*', ...page(() => import('./pages/LoginPage')) },
      ],
    },
  ],
  portal: () => portalRoutes(portalLoaders),
  staff: () => staffRoutes(() => signedInUser),
};

type Audience = 'signed-out' | 'portal' | 'staff';

// For loaders, which run outside React.
let signedInUser: AuthenticatedUser | null = null;

// One router at a time, rebuilt at each sign-in: a staff-to-staff switch (the
// guided tour's) must not keep the last user's page under the home address.
let current: { key: string; router: ReturnType<typeof createBrowserRouter> } | null = null;
function routerFor(audience: Audience, signIns: number) {
  const key = `${audience}:${signIns}`;
  if (current?.key !== key) {
    current?.router.dispose();
    nextLoadIsFirst();
    current = { key, router: createBrowserRouter(routesFor[audience]()) };
  }
  return current.router;
}

// While signing in is checked, render nothing rather than flash the login screen.
function AppRouter() {
  const { user, loading, signIns } = useAuth();
  signedInUser = user;
  if (loading) return null;
  const audience: Audience = !user ? 'signed-out' : user.authType === 'email-code' ? 'portal' : 'staff';
  const router = routerFor(audience, signIns);
  // Keyed: RouterProvider keeps its first router's state, so a new router needs a new mount.
  return <RouterProvider key={current!.key} router={router} />;
}

export default function App() {
  useEffect(() => refreshCacheOnDataChange(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TourProvider>
          <AppRouter />
        </TourProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
