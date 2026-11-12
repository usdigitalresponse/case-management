// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { advance, currentStep, missionDone, newTour, nextPart, onLocation, onRequest, storyDone, type TourState } from './tourState';
import { MISSIONS, STORY } from './missions';
import { fillField, findTarget } from './dom';

const invoiceId = '11111111-1111-4111-8111-111111111111';
const lineId = '22222222-2222-4222-8222-222222222222';
const start = (mission: keyof typeof MISSIONS) => ({ run: { runId: 'r', mission, vendorName: 'Investigator', invoiceId }, suggestions: {} });

describe('guided tour steps', () => {
  it('moves on when the visitor reaches the step’s page, not on any other', () => {
    const tour = newTour(['staff-filing'], start('staff-filing'), 'staff');
    expect(onLocation(tour, '/finished').step).toBe(0);
    expect(currentStep(onLocation(tour, '/upload'))?.id).toBe('receipt');
  });

  it('needs the change it asks for, with what it was sent, and keeps the new invoice’s id', () => {
    const tour = { ...newTour(['staff-filing'], start('staff-filing'), 'staff'), step: 1 };
    const created = { method: 'POST', path: '/api/portal/invoices', response: { invoiceId } };
    expect(onRequest(tour, { ...created, body: { enterInReview: false } }).step).toBe(1);
    const next = onRequest(tour, { ...created, body: { enterInReview: true } });
    expect(next.step).toBe(2);
    expect(next.vars.invoiceId).toBe(invoiceId);
    expect(currentStep(next)?.path?.({ run: next.run, suggestions: {}, vars: next.vars })).toBe(`/billing/${invoiceId}`);
  });

  it('needs as many different lines as the step asks, on the visitor’s own invoice', () => {
    let tour: TourState = { ...newTour(['staff-filing'], start('staff-filing'), 'staff'), step: 3, vars: { invoiceId } };
    const decide = (invoice: string, line: string) => ({ method: 'PUT', path: `/api/invoices/${invoice}/lines/${line}/decision`, body: {}, response: {} });
    const lines = ['22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'];
    // The same line again, or a line on another invoice, doesn't count.
    tour = onRequest(onRequest(onRequest(tour, decide(invoiceId, lineId)), decide(invoiceId, lineId)), decide('33333333-3333-4333-8333-333333333333', lines[1]!));
    expect(tour.step).toBe(3);
    tour = onRequest(tour, decide(invoiceId, lines[1]!));
    expect(tour.step).toBe(3);
    expect(onRequest(tour, decide(invoiceId, lines[2]!)).step).toBe(4);
  });

  it('ignores a change to another invoice where the step names its own', () => {
    const tour = { ...newTour(['review'], start('review'), 'staff'), step: 6 };
    const other = '33333333-3333-4333-8333-333333333333';
    expect(onRequest(tour, { method: 'POST', path: `/api/invoices/${other}/questions`, body: {}, response: {} }).step).toBe(6);
    expect(onRequest(tour, { method: 'POST', path: `/api/invoices/${invoiceId}/questions`, body: {}, response: {} }).step).toBe(7);
  });

  it('goes through the story part by part, each on its own material', () => {
    let tour = newTour(STORY, start(STORY[0]!), 'vendor');
    for (let index = 0; index < MISSIONS[STORY[0]!].steps.length; index += 1) tour = advance(tour);
    expect(missionDone(tour)).toBe(true);
    expect(storyDone(tour)).toBe(false);
    tour = nextPart(tour, start(STORY[1]!), 'staff');
    expect(tour.part).toBe(1);
    expect(tour.step).toBe(0);
    expect(tour.vars).toEqual({});
    expect(tour.completed.length).toBe(MISSIONS[STORY[0]!].steps.length);
  });
});

describe('filling in a suggestion', () => {
  it('chooses a select’s option by a word in its label, through its change event', () => {
    document.body.innerHTML = '<select id="pick"><option value="">Choose</option><option value="p1">Demo Investigator (Investigator)</option></select>';
    const select = document.querySelector('select')!;
    // jsdom lays nothing out; treat it as shown.
    Object.defineProperty(select, 'getClientRects', { value: () => [{}] });
    let changed = '';
    select.addEventListener('change', () => {
      changed = select.value;
    });
    expect(fillField('#pick', 'Demo Investigator')).toBe(true);
    expect(changed).toBe('p1');
    expect(fillField('#pick', 'Nobody')).toBe(false);
  });
});

describe('showing a step’s control', () => {
  it('finds a notice by its heading, and a button over a link that only starts with its name', () => {
    document.body.innerHTML =
      '<nav><a href="/finished">Finished</a></nav><div class="notice"><strong class="notice__heading">Possible double billing</strong></div><button>Finish review</button>';
    for (const element of document.body.querySelectorAll('*')) Object.defineProperty(element, 'getClientRects', { value: () => [{}] });
    expect(findTarget({ text: 'Possible double billing' })?.className).toBe('notice__heading');
    expect(findTarget({ text: 'Finish review' })?.tagName).toBe('BUTTON');
  });
});
