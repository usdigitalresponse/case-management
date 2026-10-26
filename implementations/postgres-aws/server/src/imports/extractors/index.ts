// The PDF extraction method, chosen by INVOICE_EXTRACTOR. Methods outside the
// processing boundary are refused in production (model/rules.yaml
// validate_invoice_import); a cloud AI method needs a cost review first.
import { ConfigurationError } from '../../errors';
import { textLayerExtractor } from './textLayer';
import type { InvoiceExtractor } from './types';

export const EXTRACTORS: Record<string, InvoiceExtractor> = {
  [textLayerExtractor.id]: textLayerExtractor,
};

export function documentExtractor(
  id: string = process.env.INVOICE_EXTRACTOR || textLayerExtractor.id,
  production: boolean = process.env.NODE_ENV === 'production',
): InvoiceExtractor {
  const extractor = EXTRACTORS[id];
  if (!extractor) {
    throw new ConfigurationError(`Unknown INVOICE_EXTRACTOR "${id}".`);
  }
  if (production && !extractor.inBoundary) {
    throw new ConfigurationError(`INVOICE_EXTRACTOR "${id}" runs outside the processing boundary and can't be used in production.`);
  }
  return extractor;
}
