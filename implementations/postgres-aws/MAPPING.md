# Schema mapping and platform-specific notes

Tracks how `../../model/schema.yaml` maps to this implementation's Postgres
tables, and where this implementation approximates or narrows the canonical
model. Update this file whenever a mapping decision or gap changes.

## Stack

TypeScript throughout (server and client). The server uses Express,
Drizzle ORM (`src/db/schema.ts` is the single source of truth for table
definitions; `drizzle-kit generate` derives SQL migrations from it into
`migrations/`), and `pg` as the driver. Vitest is the test runner. Node 24+
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

## Design notes

How each part is built, and why, is in `docs/`:

- [`docs/frontend.md`](docs/frontend.md): the React client, page by page,
  including invoice review, the submitter portal and designs G and I.
- [`docs/intake.md`](docs/intake.md): the case intake handler.
- [`docs/api.md`](docs/api.md): routes, sign-in (SSO, emailed codes, demo
  sign-in), case assignment, invoice import, export and billing rules.

## Reference data

`src/db/ensureReferenceData.ts` idempotently seeds the reference/config
rows the app needs to function at all (`activity_types`,
`invoice_statuses`, `invoice_line_types`, `invoice_approval_step_types`,
`invoice_approval_outcomes`, and the "Staff", "External Submitter"
and "Assigned Staff" roles) via `insert ... on conflict do nothing`,
keyed by each table's unique `code` column (or, for `role`, a unique
index on `(display_name, role_context)`). The settings recorded in place
of a county (Post-conviction, Prison) have no code, so each is added only
when no county shares its name key (`ensureDefaultSettings`). `src/db/migrate.ts` runs it
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
- **Production image exists, but no pipeline uses it here**:
  `server/Dockerfile` is a multi-stage build (`tsc` → `dist/` → slim
  runtime image) used by the single-host `docker-compose.prod.yml`
  (README "Deploy"); nothing builds or pushes it to this skeleton's ECR
  yet.
- **Google OAuth credentials start empty**: `terraform/secrets.tf`
  creates the secret with blank `google_client_id`/`google_client_secret`
  (Terraform can't know them) and `ignore_changes` so a manual fill-in
  survives future applies. Combined with `NODE_ENV=production` disabling
  `/auth/demo-login` (this skeleton doesn't set `DEMO_LOGIN_ENABLED`), a
  freshly-applied environment has **no way to log in** until someone sets
  real Google OAuth values.
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
`person_affiliation`, `person_duplicate_review`, `person_merge`, `person_merge_change`,
`case_duplicate_review`, `case`, `case_participant`, `case_lifecycle_event`,
`case_identifier`, `professional`, `case_assignment`, `time_entry`,
`professional_kind_rate`, `mileage_rate`, `time_category_rate`,
`billing_rule_setting`, `invoice`, `invoice_line`, `trip`,
`invoice_approval_chain`,
`invoice_approval_decision`, `invoice_line_working_decision`, `review_time_log`,
`invoice_review_question`, `invoice_review_assignment`, `case_invoice_reviewer`,
`invoice_review_setting`, `preauthorization`, `preauthorization_decision`,
`preauthorization_request`, `preauthorization_question`,
`preauthorization_threshold`, `invoice_overrun_explanation`,
`provider_service_rate`, `document_link`,
`invoice_event`, `document`, `invoice_import`, `supporting_invoice`,
`invoice_attestation`, plus lookup tables for the `reference_data`
sets these entities use (`case_categories`, `case_statuses`,
`jurisdictions`, `languages`, `case_identifier_types`,
`case_lifecycle_event_types`, `case_lifecycle_reasons`, `activity_types`,
`invoice_statuses`, `invoice_line_types`, `expense_types`, `invoice_approval_step_types`,
`invoice_approval_outcomes`, `invoice_event_types`, `invoice_import_formats`,
`invoice_import_statuses`, `invoice_decision_reasons`,
`preauthorization_statuses`, `preauthorization_outcomes`,
`preauthorization_request_statuses`, `preauthorization_request_outcomes`,
`document_purposes`). `professional_kinds` also has `threshold_applies`.
`invoice_review_setting.setting_code` is a code from
`src/billing/reviewSettings.ts` rather than a lookup table, like
`billing_rule_setting.rule_code`.

`preauthorization` and its decisions are written by staff on the case page
and by approving a `preauthorization_request`, with `professional_id`
standing in for `service_provider_id` (as on `invoice`, and on the request,
`invoice_overrun_explanation`, `provider_service_rate` and `document_link`).
The case page and invoice facts show each professional's limit (the ceiling
of the latest decision, else the county's threshold), the approved total of
their signed-off invoices on the case, and the requested total of those
still in review. That approximates the model's
`invoice_authorization_allocation` draws, which aren't built: nothing
blocks approving past a limit. `document_link` is used only for request
and provider targets; `retired_at` and `retired_by_user_account_id` mark a file
taken off by mistake, kept and restorable.

`document`, `invoice_import` and `time_entry.source_invoice_import_id` back
structured invoice import (see "Invoice import" in `docs/api.md`).
`invoice_import.extraction_result` is plain `jsonb`, written once and never
updated by the app, but not protected against other writers. `invoice_line`'s
supplier-stated detail (service date,
description, quantity, rate, timekeeper label, codes) is accepted by
`POST /api/portal/invoices`, returned by the staff and portal detail
routes, shown on both invoice pages and included in exports; the portal
form collects date, description, hours and amount.

`professional`/`case_assignment` cover both the external emailed-code
submitter workflow and internal staff assignment (see "Case assignment,
two workflows" above) — not general scheduling/workload support.

`invoice_approval_chain`/`invoice_approval_decision` implement line-review
rounds and sign-off (see "Invoice review" in `docs/api.md`); pre-approval and denial
or change requests back to the submitter are not built.

`person_affiliation` (and `case_participant.affiliation_id`) were added ahead
of an immediate need: adding them after case data exists would mean
revisiting the `case_participant` uniqueness constraint under live data, so
it was cheaper to include now while the schema is still empty.

Every other entity in `schema.yaml` (expense, document_link,
service_provider, payment, etc.) is out of scope for this slice and has no
table here. `audit_event` has a table but so far records only time entry
changes and deletions.

### Deliberately omitted fields on in-scope entities

Tracked in `scripts/verify-schema-mapping.ts`'s `DELIBERATELY_OMITTED_FIELDS`
so the drift check doesn't flag them; update both places together if this
changes.

- `organization.organization_type_id`: reference_data classification not
  needed for intake/read scope.
- `preauthorization.service_provider_id`: no service_provider table;
  `preauthorization.professional_id` plays that role, as on `invoice`.

### Known limitation: affiliation-uniqueness and NULLs

`case_participant`'s open-relationship uniqueness index covers
`(case_id, person_id, participant_role_id, affiliation_id)`, but Postgres
unique indexes treat `NULL` as distinct from every other value — so two open
rows for the same case/person/role that both omit `affiliation_id` are not
caught as duplicates by this index. Acceptable for now since affiliation is
optional and rarely absent-but-duplicated in practice; revisit if a future
form relies on this being airtight.

### Synthetic seed data provenance

- **Review demo data** (`src/db/seed.ts` `seedDemoReviewers`,
  `seedDemoReview`): three demo staff; the third plays the agency Director,
  the only named sign-off approver ("Who may sign off" is set to named
  approvers), and the demo sign-in list shows them as "Director, signs off".
  The Director has signed off one invoice and rejected another whole; one
  waits for them with lines decided by both reviewers; one assigned to the
  first reviewer has a line the second decided. Cases get synthetic `DEMO-26-…` numbers and `COURT-…`
  identifiers; four assignments get a $2,500 pre-authorization; an
  investigator invoice states a $175 rate against the $75 configured one;
  and invoices are left signed off, awaiting sign-off, part-decided,
  assigned but not started and unassigned, one backdated past the
  10-working-day callout. The demo sign-in holds three: the part-decided
  one, waiting for an answer to its question; an expert invoice just
  submitted and given to them, billed $180 against the $150 configured
  rate; and an attorney invoice another reviewer finished, with an answered
  question and one line approved at a changed rate, for them to sign off.
  All amounts and identifiers are synthetic.
- **Invoices filed by person** (`src/db/demoData.ts`, `demoUploads.ts`):
  every demo invoice has no case and a synthetic typed case number
  (`26-CR-00211` and similar). Several share one, one is typed without
  dashes and one is a close match, for the queue's notes. Most have a
  synthetic county (County A, B) or a setting (Post-conviction, Prison). The uploaded
  PDFs print "Re: State v. [client], Case No. …", read back by the upload
  and highlighted on the check page; one names none, so its draft shows
  "Not added yet". Three print a county line ("Superior Court of County B",
  "County: County A", "Post-conviction petition"), which the seed checks is
  read back. Demo cases are spread over Counties A to C, each recorded as added
  from its first invoice; a typed number that is a case's own is put in that
  case's county, so review suggests it. One staff invoice is court observation
  not for one case (County C), with a pre-authorization request likewise, and
  one added a case whose number is a demo case's without dashes, for Edit
  data's similar numbers. Each demo person has a
  synthetic firm they're paid through and a 555-01xx phone number; the
  investigator and expert have approved rates of their own, and the demo
  partner's new invoices go to the first demo reviewer. One emailed
  invoice the demo sign-in uploaded is being entered in their own review,
  its first line approved, as if put aside to finish later.

- **Mileage demo trips** (`src/db/seed.ts` `seedDemoMileage`): street
  addresses of public landmarks in Washington, D.C. (the Library of Congress
  as the office), chosen deliberately so map links and real route lookups
  work. They are unrelated to any agency or partner and imply no
  jurisdiction. Without `ROUTE_CHECK_PROVIDER=aws` the seed stores
  approximate driving distances for them; with it, submission looks them up.
- **Person names** (`src/db/fixtures.ts`): generated with `@faker-js/faker`
  (`faker.person.firstName()`/`lastName()`), seeded with a fixed value
  (`faker.seed(20260115)`) so output stays deterministic across runs rather
  than changing every time. Not derived from, or resembling, any real
  dataset — chosen specifically so demo/test data looks realistic without
  any provenance link to real records (e.g. a production system export). Prior
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
- `route_check`: not in `model/schema.yaml`. Caches driving-distance
  lookups by address pair and counts them per month (see "Mileage" above).
- `sign_in_code`: not in `model/schema.yaml`. Hashed one-time codes for
  external sign-in (see "Emailed-code sign-in for external users" in `docs/api.md`).
- `invoice.case_number_as_typed`, `invoice.case_number_corrected`,
  `invoice.county_id`, `professional.paid_through`, `professional.phone`, `professional_rate` and
  `professional_invoice_reviewer`: not in `model/schema.yaml`. They support
  filing invoices by person (design G, above). Whether the canonical model
  files invoices by person rather than case is an open decision; until it
  is, these are prototype fields only.

## Known gaps / placeholders

- **Auth**: Google OAuth restricted to a hosted-domain allowlist
  (`usdigitalresponse.org`, `usdrvolunteers.org`) gates access for USDR's
  own team while building/demoing the prototype; Microsoft Entra ID is
  also supported (`src/auth/oidcProviders.ts`) for a government partner
  whose staff sign in with Microsoft instead. Whether either is actually
  that partner's *production* login, versus their own separate IdP
  decision, remains open — matching the Dataverse comparison plan's
  "intake roles and permitted actions" gap. External users sign in with an
  emailed code only once an administrator turns it on, for a provider in the
  Active column of Settings › Providers and for office billing staff in Settings
  › Office billing staff (`person.external_sign_in_enabled`, `manage_external_sign_in`); there
  is no environment allowlist and no sync with the external case management
  system. Administrators can add a delegate, or make an existing provider
  one, only for an existing office; adding offices is not built.
- **Cases added through invoices** (`add_case_from_request`,
  `match_invoice_to_case`): staff add a case only through a request's case
  step (`src/cases/caseStep.ts`, `src/billing/caseChoice.ts`,
  `client/src/components/CaseStep.tsx`), with its number, county and an
  optional client. A staff draft's answer is applied right after it is sent,
  outside the sending transaction: if matching then fails, the invoice stays
  in review without a case, its choice kept, and the sender is told to choose
  it on the review page; a case added before the failure is kept, and the
  next try matches it rather than adding another. Changing the case question in review records no
  request event of its own (matching does, `matched_to_case`). The
  pre-authorization match form has the same choices in its own layout rather
  than the shared component. The case-based new-invoice form and upload,
  Intake's page and `/cases/new` were deleted; their addresses redirect, and
  `GET /api/invoices/intake` remains only for "Your unfinished drafts" on To
  review. Requests already sent for matching can still be matched there by API,
  but nothing new reaches that state. Usage by county still counts a
  pre-authorization request only through its case, so one not for one case
  isn't in it yet.
- **Edit data** (`correct_case_records`, `src/cases/caseCorrections.ts`):
  administrators move a case's requests to the same case, correct it, or take
  its requests off it, each recorded value by value in `case_correction_change`
  and undoable. A client added by a correction is undone by ending their role,
  not deleting the person. Moving case rates doesn't itself flag other
  invoices; rates are compared when each invoice is read. Possible duplicate
  people and cases haven't moved here yet.
- **Guided tour material**: each tour run makes its own synthetic case
  and invoices (`server/src/demoTour/`), which show in the shared demo's
  queues beside the seeded ones, unlabelled. An hourly sweep deletes a run
  a day after it starts (`tourRuns.ts`): a deliberate, demo-only exception
  to keeping history and audit trails, for synthetic tour material alone.
  Left behind: changes a visitor made to seeded records while touring (a
  decision on a seeded invoice, a typed county, a person merge), the
  shared driving-distance cache, and files from bulk imports, which aren't
  tagged. A run reaching another visitor's records is kept and marked
  (`demo_tour_run.kept_reason`) until the next demo reset. A visitor still
  touring after a day loses the run's material. "Skip step" doesn't
  perform the step.
- **Possible double billing** (`flag_overlapping_invoice_period`,
  `src/billing/billingOverlaps.ts`): worked out each time a draft or review
  page loads, not kept in the submission snapshot, so it also shows
  requests sent later. It isn't an administrator-set billing rule: always
  on, warn only. On another case only time lines are compared, by date;
  expenses and travel the same day are left to the same-day travel note.
  An invoice billed by the same professional with no billing period is
  always a candidate, so a long history of such invoices is read in full.
- **Possible duplicate people** (`flag_possible_duplicate_client`,
  `merge_duplicate_people`; `src/people/possibleDuplicates.ts`,
  `src/people/personMerges.ts`): found after the fact in Settings › Merge
  duplicates, and flagged on a provider's page, not warned of while someone is being added (adding a
  provider still refuses a used email, and a new client a same-name person
  unless confirmed). Every unmerged person is read and compared on each
  load of Merge duplicates, fine at prototype scale but needing an indexed name
  key, or a stored list of open pairs, for a large directory. The notices on case
  and provider pages come from who each record may duplicate, kept in the server
  process for five minutes (`src/duplicateMembers.ts`): one instance only, and a
  new duplicate may not show on a page until it expires or Merge duplicates is
  opened. Matching is exact on a normalized name, so spelling variants
  and nicknames are caught only when flagged. A merge is refused while both
  profiles sign in with different accounts, as one would lose their
  invoices; there is no way yet to move a second sign-in onto a person.
  A merge reprices nothing: moved invoice lines keep the prices they had.
  The retired person keeps their email, which no longer counts as in use, so
  a later sign-in with it adds a new person rather than reopening theirs.
- **Possible duplicate cases** (`flag_possible_duplicate_case`,
  `src/cases/possibleDuplicateCases.ts`): review only, as cases belong to the
  external case management system. Only number matches are found (ignoring
  punctuation and leading zeros; numbers shorter than four characters are
  ignored), and never across two counties; the same client in the same
  county isn't, as one client often has several matters. Cleaning up means closing the extra case here, which
  waits until its invoices are finished; a sent invoice can't be moved to
  the other case.
- **Infrastructure**: Terraform provisions a single (`sandbox`) environment
  with a single-instance (non-Multi-AZ) RDS Postgres instance. No
  staging/production promotion path, autoscaling policy, or WAF is configured
  yet.
- **Upload scanning**: uploaded files are checked by format and limits but not
  scanned for malware, which `validate_invoice_import` requires before parsing.
- **Review questions**: no email tells the submitter a question is waiting;
  they see it on the invoice and its status in their list ("Question for
  you").
- **Cleanup (next round)**: submitters see a sent invoice's lines in two
  different tables: `client/src/portal/CheckLinesTable.tsx` when it's filed
  by person, `client/src/components/InvoiceLinesTable.tsx` on
  `PortalInvoiceDetail` when it's filed under a case. Use `CheckLinesTable`
  for both, read-only once sent, so portal-only line features (such as a
  line's questions) are built once. Cell wording is already shared in
  `client/src/invoiceLineDisplay.ts`; dates still differ between the two
  ("18 Sep 2026" against "Sep 18, 2026").
- **Reference data**: lookup tables are seeded with synthetic values for
  development only; they do not represent real organizational configuration
  (per `../../AGENTS.md`'s data and privacy guidance).
