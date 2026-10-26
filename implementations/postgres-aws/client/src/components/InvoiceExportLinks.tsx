import { invoiceExportUrl } from '../api/client';

export function InvoiceExportLinks({ scope, invoiceId }: { scope: 'staff' | 'portal'; invoiceId: string }) {
  return (
    <div className="invoice-export-links">
      <a className="btn btn--outline" href={invoiceExportUrl(scope, invoiceId, 'pdf')} download>
        Export PDF
      </a>
      <a className="btn btn--outline" href={invoiceExportUrl(scope, invoiceId, 'xlsx')} download>
        Export spreadsheet
      </a>
    </div>
  );
}
