import type { Request, Response } from 'express';
import { ValidationError } from '../errors';
import {
  INVOICE_EXPORT_MEDIA_TYPES,
  invoiceExportFileName,
  renderInvoicePdf,
  renderInvoiceXlsx,
  type InvoiceExportFormat,
} from '../billing/exportInvoice';
import type { InvoiceDetail } from '../billing/invoiceDetail';

export function parseExportFormat(req: Request): InvoiceExportFormat {
  const format = req.query.format;
  if (format === 'pdf' || format === 'xlsx') {
    return format;
  }
  throw new ValidationError({ format: 'Use pdf or xlsx.' });
}

export async function sendInvoiceExport(
  res: Response,
  detail: InvoiceDetail,
  format: InvoiceExportFormat,
  includeReviewer: boolean,
): Promise<void> {
  const options = { includeReviewer, exportedAt: new Date() };
  const body = format === 'pdf' ? await renderInvoicePdf(detail, options) : await renderInvoiceXlsx(detail, options);
  res
    .status(200)
    .type(INVOICE_EXPORT_MEDIA_TYPES[format])
    .attachment(invoiceExportFileName(detail, format))
    .set('Cache-Control', 'no-store')
    .send(body);
}
