// A filed-by-person invoice's details, beside its lines on the check and
// review pages: whom it is from, its billing period and the number on the
// sender's own invoice, each saved as it changes. Its lines show as read
// until a sender is chosen; sending or finishing needs one. A reviewer gives
// a sender with no role theirs here.
import { useRef, useState } from 'react';
import {
  apiErrorMessage,
  fieldErrorsOf,
  listBillableProfessionals,
  listProfessionalKinds,
  type BillableProfessional,
  type ImportWarning,
  type InvoiceDetailsInput,
  type QueuedInvoice,
  type SenderChoice,
} from '../api/client';
import { useAuth } from '../AuthContext';
import { useApiResource } from '../hooks/useApiResource';
import { Notice } from './Notice';
import { InvoiceNumberField, UploadPeriodField } from '../portal/PortalUpload';
import { useShell } from '../portal/useShell';
import { AddProvider } from './AddProvider';
import { professionalLabel } from './InvoiceLinesEditor';
import { ADD_NEW, PickOrAdd } from './PickOrAdd';

// Asked of staff, and of a submitter who bills for more than themselves.
export function asksWho(staff: boolean, billable: BillableProfessional[] | null | undefined) {
  return staff || (billable?.length ?? 0) > 1;
}

export function SenderPicker({
  id,
  value,
  billable,
  error,
  hint,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  billable: BillableProfessional[];
  error?: string;
  hint: string;
  disabled?: boolean;
  onChange: (professionalId: string) => void;
}) {
  const { staff } = useShell();
  const [added, setAdded] = useState<Array<{ professionalId: string; displayName: string }>>([]);
  const people = [
    ...billable.map((p) => ({ value: p.professionalId, label: professionalLabel(p) })),
    ...added.map((p) => ({ value: p.professionalId, label: p.displayName })),
  ];
  // A submitter acting for others chooses among them; only staff add people.
  if (!staff) {
    return (
      <>
        <label className="usa-label" htmlFor={id}>Who it is from</label>
        <select
          id={id}
          className="usa-select"
          value={value}
          disabled={disabled}
          aria-describedby={`${id}-hint`}
          aria-invalid={Boolean(error) || undefined}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Choose who it is from</option>
          {people.map((person) => (
            <option key={person.value} value={person.value}>{person.label}</option>
          ))}
        </select>
        {error && <p className="field-error">{error}</p>}
        <p id={`${id}-hint`} className="field-hint">{hint}</p>
      </>
    );
  }
  return (
    <PickOrAdd
      id={id}
      label="Who it is from"
      value={value}
      onChange={onChange}
      addLabel="+ Add someone who isn’t listed"
      placeholder="Choose who sent it"
      options={people}
      error={error}
      hint={hint}
      disabled={disabled}
    >
      <AddProvider
        inline
        idPrefix={`${id}-new`}
        onAdded={(provider) => {
          setAdded((current) => [...current, provider]);
          onChange(provider.professionalId);
        }}
      />
    </PickOrAdd>
  );
}

export function InvoiceDetailsFields({
  invoice,
  missingSender,
  action,
  warnings,
  saveSender,
  saveDetails,
  onPeriodSaved,
}: {
  invoice: QueuedInvoice;
  // Asked to send or finish without one.
  missingSender: boolean;
  action: 'send' | 'finish';
  // The file's warnings; those for the invoice as a whole, such as a
  // duplicate for its sender, show here.
  warnings: ImportWarning[];
  // Saves any line edits first, then reloads the invoice once it is repriced.
  saveSender: (choice: SenderChoice) => Promise<void>;
  saveDetails: (details: InvoiceDetailsInput) => Promise<unknown>;
  // Line saves carry the period, so they send the one saved here.
  onPeriodSaved: (period: { periodStart: string | null; periodEnd: string | null }) => void;
}) {
  const { staff } = useShell();
  const { user } = useAuth();
  const reviews = staff && Boolean(user?.reviewPermissions?.reviewLines);
  const invoiceWarnings = warnings.filter((warning) => !warning.location && warning.code.startsWith('duplicate_'));
  const { data: billable } = useApiResource(() => listBillableProfessionals(null).then((result) => result.professionals), []);
  const [sender, setSender] = useState(invoice.professionalId ?? '');
  const [savingSender, setSavingSender] = useState(false);
  const [periodStart, setPeriodStart] = useState(invoice.periodStart ?? '');
  const [periodEnd, setPeriodEnd] = useState(invoice.periodEnd ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState(invoice.invoiceNumber ?? '');
  const saved = useRef<InvoiceDetailsInput>({
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    invoiceNumber: invoice.invoiceNumber,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
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

  function save(change: Partial<InvoiceDetailsInput>) {
    const details = { ...saved.current, ...change };
    setErrors((current) => ({ ...current, periodStart: '', periodEnd: '', invoiceNumber: '' }));
    saveDetails(details).then(
      () => {
        saved.current = details;
        onPeriodSaved(details);
      },
      (err: unknown) => {
        const fieldErrors = fieldErrorsOf(err);
        setErrors((current) => ({
          ...current,
          ...(Object.keys(fieldErrors).length > 0 ? fieldErrors : { invoiceNumber: apiErrorMessage(err, 'That could not be saved. Try again.') }),
        }));
      },
    );
  }

  // The saved sender's as loaded, so a role just given shows.
  const kind =
    sender === invoice.professionalId
      ? invoice.professionalKindDisplayName
      : billable?.find((p) => p.professionalId === sender)?.kindDisplayName;
  const needsRole = Boolean(invoice.professionalId) && sender === invoice.professionalId && kind === null;
  const senderHint = missingSender
    ? `Choose who it is from before you ${action}. It is filed under them.`
    : !sender || sender === ADD_NEW
      ? 'It is filed under this person, and their rates price the lines.'
      : kind
        ? `Their ${kind.toLowerCase()} rates price the lines.`
        : needsRole
          ? reviews
            ? 'They have no role yet, so their time can’t be priced. Give them one below.'
            : 'They have no role set, so their time can’t be priced. A reviewer or administrator sets it.'
          : 'It is filed under this person, and their rates price the lines.';

  return (
    <section className={`invoice-details${missingSender ? ' invoice-details--missing' : ''}`} aria-label="Invoice details">
      <div className="upload-details">
        {asksWho(staff, billable) && (
          <div className="upload-details__field">
            <SenderPicker
              id="invoice-from"
              value={sender}
              billable={billable ?? []}
              error={errors.professionalId || undefined}
              hint={savingSender ? 'Saving, and pricing the lines at their rates…' : senderHint}
              disabled={savingSender}
              onChange={chooseSender}
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
  const { data: kinds } = useApiResource(() => listProfessionalKinds().then((result) => result.kinds.filter((kind) => kind.active)), []);
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
        <button type="button" className="btn btn--outline" disabled={disabled || !kindId} onClick={() => onSave(kindId)}>
          Save
        </button>
      </div>
      {error && <p className="field-error">{error}</p>}
      <p className="field-hint">It is kept on their record and sets the rates their time is priced at. An administrator can change it later under People.</p>
    </div>
  );
}
