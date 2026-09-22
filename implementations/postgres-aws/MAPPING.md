# Schema mapping and platform-specific notes

Tracks how `../../model/schema.yaml` maps to this implementation's Postgres
tables, and where this implementation approximates or narrows the canonical
model. Update this file whenever a mapping decision or gap changes.

## Stack

TypeScript throughout (server and, later, client). The server uses Express,
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

## Schema-mapping drift check

`npm run verify-schema-mapping` (`scripts/verify-schema-mapping.ts`) is a
heuristic, text-level check that every in-scope entity's canonical fields
from `model/schema.yaml` still appear as columns in `src/db/schema.ts`. It
exists because hand-transcribing the canonical model into a second schema
representation invites silent drift; it does not check types or catch
anything beyond a field disappearing entirely. Run it after any change to
either `model/schema.yaml` or `src/db/schema.ts`.

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
