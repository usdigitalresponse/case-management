import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { Checkbox } from '@trussworks/react-uswds';
import { apiErrorMessage, transitionInvoice, type ImportInProgress } from '../../api/client';
import { RecordTable } from '../../components/RecordTable';
import { AttestationCheckbox } from '../../components/AttestationCheckbox';
import { formatMoney, sumMoney } from '../../formatMoney';
import { FROM_BULK, readyToSubmit, sectionOf } from '../bulkImport';
import { Notice } from '../../components/ui/Notice';
import { useReceipt } from '../ReceivedFields';
import { useShell } from '../useShell';
import { Button } from '../../components/ui/Button';
import { caseOf, totalWithFile } from './importCells';

export function SubmitStep({ imports, onChanged }: { imports: ImportInProgress[]; onChanged: () => void }) {
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
  const chosenTotal = sumMoney(chosen.map((row) => row.submittedTotal));
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
    <section className="card compact-card bulk-step-section" id="submit">
      <h2>3. Send</h2>
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
              { header: 'Billed for', render: (row) => row.professionalDisplayName ?? '—' },
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
            <Button
              kind="primary"
              disabled={submitting || chosen.length === 0 || receipt.missing || (!staff && !attested)}
              onClick={() => void submitChosen()}
            >
              {submitting
                ? 'Sending…'
                : `Send ${chosen.length} ${chosen.length === 1 ? 'invoice' : 'invoices'} for review · ${formatMoney(chosenTotal.toFixed(2))}`}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
