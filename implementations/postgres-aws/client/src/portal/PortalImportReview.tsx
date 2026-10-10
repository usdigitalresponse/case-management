import { useState } from 'react';
import { useNavigate, useParams, Link as RouterLink } from 'react-router';
import { Alert, AlertHeading, Button, Label, Select } from '@trussworks/react-uswds';
import {
  ApiError,
  apiErrorMessage,
  getInvoiceImport,
  getMyInvoice,
  listBillableProfessionals,
  resolveInvoiceImport,
  updateDraftInvoice,
  type BillableProfessional,
  type InvoiceImportDetail,
  type PortalInvoice,
} from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeading } from '../components/PageHeading';
import {
  assignTimekeeper,
  hasInvoiceItems,
  InvoiceLinesEditor,
  lineDraftsFrom,
  linesFromDrafts,
  professionalLabel,
  type LineDraft,
} from '../components/InvoiceLinesEditor';
import { formatDateTime } from '../formatDateTime';
import { ConfirmButton } from '../components/ConfirmButton';
import { OriginalDocument } from '../components/OriginalDocument';

interface Loaded {
  importDetail: InvoiceImportDetail;
  invoice: PortalInvoice | null;
  timekeepers: BillableProfessional[];
}

async function load(importId: string): Promise<Loaded> {
  const importDetail = await getInvoiceImport(importId);
  const [invoice, timekeepers] = await Promise.all([
    importDetail.invoiceId ? getMyInvoice(importDetail.invoiceId) : Promise.resolve(null),
    importDetail.caseId
      ? listBillableProfessionals(importDetail.caseId).then((result) => result.professionals)
      : Promise.resolve([]),
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
      <Button type="button" outline disabled={!professionalId || unmatched === 0} onClick={() => onAssign(professionalId, 'unassigned')}>
        Apply to {unmatched} unassigned
      </Button>
      <Button type="button" unstyled disabled={!professionalId} onClick={() => onAssign(professionalId, 'all')}>
        Apply to all items
      </Button>
    </div>
  );
}

function ExtractedReview({ data, onChanged }: { data: Loaded; onChanged: () => void }) {
  const navigate = useNavigate();
  const { importDetail, invoice, timekeepers } = data;
  const [lines, setLines] = useState<LineDraft[]>(() =>
    lineDraftsFrom(invoice?.lines ?? []).map((line) => ({ ...line, suggestedTimekeeper: Boolean(line.timekeeperProfessionalId) })),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
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
        setMessage({ type: 'success', text: 'Changes saved.' });
        onChanged();
      } else {
        await resolveInvoiceImport(importDetail.invoiceImportId, action);
        if (action === 'confirm' && importDetail.invoiceId) {
          navigate(`/portal/invoices/${importDetail.invoiceId}`);
        } else {
          onChanged();
        }
      }
    } catch (err) {
      setMessage({ type: 'error', text: apiErrorMessage(err, 'Something went wrong. Try again.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {warnings.length > 0 && (
        <Alert type="warning" slim className="import-warnings">
          <strong>Check before confirming:</strong>
          <ul>
            {warnings.map((warning, index) => (
              <li key={index}>
                {warning.location && <strong>{itemFor(warning.location)}: </strong>}
                {warning.message}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      <p className="import-review-intro">
        Check each item against the original and choose who did the work. Confirming deletes the file; the draft stays
        editable until you submit it.
      </p>
      <div className={importDetail.fileAvailable ? 'import-review-layout' : undefined}>
        {importDetail.fileAvailable && (
          <OriginalDocument importId={importDetail.invoiceImportId} fileName={importDetail.fileName} />
        )}
      <div className="import-review-items">
        <h2>Items read from the file</h2>
        {message && <Alert type={message.type} slim>{message.text}</Alert>}
        {timekeepers.length > 0 && lines.length > 1 && (
          <AssignAllTimekeepers timekeepers={timekeepers} unmatched={unmatched} onAssign={(id, only) => setLines(assignTimekeeper(lines, id, only))} />
        )}
        <InvoiceLinesEditor
          idPrefix="import"
          lines={lines}
          onChange={setLines}
          timekeepers={timekeepers}
          importReview={{
            duplicateTime: importDetail.possibleDuplicateTime,
            // Only while items are still in their extracted order.
            sourceLocations: lines.length === locations.length ? locations.map((line) => line.location) : undefined,
          }}
        />
        <div className="invoice-actions">
          <Button type="button" disabled={busy || !hasItems || unmatched > 0} onClick={() => void run('confirm')}>
            Confirm import
          </Button>
          <Button type="button" outline disabled={busy || !hasItems} onClick={() => void run('save')}>
            Save changes
          </Button>
          <ConfirmButton
            label="Discard import"
            prompt="Discard this import? The file is deleted and nothing is submitted."
            confirmLabel="Yes, discard"
            disabled={busy}
            onConfirm={() => void run('discard')}
          />
          {(!hasItems || unmatched > 0) && (
            <span className="compact-hint">
              {!hasItems
                ? 'Add an item with an amount to continue.'
                : `Choose who did the work for ${unmatched} more ${unmatched === 1 ? 'item' : 'items'} to confirm.`}
            </span>
          )}
        </div>
      </div>
      </div>
    </>
  );
}

export default function PortalImportReview() {
  const { importId } = useParams<{ importId: string }>();
  const [version, setVersion] = useState(0);
  const { data, error } = useApiResource(() => load(importId as string), [importId, version]);
  const [discardError, setDiscardError] = useState<string | null>(null);

  if (error) {
    const message = error instanceof ApiError && error.status === 404 ? 'Import not found.' : 'Failed to load the import.';
    return <Alert type="error">{message}</Alert>;
  }
  if (!data) {
    return <p role="status">Loading import…</p>;
  }

  const { importDetail } = data;
  const backTo = importDetail.caseId ? `/portal/cases/${importDetail.caseId}` : '/';

  async function discardFailed() {
    try {
      await resolveInvoiceImport(importDetail.invoiceImportId, 'discard');
      setVersion((v) => v + 1);
    } catch (err) {
      setDiscardError(apiErrorMessage(err, 'Failed to discard the import.'));
    }
  }

  return (
    <div>
      <RouterLink className="back-link" to={backTo}>&larr; Back to case</RouterLink>
      <PageHeading eyebrow="Invoice import" title={importDetail.fileName} description={importDetail.formatDisplayName} />
      <dl className="fact-grid">
        <div className="fact">
          <dt>Status</dt>
          <dd><span className="status-pill">{importDetail.statusDisplayName}</span></dd>
        </div>
        <div className="fact">
          <dt>Uploaded</dt>
          <dd>{formatDateTime(importDetail.uploadedAt)}</dd>
        </div>
        {importDetail.extractionResult?.invoice?.invoice_number && (
          <div className="fact">
            <dt>Invoice number on file</dt>
            <dd>{importDetail.extractionResult.invoice.invoice_number.value}</dd>
          </div>
        )}
        {importDetail.expiresAt && (
          <div className="fact">
            <dt>Deleted if not confirmed by</dt>
            <dd>{formatDateTime(importDetail.expiresAt)}</dd>
          </div>
        )}
      </dl>

      {importDetail.statusCode === 'extracted' && <ExtractedReview key={version} data={data} onChanged={() => setVersion((v) => v + 1)} />}

      {importDetail.statusCode === 'failed' && (
        <>
          <Alert type="error">
            <AlertHeading level="h2">This file couldn't be read</AlertHeading>
            {importDetail.extractionResult?.warnings?.[0]?.message ?? 'The file could not be read.'}
          </Alert>
          {discardError && <Alert type="error" slim>{discardError}</Alert>}
          <p>Discard it and upload a corrected file, or enter the items by hand on the case page.</p>
          <Button type="button" secondary onClick={() => void discardFailed()}>Discard import</Button>
        </>
      )}

      {importDetail.statusCode === 'confirmed' && importDetail.invoiceId && (
        <Alert type="success">
          <AlertHeading level="h2">Import confirmed</AlertHeading>
          The uploaded file has been deleted.{' '}
          <RouterLink to={`/portal/invoices/${importDetail.invoiceId}`}>Open the draft invoice</RouterLink> to submit it.
        </Alert>
      )}

      {importDetail.statusCode === 'discarded' && (
        <Alert type="info">
          <AlertHeading level="h2">Import discarded</AlertHeading>
          The uploaded file has been deleted and nothing was submitted.
        </Alert>
      )}
    </div>
  );
}
