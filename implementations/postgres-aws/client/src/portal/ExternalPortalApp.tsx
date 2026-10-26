// Shell for external (magic-link) users, styled like the staff app but with
// only their own work. It opens on New invoice; imports are reached from there. See ../AuthContext.tsx
// and ../../MAPPING.md "Case assignment, scoped to external submitters".
import { Routes, Route, Link, Navigate, NavLink } from 'react-router';
import { useAuth } from '../AuthContext';
import PortalNewInvoice from './PortalNewInvoice';
import PortalInvoiceList from './PortalInvoiceList';
import PortalCaseList from './PortalCaseList';
import PortalCaseDetail from './PortalCaseDetail';
import PortalInvoiceDetail from './PortalInvoiceDetail';
import PortalImportReview from './PortalImportReview';
import PortalBulkImport from './PortalBulkImport';
import { NEW_INVOICE_PATH } from './useShell';

export default function ExternalPortalApp() {
  const { user, logout } = useAuth();
  return (
    <>
      <a className="usa-skipnav" href="#main-content">Skip to main content</a>
      <header className="app-header">
        <Link className="app-brand" to={NEW_INVOICE_PATH}>Invoices</Link>
        <div className="header-actions">
          <span className="user-name">{user?.displayName}</span>
          <button type="button" className="link-button" onClick={() => void logout()}>Sign out</button>
        </div>
      </header>
      <div className="app-layout">
        <aside className="app-sidebar">
          <nav aria-label="Main navigation">
            <div className="nav-group">
              <NavLink to={NEW_INVOICE_PATH}>New invoice</NavLink>
            </div>
            <div className="nav-group">
              <h2>Your work</h2>
              <NavLink to="/portal/invoices" end>Your invoices</NavLink>
              <NavLink to="/portal/cases">Your cases</NavLink>
            </div>
          </nav>
        </aside>
        <main id="main-content" className="app-main portal-main" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<Navigate to={NEW_INVOICE_PATH} replace />} />
            <Route path={NEW_INVOICE_PATH} element={<PortalNewInvoice />} />
            <Route path="/portal/invoices" element={<PortalInvoiceList />} />
            <Route path="/portal/cases" element={<PortalCaseList />} />
            <Route path="/portal/cases/:caseId" element={<PortalCaseDetail />} />
            <Route path="/portal/invoices/:invoiceId" element={<PortalInvoiceDetail />} />
            <Route path="/portal/imports" element={<PortalBulkImport />} />
            <Route path="/portal/imports/:importId" element={<PortalImportReview />} />
            <Route path="*" element={<><h1>Page not found</h1><Link to="/portal/invoices">Back to your invoices</Link></>} />
          </Routes>
        </main>
      </div>
    </>
  );
}
