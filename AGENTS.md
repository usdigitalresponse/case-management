# Agent Instructions

Guidance for coding agents and other automated tools working in this repository.

## Project purpose

This repository currently begins as a generic, implementation-neutral prototype
specification for public-sector case management and billing. The canonical model
should initially be usable as the basis for multiple implementations, including
Airtable, Dataverse, and a conventional cloud-hosted application. As the project
develops and its technical direction is validated, the prototype may adopt a
specific technology stack and evolve into a stack-specific implementation.

The durable artifact is the shared specification, not any one platform-specific
prototype. Do not let the constraints or conveniences of an implementation
platform silently redefine the domain model.

## Current phase

The repository is at an early design and prototyping stage. The working focus
is invoice review beside an external case management system, built in the
Postgres/AWS prototype (`implementations/postgres-aws/`); see "Current Focus" in
`docs/PRODUCT.md`. The Dataverse track (`implementations/dataverse/`) is a
schema review using standard forms and views; keep the guidance below for any
Dataverse work, and preserve the shared specification for either.

For Dataverse work, use supported Microsoft capabilities and `pac`/Solution tooling for packaging
and deployment. Introduce Custom Pages, PCF, flows, environment variables, and
connection references when the workflow or integration needs them. Do not build
custom CRUD interfaces or speculative portability infrastructure. See
`docs/architecture-assessment.md` for the assessment and incremental plan.

Do not select a production platform, framework, database, or cloud architecture
unless the user explicitly asks for that decision.

## Source of truth

As the repository develops, treat these locations as authoritative:

- `model/` for the platform-neutral schema, rules, forms, workflows, and
  reference-data definitions.
- `scenarios/` for platform-neutral acceptance scenarios.
- `implementations/` for platform-specific mappings, code, and documented gaps.
- `docs/` and `README.md` for human-readable context and decisions.

When a change affects more than one of these artifacts, update all affected
artifacts together. Do not resolve a disagreement by quietly changing only an
implementation.

If an authoritative location does not exist yet, create it only when needed for
the requested work. Do not scaffold speculative files or directories.

## Data and privacy

This is a generic prototype. Do not add organization-specific, confidential, or
personally identifying information to this repository.

In particular, do not add:

- organization, agency, employee, stakeholder, client, attorney, or vendor names;
- real state, county, court, office, or jurisdiction names;
- organization-specific legal citations, policy names, or internal terminology;
- names of incumbent internal systems;
- real account, funding, payment, case, or vendor codes;
- real workload thresholds or other organization-specific configuration values;
- source research, interview notes, or verbatim user-story text that could reveal
  the organization or people involved.

Use generic terminology, synthetic examples, and configurable reference data.
Represent organization-specific requirements as general capabilities or
configurable rules whenever possible.

Do not copy private research or source documents into code, comments, fixtures,
documentation, agent instructions, commit messages, or test data. If private
context is needed to explain a generic requirement, preserve only the resulting
generic requirement in the repository.

## Modeling principles

- Keep the canonical schema independent of Airtable, Dataverse, AWS, or any
  other implementation technology.
- Separate entity structure, business rules, workflows, forms, reference data,
  and acceptance scenarios rather than burying them in prose or platform code.
- Preserve audit history for important state, assignment, and financial changes.
- Use `person` for identity and `case_participant` for case roles. Client and
  professional records are profiles; do not restore flattened client identity.
- The stable `invoice` key denotes a payment request; extend its review chain
  rather than introducing a competing payment-request aggregate.
- Actual payments happen outside this system. `payment` records external
  completion evidence only; do not introduce payment execution or bank transfers.
- Closing a case atomically ends all active assignment roles; reopening does
  not reactivate them. Preserve endings and create new records for reassignment.
- Case/request status and dates, external reference, current client, and
  professional display/office are plain fields for now, not enforced
  projections — do not mark a field `data_role: derived` until a real
  mechanism keeps it in sync with its source history; see "Deferred: fields
  that should become read models" in `model/README.md`. Lifecycle events and
  immutable submission snapshots are required independently of native
  platform auditing.
- Read `docs/model-review.md` for the 0.2 migration, open decisions and current
  implementation gaps; `model/workflows.yaml` is authoritative for transitions.
- A submitter's "new" case, provider or timekeeper is proposed details on the
  request, never a record; staff match or create records on Intake, and the
  details stay flagged through review.
- Invoice line decisions are working decisions until the reviewer finishes a
  round; only finished rounds are recorded and never changed. A sign-off
  send-back comment is internal-only and never reaches submitters or
  exports; a comment on approving or rejecting the whole request is shared
  like line notes.
- A reviewer's question to the submitter is about one line; it and its answer
  are each recorded once and never changed, and never exported. While any
  question is unanswered, the request is `awaiting_answer` and its round
  cannot be finished.
- Prefer validation at data entry over downstream cleanup.
- Do not silently merge probable duplicate records.
- Do not overwrite historical facts when requirements call for an audit trail.
- Make workflow transitions explicit, including actor, timestamp, and required
  information where applicable.
- Derive access from defined roles or active assignments; do not assume broad
  access by default.
- Document every platform-specific compromise, approximation, or unenforceable
  requirement in that implementation's mapping or notes.
- Use shared acceptance scenarios to compare implementations consistently.

## Working practices

Before changing files:

1. Read this file and the relevant existing documentation and specifications.
2. Inspect the working tree and preserve unrelated user changes.
3. Identify which artifact is authoritative for the requested change.
4. Before provisioning a new Dataverse app, solution, or table as a fix, run
   `inspect` (or `pac model list`) and check the target environment in
   `make.powerapps.com` for an existing app or an earlier troubleshooting
   attempt with a similar name. Prefer repairing the existing app over
   creating a parallel one; duplicate apps from separate sessions are hard to
   reconcile later and the user has to notice and remove them manually.

While working:

- Keep changes scoped to the user's request.
- Prefer clear, conventional formats and the smallest useful abstraction.
- Add comments only when they explain necessary context that the code or
  specification cannot express clearly on its own. Keep comments concise,
  current, and free of redundant narration or project bloat.
- Do not introduce dependencies or infrastructure without a concrete need.
- Do not invent domain facts that are absent from the repository or the user's
  instructions. Mark unresolved decisions clearly.
- Update documentation when behavior, structure, commands, or architectural
  decisions change. Stale documentation is a defect.
- Keep model `spec_version` values unchanged until the initial model has been
  pushed; then follow the versioning convention in `model/README.md`.

Before handing work back:

1. Review the diff for accidental sensitive or organization-specific content.
2. Run the relevant formatting, validation, and tests that exist for the files
   changed.
3. Report what changed, what was verified, and any unresolved decisions or gaps.
4. Update this file if the change introduces a durable command, invariant,
   directory boundary, or working convention that future agents must know.

## Git workflow

- Before editing, create a focused feature branch. Do not work directly
  on `main`; reuse the current feature branch when continuing the same change.
- The user opens pull requests and merges manually after reviewing the branch.
- Never push commits or branches to a remote. All pushes are performed manually
  by the user.
- Do not create pull requests or otherwise publish repository changes.
- Do not commit unless the user explicitly asks for a commit.
- Leave completed changes in the working tree for user review.
- Do not discard, overwrite, or rewrite user-authored changes.
- Do not use destructive Git commands unless the user explicitly requests the
  exact operation.
- If asked to suggest a commit message, use a concise Conventional Commits-style
  message such as `docs: add project agent instructions`.

## Commands

The initial Dataverse prototype and its mapping live in
`implementations/dataverse/`; canonical form definitions live in
`model/forms.yaml`, with acceptance scenarios in `scenarios/`.

Synthetic portable examples live in `scenarios/fixtures/`; offline model checks
live in `tests/`. These fixtures do not establish reference values or policy.
For model or fixture changes, run from the repository root (Python and PyYAML;
see `tests/README.md`):

```sh
python3 -B -m unittest discover -s tests -v
```

The suite checks structure and selected examples; do not treat it as proof of
runtime permissions, immutable storage or concurrent financial enforcement.

For changes to the provisioning tool, run from the repository root:

```sh
dotnet build implementations/dataverse/Provision/Provision.csproj
dotnet run --no-build --project implementations/dataverse/Provision -- --check
dotnet run --project implementations/dataverse/SetupTests/SetupTests.csproj
```

For the expanded 0.2 synthetic Dataverse review, read the implementation README
and use `prepare_review.py` plus `--check-review`, `deploy-review`, `seed-review`
and `verify-review`. The 0.1 guided baseline must not overwrite the expanded app.
Review forms and seeded projections do not establish runtime workflow enforcement.
Read `implementations/dataverse/SOLUTION.md` for the export/unpack/pack/import
workflow. `Solution/` preserves privacy-reviewed maker customizations; export
current maker edits before changing it. Existing forms must preserve their
layouts and events; append missing fields rather than deleting/regenerating forms.
App update failures must stop without deleting/recreating the existing app.
Prepared packages, raw Solution exports and environment data stay outside Git.

See the implementation README before any deployment. `deploy` changes the
target environment and adds missing form fields while preserving existing layouts; `upgrade-client` patches
and publishes the existing app's client setting only. App creation and verification
must enforce Unified Interface (`clienttype = 4`). `smoke` creates and
retains synthetic test cases; `inspect` and `verify` are read-only. Keep
environment configuration, authentication caches, logs,
exports, and build output out of Git. Do not mistake form-level requiredness
for server-side validation or native auditing for a complete domain event model.

`setup.command` (Mac/Linux) and `setup.cmd` (Windows) launch the guided setup.
The wizard must inspect and display the target before deployment, default to
read-only verification for existing installations, pass input as process arguments
without shell evaluation, and keep entered configuration out of repository files.
Its offline tests must not authenticate or mutate a live environment.


The separate Postgres/AWS prototype lives in `implementations/postgres-aws/`.
Its staff UI is an invoice review tool designed to sit beside an external
case management system; links to that system stay inert placeholders, and
features hidden for it are hidden from navigation, not deleted. Its landing
page `/`, the sidebar's "+ Upload Invoices" and the external upload, check and
send pages file invoices by the person who sent them with a case number as
typed (design G, see its `docs/frontend.md`); a person's own rates override their
role's from their effective date, and reviewers correct a case number beside
the typed one, never over it. Design I brings cases back: the sidebar has Case
overview and All cases, and People, Providers, Clients and Organizations; a request
filed by person may be matched to a case while it is reviewed, keeping its
sent prices; a matched request's review page is led by its case card. The
earlier case-led queue and Intake (with the case-based upload) are
off the sidebar but still work by address. The portal's tabs are Your invoices, Your
cases, Pre-authorizations and Upload invoices; Your cases lists only cases staff matched or
assigned a sender to, and senders don't log time here (it stays in the
external system). Every case and
person picker is `client/src/components/PickOrAdd.tsx` (first option adds
one), except a submitter choosing among the people they bill for. Every
county picker is `client/src/components/CountyPicker.tsx`: settings such as
post-conviction (`county.is_county` false) first, and a typed county is
matched by name before one is added (`server/src/cases/counties.ts`). In the
case-based flow, never block the next step on an unchosen case or provider.
Filed by person, the upload page first asks who billed it ("Billed by", the
attorney or provider whose work it is, never just whoever sent it) and, of
staff, how and when it arrived, above both the drop zone and "Enter an
invoice by hand"; someone new described there is added only when the page
goes on. Its case number, county, period and invoice number are read from
the file and edited above its lines
(`client/src/components/InvoiceDetailsFields.tsx`).
The sender is required to send or finish, since the invoice is filed under
them, and a line whose worker isn't matched falls back to the invoice's most
common match, else the sender, so every sent invoice goes to review. A trip
is one "Travel" row in the editor but separate lines (travel time, mileage,
costs) linked by `trip`, each priced and decided on its own; never merge them
into one travel line, and never group lines into a trip for the submitter.
A reviewer's changed rate must stay flagged for sign-off. Case rates are set
only from a line's rate decision while reviewing, are added and never
changed, and change only the invoice they were set on (others on the case
are flagged, never repriced); every line's default comes from
`src/billing/defaultRates.ts`. A reviewing staff
member's upload goes straight into their own review (`enter_request_in_review`,
`src/billing/enterInReview.ts`): they enter and decide its lines on the review
page until the first finished round freezes them. There, and on the check
page, lines are edited in place with no save button; the page's next action
(deciding, sending, saving for later, finishing, leaving for another page)
saves them first, so nothing acts on unsaved values. After that freeze, lines never change,
even after reopening or a send-back. Line saves keep each line's id, so a
decision or question stays on its line; never go back to deleting and
reinserting lines. Entry saves, and decisions while entry is open, carry
`lines_version`; a stale one is refused, never merged or overwritten. New
lines get their id from the page, which saves keep. A reviewer's case time log
(`src/billing/reviewTimeLog.ts`) is a working aid: keep its cells, never the
file, delete it when the round is finished or the request leaves review, and
never show it to submitters or put it in exports. Its flags are always shown;
only the review setting decides whether approving a flagged line's billed hours
needs the reviewer's reason (`time_log_override`, staff-only, never exported),
and a name in the log is never matched to a person without an exact match or
the reviewer's confirmation. Staff and
external submitters share the new-invoice form (staff use it on Intake) and
the import pages; links that differ
between the two apps go through `client/src/portal/useShell.ts`. Design
screenshots go in its gitignored `figma/` folder and must never be committed.
Docker Compose startup must preserve application data. `docker compose exec
server npm run seed` is an explicit destructive demo reset, never a startup
step. `docker-compose.prod.yml` (with an untracked `.env.prod`) is the
single-host production-mode stack; its seed command is equally destructive.
Settings' Demo section (anyone switching their own role; administrators'
"Reset demo data", the same reset) must stay unavailable unless the staff
demo sign-in is enabled. The guided tour (`client/src/tour/`,
`server/src/demoTour/`) needs both demo sign-ins, is only ever started by
the visitor beside the usual demo dropdowns, and makes its own synthetic
material per run: it never resets data, changes shared settings or makes
billed route lookups. Its steps complete from what the visitor does in the
real app, and its "Before" lines restate research problems generically.
The app is a React Router data router built per kind of signed-in user
(`client/src/App.tsx`, the portal's routes in `portal/ExternalPortalApp.tsx`);
pages give their route a loader over named resources (`src/routeLoaders.ts`,
`src/resources.ts`), so they don't blank to "Loading…" while switching; add one
for a new page that loads data, and load its code with `src/lazyPage.tsx`;
keep a list's filters in the address (`useSearchParamState`). Styles are global BEM-style CSS in `client/src/styles/`, one file per
area, imported in order by `index.css`; put a rule in its area's file. Design
values come only from `tokens.css` (Figma's role names), design-system components
live in `client/src/components/ui/` (use `Button`, `Tag`, `Notice`, `Dialog`, the
`card` class), USWDS's stylesheet is not loaded, and no inline styles: pass run-time
values with `cssVars`. `npm run lint` enforces both (stylelint and ESLint). See its `docs/design-system.md` for changing the design system. All data loads through `useResource`
(TanStack Query); resources a page edits are `fresh`: loaded for each visit,
never refreshed under the user, and cleared and reloaded by a save's `resetKey`.
Page tests render one page against `client/src/test/fakeApi.ts`, which fails
on any request it has no route for; build data with `src/test/fixtures.ts`.
`e2e/` is the Playwright suite: it adds synthetic invoices, so run it only
against a disposable seeded stack (CI does), never someone's demo data.
Run server/client `npm run typecheck` and `npm run lint`, client `npm run build` and `npm test`, and
server `npm test` against a separate migrated test database (see its README). Its
`npm run test:perf` (`server/perf/`) times the cross-checks against a large
synthetic volume in that same test database; it is not part of `npm test`.
CI runs `npm run test:perf:queries`, failing if a check makes more queries
than the committed `server/perf/queryCounts.json`; when a change lowers a
count or adds a check, save it with `PERF_SAVE_QUERY_COUNTS=1 npm run
test:perf:queries` (the only scale it saves at) and commit it. The server
build entry point is `dist/src/app.js`. Its `MAPPING.md` holds the schema
mapping and known gaps; how each part is built is in its `docs/`
(`frontend.md`, `intake.md`, `api.md`). A new or changed route's access rule
gets a case in `server/__tests__/routesAccess.test.ts`, which calls the
running app through `__tests__/httpHelpers.ts`. Uploaded invoice files are working
copies in a private local directory (`DOCUMENT_STORE_DIR`, a named
`documents` volume in both Compose files), kept with a live
request or draft (shown to its submitter and reviewers) and deleted on
discard, three-day expiry of a file that couldn't be read, or when the request
is withdrawn or deleted (`src/imports/documentRetention.ts`); drafts never
expire. Never commit or back them up.
External submitters sign in with an emailed 6-digit code and must tick the
true-and-correct statement to send (recorded as `invoice_attestation`).
Real invoice files for local extraction testing go in the gitignored
`implementations/postgres-aws/local-samples/`, with hand-written expected
figures in its `expected.json`; score them with `npm run extraction-accuracy
-- --samples ../local-samples`. Never copy them, their values or details
from them into Git, fixtures or docs; describe findings generically.
PDF imports are read in a background queue in the server process (one
instance only), entirely in-process on the demo server's 1 GB; any model or
service added to reading needs its hosting cost agreed first.
Possible duplicate people (`src/people/possibleDuplicates.ts`) are listed
for staff only; any staff member flags a pair or records they are different
people, and only an administrator merges, after a preview of exactly what
moves (`src/people/personMerges.ts`). A merge never deletes the retired
person or replaces a detail on the kept one, records every value it changes
so it can be undone, and a merged-away person is left out of every list,
search, email check and sign-in match. Duplicates show in groups, and one
merge may take several records, all or none. Possible duplicate cases
(`src/cases/possibleDuplicateCases.ts`) are review only: cases belong to the
external system and are never merged here; staff close the extra one.
Cases in different counties are never listed or flagged as duplicates.
Possible double billing (`src/billing/billingOverlaps.ts`) only warns, never
refuses; a submitter sees only invoices they may read, and only on a draft.
Pre-authorization limits are per provider per case: the ceiling of their one
pre-authorization (asking for more revises it; never add ceilings), else the
case county's configured threshold for kinds it applies to. Going over is
explained by the sender and flagged, never refused. Providers' CVs and fee
schedules are kept records, unlike invoice working copies.
Driving-distance lookups for the mileage rule (`ROUTE_CHECK_PROVIDER=aws`)
are billed per request: keep them to submission with the rule on and cached
by address pair, and have tests use `setRouteProviderForTests`, never AWS.
