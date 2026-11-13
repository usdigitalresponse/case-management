import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  apiErrorMessage,
  chooseCaseInReview,
  setDraftCaseChoice,
  type CaseByNumber,
  type CaseChoiceInput,
  type QueuedInvoice,
} from '../api/client';
import { useResource } from '../hooks/useResource';
import { caseMatches } from '../resources';
import { Button } from './ui/Button';
import { SegmentedChoice } from './ui/SegmentedChoice';

// The case step (model/rules.yaml match_invoice_to_case): for a case, found by
// the invoice's number within its county or added from them, or not for one
// case. On a staff draft the answer is kept and applied when it is sent; in
// review it applies at once, and a found case is only offered.
export function CaseStep({
  invoice,
  mode,
  missing = false,
  beforeChange = async () => true,
  onChanged,
}: {
  invoice: QueuedInvoice;
  mode: 'draft' | 'review';
  // Shown once sending or finishing was refused for want of an answer.
  missing?: boolean;
  // Saves the lines first, on a page with unsaved ones.
  beforeChange?: () => Promise<boolean>;
  onChanged: (message?: string) => void;
}) {
  const [forCase, setForCase] = useState(invoice.caseChoice !== 'none');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(input: CaseChoiceInput, message?: string) {
    setSaving(true);
    setError(null);
    try {
      if (!(await beforeChange())) return;
      if (mode === 'draft') {
        await setDraftCaseChoice(invoice.invoiceId, input);
        onChanged(message);
      } else {
        const result = await chooseCaseInReview(invoice.invoiceId, input);
        onChanged(result.caseProblem ?? message);
      }
    } catch (err) {
      setError(apiErrorMessage(err, 'The case could not be saved. Try again.'));
    } finally {
      setSaving(false);
    }
  }

  const noAnswer = !invoice.caseChoice;
  // Work not for one case counts only under its own county.
  const noCounty = invoice.caseChoice === 'none' && !invoice.countyId;
  return (
    <fieldset className={`card case-step${missing && (noAnswer || noCounty) ? ' is-missing' : ''}`}>
      <legend className="case-step__legend">Which case is it for?</legend>
      <SegmentedChoice
        label="Which case is it for?"
        value={forCase ? 'case' : 'none'}
        disabled={saving}
        options={[
          { value: 'case', label: 'For a case' },
          { value: 'none', label: 'Not for one case' },
        ]}
        onChange={(value) => {
          setForCase(value === 'case');
          void save(value === 'case' ? { choice: null } : { choice: 'none' });
        }}
      />
      {forCase ? (
        <CaseLookup invoice={invoice} mode={mode} saving={saving} save={save} />
      ) : (
        <p className="field-hint">
          {invoice.countyDisplayName
            ? `For work like court observation. It is reviewed and signed off without a case, and its county, ${invoice.countyDisplayName}, counts it.`
            : 'For work like court observation. Add its county: work not for one case counts under it.'}
        </p>
      )}
      {missing && noAnswer && <p className="field-error">Say which case this invoice is for, or that it isn’t for one case.</p>}
      {missing && noCounty && <p className="field-error">Add the county: work not for one case counts under it.</p>}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function caseLabel(found: CaseByNumber) {
  return [found.clientDisplayName ?? 'No client name', found.caseNumber ?? '—', found.countyDisplayName].filter(Boolean).join(' · ');
}

function CaseLookup({
  invoice,
  mode,
  saving,
  save,
}: {
  invoice: QueuedInvoice;
  mode: 'draft' | 'review';
  saving: boolean;
  save: (input: CaseChoiceInput, message?: string) => Promise<void>;
}) {
  const number = (invoice.caseNumberCorrected ?? invoice.caseNumberAsTyped ?? '').trim();
  const { data } = useResource(number && invoice.countyId ? caseMatches(invoice.invoiceId, number, invoice.countyId, mode === 'draft') : null);
  const [picked, setPicked] = useState<string | null>(null);
  const [clientName, setClientName] = useState(invoice.newCaseClientName ?? '');
  const exact = data?.exact ?? null;
  const similar = data?.similar ?? [];
  const elsewhere = exact ? [] : (data?.elsewhere ?? []);
  const nothingFound = Boolean(data) && !exact && similar.length === 0;

  // On a draft an exact match is chosen without asking, and a number nothing matches is a new case.
  const expected: CaseChoiceInput | null =
    mode !== 'draft' || !data
      ? null
      : exact
        ? { choice: 'existing', caseId: exact.caseId }
        : nothingFound
          ? { choice: 'new', clientName: invoice.newCaseClientName ?? undefined }
          : null;
  const stale =
    mode === 'draft' &&
    Boolean(data) &&
    !exact &&
    !nothingFound &&
    invoice.caseChoice === 'existing' &&
    !similar.some((found) => found.caseId === invoice.chosenCaseId);
  const settled =
    expected === null ||
    (expected.choice === 'existing' ? invoice.caseChoice === 'existing' && invoice.chosenCaseId === expected.caseId : invoice.caseChoice === 'new');
  useEffect(() => {
    if (saving) return;
    if (expected && !settled) void save(expected);
    else if (stale) void save({ choice: null });
    // Only when what the number finds, or the kept answer, changes (a new number or county clears it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exact?.caseId, nothingFound, stale, invoice.caseChoice, invoice.chosenCaseId]);

  return (
    <>
      {/* Nothing to match without a number (design K69): it is added in the case number box. */}
      {!number || !invoice.countyId ? (
        <p className="field-hint">
          {invoice.countyId
            ? `Add the case number${mode === 'review' ? ' above' : ''} to find its case, or add one.`
            : `Add ${number ? 'its' : 'the case number and'} county to find its case, or add one.`}
        </p>
      ) : !data ? (
        <p className="field-hint">Looking for case {number}…</p>
      ) : (
        <>
          {elsewhere.length > 0 && (
            <p className="field-hint">
              Case {number} is also in {elsewhere.map((found) => found.countyDisplayName ?? 'another county').join(', ')}. If this invoice’s county is wrong,
              correct it first.
            </p>
          )}
          <Found
            invoice={invoice}
            mode={mode}
            saving={saving}
            save={save}
            number={number}
            exact={exact}
            similar={similar}
            picked={picked}
            setPicked={setPicked}
            clientName={clientName}
            setClientName={setClientName}
          />
        </>
      )}
    </>
  );
}

function Found({
  invoice,
  mode,
  saving,
  save,
  number,
  exact,
  similar,
  picked,
  setPicked,
  clientName,
  setClientName,
}: {
  invoice: QueuedInvoice;
  mode: 'draft' | 'review';
  saving: boolean;
  save: (input: CaseChoiceInput, message?: string) => Promise<void>;
  number: string;
  exact: CaseByNumber | null;
  similar: CaseByNumber[];
  picked: string | null;
  setPicked: (value: string) => void;
  clientName: string;
  setClientName: (value: string) => void;
}) {
  const county = invoice.countyDisplayName ?? 'this county';
  const addNew = (confirmedNew: boolean) =>
    save({ choice: 'new', clientName: clientName.trim() || undefined, confirmedNew }, `Case ${number} added.`);

  if (exact) {
    return mode === 'draft' ? (
      <p className="case-step__found">
        <span className="case-step__tag case-step__tag--found">Case found</span> {caseLabel(exact)}
        {exact.closed ? ' (closed: sending reopens it)' : ''}
      </p>
    ) : (
      <div className="case-step__found">
        <p>
          <span className="case-step__tag case-step__tag--found">Suggested</span> {caseLabel(exact)} <RouterLink to={`/cases/${exact.caseId}`}>Open the case</RouterLink>
        </p>
        <Button kind="primary" disabled={saving} onClick={() => void save({ choice: 'existing', caseId: exact.caseId }, `Matched to case ${exact.caseNumber ?? number}.`)}>
          {exact.closed ? 'Match to this case and reopen it' : 'Match to this case'}
        </Button>
      </div>
    );
  }

  const clientField = (
    <div className="usa-form-group">
      <label className="usa-label" htmlFor={`case-step-client-${invoice.invoiceId}`}>
        Client’s name <span className="field-hint">(optional)</span>
      </label>
      <input
        id={`case-step-client-${invoice.invoiceId}`}
        className="usa-input"
        value={clientName}
        onChange={(event) => setClientName(event.target.value)}
        onBlur={() => mode === 'draft' && invoice.caseChoice === 'new' && clientName !== (invoice.newCaseClientName ?? '') && void addNew(true)}
      />
    </div>
  );

  if (similar.length === 0) {
    return (
      <>
        <p className="case-step__found">
          <span className="case-step__tag case-step__tag--new">New</span> No case {number} in {county} yet.{' '}
          {mode === 'draft' ? 'It’s added when you send.' : ''}
        </p>
        {clientField}
        {mode === 'review' && (
          <Button kind="primary" disabled={saving} onClick={() => void addNew(false)}>
            Add case {number} and match
          </Button>
        )}
        <p className="field-hint">Everything else about the case stays in the case management system.</p>
      </>
    );
  }

  // Close numbers: never chosen for staff.
  const chosen = mode === 'draft' ? (invoice.caseChoice === 'new' ? 'new' : invoice.chosenCaseId) : picked;
  const choose = (value: string) => {
    setPicked(value);
    if (mode === 'draft') void (value === 'new' ? addNew(true) : save({ choice: 'existing', caseId: value }));
  };
  return (
    <>
      <fieldset className="case-step__choices">
        <legend className="case-step__question">Is it one of these cases?</legend>
        {similar.map((found) => (
          <label key={found.caseId} className="radio-row">
            <input type="radio" name={`case-step-${invoice.invoiceId}`} checked={chosen === found.caseId} disabled={saving} onChange={() => choose(found.caseId)} />
            <span>
              <span className="case-step__tag case-step__tag--similar">Similar</span> {caseLabel(found)}
              {found.closed ? ' (closed)' : ''}
            </span>
          </label>
        ))}
        <label className="radio-row">
          <input type="radio" name={`case-step-${invoice.invoiceId}`} checked={chosen === 'new'} disabled={saving} onChange={() => choose('new')} />
          <span>
            <span className="case-step__tag case-step__tag--new">New</span> Add case {number} in {county}
          </span>
        </label>
      </fieldset>
      {chosen === 'new' && clientField}
      {mode === 'review' && (
        <Button
          kind="primary"
          disabled={saving || !picked}
          onClick={() => void (picked === 'new' ? addNew(true) : picked && save({ choice: 'existing', caseId: picked }, 'Matched to its case.'))}
        >
          {picked === 'new' ? `Add case ${number} and match` : 'Match to this case'}
        </Button>
      )}
      {mode === 'review' && (
        <p className="field-hint">
          Matching keeps the invoice’s prices and the number as typed. If no case here is right, choose the new one, and the tool lists {number} as
          its own case.
        </p>
      )}
      {mode === 'draft' && <p className="field-hint">The invoice keeps {number} as typed beside the case.</p>}
    </>
  );
}
