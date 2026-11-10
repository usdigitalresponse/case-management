import { useEffect, useState, type FormEvent } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { AuthProvider, useAuth } from './AuthContext';
import LoginPage from './pages/LoginPage';
import PortalSignIn from './portal/PortalSignIn';
import CaseList from './pages/CaseList';
import CaseDetail from './pages/CaseDetail';
import NewCaseIntake from './pages/NewCaseIntake';
import Overview from './pages/Overview';
import ReviewQueue from './pages/ReviewQueue';
import InvoicesToReview from './pages/InvoicesToReview';
import FinishedInvoices from './pages/FinishedInvoices';
import People from './pages/People';
import PersonPage from './pages/PersonPage';
import SearchResults from './pages/SearchResults';
import { searchPath } from './staffPaths';
import UploadInvoices from './pages/UploadInvoices';
import InvoiceSubmission from './portal/InvoiceSubmission';
import InvoiceReview from './pages/InvoiceReview';
import Exports from './pages/Exports';
import InvoiceIntake from './pages/InvoiceIntake';
import PeopleDirectory from './pages/PeopleDirectory';
import ClientsDirectory from './pages/ClientsDirectory';
import VendorsDirectory from './pages/VendorsDirectory';
import OrganizationsDirectory from './pages/OrganizationsDirectory';
import Settings from './pages/Settings';
import Preauthorizations, { StaffPreauthorizationRequest } from './pages/Preauthorizations';
import ExternalPortalApp from './portal/ExternalPortalApp';
import PortalInvoiceDetail from './portal/PortalInvoiceDetail';
import PortalBulkImport from './portal/PortalBulkImport';
import PortalImportReview from './portal/PortalImportReview';
import PortalUpload from './portal/PortalUpload';
import { INTAKE_PATH, NEW_INVOICE_PATH, UPLOAD_PATH } from './portal/useShell';
import { DATA_CHANGED_EVENT, listCases, listReviewQueue } from './api/client';
import { EXTERNAL_SYSTEM_NAME } from './externalSystem';

// The landing page files invoices by who sent them; the earlier queue, led
// by case and client, stays here.
const ALTERNATE_HOME_PATH = '/home-alternate';
const STAFF_UPLOAD_PATH = '/upload';

// Only rendered for a signed-in staff user (see AppContent) — the signed-out screen is LoginPage's alone.
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

// Counts for the sidebar, refreshed as the reviewer moves around or changes something.
function useQueueCounts(userAccountId: string) {
  const location = useLocation();
  const [counts, setCounts] = useState<{ all: number; mine: number; openCases: number | null } | null>(null);
  const [changes, setChanges] = useState(0);
  useEffect(() => {
    const onChange = () => setChanges((n) => n + 1);
    window.addEventListener(DATA_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, onChange);
  }, []);
  useEffect(() => {
    let cancelled = false;
    Promise.all([listReviewQueue('open'), listCases().catch(() => null)]).then(
      ([{ invoices }, cases]) => {
        if (!cancelled) {
          setCounts({
            all: invoices.length,
            mine: invoices.filter((invoice) => invoice.holder?.userAccountId === userAccountId).length,
            openCases: cases ? cases.cases.filter((row) => !row.closedOn).length : null,
          });
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [location.pathname, userAccountId, changes]);
  return counts;
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
          <NavLink to={STAFF_UPLOAD_PATH} end className="nav-primary" title="Upload invoices received by email or from other tools">
            <span><span aria-hidden="true">+ </span>Upload Invoices</span>
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

// Order matters: loading (render nothing, don't flash the login screen),
// signed out (LoginPage, or the portal sign-in), email-code
// (narrow portal shell), else staff layout.
function AppContent() {
  const { user, loading, logout } = useAuth();
  if (loading) {
    return null;
  }
  if (!user) {
    return (
      <Routes>
        <Route path="/submit" element={<PortalSignIn />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  if (user.authType === 'email-code') {
    return <ExternalPortalApp />;
  }
  return (
    <>
      <TopBar displayName={user.displayName} onLogout={() => void logout()} />
      <div className="app-layout">
        {/* Everyone has Settings on demo servers, to change their own role there. */}
        <Sidebar showSettings={Boolean(user.isAdmin || user.demoMode)} userAccountId={user.userAccountId} />
        <main id="main-content" className="app-main" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<InvoicesToReview />} />
            <Route path={ALTERNATE_HOME_PATH} element={<ReviewQueue view="open" />} />
            <Route path={`${ALTERNATE_HOME_PATH}/finished`} element={<ReviewQueue view="finished" />} />
            <Route path="/finished" element={<FinishedInvoices />} />
            <Route path="/search" element={<SearchResults />} />
            <Route path="/people" element={<People />} />
            <Route path="/people/:professionalId" element={<PersonPage />} />
            <Route path="/billing/:invoiceId" element={<InvoiceReview />} />
            <Route path="/exports" element={<Exports />} />
            {/* Intake and the portal invoice and import pages it links to, in the staff shell. */}
            <Route element={<div className="portal-main"><Outlet /></div>}>
              <Route path={INTAKE_PATH} element={<InvoiceIntake />} />
              <Route path={UPLOAD_PATH} element={<PortalUpload />} />
              <Route path={STAFF_UPLOAD_PATH} element={<UploadInvoices />} />
              <Route path="/invoices/:invoiceId/check" element={<InvoiceSubmission byPerson />} />
              <Route path="/portal/invoices/:invoiceId" element={<PortalInvoiceDetail />} />
              <Route path="/portal/imports" element={<PortalBulkImport />} />
              <Route path="/portal/imports/:importId" element={<PortalImportReview />} />
            </Route>
            <Route path={NEW_INVOICE_PATH} element={<NewInvoiceRedirect />} />
            <Route path="/cases" element={<CaseList />} />
            <Route path="/cases/new" element={<NewCaseIntake />} />
            <Route path="/cases/:caseId" element={<CaseDetail />} />
            <Route path="/vendors" element={<VendorsDirectory />} />
            <Route path="/preauthorizations" element={<Preauthorizations />} />
            <Route path="/preauthorizations/:requestId" element={<StaffPreauthorizationRequest />} />
            <Route path="/settings" element={<Settings isAdmin={Boolean(user.isAdmin)} />} />
            <Route path="/overview" element={<Overview />} />
            {/* Off the sidebar; still reachable. */}
            <Route path="/person-records" element={<PeopleDirectory />} />
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
    <BrowserRouter>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  );
}
