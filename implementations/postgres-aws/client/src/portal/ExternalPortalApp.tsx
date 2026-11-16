// External users' shell: a top bar with their tabs and no sidebar, opening on their invoices.
import { Link, Navigate, Outlet, useNavigation, type RouteObject } from 'react-router';
import type { portalLoaders } from '../routeLoaders';
import { Notice } from '../components/ui/Notice';
import { PortalTopBar } from './PortalTopBar';
import { page } from '../lazyPage';
import { NEW_INVOICE_PATH, PORTAL_HOME_PATH, PORTAL_PREAUTHORIZATIONS_PATH, UPLOAD_PATH } from './useShell';
import { ScrollRestorationPerSignIn } from '../components/ScrollRestorationPerSignIn';
import { TourChrome } from '../tour/GuidePanel';

function PortalShell() {
  const loadingPage = useNavigation().state === 'loading';
  return (
    <>
      <PortalTopBar />
      <ScrollRestorationPerSignIn />
      <main id="main-content" className="app-main portal-main portal-page" tabIndex={-1} aria-busy={loadingPage}>
        {loadingPage && <div className="page-loading" aria-hidden="true" />}
        <Outlet />
      </main>
      <TourChrome app="portal" />
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
            { path: PORTAL_HOME_PATH, ...page(() => import('./PortalInvoiceList')), ...loaders.invoices },
            { path: UPLOAD_PATH, ...page(() => import('../pages/UploadInvoices')), ...loaders.uploadByPerson },
            { path: '/portal/cases', ...page(() => import('./PortalCaseList')), ...loaders.cases },
            { path: '/portal/cases/:caseId', ...page(() => import('./PortalCaseDetail')), ...loaders.caseDetail },
            { path: '/portal/invoices/:invoiceId', ...page(() => import('./InvoiceSubmission')), ...loaders.invoice },
            { path: '/portal/imports/:importId', ...page(() => import('./PortalImportReview')), ...loaders.importReview },
            { path: PORTAL_PREAUTHORIZATIONS_PATH, ...page(() => import('./PortalPreauthorizations')), ...loaders.preauthorizations },
            { path: `${PORTAL_PREAUTHORIZATIONS_PATH}/:requestId`, lazy: async () => ({ Component: (await import('./PortalPreauthorizations')).PortalPreauthorizationRequest }), ...loaders.preauthorizationRequest },
            // The case-based form is retired; its old address goes to the upload.
            { path: NEW_INVOICE_PATH, element: <Navigate to={UPLOAD_PATH} replace /> },
            // Out of view; reachable by address.
            { path: '/portal/imports', ...page(() => import('./PortalBulkImport')), ...loaders.imports },
            { path: '*', element: <><h1>Page not found</h1><Link to={PORTAL_HOME_PATH}>Back to your invoices</Link></> },
          ],
        },
      ],
    },
  ];
}
