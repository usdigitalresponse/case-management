// The guided tour's missions (docs/frontend.md "Guided tour"). A step is done when the app reaches its state,
// a page or a change the visitor made, never by Next unless it only asks them to look. "Before" lines restate
// research's must-have problems in generic terms only.
import type { TourMission, TourRole, TourRun, TourSuggestions } from '../api/client';

export interface TourContextValues {
  run: TourRun;
  suggestions: TourSuggestions;
  // Ids caught from the visitor's own changes, such as a new invoice's.
  vars: Record<string, string>;
}

export type Target = { selector: string } | { text: string };

export interface Fill {
  label: string;
  selector: string;
  value: (ctx: TourContextValues) => string | undefined;
}

export type Done =
  | { route: (ctx: TourContextValues) => RegExp }
  | {
      request: {
        // '*' for any change.
        method: string;
        path: (ctx: TourContextValues) => RegExp;
        // How many matching changes it takes; one by default.
        times?: number;
        test?: (body: unknown) => boolean;
        capture?: (response: unknown, path: string) => Record<string, string>;
      };
    }
  | { manual: string };

export interface TourStep {
  id: string;
  role: TourRole;
  goal: string;
  // A must-have problem and how the app answers it, or a plain why.
  before?: string;
  now?: string;
  why?: string;
  // Where the step happens, for "Go there".
  path?: (ctx: TourContextValues) => string | undefined;
  target?: Target;
  fills?: Fill[];
  done: Done;
  hint?: string;
  paperCard?: boolean;
  sampleFile?: boolean;
  // Its action is in a dialog, which keeps the rest of the page from being clicked.
  inDialog?: boolean;
}

export interface MissionDefinition {
  id: TourMission;
  title: string;
  summary: string;
  steps: TourStep[];
}

const ID = '[0-9a-f-]{36}';
const exact = (path: string) => new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
const suggestion = (key: string) => (ctx: TourContextValues) => {
  const value = ctx.suggestions[key];
  return value === undefined ? undefined : String(value);
};
// The run's own record where the step knows it, so a change elsewhere doesn't
// count; any id once a skipped step left it unknown.
const own = (value: string | undefined) => value ?? ID;
const enteredId = (ctx: TourContextValues) => own(ctx.vars.invoiceId);
const tourInvoiceId = (ctx: TourContextValues) => own(ctx.run.invoiceId);
const invoicePath = (ctx: TourContextValues) => (ctx.run.invoiceId ? `/billing/${ctx.run.invoiceId}` : '/');
const entryPath = (ctx: TourContextValues) => (ctx.vars.invoiceId ? `/billing/${ctx.vars.invoiceId}` : '/');
const id = (value: unknown, key: string) => {
  const found = (value as Record<string, unknown> | null)?.[key];
  return typeof found === 'string' ? { [key]: found } : {};
};

const staffFiling: MissionDefinition = {
  id: 'staff-filing',
  title: 'Staff files a mailed invoice',
  summary: 'Record a paper invoice that arrived by mail, enter its lines and decide them in one pass.',
  steps: [
    {
      id: 'open-upload',
      role: 'staff',
      goal: 'Open “Upload invoices” in the sidebar.',
      why: 'Staff file invoices that arrive by mail or email from the same page providers use.',
      path: () => '/upload',
      target: { text: 'Upload invoices' },
      done: { route: () => /^\/upload$/ },
    },
    {
      id: 'receipt',
      role: 'staff',
      goal: 'Say how and when it arrived, who billed it and its case number, then choose “Enter an invoice by hand”.',
      before: 'Receipt was recorded only in a hand-kept log, by date, sender and case.',
      now: 'Who billed it, how and when it arrived, and the case number as written are recorded when it is filed, and waiting time counts from that date.',
      path: () => '/upload',
      target: { text: 'Enter an invoice by hand' },
      paperCard: true,
      fills: [
        { label: 'How it arrived', selector: '#upload-received-via', value: suggestion('receivedVia') },
        { label: 'Date received', selector: '#upload-received-on', value: suggestion('receivedOn') },
        { label: 'Billed by', selector: '#upload-from', value: suggestion('billedBy') },
        { label: 'Case number', selector: '#upload-case-number', value: suggestion('caseNumber') },
      ],
      done: {
        request: {
          method: 'POST',
          path: () => /^\/api\/portal\/invoices$/,
          test: (body) => Boolean((body as { enterInReview?: boolean } | null)?.enterInReview),
          capture: (response) => id(response, 'invoiceId'),
        },
      },
      hint: 'All four fields above the drop zone are needed before the invoice can be entered.',
    },
    {
      id: 'enter-lines',
      role: 'staff',
      goal: 'Copy the paper invoice’s lines into the review page. Lines save as you go.',
      before: 'Totals were added up by hand and mistakes caught by eye.',
      now: 'The app adds the lines itself. Compare its total with the paper’s: the paper is off by one hour’s pay.',
      path: entryPath,
      paperCard: true,
      done: {
        request: {
          method: 'PUT',
          path: (ctx) => new RegExp(`^/api/invoices/${enteredId(ctx)}/entered-lines$`),
          test: (body) => ((body as { lines?: unknown[] } | null)?.lines?.length ?? 0) >= 3,
        },
      },
      hint: 'Use “+ Add a line” for each of the three lines on the card; each line saves when you add it.',
    },
    {
      id: 'decide-lines',
      role: 'staff',
      goal: 'Decide each of the three lines: approve them, or approve one in part.',
      why: 'You entered it, so you review it in the same pass, line by line.',
      path: entryPath,
      // Three different lines: deciding one again doesn't count twice.
      done: { request: { method: 'PUT', path: (ctx) => new RegExp(`^/api/invoices/${enteredId(ctx)}/lines/${ID}/decision$`), times: 3 } },
    },
    {
      id: 'which-case',
      role: 'staff',
      goal: 'Add the paper’s county beside its case number, then add its case under “Which case is it for?”.',
      before: 'Each case was typed into one more system before its bills could be paid.',
      now: 'A case is found by its number in its county, or added from them. Work that isn’t for one case says so instead.',
      path: entryPath,
      target: { text: 'Which case is it for?' },
      done: { request: { method: 'PUT', path: (ctx) => new RegExp(`^/api/invoices/${enteredId(ctx)}/case-choice$`) } },
    },
    {
      id: 'finish',
      role: 'staff',
      goal: 'Finish the review.',
      before: 'Paper moved from desk to desk, with no record of who decided what.',
      now: 'Finishing records the round with your name and time. From now on the lines never change, even if the invoice is reopened.',
      path: entryPath,
      target: { text: 'Finish review' },
      done: { request: { method: 'POST', path: (ctx) => new RegExp(`^/api/invoices/${enteredId(ctx)}/finish$`) } },
    },
  ],
};

const preauthSend: MissionDefinition = {
  id: 'preauth-send',
  title: 'Pre-authorize, then send an invoice',
  summary: 'As an investigator, ask for a pre-authorization; as staff, approve a limit; then send an invoice that goes over it.',
  steps: [
    {
      id: 'open-preauth',
      role: 'vendor',
      goal: 'You are an investigator. Open the “Pre-authorizations” tab.',
      path: () => '/portal/preauthorizations',
      target: { text: 'Pre-authorizations' },
      done: { route: () => /^\/portal\/preauthorizations$/ },
    },
    {
      id: 'ask-preauth',
      role: 'vendor',
      goal: 'Ask for a pre-authorization on the tour’s case.',
      before: 'Pre-authorizations went by form and email, with copies saved in several places.',
      now: 'The request, its questions and its decision are kept on the case, where both sides can see them.',
      path: () => '/portal/preauthorizations',
      target: { text: 'Ask for pre-authorization' },
      fills: [
        // In this order: choosing the case or provider clears the fields below.
        { label: 'Case', selector: '#preauth-case', value: (ctx) => ctx.run.caseNumber },
        { label: 'Provider (you)', selector: '#preauth-provider', value: (ctx) => ctx.run.vendorName },
        { label: 'Service', selector: '#preauth-service', value: suggestion('service') },
        { label: 'Hourly rate', selector: '#preauth-rate', value: suggestion('rate') },
        { label: 'Hours', selector: '#preauth-quantity', value: suggestion('hours') },
        { label: 'Why it is needed', selector: '#preauth-justification', value: suggestion('justification') },
      ],
      done: {
        request: {
          method: 'POST',
          path: () => /^\/api\/preauthorizations\/requests$/,
          capture: (response) => id(response, 'preauthorizationRequestId'),
        },
      },
      hint: 'If the form isn’t open, look for the button that starts a new request.',
    },
    {
      id: 'decide-preauth',
      role: 'staff',
      goal: 'As staff, choose Approve and approve the request for less than was asked.',
      why: 'The amount you approve becomes this provider’s limit on the case.',
      path: (ctx) => (ctx.vars.preauthorizationRequestId ? `/preauthorizations/${ctx.vars.preauthorizationRequestId}` : '/preauthorizations'),
      fills: [
        { label: 'Total approved', selector: '#decide-amount', value: suggestion('approvedAmount') },
        { label: 'Note', selector: '#decide-reason', value: suggestion('decisionReason') },
      ],
      done: {
        request: {
          method: 'POST',
          path: (ctx) => new RegExp(`^/api/preauthorizations/requests/${own(ctx.vars.preauthorizationRequestId)}/decision$`),
        },
      },
    },
    {
      id: 'upload',
      role: 'vendor',
      goal: 'Back as the investigator: upload the sample invoice, then choose Continue once it has been read.',
      before: 'Invoices were printed and delivered on paper.',
      now: 'The file is read into lines you can check and send.',
      path: () => '/portal/upload',
      sampleFile: true,
      done: {
        request: {
          method: 'POST',
          path: () => new RegExp(`^/api/portal/uploads/${ID}/draft$`),
          capture: (response) => id(response, 'invoiceId'),
        },
      },
      hint: 'Reading a file takes a few seconds on the demo server.',
    },
    {
      id: 'check',
      role: 'vendor',
      goal: 'Check the lines and give the one without a date its date. The case number was read from your file, so there is no case to choose.',
      before: 'Totals were added up by hand and mistakes caught by eye.',
      now: 'One line was read without its date, and the file’s total doesn’t match its lines: both are pointed out for you to fix before sending.',
      path: (ctx) => (ctx.vars.invoiceId ? `/portal/invoices/${ctx.vars.invoiceId}` : undefined),
      target: { selector: '.file-case-number' },
      done: { request: { method: 'PUT', path: (ctx) => new RegExp(`^/api/portal/invoices/${enteredId(ctx)}$`) } },
    },
    {
      id: 'send',
      role: 'vendor',
      goal: 'Send it. It goes over your limit: say why, tick the statement and send.',
      before: 'Limits were checked by hand, after the fact.',
      now: 'Going over is explained by the sender and flagged for the reviewer, never refused.',
      inDialog: true,
      fills: [{ label: 'Why more wasn’t pre-authorized', selector: '#overrun-explanation', value: suggestion('overrunExplanation') }],
      done: { request: { method: 'POST', path: (ctx) => new RegExp(`^/api/portal/invoices/${enteredId(ctx)}/submit$`) } },
    },
    {
      id: 'status',
      role: 'vendor',
      goal: 'Open “Your invoices” to see where it stands.',
      before: 'Experts and investigators had to call or email to find out where a bill was.',
      now: 'Every sender sees each invoice’s status change as staff act on it.',
      path: () => '/portal/invoices',
      target: { text: 'Your invoices' },
      done: { route: () => /^\/portal\/invoices$/ },
    },
  ],
};

const review: MissionDefinition = {
  id: 'review',
  title: 'Review an invoice, with travel and rates',
  summary: 'Match an investigator’s invoice to its case, see the checks that used to be done by hand, lower a rate and ask a question.',
  steps: [
    {
      id: 'queue',
      role: 'staff',
      goal: 'Open “Assigned to you” and find the tour’s invoice.',
      before: 'Nobody could see where a bill was or how long it had waited.',
      now: 'Every invoice waiting is listed with who has it and how long it has waited.',
      path: () => '/?show=mine',
      target: { text: 'Assigned to you' },
      done: { route: (ctx) => exact(invoicePath(ctx)) },
      hint: 'It is from the tour’s investigator, with its case number typed without dashes. Oldest come first, so it is near the end.',
    },
    {
      id: 'match',
      role: 'staff',
      goal: 'Under “Which case is it for?”, the investigator’s file has the number without dashes: choose the similar case, then “Match to this case”.',
      before: 'A second record for the same case could be made without warning.',
      now: 'A similar number in the same county is offered, so you say it is the existing case rather than add another. The number as typed stays beside it.',
      path: invoicePath,
      target: { text: 'Match to this case' },
      done: { request: { method: 'PUT', path: (ctx) => new RegExp(`^/api/invoices/${tourInvoiceId(ctx)}/case-choice$`) } },
    },
    {
      id: 'mileage',
      role: 'staff',
      goal: 'Look at the trip: its travel time, mileage and parking are separate lines. The miles are flagged.',
      before: 'Mileage was checked by hand against a map.',
      now: 'Miles claimed are compared with the driving distance between From and To.',
      path: invoicePath,
      target: { text: 'See the travel log' },
      done: { manual: 'I see the mileage flag' },
    },
    {
      id: 'day-cap',
      role: 'staff',
      goal: 'Look at the same day’s work: the investigator also billed another case that day.',
      before: 'No one could tell if a person billed more hours in a day than it holds, across cases.',
      now: 'Hours on one date are added across all their invoices and flagged over the daily cap, and travel the same day on another case is shown.',
      path: invoicePath,
      target: { text: 'Billing rule warnings when submitted' },
      done: { manual: 'I see it' },
      hint: 'If no flag shows, the daily hour cap is turned off on this server.',
    },
    {
      id: 'earlier',
      role: 'staff',
      goal: 'Find “Possible double billing”: an earlier invoice on this case covers some of the same weeks, and the same day is billed on another case. Open the lines it lists.',
      before: 'Double billing was caught by searching folders of old invoices.',
      now: 'Invoices on the same case whose dates overlap, and time on other cases on the same days, are flagged with their lines, and a line billed twice is named.',
      path: invoicePath,
      target: { text: 'Possible double billing' },
      done: { manual: 'I see the earlier invoice' },
      hint: 'Each listed invoice opens in a new tab.',
    },
    {
      id: 'rate',
      role: 'staff',
      goal: 'Back on the tour invoice, approve one time line at a lower hourly rate, and choose why.',
      why: 'A changed rate stays flagged for sign-off. Setting it for the case flags the case’s other invoices; it never reprices them.',
      path: invoicePath,
      // One line alone saves as its decision; more lines or the case go through the rate route.
      done: {
        request: {
          method: '*',
          path: (ctx) => new RegExp(`^/api/invoices/${tourInvoiceId(ctx)}/lines/${ID}/(rate|decision)$`),
          test: (body) => {
            const sent = body as { rate?: unknown; approvedRate?: unknown } | null;
            return sent?.rate !== undefined || sent?.approvedRate !== undefined;
          },
        },
      },
      target: { text: 'Approve at a different rate' },
      fills: [{ label: 'Lower rate', selector: '.decision-panel--rate .decision-panel__amount input', value: suggestion('reducedRate') }],
      hint: 'Choose “Rate” on a time line.',
    },
    {
      id: 'question',
      role: 'staff',
      goal: 'Ask the investigator a question about one line.',
      target: { text: 'Ask the submitter about this line' },
      why: 'While a question waits, the invoice can’t be finished, and the question and answer are kept unchanged.',
      path: invoicePath,
      fills: [{ label: 'Question', selector: '[id^="question-"]', value: suggestion('question') }],
      done: { request: { method: 'POST', path: (ctx) => new RegExp(`^/api/invoices/${ctx.run.invoiceId}/questions$`) } },
    },
  ],
};

const answerFinish: MissionDefinition = {
  id: 'answer-finish',
  title: 'Answer and finish',
  summary: 'Answer a reviewer’s question as the investigator, then finish the review as staff.',
  steps: [
    {
      id: 'open-question',
      role: 'vendor',
      goal: 'You are the investigator. Open the top invoice marked “Question for you”.',
      path: (ctx) => (ctx.run.invoiceId ? `/portal/invoices/${ctx.run.invoiceId}` : '/portal/invoices'),
      done: { route: (ctx) => exact(`/portal/invoices/${ctx.run.invoiceId}`) },
    },
    {
      id: 'answer',
      role: 'vendor',
      goal: 'Answer the question.',
      before: 'Questions went by email or sticky note, away from the bill.',
      now: 'The question and answer stay on the line, unchanged, and are never exported.',
      path: (ctx) => `/portal/invoices/${ctx.run.invoiceId}`,
      fills: [{ label: 'Answer', selector: 'textarea', value: suggestion('answer') }],
      done: { request: { method: 'POST', path: (ctx) => new RegExp(`^/api/portal/invoices/${tourInvoiceId(ctx)}/questions/${ID}/answer$`) } },
    },
    {
      id: 'decide',
      role: 'staff',
      goal: 'As the reviewer, decide the line that was asked about.',
      path: invoicePath,
      done: { request: { method: 'PUT', path: (ctx) => new RegExp(`^/api/invoices/${tourInvoiceId(ctx)}/lines/${ID}/decision$`) } },
    },
    {
      id: 'finish',
      role: 'staff',
      goal: 'Finish the review.',
      before: 'Bills were moved between desks, and approval could stall unseen.',
      now: 'The finished round is recorded with your name and goes to sign-off.',
      path: invoicePath,
      target: { text: 'Finish review' },
      done: { request: { method: 'POST', path: (ctx) => new RegExp(`^/api/invoices/${tourInvoiceId(ctx)}/finish$`) } },
    },
  ],
};

const signOff: MissionDefinition = {
  id: 'sign-off',
  title: 'Sign off',
  summary: 'As the Director, see a lowered rate, approve or send back, and see every invoice’s stage.',
  steps: [
    {
      id: 'open',
      role: 'director',
      goal: 'You are the Director. Open the invoice waiting for your sign-off.',
      path: invoicePath,
      done: { route: (ctx) => exact(invoicePath(ctx)) },
    },
    {
      id: 'sign-off',
      role: 'director',
      goal: 'Look at the lowered rate, then approve, or send it back with a comment.',
      before: 'Approval meant a signature on paper, with no visible status.',
      now: 'Approving or sending back is recorded with its status. A send-back comment stays internal and never reaches the sender.',
      path: invoicePath,
      fills: [{ label: 'Comment', selector: 'section:has(#sign-off-heading) textarea, textarea', value: suggestion('approveComment') }],
      done: { request: { method: 'POST', path: (ctx) => new RegExp(`^/api/invoices/${tourInvoiceId(ctx)}/sign-off$`) } },
    },
    {
      id: 'overview',
      role: 'director',
      goal: 'Open “Invoice overview” to see where every invoice is in review.',
      before: 'Status was kept in several separate logs, so no one saw the whole picture.',
      now: 'Every invoice is shown by its step of review in one place, with what changed last.',
      path: () => '/invoice-overview',
      target: { text: 'Invoice overview' },
      done: { route: () => /^\/invoice-overview$/ },
    },
    {
      id: 'export',
      role: 'director',
      goal: 'Open “Exports”: each signed-off invoice is exported from there for payment.',
      why: 'Payment happens in another system; the export carries what was approved.',
      path: () => '/exports',
      target: { text: 'Exports' },
      done: { manual: 'Done' },
    },
  ],
};

export const MISSIONS: Record<TourMission, MissionDefinition> = {
  'staff-filing': staffFiling,
  'preauth-send': preauthSend,
  review,
  'answer-finish': answerFinish,
  'sign-off': signOff,
};

// The full story, in order; staff filing is a different way in.
export const STORY: TourMission[] = ['preauth-send', 'review', 'answer-finish', 'sign-off'];

export const ROLE_NAMES: Record<TourRole, string> = {
  staff: 'Reviewer (staff)',
  director: 'Director (signs off)',
  vendor: 'Investigator (provider)',
};

// Must-haves from research the prototype doesn't address yet, in generic terms.
export const NOT_YET = [
  'Splitting costs by calendar month with budget codes',
  'A notice when the external payment system confirms payment',
  'Weighted caseloads and capacity warnings before assigning',
  'Sending assignment notices',
  'Periodic public reports',
  'Self-reported private caseloads',
  'Time entry here: time stays in the external case management system by design',
];
