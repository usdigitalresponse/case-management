// Settings › Merge duplicates (design K67): a row per group of cases or people that may be one. Any staff
// member flags or separates a pair; only administrators merge a group, all or none: people after a preview
// (../pages/MergePeople.tsx), cases by moving their invoices to the one kept and closing the others as added by mistake.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  apiErrorMessage,
  mergeCases,
  previewCaseMerge,
  reviewPossibleDuplicate,
  reviewPossibleDuplicateCase,
  undoPersonMerges,
  type CaseFixPreview,
  type DuplicateCase,
  type DuplicatePerson,
  type DuplicateReason,
  type PossibleDuplicate,
  type PossibleDuplicateCase,
} from '../api/client';
import { useAuth } from '../AuthContext';
import { useResource } from '../hooks/useResource';
import { personMerges, possibleDuplicateCases, possibleDuplicates } from '../resources';
import { mergePath, settingsPath } from '../staffPaths';
import { LoadState } from './LoadState';
import { RecordTable } from './RecordTable';
import { NotDuplicateDialog, plural } from './NotDuplicateDialog';
import { caseLabel, FlagCasesDialog } from './DuplicateCases';
import { FlagPeopleDialog, personLabels, RecentMerges } from './DuplicatePeople';
import { Button, buttonClass } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Notice, type SaveMessage } from './ui/Notice';

const CASE_REASONS = { same_number: 'The same number without the punctuation', same_county: 'Same county', flagged: 'Flagged by staff' } as const;
const PERSON_REASONS: Record<DuplicateReason, string> = {
  same_email: 'Same email',
  same_name: 'Same name',
  same_birth_date_and_family_name: 'Same date of birth and last name',
  flagged: 'Flagged by staff',
};

interface Pair {
  ids: [string, string];
  why: string;
}

type Row =
  | { kind: 'case'; key: string; records: DuplicateCase[]; pairs: Pair[] }
  | { kind: 'person'; key: string; records: DuplicatePerson[]; labels: Map<string, string>; pairs: Pair[] };

// "A, B and C".
const listed = (names: string[]) => (names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

// The record with the most on it is offered as the one to keep.
const caseWeight = (record: DuplicateCase) => record.invoiceCount;
const personWeight = (person: DuplicatePerson) => person.invoiceCount + person.caseCount + (person.provider?.signInEmail ? 1 : 0);
const heaviestFirst = <T,>(records: T[], weight: (record: T) => number) => [...records].sort((a, b) => weight(b) - weight(a));

function rowsOf(cases: PossibleDuplicateCase[], people: PossibleDuplicate[]): Row[] {
  const caseRows: Row[] = cases.map((group) => ({
    kind: 'case',
    key: group.cases.map((record) => record.caseId).join('|'),
    records: heaviestFirst(group.cases, caseWeight),
    pairs: group.pairs.map((pair) => ({
      ids: pair.caseIds,
      why: pair.reasons.filter((reason) => reason !== 'same_county').map((reason) => CASE_REASONS[reason]).join('; '),
    })),
  }));
  const personRows: Row[] = people.map((group) => ({
    kind: 'person',
    key: group.people.map((one) => one.personId).join('|'),
    records: heaviestFirst(group.people, personWeight),
    labels: personLabels(group.people),
    pairs: group.pairs.map((pair) => ({ ids: pair.personIds, why: pair.reasons.map((reason) => PERSON_REASONS[reason]).join('; ') })),
  }));
  return [...caseRows, ...personRows];
}

const idOf = (row: Row, index: number) => (row.kind === 'case' ? row.records[index]!.caseId : row.records[index]!.personId);

function nameOf(row: Row, id: string): string {
  if (row.kind === 'person') return row.labels.get(id) ?? 'Someone';
  return row.records.find((record) => record.caseId === id)?.caseNumber ?? 'No case number';
}

const namesOf = (row: Row) => listed(row.records.map((_, index) => nameOf(row, idOf(row, index))));

export function MergeDuplicates() {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.isAdmin);
  const [version, setVersion] = useState(0);
  const cases = useResource(possibleDuplicateCases, { resetKey: version });
  const people = useResource(possibleDuplicates, { resetKey: version });
  const [message, setMessage] = useState<SaveMessage | null>(null);
  const [flagging, setFlagging] = useState<'case' | 'person' | null>(null);
  const [dismissing, setDismissing] = useState<{ row: Row; pair: Pair } | null>(null);
  const [mergingCases, setMergingCases] = useState<DuplicateCase[] | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: merges } = useResource(personMerges, { resetKey: version });
  const justMerged = (searchParams.get('merged')?.split(',') ?? []).flatMap((id) => (merges ?? []).filter((merge) => merge.personMergeId === id && !merge.undoneAt));

  const changed = (text: string) => {
    setMessage({ tone: 'success', text });
    setVersion((value) => value + 1);
  };

  async function undo(personMergeIds: string[]) {
    setUndoing(true);
    setMessage(null);
    try {
      const { leftAsIs } = await undoPersonMerges(personMergeIds);
      changed(leftAsIs > 0 ? `Merge undone. ${plural(leftAsIs, 'record')} changed since the merge stayed as they are.` : 'Merge undone.');
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete('merged');
          return next;
        },
        { replace: true },
      );
    } catch (err) {
      setMessage({ tone: 'danger', text: apiErrorMessage(err, 'The merge could not be undone.') });
    } finally {
      setUndoing(false);
    }
  }

  const error = cases.error ?? people.error;
  const rows = cases.data && people.data ? rowsOf(cases.data, people.data) : null;

  return (
    <>
      <p className="compact-hint">
        The same case or provider can end up here twice, because people type numbers and names themselves. Merging moves every invoice to the
        one you keep. Each invoice still shows the number or name as typed.
      </p>
      <div className="list-toolbar list-toolbar--end">
        <Button kind="secondary" onClick={() => setFlagging('case')}>
          Flag two cases
        </Button>
        <Button kind="secondary" onClick={() => setFlagging('person')}>
          Flag two people
        </Button>
      </div>
      {justMerged.length > 0 && (
        <Notice
          tone="success"
          action={
            isAdmin && (
              <Button kind="secondary" disabled={undoing} onClick={() => void undo(justMerged.map((merge) => merge.personMergeId))}>
                Undo
              </Button>
            )
          }
        >
          Merged {plural(justMerged.length, 'record')} into {justMerged[0]!.kept.displayName}.
        </Notice>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {error || !rows ? (
        <LoadState error={error} what="possible duplicates" />
      ) : (
        <RecordTable<Row>
          label="Possible duplicates"
          rows={rows}
          rowKey={(row) => `${row.kind}-${row.key}`}
          emptyMessage="No possible duplicates right now."
          columns={[
            {
              header: 'Possible duplicates',
              rowHeader: true,
              render: (row) => (
                <>
                  <strong>{namesOf(row)}</strong>
                  <span className="cell-note">
                    {row.kind === 'case'
                      ? ['Cases', row.records[0]!.clientDisplayName, row.records[0]!.countyDisplayName].filter(Boolean).join('. ')
                      : row.records.some((one) => one.provider)
                        ? 'Providers'
                        : 'People'}
                  </span>
                </>
              ),
            },
            {
              header: 'Why they look alike',
              render: (row) => (
                <ul className="plain-list">
                  {row.pairs.map((pair) => (
                    <li key={pair.ids.join('|')}>
                      {row.pairs.length > 1 && `${nameOf(row, pair.ids[0])} and ${nameOf(row, pair.ids[1])}: `}
                      {pair.why}{' '}
                      <button type="button" className="link-button" onClick={() => setDismissing({ row, pair })}>
                        Not the same{' '}
                        <span className="usa-sr-only">
                          : {nameOf(row, pair.ids[0])} and {nameOf(row, pair.ids[1])}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ),
            },
            { header: 'Invoices on each', render: (row) => listed(row.records.map((record) => String(record.invoiceCount || 'none'))) },
            {
              header: 'What to do',
              render: (row) =>
                isAdmin &&
                (row.kind === 'case' ? (
                  <Button small onClick={() => setMergingCases(row.records)}>
                    Merge <span className="usa-sr-only">{namesOf(row)}</span>
                  </Button>
                ) : (
                  <Link
                    className={buttonClass('secondary', { small: true })}
                    to={mergePath(row.records[0]!.personId, row.records.slice(1).map((one) => one.personId))}
                  >
                    Merge <span className="usa-sr-only">{namesOf(row)}</span>
                  </Link>
                )),
            },
          ]}
        />
      )}
      <Notice tone="info">Only administrators can merge. A possible duplicate is also flagged on the case&apos;s page and the provider&apos;s page.</Notice>
      <h3>Recent merges of people</h3>
      <RecentMerges version={version} undoing={undoing} onUndo={(ids) => void undo(ids)} />
      <p className="compact-hint">
        A case merge is undone in <Link to={settingsPath('edit-data')}>Edit data</Link>, under its recent fixes, one case at a time.
      </p>

      {flagging === 'case' && (
        <FlagCasesDialog
          onClose={() => setFlagging(null)}
          onFlagged={() => {
            setFlagging(null);
            changed('Flagged. They are listed here until one is closed or someone marks them as different cases.');
          }}
        />
      )}
      {flagging === 'person' && (
        <FlagPeopleDialog
          onClose={() => setFlagging(null)}
          onFlagged={() => {
            setFlagging(null);
            changed('Flagged. They are listed here until someone merges them or marks them as different people.');
          }}
        />
      )}
      {dismissing && (
        <NotDuplicateDialog
          what={dismissing.row.kind === 'case' ? 'case' : 'person'}
          names={[nameOf(dismissing.row, dismissing.pair.ids[0]), nameOf(dismissing.row, dismissing.pair.ids[1])]}
          save={(note) =>
            dismissing.row.kind === 'case'
              ? reviewPossibleDuplicateCase({ caseIds: dismissing.pair.ids, outcome: 'not_duplicate', note })
              : reviewPossibleDuplicate({ personIds: dismissing.pair.ids, outcome: 'not_duplicate', note })
          }
          onClose={() => setDismissing(null)}
          onDone={(text) => {
            setDismissing(null);
            changed(text);
          }}
        />
      )}
      {mergingCases && (
        <MergeCasesDialog
          group={mergingCases}
          onClose={() => setMergingCases(null)}
          onMerged={(text) => {
            setMergingCases(null);
            changed(text);
          }}
        />
      )}
    </>
  );
}

// Which case to keep, what moving each of the others does, then the moves, all or none.
function MergeCasesDialog({ group, onClose, onMerged }: { group: DuplicateCase[]; onClose: () => void; onMerged: (message: string) => void }) {
  const [keptId, setKeptId] = useState(group[0]!.caseId);
  const kept = group.find((record) => record.caseId === keptId)!;
  const moving = group.filter((record) => record.caseId !== keptId);
  const [keep, setKeep] = useState<Record<string, Record<string, 'moved' | 'kept'>>>({});
  const [preview, setPreview] = useState<Array<{ caseId: string } & CaseFixPreview> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const merge = { keptCaseId: kept.caseId, caseIds: moving.map((record) => record.caseId), keepPreauthorizations: keep };
  const numberOf = (caseId: string) => group.find((record) => record.caseId === caseId)?.caseNumber ?? 'the other case';
  const keptNumber = kept.caseNumber ?? 'the case kept';

  async function run(action: 'preview' | 'merge') {
    setBusy(true);
    setError(null);
    try {
      if (action === 'preview') setPreview((await previewCaseMerge(merge)).cases);
      else {
        await mergeCases(merge);
        const invoices = preview?.reduce((sum, one) => sum + one.invoices.length, 0) ?? 0;
        onMerged(`${plural(invoices, 'invoice')} moved to ${keptNumber}, and ${listed(moving.map((record) => record.caseNumber ?? 'a case'))} closed. Undo each in Edit data.`);
      }
    } catch (err) {
      setError(apiErrorMessage(err, 'The cases could not be merged.'));
    } finally {
      setBusy(false);
    }
  }

  const choicesMissing = preview?.some((one) => one.preauthorizationChoices.some((choice) => !keep[one.caseId]?.[choice.professionalId])) ?? false;
  return (
    <Dialog title={group.length > 2 ? `Merge ${group.length} cases` : 'Merge two cases'} onClose={onClose} className="dialog--wide">
      <fieldset className="case-step__choices">
        <legend className="case-step__question">Which case do you keep?</legend>
        {group.map((record) => (
          <label key={record.caseId} className="radio-row">
            <input
              type="radio"
              name="merge-keep"
              checked={keptId === record.caseId}
              onChange={() => {
                setKeptId(record.caseId);
                setPreview(null);
                setKeep({});
              }}
            />
            <span>
              {caseLabel(record)} <span className="cell-note">{plural(record.invoiceCount, 'invoice')}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p>
        The invoices and pre-authorizations on {listed(moving.map((record) => record.caseNumber ?? 'the other cases'))} move to {keptNumber}, and{' '}
        {moving.length > 1 ? 'those cases are' : 'it is'} closed as added by mistake, all or none. Each invoice keeps the number as typed.
      </p>
      {preview && (
        <div className="decision-panel">
          {preview.map((one) => (
            <div key={one.caseId}>
              <p>
                From {numberOf(one.caseId)}: <strong>{plural(one.invoices.length, 'invoice')}</strong> and{' '}
                {plural(one.preauthorizationRequests.length, 'pre-authorization request')}.
              </p>
              {one.preauthorizationChoices.map((choice) => (
                <fieldset key={choice.professionalId}>
                  <legend>
                    Both {numberOf(one.caseId)} and {keptNumber} have a pre-authorization for {choice.providerDisplayName ?? 'a provider'}. Which do you keep?
                  </legend>
                  {(['kept', 'moved'] as const).map((which) => (
                    <label key={which} className="radio-row">
                      <input
                        type="radio"
                        name={`keep-${one.caseId}-${choice.professionalId}`}
                        checked={keep[one.caseId]?.[choice.professionalId] === which}
                        onChange={() => setKeep((current) => ({ ...current, [one.caseId]: { ...current[one.caseId], [choice.professionalId]: which } }))}
                      />
                      {which === 'kept' ? `The one on ${keptNumber}` : `The one on ${numberOf(one.caseId)}`}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          ))}
        </div>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="dialog__actions">
        {preview ? (
          <Button kind="primary" disabled={busy || choicesMissing} onClick={() => void run('merge')}>
            {busy ? 'Merging…' : 'Merge'}
          </Button>
        ) : (
          <Button kind="primary" disabled={busy} onClick={() => void run('preview')}>
            {busy ? 'Checking…' : 'See what moves'}
          </Button>
        )}
        <button type="button" className="link-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
