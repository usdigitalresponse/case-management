import { BrowserRouter, Routes, Route, Link, NavLink } from 'react-router-dom';
import { Button } from '@trussworks/react-uswds';
import { AuthProvider, RequireAuth, useAuth } from './AuthContext';
import CaseList from './pages/CaseList';
import CaseDetail from './pages/CaseDetail';
import NewCaseIntake from './pages/NewCaseIntake';
import Overview from './pages/Overview';
import { overviewStages } from './overviewStages';
import ExternalPortalApp from './portal/ExternalPortalApp';

function TopBar() {
  const { user, loading, devLogin, logout } = useAuth();
  return (
    <>
      {user && <a className="usa-skipnav" href="#main-content">Skip to main content</a>}
      <header className="app-header">
        <Link className="app-brand" to="/">Case Management</Link>
        {user && <input className="global-search" aria-label="Search everything (coming soon)" placeholder="Search everything · coming soon" disabled />}
        <div className="header-actions">
          {!loading && !user && <Button type="button" onClick={() => void devLogin()}>Dev sign-in</Button>}
          {!loading && user && <>
            <Link className="usa-button create-button" to="/cases/new"><span aria-hidden="true">+ </span>New case</Link>
            <button type="button" className="header-placeholder" disabled title="Coming soon">Messages</button>
            <button type="button" className="header-placeholder" disabled title="Coming soon">Timer</button>
            <span className="user-name">{user.displayName}</span>
            <Button type="button" unstyled onClick={() => void logout()}>Sign out</Button>
          </>}
        </div>
      </header>
    </>
  );
}

function Sidebar() {
  return (
    <aside className="app-sidebar">
      <nav aria-label="Main navigation">
        <NavLink to="/" end className="sidebar-overview">Overview</NavLink>
        <div className="nav-group">
          <h2>The case, stage by stage</h2>
          {overviewStages.map((stage) => stage.id === 'awaiting-assignment'
            ? <NavLink key={stage.id} to="/cases" end>{stage.label}</NavLink>
            : <button key={stage.id} type="button" disabled title="Coming soon">{stage.label}</button>)}
        </div>
        <div className="nav-group">
          <h2>Look something up</h2>
          <Link to="/cases">Cases</Link>
          {['Clients', 'Organizations', 'Vendors'].map((label) => <button key={label} type="button" disabled title="Coming soon">{label}</button>)}
        </div>
        <div className="nav-group">
          <h2>Oversight</h2>
          {['Reports', 'People'].map((label) => <button key={label} type="button" disabled title="Coming soon">{label}</button>)}
        </div>
        <p className="sidebar-note">More tools coming soon.</p>
      </nav>
    </aside>
  );
}

// External (magic-link) users get their own narrow shell
// (ExternalPortalApp: just view/log time, submit invoices), never this
// staff layout — checked here, before TopBar/Sidebar render at all, so an
// external session never even sees staff-only chrome flash by.
function AppContent() {
  const { user } = useAuth();
  if (user?.authType === 'magic-link') {
    return <ExternalPortalApp />;
  }
  return (
    <>
      <TopBar />
      <RequireAuth>
        <div className="app-layout">
          <Sidebar />
          <main id="main-content" className="app-main" tabIndex={-1}>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/cases" element={<><h1>Cases</h1><CaseList /></>} />
              <Route path="/cases/new" element={<NewCaseIntake />} />
              <Route path="/cases/:caseId" element={<CaseDetail />} />
              <Route path="*" element={<><h1>Page not found</h1><Link to="/">Back to overview</Link></>} />
            </Routes>
          </main>
        </div>
      </RequireAuth>
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
