# Intake handler design notes

How case intake is handled on the server. See also [`api.md`](api.md) and
[`../MAPPING.md`](../MAPPING.md).

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
- **Settings layout** (design I, I36–I39; `client/src/pages/Settings.tsx`,
  `components/ReviewSettings.tsx`, `components/SegmentedChoice.tsx`): an "On
  this page" index of Invoice review (routing beside the reason lists, whose
  list is a segmented Approving part / Rejecting / Both / Case rate choice),
  People who use this tool (what each role can do, then staff), Rates (a card
  per kind, mileage, travel and waiting time) and Billing rules and codes (one
  row per rule with an Off / Warn / Require choice); Demo comes last. Design
  I37's three staff roles are replaced by Staff and Administrator, as decided.
- **Case pages** (design I, I47–I49; `client/src/pages/Overview.tsx`,
  `CaseList.tsx`, `CaseDetail.tsx`; `server/src/cases/caseSummaries.ts`):
  `GET /api/cases` adds each case's number, the people working on it, its
  pre-authorized amounts added up and the invoices waiting (`loadCaseListExtras`).
  Case overview has a card per stage with its count and a "Recently changed"
  table (`GET /api/cases/recent-changes`: the latest invoice events on cases,
  as words, and case openings and closings, with who). All cases has All /
  Open / Closed chips, the county filter and a search, with design I's
  columns. A case's page has its facts, a "Pre-authorized and billed" card
  per pre-authorization (approved, waiting, what would be left, and a bar)
  beside the people on it, then its invoices and case rates.
- **Look-up pages** (design I, I51–I53): Providers (`/vendors`) lists each
  provider with their kind (changed inline by administrators), today's rate,
  their office and who can send their invoices: themselves once they can sign
  in, and their office's billing delegates (`GET /api/professionals` with
  `src/professionals/providerOffices.ts`). Clients lists every case's client
  with its case, county, opened date and status (from `GET /api/cases`).
  Organizations adds how many cases each has. Gap: organizations can't be
  edited here, so I53's Edit isn't built.
- **Demo tools** (Settings, "Demo"): only while the staff demo sign-in is on
  (`src/auth/demoSettings.ts`; otherwise the routes are 404s, and `/auth/me`
  reports `demoMode`). Every staff member then sees Settings, and
  `GET`/`PUT /api/settings/demo/role` lets them switch their own role, an
  administrator included, which the regular role setting forbids; the change
  is audited like any role change. `POST /api/settings/demo/reset` ("Reset
  demo data", administrators) runs the seed's reset (`src/db/demoData.ts`),
  removes stored import files no longer referenced, refuses a second
  concurrent reset, and ends the caller's session, since accounts are
  recreated. Other users' requests during the reset may fail.
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
