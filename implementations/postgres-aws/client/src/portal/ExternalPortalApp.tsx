// Shell for external (email-code) users: one top bar, no sidebar, opening
// on their invoices. Pages outside the submission design (cases, the older
// manual-entry form, bulk import) stay reachable by address but out of view.
// See ../AuthContext.tsx and ../../MAPPING.md "Case assignment, scoped to
// external submitters".
import { Routes, Route, Link, Navigate } from 'react-router';
import PortalNewInvoice from './PortalNewInvoice';
import PortalInvoiceList from './PortalInvoiceList';
import PortalCaseList from './PortalCaseList';
import PortalCaseDetail from './PortalCaseDetail';
import InvoiceSubmission from './InvoiceSubmission';
import PortalImportReview from './PortalImportReview';
import PortalBulkImport from './PortalBulkImport';
import PortalUpload from './PortalUpload';
import { PortalTopBar } from './PortalTopBar';
import { NEW_INVOICE_PATH, PORTAL_HOME_PATH, UPLOAD_PATH } from './useShell';

export default function ExternalPortalApp() {
  return (
    <>
      <PortalTopBar />
      <main id="main-content" className="app-main portal-main portal-page" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Navigate to={PORTAL_HOME_PATH} replace />} />
          <Route path={PORTAL_HOME_PATH} element={<PortalInvoiceList />} />
          <Route path={UPLOAD_PATH} element={<PortalUpload />} />
          <Route path="/portal/invoices/:invoiceId" element={<InvoiceSubmission />} />
          <Route path="/portal/imports/:importId" element={<PortalImportReview />} />
          {/* Out of view; reachable by address. */}
          <Route path={NEW_INVOICE_PATH} element={<PortalNewInvoice />} />
          <Route path="/portal/cases" element={<PortalCaseList />} />
          <Route path="/portal/cases/:caseId" element={<PortalCaseDetail />} />
          <Route path="/portal/imports" element={<PortalBulkImport />} />
          <Route path="*" element={<><h1>Page not found</h1><Link to={PORTAL_HOME_PATH}>Back to your invoices</Link></>} />
        </Routes>
      </main>
    </>
  );
}
