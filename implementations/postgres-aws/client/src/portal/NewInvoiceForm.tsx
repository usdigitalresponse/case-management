import { useEffect, useState, type FormEvent } from 'react';
import { Form, FormGroup, Label, Select } from '@trussworks/react-uswds';
import { apiErrorMessage, createInvoice, type BillableProfessional, type InvoiceReceipt, type TimeEntryRecord } from '../api/client';
import { lineFromTimeEntry, UnbilledTimePicker } from '../components/UnbilledTimePicker';
import { RulesInForce, usePortalBillingRules } from '../components/BillingRules';
import {
  emptyLine,
  hasInvoiceItems,
  InvoiceLinesEditor,
  linesFromDrafts,
  professionalLabel,
  type LineDraft,
} from '../components/InvoiceLinesEditor';
import { InvoiceImportForm } from '../components/InvoiceImportForm';
import { PeriodFields } from '../components/PeriodFields';
import { Notice } from '../components/Notice';
import { hasReceipt, ReceivedFields } from './ReceivedFields';
import { useShell } from './useShell';

// A new invoice on one case: typed items (starting from unbilled time) or an
// imported file. Shared by the case page and the New invoice page. With no
// case (staff only), it is saved to invoice intake.
export function NewInvoiceForm({
  caseId,
  billable,
  entries,
  onSaved,
}: {
  caseId: string | null;
  billable: BillableProfessional[];
  entries: TimeEntryRecord[] | null;
  // Billing changes what time is unbilled.
  onSaved: () => void;
}) {
  const billingRules = usePortalBillingRules();
  const { staff } = useShell();
  // Defaults to the user's own profile; a delegate picks whom they bill for,
  // and staff always choose who it's from.
  const [billedProfessionalId, setBilledProfessionalId] = useState(
    () => (billable.find((p) => p.isSelf) ?? (staff ? undefined : billable[0]))?.professionalId ?? '',
  );
  const billableIds = new Set(billable.map((p) => p.professionalId));
  const unbilled = (entries ?? []).filter((entry) => !entry.billing && billableIds.has(entry.professionalId));
  // A new invoice starts as the billed professional's unbilled time.
  const startingLines = (professionalId: string): LineDraft[] => {
    const own = unbilled.filter((entry) => entry.professionalId === professionalId).map(lineFromTimeEntry);
    return own.length > 0 ? own : [emptyLine];
  };
  const [lines, setLinesState] = useState<LineDraft[]>(() => startingLines(billedProfessionalId));
  // Untouched, the form follows recorded time as it loads and changes; once
  // edited, only a save or a new "Billing for" starts it again.
  const [touched, setTouched] = useState(false);
  const setLines = (next: LineDraft[]) => {
    setLinesState(next);
    setTouched(true);
  };
  const startAgain = (professionalId: string) => {
    setLinesState(startingLines(professionalId));
    setTouched(false);
  };
  useEffect(() => {
    if (!touched) {
      setLinesState(startingLines(billedProfessionalId));
    }
  }, [entries]);
  const [period, setPeriod] = useState({ start: '', end: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState<'draft' | 'submitted' | null>(null);
  const [mode, setMode] = useState<'enter' | 'import'>('enter');
  const [receipt, setReceipt] = useState<InvoiceReceipt>({});

  // Nothing to save until an item has an amount and someone is billed.
  const canSave = hasInvoiceItems(lines) && Boolean(billedProfessionalId);

  async function save(submit: boolean) {
    setSubmitError(null);
    setSaved(null);
    setSubmitting(true);
    try {
      await createInvoice({
        caseId,
        submit,
        professionalId: billedProfessionalId || undefined,
        periodStart: period.start || undefined,
        periodEnd: period.end || undefined,
        lines: linesFromDrafts(lines),
        ...(staff ? receipt : {}),
      });
      setPeriod({ start: '', end: '' });
      setReceipt({});
      setSaved(submit ? 'submitted' : 'draft');
      // Refilled from what's still unbilled once the time reloads.
      setTouched(false);
      onSaved();
    } catch (err) {
      setSubmitError(
        apiErrorMessage(err, 'The invoice could not be saved. Time items need a date and hours; other items an amount above zero.'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="compact-card" id="new-invoice">
      <h3>New invoice</h3>
      {/* Applies to both a typed invoice and an imported file. */}
      {(billable.length > 1 || staff) && (
        <div className="inline-fields billed-for-field">
          <FormGroup>
            <Label htmlFor="billed-professional">Billing for</Label>
            <Select
              id="billed-professional"
              name="billedProfessional"
              value={billedProfessionalId}
              onChange={(event) => {
                setBilledProfessionalId(event.target.value);
                startAgain(event.target.value);
              }}
            >
              {!billedProfessionalId && <option value="">Choose who it's from</option>}
              {billable.map((professional) => (
                <option key={professional.professionalId} value={professional.professionalId}>
                  {professionalLabel(professional)}
                </option>
              ))}
            </Select>
          </FormGroup>
        </div>
      )}
      <div className="choice-toggle" role="group" aria-label="How to add the invoice">
        <button type="button" aria-pressed={mode === 'enter'} onClick={() => setMode('enter')}>
          Enter items
        </button>
        <button type="button" aria-pressed={mode === 'import'} onClick={() => setMode('import')}>
          Import a file
        </button>
      </div>

      {mode === 'import' ? (
        <InvoiceImportForm caseId={caseId} professionalId={billedProfessionalId} />
      ) : (
        <Form
          className="compact-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void save(true);
          }}
        >
          {submitError && <Notice tone="danger">{submitError}</Notice>}
          {saved === 'submitted' && (
            <Notice tone="success">{staff ? 'Invoice submitted. It is in the review queue.' : "Invoice submitted. It's under Your invoices."}</Notice>
          )}
          {saved === 'draft' && (
            <Notice tone="success">
              {caseId === null
                ? 'Saved to Invoice intake, where it waits for its case.'
                : staff
                  ? 'Draft saved. Finish it from Drafts on New invoice.'
                  : 'Draft saved. Open it from Your invoices to edit or submit it.'}
            </Notice>
          )}
          {staff && <ReceivedFields idPrefix="new-invoice" value={receipt} onChange={setReceipt} />}
          <PeriodFields idPrefix="new-invoice" start={period.start} end={period.end} onChange={setPeriod} />
          <RulesInForce rules={billingRules.rules} />
          {caseId !== null && (
            <UnbilledTimePicker idPrefix="new-invoice" entries={unbilled} lines={lines} onChange={setLines} timekeepers={billable} />
          )}
          <InvoiceLinesEditor
            idPrefix="new-invoice"
            lines={lines}
            onChange={setLines}
            timekeepers={billable}
            billedProfessionalId={billedProfessionalId}
            recordedTime={unbilled}
            billingCodes={billingRules.codes}
            mileageRates={billingRules.mileageRates}
          />
          <p className="compact-hint">
            Time items are priced at the hourly rate set for that kind of professional, and mileage at the agency's
            rate per mile. New time typed here is recorded when you submit.
          </p>
          {caseId === null ? (
            <div className="invoice-actions">
              <button type="button" className="btn btn--primary" disabled={submitting || !canSave} onClick={() => void save(false)}>
                {submitting ? 'Saving…' : 'Save to invoice intake'}
              </button>
            </div>
          ) : (
            <div className="invoice-actions">
              <button type="submit" className="btn btn--primary" disabled={submitting || !canSave || (staff && !hasReceipt(receipt))}>
                {submitting ? 'Saving…' : 'Submit invoice'}
              </button>
              <button type="button" className="btn btn--outline" disabled={submitting || !canSave} onClick={() => void save(false)}>
                Save as draft
              </button>
            </div>
          )}
        </Form>
      )}
    </div>
  );
}
