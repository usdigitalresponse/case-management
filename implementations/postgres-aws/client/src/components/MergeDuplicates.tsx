// Settings › Merge duplicates (design K67): possible duplicate cases and people
// in one table. Any staff member flags a pair or says it is not the same; only
// administrators merge. A person is merged after a preview (../pages/MergePeople.tsx);
// a case belongs to the external system, so "merging" it moves its invoices to
// the case kept and closes it as added by mistake (Edit data), undone there.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  apiErrorMessage,
  fixCase,
  previewCaseFix,
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
import { mergePath } from '../staffPaths';
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

type Row =
  | { kind: 'case'; key: string; records: [DuplicateCase, DuplicateCase]; why: string }
  | { kind: 'person'; key: string; records: [DuplicatePerson, DuplicatePerson]; labels: [string, string]; why: string };

const invoices = (a: number, b: number) => `${a || 'none'} and ${b || 'none'}`;

// The record with more on it is offered as the one to keep.
const heavierFirst = <T extends { invoiceCount: number }>(a: T, b: T): [T, T] => (b.invoiceCount > a.invoiceCount ? [b, a] : [a, b]);

function rowsOf(cases: PossibleDuplicateCase[], people: PossibleDuplicate[]): Row[] {
  const caseRows: Row[] = cases.flatMap((group) =>
    group.pairs.map((pair) => {
      const [a, b] = pair.caseIds.map((id) => group.cases.find((record) => record.caseId === id)!) as [DuplicateCase, DuplicateCase];
      const why = pair.reasons.filter((reason) => reason !== 'same_county').map((reason) => CASE_REASONS[reason]).join('; ');
      return { kind: 'case' as const, key: pair.caseIds.join('|'), records: heavierFirst(a, b), why };
    }),
  );
  const personRows: Row[] = people.flatMap((group) => {
    const labels = personLabels(group.people);
    return group.pairs.map((pair) => {
      const [a, b] = heavierFirst(...(pair.personIds.map((id) => group.people.find((one) => one.personId === id)!) as [DuplicatePerson, DuplicatePerson]));
      return {
        kind: 'person' as const,
        key: pair.personIds.join('|'),
        records: [a, b] as [DuplicatePerson, DuplicatePerson],
        labels: [labels.get(a.personId)!, labels.get(b.personId)!] as [string, string],
        why: pair.reasons.map((reason) => PERSON_REASONS[reason]).join('; '),
      };
    });
  });
  return [...caseRows, ...personRows];
}

export function MergeDuplicates() {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.isAdmin);
  const [version, setVersion] = useState(0);
  const cases = useResource(possibleDuplicateCases, { resetKey: version });
  const people = useResource(possibleDuplicates, { resetKey: version });
  const [message, setMessage] = useState<SaveMessage | null>(null);
  const [flagging, setFlagging] = useState<'case' | 'person' | null>(null);
  const [dismissing, setDismissing] = useState<Row | null>(null);
  const [mergingCases, setMergingCases] = useState<[DuplicateCase, DuplicateCase] | null>(null);
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
  const name = (row: Row, index: 0 | 1) => (row.kind === 'case' ? (row.records[index].caseNumber ?? 'No case number') : row.labels[index]);

  return (
    <>
      <div className="section-title-row">
        <p className="compact-hint">
          The same case or provider can end up here twice, because people type numbers and names themselves. Merging moves every invoice to the
          one you keep. Each invoice still shows the number or name as typed.
        </p>
        <span className="row-actions">
          <Button kind="secondary" onClick={() => setFlagging('case')}>
            Flag two cases
          </Button>
          <Button kind="secondary" onClick={() => setFlagging('person')}>
            Flag two people
          </Button>
        </span>
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
                  <strong>
                    {name(row, 0)} and {name(row, 1)}
                  </strong>
                  <span className="cell-note">
                    {row.kind === 'case'
                      ? ['Cases', row.records[0].clientDisplayName, row.records[0].countyDisplayName].filter(Boolean).join('. ')
                      : row.records[0].provider
                        ? `Providers${row.records[0].provider.kind ? `. ${row.records[0].provider.kind}` : ''}`
                        : 'People'}
                  </span>
                </>
              ),
            },
            { header: 'Why they look alike', render: (row) => row.why },
            { header: 'Invoices on each', render: (row) => invoices(row.records[0].invoiceCount, row.records[1].invoiceCount) },
            {
              header: 'What to do',
              render: (row) => (
                <span className="row-actions">
                  {isAdmin &&
                    (row.kind === 'case' ? (
                      <Button small onClick={() => setMergingCases(row.records)}>
                        Merge <span className="usa-sr-only">{`${name(row, 0)} and ${name(row, 1)}`}</span>
                      </Button>
                    ) : (
                      <Link className={buttonClass('secondary', { small: true })} to={mergePath(row.records[0].personId, [row.records[1].personId])}>
                        Merge <span className="usa-sr-only">{`${name(row, 0)} and ${name(row, 1)}`}</span>
                      </Link>
                    ))}
                  <button type="button" className="link-button" onClick={() => setDismissing(row)}>
                    Not the same <span className="usa-sr-only">{`: ${name(row, 0)} and ${name(row, 1)}`}</span>
                  </button>
                </span>
              ),
            },
          ]}
        />
      )}
      <Notice tone="info">Only administrators can merge. A possible duplicate is also flagged on the case&apos;s page and the provider&apos;s page.</Notice>
      <h3>Recent merges of people</h3>
      <RecentMerges version={version} undoing={undoing} onUndo={(ids) => void undo(ids)} />
      <p className="compact-hint">
        A case merge is undone in <Link to="/settings?tab=edit-data">Edit data</Link>, under its recent fixes.
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
          what={dismissing.kind === 'case' ? 'case' : 'person'}
          names={[name(dismissing, 0), name(dismissing, 1)]}
          save={(note) =>
            dismissing.kind === 'case'
              ? reviewPossibleDuplicateCase({ caseIds: [dismissing.records[0].caseId, dismissing.records[1].caseId], outcome: 'not_duplicate', note })
              : reviewPossibleDuplicate({ personIds: [dismissing.records[0].personId, dismissing.records[1].personId], outcome: 'not_duplicate', note })
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
          pair={mergingCases}
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

// Which case to keep, what moving the other's invoices does, then the move.
function MergeCasesDialog({ pair, onClose, onMerged }: { pair: [DuplicateCase, DuplicateCase]; onClose: () => void; onMerged: (message: string) => void }) {
  const [keptId, setKeptId] = useState(pair[0].caseId);
  const kept = pair.find((record) => record.caseId === keptId)!;
  const moving = pair.find((record) => record.caseId !== keptId)!;
  const [keep, setKeep] = useState<Record<string, 'moved' | 'kept'>>({});
  const [preview, setPreview] = useState<CaseFixPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fix = { kind: 'same_case' as const, caseId: moving.caseId, keptCaseId: kept.caseId, keepPreauthorizations: keep };
  const label = (record: DuplicateCase) => caseLabel(record);

  async function run(action: 'preview' | 'merge') {
    setBusy(true);
    setError(null);
    try {
      if (action === 'preview') setPreview(await previewCaseFix(fix));
      else {
        await fixCase(fix);
        onMerged(`${plural(preview?.invoices.length ?? 0, 'invoice')} moved to ${kept.caseNumber ?? 'the case kept'}, and ${moving.caseNumber ?? 'the other'} closed. Undo it in Edit data.`);
      }
    } catch (err) {
      setError(apiErrorMessage(err, 'The cases could not be merged.'));
    } finally {
      setBusy(false);
    }
  }

  const choicesMissing = preview?.preauthorizationChoices.some((choice) => !keep[choice.professionalId]) ?? false;
  return (
    <Dialog title="Merge two cases" onClose={onClose} className="dialog--wide">
      <fieldset className="case-step__choices">
        <legend className="case-step__question">Which case do you keep?</legend>
        {pair.map((record) => (
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
              {label(record)} <span className="cell-note">{plural(record.invoiceCount, 'invoice')}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p>
        The invoices and pre-authorizations on {moving.caseNumber ?? 'the other case'} move to {kept.caseNumber ?? 'the case kept'}, and{' '}
        {moving.caseNumber ?? 'it'} is closed as added by mistake. Each invoice keeps the number as typed.
      </p>
      {preview && (
        <div className="decision-panel">
          <p>
            <strong>{plural(preview.invoices.length, 'invoice')}</strong> and {plural(preview.preauthorizationRequests.length, 'pre-authorization request')} move.
          </p>
          {preview.preauthorizationChoices.map((choice) => (
            <fieldset key={choice.professionalId}>
              <legend>Both cases have a pre-authorization for {choice.providerDisplayName ?? 'a provider'}. Which do you keep?</legend>
              {(['kept', 'moved'] as const).map((which) => (
                <label key={which} className="radio-row">
                  <input
                    type="radio"
                    name={`keep-${choice.professionalId}`}
                    checked={keep[choice.professionalId] === which}
                    onChange={() => setKeep((current) => ({ ...current, [choice.professionalId]: which }))}
                  />
                  {which === 'kept' ? `The one on ${kept.caseNumber ?? 'the case kept'}` : `The one on ${moving.caseNumber ?? 'the other case'}`}
                </label>
              ))}
            </fieldset>
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
