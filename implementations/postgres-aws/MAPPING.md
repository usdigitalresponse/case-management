# Schema mapping and platform-specific notes

Tracks how `../../model/schema.yaml` maps to this implementation's Postgres
tables, and where this implementation approximates or narrows the canonical
model. Update this file whenever a mapping decision or gap changes.

## Stack

TypeScript throughout (server and client). The server uses Express,
Drizzle ORM (`src/db/schema.ts` is the single source of truth for table
definitions; `drizzle-kit generate` derives SQL migrations from it into
`migrations/`), and `pg` as the driver. Vitest is the test runner. Node 20+
is required (`.node-version`, `package.json#engines`).

Knex was considered first (it's what `usdr-gost`/`arpa-reporter` use), but
once the server committed to TypeScript, Drizzle's TS-native schema (types
and migrations both derive from one definition, rather than hand-written
migrations plus separately hand-written types) was judged the better fit for
current TypeScript-ecosystem practice, despite being a less-proven library
and a deviation from those sibling apps' tooling.

The client is Vite + React, using `@trussworks/react-uswds` (the accessible
React component library implementing USWDS) and `@uswds/uswds` for the
compiled CSS/fonts — the user chose the U.S. Web Design System over the
originally-planned Tailwind default, appropriate for a government-facing
app. Vite's CSS asset pipeline resolves and hashes USWDS's font/image
`url()` references automatically; no static-asset-copy plugin was needed.

## Frontend design notes

- **Overview home**: `/` shows four stage columns (Awaiting assignment,
  Represented, Billing, Closing); `/cases` retains the full list, now
  with its own Stage column. Every column buckets real cases by their
  actual derived stage (`server/src/cases/caseStage.ts` —
  awaiting-assignment / represented / billing / closing /
  none-if-closed, computed from assignment/invoice state, not stored) —
  there is no more "everything shows under Awaiting assignment"
  placeholder, and the preview badge that disclosed it is gone. Starting
  a case isn't a stage with cases in it (a case already has its client
  participant from the moment it's created — see
  `src/intake/createCase.ts`), so it isn't a board column at all; it's
  the sidebar's "New case" link and the header's "+ New case" button,
  both going to `/cases/new`. Cards use existing case data, with three
  previews and a link onward: Billing's "View all" goes to its real
  queue (`/billing`, `client/src/pages/BillingQueue.tsx`); Awaiting
  assignment, Represented, and Closing all go to `/cases?stage=<id>` —
  `client/src/pages/CaseList.tsx` reads that query param and filters to
  just that stage (with a "Show all cases" link back out), since none of
  the three has a dedicated page of its own. Their sidebar links use the
  same `?stage=` routes, as plain `Link`s rather than `NavLink`s — every
  one of them (plus "Cases") shares the `/cases` pathname, and `NavLink`
  only compares pathname by default, so all four would otherwise light up
  together regardless of which `?stage=` is actually active. The sidebar
  condenses on small screens and columns wrap into a vertical layout. The
  header's `Messages`/`Timer` placeholders and "Search everything" box
  were removed outright (disabled controls with no planned near-term
  feature).
- **Lookup directories**: the sidebar's People (`/people`), Clients
  (`/clients`), Vendors (`/vendors`), and Organizations (`/organizations`)
  all share one component, `client/src/components/SearchDirectory.tsx`
  (search box + results table), each wired to a different fetch:
  - People/Clients/Vendors hit a server search endpoint
    (`GET /api/people`, `/api/clients`, `/api/professionals` — all
    `requireFullUser`). People and Clients require a query first (the
    person table could be large); Vendors loads everything up front
    (a small table).
  - `GET /api/clients` (`src/routes/clients.ts`) is new: people who hold
    the "Client" `case_participant`-context role on at least one case,
    distinct, optionally filtered by name/email. The role name is a
    server-selected synthetic lookup (`'Client'`), the same
    simplification as `OPENING_EVENT_TYPE_CODE` — `case_participant`
    roles are organization-configurable, only seeded by `src/db/fixtures.ts`
    (test/dev), not `src/db/ensureReferenceData.ts`.
  - `GET /api/professionals` (`src/routes/professionals.ts`) used to
    return `[]` without a query and was otherwise unused by the client;
    it now also backs the Vendors directory, listing everyone when no
    query is given. It excludes professionals created for internal staff
    (`src/cases/assignStaffToCase.ts` lazily creates one on first staff
    assignment) via the same staff-account system role
    `src/routes/staff.ts` filters on — otherwise a staff member assigned
    to a case would show up as a "vendor."
  - Organizations has no new endpoint: `GET /api/reference-data` already
    returns the full organization list (small, unpaginated), so
    `OrganizationsDirectory.tsx` just filters that client-side, the same
    way `CaseList.tsx` filters its own full case list.
  - Reports has no backend at all and stays disabled.
- **Reference-data endpoint**: `GET /api/reference-data` returns every
  lookup list the intake form needs (statuses, categories, roles,
  jurisdictions, languages, identifier types, counties, organizations,
  offices) in one response, rather than one endpoint per table — none of
  this data is large or paginated, and the form needs all of it together.
- **Display names joined server-side**: `GET /api/cases` and
  `GET /api/cases/:id` left-join `person` to include `clientDisplayName`/
  `personDisplayName` alongside the raw `person_id` — added specifically so
  the client shows a readable name instead of a UUID (the Faker-generated
  synthetic names are otherwise invisible in the UI).
- **Type-ahead pickers**: the person picker (`NewCaseIntake`) and the
  staff picker (`AssignStaffForm`) share
  `client/src/components/TypeAheadPicker.tsx`, built on Downshift's
  `useCombobox` (keyboard handling and ARIA wiring) with its own minimal
  styling. It searches the server (`GET /api/people?q=` /
  `GET /api/staff?q=`) once typing pauses for 300ms, shows "Searching…"
  meanwhile, and ignores out-of-order responses. The field's text is the
  selection: editing it after picking an option deselects, and the ✕
  button (shown whenever there's text) clears both. USWDS's `ComboBox`
  was tried first and dropped: it only filters a pre-loaded list
  instantly, can't wait for a pause in typing, only shows its clear button
  after a selection, and when fed server results it shows matches for the
  previous keystroke. The sidebar's directory pages (People/Clients/Vendors)
  keep their own search-then-list-as-table UI, since they show every
  match at once rather than picking one.
- **10 demo cases** are seeded by `src/db/seed.ts` (not the test-shared
  `src/db/fixtures.ts`) via the real `createCase` handler, each with a
  distinct Faker-generated client and a rotating LSC case category, so the
  UI has something realistic to show without any test depending on that
  data existing. 6 of the 10 also get an external-submitter
  `case_assignment` to one of 3 Faker-generated demo vendor
  professionals (bootstrapped through the same `ensureUserAccountForEmail`/
  `ensureProfessionalForUserAccount` path a real magic-link login takes,
  not a seed-only shortcut), with 1-3 `time_entry` rows logged against
  each and an invoice submitted for all but the last two (one left as a
  `draft`-status invoice, one left with no invoice at all) — so both the
  external portal and the staff case page's Invoices section have
  realistic, status-varied data on a fresh seed instead of an empty state.

## Intake handler design notes

- **Request validation**: `src/intake/validation.ts` defines a Zod schema for
  `createCase`'s input (uuid format, required fields, identifier
  completeness, explicit ISO timestamp or internal Date). Malformed input (e.g. a non-UUID `personId`) is rejected
  there, before any query runs — the DB layer never sees a value that could
  otherwise surface as a raw driver error instead of a field-level
  `ValidationError`.
- **Error responses**: domain actions throw subclasses of `AppError`
  (`src/errors.ts`: `ValidationError` 400, `ForbiddenError` 403,
  `NotFoundError` 404, `ConflictError` 409, `ConfigurationError` 500), and
  the error middleware in `src/app.ts` turns them into JSON responses, so
  routes have no per-action catch blocks. Reference rows are looked up with
  `getReferenceId`/`getSeededRoleId` (`src/db/referenceLookups.ts`), which
  throw `ConfigurationError` when a provisioned row is missing.
- **Retry handling**: the form retains its request ID for retries of an unchanged
  payload. The handler recovers the original result after either request-ID or
  identifier uniqueness conflicts from concurrent replays.
- **Office compatibility**: when both organization and office are supplied, the
  office must belong to that organization.
- **Demo seeding**: `npm run seed` explicitly resets all application data; normal
  Docker Compose startup only migrates and starts the server, preserving records.
- **Reference/active checks run via the pool, not inside the transaction**:
  `createCase` validates that every referenced id exists and (where the
  table has an `active` flag) is active, via `Promise.all` over the
  connection pool, *before* opening the write transaction. A single Postgres
  connection can't usefully run queries concurrently — issuing them that way
  against an open transaction's connection produced a `pg` deprecation
  warning in practice, not a real speedup. Running the checks over separate
  pool connections first gives genuine concurrency and keeps the
  transaction open for as little time as possible. These checks are a
  friendly-error convenience, not the integrity boundary — the FK
  constraints in `src/db/schema.ts` enforce referential integrity
  regardless.
- **Constraint-name constants**: unique-violation → friendly-error
  translation (idempotent replay, duplicate identifier) matches on
  Postgres constraint names. Those names are exported as constants from
  `src/db/schema.ts` (`CASE_IDENTIFIER_ISSUER_TYPE_VALUE_UNIQUE_CONSTRAINT`,
  `INTAKE_REQUEST_PRIMARY_KEY_CONSTRAINT`) and imported into
  `src/intake/createCase.ts`, rather than duplicated as separate string
  literals, so renaming a constraint in one place can't silently desync the
  other.
- **Reporting time zone**: `opened_on` (and any other calendar-date field
  derived from an instant) is computed via a named `REPORTING_TIME_ZONE`
  constant (`src/intake/createCase.ts`), currently `'UTC'`. Time zone is
  explicitly called out as an unresolved, per-organization configuration
  choice in `docs/case-intake-comparison-plan.md`; this constant is a
  synthetic single-environment default, not a resolved product decision —
  changing it to a real IANA zone is a one-line change, not a logic rewrite.

## API / auth design notes

- **Session**: `cookie-session` (signed cookie, no server-side session
  store — the small `AuthenticatedUser` object lives entirely in the
  cookie). Passport is used only for the OIDC handshake (`session:
  false`); the callback route writes the session itself
  (`src/auth/session.ts`), rather than using `passport.session()` /
  serialize-deserialize, avoiding known compatibility rough edges between
  newer Passport versions and non-`express-session` stores.
- **Multi-IdP SSO**: one generic OIDC strategy (`passport-openidconnect`),
  registered once per configured provider, rather than a
  provider-specific library per IdP (`src/auth/oidcProviders.ts`). Google
  and Microsoft Entra ID both authenticate through the same code path;
  each provider declares its own `allowedDomains` (checked against the
  authenticated email, not the OAuth `hd`/`tid` claim, which isn't always
  present) so a domain can't sign in through the wrong IdP — see "Known
  gaps" below for what this gate is (and isn't). `GET /auth/providers`
  returns `{ providers, devLoginEnabled }` — `providers` so the client
  doesn't hardcode one, `devLoginEnabled` so the login page only offers
  the dev-login bypass where the server actually allows it (never in
  production — see the `NODE_ENV` guard in `src/routes/auth.ts`);
  `GET /auth/:providerId` / `:providerId/callback` are generated per
  provider. `AuthenticatedUser.authType` is `'sso'` for any configured
  provider (which one is in `ssoProvider`, display/audit only) or
  `'magic-link'` for an external user. **Deploy note**: the session cookie
  carries this shape directly (`cookie-session`, no server-side store —
  see "Session" above), so a cookie issued before this change (`authType:
  'google'`, or the dev-login/magic-link literals before they were
  renamed to `'sso'`) won't satisfy `requireFullUser`'s `authType ===
  'sso'` check until the holder logs in again. Self-heals within
  `maxAge` (24h, `src/app.ts`) with no code needed — not yet a concern
  since no real environment has live sessions (see "Known gaps" below),
  but worth remembering before any future session-shape change ships to
  a deployment with real users.
- **Magic-link sign-in for external users**: `POST /auth/magic-link/request`
  (body: `{ email }`) issues a single-use, 15-minute token
  (`src/auth/magicLink.ts`) if `email` is in `EXTERNAL_EMAIL_WHITELIST`
  (`src/auth/externalEmailWhitelist.ts`) — it responds identically either
  way, so the endpoint can't be used to enumerate whitelisted addresses.
  The emailed link opens the client's `/sign-in/verify?token=` confirm
  page (`client/src/pages/MagicLinkConfirm.tsx`), and only its explicit
  `POST /auth/magic-link/verify` (body: `{ token }`) — never a GET, which
  email link scanners would trigger — consumes the token, creates/reuses
  the `user_account`, bootstraps a `professional` profile for it
  (`src/professionals/ensureProfessional.ts`), and sets the session.
  `requireFullUser` (`src/auth/session.ts`) checks `authType === 'sso'`
  to gate actions only a full user may take.
  **Email delivery**: `src/email/sendEmail.ts` sends via AWS SES when
  `SES_SENDER_EMAIL` is set, falling back to logging the link to the
  console when it isn't (so local dev needs no AWS setup). Verifying a
  sender identity in SES is a manual AWS console/DNS step this code can't
  do for you — same category of manual prerequisite as filling in real
  Google OAuth credentials (see "Known gaps" below).
- **Case assignment, two workflows**: `professional` and `case_assignment`
  map the canonical entities, with two assignment endpoints built on a
  shared insert (`src/cases/assignProfessionalToCase.ts`, which rejects
  closed cases and recovers from a double-click/retry hitting
  `case_assignment_open_unique` rather than creating a second open
  assignment):
  - `POST /api/cases/:id/external-assignments` (`requireFullUser`,
    `src/cases/assignExternalSubmitterToCase.ts`) assigns an existing
    professional (found via `GET /api/professionals?q=<email>`, which only
    finds professionals with a `user_account_id` — i.e. someone who has
    logged in via magic link at least once) to a case, with a fixed
    "External Submitter" role (`src/professionals/externalSubmitterRole.ts`).
    A staff member's professional profile is rejected; staff go through
    the staff endpoint below.
  - `POST /api/cases/:id/staff-assignments` (`requireFullUser`,
    `src/cases/assignStaffToCase.ts`) assigns a staff (SSO) user, found
    via `GET /api/staff?q=<email>` (`src/routes/staff.ts`), with a fixed
    "Assigned Staff" role (`src/cases/staffAssignmentRole.ts`). Staff has
    no professional profile until their first assignment (unlike a
    vendor's, bootstrapped at magic-link login), so one is lazily created
    here. "Staff" means a user_account whose `system_role_id` is the
    "Intake Staff" role (`src/auth/staffAccountRole.ts`), set by the SSO
    verify callback (`src/auth/oidcProviders.ts`) on any account that has
    no role yet — including one first created by magic link — and never
    replaced once set. Magic-link login never sets it, which is how the
    two populations stay distinguishable in the same `user_account`
    table. Emails are lowercased (`normalizeEmail` in
    `src/auth/emailLists.ts`) before being stored or matched.

  Both roles above are provisioned the same way in every environment by
  `src/db/ensureReferenceData.ts`, run at `migrate` time (see "Reference
  data" below). `GET /api/my-cases` lists the current session's open
  assignments; `GET /api/cases/:id` includes an `assignments` array (both
  kinds, joined with professional/role display names) and a computed
  `stage` (`src/cases/caseStage.ts` — awaiting-assignment / represented /
  billing / closing / none-if-closed, derived from assignment/invoice
  state rather than stored). Deliberately not implemented:
  `require_qualification_for_assignment` and
  `review_workload_before_assignment` (both `model/rules.yaml`
  `outcome: configurable`) and the "at most one overlapping primary
  assignment per case" rule — every assignment of a given kind uses the
  one fixed role for that kind, with no further role choice. Also not
  implemented: `person`'s `flag_possible_duplicate_client` check, since a
  `professional` here is always auto-created from a unique `user_account`,
  not user-entered.
- **Invoice review** is line by line (`src/billing/reviewInvoiceLine.ts`,
  `src/routes/invoices.ts`, `client/src/pages/InvoiceReview.tsx`):
  - `GET /api/invoices?status=` is the cross-case queue; `GET
    /api/invoices/:id` returns lines with source time entries and decisions;
    `POST /api/invoices/:id/lines/:lineId/review` decides one line.
  - Approval records `approved_amount` (default: requested; lower allowed,
    higher not). Rejection requires a `reason` (`model/rules.yaml`
    `enforce_invoice_approval_sequence`).
  - One immutable decision per line (unique index); the invoice row is
    locked per decision, so concurrent reviewers share one chain.
  - The invoice stays `submitted` until every line is decided, then becomes
    `approved` (case moves to `closing`) or `rejected` (any line rejected).
    `submitted_total` is unchanged; the approved total is the sum of line
    amounts, not stored.
  - Not implemented: pre-approval, further stages, "requests changes",
    chain superseding, `under_review` status, allocation draws, submission
    snapshot. Pre-existing whole-invoice decisions (null `invoice_line_id`)
    aren't shown in the line view.
- **Closing a case**: `POST /api/cases/:id/close` (`requireFullUser`,
  `src/cases/closeCase.ts`) is the counterpart to opening
  (`src/intake/createCase.ts`): it requires a reason, records the next
  lifecycle event, projects `case.status_id`/`closed_on`, and ends every
  open `case_assignment` at the closure's effective timestamp (always
  the server's current time — closes can't be backdated) —
  atomically, per `model/rules.yaml`'s `preserve_case_lifecycle`. The
  closing event type and resulting status are server-selected synthetic
  codes (`sample_closed`, mirroring `createCase.ts`'s
  `OPENING_EVENT_TYPE_CODE`) — `case_lifecycle_event_types`/`case_statuses`
  are organization-configurable reference data in the canonical model,
  so (like the opening code) this only exists in `src/db/fixtures.ts`
  (test/dev), not `src/db/ensureReferenceData.ts`; a real deployment
  needs its own configured codes before this (or case creation) will
  work. The rule's "new assignments must begin while the case is open"
  guard lives in `src/cases/assignProfessionalToCase.ts`, which
  share-locks the case row while `closeCase` update-locks it, so a
  concurrent assignment and close can't leave an open assignment on a
  closed case (rejected with 409 `already_closed`). Deliberately not
  implemented: reopening/corrections (a closed case stays closed).
- **Dev-login bypass**: `POST /auth/dev-login` logs in as the seeded
  synthetic staff account (`staff@example.invalid`) without any real SSO
  provider credentials configured. `src/app.ts` only mounts it when
  `NODE_ENV !== 'production'`, and `createAuthRouter` itself also throws if
  ever asked to enable it under `NODE_ENV=production` — enforced by the
  auth module, not just by the one current caller's discipline, so a future
  second call site can't silently reopen the bypass.
- **Routes**: `src/routes/cases.ts` (`POST /`, `GET /`, `GET /:id`) and
  `src/routes/people.ts` (`GET /?q=`, existing-person search only — no
  duplicate-person warning here, since no person is ever created by this
  endpoint). All require a session (`requireAuth`). Async handlers are
  wrapped in `src/routes/asyncHandler.ts` since Express 4 doesn't forward a
  rejected promise to error middleware on its own.
- **Indexes**: FK columns used as query filters/joins
  (`case.county_id`/`status_id`/`case_category_id`,
  `case_participant.case_id`, `case_identifier.case_id`) have plain B-tree
  indexes in `src/db/schema.ts` — Postgres doesn't create these
  automatically, and the existing unique indexes on those tables are
  partial (`WHERE ended_at IS NULL`, `WHERE is_primary`) so they don't
  serve a plain lookup. `GET /api/people`'s `ilike` search on
  `person.display_name`/`email` has no supporting index (a `pg_trgm` GIN
  index would be needed, since leading-wildcard `ilike` can't use a plain
  B-tree) — deferred since the person table is a handful of seeded rows in
  this scope; revisit if that search becomes real-data-sized.

### Client (React) design notes

- **`AppContent`** (`src/App.tsx`) is the single loading/signed-out/
  portal/staff gate, so individual pages don't check auth themselves.
- **`useApiResource`** (`src/hooks/useApiResource.ts`) is the shared
  fetch/loading/error mechanics behind every mount-effect data load (case
  list, case detail, intake's reference data) — error *message* wording
  stays per-page (e.g. mapping a 404 to "Case not found."), since that's
  genuinely page-specific.
- **`ReferenceSelect`** and **`RecordTable`** (`src/components/`) are the
  shared "label + select + reference-data options" and "empty vs.
  bordered table" shapes used by `NewCaseIntake`/`CaseDetail`.
- **Client/server type duplication**: `client/src/api/client.ts`'s
  `CaseRecord`/`CaseParticipant`/etc. mirror shapes from
  `server/src/db/schema.ts` by hand, with no shared types package across
  the client/server boundary. Accepted as the ordinary cost of a
  boundary between two separately-deployed apps, not a reuse bug —
  revisit only if a shared-types package becomes a concrete need.

## Reference data

`src/db/ensureReferenceData.ts` idempotently seeds the reference/config
rows the app needs to function at all (`activity_types`,
`invoice_statuses`, `invoice_line_types`, `invoice_approval_step_types`,
`invoice_approval_outcomes`, and the "Intake Staff", "External Submitter"
and "Assigned Staff" roles) via `insert ... on conflict do nothing`,
keyed by each table's unique `code` column (or, for `role`, a unique
index on `(display_name, role_context)`). `src/db/migrate.ts` runs it
right after applying migrations, so it executes in every environment,
including production. `resetAndSeedBaselineFixtures` (destructive,
test/dev-only) calls it too after truncating, so there is a single
definition of these rows; the fixtures add only test/dev-only reference
rows on top. Code that needs one of these rows looks it up and throws a
configuration error if it is somehow missing.

## Schema-mapping drift check

`npm run verify-schema-mapping` (`scripts/verify-schema-mapping.ts`) is a
heuristic, text-level check that every in-scope entity's canonical fields
from `model/schema.yaml` still appear as columns in `src/db/schema.ts`. It
exists because hand-transcribing the canonical model into a second schema
representation invites silent drift; it does not check types or catch
anything beyond a field disappearing entirely. Run it after any change to
either `model/schema.yaml` or `src/db/schema.ts`.

## Infrastructure (Terraform)

`terraform/` is a single-environment (`sandbox.tfvars`) skeleton: VPC (2
public + 2 private subnets across 2 AZs, one NAT gateway), RDS Postgres
(single instance), ECS Fargate running the server behind an ALB, an ECR
repo for the server image, S3 + CloudFront for the built client, and
Secrets Manager for DB credentials / `SESSION_SECRET` / Google OAuth
credentials. `terraform validate` and `terraform plan` (43 resources,
0 errors) were verified locally against fake credentials
(`skip_credentials_validation`, etc., in a local-only override file,
never committed) — no real AWS environment has been applied.

Known gaps, all deliberate for a skeleton rather than oversights:

- **No CI/CD image pipeline**: nothing builds/pushes the server image to
  ECR or syncs the client build to S3. The ECS service and CloudFront
  distribution exist but won't serve a working app until someone does
  this manually at least once.
- **No production Dockerfile**: the server currently only has a dev
  setup (`node:20-alpine` + bind mount + `tsx watch`, see
  `docker-compose.yml`); a real multi-stage build (`tsc` → `dist/` →
  slim runtime image) doesn't exist yet and is needed before the ECR
  push above is possible.
- **Google OAuth credentials start empty**: `terraform/secrets.tf`
  creates the secret with blank `google_client_id`/`google_client_secret`
  (Terraform can't know them) and `ignore_changes` so a manual fill-in
  survives future applies. Combined with `NODE_ENV=production` disabling
  `/auth/dev-login`, a freshly-applied environment has **no way to log
  in** until someone sets real Google OAuth values.
- **HTTP only**: no ACM certificate/custom domain, so both the ALB and
  CloudFront use their default AWS domains over HTTP (CloudFront defaults
  to HTTPS at the edge, but the ALB origin is HTTP-only). Not
  production-appropriate.
- **Single NAT gateway, RDS not Multi-AZ, no autoscaling, no remote
  Terraform state** (local state only, matching `versions.tf`'s note): all
  reasonable for a low-cost sandbox, all gaps for anything more than that.
- **Cross-origin auth in production**: the client and server would sit on
  different domains (CloudFront vs. the ALB) with the current design,
  unlike the same-origin Vite proxy used in dev — `cookie-session`'s
  cookie and CORS aren't configured for that yet. Resolve before actually
  deploying the client to point at the ALB.
- **IAM/security-group/ECS resources are hardcoded for one service**
  (`iam.tf`, `ecs.tf`, `alb.tf`): a code review noted these aren't
  parameterized by service (e.g. a reusable `module "ecs_service"`), so
  adding a second ECS service later means copying and renaming these
  blocks rather than reusing a shared shape. Deliberately not generalized
  now — there is exactly one service, and building that abstraction ahead
  of a second real service would be speculative; revisit when one exists.

## Entities in scope

Only the entities needed for `model/forms.yaml:new_case` and read-only case
list/detail views are implemented as tables:

`user_account`, `county`, `organization`, `office`, `role`, `person`,
`person_affiliation`, `case`, `case_participant`, `case_lifecycle_event`,
`case_identifier`, `professional`, `case_assignment`, `time_entry`,
`invoice`, `invoice_line`, `invoice_approval_chain`,
`invoice_approval_decision`, plus lookup tables for the `reference_data`
sets these entities use (`case_categories`, `case_statuses`,
`jurisdictions`, `languages`, `case_identifier_types`,
`case_lifecycle_event_types`, `case_lifecycle_reasons`, `activity_types`,
`invoice_statuses`, `invoice_line_types`, `invoice_approval_step_types`,
`invoice_approval_outcomes`).

`professional`/`case_assignment` cover both the external magic-link
submitter workflow and internal staff assignment (see "Case assignment,
two workflows" above) — not general scheduling/workload support.

`invoice_approval_chain`/`invoice_approval_decision` implement a narrow
slice of the canonical multi-stage, configurable approval routing: see
the comment on these tables in `src/db/schema.ts` for exactly what's
simplified (one chain, a single line-review stage with one decision per
line, no pre-approval, no further stages).

`person_affiliation` (and `case_participant.affiliation_id`) were added ahead
of an immediate need: adding them after case data exists would mean
revisiting the `case_participant` uniqueness constraint under live data, so
it was cheaper to include now while the schema is still empty.

Every other entity in `schema.yaml` (expense, documents, audit_event,
service_provider, payment, etc.) is out of scope for this slice and has no
table here.

### Deliberately omitted fields on in-scope entities

Tracked in `scripts/verify-schema-mapping.ts`'s `DELIBERATELY_OMITTED_FIELDS`
so the drift check doesn't flag them; update both places together if this
changes.

- `organization.organization_type_id`: reference_data classification not
  needed for intake/read scope.

### Known limitation: affiliation-uniqueness and NULLs

`case_participant`'s open-relationship uniqueness index covers
`(case_id, person_id, participant_role_id, affiliation_id)`, but Postgres
unique indexes treat `NULL` as distinct from every other value — so two open
rows for the same case/person/role that both omit `affiliation_id` are not
caught as duplicates by this index. Acceptable for now since affiliation is
optional and rarely absent-but-duplicated in practice; revisit if a future
form relies on this being airtight.

### Synthetic seed data provenance

- **Person names** (`src/db/fixtures.ts`): generated with `@faker-js/faker`
  (`faker.person.firstName()`/`lastName()`), seeded with a fixed value
  (`faker.seed(20260115)`) so output stays deterministic across runs rather
  than changing every time. Not derived from, or resembling, any real
  dataset — chosen specifically so demo/test data looks realistic without
  any provenance link to real records (e.g. a LegalServer export). Prior
  to this, person rows used placeholder names like "Synthetic Person
  Client"; those remain a fine pattern elsewhere in the repo (see
  `scenarios/fixtures/`) but this implementation's seed data now
  prioritizes visual realism for demo purposes.
- **Case categories** (`src/db/fixtures.ts`: `LSC_CASE_CATEGORIES`): named
  after LSC's (Legal Services Corporation) Case Service Report major
  problem categories and the general shape of NCSC case-type standards —
  published, sector-wide taxonomies, not any organization's confidential
  configuration. Using the real category names (Housing, Family, etc.)
  here is intentional and safe, unlike person names or case identifiers,
  which must stay synthetic.

### Implementation-specific additions

- `user_account.email`: not in `model/schema.yaml`. Used to match SSO
  logins (see Auth below); real accounts are created on first login,
  matched by email, not seeded with real addresses.

## Known gaps / placeholders

- **Auth**: Google OAuth restricted to a hosted-domain allowlist
  (`usdigitalresponse.org`, `usdrvolunteers.org`) gates access for USDR's
  own team while building/demoing the prototype; Microsoft Entra ID is
  also supported (`src/auth/oidcProviders.ts`) for a government partner
  whose staff sign in with Microsoft instead. Whether either is actually
  that partner's *production* login, versus their own separate IdP
  decision, remains open — matching the Dataverse comparison plan's
  "intake roles and permitted actions" gap.
- **Person creation**: `person` rows are seeded synthetic fixtures only; there
  is no create-person or duplicate-review UI in this slice.
- **Infrastructure**: Terraform provisions a single (`sandbox`) environment
  with a single-instance (non-Multi-AZ) RDS Postgres instance. No
  staging/production promotion path, autoscaling policy, or WAF is configured
  yet.
- **Reference data**: lookup tables are seeded with synthetic values for
  development only; they do not represent real organizational configuration
  (per `../../AGENTS.md`'s data and privacy guidance).
