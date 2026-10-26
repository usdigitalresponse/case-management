// Shell for external (magic-link) users, styled like the staff app but with
// only their own work: invoices, cases and imports. See ../AuthContext.tsx
// and ../../MAPPING.md "Case assignment, scoped to external submitters".
import { Routes, Route, Link, NavLink } from 'react-router';
import { useAuth } from '../AuthContext';
import PortalInvoiceList from './PortalInvoiceList';
import PortalCaseList from './PortalCaseList';
import PortalCaseDetail from './PortalCaseDetail';
import PortalInvoiceDetail from './PortalInvoiceDetail';
import PortalImportReview from './PortalImportReview';
import PortalBulkImport from './PortalBulkImport';

export default function ExternalPortalApp() {
  const { user, logout } = useAuth();
  return (
    <>
      <a className="usa-skipnav" href="#main-content">Skip to main content</a>
      <header className="app-header">
        <Link className="app-brand" to="/">Invoices</Link>
        <div className="header-actions">
          <span className="user-name">{user?.displayName}</span>
          <button type="button" className="link-button" onClick={() => void logout()}>Sign out</button>
        </div>
      </header>
      <div className="app-layout">
        <aside className="app-sidebar">
          <nav aria-label="Main navigation">
            <div className="nav-group">
              <h2>Your work</h2>
              <NavLink to="/" end>Your invoices</NavLink>
              <NavLink to="/portal/cases">Your cases</NavLink>
              <NavLink to="/portal/imports">Import invoices</NavLink>
            </div>
          </nav>
        </aside>
        <main id="main-content" className="app-main portal-main" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<PortalInvoiceList />} />
            <Route path="/portal/cases" element={<PortalCaseList />} />
            <Route path="/portal/cases/:caseId" element={<PortalCaseDetail />} />
            <Route path="/portal/invoices/:invoiceId" element={<PortalInvoiceDetail />} />
            <Route path="/portal/imports" element={<PortalBulkImport />} />
            <Route path="/portal/imports/:importId" element={<PortalImportReview />} />
            <Route path="*" element={<><h1>Page not found</h1><Link to="/">Back to your invoices</Link></>} />
          </Routes>
        </main>
      </div>
    </>
  );
}
