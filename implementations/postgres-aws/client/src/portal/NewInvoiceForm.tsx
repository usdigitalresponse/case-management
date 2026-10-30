import { useEffect, useState, type FormEvent } from 'react';
import { Form, FormGroup } from '@trussworks/react-uswds';
import {
  apiErrorMessage,
  createInvoice,
  type BillableProfessional,
  type ProposedCase,
  type SendStatus,
  type TimeEntryRecord,
} from '../api/client';
import { AddProvider, useAddedProviders } from '../components/AddProvider';
import { ADD_NEW, PickOrAdd } from '../components/PickOrAdd';
import { matchToAddedCase, NO_PROPOSED_PERSON, ProposedPersonFields, proposedPersonToSend } from '../components/NewEntryFields';
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
import { AttestationCheckbox } from '../components/AttestationCheckbox';
import { useReceipt } from './ReceivedFields';
import { useShell } from './useShell';

function draftSavedMessage(caseId: string | null, staff: boolean): string {
  if (caseId === null) return 'Saved. Match it to a case under "Waiting for a case".';
  if (staff) return 'Draft saved. Finish it from "Drafts to finish" below.';
  return 'Draft saved. Open it from Your invoices to edit or submit it.';
}

// A new invoice on one case: typed items (starting from unbilled time) or an
// imported file. Shared by the case page, the portal's New invoice page and
// staff Intake. With no case, or no one chosen as its provider, it waits on
// Intake to be matched.
export function NewInvoiceForm({
  caseId,
  billable,
  entries,
  onSaved,
  allowImport = true,
  newCase,
}: {
  caseId: string | null;
  billable: BillableProfessional[];
  entries: TimeEntryRecord[] | null;
  // Off where the page offers the bulk import flow beside the form.
  allowImport?: boolean;
  // Billing changes what time is unbilled.
  onSaved: () => void;
  // With no case: one being added. Staff create it once they know who the
  // invoice is from (`create`, returning its id) and match the invoice to it;
  // otherwise its details go with the invoice.
  newCase?: { proposed?: ProposedCase; create?: () => Promise<string> };
}) {
  const billingRules = usePortalBillingRules();
  const { staff } = useShell();
  // Defaults to the user's own profile; a delegate picks whom they bill for,
  // and staff always choose who it's from.
  const [billedProfessionalId, setBilledProfessionalId] = useState(
    () => (billable.find((p) => p.isSelf) ?? (staff ? undefined : billable[0]))?.professionalId ?? '',
  );
  const providers = useAddedProviders(caseId);
  const people = [...billable, ...providers.added];
  const [proposedProvider, setProposedProvider] = useState(NO_PROPOSED_PERSON);
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
  const [saved, setSaved] = useState<SendStatus | null>(null);
  const [savedCaseId, setSavedCaseId] = useState(caseId);
  const [mode, setMode] = useState<'enter' | 'import'>('enter');
  const receipt = useReceipt('new-invoice');
  const [attested, setAttested] = useState(false);

  // Not chosen or not listed: who it's from is matched on Intake.
  const unknownProvider = !billedProfessionalId || billedProfessionalId === ADD_NEW;
  const billedId = unknownProvider ? '' : billedProfessionalId;
  const canSave = hasInvoiceItems(lines);

  async function save(submit: boolean) {
    setSubmitError(null);
    setSaved(null);
    setSubmitting(true);
    try {
      const matchTo = !unknownProvider && newCase?.create ? await newCase.create() : undefined;
      const created = await createInvoice({
        caseId,
        submit,
        professionalId: unknownProvider ? null : billedProfessionalId,
        proposedCase: matchTo ? undefined : newCase?.proposed,
        proposedProvider: unknownProvider && !staff && billedProfessionalId === ADD_NEW ? proposedPersonToSend(proposedProvider) : undefined,
        periodStart: period.start || undefined,
        periodEnd: period.end || undefined,
        lines: linesFromDrafts(lines),
        ...receipt.payload,
        attested: submit && !staff ? attested : undefined,
      });
      let savedAs = created.status;
      let savedOn = caseId;
      if (matchTo) {
        const matched = await matchToAddedCase(created.invoiceId, matchTo);
        if ('problem' in matched) {
          setSubmitError(matched.problem);
        } else {
          savedOn = matchTo;
          if (matched.released) savedAs = 'submitted';
        }
      }
      setPeriod({ start: '', end: '' });
      setAttested(false);
      receipt.reset();
      setSavedCaseId(savedOn);
      setSaved(savedAs);
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
            <PickOrAdd
              id="billed-professional"
              label="Billing for"
              value={billedProfessionalId}
              onChange={(value) => {
                setBilledProfessionalId(value);
                startAgain(value);
              }}
              addLabel="+ Add a provider who isn’t listed"
              placeholder="Choose who it’s from"
              hint="Leave it blank if it isn’t known yet; it’s matched on Intake."
              options={people.map((professional) => ({ value: professional.professionalId, label: professionalLabel(professional) }))}
            >
              {staff ? (
                <AddProvider
                  inline
                  idPrefix="billed-professional-new"
                  onAdded={(provider) => {
                    setBilledProfessionalId(provider.professionalId);
                    providers
                      .onProviderAdded(provider)
                      .catch((err: unknown) => setSubmitError(apiErrorMessage(err, 'They were added, but not to this case. Add them from the case page.')));
                  }}
                />
              ) : (
                <ProposedPersonFields idPrefix="billed-professional-new" value={proposedProvider} onChange={setProposedProvider} />
              )}
            </PickOrAdd>
          </FormGroup>
        </div>
      )}
      {allowImport && (
        <div className="choice-toggle" role="group" aria-label="How to add the invoice">
          <button type="button" aria-pressed={mode === 'enter'} onClick={() => setMode('enter')}>
            Enter items
          </button>
          <button type="button" aria-pressed={mode === 'import'} onClick={() => setMode('import')}>
            Import a file
          </button>
        </div>
      )}

      {allowImport && mode === 'import' ? (
        <InvoiceImportForm caseId={caseId} professionalId={billedId} />
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
          {saved === 'draft' && <Notice tone="success">{draftSavedMessage(savedCaseId, staff)}</Notice>}
          {saved === 'awaiting_match' && (
            <Notice tone="success">Sent. It waits on Intake until its case and provider are matched, then goes to review.</Notice>
          )}
          {receipt.fields}
          <PeriodFields idPrefix="new-invoice" start={period.start} end={period.end} onChange={setPeriod} />
          <RulesInForce rules={billingRules.rules} />
          {caseId !== null && (
            <UnbilledTimePicker idPrefix="new-invoice" entries={unbilled} lines={lines} onChange={setLines} timekeepers={billable} />
          )}
          <InvoiceLinesEditor
            idPrefix="new-invoice"
            lines={lines}
            onChange={setLines}
            timekeepers={people}
            onProviderAdded={staff ? providers.onProviderAdded : undefined}
            billedProfessionalId={billedId}
            recordedTime={unbilled}
            billingCodes={billingRules.codes}
            mileageRates={billingRules.mileageRates}
          />
          <p className="compact-hint">
            Time is priced at the hourly rate for the professional's kind, and mileage at the per-mile rate.
            {caseId !== null && ' New time typed here is recorded when you submit.'}
          </p>
          {caseId === null ? (
            <div className="invoice-actions">
              <button type="button" className="btn btn--primary" disabled={submitting || !canSave} onClick={() => void save(false)}>
                {submitting ? 'Saving…' : 'Save for matching'}
              </button>
            </div>
          ) : (
            <div className="invoice-actions">
              {!staff && <AttestationCheckbox id="new-invoice-attested" checked={attested} onChange={setAttested} />}
              <button type="submit" className="btn btn--primary" disabled={submitting || !canSave || receipt.missing || (!staff && !attested)}>
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
