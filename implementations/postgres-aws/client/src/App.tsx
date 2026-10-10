import { BrowserRouter, Routes, Route, Link, NavLink, useLocation } from 'react-router';
import { Button } from '@trussworks/react-uswds';
import { AuthProvider, useAuth } from './AuthContext';
import LoginPage from './pages/LoginPage';
import MagicLinkConfirm from './pages/MagicLinkConfirm';
import CaseList from './pages/CaseList';
import CaseDetail from './pages/CaseDetail';
import NewCaseIntake from './pages/NewCaseIntake';
import Overview from './pages/Overview';
import BillingQueue from './pages/BillingQueue';
import InvoiceReview from './pages/InvoiceReview';
import PeopleDirectory from './pages/PeopleDirectory';
import ClientsDirectory from './pages/ClientsDirectory';
import VendorsDirectory from './pages/VendorsDirectory';
import OrganizationsDirectory from './pages/OrganizationsDirectory';
import { overviewStages } from './overviewStages';
import ExternalPortalApp from './portal/ExternalPortalApp';

// Only rendered for a signed-in staff user (see AppContent) — the signed-out screen is LoginPage's alone.
function TopBar({ displayName, onLogout }: { displayName: string; onLogout: () => void }) {
  return (
    <>
      <a className="usa-skipnav" href="#main-content">Skip to main content</a>
      <header className="app-header">
        <Link className="app-brand" to="/">Case Management</Link>
        <div className="header-actions">
          <Link className="usa-button create-button" to="/cases/new"><span aria-hidden="true">+ </span>New case</Link>
          <span className="user-name">{displayName}</span>
          <Button type="button" unstyled onClick={onLogout}>Sign out</Button>
        </div>
      </header>
    </>
  );
}

function Sidebar() {
  // NavLink only compares pathname by default, so it can't tell
  // /cases?stage=represented apart from plain /cases — every stage link
  // plus "Cases" share that one pathname. Determine the active one here
  // instead, from the current ?stage= value.
  const location = useLocation();
  const onCases = location.pathname === '/cases';
  const activeStage = onCases ? new URLSearchParams(location.search).get('stage') : null;

  return (
    <aside className="app-sidebar">
      <nav aria-label="Main navigation">
        <NavLink to="/" end className="sidebar-overview">Overview</NavLink>
        <Link className="usa-button create-button sidebar-new-case" to="/cases/new"><span aria-hidden="true">+ </span>New case</Link>
        <div className="nav-group">
          <h2>The case, stage by stage</h2>
          {overviewStages.map((stage) => {
            if (stage.route.startsWith('/cases?')) {
              return (
                <Link key={stage.id} to={stage.route} className={activeStage === stage.id ? 'active' : undefined}>
                  {stage.label}
                </Link>
              );
            }
            return <NavLink key={stage.id} to={stage.route} end>{stage.label}</NavLink>;
          })}
        </div>
        <div className="nav-group">
          <h2>Look something up</h2>
          <Link to="/cases" className={onCases && !activeStage ? 'active' : undefined}>Cases</Link>
          <NavLink to="/clients" end>Clients</NavLink>
          <NavLink to="/organizations" end>Organizations</NavLink>
          <NavLink to="/vendors" end>Vendors</NavLink>
        </div>
        <div className="nav-group">
          <h2>Oversight</h2>
          <button type="button" disabled title="Coming soon">Reports</button>
          <NavLink to="/people" end>People</NavLink>
        </div>
        <p className="sidebar-note">More tools coming soon.</p>
      </nav>
    </aside>
  );
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
        <Sidebar />
        <main id="main-content" className="app-main" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/cases" element={<CaseList />} />
            <Route path="/cases/new" element={<NewCaseIntake />} />
            <Route path="/cases/:caseId" element={<CaseDetail />} />
            <Route path="/billing" element={<BillingQueue />} />
            <Route path="/billing/:invoiceId" element={<InvoiceReview />} />
            <Route path="/people" element={<PeopleDirectory />} />
            <Route path="/clients" element={<ClientsDirectory />} />
            <Route path="/vendors" element={<VendorsDirectory />} />
            <Route path="/organizations" element={<OrganizationsDirectory />} />
            <Route path="*" element={<><h1>Page not found</h1><Link to="/">Back to overview</Link></>} />
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
