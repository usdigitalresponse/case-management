import { useEffect, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router';
import { deleteInvoice, listInvoiceImports, resolveInvoiceImport, type ImportInProgress } from '../api/client';
import { useResource } from '../hooks/useResource';
import { billableProfessionals, invoiceImports, myCases } from '../resources';
import { usePoll } from '../hooks/usePoll';
import { currentStep, loadBatch, reviewQueue, reviewUrl, saveBatch, readyToSubmit, sectionOf, type BulkStep } from './bulkImport';
import { Notice } from '../components/ui/Notice';
import { PageHeader } from '../components/PageHeader';
import { useShell } from './useShell';
import { Button } from '../components/ui/Button';
import { Steps } from '../components/ui/Steps';
import { StagedFiles } from './bulk/StagedFiles';
import { ReviewStep } from './bulk/ReviewStep';
import { SubmitStep } from './bulk/SubmitStep';

function StepHeader({ step, toReview, ready }: { step: BulkStep; toReview: number; ready: number }) {
  const steps = ['Upload', toReview > 0 ? `Check (${toReview} left)` : 'Check', ready > 0 ? `Send for review (${ready} ready)` : 'Send for review'];
  return <Steps label="Import steps" current={step - 1} steps={steps} />;
}

export default function PortalBulkImport() {
  const [version, setVersion] = useState(0);
  const [stagedCount, setStagedCount] = useState(0);
  const [uploadedCount, setUploadedCount] = useState(0);
  const { data: cases, error: casesError } = useResource(myCases);
  const { staff, newInvoicePath, newInvoiceLabel } = useShell();
  // Staff may import for any active professional with no case yet.
  const { data: billableNoCase } = useResource(staff ? billableProfessionals(null) : null);
  const noCase = staff ? billableNoCase : [];
  const { data: imports, error: importsError } = useResource(invoiceImports, { resetKey: version });
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
        list
        crumbs={[{ label: newInvoiceLabel, to: newInvoicePath }, { label: 'Upload invoices' }]}
        title="Upload invoices"
        description="Upload several invoice files at once, check what was read from each, then send them together."
        actions={
          (stagedCount > 0 || batchInProgress.length > 0) &&
          !confirmingCancel &&
          !uploadingNow && (
            <Button kind="secondary" onClick={() => setConfirmingCancel(true)}>
              Cancel import
            </Button>
          )
        }
      />
      {confirmingCancel && (
        <Notice
          tone="warning"
          action={
            <span className="row-actions">
              <Button kind="danger" disabled={cancelling || uploadingNow} onClick={() => void cancel()}>
                {cancelling ? 'Cancelling…' : 'Yes, cancel'}
              </Button>
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
          <RouterLink to={reviewUrl(queue[0]!)}>Check next: {queue[0]!.fileName}</RouterLink>
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
