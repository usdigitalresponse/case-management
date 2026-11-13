// Settings, Edit data (model/rules.yaml correct_case_records): an
// administrator fixes a case added by mistake. The preview says exactly what
// moves or changes before anything does; every fix can be undone.
import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  apiErrorMessage,
  fixCase,
  previewCaseFix,
  undoCaseFix,
  type AddedCase,
  type CaseFix,
  type CaseFixPreview,
} from '../../api/client';
import { useResource } from '../../hooks/useResource';
import { useSearchParamState } from '../../hooks/useSearchParamState';
import { addedCases, caseFixes } from '../../resources';
import { RecordTable } from '../../components/RecordTable';
import { CountyPicker } from '../../components/CountyPicker';
import { Notice } from '../../components/ui/Notice';
import { Button } from '../../components/ui/Button';
import { FilterTag } from '../../components/ui/Tag';
import { formatDateTime } from '../../formatDateTime';
import { formatMoney } from '../../formatMoney';
import type { CountyValue } from '../../counties';

const SHOWS = ['added', 'similar'] as const;
type Kind = CaseFix['kind'];

const KIND_LABELS: Record<Kind, { label: string; hint: string }> = {
  same_case: {
    label: 'It’s the same case as another',
    hint: 'Move its invoices and pre-authorizations there and close this one as added by mistake.',
  },
  corrected: {
    label: 'Its number, county or client is wrong',
    hint: 'Correct it here. Invoices keep the number they were sent with.',
  },
  not_for_case: {
    label: 'Its invoices aren’t for one case',
    hint: 'Take them off this case, keeping their county, and close it as added by mistake.',
  },
};

const caseName = (row: { caseNumber: string | null; clientDisplayName: string | null }) =>
  [row.caseNumber ?? 'No number', row.clientDisplayName].filter(Boolean).join(' · ');

const elsewhereNames = (rows: AddedCase['elsewhere']) => rows.map((row) => row.countyDisplayName ?? 'another county').join(', ');

export function EditData() {
  const [show, setShow] = useSearchParamState('show', 'added', SHOWS);
  const [version, setVersion] = useState(0);
  const { data: cases, error } = useResource(addedCases(show), { resetKey: version });
  const [fixing, setFixing] = useState<AddedCase | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const changed = (text: string) => {
    setMessage(text);
    setFixing(null);
    setVersion((value) => value + 1);
  };

  return (
    <div className="edit-data">
      <p className="compact-hint">
        Administrators only. Fix cases added by mistake from invoices or pre-authorization requests. Every change is recorded and can be undone;
        signed-off amounts never change, only where they count.
      </p>
      {message && <Notice tone="success">{message}</Notice>}
      <section className="settings-section" aria-labelledby="edit-data-cases">
        <h2 id="edit-data-cases">Cases</h2>
        <div className="list-controls" role="group" aria-label="Show">
          <FilterTag aria-pressed={show === 'added'} onClick={() => setShow('added')}>
            Added from requests
          </FilterTag>
          <FilterTag aria-pressed={show === 'similar'} onClick={() => setShow('similar')}>
            With a similar number
          </FilterTag>
        </div>
        {Boolean(error) && <Notice tone="danger">The cases could not be loaded.</Notice>}
        {cases && (
          <RecordTable
            label="Cases added from requests"
            rows={cases}
            rowKey={(row) => row.caseId}
            emptyMessage={
              show === 'similar' ? 'No added case has a similar number in its county, or its number in another county.' : 'No cases have been added from requests.'
            }
            rowDetail={(row) => (fixing?.caseId === row.caseId ? <FixCase key={row.caseId} added={row} onDone={changed} onCancel={() => setFixing(null)} /> : null)}
            columns={[
              {
                header: 'Case',
                rowHeader: true,
                render: (row) => (
                  <>
                    <RouterLink to={`/cases/${row.caseId}`}>{row.caseNumber ?? 'No number'}</RouterLink>
                    {row.countyDisplayName ? ` · ${row.countyDisplayName}` : ''}
                    <span className="cell-note">{row.clientDisplayName ?? 'No client name'}</span>
                  </>
                ),
              },
              {
                header: 'Added',
                render: (row) => (
                  <>
                    {formatDateTime(row.addedAt)}
                    <span className="cell-note">
                      by {row.addedByDisplayName ?? 'someone'}, from {row.addedFrom === 'invoice' ? 'an invoice' : 'a pre-authorization request'}
                    </span>
                  </>
                ),
              },
              {
                header: 'Invoices',
                align: 'right',
                render: (row) => (
                  <>
                    {row.invoices}
                    {row.preauthorizationRequests > 0 && <span className="cell-note">{row.preauthorizationRequests} pre-authorization requests</span>}
                  </>
                ),
              },
              {
                header: 'Similar',
                render: (row) => (
                  <>
                    {row.similar.length ? row.similar.map(caseName).join('; ') : 'None'}
                    {row.elsewhere.length > 0 && <span className="cell-note">Same number in {elsewhereNames(row.elsewhere)}</span>}
                  </>
                ),
              },
              {
                header: 'Fix',
                hiddenHeader: true,
                align: 'right',
                render: (row) => (
                  <Button small onClick={() => setFixing(fixing?.caseId === row.caseId ? null : row)} aria-expanded={fixing?.caseId === row.caseId}>
                    Fix
                  </Button>
                ),
              },
            ]}
          />
        )}
      </section>
      <RecentFixes version={version} onUndone={changed} />
      <p className="compact-hint">Later: possible duplicate people and cases move here from the People and All cases tabs.</p>
    </div>
  );
}

function FixCase({ added, onDone, onCancel }: { added: AddedCase; onDone: (message: string) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [keptCaseId, setKeptCaseId] = useState(added.similar[0]?.caseId ?? '');
  const [caseNumber, setCaseNumber] = useState(added.caseNumber ?? '');
  const [county, setCounty] = useState<CountyValue | null>(
    added.countyId && added.countyDisplayName ? { countyId: added.countyId, displayName: added.countyDisplayName } : null,
  );
  const [clientName, setClientName] = useState(added.clientDisplayName ?? '');
  const [keep, setKeep] = useState<Record<string, 'moved' | 'kept'>>({});
  const [preview, setPreview] = useState<CaseFixPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fix = (): CaseFix | null => {
    if (kind === 'same_case') return keptCaseId ? { kind, caseId: added.caseId, keptCaseId, keepPreauthorizations: keep } : null;
    if (kind === 'corrected') {
      return {
        kind,
        caseId: added.caseId,
        caseNumber: caseNumber.trim() || undefined,
        countyId: county?.countyId ?? undefined,
        clientName: clientName.trim() && clientName.trim() !== added.clientDisplayName ? clientName.trim() : undefined,
      };
    }
    return kind ? { kind, caseId: added.caseId } : null;
  };
  const reset = () => {
    setPreview(null);
    setError(null);
  };

  async function run(action: 'preview' | 'fix') {
    const input = fix();
    if (!input) return;
    setBusy(true);
    setError(null);
    try {
      if (action === 'preview') {
        setPreview(await previewCaseFix(input));
      } else {
        await fixCase(input);
        onDone(`Case ${added.caseNumber ?? ''} fixed. You can undo it below.`);
      }
    } catch (err) {
      setError(apiErrorMessage(err, 'The case could not be fixed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card edit-data__fix">
      <h3>Fix {caseName(added)}</h3>
      <fieldset className="usa-fieldset">
        <legend className="usa-label">What’s wrong with it?</legend>
        {(Object.keys(KIND_LABELS) as Kind[]).map((option) => (
          <label key={option} className="radio-row">
            <input
              type="radio"
              name={`fix-kind-${added.caseId}`}
              checked={kind === option}
              onChange={() => {
                setKind(option);
                reset();
              }}
            />
            <span>
              <strong>{KIND_LABELS[option].label}</strong>
              <span className="cell-note">{KIND_LABELS[option].hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {added.elsewhere.length > 0 && (
        <p className="field-hint">
          Case {added.caseNumber} is also in {elsewhereNames(added.elsewhere)}. If this case’s county is wrong, correct it first, then move its invoices to
          that case.
        </p>
      )}
      {kind === 'same_case' &&
        (added.similar.length === 0 ? (
          <p className="field-hint">No other case in its county has a similar number. Correct its number instead if it’s wrong.</p>
        ) : (
          <fieldset className="usa-fieldset">
            <legend className="usa-label">Move to</legend>
            {added.similar.map((other) => (
              <label key={other.caseId} className="radio-row">
                <input
                  type="radio"
                  name={`kept-${added.caseId}`}
                  checked={keptCaseId === other.caseId}
                  onChange={() => {
                    setKeptCaseId(other.caseId);
                    reset();
                  }}
                />
                <span>{caseName(other)}</span>
              </label>
            ))}
          </fieldset>
        ))}

      {kind === 'corrected' && (
        <div className="inline-fields">
          <div className="usa-form-group">
            <label className="usa-label" htmlFor={`fix-number-${added.caseId}`}>
              Case number
            </label>
            <input id={`fix-number-${added.caseId}`} className="usa-input" value={caseNumber} onChange={(event) => (setCaseNumber(event.target.value), reset())} />
          </div>
          <CountyPicker id={`fix-county-${added.caseId}`} value={county} onChange={(value) => (setCounty(value), reset())} />
          <div className="usa-form-group">
            <label className="usa-label" htmlFor={`fix-client-${added.caseId}`}>
              Client’s name
            </label>
            <input id={`fix-client-${added.caseId}`} className="usa-input" value={clientName} onChange={(event) => (setClientName(event.target.value), reset())} />
          </div>
        </div>
      )}

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <FixPreview
          preview={preview}
          keep={keep}
          onKeep={(professionalId, value) => {
            setKeep((current) => ({ ...current, [professionalId]: value }));
            setPreview(null);
          }}
        />
      )}
      <div className="button-row">
        {!preview ? (
          <Button kind="primary" disabled={busy || !fix()} onClick={() => void run('preview')}>
            See what changes
          </Button>
        ) : (
          <Button
            kind="primary"
            disabled={busy || preview.preauthorizationChoices.some((choice) => !keep[choice.professionalId])}
            onClick={() => void run('fix')}
          >
            {kind === 'same_case' ? 'Move and close' : kind === 'not_for_case' ? 'Take them off and close' : 'Correct it'}
          </Button>
        )}
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function FixPreview({
  preview,
  keep,
  onKeep,
}: {
  preview: CaseFixPreview;
  keep: Record<string, 'moved' | 'kept'>;
  onKeep: (professionalId: string, value: 'moved' | 'kept') => void;
}) {
  return (
    <div className="edit-data__preview">
      <strong>What changes</strong>
      <ul>
        {preview.invoices.map((invoice) => (
          <li key={invoice.invoiceId}>
            Invoice from {invoice.senderDisplayName ?? 'an unknown sender'}, {formatMoney(invoice.submittedTotal)} requested, {invoice.statusName?.toLowerCase()}
            {invoice.caseNumberAsTyped ? `, sent as ${invoice.caseNumberAsTyped}` : ''}
          </li>
        ))}
        {preview.preauthorizationRequests.map((request) => (
          <li key={request.preauthorizationRequestId}>Pre-authorization request {request.requestNumber}</li>
        ))}
        {preview.preauthorizations.map((one) => (
          <li key={one.preauthorizationId}>
            {one.providerDisplayName ?? 'A provider'}’s pre-authorization {one.staysOnClosedCase ? 'moves to the case being closed' : 'moves'}
          </li>
        ))}
        {preview.caseChanges.map((change) => (
          <li key={change.column}>
            {change.column === 'external_reference' ? 'Case number' : 'County'} changes
          </li>
        ))}
        {preview.assignmentsMoved > 0 && <li>{preview.assignmentsMoved} people on the case move with it</li>}
        {preview.assignmentsEnded > 0 && <li>{preview.assignmentsEnded} people’s roles on the case end</li>}
        {preview.closes && <li>The case is closed as added by mistake. It stays in history but leaves every list, search and picker.</li>}
        {preview.invoices.length === 0 && preview.caseChanges.length === 0 && !preview.closes && <li>Only the client’s name changes.</li>}
      </ul>
      {preview.preauthorizationChoices.map((choice) => (
        <fieldset key={choice.professionalId} className="usa-fieldset">
          <legend className="usa-label">Both cases have a pre-authorization for {choice.providerDisplayName ?? 'this provider'}. Keep which?</legend>
          {(['moved', 'kept'] as const).map((value) => (
            <label key={value} className="radio-row">
              <input type="radio" name={`keep-${choice.professionalId}`} checked={keep[choice.professionalId] === value} onChange={() => onKeep(choice.professionalId, value)} />
              <span>{value === 'moved' ? 'The one on the case being closed' : 'The one on the case kept'}</span>
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );
}

function RecentFixes({ version, onUndone }: { version: number; onUndone: (message: string) => void }) {
  const { data: fixes } = useResource(caseFixes, { resetKey: version });
  const [error, setError] = useState<string | null>(null);
  if (!fixes || fixes.length === 0) return null;
  return (
    <section className="settings-section" aria-labelledby="edit-data-fixes">
      <h2 id="edit-data-fixes">Recent fixes</h2>
      {error && <Notice tone="danger">{error}</Notice>}
      <RecordTable
        label="Recent fixes"
        rows={fixes}
        rowKey={(row) => row.caseCorrectionId}
        columns={[
          {
            header: 'Fix',
            rowHeader: true,
            render: (row) =>
              row.kind === 'same_case'
                ? `${row.caseNumber ?? 'A case'} moved to ${row.keptCaseNumber ?? 'another case'}`
                : row.kind === 'corrected'
                  ? `${row.caseNumber ?? 'A case'} corrected`
                  : `${row.caseNumber ?? 'A case'}’s invoices taken off it`,
          },
          { header: 'When', render: (row) => `${formatDateTime(row.correctedAt)}, by ${row.correctedByDisplayName}` },
          {
            header: 'Undo',
            hiddenHeader: true,
            align: 'right',
            render: (row) =>
              row.undoneAt ? (
                `Undone ${formatDateTime(row.undoneAt)}`
              ) : (
                <Button
                  small
                  onClick={() =>
                    undoCaseFix(row.caseCorrectionId).then(
                      (result) => onUndone(result.leftAsIs > 0 ? `Undone. ${result.leftAsIs} values changed since were left as they are.` : 'Undone.'),
                      (err: unknown) => setError(apiErrorMessage(err, 'It could not be undone.')),
                    )
                  }
                >
                  Undo
                </Button>
              ),
          },
        ]}
      />
    </section>
  );
}
