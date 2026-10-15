// The PDF extraction method, chosen by INVOICE_EXTRACTOR. Methods outside the
// processing boundary are refused in production (model/rules.yaml
// validate_invoice_import); a cloud AI method needs a cost review first.
import { ConfigurationError } from '../../errors';
import { cents, lineTotalCents, UnreadableInvoiceFileError, type ParsedInvoice } from '../parsedInvoice';
import { textLayerExtractor } from './textLayer';
import type { ExtractOptions, InvoiceExtractor } from './types';
import { extractWithVision, visionConfig, visionExtractor, type VisionConfig } from './vision';

export const EXTRACTORS: Record<string, InvoiceExtractor> = {
  [textLayerExtractor.id]: textLayerExtractor,
};
const configuredVision = visionConfig();
const VISION_IDS = ['pdf-vision', 'pdf-text-layer+vision'];

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

const hasWarning = (parsed: ParsedInvoice, code: string) => (parsed.warnings ?? []).some((warning) => warning.code === code);

// Figures that add up to the stated total (or `total`, when given) and every
// page subtotal. A recognized scan with no stated total can't be checked,
// so it doesn't count.
export function reconciles(parsed: ParsedInvoice, total: number | undefined = parsed.statedTotal): boolean {
  if (hasWarning(parsed, 'subtotal_mismatch')) {
    return false;
  }
  if (total === undefined) {
    return !hasWarning(parsed, 'read_by_ocr');
  }
  return cents(total) === lineTotalCents(parsed.lines);
}

// The configured method first; when it can't read a file or its figures
// don't add up, a vision model (if configured) reads the page images.
//
// The model's reading is held to the total printed in the document's own
// text: text in a document can talk a model into items and a total that
// agree with each other, but not into that. A text-layer total is trusted:
// the model's items must add up to it. A recognized one may itself be
// misread, so a model reading that adds up on its own is accepted, flagged
// where its total differs. With no first reading the model's is used
// anyway; when neither adds up, the nearer one is kept.
export function withVisionFallback(
  primary: InvoiceExtractor,
  vision: VisionConfig | undefined,
  read: (config: VisionConfig, bytes: Buffer, options?: ExtractOptions) => Promise<ParsedInvoice> = extractWithVision,
): InvoiceExtractor {
  if (!vision) {
    return primary;
  }
  return {
    ...primary,
    async extract(bytes, options) {
      let first: ParsedInvoice | undefined;
      let failure: UnreadableInvoiceFileError | undefined;
      try {
        first = await primary.extract(bytes, options);
        if (reconciles(first)) {
          return first;
        }
      } catch (error) {
        if (!(error instanceof UnreadableInvoiceFileError)) {
          throw error;
        }
        failure = error;
      }
      const anchor = first?.statedTotal ?? failure?.found.statedTotal;
      const trusted = anchor !== undefined && !(first ? hasWarning(first, 'read_by_ocr') : failure?.found.recognized);
      let second: ParsedInvoice;
      try {
        second = await read(vision, bytes, options);
      } catch (error) {
        if (!(error instanceof UnreadableInvoiceFileError)) {
          // eslint-disable-next-line no-console
          console.error('Vision extraction failed', error);
        }
        if (first) {
          return first;
        }
        throw failure;
      }
      // A model that gives no total is checked against the document's.
      if (second.statedTotal === undefined && anchor !== undefined) {
        second = { ...second, statedTotal: anchor };
      }
      if (anchor !== undefined && cents(anchor) !== cents(second.statedTotal!)) {
        second = {
          ...second,
          warnings: [
            ...(second.warnings ?? []),
            {
              code: 'totals_disagree',
              message: `The file's text gives a total of ${anchor.toFixed(2)}, but the AI model read ${second.statedTotal!.toFixed(2)}; check the total and items against the file.`,
            },
          ],
        };
      }
      if (!first || reconciles(second, trusted ? anchor : second.statedTotal)) {
        return second;
      }
      // Neither adds up: keep the one nearer the stated total, warning that
      // the other was tried.
      const kept = closerToTotal(first, second);
      const message =
        kept === first
          ? 'An AI model also read this file, but its figures were further from the stated total, so the first reading is kept.'
          : 'This file was read twice; neither reading adds up to the stated total, and this is the nearer one.';
      return { ...kept, warnings: [...(kept.warnings ?? []), { code: 'readings_did_not_reconcile', message }] };
    },
  };
}

// Against the first reading's total, from the document's own text when it
// has one; without any stated total the first reading stays.
function closerToTotal(first: ParsedInvoice, second: ParsedInvoice): ParsedInvoice {
  const stated = first.statedTotal ?? second.statedTotal;
  if (stated === undefined) {
    return first;
  }
  const target = cents(stated);
  return Math.abs(lineTotalCents(second.lines) - target) < Math.abs(lineTotalCents(first.lines) - target) ? second : first;
}

// With a model configured, each method can also be scored on its own and
// combined (npm run extraction-accuracy).
if (configuredVision) {
  EXTRACTORS['pdf-vision'] = visionExtractor(configuredVision);
  EXTRACTORS['pdf-text-layer+vision'] = { ...withVisionFallback(textLayerExtractor, configuredVision), id: 'pdf-text-layer+vision' };
}

// What uploads use: the configured method with the vision fallback.
export function documentPipeline(): InvoiceExtractor {
  const extractor = documentExtractor();
  return VISION_IDS.includes(extractor.id) ? extractor : withVisionFallback(extractor, configuredVision);
}
