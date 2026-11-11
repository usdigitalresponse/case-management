// A filed-by-person invoice's sender, period and invoice number, saved as
// they change beside its lines on the check and review pages.
import { useRef, useState } from 'react';
import { apiErrorMessage, fieldErrorsOf, type ImportWarning, type InvoiceDetailsInput, type QueuedInvoice, type SenderChoice } from '../api/client';
import { useAuth } from '../AuthContext';
import { useResource } from '../hooks/useResource';
import { billableProfessionals } from '../resources';
import { Notice } from './ui/Notice';
import { InvoiceNumberField, UploadPeriodField } from './upload/UploadFields';
import { useShell } from '../portal/useShell';
import { ADD_NEW } from './PickOrAdd';
import { Button } from './ui/Button';
import { BILLED_BY_HINT, SenderPicker, asksWho } from './invoiceDetails/SenderPicker';
import { useActiveKinds } from './invoiceDetails/AddSender';

export function InvoiceDetailsFields({
  invoice,
  missingSender,
  action,
  warnings,
  saveSender,
  saveDetails,
  onPeriodChanged,
  onSenderRenamed,
}: {
  invoice: QueuedInvoice;
  // Reloads the invoice, so its sender's corrected name shows elsewhere on the page.
  onSenderRenamed: () => void;
  // Asked to send or finish without one.
  missingSender: boolean;
  action: 'send' | 'finish';
  // The file's; only whole-invoice duplicates show here.
  warnings: ImportWarning[];
  // Saves any line edits first, then reloads the invoice once it is repriced.
  saveSender: (choice: SenderChoice) => Promise<void>;
  saveDetails: (details: InvoiceDetailsInput) => Promise<unknown>;
  // Line saves carry the period, so they send the latest one given here.
  onPeriodChanged: (period: { periodStart: string | null; periodEnd: string | null }) => void;
}) {
  const { staff } = useShell();
  const { user } = useAuth();
  const reviews = staff && Boolean(user?.reviewPermissions?.reviewLines);
  const invoiceWarnings = warnings.filter((warning) => !warning.location && warning.code.startsWith('duplicate_'));
  const { data: billable } = useResource(billableProfessionals(null));
  const [sender, setSender] = useState(invoice.professionalId ?? '');
  // Only for an invoice started without one; stays shown once chosen.
  const [asksSender] = useState(!invoice.professionalId);
  const [savingSender, setSavingSender] = useState(false);
  const [periodStart, setPeriodStart] = useState(invoice.periodStart ?? '');
  const [periodEnd, setPeriodEnd] = useState(invoice.periodEnd ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState(invoice.invoiceNumber ?? '');
  const saved = useRef<InvoiceDetailsInput>({
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    invoiceNumber: invoice.invoiceNumber,
  });
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const the = staff ? 'the' : 'your';

  async function saveChoice(choice: SenderChoice) {
    const field = choice.professionalKindId ? 'professionalKindId' : 'professionalId';
    setSavingSender(true);
    setErrors((current) => ({ ...current, professionalId: '', professionalKindId: '' }));
    try {
      await saveSender(choice);
    } catch (err) {
      setSender(invoice.professionalId ?? '');
      setErrors((current) => ({ ...current, [field]: apiErrorMessage(err, 'That could not be saved. Try again.') }));
    } finally {
      setSavingSender(false);
    }
  }

  function chooseSender(professionalId: string) {
    setSender(professionalId);
    if (!professionalId || professionalId === ADD_NEW || professionalId === invoice.professionalId) return;
    void saveChoice({ professionalId });
  }

  // Recorded before it is sent, and sent in order, so no save carries older values.
  function save(change: Partial<InvoiceDetailsInput>) {
    const details = { ...saved.current, ...change };
    saved.current = details;
    onPeriodChanged(details);
    setErrors((current) => ({ ...current, periodStart: '', periodEnd: '', invoiceNumber: '' }));
    queue.current = queue.current
      .then(() => saveDetails(details))
      .catch((err: unknown) => {
        const fieldErrors = fieldErrorsOf(err);
        setErrors((current) => ({
          ...current,
          ...(Object.keys(fieldErrors).length > 0 ? fieldErrors : { invoiceNumber: apiErrorMessage(err, 'That could not be saved. Try again.') }),
        }));
      });
  }

  // The saved sender's as loaded, so a role just given shows.
  const kind =
    sender === invoice.professionalId
      ? invoice.professionalKindDisplayName
      : billable?.find((p) => p.professionalId === sender)?.kindDisplayName;
  const needsRole = Boolean(invoice.professionalId) && sender === invoice.professionalId && kind === null;
  const senderHint = missingSender
    ? `Choose whose work it is before you ${action}.`
    : !sender || sender === ADD_NEW
      ? BILLED_BY_HINT
      : kind
        ? `Their ${kind.toLowerCase()} rates price the lines.`
        : needsRole
          ? reviews
            ? 'They have no role yet, so their time can’t be priced. Give them one below.'
            : 'They have no role set, so their time can’t be priced. A reviewer or administrator sets it.'
          : BILLED_BY_HINT;

  return (
    <section className={`card invoice-details${missingSender ? ' invoice-details--missing' : ''}`} aria-label="Invoice details">
      <div className="upload-details">
        {asksSender && asksWho(staff, billable) && (
          <div className="upload-details__field">
            <SenderPicker
              id="invoice-from"
              value={sender}
              billable={billable ?? []}
              error={errors.professionalId || undefined}
              hint={savingSender ? 'Saving, and pricing the lines at their rates…' : senderHint}
              disabled={savingSender}
              onChange={chooseSender}
              names={names}
              onRenamed={(professionalId, displayName) => {
                setNames((current) => ({ ...current, [professionalId]: displayName }));
                onSenderRenamed();
              }}
              // Priced again at their new role's rates.
              onRoleChanged={(professionalId) => void saveChoice({ professionalId })}
            />
          </div>
        )}
        {needsRole && reviews && (
          <MissingRole
            disabled={savingSender}
            error={errors.professionalKindId || undefined}
            onSave={(professionalKindId) => saveChoice({ professionalId: sender, professionalKindId })}
          />
        )}
        <UploadPeriodField
          start={periodStart}
          end={periodEnd}
          error={errors.periodStart || errors.periodEnd || undefined}
          hint={`From the dates on ${the} invoice.`}
          onChange={(period) => {
            setPeriodStart(period.periodStart);
            setPeriodEnd(period.periodEnd);
            // Saved once both days are set, or both cleared.
            if (Boolean(period.periodStart) !== Boolean(period.periodEnd)) return;
            if (period.periodStart && period.periodEnd < period.periodStart) {
              setErrors((current) => ({ ...current, periodEnd: 'The billing period must end on or after its first day.' }));
              return;
            }
            save({ periodStart: period.periodStart || null, periodEnd: period.periodEnd || null });
          }}
        />
        <InvoiceNumberField
          label="Invoice number"
          value={invoiceNumber}
          error={errors.invoiceNumber || undefined}
          hint={staff ? 'Optional. It helps match the sender’s records.' : 'Optional. It helps the billing office match your records.'}
          onChange={setInvoiceNumber}
          onSave={() => {
            const next = invoiceNumber.trim() || null;
            if (next !== saved.current.invoiceNumber) save({ invoiceNumber: next });
          }}
        />
      </div>
      {invoiceWarnings.length > 0 && (
        <Notice tone="warning">
          {invoiceWarnings.map((warning) => (
            <p key={warning.code}>{warning.message}</p>
          ))}
        </Notice>
      )}
    </section>
  );
}

// A sender with no role can't have their time priced; a reviewer gives them one.
function MissingRole({ disabled, error, onSave }: { disabled: boolean; error?: string; onSave: (professionalKindId: string) => void }) {
  const kinds = useActiveKinds();
  const [kindId, setKindId] = useState('');
  return (
    <div className="upload-details__field">
      <label className="usa-label" htmlFor="invoice-from-role">Their role</label>
      <div className="upload-period">
        <select id="invoice-from-role" className="usa-select" value={kindId} disabled={disabled} onChange={(event) => setKindId(event.target.value)}>
          <option value="">Choose their role</option>
          {kinds?.map((kind) => (
            <option key={kind.professionalKindId} value={kind.professionalKindId}>{kind.displayName}</option>
          ))}
        </select>
        <Button kind="secondary" disabled={disabled || !kindId} onClick={() => onSave(kindId)}>
          Save
        </Button>
      </div>
      {error && <p className="field-error">{error}</p>}
      <p className="field-hint">It is kept on their record and sets the rates their time is priced at. An administrator can change it later under People.</p>
    </div>
  );
}
