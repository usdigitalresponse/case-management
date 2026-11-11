import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createBrowserRouter, Link, Navigate, NavLink, Outlet, RouterProvider, ScrollRestoration, useLocation, useNavigate, useNavigation, type RouteObject } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './AuthContext';
import { searchPath } from './staffPaths';
import { INTAKE_PATH, NEW_INVOICE_PATH, UPLOAD_PATH } from './portal/useShell';
import { EXTERNAL_SYSTEM_NAME } from './externalSystem';
import { Notice } from './components/ui/Notice';
import { buttonClass } from './components/ui/Button';
import { queryClient, refreshCacheOnDataChange } from './queryClient';
import { nextLoadIsFirst, portalLoaders, staffLoaders } from './routeLoaders';
import { useResource } from './hooks/useResource';
import { cases as casesResource, reviewQueue } from './resources';
import { portalRoutes } from './portal/ExternalPortalApp';
import { page, pageWith } from './lazyPage';
import type { AuthenticatedUser } from './api/client';

// The landing page files invoices by who sent them; the earlier queue, led
// by case and client, stays here.
const ALTERNATE_HOME_PATH = '/home-alternate';
const STAFF_UPLOAD_PATH = '/upload';

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
        <div className="app-brand-block">
          <Link className="app-brand" to="/">Invoice Review Prototype</Link>
          <span className="header-badge">Works beside your {EXTERNAL_SYSTEM_NAME}</span>
        </div>
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

function useQueueCounts(userAccountId: string) {
  const { data: queue } = useResource(reviewQueue('open'));
  const { data: caseList, error: casesError } = useResource(casesResource);
  return useMemo(() => {
    if (!queue) return null;
    return {
      all: queue.invoices.length,
      mine: queue.invoices.filter((invoice) => invoice.holder?.userAccountId === userAccountId).length,
      openCases: caseList && !casesError ? caseList.cases.filter((row) => !row.closedOn).length : null,
    };
  }, [queue, caseList, casesError, userAccountId]);
}

function Sidebar({ showSettings, userAccountId }: { showSettings: boolean; userAccountId: string }) {
  const location = useLocation();
  const counts = useQueueCounts(userAccountId);
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
        {/* Intake, other person records and /home-alternate still work by address. */}
        <div className="nav-group">
          <h2>Invoices</h2>
          <Link to="/" className={allActive ? 'active' : undefined}>
            To review{counts && <span className="nav-count">{counts.all}</span>}
          </Link>
          <Link to="/?show=mine" className={mineActive ? 'active' : undefined}>
            Assigned to you{counts && <span className="nav-count">{counts.mine}</span>}
          </Link>
          <NavLink to="/finished" end>Finished</NavLink>
        </div>
        <div className="nav-group">
          <h2>Cases</h2>
          <NavLink to="/overview" end>Case overview</NavLink>
          <NavLink to="/cases" end>
            All cases{counts?.openCases != null && <span className="nav-count">{counts.openCases}</span>}
          </NavLink>
          <NavLink to="/preauthorizations">Pre-authorizations</NavLink>
        </div>
        <div className="nav-group">
          <h2>Look something up</h2>
          <NavLink to="/people">People</NavLink>
          <NavLink to="/vendors" end>Providers</NavLink>
          <NavLink to="/clients" end>Clients</NavLink>
          <NavLink to="/organizations" end>Organizations</NavLink>
          <NavLink to="/exports" end>Exports</NavLink>
        </div>
        <div className="nav-group">
          <h2>In your {EXTERNAL_SYSTEM_NAME}</h2>
          <button type="button" disabled title="Not connected yet">Open it <span aria-hidden="true">↗</span></button>
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
function NewInvoiceRedirect() {
  const { search } = useLocation();
  return <Navigate to={`${INTAKE_PATH}${search}`} replace />;
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
        <Sidebar showSettings={Boolean(user.isAdmin || user.demoMode)} userAccountId={user.userAccountId} />
        <ScrollRestoration />
        <main id="main-content" className="app-main" tabIndex={-1} aria-busy={loadingPage}>
          {loadingPage && <div className="page-loading" aria-hidden="true" />}
          <Outlet />
        </main>
      </div>
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
            { path: '/people/:professionalId', ...page(() => import('./pages/PersonPage')), ...loaders.person },
            { path: '/billing/:invoiceId', ...page(() => import('./pages/InvoiceReview')), ...loaders.review },
            { path: '/exports', ...page(() => import('./pages/Exports')), ...loaders.exports },
            // Intake and the portal invoice and import pages it links to, in the staff shell.
            {
              element: <div className="portal-main"><Outlet /></div>,
              children: [
                { path: INTAKE_PATH, ...page(() => import('./pages/InvoiceIntake')), ...loaders.intake },
                { path: UPLOAD_PATH, ...page(() => import('./portal/PortalUpload')), ...loaders.uploadByCase },
                { path: STAFF_UPLOAD_PATH, ...page(() => import('./pages/UploadInvoices')), ...loaders.uploadByPerson },
                { path: '/invoices/:invoiceId/check', ...pageWith(() => import('./portal/InvoiceSubmission'), { byPerson: true }), ...loaders.invoiceDetail },
                { path: '/portal/invoices/:invoiceId', ...page(() => import('./portal/PortalInvoiceDetail')), ...loaders.invoiceDetail },
                { path: '/portal/imports', ...page(() => import('./portal/PortalBulkImport')), ...loaders.imports },
                { path: '/portal/imports/:importId', ...page(() => import('./portal/PortalImportReview')), ...loaders.importReview },
              ],
            },
            { path: NEW_INVOICE_PATH, element: <NewInvoiceRedirect /> },
            { path: '/cases', ...page(() => import('./pages/CaseList')), ...loaders.cases },
            { path: '/cases/new', ...page(() => import('./pages/NewCaseIntake')), ...loaders.newCase },
            { path: '/cases/:caseId', ...page(() => import('./pages/CaseDetail')), ...loaders.caseDetail },
            { path: '/vendors', ...page(() => import('./pages/VendorsDirectory')), ...loaders.providers },
            { path: '/preauthorizations', ...page(() => import('./pages/Preauthorizations')), ...loaders.preauthorizations },
            { path: '/preauthorizations/:requestId', lazy: async () => ({ Component: (await import('./pages/Preauthorizations')).StaffPreauthorizationRequest }), ...loaders.preauthorizationRequest },
            { path: '/settings', ...page(() => import('./pages/Settings')), ...loaders.settings },
            { path: '/overview', ...page(() => import('./pages/Overview')), ...loaders.overview },
            // Off the sidebar; still reachable.
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

// One router at a time, rebuilt when a different kind of user signs in.
let current: { audience: Audience; router: ReturnType<typeof createBrowserRouter> } | null = null;
function routerFor(audience: Audience) {
  if (current?.audience !== audience) {
    current?.router.dispose();
    nextLoadIsFirst();
    current = { audience, router: createBrowserRouter(routesFor[audience]()) };
  }
  return current.router;
}

// While signing in is checked, render nothing rather than flash the login screen.
function AppRouter() {
  const { user, loading } = useAuth();
  signedInUser = user;
  if (loading) return null;
  const audience: Audience = !user ? 'signed-out' : user.authType === 'email-code' ? 'portal' : 'staff';
  return <RouterProvider router={routerFor(audience)} />;
}

export default function App() {
  useEffect(() => refreshCacheOnDataChange(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </QueryClientProvider>
  );
}
