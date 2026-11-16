// The fields behind PickOrAdd's "add" option for a person, and the flag that
// marks what a submitter entered rather than chose (model/rules.yaml
// match_invoice_to_case). A submitter's entries are only details for staff.
import { type ProposedCase, type ProposedProvider } from '../api/client';
import { Tag } from './ui/Tag';

// `compact` for table cells: a short pill, the full meaning on hover and for
// screen readers.
export function EnteredFlag({ what, matched, compact }: { what: string; matched?: boolean; compact?: boolean }) {
  const text = matched ? `${what} entered by the submitter` : `New ${what.toLowerCase()}: entered by the submitter, not in the system yet`;
  return compact ? (
    <Tag tone="warning" className="entered-flag entered-flag--compact">
      <span aria-hidden="true" title={text}>
        {matched ? 'Entered' : 'New'}
      </span>
      <span className="usa-sr-only">{text}</span>
    </Tag>
  ) : (
    <Tag tone="warning" className="entered-flag">
      {text}
    </Tag>
  );
}

export function proposedCaseLabel(entry: ProposedCase): string {
  return [entry.caseNumber, entry.clientName].filter(Boolean).join(' · ');
}

function TextField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  error?: string;
}) {
  return (
    <div className="usa-form-group">
      <label className="usa-label" htmlFor={id}>
        {label}
      </label>
      <input id={id} type={type} className="usa-input" value={value} onChange={(event) => onChange(event.target.value)} />
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export const NO_PROPOSED_PERSON: ProposedProvider = { displayName: '' };

export function ProposedPersonFields({
  idPrefix,
  value,
  onChange,
  nameLabel = 'Their name',
}: {
  idPrefix: string;
  value: ProposedProvider;
  onChange: (value: ProposedProvider) => void;
  nameLabel?: string;
}) {
  return (
    <div className="inline-fields new-entry__fields">
      <TextField id={`${idPrefix}-name`} label={nameLabel} value={value.displayName} onChange={(displayName) => onChange({ ...value, displayName })} />
      <TextField id={`${idPrefix}-email`} label="Email (optional)" type="email" value={value.email ?? ''} onChange={(email) => onChange({ ...value, email })} />
    </div>
  );
}

export function proposedPersonToSend(entry: ProposedProvider): ProposedProvider | undefined {
  const displayName = entry.displayName.trim();
  return displayName ? { ...entry, displayName, email: entry.email?.trim() || undefined } : undefined;
}
