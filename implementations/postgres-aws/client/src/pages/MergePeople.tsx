// What merging records of one person into the one kept would move, and, for
// an administrator, the merge itself once they confirm they are one person.
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { apiErrorMessage, mergePeople } from '../api/client';
import { useAuth } from '../AuthContext';
import { useResource } from '../hooks/useResource';
import { mergePreview } from '../resources';
import { PageHeader } from '../components/PageHeader';
import { LoadState } from '../components/LoadState';
import { RecordTable } from '../components/RecordTable';
import { Button } from '../components/ui/Button';
import { Notice } from '../components/ui/Notice';
import { duplicatesPath, mergePath } from '../staffPaths';
import { DuplicatePersonDetails, personLabels } from '../components/DuplicatePeople';

export default function MergePeople() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const keep = searchParams.get('keep') ?? '';
  const retire = (searchParams.get('retire') ?? '').split(',').filter(Boolean);
  const { data: preview, error } = useResource(keep && retire.length > 0 ? mergePreview(keep, retire) : null);
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const crumbs = [{ label: 'Settings', to: '/settings' }, { label: 'Merge duplicates', to: duplicatesPath() }, { label: 'Merge' }];

  if (!keep || retire.length === 0) {
    return <Notice tone="danger">Choose the records to merge from People’s Review duplicates tab.</Notice>;
  }
  if (error || !preview) {
    return <LoadState error={error} what="what this merge would do" />;
  }
  const { kept, retired } = preview;
  const labels = personLabels([kept, ...retired.map((plan) => plan.person)]);
  const keptName = labels.get(kept.personId)!;
  const nameOf = (personId: string) => labels.get(personId)!;
  const several = retired.length > 1;
  const blockers = retired.flatMap((plan) => plan.blockers.map((blocker) => (several ? `${nameOf(plan.person.personId)}: ${blocker}` : blocker)));
  const blocked = blockers.length > 0;
  const moveLabels = [...new Set(retired.flatMap((plan) => plan.moves.map((move) => move.label)))];
  const filledIn = retired.flatMap((plan) => plan.filledIn.map((detail) => ({ ...detail, from: nameOf(plan.person.personId) })));
  const sameName = retired.every((plan) => plan.person.displayName === kept.displayName);
  const go = (keptId: string, retiredIds: string[]) => {
    setConfirmed(false);
    navigate(mergePath(keptId, retiredIds), { replace: true });
  };

  async function merge() {
    setSaving(true);
    setSaveError(null);
    try {
      const { personMergeIds } = await mergePeople({ keptPersonId: kept.personId, retiredPersonIds: retired.map((plan) => plan.person.personId), note });
      navigate(duplicatesPath({ merged: personMergeIds.join(',') }));
    } catch (err) {
      setSaveError(apiErrorMessage(err, 'They could not be merged.'));
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        crumbs={crumbs}
        title={
          sameName
            ? `Merge ${retired.length + 1} records for ${kept.displayName}`
            : several
              ? `Merge ${retired.length} records into ${kept.displayName}`
              : `Merge ${retired[0]!.person.displayName} into ${kept.displayName}`
        }
        description="Check that these are all the same person and what will move. The merge can be undone from People’s Review duplicates tab."
      />
      <div className="merge-sides">
        <section className="card merge-side">
          <h2>Keep</h2>
          <DuplicatePersonDetails person={kept} />
        </section>
        {retired.map((plan) => (
          <section key={plan.person.personId} className="card merge-side merge-side--retired">
            <h2>Merge in and retire</h2>
            <DuplicatePersonDetails person={plan.person} />
            <div className="merge-side__actions">
              <button
                type="button"
                className="link-button"
                onClick={() => go(plan.person.personId, [kept.personId, ...retire.filter((id) => id !== plan.person.personId)])}
              >
                Keep this one instead
              </button>
              {several && (
                <button type="button" className="link-button" onClick={() => go(kept.personId, retire.filter((id) => id !== plan.person.personId))}>
                  Leave out
                </button>
              )}
            </div>
          </section>
        ))}
      </div>

      {blocked && (
        <Notice tone="danger" heading="These can’t be merged yet">
          <ul>
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </Notice>
      )}

      <h2>What moves to {keptName}</h2>
      <RecordTable
        rows={moveLabels}
        rowKey={(label) => label}
        emptyMessage={`Nothing else names ${several ? 'these records' : nameOf(retired[0]!.person.personId)}.`}
        columns={[
          { header: 'Record', rowHeader: true, render: (label) => label },
          ...retired.map((plan) => ({
            header: several ? `From ${nameOf(plan.person.personId)}` : 'How many',
            align: 'right' as const,
            render: (label: string) => plan.moves.find((move) => move.label === label)?.count ?? '—',
          })),
        ]}
      />

      {filledIn.length > 0 && (
        <>
          <h2>Filled in on {keptName}’s record</h2>
          <p className="compact-hint">Only details {keptName}’s record doesn’t have; nothing on it is replaced.</p>
          <RecordTable
            rows={filledIn}
            rowKey={(detail) => `${detail.from}|${detail.label}`}
            columns={[
              { header: 'Detail', rowHeader: true, render: (detail) => detail.label },
              { header: 'Value', render: (detail) => detail.value },
              { header: 'From', render: (detail) => detail.from },
            ]}
          />
        </>
      )}

      <h2>What doesn’t change</h2>
      <ul className="merge-notes">
        {retired.flatMap((plan) =>
          plan.notMoved.map((line) => <li key={`${plan.person.personId}|${line}`}>{several ? `${nameOf(plan.person.personId)}: ${line}` : line}</li>),
        )}
        <li>{keptName}’s name and details stay as they are.</li>
        <li>Invoices already sent keep the names and prices they were sent with.</li>
        <li>What anyone did in the app stays recorded under whoever did it.</li>
        <li>
          {several ? 'The merged records are' : `${nameOf(retired[0]!.person.personId)} is`} hidden from lists and searches but not deleted, so the merge can
          be undone.
        </li>
      </ul>

      {user?.isAdmin ? (
        <section className="card merge-confirm">
          <label className="usa-label" htmlFor="merge-note">
            Why they are the same person (optional)
          </label>
          <textarea id="merge-note" className="usa-textarea" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
          <label className="checkbox-row" htmlFor="merge-confirmed">
            <input id="merge-confirmed" type="checkbox" checked={confirmed} disabled={blocked} onChange={(event) => setConfirmed(event.target.checked)} />
            {several
              ? `I’ve checked that all ${retired.length + 1} records are the same person, and want to move everything listed above to ${keptName}.`
              : `I’ve checked that ${nameOf(retired[0]!.person.personId)} and ${keptName} are the same person, and want to move everything listed above to ${keptName}.`}
          </label>
          {saveError && <Notice tone="danger">{saveError}</Notice>}
          <div className="merge-confirm__actions">
            <Button kind="danger" disabled={!confirmed || blocked || saving} onClick={() => void merge()}>
              {saving ? 'Merging…' : `Merge into ${keptName}`}
            </Button>
            <button type="button" className="link-button" onClick={() => navigate(duplicatesPath())}>
              Cancel
            </button>
          </div>
        </section>
      ) : (
        <Notice tone="info">Only an administrator can merge people. You can mark them as different people from People’s Review duplicates tab.</Notice>
      )}
    </div>
  );
}
