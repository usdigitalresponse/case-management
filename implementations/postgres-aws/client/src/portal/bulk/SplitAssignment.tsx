import { useEffect, useState } from 'react';
import { Select } from '@trussworks/react-uswds';
import { apiErrorMessage, getCaseSplitRead, uploadInvoiceFileByCase, type CaseSplitPreview } from '../../api/client';
import { usePoll } from '../../hooks/usePoll';
import { ImportProgressNote } from '../../components/ImportProgressNote';
import { RecordTable } from '../../components/RecordTable';
import { caseDisplayLabel } from '../../caseDisplayLabel';
import { formatMoney, formatRate, sumMoney } from '../../formatMoney';
import { Notice } from '../../components/ui/Notice';
import { Button } from '../../components/ui/Button';
import type { StagedFile } from './stagedFile';

// A one-person file being read on the server: its progress, then its lines.
export function SplitReadProgress({
  splitReadId,
  onReady,
  onFailed,
}: {
  splitReadId: string;
  onReady: (preview: CaseSplitPreview) => void;
  onFailed: (message: string) => void;
}) {
  const read = usePoll(() => getCaseSplitRead(splitReadId), true, 2000, splitReadId);
  useEffect(() => {
    if (read?.status === 'ready') {
      onReady(read.preview);
    } else if (read?.status === 'failed') {
      onFailed(read.failureMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read]);
  return <ImportProgressNote compact progress={read?.status === 'reading' ? read.progress : null} />;
}

function caseOptionLabel(row: CaseSplitPreview['cases'][number]): string {
  return caseDisplayLabel([row.externalReference, row.clientDisplayName], undefined);
}

// Every line of a one-person file gets a case before anything is created;
// suggestions come from the file's case column.
export function SplitAssignment({
  staged,
  whose,
  onBusy,
  onCreated,
  onCancel,
}: {
  staged: StagedFile & { split: CaseSplitPreview; splitReadId: string };
  // "your", or "Name's".
  whose: string;
  onBusy: (busy: boolean) => void;
  onCreated: (importIds: string[]) => void;
  onCancel: () => void;
}) {
  const { split } = staged;
  const [caseIds, setCaseIds] = useState<string[]>(() => split.lines.map((line) => line.suggestedCaseId ?? ''));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unassigned = caseIds.filter((caseId) => !caseId).length;
  const draftCount = new Set(caseIds.filter(Boolean)).size;
  const statedTotal = sumMoney(split.lines.map((line) => line.amount));
  const billedTotal = sumMoney(split.lines.map((line) => line.billedAmount));
  const allPriced = split.lines.every((line) => line.billedAmount !== null);

  async function create() {
    setCreating(true);
    onBusy(true);
    setError(null);
    try {
      const { imports } = await uploadInvoiceFileByCase(staged.splitReadId, caseIds);
      onBusy(false);
      onCreated(imports.map((row) => row.invoiceImportId));
    } catch (err) {
      onBusy(false);
      setError(apiErrorMessage(err, 'The drafts could not be created.'));
      setCreating(false);
    }
  }

  return (
    <section className="card compact-card split-assignment">
      <h3>Assign each line of {staged.file.name} to a case</h3>
      <p className="compact-hint">
        Every line is recorded as {whose} work. Each case becomes its own draft invoice. Cases are suggested where
        the file's case column, or a PDF's own text, names a case number or client; check them.
      </p>
      {error && <Notice tone="danger">{error}</Notice>}
      {split.cases.length === 0 && <Notice tone="warning">This person has no open cases you can bill for.</Notice>}
      <RecordTable
        rows={split.lines}
        rowKey={(line) => String(line.index)}
        emptyMessage="The file has no lines."
        rowNote={(line) => line.description ?? '—'}
        columns={[
          { header: 'In the file', render: (line) => line.caseLabel ?? '—' },
          { header: 'Date', render: (line) => line.serviceDate ?? '—' },
          {
            header: 'Hours / miles',
            render: (line) => (line.quantity === null ? '—' : `${line.quantity}${line.lineType === 'mileage' ? ' mi' : ''}`),
          },
          { header: 'File says', render: (line) => <span className="amount">{formatMoney(String(line.amount))}</span> },
          {
            header: 'Billed',
            render: (line) =>
              line.billedAmount === null ? (
                <span className="line-amount-missing">
                  {!line.serviceDate
                    ? 'Add a date on its draft'
                    : !line.quantity
                      ? `Add ${line.lineType === 'mileage' ? 'miles' : 'hours'} on its draft`
                      : 'No rate for this date'}
                </span>
              ) : (
                <span className="line-amount-priced">
                  <span className="amount">{formatMoney(line.billedAmount.toFixed(2))}</span>
                  {line.billedRate && (
                    <span className="line-amount-basis">
                      {line.quantity} {line.lineType === 'mileage' ? 'mi' : 'h'} × {formatRate(line.billedRate)}
                    </span>
                  )}
                </span>
              ),
          },
          {
            header: 'Case',
            render: (line) => (
              <Select
                id={`split-${staged.key}-${line.index}`}
                name={`split-${staged.key}-${line.index}`}
                aria-label={`Case for ${line.location}`}
                value={caseIds[line.index] ?? ''}
                validationStatus={caseIds[line.index] ? undefined : 'error'}
                onChange={(event) =>
                  setCaseIds((current) => current.map((value, index) => (index === line.index ? event.target.value : value)))
                }
              >
                <option value="">- Choose a case -</option>
                {split.cases.map((option) => (
                  <option key={option.caseId} value={option.caseId}>
                    {caseOptionLabel(option)}
                  </option>
                ))}
              </Select>
            ),
          },
        ]}
      />
      <p className="line-total">
        The file totals {formatMoney(statedTotal.toFixed(2))};{' '}
        <strong>
          {allPriced ? '' : 'so far '}
          {formatMoney(billedTotal.toFixed(2))}
        </strong>{' '}
        at configured rates. You can still correct dates and hours on each draft.
      </p>
      <div className="invoice-actions">
        <Button type="button" kind="primary" disabled={creating || unassigned > 0} onClick={() => void create()}>
          {creating ? 'Creating…' : `Create ${draftCount} draft ${draftCount === 1 ? 'invoice' : 'invoices'}`}
        </Button>
        <button type="button" className="link-button" disabled={creating} onClick={onCancel}>
          Cancel
        </button>
        {unassigned > 0 && <span className="compact-hint">{unassigned} {unassigned === 1 ? 'line needs' : 'lines need'} a case.</span>}
      </div>
    </section>
  );
}
