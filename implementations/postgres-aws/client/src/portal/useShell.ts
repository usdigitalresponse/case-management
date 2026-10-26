import { useAuth } from '../AuthContext';

// The new-invoice and import pages serve both apps: external submitters, and
// staff entering invoices received outside the system (model/rules.yaml
// authorize_staff_invoice_entry). Only these links differ between them.
export const NEW_INVOICE_PATH = '/new-invoice';
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
    newInvoicePath: staff ? INTAKE_PATH : NEW_INVOICE_PATH,
    newInvoiceLabel: staff ? 'Intake' : 'New invoice',
    invoicesPath: staff ? INTAKE_PATH : '/portal/invoices',
    invoicesLabel: staff ? 'Intake' : 'Your invoices',
  };
}
