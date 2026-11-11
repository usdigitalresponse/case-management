// Shell for external (email-code) users: one top bar with tabs for their
// invoices, their cases and importing, no sidebar, opening on their invoices.
// The older manual-entry form and bulk import stay reachable by address but
// out of view.
// See ../AuthContext.tsx and ../../docs/api.md "Case assignment, two
// workflows".
import { Link, Navigate, Outlet, ScrollRestoration, useNavigation, type RouteObject } from 'react-router';
import type { portalLoaders } from '../routeLoaders';
import { Notice } from '../components/Notice';
import PortalNewInvoice from './PortalNewInvoice';
import PortalInvoiceList from './PortalInvoiceList';
import PortalCaseList from './PortalCaseList';
import PortalCaseDetail from './PortalCaseDetail';
import InvoiceSubmission from './InvoiceSubmission';
import PortalImportReview from './PortalImportReview';
import PortalBulkImport from './PortalBulkImport';
import UploadInvoices from '../pages/UploadInvoices';
import { PortalTopBar } from './PortalTopBar';
import PortalPreauthorizations, { PORTAL_PREAUTHORIZATIONS_PATH, PortalPreauthorizationRequest } from './PortalPreauthorizations';
import { NEW_INVOICE_PATH, PORTAL_HOME_PATH, UPLOAD_PATH } from './useShell';

function PortalShell() {
  const loadingPage = useNavigation().state === 'loading';
  return (
    <>
      <PortalTopBar />
      <ScrollRestoration />
      <main id="main-content" className="app-main portal-main portal-page" tabIndex={-1} aria-busy={loadingPage}>
        {loadingPage && <div className="page-loading" aria-hidden="true" />}
        <Outlet />
      </main>
    </>
  );
}

export function portalRoutes(loaders: typeof portalLoaders): RouteObject[] {
  return [
    {
      element: <PortalShell />,
      HydrateFallback: () => null,
      children: [
        {
          errorElement: <Notice tone="danger">Something went wrong showing this page. Please refresh to try again.</Notice>,
          children: [
            { path: '/', element: <Navigate to={PORTAL_HOME_PATH} replace /> },
            { path: PORTAL_HOME_PATH, element: <PortalInvoiceList />, ...loaders.invoices },
            { path: UPLOAD_PATH, element: <UploadInvoices />, ...loaders.uploadByPerson },
            { path: '/portal/cases', element: <PortalCaseList />, ...loaders.cases },
            { path: '/portal/cases/:caseId', element: <PortalCaseDetail />, ...loaders.caseDetail },
            { path: '/portal/invoices/:invoiceId', element: <InvoiceSubmission />, ...loaders.invoice },
            { path: '/portal/imports/:importId', element: <PortalImportReview />, ...loaders.importReview },
            { path: PORTAL_PREAUTHORIZATIONS_PATH, element: <PortalPreauthorizations />, ...loaders.preauthorizations },
            { path: `${PORTAL_PREAUTHORIZATIONS_PATH}/:requestId`, element: <PortalPreauthorizationRequest />, ...loaders.preauthorizationRequest },
            // Out of view; reachable by address.
            { path: NEW_INVOICE_PATH, element: <PortalNewInvoice /> },
            { path: '/portal/imports', element: <PortalBulkImport />, ...loaders.imports },
            { path: '*', element: <><h1>Page not found</h1><Link to={PORTAL_HOME_PATH}>Back to your invoices</Link></> },
          ],
        },
      ],
    },
  ];
}
