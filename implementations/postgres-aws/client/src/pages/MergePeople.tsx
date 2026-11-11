// What merging one person into another would move, and, for an
// administrator, the merge itself once they confirm the two are one person.
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
import { mergePath, POSSIBLE_DUPLICATES_PATH } from '../staffPaths';
import { DuplicatePersonDetails } from './PossibleDuplicates';

export default function MergePeople() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const keep = searchParams.get('keep') ?? '';
  const retire = searchParams.get('retire') ?? '';
  const { data: preview, error } = useResource(keep && retire ? mergePreview(keep, retire) : null);
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const crumbs = [{ label: 'Possible duplicates', to: POSSIBLE_DUPLICATES_PATH }, { label: 'Merge' }];

  if (!keep || !retire) {
    return <Notice tone="danger">Choose two people to merge from Possible duplicates.</Notice>;
  }
  if (error || !preview) {
    return <LoadState error={error} what="what this merge would do" />;
  }
  const { kept, retired } = preview;
  const blocked = preview.blockers.length > 0;
  const total = preview.moves.reduce((sum, move) => sum + move.count, 0);

  async function merge() {
    setSaving(true);
    setSaveError(null);
    try {
      const { personMergeId } = await mergePeople({ keptPersonId: kept.personId, retiredPersonId: retired.personId, note });
      navigate(`${POSSIBLE_DUPLICATES_PATH}?merged=${personMergeId}`);
    } catch (err) {
      setSaveError(apiErrorMessage(err, 'They could not be merged.'));
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        crumbs={crumbs}
        title={`Merge ${retired.displayName} into ${kept.displayName}`}
        description="Check that these are the same person and what will move. The merge can be undone from Possible duplicates."
        actions={
          <Button kind="secondary" onClick={() => navigate(mergePath(retired.personId, kept.personId), { replace: true })}>
            Keep {retired.displayName} instead
          </Button>
        }
      />
      <div className="merge-sides">
        <section className="card merge-side">
          <h2>Keep</h2>
          <DuplicatePersonDetails person={kept} />
        </section>
        <section className="card merge-side merge-side--retired">
          <h2>Merge in and retire</h2>
          <DuplicatePersonDetails person={retired} />
        </section>
      </div>

      {blocked && (
        <Notice tone="danger" heading="These can’t be merged yet">
          <ul>
            {preview.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </Notice>
      )}

      <h2>What moves to {kept.displayName}</h2>
      <RecordTable
        rows={preview.moves}
        rowKey={(move) => move.label}
        emptyMessage={`Nothing else names ${retired.displayName}.`}
        columns={[
          { header: 'Record', rowHeader: true, render: (move) => move.label },
          { header: 'How many', align: 'right', render: (move) => move.count },
        ]}
      />

      {preview.filledIn.length > 0 && (
        <>
          <h2>Filled in on {kept.displayName}’s record</h2>
          <p className="compact-hint">Only details {kept.displayName}’s record doesn’t have; nothing on it is replaced.</p>
          <RecordTable
            rows={preview.filledIn}
            rowKey={(detail) => detail.label}
            columns={[
              { header: 'Detail', rowHeader: true, render: (detail) => detail.label },
              { header: `From ${retired.displayName}`, render: (detail) => detail.value },
            ]}
          />
        </>
      )}

      <h2>What doesn’t change</h2>
      <ul className="merge-notes">
        {preview.notMoved.map((line) => (
          <li key={line}>{line}</li>
        ))}
        <li>{kept.displayName}’s name and details stay as they are.</li>
        <li>Invoices already sent keep the names and prices they were sent with.</li>
        <li>What anyone did in the app stays recorded under whoever did it.</li>
        <li>{retired.displayName} is hidden from lists and searches but not deleted, so the merge can be undone.</li>
      </ul>

      {user?.isAdmin ? (
        <section className="card merge-confirm">
          <label className="usa-label" htmlFor="merge-note">
            Why they are the same person (optional)
          </label>
          <textarea id="merge-note" className="usa-textarea" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
          <label className="checkbox-row" htmlFor="merge-confirmed">
            <input id="merge-confirmed" type="checkbox" checked={confirmed} disabled={blocked} onChange={(event) => setConfirmed(event.target.checked)} />
            I’ve checked that {retired.displayName} and {kept.displayName} are the same person, and want to move {total === 1 ? 'this record' : `these ${total} records`} to {kept.displayName}.
          </label>
          {saveError && <Notice tone="danger">{saveError}</Notice>}
          <div className="merge-confirm__actions">
            <Button kind="danger" disabled={!confirmed || blocked || saving} onClick={() => void merge()}>
              {saving ? 'Merging…' : `Merge into ${kept.displayName}`}
            </Button>
            <button type="button" className="link-button" onClick={() => navigate(POSSIBLE_DUPLICATES_PATH)}>
              Cancel
            </button>
          </div>
        </section>
      ) : (
        <Notice tone="info">Only an administrator can merge people. You can flag them, or mark them as different people, from Possible duplicates.</Notice>
      )}
    </div>
  );
}
