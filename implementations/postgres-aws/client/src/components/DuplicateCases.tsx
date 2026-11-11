// Open cases that may be one case recorded twice. Cases belong to the
// external case management system, so they are never merged here: staff mark
// a pair as different, or close the extra case from its page as a cleanup.
import { useState } from 'react';
import { Link } from 'react-router';
import { apiErrorMessage, reviewPossibleDuplicateCase, type CaseListRecord, type DuplicateCase } from '../api/client';
import { EXTERNAL_SYSTEM_NAME } from '../externalSystem';
import { useResource } from '../hooks/useResource';
import { cases as casesResource, possibleDuplicateCases } from '../resources';
import { formatDate, formatDateTime } from '../formatDateTime';
import { LoadState } from './LoadState';
import { NotDuplicateDialog, plural } from './NotDuplicateDialog';
import { TypeAheadPicker } from './TypeAheadPicker';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Notice, type SaveMessage } from './ui/Notice';
import { Tag } from './ui/Tag';

const REASONS = { same_number: 'Same case number', same_county: 'Same county', flagged: 'Flagged by staff' } as const;

const caseLabel = (record: { caseNumber: string | null; clientDisplayName: string | null }) =>
  [record.caseNumber ?? 'No case number', record.clientDisplayName].filter(Boolean).join(', ');

function DuplicateCaseDetails({ record }: { record: DuplicateCase }) {
  return (
    <div className="duplicate-person">
      <strong className="duplicate-person__name">
        <Link to={`/cases/${record.caseId}`}>{record.caseNumber ?? 'No case number'}</Link>
      </strong>
      <dl className="duplicate-person__facts">
        {record.otherNumbers.length > 0 && (
          <>
            <dt>Other numbers</dt>
            <dd>{record.otherNumbers.join(', ')}</dd>
          </>
        )}
        <dt>Client</dt>
        <dd>{record.clientDisplayName ?? '—'}</dd>
        <dt>County</dt>
        <dd>{record.countyDisplayName ?? '—'}</dd>
        <dt>Opened</dt>
        <dd>{record.openedOn ? formatDate(record.openedOn) : '—'}</dd>
        <dt>Invoices</dt>
        <dd>{plural(record.invoiceCount, 'invoice')}</dd>
      </dl>
    </div>
  );
}

export function DuplicateCases() {
  const [version, setVersion] = useState(0);
  const { data: groups, error } = useResource(possibleDuplicateCases, { resetKey: version });
  const [flagging, setFlagging] = useState(false);
  const [dismissing, setDismissing] = useState<{ caseIds: [string, string]; names: [string, string] } | null>(null);
  const [message, setMessage] = useState<SaveMessage | null>(null);

  if (error || !groups) {
    return <LoadState error={error} what="possible duplicate cases" />;
  }
  const changed = (text: string) => {
    setMessage({ tone: 'success', text });
    setVersion((value) => value + 1);
  };

  return (
    <>
      <div className="section-heading-row">
        <p className="compact-hint">
          Open cases whose numbers match, ignoring punctuation and leading zeros, or that staff flagged. Cases in different counties are never
          listed. Cases come from your {EXTERNAL_SYSTEM_NAME} and
          aren’t merged here: to clean up, close the extra case from its page once its invoices are finished, or mark them as different cases.
        </p>
        <Button kind="secondary" onClick={() => setFlagging(true)}>
          Flag two cases
        </Button>
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {groups.length === 0 ? (
        <p className="empty-note">No possible duplicate cases right now.</p>
      ) : (
        <ul className="duplicate-list">
          {groups.map((group) => {
            const label = (caseId: string) => caseLabel(group.cases.find((record) => record.caseId === caseId)!);
            return (
              <li key={group.cases.map((record) => record.caseId).join('|')} className="card duplicate-pair">
                <ul className="duplicate-pair__links">
                  {group.pairs.map((pair) => (
                    <li key={pair.caseIds.join('|')}>
                      <span>
                        {label(pair.caseIds[0])} and {label(pair.caseIds[1])}:
                      </span>
                      {pair.reasons.map((reason) => (
                        <Tag key={reason} tone={reason === 'flagged' ? 'warning' : 'info'}>
                          {REASONS[reason]}
                        </Tag>
                      ))}
                      {pair.flagged && (
                        <span className="cell-note">
                          by {pair.flagged.byDisplayName} {formatDateTime(pair.flagged.at)}
                          {pair.flagged.note && `: “${pair.flagged.note}”`}
                        </span>
                      )}
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => setDismissing({ caseIds: pair.caseIds, names: [label(pair.caseIds[0]), label(pair.caseIds[1])] })}
                      >
                        Not the same case
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="duplicate-pair__people">
                  {group.cases.map((record) => (
                    <DuplicateCaseDetails key={record.caseId} record={record} />
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {flagging && (
        <FlagCasesDialog
          onClose={() => setFlagging(false)}
          onFlagged={() => {
            setFlagging(false);
            changed('Flagged. They are listed here until one is closed or someone marks them as different cases.');
          }}
        />
      )}
      {dismissing && (
        <NotDuplicateDialog
          what="case"
          names={dismissing.names}
          save={(note) => reviewPossibleDuplicateCase({ caseIds: dismissing.caseIds, outcome: 'not_duplicate', note })}
          onClose={() => setDismissing(null)}
          onDone={(text) => {
            setDismissing(null);
            changed(text);
          }}
        />
      )}
    </>
  );
}

function CaseSearch({ id, label, cases, onSelect }: { id: string; label: string; cases: CaseListRecord[]; onSelect: (record: CaseListRecord | undefined) => void }) {
  return (
    <div className="usa-form-group">
      <label className="usa-label" id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      <TypeAheadPicker
        id={id}
        placeholder="Search by case number or client"
        noResults="No open cases found."
        search={(query) => {
          const words = query.trim().toLowerCase();
          return Promise.resolve(
            cases
              .filter((record) => caseLabel(record).toLowerCase().includes(words))
              .slice(0, 20)
              .map((record) => ({ value: record.caseId, label: caseLabel(record), item: record })),
          );
        }}
        onSelect={onSelect}
      />
    </div>
  );
}

function FlagCasesDialog({ onClose, onFlagged }: { onClose: () => void; onFlagged: () => void }) {
  const { data } = useResource(casesResource);
  const open = (data?.cases ?? []).filter((record) => !record.closedOn);
  const [first, setFirst] = useState<CaseListRecord>();
  const [second, setSecond] = useState<CaseListRecord>();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ready = first && second && first.caseId !== second.caseId;
  // A case in another county is a different case.
  const sameCounty = (record: CaseListRecord) => !first?.countyId || !record.countyId || record.countyId === first.countyId;

  async function flag() {
    if (!first || !second) return;
    setSaving(true);
    setError(null);
    try {
      await reviewPossibleDuplicateCase({ caseIds: [first.caseId, second.caseId], outcome: 'possible_duplicate', note });
      onFlagged();
    } catch (err) {
      setError(apiErrorMessage(err, 'They could not be flagged.'));
      setSaving(false);
    }
  }

  return (
    <Dialog title="Flag two cases as possibly the same" onClose={onClose} className="dialog--wide">
      <p>Open cases in the same county only. They are listed here until one is closed or someone marks them as different cases.</p>
      <CaseSearch id="flag-first-case" label="One case" cases={open} onSelect={setFirst} />
      <CaseSearch id="flag-second-case" label="The other" cases={open.filter(sameCounty)} onSelect={setSecond} />
      {first && second && first.caseId === second.caseId && <p className="field-error">Choose two different cases.</p>}
      <label className="usa-label" htmlFor="flag-case-note">
        Why they may be the same (optional)
      </label>
      <textarea id="flag-case-note" className="usa-textarea" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="dialog__actions">
        <Button kind="primary" disabled={!ready || saving} onClick={() => void flag()}>
          {saving ? 'Flagging…' : 'Flag them'}
        </Button>
        <button type="button" className="link-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
