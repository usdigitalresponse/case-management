# Project Decisions

This file records durable project decisions that contributors and agents should
understand. Update an existing entry when a decision is refined, and add a dated
entry when a decision materially changes.


## Current Decisions

### Invoice review beside an external case management system

- **Status:** Active; being built in the Postgres/AWS prototype
- **Decided:** 2026-10-25

The Postgres/AWS staff app becomes a tool for reviewing invoices, designed to
sit beside an external case management system. Cases may be managed there, so
case pages here are mostly read-only. **Add case**, and adding people to a
case, stay because invoice access depends on case assignment. Other case
features (overview board, directories, closing a case, lifecycle history)
are hidden, not removed. Links to the external system are inert placeholders.
The external submitter portal keeps its sign-in and is restyled to match.

**Line review**
- Reviewers approve a line, approve part of it (correcting hours or rate, or
  the amount when it has no hours), or reject it.
- Approving part of a line or rejecting it needs a reason from a configurable
  list: rate above the configured rate, work not billable, more time than the
  task needs, duplicate entry, block billing, or other with a note.
- Notes are visible to everyone who can see the invoice. Staff keep unofficial
  notes outside the system.
- Decisions can be undone or changed freely until the reviewer finishes the
  review. Only finished rounds are recorded, and exports show their history.
- A rejected line no longer rejects the invoice.

**Pricing**
- A time line is requested at the rate the submitter stated.
- A stated rate that differs from the configured rate is flagged, and a
  re-price action approves those lines in part at the configured rate.

**Sign-off and routing**
- Sign-off by a director happens in the tool, for the whole invoice. The
  director may send it back to the reviewer with an internal-only comment
  instead.
- Reviewers may change the sign-off approvers for one invoice when they
  differ from the default.
- New invoices go to the case's reviewer, else a default reviewer set in
  Settings, else stay unassigned. Any reviewer may reassign an invoice.
- Everyone sees every queue, but their own work is shown first.
- Waiting time counts working days and excludes weekends. A holiday calendar
  is planned.
- The working-day threshold for calling out late invoices is a setting.
- Roles: billing reviewer, sign-off approver, general staff (duties to be
  defined) and administrator.

**Exports**
- After sign-off, staff export the documentation for payment.
- Checking it for confidential information happens outside the system.

**Staff entry of invoices received elsewhere** (decided 2026-10-26)
- Any staff role may enter an invoice a professional sent by email or from
  another tool, for any professional assigned to the case, by typing it or
  importing the file, as submitters do.
- Staff record how it was received and the date; waiting time counts from
  that date.
- The professional sees it read-only. The staff member who entered it may
  review it, but sign-off is still by someone else.

**Later step**
- Submitters replying to line decisions.
- Importing a case from a PDF or spreadsheet from another system (a disabled
  placeholder on the new case page).

See `scenarios/invoice-review.md` and model 0.5.0 in
[the model review](model-review.md).

### Supporting invoice import and export

- **Status:** Active
- **Decided:** 2026-10-09

Payees may upload supporting invoices (structured legal billing files,
spreadsheets or documents) that become draft payment requests only after the
submitter confirms them; extracted values are never trusted directly. Imported
time lines create time entries on submission. Billing staff may export any
submitted request; submitters only their own. Third-party extraction is limited
to synthetic data during development; live extraction stays within the system
boundary, which includes services in the organization's own cloud account, and
adding a cloud AI service requires a cost review. Uploaded files are not
retained: confirming or discarding an import deletes the content and keeps only
metadata, hash and extracted values. Submitters may edit drafts, recall a
submission before any review decision, and start over with a new upload.
Submitters match each imported timekeeper to an existing professional assigned
to the case; unmatched timekeepers block confirmation. A configured delegate
role on an office affiliation lets support staff submit for professionals in
that office; office membership alone grants nothing. Represented professionals
do not approve or attest but may view and export those requests. Imported
expense lines create expenses. Exports are not audited. Unresolved uploads
expire after three days, and recall is allowed only before review begins.
Draft or withdrawn requests may be deleted outright by their submitter until
a review decision is recorded, including attempts recalled before review;
after that a request is retained and can only be withdrawn.
Built first in the Postgres/AWS prototype. See the
[plan](invoice-import-export-plan.md).

### Case closure ends assignments

- **Status:** Active
- **Decided:** 2026-09-09

Closing a case atomically ends every active assignment role at the effective
closure time, preserving history and recording the closing actor and reason.
Reopening does not reactivate assignments; renewed assignments use new records.

### External payment completion

- **Status:** Active
- **Decided:** 2026-09-09

The application owns approval and tracks confirmation of payment completed
elsewhere. Retain `payment` for audited external completion evidence; do not
implement payment execution. Approval and completion are separate states.

### Domain relationships and history review

- **Status:** Active
- **Decided:** 2026-09-09

Adopt the platform-neutral 0.2 model described in [the model review](model-review.md).
Separate person identity from case roles and preserve typed lifecycle, assignment
and financial history. Retain `invoice` as the payment-request aggregate and
`service_provider` as payee rather than creating parallel names. Existing
Dataverse now has a schema/data review path; operational workflows and
server-side enforcement remain documented implementation gaps.
Support platform forms, custom web journeys, and future complete custom
implementations from the same contracts without selecting a production stack.


### Initial Dataverse Intake Prototype

- **Status:** Active
- **Decided:** 2026-09-08

Evaluate a Dataverse implementation with one case intake form for an existing
client, using synthetic reference data. Keep the shared model authoritative and
record mappings, commands, and gaps under `implementations/dataverse/`. This
does not select a production platform. Client creation and the full case
lifecycle remain outside the first intake slice.

The current prototyping direction is Power Platform, using its built-in
capabilities wherever appropriate. Standard model-driven forms and views are
the default; specialized interfaces require a demonstrated workflow need.
Preserve the option to compare this prototype with a hybrid or fully custom
web implementation of the same specification. See the
[assessment and incremental plan](architecture-assessment.md).

### Prototype Direction

- **Status:** Active
- **Decided:** 2026-09-04

The project begins as a generic, implementation-neutral prototype specification
for public-sector case management and billing. It may adopt a specific technology
stack as its direction is validated.

The shared specification should remain the source for comparing candidate
implementations until the project explicitly chooses a different direction.


### Data and Privacy

- **Status:** Active
- **Decided:** 2026-09-04

Repository content must use generic terminology, synthetic examples, and
configurable reference data. Organization-specific, confidential, personally
identifying, and private source material must remain outside the repository.


### Agent Instructions

- **Status:** Active
- **Decided:** 2026-09-04

The root [AGENTS.md](../AGENTS.md) file is the source of truth for agents working
in this repository. Agents should update it when a durable command, invariant,
directory boundary, or working convention changes.


### Git and Review Workflow

- **Status:** Active
- **Decided:** 2026-09-04

Agents must not push commits or branches, create pull requests, or otherwise
publish repository changes. Agents should leave changes uncommitted for review
unless the user explicitly requests a commit.

The project does not currently require every change to use a pull request and
has not selected a single required merge method. Contributors should seek review
from existing contributors for changes that benefit from discussion or affect
shared project conventions.


### User accounts carry a system role via the shared role table

- **Status:** Active
- **Decided:** 2026-09-11

`user_account` gained `system_role_id`, a reference to `role.role_id` with a new
`role_context` value `user_account`. This reuses the role table's existing
documented purpose ("a future role-to-permission mapping keys off role_id")
rather than inventing a parallel permission vocabulary or hand-editing display
names to imply a role, as the synthetic fixture had been doing.

This only adds a configuration hook; it grants no permission by itself. The
actual mapping from a system role to enforced permissions remains an open,
unresolved decision (see `model/create-case.md`'s "Decisions before enabling
writes" and the comparison plan's "actor-account mapping, intake permissions").
An account with no `system_role_id` is a configuration gap, not an implicit
grant or denial — do not treat absence as "administrator" or "no access" without
resolving that decision first.

### New-case intake UI comparison (in progress)

- **Status:** In progress — not yet a decision
- **Started:** 2026-09-10

Plan to compare standard model-driven intake, a Power Fx Custom Page and a React
web interface against the same Dataverse backend and shared transactional intake
behavior. See [the plan](case-intake-comparison-plan.md) and
[comparison worksheet](case-intake-ui-comparison.md). This records the experiment's
scope, not a UI winner or production-platform decision. Standard forms remain the
default until evidence supports a subsequent decision.


### Configurable billing rules

- **Status:** Active
- **Decided:** 2026-10-12

Each deployment serves one agency with one set of billing rules. Agencies
differ on standard billing practice, so none is built in: administrators turn
each rule off, warn or require in Settings. Built first: billing codes from a
configured list, time increments (flagged, never rounded), a daily hour cap,
long single entries (warn only, as possible block billing) and billing period
requirements. Settings are kept as history and every submission snapshot
records the rules it was checked against. Planned, not built: rates by kind
of work (such as travel or in-court time) and other expense rules (such as
receipts above an amount), which need activity-based rates and receipt
records first. Mileage is decided below.

### Mileage priced per mile and checked against driving distance

- **Status:** Active
- **Decided:** 2026-10-12

Mileage is an expense type, not a separate kind of line: an expense line
with the mileage type carries the trip (from, to, round trip) and the miles
claimed, and is priced at an administrator-set rate per mile in force on
its date, as time is priced from hourly rates. A configurable billing rule
compares the miles with the driving distance between the two places,
replacing a manual map check and printed map evidence with a travel log.
Distances come from a routing service the deployment configures, looked up
only on submission while the rule is on and reused for the same trip, so
the per-request cost stays small; an unmeasured trip never blocks
submission and reviewers can open the route themselves. Address
autocomplete is left out because it costs requests per keystroke. Splitting
one trip across several cases is planned, not built.

### Firm-added professionals with staff approval

- **Status:** Planned, not built
- **Decided:** 2026-10-12

A billing delegate may add a colleague to their office as a professional with
no login (name, proposed kind, email if known), so a firm's support staff can
record and bill work by people who never sign in. Staff approve the person,
including their kind, which sets the rate their time is priced at, before any
of their time is priced; assignment to a case stays a staff action, as now.
"Work done by" and unmatched timekeepers on imports will offer adding someone
this way. Free-text "work done by" names without a professional are not
allowed: they can't be priced, checked against assignments or kept as one
identity. If the person later signs in with that email, they use the same
profile. Needs model changes (a pending professional or affiliation awaiting
approval, and who may approve) before it is built.


## Deferred Decisions

The following decisions will be made when the project has enough information to
support them:

- production technology stack and hosting architecture;
- detailed product scope and domain model;
- YAML schema, formatting, and validation tooling;
- continuous integration and required checks;
- additional implementation-specific directory structures; and
- design-tool export and handoff conventions.
