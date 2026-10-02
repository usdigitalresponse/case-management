import { BrowserRouter, Routes, Route, Link, NavLink } from 'react-router-dom';
import { Button } from '@trussworks/react-uswds';
import { AuthProvider, useAuth } from './AuthContext';
import LoginPage from './pages/LoginPage';
import CaseList from './pages/CaseList';
import CaseDetail from './pages/CaseDetail';
import NewCaseIntake from './pages/NewCaseIntake';
import Overview from './pages/Overview';
import { overviewStages } from './overviewStages';
import ExternalPortalApp from './portal/ExternalPortalApp';

// Only rendered for a signed-in staff user (see AppContent) — the signed-out screen is LoginPage's alone.
function TopBar({ displayName, onLogout }: { displayName: string; onLogout: () => void }) {
  return (
    <>
      <a className="usa-skipnav" href="#main-content">Skip to main content</a>
      <header className="app-header">
        <Link className="app-brand" to="/">Case Management</Link>
        <input className="global-search" aria-label="Search everything (coming soon)" placeholder="Search everything · coming soon" disabled />
        <div className="header-actions">
          <Link className="usa-button create-button" to="/cases/new"><span aria-hidden="true">+ </span>New case</Link>
          <button type="button" className="header-placeholder" disabled title="Coming soon">Messages</button>
          <button type="button" className="header-placeholder" disabled title="Coming soon">Timer</button>
          <span className="user-name">{displayName}</span>
          <Button type="button" unstyled onClick={onLogout}>Sign out</Button>
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

// Order matters: loading (render nothing, don't flash the login screen),
// signed out (LoginPage owns the screen), magic-link (narrow portal shell),
// else staff layout.
function AppContent() {
  const { user, loading, logout } = useAuth();
  if (loading) {
    return null;
  }
  if (!user) {
    return <LoginPage />;
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
