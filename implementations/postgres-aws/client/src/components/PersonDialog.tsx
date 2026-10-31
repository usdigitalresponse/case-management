// Adding a person who can send invoices, or changing their details (design
// G22, G23): name, role, email for the sign-in code, phone, who is paid and
// their approved rates. Someone added can sign in with that email straight away.
import { useState, type FormEvent } from 'react';
import {
  addProfessional,
  editProfessional,
  fieldErrorsOf,
  apiErrorMessage,
  listProfessionalKinds,
  type BillingPersonDetail,
} from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { Dialog } from './Dialog';

interface Fields {
  displayName: string;
  professionalKindId: string;
  email: string;
  phone: string;
  paidThrough: string;
  hourlyRate: string;
  ratePerMile: string;
}

const number = (value: string) => (value.trim() === '' ? undefined : Number(value.replace(/[$,\s]/g, '')));

export function PersonDialog({
  person,
  onSaved,
  onClose,
}: {
  // Absent: adding someone new.
  person?: BillingPersonDetail;
  onSaved: (saved: { professionalId: string; displayName: string }) => void;
  onClose: () => void;
}) {
  const { data: kinds } = useApiResource(() => listProfessionalKinds().then((result) => result.kinds.filter((kind) => kind.active)), []);
  const [fields, setFields] = useState<Fields>({
    displayName: person?.displayName ?? '',
    professionalKindId: person?.professionalKindId ?? '',
    email: person?.email ?? '',
    phone: person?.phone ?? '',
    paidThrough: person?.paidThrough ?? '',
    hourlyRate: person?.hourlyRate ?? '',
    ratePerMile: person?.ratePerMile ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Fields>) => setFields((current) => ({ ...current, ...patch }));
  const name = fields.displayName.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);
    const details = {
      displayName: fields.displayName,
      email: fields.email.trim() || undefined,
      phone: fields.phone,
      paidThrough: fields.paidThrough,
      hourlyRate: number(fields.hourlyRate),
      ratePerMile: number(fields.ratePerMile),
    };
    try {
      if (person) {
        await editProfessional(person.professionalId, { ...details, professionalKindId: fields.professionalKindId || undefined });
        onSaved({ professionalId: person.professionalId, displayName: name });
      } else {
        onSaved(await addProfessional({ ...details, professionalKindId: fields.professionalKindId }));
      }
    } catch (err) {
      const fieldErrors = fieldErrorsOf(err);
      setErrors(fieldErrors);
      if (Object.keys(fieldErrors).length === 0) {
        setMessage(apiErrorMessage(err, 'This could not be saved. Try again.'));
      }
    } finally {
      setBusy(false);
    }
  }

  const field = (id: keyof Fields, label: string, hint?: string, options: { type?: string; required?: boolean; locked?: string } = {}) => (
    <div className="dialog-field">
      <label className="usa-label" htmlFor={`person-${id}`}>{label}</label>
      <input
        id={`person-${id}`}
        className="usa-input"
        type={options.type ?? 'text'}
        required={options.required}
        readOnly={Boolean(options.locked)}
        value={fields[id]}
        onChange={(event) => set({ [id]: event.target.value })}
      />
      {errors[id] && <p className="field-error">{errors[id]}</p>}
      {(options.locked ?? hint) && <p className="field-hint">{options.locked ?? hint}</p>}
    </div>
  );

  return (
    <Dialog title={person ? `Edit ${person.displayName ?? 'details'}` : 'Add a person'} onClose={onClose}>
      <form className="person-form" onSubmit={(event) => void submit(event)}>
        {!person && (
          <p>They can send invoices as soon as you add them. Their sign-in code goes to the email below.</p>
        )}
        {field('displayName', 'Full name', undefined, { required: true })}
        <fieldset className="dialog-field">
          <legend className="usa-label">Role</legend>
          <div className="radio-choices">
            {(kinds ?? []).map((kind) => (
              <label key={kind.professionalKindId}>
                <input
                  type="radio"
                  name="person-role"
                  required
                  checked={fields.professionalKindId === kind.professionalKindId}
                  onChange={() => set({ professionalKindId: kind.professionalKindId })}
                />
                {kind.displayName}
              </label>
            ))}
          </div>
          {errors.professionalKindId && <p className="field-error">{errors.professionalKindId}</p>}
        </fieldset>
        <div className="dialog-field-pair">
          {field('email', 'Email', 'Used for the sign-in code.', {
            type: 'email',
            required: !person,
            locked: person?.signedIn ? 'They sign in with this email, so it can’t be changed here.' : undefined,
          })}
          {field('phone', 'Phone', undefined, { type: 'tel' })}
        </div>
        {field('paidThrough', 'Paid through', 'The business or firm that is paid.')}
        <div className="dialog-field-pair">
          {field('hourlyRate', 'Approved rate, an hour', person ? 'A change applies from today.' : undefined)}
          {field('ratePerMile', 'Mileage rate, a mile', person ? undefined : 'Leave blank to use the general mileage rate.')}
        </div>
        {message && <p className="field-error" role="alert">{message}</p>}
        <div className="dialog__actions">
          <button type="submit" className="btn btn--primary" disabled={busy || !name || !fields.professionalKindId}>
            {busy ? 'Saving…' : person ? 'Save changes' : `Add ${name || 'them'}`}
          </button>
          <button type="button" className="link-button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
