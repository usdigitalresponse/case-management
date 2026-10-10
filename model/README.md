# Model

The files in this directory define the platform-neutral case-management and
billing model. They describe required concepts and behavior, not how a specific
technology stores or implements them.

## Conventions

- Treat stable identifiers such as entity, field, and rule keys as API-like
  contracts. Rename them only through an explicit migration decision.
- Use `snake_case` for identifiers and singular nouns for entities.
- Use display names and descriptions for human-readable language. Do not use a
  display name as an identifier.
- Represent implementation-specific choices outside the canonical model.
- Prefer references to duplicated data.
- Add enums and reference values only after the allowed values are understood.
- Keep calculated values out of the canonical record unless history or audit
  requirements require a stored snapshot.
- Keep `spec_version` unchanged until the initial model has been pushed. After
  that push, increase `spec_version` when a model file changes. Before `1.0.0`,
  breaking changes are allowed but must be documented for reviewers.

## Files

- `schema.yaml` defines entities, fields, and relationships.
- `rules.yaml` defines business requirements that implementations must enforce
  or explicitly document as gaps.
- `forms.yaml` defines case intake using case fields and related-record inputs.
- `create-case.md` proposes the shared intake request/result, atomic effects,
  retry and error contract; it is not yet a deployed operation.
- `workflows.yaml` defines lifecycle, payment-request and invoice-import transitions.

Acceptance scenarios live in `../scenarios/`. Reference sets named by
`reference_data` remain configurable vocabularies, not entity foreign keys.
Synthetic implementation fixtures do not establish canonical reference values.
See [the model review](../docs/model-review.md) for migration and open decisions.

## Professional qualification levels

A professional may have one qualification level through the optional
`professional.qualification_level_id` reference to `qualification_levels`.
Allowed levels remain to be defined as configurable reference data. This is
separate from `professional_qualification`, which records qualifications for
specific case categories. How qualification levels affect assignment eligibility
remains an unresolved decision.

## Offices

An `office` is an organizational unit, optionally linked to an `organization`.
`person_affiliation` records effective organization/office membership and supports
multiple memberships over time. Assignment and participant records may retain a
specific affiliation. `professional.office_id` is now only an optional primary
office projection; it cannot replace affiliation history or grant access.

## Counties

A `county` has a stable identifier, display name, and active status. Each case
may be associated with one county through the optional `case.county_id`
reference; a county may be associated with many cases.

The case association is provisional. Whether counties should also or instead
be associated with offices or professionals remains unresolved.

## Invoice approvals

Each invoice has an ordered `invoice_approval_chain`. There is no separate step
entity: each `invoice_approval_decision` carries its own `sequence_number` and
`step_type_id` directly against the chain, since nothing pre-assigns or routes
a stage ahead of the decision that resolves it — that pre-assignment concept is
deferred until a real approval-routing engine exists. Configured policy may
require invoice-level pre-approval by another user before line review begins.
This pre-approval is separate from external-service `preauthorization`.

The `invoice_approval_step_types` reference data must distinguish invoice
pre-approval from line review. `invoice_approval_outcomes` must distinguish
approval, rejection, and requests for changes. Reference-data identifiers and
the policies that select pre-approval and reviewers remain to be defined.

An `invoice_approval_decision` records the outcome, actual reviewer, timestamp,
and any reason. Pre-approval decisions cover the invoice and omit a line
reference. Line-review decisions reference an individual invoice line. Every
line must be approved at each line-review sequence_number before the next can
proceed. Missing decisions are pending; rejection or a request for changes
blocks the chain. Overall approval is derived from completion of all required
sequence numbers.

Only one chain per invoice may be non-superseded. Invoice contents and the
chain's decisions are frozen during that review attempt. Corrections or renewed
review require superseding the chain, preserving the reviewed values and
decisions, and starting a new chain without reusing old approvals. Each chain
now requires an immutable `submission_snapshot`, as described below.
Implementations must enforce the history requirement or document the gap.

The initial model uses sequential steps with one assigned user per step.
Parallel review and delegation remain unresolved. External payment execution is
outside the system boundary.
Line decisions now record approved amounts separately from requested amounts;
a later step may reduce but cannot increase an earlier approval in that attempt.

## Identity and participation

`person` is contact identity. `professional` is an optional one-to-one profile
of that identity, carrying attributes (qualification, office, active) beyond
identity. Client is not a profile: an existing person participates in many
cases in different configured roles, including client, through
`case_participant`; do not add a `client` entity back. `user_account` remains
authenticated identity. Providers retain `service_provider` as a payee profile
of either a person or organization. Programs and funding sources remain simple
reference values; their effective case associations are child records. Do not
create an organization for each program, or a separate person for each
professional role.

`case_participant.participant_role_id`, `person_affiliation.affiliation_role_id`,
`case_assignment.assignment_role_id`, and `user_account.system_role_id` all
reference the single `role` entity rather than disconnected reference-data
vocabularies, each tagged with a `role_context` naming which relationship it
belongs to. This exists so a role-to-permission mapping has one stable key
(`role_id`) to attach to, instead of reimplementing access logic per
relationship type. `system_role_id` (`role_context: user_account`) is that key
for authenticated accounts; it configures a permission role but grants no
permission by itself until an actor-permission mapping resolves it — see
`docs/DECISIONS.md`. Adding a new relationship that needs configurable roles
should add a new `role_context` value, not a new parallel role entity.

## Field semantics and calculations

Fields default to source-of-truth values. `data_role: snapshot` denotes a
deliberately frozen historical value. Reference fields select configured
values; UUID `references` identify explicit foreign keys. Every reference
implies many-to-one unless a rule restricts it. UUID identities must survive
exports and mappings; platform record IDs may need an explicit crosswalk. Do
not cascade-delete history.

The additional `object` type is a structured, schema-versioned value, used only
for immutable snapshots: the review `submission_snapshot` and the
`invoice_import.extraction_result`. Platforms may encode it as JSON or normalized
snapshot children; it is not permission to flatten operational relationships.

### Deferred: fields that should become read models

`case.status_id`/`opened_on`/`closed_on`/`external_reference`/`client_id`,
`invoice.status_id`/`submitted_at`, `preauthorization.status_id`, and
`professional.display_name`/`office_id` are, for now, plain stored fields set
directly by whatever writes the record (today, that's the review fixture
script). Each duplicates a value that a proper history table already makes
derivable: lifecycle events for case status/dates, `case_identifier` for the
external reference, `case_participant` for the current client,
`invoice_event` for invoice status/submission time, `person`/
`person_affiliation` for professional display name/office. They were briefly
modeled as `data_role: derived` projections, but nothing computes or refreshes
them at runtime yet, so that annotation claimed a guarantee the system
doesn't keep; they were reverted to plain fields rather than ship an unenforced
contract.

Before promoting any of these back to `data_role: derived`, there must be an
actual mechanism keeping them in sync with their source history — a rules/
workflow engine step, a database trigger, or (for the Dataverse implementation
specifically) a plugin, Power Automate flow, or calculated/rollup column — and
a rule that rejects direct writes once that mechanism exists. Until then, treat
values in these fields as informational, not authoritative; the tables below
list the correct authoritative source for each.

Calculate these read models instead of relying on the stored fields above:

| Read model | Source and interpretation |
| --- | --- |
| Current case status, first opened date, current closed date | Effective lifecycle events; closed date becomes null on reopening without deleting earlier closings |
| Case external reference | Value of the designated primary `case_identifier`, or null |
| Current client | The single current `case_participant` in the client role, when unambiguous; otherwise null |
| Current primary professional | Assignment in the primary role effective at the requested instant |
| Professional display name / office | Linked `person.display_name`; primary office from effective `person_affiliation`, when unambiguous |
| Invoice status, submitted time | Latest `invoice_event`; original submissions remain in history |
| Assignment/participation active | Start-inclusive, end-exclusive interval evaluated at an explicit as-of instant |
| Case age, threshold flags, date buckets | Lifecycle events and reporting as-of date/time zone; threshold and age convention are configured |
| Approved request amount | Final required line-review decisions in the non-superseded chain |
| Previously submitted amount | Frozen submissions as of a cutoff; distinguish all attempts from distinct requests to avoid double counting resubmissions |
| Previously approved amount | Effective approved allocation draws as of a cutoff, excluding the request being reviewed |
| Remaining authorization balance | Latest effective authorized ceiling minus effective approved draws, including paid draws |
| External payment completion | Completion confirmed when a payment confirmation exists; otherwise unconfirmed, independently of approval |

Case age may mean elapsed since first open, current open interval, or total open
time excluding closed intervals. Reports must name their convention; none is
silently selected. Pending reservations are separate from approved consumption
and require policy before they affect an available balance.

## Case timeline

Build a permission-filtered union of `activity`, `case_note`, `communication`,
`time_entry`, `calendar_event`, `case_lifecycle_event`, and optionally financial
history through each request's case. Return source entity/key, case ID, effective
time or service date, recorded time where present, actor/worker, type and summary.
Sort ties by source entity and stable key; lifecycle ordering uses its sequence.
Date-only time entries retain date precision, not an invented midnight instant.
Calendar records remain labelled scheduled or cancelled, distinct from completed
activities. Linked time and activity may be grouped in the UI but retain distinct
identities and amounts. Filter each source and attached evidence before counting,
sorting or summarizing; a case-level permission does not imply all note access.
A timeline is a read model, not a second history table.

## Payment requests and immutable submissions

The stable `invoice` key continues to mean a payment request. It now has one case
and payee and may contain multiple `supporting_invoice` references. It is not
necessary to add a competing `payment_request` entity. Requests with multiple
cases are outside this slice and require a deliberate future allocation design.
`invoice_line` retains the billable items and `payment` records external completion
evidence; it is not a payment instruction or disbursement engine.
`preauthorization` is an external-service ceiling, distinct from chain pre-approval.

`submission_snapshot` must contain `spec_version`, capture timestamp, request ID,
chain ID and exact reviewed values of the request, lines, supporting invoice
references, allocations and payee contact/vendor details. Capture relied-on case
identifiers, participant/assignment identities, jurisdiction, issue descriptions,
and attestation statement/signature document version IDs as deliberate evidence,
not extra mutable fields on each request. Include document version IDs and hashes.
Each snapshot section identifies source entity and stable record ID. Corrections
to source records cannot change the reviewed snapshot. Snapshot and attestations
are finalized atomically at submission; review cannot start without required
attestations. Storage format and electronic signature assurance remain mapping
and product decisions respectively.

Final approving line decisions may have `invoice_allocation_decision` children
that distribute the approved line amount across the request's authorizations.
Their sum supplies actual draws; requested allocations do not consume approved
capacity. Earlier review steps do not consume capacity. Approval and ceiling
updates require serialized checks across all competing requests, including API
and import writers. Unsupported transactional enforcement is an explicit platform
gap, not a relaxed domain rule.

An invoice line optionally derives from one source record through a typed
foreign key: `invoice_line.source_time_entry_id` or
`invoice_line.source_expense_id`. At most one is set and its target must be on
the same case; a manual line sets neither. These are real references with the
same integrity as every other relationship, not an untyped polymorphic pointer
— this replaces the earlier `source_record_type`/`source_record_id` pair.
Additional source types are added as further optional typed references after a
model decision, following the same one-of pattern as `document_link`.

## Supporting invoice import and export

A payee may upload a supporting invoice file instead of entering lines. The file
becomes a transient `document`; an `invoice_import` records its format, the
extraction method and version, and an immutable `extraction_result`. Extraction
proposes one draft request; the submitter corrects it against the original file
and confirms the extracted values. Uploaded files are not retained: confirming
or discarding an import deletes the file content and sets
`document.content_deleted_at`, keeping only metadata, hash and the extraction
result. Imports left unresolved expire three days after upload, deleting the
file and withdrawing any unconfirmed draft. Document storage is a short-lived
working area for conversion, not a record store: it accepts only configured
formats within configured limits, scans files before parsing, and keeps them out
of versioning and backups. From then on the draft request, and later its submission snapshot, is
the record of the supporting invoice; reviewers never see the original file.
The draft stays editable until submitted through the ordinary
`payment_request` workflow, and a submission may be recalled to draft only
before any review decision. Starting over withdraws the draft and needs a new upload.
Extracted values never become submitted, approved or source records by
themselves.

`extraction_result` must contain `spec_version`, the import ID, and for the
request and each line the extracted value, its location in the source where
known, an optional confidence, and any warnings. Structured formats such as
standard legal billing exchange files, delimited text and spreadsheets are
parsed directly; free-form documents need an extraction method. Neither the
model nor this contract selects a parser, extraction service or rendering
library. Production extraction stays within the system's processing boundary, which
includes services in the organization's own cloud account.

Imported lines keep supplier-stated detail on `invoice_line`: service date,
description, quantity, rate, timekeeper label and optional task, activity and
expense codes. These are evidence, not inputs to the amount. Codes stay free
text until a configured code set is adopted. Before confirming, the submitter
matches every timekeeper to an existing professional assigned to the case
(`invoice_line.timekeeper_professional_id`); unmatched lines block confirmation
and no people are created from labels. On submission, lines with a date and
hours create time entries for their matched professional, and lines the
submitter classifies as expenses create `expense` records, linked through
`source_time_entry_id` or `source_expense_id`, unless the submitter links an
existing record instead.

A configured delegate, such as office support staff, may upload, edit, recall
and submit requests for professionals in the same office. Delegate authority
comes only from a configured delegate role on an effective `person_affiliation`,
never from office membership alone, and never replaces the professionals' own
case assignments. The delegate is recorded as submitter and actor. Every line
of a delegated request names its professional; those represented professionals
need not attest or approve, and may view and export the request.

Exports render one identified submission attempt with its status and line
decisions as a document or spreadsheet. Billing staff may export any submitted
request; submitters and represented professionals only their own. Exports are
not audited.

## External payment boundary

This system owns request submission, review and approval. Actual payment happens
elsewhere. Retain the stable `payment` entity key for external payment confirmation
only. An authorized user can record confirmation manually; a future integration
may import confirmation evidence but must not initiate payment.

Show approval and completion separately: for example, Approved / Completion
unconfirmed, then Approved / Completion confirmed. No confirmation does not prove
that payment has not occurred. Confirmation records who reported it, when, the
source, the approved attempt, and optionally the reported payment date, external
reference and amount. A confirmation attests completion of the request, not an
installment. Unknown amount stays unknown; a reported discrepancy is flagged for
reconciliation without changing the approval or hiding evidence. Do not derive
an outstanding payment balance from missing amounts.

Payment execution, banking details and refund execution are outside scope.
Partial-settlement evidence, correction of mistaken confirmation and reports of
external reversals remain future reconciliation decisions, not planned payment
processing features. Existing confirmations are preserved until those correction
rules are defined.

## Assignment behavior at closure

Closing a case ends every active assignment, including primary and other staff
roles, at the closure effective timestamp. The ending actor is the closing actor
and the end reason identifies case closure. Preserve the assignment records;
active state remains a calculation over their intervals. Closing history,
assignment endings and current-state projections must commit atomically.

Ended assignments no longer count as active workload or provide assignment-based
access; separately authorized access may remain. Reopening does not restore old
assignments. Create new assignment records through normal eligibility checks.
Assignments cannot start in or span a closed interval. Corrections to closure
history must revalidate these intervals and preserve the earlier ending evidence.
