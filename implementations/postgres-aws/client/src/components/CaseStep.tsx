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

  return (
    <fieldset className={`card case-step${missing && !invoice.caseChoice ? ' is-missing' : ''}`}>
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
          For work like court observation. It is reviewed and signed off without a case, and its county
          {invoice.countyDisplayName ? `, ${invoice.countyDisplayName},` : ''} counts it.
        </p>
      )}
      {missing && !invoice.caseChoice && <p className="field-error">Say which case this invoice is for, or that it isn’t for one case.</p>}
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
  const ownNumber = invoice.caseNumberCorrected ?? invoice.caseNumberAsTyped ?? '';
  // In review, a number for an invoice that gives none.
  const [typed, setTyped] = useState('');
  const number = (ownNumber || typed).trim();
  const { data } = useResource(number && invoice.countyId ? caseMatches(invoice.invoiceId, number, invoice.countyId, mode === 'draft') : null);
  const [picked, setPicked] = useState<string | null>(null);
  const [clientName, setClientName] = useState(invoice.newCaseClientName ?? '');
  const exact = data?.exact ?? null;
  const similar = data?.similar ?? [];
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
    // Only when what the number finds changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exact?.caseId, nothingFound, stale]);

  return (
    <>
      {mode === 'review' && !ownNumber && (
        <div className="usa-form-group">
          <label className="usa-label" htmlFor={`case-step-number-${invoice.invoiceId}`}>
            Case number
          </label>
          <input id={`case-step-number-${invoice.invoiceId}`} className="usa-input" value={typed} onChange={(event) => setTyped(event.target.value)} />
        </div>
      )}
      {!number || !invoice.countyId ? (
        <p className="field-hint">
          {invoice.countyId
            ? 'Type its case number to find its case, or add one.'
            : `Add ${number ? 'its' : 'the case number and'} county to find its case, or add one.`}
        </p>
      ) : !data ? (
        <p className="field-hint">Looking for case {number}…</p>
      ) : (
        <Found
          invoice={invoice}
          mode={mode}
          saving={saving}
          save={save}
          number={number}
          typedNumber={ownNumber ? undefined : number}
          exact={exact}
          similar={similar}
          picked={picked}
          setPicked={setPicked}
          clientName={clientName}
          setClientName={setClientName}
        />
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
  typedNumber,
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
  typedNumber: string | undefined;
  exact: CaseByNumber | null;
  similar: CaseByNumber[];
  picked: string | null;
  setPicked: (value: string) => void;
  clientName: string;
  setClientName: (value: string) => void;
}) {
  const county = invoice.countyDisplayName ?? 'this county';
  const addNew = (confirmedNew: boolean) =>
    save({ choice: 'new', clientName: clientName.trim() || undefined, confirmedNew, caseNumber: typedNumber }, `Case ${number} added.`);

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
          {exact.closed ? 'Use this case and reopen it' : 'Use this case'}
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
          {picked === 'new' ? `Add case ${number} and match` : 'Match'}
        </Button>
      )}
      {mode === 'draft' && <p className="field-hint">The invoice keeps {number} as typed beside the case.</p>}
    </>
  );
}
