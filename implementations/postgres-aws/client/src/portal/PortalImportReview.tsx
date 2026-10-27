import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link as RouterLink } from 'react-router';
import { Label, Select } from '@trussworks/react-uswds';
import {
  apiErrorMessage,
  getInvoiceImport,
  getMyInvoice,
  listBillableProfessionals,
  listInvoiceImports,
  resolveInvoiceImport,
  updateDraftInvoice,
  type BillableProfessional,
  type InvoiceImportDetail,
  type PortalInvoice,
} from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { usePoll } from '../hooks/usePoll';
import { ImportProgressNote } from '../components/ImportProgressNote';
import {
  assignTimekeeper,
  hasInvoiceItems,
  invoiceTotalPreview,
  InvoiceLinesEditor,
  lineDraftsFrom,
  linesFromDrafts,
  professionalLabel,
  type LineDraft,
} from '../components/InvoiceLinesEditor';
import { formatDateTime } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { ConfirmButton } from '../components/ConfirmButton';
import { OriginalDocument } from '../components/OriginalDocument';
import { nextInQueue, reviewQueue, reviewUrl } from './bulkImport';
import { RuleFindings, RulesInForce, usePortalBillingRules } from '../components/BillingRules';
import { Notice, type SaveMessage } from '../components/Notice';
import { PageHeader } from '../components/PageHeader';
import { Fact, FactsStrip } from '../components/FactsStrip';
import { LoadState } from '../components/LoadState';
import { useShell } from './useShell';

interface Loaded {
  importDetail: InvoiceImportDetail;
  invoice: PortalInvoice | null;
  timekeepers: BillableProfessional[];
}

async function load(importId: string): Promise<Loaded> {
  const importDetail = await getInvoiceImport(importId);
  const [invoice, timekeepers] = await Promise.all([
    importDetail.invoiceId ? getMyInvoice(importDetail.invoiceId) : Promise.resolve(null),
    // A file held in intake has no case: staff may match any provider.
    listBillableProfessionals(importDetail.caseId).then((result) => result.professionals),
  ]);
  return { importDetail, invoice, timekeepers };
}

function AssignAllTimekeepers({
  timekeepers,
  unmatched,
  onAssign,
}: {
  timekeepers: BillableProfessional[];
  unmatched: number;
  onAssign: (professionalId: string, only: 'all' | 'unassigned') => void;
}) {
  const [professionalId, setProfessionalId] = useState('');
  return (
    <div className="assign-all">
      <Label htmlFor="import-assign-all">Set work done by for several items</Label>
      <Select id="import-assign-all" name="import-assign-all" value={professionalId} onChange={(event) => setProfessionalId(event.target.value)}>
        <option value="">- Choose -</option>
        {timekeepers.map((professional) => (
          <option key={professional.professionalId} value={professional.professionalId}>
            {professionalLabel(professional)}
          </option>
        ))}
      </Select>
      <button type="button" className="btn btn--outline" disabled={!professionalId || unmatched === 0} onClick={() => onAssign(professionalId, 'unassigned')}>
        Apply to {unmatched} unassigned
      </button>
      <button type="button" className="link-button" disabled={!professionalId} onClick={() => onAssign(professionalId, 'all')}>
        Apply to all items
      </button>
    </div>
  );
}

// The file's own total beside what configured rates bill, so a gap shows
// before confirming.
function FileTotalComparison({ lines, timekeepers }: { lines: LineDraft[]; timekeepers: BillableProfessional[] }) {
  const stated = lines.reduce((sum, line) => sum + Math.round((line.carried.statedAmount ?? 0) * 100), 0) / 100;
  const billed = invoiceTotalPreview(lines, timekeepers, undefined);
  if (stated === 0 || !billed.complete || Math.abs(stated - billed.total) < 0.005) {
    return null;
  }
  return (
    <Notice tone="info">
      The file totals {formatMoney(stated.toFixed(2))}; at configured rates this invoice is{' '}
      <strong>{formatMoney(billed.total.toFixed(2))}</strong>.
    </Notice>
  );
}

function ExtractedReview({
  data,
  afterResolve,
  hasNext,
  onChanged,
}: {
  data: Loaded;
  // From bulk import: where to go once confirmed or discarded.
  afterResolve?: string;
  hasNext: boolean;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const { importDetail, invoice, timekeepers } = data;
  // A file designated to one professional is all their work, not a suggestion.
  const designatedId = importDetail.extractionResult?.designated_professional_id;
  const designated = timekeepers.find((professional) => professional.professionalId === designatedId);
  const [lines, setLinesState] = useState<LineDraft[]>(() =>
    lineDraftsFrom(invoice?.lines ?? []).map((line) =>
      designatedId
        ? { ...line, timekeeperProfessionalId: designatedId, suggestedTimekeeper: false }
        : { ...line, suggestedTimekeeper: Boolean(line.timekeeperProfessionalId) },
    ),
  );
  // Items added on a designated file are that professional's too.
  const setLines = (next: LineDraft[]) =>
    setLinesState(designatedId ? next.map((line) => ({ ...line, timekeeperProfessionalId: designatedId })) : next);
  const billingRules = usePortalBillingRules();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<SaveMessage | null>(null);
  const warnings = importDetail.extractionResult?.warnings ?? [];
  const unmatched = lines.filter((line) => !line.timekeeperProfessionalId).length;
  const hasItems = hasInvoiceItems(lines);
  // Warnings name the file's line or row; the editor numbers items.
  const locations = importDetail.extractionResult?.lines ?? [];
  const itemFor = (location: string) => {
    const index = locations.findIndex((line) => line.location === location);
    return index >= 0 ? `Item ${index + 1} (${location})` : location;
  };

  async function run(action: 'save' | 'confirm' | 'discard') {
    setBusy(true);
    setMessage(null);
    try {
      if (action !== 'discard' && importDetail.invoiceId) {
        await updateDraftInvoice(importDetail.invoiceId, {
          periodStart: invoice?.invoice.periodStart ?? undefined,
          periodEnd: invoice?.invoice.periodEnd ?? undefined,
          lines: linesFromDrafts(lines),
        });
      }
      if (action === 'save') {
        setMessage({ tone: 'success', text: 'Changes saved.' });
        onChanged();
      } else {
        await resolveInvoiceImport(importDetail.invoiceImportId, action);
        if (afterResolve) {
          navigate(afterResolve);
        } else if (action === 'confirm' && importDetail.invoiceId) {
          navigate(`/portal/invoices/${importDetail.invoiceId}`);
        } else {
          onChanged();
        }
      }
    } catch (err) {
      setMessage({ tone: 'danger', text: apiErrorMessage(err, 'Something went wrong. Try again.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {warnings.length > 0 && (
        <Notice tone="warning" heading="Check before confirming:">
          <ul>
            {warnings.map((warning, index) => (
              <li key={index}>
                {warning.location && <strong>{itemFor(warning.location)}: </strong>}
                {warning.message}
              </li>
            ))}
          </ul>
        </Notice>
      )}
      <p className="import-review-intro">
        {designatedId
          ? `Check each item against the original. Every item is ${designated ? professionalLabel(designated) : 'the chosen professional'}'s work, as chosen for this file.`
          : 'Check each item against the original and choose who did the work.'}{' '}
        Time is billed at the configured hourly rate for that kind of professional, not the file's rate; items where
        they differ are noted. The file stays with the invoice for reviewers to see; the draft stays editable until
        you submit it.
      </p>
      <div className={importDetail.fileAvailable ? 'import-review-layout' : undefined}>
        {importDetail.fileAvailable && (
          <OriginalDocument importId={importDetail.invoiceImportId} fileName={importDetail.fileName} />
        )}
      <div className="import-review-items">
        <h2>Items read from the file</h2>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        <FileTotalComparison lines={lines} timekeepers={timekeepers} />
        <RulesInForce rules={billingRules.rules} />
        <RuleFindings findings={invoice?.ruleFindings ?? []} />
        {!designatedId && timekeepers.length > 0 && lines.length > 1 && (
          <AssignAllTimekeepers timekeepers={timekeepers} unmatched={unmatched} onAssign={(id, only) => setLines(assignTimekeeper(lines, id, only))} />
        )}
        <InvoiceLinesEditor
          idPrefix="import"
          lines={lines}
          onChange={setLines}
          timekeepers={timekeepers}
          billingCodes={billingRules.codes}
          mileageRates={billingRules.mileageRates}
          importReview={{
            duplicateTime: importDetail.possibleDuplicateTime,
            // Only while items are still in their extracted order.
            sourceLocations: lines.length === locations.length ? locations.map((line) => line.location) : undefined,
            fixedTimekeeper: Boolean(designatedId),
          }}
        />
        {(!hasItems || unmatched > 0) && (
          <p className="compact-hint actions-hint">
            {!hasItems
              ? 'Add an item with an amount to continue.'
              : `Choose who did the work for ${unmatched} more ${unmatched === 1 ? 'item' : 'items'} to confirm.`}
          </p>
        )}
        <div className="invoice-actions">
          <button type="button" className="btn btn--primary" disabled={busy || !hasItems || unmatched > 0} onClick={() => void run('confirm')}>
            {!afterResolve ? 'Confirm import' : hasNext ? 'Confirm and review next' : 'Confirm and go to submit'}
          </button>
          <button type="button" className="btn btn--outline" disabled={busy || !hasItems} onClick={() => void run('save')}>
            Save changes
          </button>
          <span className="actions-end">
            <ConfirmButton
              label="Discard import"
              prompt="Discard this import? The file is deleted and nothing is submitted."
              confirmLabel="Yes, discard"
              disabled={busy}
              onConfirm={() => void run('discard')}
            />
          </span>
        </div>
      </div>
      </div>
    </>
  );
}

export default function PortalImportReview() {
  const { importId } = useParams<{ importId: string }>();
  const [searchParams] = useSearchParams();
  const fromBulk = searchParams.get('from') === 'bulk';
  const navigate = useNavigate();
  const { casePath, newInvoicePath, newInvoiceLabel } = useShell();
  const [version, setVersion] = useState(0);
  const { data, error } = useApiResource(() => load(importId as string), [importId, version]);
  // From bulk import: where this file sits in the queue still to review.
  const { data: bulkImports } = useApiResource(
    () => (fromBulk ? listInvoiceImports().then((result) => result.imports) : Promise.resolve(null)),
    [fromBulk, importId],
  );
  const [discardError, setDiscardError] = useState<string | null>(null);
  // Still being read: poll for progress, then reload once it's done.
  const reading = data?.importDetail.statusCode === 'received' && data.importDetail.invoiceImportId === importId;
  const polled = usePoll(() => getInvoiceImport(importId as string), reading, 2000, importId);
  useEffect(() => {
    if (reading && polled && polled.invoiceImportId === importId && polled.statusCode !== 'received') {
      setVersion((v) => v + 1);
    }
  }, [reading, polled, importId]);
  const queue = bulkImports ? reviewQueue(bulkImports) : [];
  const position = queue.findIndex((row) => row.invoiceImportId === importId);
  const previous = position > 0 ? queue[position - 1] : undefined;
  const next = bulkImports && importId ? nextInQueue(bulkImports, importId) : undefined;
  // After confirming or discarding: the next file, or the submit step.
  const afterResolve = fromBulk ? (next ? reviewUrl(next) : '/portal/imports#submit') : undefined;

  if (error || !data) {
    return <LoadState error={error} what="import" />;
  }

  const { importDetail } = data;
  const backTo = fromBulk ? '/portal/imports' : importDetail.caseId ? casePath(importDetail.caseId) : newInvoicePath;

  async function discardImport() {
    try {
      await resolveInvoiceImport(importDetail.invoiceImportId, 'discard');
      if (afterResolve) {
        navigate(afterResolve);
      } else {
        setVersion((v) => v + 1);
      }
    } catch (err) {
      setDiscardError(apiErrorMessage(err, 'Failed to discard the import.'));
    }
  }

  return (
    <div>
      <PageHeader
        crumbs={[
          { label: fromBulk ? 'Import invoices' : importDetail.caseId ? 'Case' : newInvoiceLabel, to: backTo },
          { label: importDetail.fileName },
        ]}
        title={importDetail.fileName}
        status={<span className="chip chip--neutral">{importDetail.statusDisplayName}</span>}
        description={`${importDetail.formatDisplayName}. Check what was read before you confirm it.`}
      />
      {fromBulk && position >= 0 && (
        <p className="bulk-position">
          File {position + 1} of {queue.length} to review
          {previous && (
            <>
              {' · '}
              <RouterLink to={reviewUrl(previous)}>&larr; Previous</RouterLink>
            </>
          )}
          {next && queue.length > 1 && (
            <>
              {' · '}
              <RouterLink to={reviewUrl(next)}>Next &rarr;</RouterLink>
            </>
          )}
        </p>
      )}
      <FactsStrip>
        <Fact label="Uploaded">{formatDateTime(importDetail.uploadedAt)}</Fact>
        {importDetail.extractionResult?.invoice?.invoice_number && (
          <Fact label="Invoice number on file">
            <strong>{importDetail.extractionResult.invoice.invoice_number.value}</strong>
          </Fact>
        )}
        {importDetail.expiresAt && <Fact label="Deleted if not discarded by">{formatDateTime(importDetail.expiresAt)}</Fact>}
      </FactsStrip>

      {importDetail.statusCode === 'extracted' && (
        <ExtractedReview
          key={`${importId}-${version}`}
          data={data}
          afterResolve={afterResolve}
          hasNext={Boolean(next)}
          onChanged={() => setVersion((v) => v + 1)}
        />
      )}

      {importDetail.statusCode === 'failed' && (
        <>
          <Notice tone="danger">
            <h2 className="notice__heading">This file couldn't be read</h2>
            {importDetail.extractionResult?.warnings?.[0]?.message ?? 'The file could not be read.'}
          </Notice>
          {discardError && <Notice tone="danger">{discardError}</Notice>}
          <p>Discard it and upload a corrected file, or enter the items by hand on the case page.</p>
          <button type="button" className="btn btn--danger" onClick={() => void discardImport()}>Discard import</button>
        </>
      )}

      {importDetail.statusCode === 'received' && (
        <>
          <ImportProgressNote progress={polled?.progress ?? importDetail.progress} />
          {discardError && <Notice tone="danger">{discardError}</Notice>}
          <ConfirmButton
            label="Stop and discard"
            prompt="Stop reading this file and discard it? The file is deleted and nothing is submitted."
            confirmLabel="Yes, discard"
            onConfirm={() => void discardImport()}
          />
        </>
      )}

      {importDetail.statusCode === 'confirmed' && importDetail.invoiceId && (
        <Notice tone="success">
          <h2 className="notice__heading">Import confirmed</h2>
          The uploaded file has been deleted.{' '}
          <RouterLink to={`/portal/invoices/${importDetail.invoiceId}`}>Open the draft invoice</RouterLink> to submit it.
        </Notice>
      )}

      {importDetail.statusCode === 'discarded' && (
        <Notice tone="info">
          <h2 className="notice__heading">Import discarded</h2>
          The uploaded file has been deleted and nothing was submitted.
        </Notice>
      )}
    </div>
  );
}
