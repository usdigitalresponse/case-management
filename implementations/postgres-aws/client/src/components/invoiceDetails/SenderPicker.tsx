import { useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { BillableProfessional } from '../../api/client';
import { useShell } from '../../portal/useShell';
import type { AddedProvider } from '../AddProvider';
import { ADD_NEW } from '../PickOrAdd';
import { AddSender, NewSenderFields, PersonDraft } from './AddSender';

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

export type Added = AddedProvider & { kindDisplayName?: string };

export const BILLED_BY_HINT = 'Their rates set the line prices.';

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
        <legend className="sender-choices__title">Whose work is it?</legend>
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
      {/* Adding is a link under the field (J60), not the list's first option. */}
      <label className="usa-label" htmlFor={id}>Billed by</label>
      <select
        id={id}
        className="usa-select"
        value={shown}
        disabled={disabled}
        aria-describedby={shown === ADD_NEW ? undefined : `${id}-hint`}
        aria-invalid={Boolean(error) || undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {shown === ADD_NEW ? <option value={ADD_NEW}>A new person, entered below</option> : <option value="">Choose whose work it is</option>}
        {people.map((person) => (
          <option key={person.value} value={person.value}>{person.label}</option>
        ))}
      </select>
      {error && <p className="field-error">{error}</p>}
      {shown !== ADD_NEW && (
        <>
          <p id={`${id}-hint`} className="field-hint">{hint}</p>
          <button
            type="button"
            className="link-button sender-add"
            disabled={disabled}
            onClick={() => {
              setCurrent(null);
              setRound((count) => count + 1);
              onChange(ADD_NEW);
            }}
          >
            + Add new person
          </button>
        </>
      )}
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
