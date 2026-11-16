import { useAuth } from '../AuthContext';
import { reviewPath } from '../staffPaths';

// The upload, check and import pages serve external submitters and staff entering invoices received
// elsewhere (model/rules.yaml authorize_staff_invoice_entry); only these links differ between them.
export const NEW_INVOICE_PATH = '/new-invoice';
// External submitters start on their invoices and add new ones by upload.
export const PORTAL_HOME_PATH = '/portal/invoices';
export const PORTAL_PREAUTHORIZATIONS_PATH = '/portal/preauthorizations';
export const UPLOAD_PATH = '/portal/upload';
export const STAFF_UPLOAD_PATH = '/upload';
// Intake's old address, retired with the case-based form: it goes to To review.
export const RETIRED_INTAKE_PATH = '/intake';
// The case (or professional) choice meaning "not known yet; match it later".
export const LATER = 'later';

export function useShell() {
  const { user } = useAuth();
  // The server's role check, so staff-only options match what it allows.
  const staff = Boolean(user?.isStaff);
  return {
    staff,
    casePath: (caseId: string) => (staff ? `/cases/${caseId}` : `/portal/cases/${caseId}`),
    invoicePath: (invoiceId: string) => (staff ? reviewPath(invoiceId) : `/portal/invoices/${invoiceId}`),
    newInvoicePath: staff ? STAFF_UPLOAD_PATH : UPLOAD_PATH,
    newInvoiceLabel: staff ? 'Upload invoices' : 'New invoice',
    invoicesPath: staff ? '/' : PORTAL_HOME_PATH,
    invoicesLabel: staff ? 'To review' : 'Your invoices',
  };
}
