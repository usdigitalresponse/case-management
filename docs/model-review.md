# Domain model review — 0.2

This review extends the existing generic specification. No source research,
organization-specific vocabulary or configuration values are included. Model
files move from 0.1.0 to 0.2.0 because the initial model is already on the tracked
remote branch. This is a breaking draft-model revision, not a deployed upgrade.

## Coverage and changes

| Finding | Existing coverage | Revised model |
| --- | --- | --- |
| Central case | UUID, county, category, mutable status/dates and one external reference | Keep Case; add identifiers, organizational context, jurisdiction, language and effective program/funding associations |
| People versus clients | Separate client, professional, user and provider records without shared identity | Add person; professional becomes a profile; client is a case_participant role rather than a profile; account optionally links to person |
| Case roles | Single required client reference | Add case_participant with role, interval and optional affiliation; old client reference becomes an optional plain compatibility field pointing at person (see field-semantics deferral below); participant/affiliation/assignment roles share one `role` entity so a future permission mapping has one key |
| Assignment history | Case/professional with assigned and ended timestamps | Retain entity; add role, affiliation, assigning/ending actors and end reason; derive active/primary assignment |
| Charges or issues | Missing | Add case_issue with optional code, statute reference, date and primary indicator |
| Activities | Only time_entry.activity_type_id and description | Add structured activity; keep time_entry independent with optional activity link |
| Timeline | Generic audit metadata only | Add lifecycle events, notes, communications and scheduled calendar events; derive a permission-filtered timeline |
| Time context | Worker, case, service date, hours and type | Add optional activity, office, program and funding relationships; avoid copied classification |
| Close/reopen history | Mutable status and dates; generic audit_event | Add immutable case_lifecycle_event and make status/dates projections |
| Organization and affiliation | Office plus one professional office link | Add organization and effective person_affiliation; retain office and provider as distinct concepts |
| Resource recommendations | Requirements catalog, no executable rules engine | Add optional recommendation contract over configured case paths; defer catalog and expression language |
| Payment request | invoice already means request; line reviews and payment exist | Retain key; add case/payee, period/currency, supporting_invoice, frozen submissions, attestations and request events |
| Authorization and approved amounts | Requested preauthorization amount only | Add ceiling decisions, request allocations, approved line amounts and final allocation decisions; calculate balances |
| Supporting documents | Missing | Add immutable document versions and explicit document_link targets |

New entities: `person`, `role`, `organization`, `person_affiliation`, `case_participant`,
`case_identifier`, `case_issue`, `case_program`, `case_funding`,
`case_lifecycle_event`, `activity`, `case_note`, `communication`, `calendar_event`,
`supporting_invoice`, `invoice_authorization_allocation`,
`invoice_allocation_decision`, `invoice_attestation`, `invoice_event`,
`preauthorization_decision`, `document`, and `document_link`.

Removed entities: `client` and `invoice_approval_step`. `client` carried no
field beyond a link to its person, and duplicated what `case_participant`
(role = client) already expresses; the compatibility field moved to
`case.client_id`, now a plain reference directly to `person`. `invoice_approval_step`
pre-assigned a stage to a reviewer ahead of any decision, a routing concept
this revision doesn't implement; `invoice_approval_decision` now carries
`sequence_number` and `step_type_id` directly against the chain.

Materially changed entities: `user_account`, `professional`, `office`,
`case`, `case_assignment`, `person_affiliation`, `time_entry`, `invoice`,
`invoice_approval_chain`, `invoice_approval_decision`, `service_provider`, and
`preauthorization`.
Existing qualifications, expenses and invoice lines retain their keys and
structure; their cross-record rules are extended where necessary. `payment`
retains its key but now explicitly records external completion evidence, with
source, actor, timestamp and approved-attempt linkage; amount is optional.

## Explicit design choices

- Drop `client` as a profile entity; it added no data beyond its person link, and
  a client role is fully expressed by `case_participant`. Intake selects a
  person and creates a case participant.
- Retain `professional` for assignment eligibility, including staff. Qualification
  requirements depend on configured assignment role, not every person contact.
- Keep county and office keys. Jurisdiction is a separate configured reference;
  neither its geographical hierarchy nor an equivalence to county is assumed.
- Use an effective `case_program` association and person affiliations; simple
  program and funding vocabularies do not yet need independent entities.
  `case_funding` always attaches through a `case_program` and carries no
  interval of its own, so a funding record cannot drift from the program
  period it belongs to; a funding source that applies case-wide without a
  program is out of scope for this revision.
- Unify the three role vocabularies (case participant, person affiliation,
  case assignment) into one `role` entity carrying a `role_context`, instead of
  three disconnected reference-data enums. This is groundwork for
  access/permission rules that key off `role_id`; nothing in this revision
  implements those rules yet.
- Retain `invoice` as the request for payment. Supplier invoice references are
  evidence within the request, not another independently approved aggregate.
- One request has one case and payee. This narrows the earlier unconstrained
  invoice-line case structure to the observed request concept; multiple
  supporting invoice references and authorization sources remain possible.
- Use typed timeline sources rather than a universal event or note table. Keep
  `audit_event` for audit metadata; prior values must be preserved by the
  implementation even though its generic payload format is not prescribed.
- Case status, open/closed dates, primary client, external reference, and
  professional display/office should eventually become read-only projections
  over lifecycle events, identifiers, participants and affiliations, but ship
  in this revision as plain stored fields: nothing computes or refreshes them
  yet, so calling them derived would claim a guarantee that doesn't exist. See
  "Deferred: fields that should become read models" in `model/README.md` for
  the target design and what a real implementation needs. No stored
  age/threshold/bucket fields existed to remove. Assignment state, financial
  balances and reporting buckets remain calculations with explicit as-of policy.

## Prototype transition

There are no active users or data-preservation requirements for the current
prototype. A clean rebuild against the revised specification is acceptable;
backfill scripts, compatibility data conversion and reconstruction of legacy
history are not required. Retained stable keys limit needless specification churn,
not a requirement to preserve unused prototype data.

The Dataverse implementation now includes an explicit 0.2 schema-review path
that reuses the existing app and loads these synthetic relationships. The original
0.1 guided baseline remains separate and cannot overwrite the expanded schema.
Review forms and cached fixture projections are not a workflow implementation;
server-side closure, approval and security enforcement remain documented gaps.
See the implementation README for preparation, deployment and verification.

## Product decisions still required

- Allowed participant/assignment roles, intake permissions, sensitive-note access,
  and retention policy.
- Exact status vocabularies and transition policies, correction authority,
  backdating rules and reporting time zone.
- Whether intake requires multiple clients, whether non-person parties need
  direct case participation, and whether staff eligibility needs a later profile
  distinction beyond the existing professional key.
- Meaning of case age after reopening; primary office selection with concurrent
  affiliations; jurisdiction/county hierarchy and contextual change history.
- Program/funding eligibility, allocation policy and reporting snapshots beyond
  the explicitly frozen payment submission evidence.
- Required attestation roles/text and signature assurance; review routing,
  delegation, withdrawal and paid-request corrections.
- Whether authorization coverage is mandatory, pending reservation treatment,
  authorization expiry/overrides, currency precision, and partial payment,
  external settlement/reversal reporting. Payment and refund execution are outside
  scope; only approval and external completion are tracked. Unsupported
  reconciliation paths need policy before implementation.
- Whether one supplier invoice can be split across requests, multicase request
  requirements, and multi-recipient or organization-only communications. Current
  supporting invoice metadata is scoped to one payee/request, and communication
  has optional single sender/recipient person links.
- Resource/template catalog, recommendation precedence, language and versioning;
  no executable configuration framework is introduced.

## Verification boundary

Shared scenarios describe required behavior, not results from a deployed app.
This change validates YAML structure, entity/field references, rule and workflow
entity targets, form fields, and review diffs. Runtime enforcement and revised UI
acceptance remain implementation work, explicitly tracked in the Dataverse notes.

## External payment clarification

Actual payment occurs outside this application. The application owns approvals
and records whether external completion has been confirmed. `payment` is retained
as a confirmation record, not an instruction to move money. Approval status and
completion status are separate. Missing confirmation means unconfirmed, not
certainly unpaid. Optional reported amounts are evidence, not a payment ledger.

## Assignment closure decision

Closing a case ends all active assignment roles at the closure effective time,
with the closing actor and a closure reason, in the same logical transaction.
Reopening does not reactivate them; renewed assignments use new records. This
removes ended assignments from active workload and assignment-derived access
without deleting history or revoking separately authorized access.
