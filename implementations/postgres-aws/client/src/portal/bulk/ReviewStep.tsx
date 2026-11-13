import { Link as RouterLink } from 'react-router';
import { type ImportInProgress } from '../../api/client';
import { ImportProgressNote } from '../../components/ImportProgressNote';
import { RecordTable } from '../../components/RecordTable';
import { RemoveFileButton } from '../../components/ui/RemoveFileButton';
import { outstanding, reviewQueue, reviewUrl, sectionOf } from '../bulkImport';
import { LATER, useShell } from '../useShell';
import { buttonClass } from '../../components/ui/Button';
import { caseOf, totalWithFile } from './importCells';

export function ReviewStep({ imports, onDiscard }: { imports: ImportInProgress[]; onDiscard: (importId: string) => void }) {
  const reading = imports.filter((row) => sectionOf(row) === 'reading');
  const toReview = imports.filter((row) => sectionOf(row) === 'review');
  const unreadable = imports.filter((row) => sectionOf(row) === 'unreadable');
  const next = reviewQueue(imports)[0];
  const { newInvoicePath, staff } = useShell();
  const fileCell = (row: ImportInProgress) => (
    <span className="file-name">
      {row.fileName}
      <RemoveFileButton
        fileName={row.fileName}
        onRemove={() => onDiscard(row.invoiceImportId)}
        consequence={<>{row.fileName} is deleted, and nothing from it is sent.</>}
      />
    </span>
  );
  return (
    <section className="card compact-card bulk-step-section" id="review">
      <h2>2. Check each file</h2>
      <p className="compact-hint">
        Check what was read from each file against the original, then confirm it. Each file stays with its draft until
        you send, discard or delete it.
      </p>
      {next && (
        <div className="invoice-actions">
          <RouterLink className={buttonClass('primary')} to={reviewUrl(next)}>
            Check next: {next.fileName}
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
              { header: 'File', render: fileCell },
              { header: 'Case', render: caseOf },
              { header: 'Progress', render: (row) => <ImportProgressNote compact progress={row.progress} /> },
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
              { header: 'File', render: fileCell },
              { header: 'Case', render: caseOf },
              { header: 'Billed for', render: (row) => row.professionalDisplayName ?? '—' },
              { header: 'Total', render: totalWithFile },
              {
                header: 'Still to do',
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
              { header: 'File', render: fileCell },
              { header: 'Case', render: caseOf },
              { header: 'Why', render: (row) => row.failureMessage ?? 'The file could not be read.' },
              {
                header: '',
                render: (row) => (
                  <span className="row-actions">
                    {(row.caseId || staff) && (
                      <RouterLink to={`${newInvoicePath}?case=${row.caseId ?? LATER}`}>Enter by hand</RouterLink>
                    )}
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
