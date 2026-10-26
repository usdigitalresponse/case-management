import { useEffect, useState, type FormEvent } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { AuthProvider, useAuth } from './AuthContext';
import LoginPage from './pages/LoginPage';
import MagicLinkConfirm from './pages/MagicLinkConfirm';
import CaseList from './pages/CaseList';
import CaseDetail from './pages/CaseDetail';
import NewCaseIntake from './pages/NewCaseIntake';
import Overview from './pages/Overview';
import ReviewQueue from './pages/ReviewQueue';
import InvoiceReview from './pages/InvoiceReview';
import Exports from './pages/Exports';
import InvoiceIntake from './pages/InvoiceIntake';
import PeopleDirectory from './pages/PeopleDirectory';
import ClientsDirectory from './pages/ClientsDirectory';
import VendorsDirectory from './pages/VendorsDirectory';
import OrganizationsDirectory from './pages/OrganizationsDirectory';
import Settings from './pages/Settings';
import ExternalPortalApp from './portal/ExternalPortalApp';
import PortalInvoiceDetail from './portal/PortalInvoiceDetail';
import PortalBulkImport from './portal/PortalBulkImport';
import PortalImportReview from './portal/PortalImportReview';
import { INTAKE_PATH, NEW_INVOICE_PATH } from './portal/useShell';
import { listInvoiceIntake, listReviewQueue } from './api/client';
import { EXTERNAL_SYSTEM_NAME } from './externalSystem';

// Only rendered for a signed-in staff user (see AppContent) — the signed-out screen is LoginPage's alone.
function TopBar({ displayName, onLogout }: { displayName: string; onLogout: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  function search(event: FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams({ show: 'everyone' });
    const q = query.trim();
    if (q) {
      params.set('q', q);
    }
    navigate(`/?${params.toString()}`);
  }

  return (
    <>
      <a className="usa-skipnav" href="#main-content">Skip to main content</a>
      <header className="app-header">
        <Link className="app-brand" to="/">Invoice Review Prototype</Link>
        <span className="chip chip--neutral">Works beside your {EXTERNAL_SYSTEM_NAME}</span>
        <form className="header-search" role="search" onSubmit={search}>
          <label className="usa-sr-only" htmlFor="header-search-input">Search invoices</label>
          <input
            id="header-search-input"
            type="search"
            placeholder="Search by case number, client, or attorney"
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

// Counts for the sidebar, refreshed as the reviewer moves around.
function useQueueCounts(userAccountId: string) {
  const location = useLocation();
  const [counts, setCounts] = useState<{ all: number; mine: number; waiting: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Intake is for staff roles only; without one there is nothing waiting to count.
    Promise.all([listReviewQueue('open'), listInvoiceIntake().catch(() => ({ items: [] }))]).then(
      ([{ invoices }, { items }]) => {
        if (!cancelled) {
          setCounts({
            all: invoices.length,
            mine: invoices.filter((invoice) => invoice.holder?.userAccountId === userAccountId).length,
            waiting: items.length,
          });
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [location.pathname, userAccountId]);
  return counts;
}

function Sidebar({ isAdmin, userAccountId }: { isAdmin: boolean; userAccountId: string }) {
  const location = useLocation();
  const counts = useQueueCounts(userAccountId);
  const onQueue = location.pathname === '/';
  const show = new URLSearchParams(location.search).get('show');
  // "/" with no filter is the reviewer's own work.
  const mineActive = onQueue && (!show || show === 'mine');
  const allActive = onQueue && !mineActive;

  return (
    <aside className="app-sidebar">
      <nav aria-label="Main navigation">
        <div className="nav-group">
          <NavLink to={INTAKE_PATH} end className="nav-primary" title="Enter invoices and match them to cases">
            <span><span aria-hidden="true">+ </span>Intake</span>
            {counts && counts.waiting > 0 && (
              <span className="nav-count" title="Waiting for a case">
                {counts.waiting}
                <span className="usa-sr-only"> waiting for a case</span>
              </span>
            )}
          </NavLink>
        </div>
        <div className="nav-group">
          <h2>Invoices</h2>
          <Link to="/?show=everyone" className={allActive ? 'active' : undefined}>
            To review{counts && <span className="nav-count">{counts.all}</span>}
          </Link>
          <Link to="/" className={mineActive ? 'active' : undefined}>
            Assigned to you{counts && <span className="nav-count">{counts.mine}</span>}
          </Link>
          <NavLink to="/finished" end>Finished</NavLink>
        </div>
        <div className="nav-group">
          <h2>Look something up</h2>
          <NavLink to="/cases">Cases</NavLink>
          <NavLink to="/vendors" end>Attorneys and vendors</NavLink>
          <NavLink to="/exports" end>Exports</NavLink>
        </div>
        {isAdmin && (
          <div className="nav-group">
            <h2>Administration</h2>
            <NavLink to="/settings" end>Settings</NavLink>
          </div>
        )}
        <div className="nav-group">
          <h2>In your {EXTERNAL_SYSTEM_NAME}</h2>
          <button type="button" disabled title="Not connected yet">Open it <span aria-hidden="true">↗</span></button>
        </div>
      </nav>
    </aside>
  );
}

// Old staff /new-invoice links, ?case= included, open Intake.
function NewInvoiceRedirect() {
  const { search } = useLocation();
  return <Navigate to={`${INTAKE_PATH}${search}`} replace />;
}

// Order matters: loading (render nothing, don't flash the login screen),
// signed out (LoginPage, or the emailed link's confirm page), magic-link
// (narrow portal shell), else staff layout.
function AppContent() {
  const { user, loading, logout } = useAuth();
  if (loading) {
    return null;
  }
  if (!user) {
    return (
      <Routes>
        <Route path="/sign-in/verify" element={<MagicLinkConfirm />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  if (user.authType === 'magic-link') {
    return <ExternalPortalApp />;
  }
  return (
    <>
      <TopBar displayName={user.displayName} onLogout={() => void logout()} />
      <div className="app-layout">
        <Sidebar isAdmin={Boolean(user.isAdmin)} userAccountId={user.userAccountId} />
        <main id="main-content" className="app-main" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<ReviewQueue view="open" />} />
            <Route path="/finished" element={<ReviewQueue view="finished" />} />
            <Route path="/billing/:invoiceId" element={<InvoiceReview />} />
            <Route path="/exports" element={<Exports />} />
            {/* Intake and the portal invoice and import pages it links to, in the staff shell. */}
            <Route element={<div className="portal-main"><Outlet /></div>}>
              <Route path={INTAKE_PATH} element={<InvoiceIntake />} />
              <Route path="/portal/invoices/:invoiceId" element={<PortalInvoiceDetail />} />
              <Route path="/portal/imports" element={<PortalBulkImport />} />
              <Route path="/portal/imports/:importId" element={<PortalImportReview />} />
            </Route>
            <Route path={NEW_INVOICE_PATH} element={<NewInvoiceRedirect />} />
            <Route path="/cases" element={<CaseList />} />
            <Route path="/cases/new" element={<NewCaseIntake />} />
            <Route path="/cases/:caseId" element={<CaseDetail />} />
            <Route path="/vendors" element={<VendorsDirectory />} />
            <Route path="/settings" element={<Settings isAdmin={Boolean(user.isAdmin)} />} />
            {/* Hidden from the sidebar while cases are managed elsewhere; still reachable. */}
            <Route path="/overview" element={<Overview />} />
            <Route path="/people" element={<PeopleDirectory />} />
            <Route path="/clients" element={<ClientsDirectory />} />
            <Route path="/organizations" element={<OrganizationsDirectory />} />
            <Route path="*" element={<><h1>Page not found</h1><Link to="/">Back to your invoices</Link></>} />
          </Routes>
        </main>
      </div>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </AuthProvider>
  );
}
