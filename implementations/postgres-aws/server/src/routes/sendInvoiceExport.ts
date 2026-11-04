import type { Request, Response } from 'express';
import { ValidationError } from '../errors';
import {
  exportFieldKey,
  INVOICE_EXPORT_MEDIA_TYPES,
  invoiceExportContent,
  invoiceExportFileName,
  OMITTABLE_EXPORT_FIELDS,
  renderInvoicePdf,
  renderInvoiceXlsx,
  type ExportFieldGroup,
  type InvoiceExportFormat,
} from '../billing/exportInvoice';
import type { InvoiceDetail } from '../billing/invoiceDetail';

const OMITTABLE_KEYS = new Set(
  Object.entries(OMITTABLE_EXPORT_FIELDS).flatMap(([group, names]) => names.map((name) => exportFieldKey(group as ExportFieldGroup, name))),
);

export function parseExportFormat(req: Request): InvoiceExportFormat {
  const format = req.query.format;
  if (format === 'pdf' || format === 'xlsx') {
    return format;
  }
  throw new ValidationError({ format: 'Use pdf or xlsx.' });
}

// `?omit=lines:Description,summary:Client`: one value, since the query
// parser stops making repeated parameters a list after 20.
export function parseExportOmit(req: Request): Set<string> {
  const raw = req.query.omit;
  if (raw !== undefined && typeof raw !== 'string') {
    throw new ValidationError({ omit: 'Give the fields to leave out as one comma-separated value.' });
  }
  const omit = new Set<string>();
  for (const key of raw ? raw.split(',') : []) {
    if (!OMITTABLE_KEYS.has(key)) {
      throw new ValidationError({ omit: 'That field cannot be left out of an export.' });
    }
    omit.add(key);
  }
  return omit;
}

export async function sendInvoiceExport(
  res: Response,
  detail: InvoiceDetail,
  format: InvoiceExportFormat,
  includeReviewer: boolean,
  omit: ReadonlySet<string> = new Set(),
): Promise<void> {
  const options = { includeReviewer, exportedAt: new Date(), omit };
  const body = format === 'pdf' ? await renderInvoicePdf(detail, options) : await renderInvoiceXlsx(detail, options);
  // Only when something this invoice has was left out.
  const redacted = invoiceExportContent(detail, options).redactionNote !== null;
  res
    .status(200)
    .type(INVOICE_EXPORT_MEDIA_TYPES[format])
    .attachment(invoiceExportFileName(detail, format, redacted))
    .set('Cache-Control', 'no-store')
    .send(body);
}
