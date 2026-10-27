import { useAuth } from '../AuthContext';

// The new-invoice and import pages serve both apps: external submitters, and
// staff entering invoices received outside the system (model/rules.yaml
// authorize_staff_invoice_entry). Only these links differ between them.
export const NEW_INVOICE_PATH = '/new-invoice';
// External submitters start on their invoices and add new ones by upload.
export const PORTAL_HOME_PATH = '/portal/invoices';
export const UPLOAD_PATH = '/portal/upload';
// Staff enter invoices, finish drafts and match invoices to cases here.
export const INTAKE_PATH = '/intake';
// The case (or professional) choice meaning "not known yet; match it later".
export const LATER = 'later';

export function useShell() {
  const { user } = useAuth();
  // The server's role check, so staff-only options match what it allows.
  const staff = Boolean(user?.isStaff);
  return {
    staff,
    casePath: (caseId: string) => (staff ? `/cases/${caseId}` : `/portal/cases/${caseId}`),
    newInvoicePath: staff ? INTAKE_PATH : UPLOAD_PATH,
    newInvoiceLabel: staff ? 'Intake' : 'New invoice',
    invoicesPath: staff ? INTAKE_PATH : PORTAL_HOME_PATH,
    invoicesLabel: staff ? 'Intake' : 'Your invoices',
  };
}
