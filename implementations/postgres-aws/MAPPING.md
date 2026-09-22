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

- **No collapsible mobile nav**: `client/src/App.tsx`'s header deliberately
  doesn't use USWDS's `NavMenuButton`/responsive-collapse pattern. An
  earlier version wired `NavMenuButton` without actually managing its
  toggle state, which silently hid the sign-in controls behind a
  non-functional hamburger button below the desktop breakpoint (worked in
  a wide Chrome window, not in a narrower Safari window — found via live
  browser testing, not a code review). There are no nav links yet to
  justify the responsive collapse; revisit if real navigation is added.
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
- **Person search is a plain search-then-select list**, not USWDS's
  `ComboBox` (which filters a static client-side option list) — the person
  list comes from an async server search, which doesn't fit ComboBox's
  model without extra work not justified at this scale (a handful of
  seeded people).
- **10 demo cases** are seeded by `src/db/seed.ts` (not the test-shared
  `src/db/fixtures.ts`) via the real `createCase` handler, each with a
  distinct Faker-generated client and a rotating LSC case category, so the
  UI has something realistic to show without any test depending on that
  data existing.

## Intake handler design notes

- **Request validation**: `src/intake/validation.ts` defines a Zod schema for
  `createCase`'s input (uuid format, required fields, identifier
  completeness). Malformed input (e.g. a non-UUID `personId`) is rejected
  there, before any query runs — the DB layer never sees a value that could
  otherwise surface as a raw driver error instead of a field-level
  `CreateCaseValidationError`.
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
  cookie). Passport is used only for the Google OAuth handshake
  (`session: false`); the callback route writes the session itself
  (`src/auth/session.ts`), rather than using `passport.session()` /
  serialize-deserialize, avoiding known compatibility rough edges between
  newer Passport versions and non-`express-session` stores.
- **Google OAuth allowlist**: enforced by checking the authenticated
  email's domain against `ALLOWED_EMAIL_DOMAINS` in
  `src/auth/googleStrategy.ts` (not the OAuth `hd` claim, which isn't
  always present depending on Workspace configuration) — see "Known gaps"
  below for what this gate is (and isn't).
- **Dev-login bypass**: `POST /auth/dev-login` logs in as the seeded
  synthetic staff account (`staff@example.invalid`) without any real Google
  credentials, so local dev/tests don't need `GOOGLE_CLIENT_ID`/
  `GOOGLE_CLIENT_SECRET` configured. `src/app.ts` only mounts it when
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

- **`RequireAuth`** (`src/AuthContext.tsx`) wraps each protected route in
  `App.tsx`'s `<Routes>`, centralizing the loading/not-signed-in gate that
  `CaseList`/`CaseDetail`/`NewCaseIntake` each used to repeat individually.
- **`useApiResource`** (`src/hooks/useApiResource.ts`) is the shared
  fetch/loading/error mechanics behind every mount-effect data load (case
  list, case detail, intake's reference data) — error *message* wording
  stays per-page (e.g. mapping a 404 to "Case not found."), since that's
  genuinely page-specific.
- **`ReferenceSelect`** and **`RecordTable`** (`src/components/`) collapse
  the repeated "label + select + reference-data options" and "empty vs.
  bordered table" shapes that `NewCaseIntake`/`CaseDetail` previously
  hand-rolled per field/section.
- **Client/server type duplication**: `client/src/api/client.ts`'s
  `CaseRecord`/`CaseParticipant`/etc. mirror shapes from
  `server/src/db/schema.ts` by hand, with no shared types package across
  the client/server boundary. Accepted as the ordinary cost of a
  boundary between two separately-deployed apps, not a reuse bug —
  revisit only if a shared-types package becomes a concrete need.

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
`case_identifier`, plus lookup tables for the `reference_data` sets these
entities use (`case_categories`, `case_statuses`, `jurisdictions`,
`languages`, `case_identifier_types`, `case_lifecycle_event_types`,
`case_lifecycle_reasons`).

`person_affiliation` (and `case_participant.affiliation_id`) were added ahead
of an immediate need: adding them after case data exists would mean
revisiting the `case_participant` uniqueness constraint under live data, so
it was cheaper to include now while the schema is still empty.

Every other entity in `schema.yaml` (assignments, billing/invoicing, time and
expense, documents, audit_event, etc.) is out of scope for this slice and has
no table here.

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

- `user_account.email`: not in `model/schema.yaml`. Used to match Google
  OAuth logins (see Auth below); real accounts are created on first login,
  matched by email, not seeded with real addresses.

## Known gaps / placeholders

- **Auth**: Google OAuth restricted to a hosted-domain allowlist
  (`usdigitalresponse.org`, `usdrvolunteers.org`) gates access for USDR's own
  team while building/demoing the prototype. This is **not** the government
  partner's production login — their actual case-management users need their
  own auth (their own IdP/domain), which is an unresolved decision, matching
  the Dataverse comparison plan's "intake roles and permitted actions" gap.
- **Person creation**: `person` rows are seeded synthetic fixtures only; there
  is no create-person or duplicate-review UI in this slice.
- **Infrastructure**: Terraform provisions a single (`sandbox`) environment
  with a single-instance (non-Multi-AZ) RDS Postgres instance. No
  staging/production promotion path, autoscaling policy, or WAF is configured
  yet.
- **Reference data**: lookup tables are seeded with synthetic values for
  development only; they do not represent real organizational configuration
  (per `../../AGENTS.md`'s data and privacy guidance).
