// A filed-by-person invoice's sender, period and invoice number, saved as
// they change beside its lines on the check and review pages.
import { useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import {
  addProfessional,
  apiErrorMessage,
  correctProfessional,
  fieldErrorsOf,
  type BillableProfessional,
  type ImportWarning,
  type InvoiceDetailsInput,
  type QueuedInvoice,
  type SenderChoice,
} from '../api/client';
import { useAuth } from '../AuthContext';
import { useResource } from '../hooks/useResource';
import { billableProfessionals, professionalKinds } from '../resources';
import { Notice } from './ui/Notice';
import { InvoiceNumberField, UploadPeriodField } from './upload/UploadFields';
import { useShell } from '../portal/useShell';
import type { AddedProvider } from './AddProvider';
import { ADD_NEW, PickOrAdd } from './PickOrAdd';
import { Button } from './ui/Button';

// Asked of staff, and of a submitter who bills for more than themselves.
export function asksWho(staff: boolean, billable: BillableProfessional[] | null | undefined) {
  return staff || (billable?.length ?? 0) > 1;
}

// "Last, First: Role"; without kept parts, the name's last word is the last name.
export function senderLabel(p: {
  displayName: string | null;
  givenName?: string | null;
  familyName?: string | null;
  kindDisplayName?: string | null;
  isSelf?: boolean;
}): string {
  const full = p.displayName?.trim() || 'Unnamed person';
  const words = full.split(/\s+/);
  const family = p.familyName?.trim() || (words.length > 1 ? words.at(-1)! : '');
  const given = p.familyName?.trim() ? (p.givenName?.trim() ?? '') : words.slice(0, -1).join(' ');
  const name = family && given ? `${family}, ${given}` : full;
  return `${name}${p.kindDisplayName ? `: ${p.kindDisplayName}` : ''}${p.isSelf ? ' (you)' : ''}`;
}

type Added = AddedProvider & { kindDisplayName?: string };

export const BILLED_BY_HINT = 'Their rates determine the line item pricing.';

export function SenderPicker({
  id,
  value,
  billable,
  error,
  hint,
  disabled,
  onChange,
  names = {},
  onRenamed,
  onRoleChanged,
  addRowIn,
  onDraft,
}: {
  // Opens the add row there, so the fields beside the picker don't move.
  addRowIn?: HTMLElement | null;
  // Given, someone new is only described, for the page to add as it goes on.
  onDraft?: (draft: PersonDraft | null) => void;
  id: string;
  value: string;
  billable: BillableProfessional[];
  error?: string;
  hint: string;
  disabled?: boolean;
  onChange: (professionalId: string) => void;
  // Names corrected since the list was loaded.
  names?: Record<string, string>;
  onRenamed?: (professionalId: string, displayName: string) => void;
  // Someone just added was given another role.
  onRoleChanged?: (professionalId: string) => void;
}) {
  const { staff } = useShell();
  const [added, setAdded] = useState<Added[]>([]);
  // Added from the open row, which stays open until something else is chosen.
  const [current, setCurrent] = useState<Added | null>(null);
  // A new row each time "add" is chosen again.
  const [round, setRound] = useState(0);
  const inRow = current !== null && value === current.professionalId;
  const shown = inRow ? ADD_NEW : value;
  const placeAddRow = (row: ReactElement) => (addRowIn ? createPortal(row, addRowIn) : row);
  // A corrected name is kept whole, so its parts are taken from it again.
  const people = [
    ...billable.map((p) => ({
      value: p.professionalId,
      label: senderLabel(names[p.professionalId] ? { ...p, displayName: names[p.professionalId]!, familyName: null } : p),
    })),
    ...added
      .filter((p) => !inRow || p.professionalId !== current.professionalId)
      .map((p) => ({ value: p.professionalId, label: senderLabel({ ...p, displayName: names[p.professionalId] ?? p.displayName }) })),
  ].sort((a, b) => a.label.localeCompare(b.label));
  // A submitter acting for others chooses among them; only staff add people.
  // A few are shown as choices, as in design I43.
  if (!staff && billable.length <= 6) {
    return (
      <fieldset className="sender-choices" aria-describedby={`${id}-hint`}>
        <legend className="usa-label">Whose work is it?</legend>
        {billable.map((p) => (
          <label key={p.professionalId} className="radio-row">
            <input
              type="radio"
              name={id}
              value={p.professionalId}
              checked={value === p.professionalId}
              disabled={disabled}
              onChange={() => onChange(p.professionalId)}
            />
            {names[p.professionalId] ?? p.displayName ?? 'Unnamed person'}
            {p.isSelf ? ' (you)' : ''}
            {p.kindDisplayName ? `, ${p.kindDisplayName.toLowerCase()}` : ''}
          </label>
        ))}
        {error && <p className="field-error">{error}</p>}
        <p id={`${id}-hint`} className="field-hint">{hint}</p>
      </fieldset>
    );
  }
  if (!staff) {
    return (
      <>
        <label className="usa-label" htmlFor={id}>Billed by</label>
        <select
          id={id}
          className="usa-select"
          value={value}
          disabled={disabled}
          aria-describedby={`${id}-hint`}
          aria-invalid={Boolean(error) || undefined}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Choose whose work it is</option>
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
    <>
      <PickOrAdd
        id={id}
        label="Billed by"
        value={shown}
        onChange={(next) => {
          if (next === ADD_NEW) {
            setCurrent(null);
            setRound((count) => count + 1);
          }
          onChange(next);
        }}
        addLabel="+ Add new person"
        placeholder="Choose whose work it is"
        options={people}
        error={error}
        hint={shown === ADD_NEW ? undefined : hint}
        disabled={disabled}
      />
      {shown === ADD_NEW && onDraft && placeAddRow(<NewSenderFields key={round} id={`${id}-new`} onChange={onDraft} />)}
      {shown === ADD_NEW && !onDraft && placeAddRow(
        <AddSender
          key={round}
          id={`${id}-new`}
          existing={inRow ? current : null}
          onAdded={(provider) => {
            setAdded((list) => [...list, provider]);
            setCurrent(provider);
            onChange(provider.professionalId);
          }}
          onRenamed={(professionalId, displayName) => {
            setAdded((list) => list.map((p) => (p.professionalId === professionalId ? { ...p, displayName } : p)));
            setCurrent((was) => (was ? { ...was, displayName } : was));
            onRenamed?.(professionalId, displayName);
          }}
          onRoleChanged={(professionalId, kindDisplayName) => {
            setAdded((list) => list.map((p) => (p.professionalId === professionalId ? { ...p, kindDisplayName } : p)));
            setCurrent((was) => (was ? { ...was, kindDisplayName } : was));
            onRoleChanged?.(professionalId);
          }}
        />
      )}
    </>
  );
}

export interface PersonDraft {
  givenName: string;
  familyName: string;
  displayName: string;
  email?: string;
  professionalKindId: string;
}

// First and last name, joined into the whole name; null until both are given.
function joinName(givenName: string, familyName: string) {
  const given = givenName.trim();
  const family = familyName.trim();
  return given && family ? { givenName: given, familyName: family, displayName: `${given} ${family}` } : null;
}

function useActiveKinds() {
  return useResource(professionalKinds).data?.filter((kind) => kind.active) ?? null;
}

// Someone new described on one line, to be added when the page goes on.
function NewSenderFields({ id, onChange }: { id: string; onChange: (draft: PersonDraft | null) => void }) {
  const kinds = useActiveKinds();
  const [draft, setDraft] = useState({ givenName: '', familyName: '', email: '', professionalKindId: '' });
  function set(patch: Partial<typeof draft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    const name = joinName(next.givenName, next.familyName);
    onChange(name && next.professionalKindId ? { ...name, email: next.email.trim() || undefined, professionalKindId: next.professionalKindId } : null);
  }
  return (
    <div className="add-sender">
      <input
        id={`${id}-given`}
        className="usa-input"
        aria-label="First name"
        placeholder="First name"
        value={draft.givenName}
        onChange={(event) => set({ givenName: event.target.value })}
      />
      <input
        id={`${id}-family`}
        className="usa-input"
        aria-label="Last name"
        placeholder="Last name"
        value={draft.familyName}
        onChange={(event) => set({ familyName: event.target.value })}
      />
      <input
        id={`${id}-email`}
        className="usa-input"
        type="email"
        aria-label="Their email (optional)"
        placeholder="Email (optional)"
        value={draft.email}
        onChange={(event) => set({ email: event.target.value })}
      />
      <select
        id={`${id}-role`}
        className="usa-select"
        aria-label="Their role"
        value={draft.professionalKindId}
        onChange={(event) => set({ professionalKindId: event.target.value })}
      >
        <option value="">Role</option>
        {kinds?.map((kind) => (
          <option key={kind.professionalKindId} value={kind.professionalKindId}>{kind.displayName}</option>
        ))}
      </select>
    </div>
  );
}

// Adds them once a name and role are given, then corrects that same person.
function AddSender({
  id,
  existing,
  onAdded,
  onRenamed,
  onRoleChanged,
}: {
  id: string;
  // Added from this row.
  existing: Added | null;
  onAdded: (added: Added) => void;
  onRenamed: (professionalId: string, displayName: string) => void;
  onRoleChanged: (professionalId: string, kindDisplayName: string | undefined) => void;
}) {
  const kinds = useActiveKinds();
  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [email, setEmail] = useState('');
  const [professionalKindId, setKindId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Set at once, so a blur and a role change together add them once.
  const adding = useRef(false);
  // The email as added or last corrected.
  const savedEmail = useRef('');
  async function run(action: () => Promise<void>, failure: string) {
    setError(null);
    setSaving(true);
    try {
      await action();
    } catch (err) {
      setError(apiErrorMessage(err, failure));
    } finally {
      setSaving(false);
    }
  }
  function add(kindId: string) {
    const name = joinName(givenName, familyName);
    if (adding.current || !name || !kindId) return;
    adding.current = true;
    const mail = email.trim();
    void run(async () => {
      try {
        const provider = await addProfessional({ ...name, email: mail || undefined, professionalKindId: kindId });
        onAdded({ ...provider, kindDisplayName: kinds?.find((kind) => kind.professionalKindId === kindId)?.displayName });
        savedEmail.current = mail;
      } catch (err) {
        adding.current = false;
        throw err;
      }
    }, 'They could not be added.');
  }
  function save() {
    const name = joinName(givenName, familyName);
    const mail = email.trim();
    if (!existing) {
      add(professionalKindId);
    } else if (name && (name.displayName !== existing.displayName || mail !== savedEmail.current)) {
      void run(async () => {
        await correctProfessional(existing.professionalId, { ...name, email: mail || undefined });
        savedEmail.current = mail;
        if (name.displayName !== existing.displayName) onRenamed(existing.professionalId, name.displayName);
      }, 'Their details could not be saved. Try again.');
    }
  }
  const saveOnEnter = (event: { key: string }) => {
    if (event.key === 'Enter') save();
  };
  return (
    <div className="add-sender">
      <input
        id={`${id}-given`}
        className="usa-input"
        aria-label="First name"
        placeholder="First name"
        value={givenName}
        onChange={(event) => setGivenName(event.target.value)}
        onBlur={save}
        onKeyDown={saveOnEnter}
      />
      <input
        id={`${id}-family`}
        className="usa-input"
        aria-label="Last name"
        placeholder="Last name"
        value={familyName}
        onChange={(event) => setFamilyName(event.target.value)}
        onBlur={save}
        onKeyDown={saveOnEnter}
      />
      <input
        id={`${id}-email`}
        className="usa-input"
        type="email"
        aria-label="Their email (optional)"
        placeholder="Email (optional)"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        onBlur={save}
        onKeyDown={saveOnEnter}
      />
      <select
        id={`${id}-role`}
        className="usa-select"
        aria-label="Their role"
        value={professionalKindId}
        disabled={saving}
        onChange={(event) => {
          const kindId = event.target.value;
          setKindId(kindId);
          const name = joinName(givenName, familyName);
          if (!existing) {
            add(kindId);
          } else if (kindId && name) {
            const kindDisplayName = kinds?.find((kind) => kind.professionalKindId === kindId)?.displayName;
            void run(async () => {
              await correctProfessional(existing.professionalId, { ...name, email: email.trim() || undefined, professionalKindId: kindId });
              savedEmail.current = email.trim();
              onRoleChanged(existing.professionalId, kindDisplayName);
            }, 'Their role could not be saved. Try again.');
          }
        }}
      >
        <option value="">Role</option>
        {kinds?.map((kind) => (
          <option key={kind.professionalKindId} value={kind.professionalKindId}>{kind.displayName}</option>
        ))}
      </select>
      {saving ? (
        <span className="field-hint">Saving…</span>
      ) : (
        existing && <span className="field-hint">Added, and the invoice is billed by them.</span>
      )}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

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
        <Button type="button" kind="secondary" disabled={disabled || !kindId} onClick={() => onSave(kindId)}>
          Save
        </Button>
      </div>
      {error && <p className="field-error">{error}</p>}
      <p className="field-hint">It is kept on their record and sets the rates their time is priced at. An administrator can change it later under People.</p>
    </div>
  );
}
