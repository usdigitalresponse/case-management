import { useAuth } from '../AuthContext';

// The New invoice pages serve both apps: external submitters, and staff
// entering invoices received outside the system (model/rules.yaml
// authorize_staff_invoice_entry). Only these links differ between them.
export const NEW_INVOICE_PATH = '/new-invoice';

export function useShell() {
  const { user } = useAuth();
  const staff = user?.authType === 'sso';
  return {
    staff,
    casePath: (caseId: string) => (staff ? `/cases/${caseId}` : `/portal/cases/${caseId}`),
    // Staff find their drafts on New invoice.
    invoicesPath: staff ? NEW_INVOICE_PATH : '/portal/invoices',
    invoicesLabel: staff ? 'New invoice' : 'Your invoices',
  };
}
