import { useEffect, useState, type FormEvent } from 'react';
import { Link as RouterLink, useLocation } from 'react-router';
import { Alert, Button, Checkbox, Form, Label, Select } from '@trussworks/react-uswds';
import {
  apiErrorMessage,
  invoiceTemplateUrl,
  listInvoiceImports,
  listMyCases,
  previewCaseSplit,
  resolveInvoiceImport,
  transitionInvoice,
  uploadInvoiceFile,
  uploadInvoiceFileByCase,
  type CaseSplitPreview,
  type ImportInProgress,
  type MyCasesResult,
} from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { PageHeading } from '../components/PageHeading';
import { RecordTable } from '../components/RecordTable';
import { ConfirmButton } from '../components/ConfirmButton';
import { caseDisplayLabel } from '../caseDisplayLabel';
import { formatMoney } from '../formatMoney';
import {
  caseChoiceGroups,
  currentStep,
  FROM_BULK,
  outstanding,
  parseChoice,
  reviewQueue,
  reviewUrl,
  sectionOf,
  suggestChoice,
  type BulkStep,
} from './bulkImport';

interface StagedFile {
  key: string;
  file: File;
  // One case and whom it bills, or one person for several cases
  // (./bulkImport.ts); empty until chosen.
  choice: string;
  uploading?: boolean;
  error?: string;
  // For one person: the file's lines, waiting for each to be given a case.
  split?: CaseSplitPreview;
}

function caseOptionLabel(row: CaseSplitPreview['cases'][number]): string {
  return caseDisplayLabel([row.externalReference, row.clientDisplayName], undefined);
}

// Every line of a one-person file gets a case before anything is created;
// suggestions come from the file's case column.
function SplitAssignment({
  staged,
  professionalId,
  whose,
  onCreated,
  onCancel,
}: {
  staged: StagedFile & { split: CaseSplitPreview };
  professionalId: string;
  // "your", or "Name's".
  whose: string;
  onCreated: () => void;
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
    setError(null);
    try {
      await uploadInvoiceFileByCase(staged.file, professionalId, caseIds);
      onCreated();
    } catch (err) {
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
      {error && <Alert type="error" slim>{error}</Alert>}
      {split.cases.length === 0 && <Alert type="warning" slim>This person has no open cases you can bill for.</Alert>}
      <RecordTable
        rows={split.lines}
        rowKey={(line) => String(line.index)}
        emptyMessage="The file has no lines."
        columns={[
          { header: 'In the file', render: (line) => line.caseLabel ?? '—' },
          { header: 'Date', render: (line) => line.serviceDate ?? '—' },
          { header: 'Description', render: (line) => line.description ?? '—' },
          { header: 'Hours', render: (line) => (line.quantity === null ? '—' : line.quantity) },
          { header: 'File says', render: (line) => <span className="amount">{formatMoney(String(line.amount))}</span> },
          {
            header: 'Billed',
            render: (line) =>
              line.billedAmount === null ? (
                <span className="line-amount-missing">
                  {!line.serviceDate ? 'Add a date on its draft' : !line.quantity ? 'Add hours on its draft' : 'No rate for this date'}
                </span>
              ) : (
                <span className="line-amount-priced">
                  <span className="amount">{formatMoney(line.billedAmount.toFixed(2))}</span>
                  {line.billedRate && (
                    <span className="line-amount-basis">
                      {line.quantity} h × {formatMoney(line.billedRate)}
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
        <Button type="button" disabled={creating || unassigned > 0} onClick={() => void create()}>
          {creating ? 'Creating…' : `Create ${draftCount} draft ${draftCount === 1 ? 'invoice' : 'invoices'}`}
        </Button>
        <Button type="button" unstyled disabled={creating} onClick={onCancel}>
          Cancel
        </Button>
        {unassigned > 0 && <span className="compact-hint">{unassigned} {unassigned === 1 ? 'line needs' : 'lines need'} a case.</span>}
      </div>
    </section>
  );
}

function StagedFiles({
  cases,
  onStagedCount,
  onUploaded,
}: {
  cases: MyCasesResult;
  // Files chosen but not yet uploaded, for the step header.
  onStagedCount: (count: number) => void;
  onUploaded: () => void;
}) {
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const groups = caseChoiceGroups(cases);
  useEffect(() => onStagedCount(staged.length), [staged.length, onStagedCount]);

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

  // One at a time, so each file's result is clear. A file for one case
  // becomes an import and leaves the list; a file for one person is read
  // and waits for its lines to be given cases.
  async function uploadAll(event: FormEvent) {
    event.preventDefault();
    setUploading(true);
    for (const row of staged) {
      const choice = parseChoice(row.choice);
      if (!choice || row.split) {
        continue;
      }
      update(row.key, { uploading: true, error: undefined });
      try {
        if (choice.kind === 'case') {
          // eslint-disable-next-line no-await-in-loop
          await uploadInvoiceFile(choice.caseId, row.file, choice.professionalId);
          setStaged((current) => current.filter((candidate) => candidate.key !== row.key));
          onUploaded();
        } else {
          // eslint-disable-next-line no-await-in-loop
          update(row.key, { uploading: false, split: await previewCaseSplit(row.file, choice.professionalId) });
        }
      } catch (err) {
        update(row.key, { uploading: false, error: apiErrorMessage(err, 'The file could not be uploaded.') });
      }
    }
    setUploading(false);
  }

  const ready = staged.filter((row) => parseChoice(row.choice) && !row.split).length;
  const splitting = staged.filter((row): row is StagedFile & { split: CaseSplitPreview } => Boolean(row.split));

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
        PDF invoices, LEDES 1998B files or the invoice template (<a href={invoiceTemplateUrl('xlsx')} download>XLSX</a> ·{' '}
        <a href={invoiceTemplateUrl('csv')} download>CSV</a>), up to 10 MB each. Each file is either for one case
        (suggested when its name includes the case reference or client's name), or for one person across several
        cases, when a spreadsheet's <code>case</code> column names each line's case; you then assign every line before
        a draft is made for each case.
      </p>
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
                      disabled={row.uploading || Boolean(row.split)}
                      onChange={(event) => update(row.key, { choice: event.target.value, error: undefined })}
                    >
                      <option value="">- Choose a case -</option>
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
                  ) : (
                    <Button
                      type="button"
                      unstyled
                      onClick={() => setStaged((current) => current.filter((candidate) => candidate.key !== row.key))}
                    >
                      Remove
                    </Button>
                  ),
              },
            ]}
          />
          <div className="invoice-actions">
            <Button type="submit" disabled={uploading || ready === 0}>
              {uploading ? 'Uploading…' : `Upload ${ready} ${ready === 1 ? 'file' : 'files'}`}
            </Button>
            {staged.some((row) => !parseChoice(row.choice)) && !uploading && (
              <span className="compact-hint">Files without a case stay here until you choose one.</span>
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
              professionalId={choice.professionalId}
              whose={person?.isSelf ? 'your' : `${person?.displayName ?? 'this person'}'s`}
              onCreated={() => {
                setStaged((current) => current.filter((candidate) => candidate.key !== row.key));
                onUploaded();
              }}
              onCancel={() => update(row.key, { split: undefined })}
            />
          )
        );
      })}
    </Form>
  );
}

function caseOf(row: ImportInProgress): string {
  return caseDisplayLabel([row.caseExternalReference, row.caseClientDisplayName], undefined);
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

// 1 Add files → 2 Review each → 3 Submit, with the current one marked.
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
  const toReview = imports.filter((row) => sectionOf(row) === 'review');
  const unreadable = imports.filter((row) => sectionOf(row) === 'unreadable');
  const next = reviewQueue(imports)[0];
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
        Check what was read from each file against the original, then confirm it. Files are kept until you confirm or
        discard them, for up to 3 days.
      </p>
      {next && (
        <div className="invoice-actions">
          <RouterLink className="usa-button" to={reviewUrl(next)}>
            Review next: {next.fileName}
          </RouterLink>
        </div>
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
                    {row.caseId && <RouterLink to={`/portal/cases/${row.caseId}#new-invoice`}>Enter by hand</RouterLink>}
                    {discardButton(row)}
                  </span>
                ),
              },
            ]}
          />
        </>
      )}
      {toReview.length === 0 && unreadable.length === 0 && <p>Nothing left to review.</p>}
    </section>
  );
}

function SubmitStep({ imports, onChanged }: { imports: ImportInProgress[]; onChanged: () => void }) {
  const ready = imports.filter((row) => sectionOf(row) === 'ready');
  // Everything ready is included unless unticked.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<{ submitted: ImportInProgress[]; errors: string[] } | null>(null);
  const chosen = ready.filter((row) => !excluded.has(row.invoiceImportId));
  const chosenTotal = chosen.reduce((sum, row) => sum + Math.round(Number(row.submittedTotal ?? 0) * 100), 0) / 100;

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
        await transitionInvoice(row.invoiceId as string, 'submit');
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
        <Alert type="success" slim>
          Submitted {results.submitted.length} {results.submitted.length === 1 ? 'invoice' : 'invoices'}:{' '}
          {results.submitted.map((row) => `${caseOf(row)} (${formatMoney(row.submittedTotal ?? '0')})`).join(', ')}.{' '}
          <a href="#bulk-files">Start another batch</a>
        </Alert>
      )}
      {results && results.errors.length > 0 && (
        <Alert type="error" slim>
          <ul>
            {results.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </Alert>
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
          <div className="invoice-actions">
            <Button type="button" disabled={submitting || chosen.length === 0} onClick={() => void submitChosen()}>
              {submitting
                ? 'Submitting…'
                : `Submit ${chosen.length} ${chosen.length === 1 ? 'invoice' : 'invoices'} · ${formatMoney(chosenTotal.toFixed(2))}`}
            </Button>
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
  const { data: imports, error: importsError } = useApiResource(
    () => listInvoiceImports().then((result) => result.imports),
    [version],
  );
  const refresh = () => setVersion((v) => v + 1);
  // Arriving from review at #submit (or #review): show that step.
  const { hash } = useLocation();
  const loaded = Boolean(imports);
  useEffect(() => {
    if (loaded && hash) {
      document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
    }
  }, [loaded, hash]);
  const queue = imports ? reviewQueue(imports) : [];
  const readyCount = imports?.filter((row) => sectionOf(row) === 'ready').length ?? 0;
  const step = currentStep(stagedCount, imports ?? []);

  async function discard(importId: string) {
    try {
      await resolveInvoiceImport(importId, 'discard');
    } finally {
      refresh();
    }
  }

  return (
    <div>
      <RouterLink className="back-link" to="/">&larr; Back to your cases</RouterLink>
      <PageHeading
        eyebrow="Your cases"
        title="Import invoices"
        description="Upload several invoice files at once, review and correct what was read from each, then submit them together."
      />
      <StepHeader step={step} toReview={queue.length} ready={readyCount} />
      {uploadedCount > 0 && stagedCount === 0 && queue.length > 0 && (
        <Alert type="success" slim className="bulk-next">
          {uploadedCount} {uploadedCount === 1 ? 'file' : 'files'} uploaded. Next, check what was read from each.{' '}
          <RouterLink to={reviewUrl(queue[0]!)}>Review next: {queue[0]!.fileName}</RouterLink>
        </Alert>
      )}
      {Boolean(casesError) && <Alert type="error">Failed to load your cases.</Alert>}
      {cases && cases.cases.length === 0 && <p>You aren't assigned to any cases yet, so there's nothing to import for.</p>}
      {cases && cases.cases.length > 0 && (
        <StagedFiles
          cases={cases}
          onStagedCount={setStagedCount}
          onUploaded={() => {
            setUploadedCount((n) => n + 1);
            refresh();
          }}
        />
      )}
      {Boolean(importsError) && <Alert type="error">Failed to load your imports.</Alert>}
      {imports && (
        <>
          <ReviewStep imports={imports} onDiscard={(importId) => void discard(importId)} />
          <SubmitStep imports={imports} onChanged={refresh} />
        </>
      )}
    </div>
  );
}
