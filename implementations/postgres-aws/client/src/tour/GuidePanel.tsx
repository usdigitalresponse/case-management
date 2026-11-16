// The guide beside the page: never over it, so the visitor does each step
// in the real app. Rendered in both shells, under the router.
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { TOUR_SAMPLE_INVOICE_URL, type TourMission } from '../api/client';
import { formatMoney } from '../formatMoney';
import { Button } from '../components/ui/Button';
import { useTour } from './TourContext';
import { MISSIONS, NOT_YET, ROLE_NAMES, type TourContextValues, type TourStep } from './missions';
import { contextOf, currentStep, missionDone, missionOf, storyDone, type TourState } from './tourState';
import { chooseFile, fillField, findTarget, showTarget } from './dom';

const HINT_AFTER_MS = 45_000;

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Copying is a convenience; the value is on screen to type.
  }
}

function CopyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="guide-card__row">
      <dt>{label}</dt>
      <dd>
        {value}
        <button type="button" className="link-button" aria-label={`Copy ${label}`} onClick={() => void copy(value)}>
          Copy
        </button>
      </dd>
    </div>
  );
}

// The synthetic paper invoice a staff member enters by hand.
function PaperCard({ ctx }: { ctx: TourContextValues }) {
  const s = ctx.suggestions;
  const lines = (s.lines as Array<{ date: string; description: string; hours: number; amount: number }> | undefined) ?? [];
  return (
    <section className="guide-card" aria-label="Paper invoice">
      <h3>Paper invoice, received by mail</h3>
      <dl>
        <CopyValue label="Billed by" value={String(s.billedBy)} />
        <CopyValue label="Received" value={String(s.receivedOn)} />
        <CopyValue label="Invoice number" value={String(s.invoiceNumber)} />
        <CopyValue label="Case number" value={String(s.caseNumber)} />
        {s.county ? <CopyValue label="County" value={String(s.county)} /> : null}
      </dl>
      <table className="guide-card__lines">
        <thead>
          <tr><th>Date</th><th>Work</th><th>Hours</th></tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.date}>
              <td>{line.date}</td>
              <td>{line.description}</td>
              <td>{line.hours} × {formatMoney(Number(s.rate))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="guide-card__total">Total written on the paper: {formatMoney(Number(s.statedTotal))}</p>
    </section>
  );
}

function SampleFile() {
  const [message, setMessage] = useState<string | null>(null);
  async function use() {
    setMessage(null);
    try {
      const response = await fetch(TOUR_SAMPLE_INVOICE_URL, { credentials: 'include' });
      if (!response.ok) throw new Error();
      const file = new File([await response.blob()], 'Sample_invoice.pdf', { type: 'application/pdf' });
      setMessage(chooseFile(file) ? 'Added. It is read on the page; choose Continue when it says Read.' : 'Open the upload page first, then try again.');
    } catch {
      setMessage('The sample invoice could not be loaded. Try again.');
    }
  }
  return (
    <div className="guide__sample">
      <Button kind="secondary" onClick={() => void use()}>Use the sample invoice</Button>
      <a href={TOUR_SAMPLE_INVOICE_URL} download>Download it to drag in yourself</a>
      {message && <p className="guide__note">{message}</p>}
    </div>
  );
}

function Fills({ step, ctx, root }: { step: TourStep; ctx: TourContextValues; root?: ParentNode }) {
  const [missed, setMissed] = useState<string | null>(null);
  const fills = (step.fills ?? []).filter((fill) => fill.value(ctx) !== undefined);
  if (fills.length === 0) return null;
  return (
    <div className="guide__fills">
      <p className="guide__note">Fill in a suggestion, or type your own:</p>
      <div className="guide__fill-buttons">
        {fills.map((fill) => (
          <button
            key={fill.label}
            type="button"
            className="btn btn--outline btn--small"
            onClick={() => setMissed(fillField(fill.selector, fill.value(ctx)!, root) ? null : fill.label)}
          >
            {fill.label}
          </button>
        ))}
      </div>
      {missed && <p className="guide__note">“{missed}” isn’t on this page yet.</p>}
    </div>
  );
}

function StepBody({ step, ctx, onPage }: { step: TourStep; ctx: TourContextValues; onPage: boolean }) {
  const navigate = useNavigate();
  const [notFound, setNotFound] = useState(false);
  const path = step.path?.(ctx);
  return (
    <>
      <p className="guide__goal">{step.goal}</p>
      {step.before && step.now ? (
        <dl className="guide__before-now">
          <dt>Before</dt>
          <dd>{step.before}</dd>
          <dt>Now</dt>
          <dd>{step.now}</dd>
        </dl>
      ) : (
        step.why && <p className="guide__why">{step.why}</p>
      )}
      <div className="guide__actions">
        {path && !onPage && (
          <Button kind="primary" onClick={() => navigate(path)}>Go there</Button>
        )}
        {step.target && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              const element = findTarget(step.target!);
              setNotFound(!element);
              if (element) showTarget(element);
            }}
          >
            Show me
          </button>
        )}
      </div>
      {notFound && <p className="guide__note">It isn’t on this page. {path ? 'Use “Go there” first.' : ''}</p>}
      {step.sampleFile && <SampleFile />}
      <Fills step={step} ctx={ctx} />
      {step.inDialog && <p className="guide__note">This happens in a dialog; the guide also shows there.</p>}
      {step.paperCard && <PaperCard ctx={ctx} />}
    </>
  );
}

// One part of the tour: what the chosen part covers, above its dropdown.
export function MissionPicker({
  id,
  label,
  hideLabel = false,
  onStart,
  busy,
}: {
  id: string;
  label: string;
  hideLabel?: boolean;
  onStart: (missions: TourMission[]) => void;
  busy: boolean;
}) {
  const [mission, setMission] = useState<TourMission>('staff-filing');
  return (
    <div className="mission-picker">
      <label className={hideLabel ? 'usa-sr-only' : 'mission-picker__label'} htmlFor={id}>{label}</label>
      {/* All summaries take up room, so the tallest sets the height. */}
      <div className="mission-picker__summaries" aria-live="polite">
        {(Object.keys(MISSIONS) as TourMission[]).map((option) => (
          <p key={option} className="mission-picker__summary" hidden={option !== mission}>{MISSIONS[option].summary}</p>
        ))}
      </div>
      <div className="mission-picker__row">
        <select id={id} className="usa-select" value={mission} onChange={(event) => setMission(event.target.value as TourMission)}>
          {(Object.keys(MISSIONS) as TourMission[]).map((option) => (
            <option key={option} value={option}>{MISSIONS[option].title}</option>
          ))}
        </select>
        <Button kind="secondary" disabled={busy} onClick={() => onStart([mission])}>Start this part</Button>
      </div>
    </div>
  );
}

function Finished({ state }: { state: TourState }) {
  const tour = useTour()!;
  const seen = state.completed
    .map((key) => {
      const [mission, stepId] = key.split(':') as [TourMission, string];
      return MISSIONS[mission]?.steps.find((step) => step.id === stepId);
    })
    .filter((step): step is TourStep => Boolean(step?.now));
  return (
    <div className="guide__finished">
      <p className="guide__goal">Done. Here is what you saw replace work done by hand:</p>
      <ul className="guide__seen">
        {[...new Set(seen.map((step) => step.now!))].map((now) => (
          <li key={now}>{now}</li>
        ))}
      </ul>
      <details className="guide__not-yet">
        <summary>Not in this prototype yet</summary>
        <ul>
          {NOT_YET.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </details>
      <MissionPicker id="guide-mission" label="Try another part" busy={tour.busy} onStart={(missions) => void tour.start(missions)} />
      <div className="guide__actions">
        <Button kind="secondary" onClick={() => tour.end()}>Close the tour and explore</Button>
      </div>
    </div>
  );
}

function Checklist({ state }: { state: TourState }) {
  const steps = missionOf(state).steps;
  return (
    <details className="guide__checklist">
      <summary>All steps</summary>
      <ol>
        {steps.map((step, index) => (
          <li key={step.id} className={index < state.step ? 'is-done' : index === state.step ? 'is-current' : undefined}>
            {step.goal}
          </li>
        ))}
      </ol>
    </details>
  );
}

function usePause(key: string) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    setPaused(false);
    const timer = window.setTimeout(() => setPaused(true), HINT_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [key]);
  return paused;
}

function Panel({ state }: { state: TourState }) {
  const tour = useTour()!;
  const location = useLocation();
  const mission = missionOf(state);
  const step = currentStep(state);
  const ctx = contextOf(state);
  const paused = usePause(`${state.part}:${state.step}`);
  const part = state.missions.length > 1 ? `Part ${state.part + 1} of ${state.missions.length} · ` : '';
  const position = step ? `Step ${state.step + 1} of ${mission.steps.length}` : 'Done';
  const handOff = step && step.role !== state.role;
  const path = step?.path?.(ctx);
  const onPage = Boolean(path && `${location.pathname}${location.search}` === path) || location.pathname === path;

  if (state.collapsed) {
    return (
      <button type="button" className="guide-pill" onClick={() => tour.setCollapsed(false)}>
        Guide · {part}{position}
      </button>
    );
  }

  return (
    <aside className="guide" aria-label="Guided tour">
      <header className="guide__header">
        <div>
          <p className="guide__eyebrow">{part}{mission.title}</p>
          <p className="guide__role">You are: {ROLE_NAMES[state.role]}</p>
        </div>
        <button type="button" className="link-button" onClick={() => tour.setCollapsed(true)} aria-label="Collapse the guide">
          Hide
        </button>
      </header>
      <p className="guide__position">{position}</p>
      {tour.error && <p className="field-error" role="alert">{tour.error}</p>}
      {step && handOff && (
        <div className="guide__handoff">
          <p className="guide__goal">Next, switch to the {ROLE_NAMES[step.role]}.</p>
          <p className="guide__why">{step.goal}</p>
          <Button kind="primary" disabled={tour.busy} onClick={() => void tour.switchRole(step.role)}>
            Continue as {ROLE_NAMES[step.role]}
          </Button>
        </div>
      )}
      {step && !handOff && (
        <>
          {/* Keyed, so a step's "not on this page" notes don't carry over. */}
          <StepBody key={`${state.part}:${state.step}`} step={step} ctx={ctx} onPage={onPage} />
          {'manual' in step.done && (
            <Button kind="primary" onClick={() => tour.completeManually()}>{step.done.manual}</Button>
          )}
          {paused && <p className="guide__hint">{step.hint ?? 'Stuck? Use “Show me”, or skip this step.'}</p>}
        </>
      )}
      {!step && missionDone(state) && !storyDone(state) && (
        <div className="guide__handoff">
          <p className="guide__goal">That part is done.</p>
          <p className="guide__why">Next: {MISSIONS[state.missions[state.part + 1]!].title}. It starts from a prepared invoice like the one you just worked on.</p>
          <Button kind="primary" disabled={tour.busy} onClick={() => void tour.continueStory()}>Continue</Button>
        </div>
      )}
      {!step && storyDone(state) && <Finished state={state} />}
      {step && <Checklist state={state} />}
      <footer className="guide__footer">
        {step && (
          <button type="button" className="link-button" onClick={() => tour.skip()}>Skip step</button>
        )}
        <button type="button" className="link-button" disabled={tour.busy} onClick={() => void tour.restartMission()}>Restart</button>
        <button type="button" className="link-button" onClick={() => tour.leave()}>Leave the tour</button>
      </footer>
    </aside>
  );
}

// Follows the page the visitor is on, and goes where a role switch was headed.
export function TourChrome({ app }: { app: 'staff' | 'portal' }) {
  const tour = useTour();
  const location = useLocation();
  const navigate = useNavigate();
  const state = tour?.state;
  const pathname = location.pathname;

  useEffect(() => {
    tour?.reportLocation(pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, state?.part, state?.step]);

  // Only the next role's app goes there, and again if its own first redirect lands after ours.
  const pending = tour?.pendingPath;
  const pendingPath = pending && (pending.role === 'vendor') === (app === 'portal') ? pending.path : null;
  const tries = useRef(0);
  const here = `${location.pathname}${location.search}`;
  useEffect(() => {
    if (!pendingPath) return;
    if (here === pendingPath || tries.current >= 3) {
      tries.current = 0;
      tour?.clearPendingPath();
      return;
    }
    tries.current += 1;
    navigate(pendingPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPath, here]);

  if (!tour || !state) return null;
  if (state.hidden) {
    return (
      <button type="button" className="guide-pill guide-pill--resume" onClick={() => tour.resume()}>
        Resume tour
      </button>
    );
  }
  return <Panel state={state} />;
}

// In a dialog the page behind can't be clicked, so the step's fill-ins show here.
export function TourDialogHint() {
  const tour = useTour();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const step = tour?.state && !tour.state.hidden ? currentStep(tour.state) : undefined;
  if (!tour?.state || !step?.inDialog || step.role !== tour.state.role) return null;
  return (
    <div className="guide-in-dialog" ref={setRoot}>
      <p className="guide__eyebrow">Guided tour</p>
      <p className="guide__goal">{step.goal}</p>
      <Fills key={`${tour.state.part}:${tour.state.step}`} step={step} ctx={contextOf(tour.state)} root={root?.closest('dialog') ?? undefined} />
    </div>
  );
}
