// The fields behind PickOrAdd's "add" option, and the flag that marks what a
// submitter entered rather than chose (model/rules.yaml match_invoice_to_case).
// A submitter's entries are only details for staff; staff create the record.
import { useEffect } from 'react';
import {
  apiErrorMessage,
  fieldErrorsOf,
  matchInvoiceToCase,
  createCase,
  getReferenceData,
  type ProposedCase,
  type ProposedProvider,
} from '../api/client';
import { useApiResource } from '../hooks/useApiResource';

// `compact` for table cells: a short pill, the full meaning on hover and for
// screen readers.
export function EnteredFlag({ what, matched, compact }: { what: string; matched?: boolean; compact?: boolean }) {
  const text = matched ? `${what} entered by the submitter` : `New ${what.toLowerCase()}: entered by the submitter, not in the system yet`;
  return compact ? (
    <span className="entered-flag entered-flag--compact" title={text}>
      <span aria-hidden="true">{matched ? 'Entered' : 'New'}</span>
      <span className="usa-sr-only">{text}</span>
    </span>
  ) : (
    <span className="entered-flag">{text}</span>
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

export const NO_PROPOSED_CASE: ProposedCase = { clientName: '' };

export function ProposedCaseFields({
  idPrefix,
  value,
  onChange,
  errors = {},
}: {
  idPrefix: string;
  value: ProposedCase;
  onChange: (value: ProposedCase) => void;
  errors?: Record<string, string>;
}) {
  const set = (patch: Partial<ProposedCase>) => onChange({ ...value, ...patch });
  return (
    <div className="inline-fields new-entry__fields">
      <TextField id={`${idPrefix}-client`} label="Client’s name" value={value.clientName} onChange={(clientName) => set({ clientName })} error={errors.clientName} />
      <TextField id={`${idPrefix}-number`} label="Case number (optional)" value={value.caseNumber ?? ''} onChange={(caseNumber) => set({ caseNumber })} error={errors.caseNumber} />
      <TextField id={`${idPrefix}-details`} label="Anything else that helps find it (optional)" value={value.details ?? ''} onChange={(details) => set({ details })} />
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

// The server refused a new client as a probable duplicate by name: they can
// confirm it's someone else (createCase newClient.confirmedNew).
export function SameNameConfirm({ error, confirmed, onChange }: { error?: string; confirmed: boolean; onChange: (confirmed: boolean) => void }) {
  return error ? (
    <>
      <p className="field-error">{error}</p>
      <label className="checkbox-row">
        <input type="checkbox" checked={confirmed} onChange={(event) => onChange(event.target.checked)} />
        This is someone else with the same name
      </label>
    </>
  ) : null;
}

// Trimmed, with empty optional fields dropped; undefined until a name is given.
export function proposedCaseToSend(entry: ProposedCase): ProposedCase | undefined {
  const clientName = entry.clientName.trim();
  return clientName
    ? { clientName, caseNumber: entry.caseNumber?.trim() || undefined, details: entry.details?.trim() || undefined }
    : undefined;
}

export function proposedPersonToSend(entry: ProposedProvider): ProposedProvider | undefined {
  const displayName = entry.displayName.trim();
  return displayName ? { ...entry, displayName, email: entry.email?.trim() || undefined } : undefined;
}

// A case staff create on the spot: the client is added with it.
export interface NewCaseEntry extends ProposedCase {
  requestId: string;
  email?: string;
  participantRoleId: string;
  statusId: string;
  // Someone else with the same name as a person already in the system.
  confirmedNew: boolean;
}

export function newCaseEntry(from: ProposedCase = NO_PROPOSED_CASE): NewCaseEntry {
  return { ...from, requestId: crypto.randomUUID(), participantRoleId: '', statusId: '', confirmedNew: false };
}

export function StaffNewCaseFields({
  idPrefix,
  value,
  onChange,
  errors = {},
}: {
  idPrefix: string;
  value: NewCaseEntry;
  onChange: (value: NewCaseEntry) => void;
  errors?: Record<string, string>;
}) {
  const { data } = useApiResource(getReferenceData, []);
  const roles = data?.participantRoles ?? [];
  const statuses = data?.caseStatuses ?? [];
  const set = (patch: Partial<NewCaseEntry>) => onChange({ ...value, ...patch });
  // Preselected when there's only one to choose.
  useEffect(() => {
    const participantRoleId = value.participantRoleId || (roles.length === 1 ? roles[0]!.roleId : '');
    const statusId = value.statusId || (statuses.length === 1 ? statuses[0]!.id : '');
    if (participantRoleId !== value.participantRoleId || statusId !== value.statusId) {
      set({ participantRoleId, statusId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  return (
    <>
      <ProposedCaseFields idPrefix={idPrefix} value={value} onChange={(entry) => set(entry)} errors={errors} />
      <div className="inline-fields new-entry__fields">
        <TextField id={`${idPrefix}-email`} label="Client’s email (optional)" type="email" value={value.email ?? ''} onChange={(email) => set({ email })} />
        {roles.length > 1 && (
          <div className="usa-form-group">
            <label className="usa-label" htmlFor={`${idPrefix}-role`}>Client’s role</label>
            <select id={`${idPrefix}-role`} className="usa-select" value={value.participantRoleId} onChange={(event) => set({ participantRoleId: event.target.value })}>
              <option value="">Choose</option>
              {roles.map((role) => (
                <option key={role.roleId} value={role.roleId}>{role.displayName}</option>
              ))}
            </select>
          </div>
        )}
        {statuses.length > 1 && (
          <div className="usa-form-group">
            <label className="usa-label" htmlFor={`${idPrefix}-status`}>Opening status</label>
            <select id={`${idPrefix}-status`} className="usa-select" value={value.statusId} onChange={(event) => set({ statusId: event.target.value })}>
              <option value="">Choose</option>
              {statuses.map((status) => (
                <option key={status.id} value={status.id}>{status.displayName}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <SameNameConfirm error={errors.newClient} confirmed={value.confirmedNew} onChange={(confirmedNew) => set({ confirmedNew })} />
      <p className="field-hint">Add the rest of the case’s details on its page later.</p>
    </>
  );
}

// Matches an invoice just saved to the case staff added for it. The invoice
// is saved either way: if this fails it waits on Intake, so saving again
// can't add it twice. Says whether it went on to review, or why it failed.
export async function matchToAddedCase(invoiceId: string, caseId: string): Promise<{ released: boolean } | { problem: string }> {
  try {
    const { released } = await matchInvoiceToCase(invoiceId, { caseId, addMissing: true });
    return { released };
  } catch (err) {
    return {
      problem: `The case was added, but the invoice could not be matched to it (${apiErrorMessage(err, 'something went wrong')}). It waits on Intake.`,
    };
  }
}

export class NewCaseError extends Error {
  constructor(readonly fieldErrors: Record<string, string>) {
    super(Object.values(fieldErrors)[0] ?? 'The case could not be added.');
  }
}

// Creates the case and its client; retrying the same entry won't add it twice.
export async function createCaseFromEntry(entry: NewCaseEntry): Promise<string> {
  const errors: Record<string, string> = {};
  if (entry.clientName.trim().length < 2) errors.clientName = 'Enter the client’s name.';
  if (!entry.participantRoleId) errors.participantRoleId = 'Choose the client’s role.';
  if (!entry.statusId) errors.statusId = 'Choose the opening status.';
  if (Object.keys(errors).length > 0) {
    throw new NewCaseError(errors);
  }
  try {
    const created = await createCase({
      requestId: entry.requestId,
      newClient: { displayName: entry.clientName.trim(), email: entry.email?.trim() || undefined, confirmedNew: entry.confirmedNew },
      caseNumber: entry.caseNumber?.trim() || undefined,
      participantRoleId: entry.participantRoleId,
      statusId: entry.statusId,
      effectiveAt: new Date().toISOString(),
    });
    return created.caseId;
  } catch (err) {
    const fieldErrors = fieldErrorsOf(err);
    throw Object.keys(fieldErrors).length > 0 ? new NewCaseError(fieldErrors) : err;
  }
}
