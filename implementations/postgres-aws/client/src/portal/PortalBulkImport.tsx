import { useEffect, useState, type FormEvent } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router';
import { Checkbox, Form, Label, Select } from '@trussworks/react-uswds';
import {
  apiErrorMessage,
  deleteInvoice,
  discardCaseSplitRead,
  getCaseSplitRead,
  invoiceTemplateUrl,
  listBillableProfessionals,
  listInvoiceImports,
  listMyCases,
  resolveInvoiceImport,
  startCaseSplit,
  transitionInvoice,
  uploadInvoiceFile,
  uploadInvoiceFileByCase,
  type BillableProfessional,
  type CaseSplitPreview,
  type ImportInProgress,
  type MyCasesResult,
} from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { usePoll } from '../hooks/usePoll';
import { ImportProgressNote } from '../components/ImportProgressNote';
import { RecordTable } from '../components/RecordTable';
import { AttestationCheckbox } from '../components/AttestationCheckbox';
import { ConfirmButton } from '../components/ConfirmButton';
import { caseDisplayLabel } from '../caseDisplayLabel';
import { formatMoney, formatRate } from '../formatMoney';
import {
  caseChoiceGroups,
  currentStep,
  FROM_BULK,
  loadBatch,
  outstanding,
  parseChoice,
  reviewQueue,
  reviewUrl,
  saveBatch,
  readyToSubmit,
  sectionOf,
  suggestChoice,
  type BulkStep,
  type ParsedChoice,
} from './bulkImport';
import { Notice } from '../components/Notice';
import { PageHeader } from '../components/PageHeader';
import { useReceipt } from './ReceivedFields';
import { LATER, useShell } from './useShell';

interface StagedFile {
  key: string;
  file: File;
  // One case and whom it bills, or one person for several cases
  // (./bulkImport.ts); empty until chosen.
  choice: string;
  uploading?: boolean;
  error?: string;
  // For one person: the server's read of the file, then the file's lines,
  // waiting for each to be given a case.
  splitReadId?: string;
  split?: CaseSplitPreview;
}

// A one-person file being read on the server: its progress, then its lines.
function SplitReadProgress({
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
function SplitAssignment({
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
  const statedTotal = split.lines.reduce((sum, line) => sum + Math.round(line.amount * 100), 0) / 100;
  const billedTotal = split.lines.reduce((sum, line) => sum + Math.round((line.billedAmount ?? 0) * 100), 0) / 100;
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
    <section className="compact-card split-assignment">
      <h3>Assign each line of {staged.file.name} to a case</h3>
      <p className="compact-hint">
        Every line is recorded as {whose} work. Each case becomes its own draft invoice. Cases are suggested where
        the file's case column matches a case reference or client name; check them.
      </p>
      {error && <Notice tone="danger">{error}</Notice>}
      {split.cases.length === 0 && <Notice tone="warning">This person has no open cases you can bill for.</Notice>}
      <RecordTable
        rows={split.lines}
        rowKey={(line) => String(line.index)}
        emptyMessage="The file has no lines."
        columns={[
          { header: 'In the file', render: (line) => line.caseLabel ?? '—' },
          { header: 'Date', render: (line) => line.serviceDate ?? '—' },
          { header: 'Description', render: (line) => line.description ?? '—' },
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
        <button type="button" className="btn btn--primary" disabled={creating || unassigned > 0} onClick={() => void create()}>
          {creating ? 'Creating…' : `Create ${draftCount} draft ${draftCount === 1 ? 'invoice' : 'invoices'}`}
        </button>
        <button type="button" className="link-button" disabled={creating} onClick={onCancel}>
          Cancel
        </button>
        {unassigned > 0 && <span className="compact-hint">{unassigned} {unassigned === 1 ? 'line needs' : 'lines need'} a case.</span>}
      </div>
    </section>
  );
}

function StagedFiles({
  cases,
  noCase,
  onStagedCount,
  onUploading,
  onUploaded,
}: {
  cases: MyCasesResult;
  // Staff only: whom a file with no case yet may be from.
  noCase: BillableProfessional[];
  // Files chosen but not yet uploaded, for the step header.
  onStagedCount: (count: number) => void;
  // Cancel waits while files are uploading, so none are left untracked.
  onUploading: (uploading: boolean) => void;
  onUploaded: (importIds: string[]) => void;
}) {
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [splitsCreating, setSplitsCreating] = useState(0);
  const groups = caseChoiceGroups(cases, noCase);
  // Staff may upload a file with nothing chosen: no case or professional yet.
  const blankUploads = noCase.length > 0;
  const choiceOf = (row: StagedFile): ParsedChoice | undefined =>
    parseChoice(row.choice) ?? (blankUploads ? { kind: 'no_case' } : undefined);
  useEffect(() => onStagedCount(staged.length), [staged.length, onStagedCount]);
  useEffect(() => onUploading(uploading || splitsCreating > 0), [uploading, splitsCreating, onUploading]);

  function add(files: FileList | null) {
    const added = [...(files ?? [])].map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
      file,
      choice: suggestChoice(file.name, cases) ?? '',
    }));
    setStaged((current) => [...current, ...added]);
  }

  function update(key: string, changes: Partial<StagedFile>) {
    setStaged((current) => current.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  }

  // One at a time, so each file's result is clear. A one-person file is
  // only read here, on the server in the background; its drafts are made
  // once its lines have cases.
  async function uploadAll(event: FormEvent) {
    event.preventDefault();
    setUploading(true);
    for (const row of staged) {
      const choice = choiceOf(row);
      if (!choice || row.splitReadId) {
        continue;
      }
      update(row.key, { uploading: true, error: undefined });
      try {
        if (choice.kind === 'case' || choice.kind === 'no_case') {
          // eslint-disable-next-line no-await-in-loop
          const { invoiceImportId } = await uploadInvoiceFile(
            choice.kind === 'case' ? choice.caseId : null,
            row.file,
            choice.professionalId,
          );
          setStaged((current) => current.filter((candidate) => candidate.key !== row.key));
          onUploaded([invoiceImportId]);
        } else {
          // eslint-disable-next-line no-await-in-loop
          const { splitReadId } = await startCaseSplit(row.file, choice.professionalId);
          update(row.key, { uploading: false, splitReadId });
        }
      } catch (err) {
        update(row.key, { uploading: false, error: apiErrorMessage(err, 'The file could not be uploaded.') });
      }
    }
    setUploading(false);
  }

  const ready = staged.filter((row) => choiceOf(row) && !row.splitReadId).length;
  const splitting = staged.filter((row): row is StagedFile & { split: CaseSplitPreview; splitReadId: string } =>
    Boolean(row.split && row.splitReadId),
  );

  // Stops the server reading a one-person file, or forgets its reading.
  function dropSplit(row: StagedFile) {
    if (row.splitReadId) {
      void discardCaseSplitRead(row.splitReadId).catch(() => undefined);
    }
    update(row.key, { splitReadId: undefined, split: undefined });
  }

  return (
    <Form className="compact-form compact-card" onSubmit={(event) => void uploadAll(event)}>
      <h2>1. Add files</h2>
      <div className="usa-form-group">
        <Label htmlFor="bulk-files">Invoice files</Label>
        <input
          id="bulk-files"
          name="bulkFiles"
          type="file"
          multiple
          className="compact-file"
          accept=".pdf,.txt,.ledes,.csv,.xlsx"
          aria-describedby="bulk-files-hint"
          onChange={(event) => {
            add(event.target.files);
            event.target.value = '';
          }}
        />
      </div>
      <p className="compact-hint" id="bulk-files-hint">
        PDFs, LEDES 1998B files or the template (<a href={invoiceTemplateUrl('xlsx')} download>XLSX</a> ·{' '}
        <a href={invoiceTemplateUrl('csv')} download>CSV</a>), up to 10 MB each. Then choose each file's case.
      </p>
      <ul className="compact-hint">
        <li>One person's spreadsheet covering several cases: choose "split by case".</li>
        {blankUploads && <li>Case or provider not known yet: leave it blank and match it later on Intake.</li>}
      </ul>
      {staged.length > 0 && (
        <>
          <RecordTable
            rows={staged}
            rowKey={(row) => row.key}
            emptyMessage=""
            columns={[
              { header: 'File', render: (row) => row.file.name },
              {
                header: 'Case',
                render: (row) => (
                  <>
                    <Select
                      id={`bulk-case-${row.key}`}
                      name={`bulk-case-${row.key}`}
                      aria-label={`Case for ${row.file.name}`}
                      value={row.choice}
                      disabled={row.uploading || Boolean(row.splitReadId)}
                      onChange={(event) => update(row.key, { choice: event.target.value, error: undefined })}
                    >
                      <option value="">{blankUploads ? 'No case or provider yet' : '- Choose a case -'}</option>
                      {groups.map((group) => (
                        <optgroup key={group.label} label={group.label}>
                          {group.choices.map((choice) => (
                            <option key={choice.value} value={choice.value}>
                              {choice.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </Select>
                    {row.error && <span className="line-row-error">{row.error}</span>}
                  </>
                ),
              },
              {
                header: '',
                render: (row) =>
                  row.uploading ? (
                    <span role="status">Uploading…</span>
                  ) : row.split ? (
                    <span>Assign cases below</span>
                  ) : row.splitReadId ? (
                    <span className="row-actions">
                      <SplitReadProgress
                        splitReadId={row.splitReadId}
                        onReady={(split) => update(row.key, { split })}
                        onFailed={(message) => update(row.key, { splitReadId: undefined, error: message })}
                      />
                      <button type="button" className="link-button" onClick={() => dropSplit(row)}>
                        Stop
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setStaged((current) => current.filter((candidate) => candidate.key !== row.key))}
                    >
                      Remove
                    </button>
                  ),
              },
            ]}
          />
          <div className="invoice-actions">
            <button type="submit" className="btn btn--primary" disabled={uploading || ready === 0}>
              {uploading ? 'Uploading…' : `Upload ${ready} ${ready === 1 ? 'file' : 'files'}`}
            </button>
            {staged.some((row) => !choiceOf(row)) && !uploading && (
              <span className="compact-hint">Choose a case for each file to upload it.</span>
            )}
          </div>
        </>
      )}
      {splitting.map((row) => {
        const choice = parseChoice(row.choice);
        const person = cases.professionals.find((professional) => professional.professionalId === choice?.professionalId);
        return (
          choice && (
            <SplitAssignment
              key={row.key}
              staged={row}
              whose={person?.isSelf ? 'your' : `${person?.displayName ?? 'this person'}'s`}
              onBusy={(busy) => setSplitsCreating((n) => n + (busy ? 1 : -1))}
              onCreated={(importIds) => {
                setStaged((current) => current.filter((candidate) => candidate.key !== row.key));
                onUploaded(importIds);
              }}
              onCancel={() => dropSplit(row)}
            />
          )
        );
      })}
    </Form>
  );
}

function caseOf(row: ImportInProgress): string {
  return row.caseId ? caseDisplayLabel([row.caseExternalReference, row.caseClientDisplayName], undefined) : 'No case yet';
}

function totalWithFile(row: ImportInProgress) {
  return (
    <>
      <span className="amount">{formatMoney(row.submittedTotal ?? '0')}</span>
      {row.statedTotal !== null && Number(row.statedTotal) !== Number(row.submittedTotal) && (
        <span className="line-amount-basis"> (file said {formatMoney(row.statedTotal)})</span>
      )}
    </>
  );
}

function StepHeader({ step, toReview, ready }: { step: BulkStep; toReview: number; ready: number }) {
  const steps: Array<[BulkStep, string]> = [
    [1, 'Add files'],
    [2, toReview > 0 ? `Review each (${toReview} left)` : 'Review each'],
    [3, ready > 0 ? `Submit (${ready} ready)` : 'Submit'],
  ];
  return (
    <ol className="bulk-steps" aria-label="Import steps">
      {steps.map(([number, label]) => (
        <li key={number} className={number === step ? 'is-current' : number < step ? 'is-done' : undefined} aria-current={number === step ? 'step' : undefined}>
          <span className="bulk-step-number">{number}</span> {label}
        </li>
      ))}
    </ol>
  );
}

function ReviewStep({ imports, onDiscard }: { imports: ImportInProgress[]; onDiscard: (importId: string) => void }) {
  const reading = imports.filter((row) => sectionOf(row) === 'reading');
  const toReview = imports.filter((row) => sectionOf(row) === 'review');
  const unreadable = imports.filter((row) => sectionOf(row) === 'unreadable');
  const next = reviewQueue(imports)[0];
  const { newInvoicePath, staff } = useShell();
  const discardButton = (row: ImportInProgress) => (
    <ConfirmButton
      compact
      label="Discard"
      prompt="Discard this import? The file is deleted and nothing is submitted."
      confirmLabel="Yes, discard"
      onConfirm={() => onDiscard(row.invoiceImportId)}
    />
  );
  return (
    <section className="bulk-step-section" id="review">
      <h2>2. Review each file</h2>
      <p className="compact-hint">
        Check what was read from each file against the original, then confirm it. Each file stays with its draft until
        you send, discard or delete it.
      </p>
      {next && (
        <div className="invoice-actions">
          <RouterLink className="btn btn--primary" to={reviewUrl(next)}>
            Review next: {next.fileName}
          </RouterLink>
        </div>
      )}
      {reading.length > 0 && (
        <>
          <h3>Being read ({reading.length})</h3>
          <p className="compact-hint">
            Scans and files that need a closer look take longer. They move to review on their own; you can review
            others meanwhile.
          </p>
          <RecordTable
            rows={reading}
            rowKey={(row) => row.invoiceImportId}
            emptyMessage=""
            columns={[
              { header: 'File', render: (row) => row.fileName },
              { header: 'Case', render: caseOf },
              { header: 'Progress', render: (row) => <ImportProgressNote compact progress={row.progress} /> },
              { header: '', render: (row) => <span className="row-actions">{discardButton(row)}</span> },
            ]}
          />
        </>
      )}
      {toReview.length > 0 && (
        <>
          <h3>Needs your review ({toReview.length})</h3>
          <RecordTable
            rows={toReview}
            rowKey={(row) => row.invoiceImportId}
            emptyMessage=""
            columns={[
              { header: 'File', render: (row) => row.fileName },
              { header: 'Case', render: caseOf },
              { header: 'Billing for', render: (row) => row.professionalDisplayName ?? '—' },
              { header: 'Total', render: totalWithFile },
              {
                header: "What's left",
                render: (row) => {
                  const notes = outstanding(row);
                  return notes.length > 0 ? notes.join(' · ') : 'Check and confirm';
                },
              },
              {
                header: '',
                render: (row) => (
                  <span className="row-actions">
                    <RouterLink to={reviewUrl(row)}>Review</RouterLink>
                    {discardButton(row)}
                  </span>
                ),
              },
            ]}
          />
        </>
      )}
      {unreadable.length > 0 && (
        <>
          <h3>Couldn't be read ({unreadable.length})</h3>
          <RecordTable
            rows={unreadable}
            rowKey={(row) => row.invoiceImportId}
            emptyMessage=""
            columns={[
              { header: 'File', render: (row) => row.fileName },
              { header: 'Case', render: caseOf },
              { header: 'Why', render: (row) => row.failureMessage ?? 'The file could not be read.' },
              {
                header: '',
                render: (row) => (
                  <span className="row-actions">
                    {(row.caseId || staff) && (
                      <RouterLink to={`${newInvoicePath}?case=${row.caseId ?? LATER}`}>Enter by hand</RouterLink>
                    )}
                    {discardButton(row)}
                  </span>
                ),
              },
            ]}
          />
        </>
      )}
      {reading.length === 0 && toReview.length === 0 && unreadable.length === 0 && <p>Nothing left to review.</p>}
    </section>
  );
}

function SubmitStep({ imports, onChanged }: { imports: ImportInProgress[]; onChanged: () => void }) {
  const ready = readyToSubmit(imports);
  const waiting = imports.filter((row) => sectionOf(row) === 'ready').length - ready.length;
  const { newInvoicePath, newInvoiceLabel, staff } = useShell();
  // A submitter confirms once for the batch; staff don't attest.
  const [attested, setAttested] = useState(false);
  // Everything ready is included unless unticked.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<{ submitted: ImportInProgress[]; errors: string[] } | null>(null);
  const chosen = ready.filter((row) => !excluded.has(row.invoiceImportId));
  const chosenTotal = chosen.reduce((sum, row) => sum + Math.round(Number(row.submittedTotal ?? 0) * 100), 0) / 100;
  // Staff say once how and when this batch was received.
  const receipt = useReceipt('bulk');

  function toggle(importId: string, included: boolean) {
    setExcluded((current) => {
      const next = new Set(current);
      if (included) {
        next.delete(importId);
      } else {
        next.add(importId);
      }
      return next;
    });
  }

  async function submitChosen() {
    setSubmitting(true);
    setResults(null);
    const submitted: ImportInProgress[] = [];
    const errors: string[] = [];
    for (const row of chosen) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await transitionInvoice(row.invoiceId as string, 'submit', { ...receipt.payload, attested: staff ? undefined : attested });
        submitted.push(row);
      } catch (err) {
        errors.push(`${row.fileName}: ${apiErrorMessage(err, 'could not be submitted.')}`);
      }
    }
    setResults({ submitted, errors });
    setExcluded(new Set());
    setSubmitting(false);
    onChanged();
  }

  return (
    <section className="bulk-step-section" id="submit">
      <h2>3. Submit</h2>
      {results && results.submitted.length > 0 && (
        <Notice tone="success">
          Submitted {results.submitted.length} {results.submitted.length === 1 ? 'invoice' : 'invoices'}:{' '}
          {results.submitted.map((row) => `${caseOf(row)} (${formatMoney(row.submittedTotal ?? '0')})`).join(', ')}.{' '}
          <a href="#bulk-files">Start another batch</a>
        </Notice>
      )}
      {results && results.errors.length > 0 && (
        <Notice tone="danger">
          <ul>
            {results.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </Notice>
      )}
      {waiting > 0 && (
        <Notice tone="info">
          {waiting} confirmed {waiting === 1 ? 'invoice has' : 'invoices have'} no case yet and{' '}
          {waiting === 1 ? 'waits' : 'wait'} on <RouterLink to={newInvoicePath}>{newInvoiceLabel}</RouterLink> to be matched to a case.
        </Notice>
      )}
      {ready.length === 0 ? (
        <p>Confirmed files appear here, ready to submit together.</p>
      ) : (
        <>
          <RecordTable
            rows={ready}
            rowKey={(row) => row.invoiceImportId}
            emptyMessage=""
            columns={[
              {
                header: 'Include',
                render: (row) => (
                  <Checkbox
                    id={`bulk-submit-${row.invoiceImportId}`}
                    name={`bulk-submit-${row.invoiceImportId}`}
                    label={<span className="usa-sr-only">Include {row.fileName}</span>}
                    checked={!excluded.has(row.invoiceImportId)}
                    onChange={(event) => toggle(row.invoiceImportId, event.target.checked)}
                  />
                ),
              },
              { header: 'Case', render: caseOf },
              { header: 'Billing for', render: (row) => row.professionalDisplayName ?? '—' },
              { header: 'File', render: (row) => row.fileName },
              { header: 'Total', render: totalWithFile },
              {
                header: '',
                render: (row) => <RouterLink to={`/portal/invoices/${row.invoiceId}${FROM_BULK}`}>Edit</RouterLink>,
              },
            ]}
          />
          {receipt.fields}
          {!staff && <AttestationCheckbox id="bulk-attested" checked={attested} onChange={setAttested} />}
          <div className="invoice-actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={submitting || chosen.length === 0 || receipt.missing || (!staff && !attested)}
              onClick={() => void submitChosen()}
            >
              {submitting
                ? 'Submitting…'
                : `Submit ${chosen.length} ${chosen.length === 1 ? 'invoice' : 'invoices'} · ${formatMoney(chosenTotal.toFixed(2))}`}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export default function PortalBulkImport() {
  const [version, setVersion] = useState(0);
  const [stagedCount, setStagedCount] = useState(0);
  const [uploadedCount, setUploadedCount] = useState(0);
  const { data: cases, error: casesError } = useApiResource(() => listMyCases(), []);
  const { staff, newInvoicePath, newInvoiceLabel } = useShell();
  // Staff may import for any active professional with no case yet.
  const { data: noCase } = useApiResource(
    () => (staff ? listBillableProfessionals(null).then((result) => result.professionals) : Promise.resolve([])),
    [staff],
  );
  const { data: imports, error: importsError } = useApiResource(
    () => listInvoiceImports().then((result) => result.imports),
    [version],
  );
  const refresh = () => setVersion((v) => v + 1);
  // While files are being read, poll for their progress; reload everything
  // when one finishes.
  const readingIds = (rows: ImportInProgress[]) =>
    rows
      .filter((row) => sectionOf(row) === 'reading')
      .map((row) => row.invoiceImportId)
      .join();
  const anyReading = (imports ?? []).some((row) => sectionOf(row) === 'reading');
  const polled = usePoll(() => listInvoiceImports().then((result) => result.imports), anyReading, 2000);
  const pollCurrent = Boolean(imports && polled && readingIds(polled) === readingIds(imports));
  useEffect(() => {
    if (anyReading && polled && !pollCurrent) {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polled]);
  const shownImports = anyReading && pollCurrent ? polled : imports;
  // React Router doesn't scroll to #submit after review sends the user here.
  const { hash } = useLocation();
  const loaded = Boolean(imports);
  useEffect(() => {
    if (loaded && hash) {
      document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
    }
  }, [loaded, hash]);
  const queue = imports ? reviewQueue(imports) : [];
  const readyCount = imports ? readyToSubmit(imports).length : 0;
  const step = currentStep(stagedCount, imports ?? []);

  // This browser session's uploads still in progress; other imports and
  // anything submitted are left alone.
  const navigate = useNavigate();
  const [batch, setBatch] = useState<string[]>(loadBatch);
  const batchInProgress = (imports ?? []).filter((row) => batch.includes(row.invoiceImportId));
  useEffect(() => saveBatch(batch), [batch]);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [uploadingNow, setUploadingNow] = useState(false);

  async function cancel() {
    setCancelling(true);
    setCancelError(null);
    const failed: string[] = [];
    for (const row of batchInProgress) {
      try {
        // A confirmed draft has no file left, only the draft to remove.
        // eslint-disable-next-line no-await-in-loop
        await (sectionOf(row) === 'ready' && row.invoiceId
          ? deleteInvoice(row.invoiceId)
          : resolveInvoiceImport(row.invoiceImportId, 'discard'));
      } catch {
        failed.push(row.fileName);
      }
    }
    if (failed.length > 0) {
      setCancelError(`These couldn't be discarded: ${failed.join(', ')}. Try again or discard them below.`);
      setCancelling(false);
      setConfirmingCancel(false);
      refresh();
      return;
    }
    setBatch([]);
    saveBatch([]);
    navigate(newInvoicePath);
  }

  async function discard(importId: string) {
    try {
      await resolveInvoiceImport(importId, 'discard');
    } finally {
      refresh();
    }
  }

  return (
    <div>
      <PageHeader
        crumbs={[{ label: newInvoiceLabel, to: newInvoicePath }, { label: 'Import invoices' }]}
        title="Import invoices"
        description="Upload several invoice files at once, review and correct what was read from each, then submit them together."
        actions={
          (stagedCount > 0 || batchInProgress.length > 0) &&
          !confirmingCancel &&
          !uploadingNow && (
            <button type="button" className="btn btn--outline" onClick={() => setConfirmingCancel(true)}>
              Cancel import
            </button>
          )
        }
      />
      {confirmingCancel && (
        <Notice
          tone="warning"
          action={
            <span className="row-actions">
              <button type="button" className="btn btn--danger" disabled={cancelling || uploadingNow} onClick={() => void cancel()}>
                {cancelling ? 'Cancelling…' : 'Yes, cancel'}
              </button>
              <button type="button" className="link-button" disabled={cancelling} onClick={() => setConfirmingCancel(false)}>
                Keep going
              </button>
            </span>
          }
        >
          {batchInProgress.length > 0
            ? `Cancel this import? The ${batchInProgress.length} ${batchInProgress.length === 1 ? 'file' : 'files'} you uploaded in this session ${batchInProgress.length === 1 ? 'is' : 'are'} discarded and nothing from ${batchInProgress.length === 1 ? 'it' : 'them'} is submitted.`
            : "Cancel this import? The files you've chosen aren't uploaded."}
        </Notice>
      )}
      {cancelError && <Notice tone="danger">{cancelError}</Notice>}
      <StepHeader step={step} toReview={queue.length} ready={readyCount} />
      {uploadedCount > 0 && stagedCount === 0 && queue.length > 0 && (
        <Notice tone="success">
          {uploadedCount} {uploadedCount === 1 ? 'file' : 'files'} uploaded. Next, check what was read from each.{' '}
          <RouterLink to={reviewUrl(queue[0]!)}>Review next: {queue[0]!.fileName}</RouterLink>
        </Notice>
      )}
      {Boolean(casesError) && <Notice tone="danger">Failed to load your cases.</Notice>}
      {cases && cases.cases.length === 0 && !staff && <p>You aren't assigned to any cases yet, so there's nothing to import for.</p>}
      {cases && noCase && (cases.cases.length > 0 || staff) && (
        <StagedFiles
          cases={cases}
          noCase={noCase}
          onStagedCount={setStagedCount}
          onUploading={setUploadingNow}
          onUploaded={(importIds) => {
            setUploadedCount((n) => n + 1);
            setBatch((current) => [...current, ...importIds]);
            refresh();
          }}
        />
      )}
      {Boolean(importsError) && <Notice tone="danger">Failed to load your imports.</Notice>}
      {imports && (
        <>
          <ReviewStep imports={shownImports ?? imports} onDiscard={(importId) => void discard(importId)} />
          <SubmitStep imports={imports} onChanged={refresh} />
        </>
      )}
    </div>
  );
}
