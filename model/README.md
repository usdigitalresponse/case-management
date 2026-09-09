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
- `forms.yaml` defines the initial case intake form using schema field keys.

Acceptance scenarios live in `../scenarios/`. Workflow and reference-data files
will be added when their formats and contents are ready for review. Synthetic
implementation fixtures do not establish canonical reference values.

## Professional qualification levels

A professional may have one qualification level through the optional
`professional.qualification_level_id` reference to `qualification_levels`.
Allowed levels remain to be defined as configurable reference data. This is
separate from `professional_qualification`, which records qualifications for
specific case categories. How qualification levels affect assignment eligibility
remains an unresolved decision.

## Offices

An `office` has a stable identifier, display name, and active status. Each
professional may be associated with one office through the optional
`professional.office_id` reference; an office may have many professionals.

This relationship supports identifying cases assigned to professionals in the
same office. Office association alone does not grant access. The roles and
permitted actions for office-based access, and how office changes affect access,
remain unresolved. Multiple concurrent office memberships and office membership
history are not modeled yet.

## Counties

A `county` has a stable identifier, display name, and active status. Each case
may be associated with one county through the optional `case.county_id`
reference; a county may be associated with many cases.

The case association is provisional. Whether counties should also or instead
be associated with offices or professionals remains unresolved.

## Invoice approvals

Each invoice has an ordered `invoice_approval_chain` with one or more
`invoice_approval_step` records assigned to user accounts. Configured policy may
require invoice-level pre-approval by another user before line review begins.
This pre-approval is separate from external-service `preauthorization`.

The `invoice_approval_step_types` reference data must distinguish invoice
pre-approval from line review. `invoice_approval_outcomes` must distinguish
approval, rejection, and requests for changes. Reference-data identifiers and
the policies that select pre-approval and reviewers remain to be defined.

An `invoice_approval_decision` records the outcome, actual reviewer, timestamp,
and any reason. Pre-approval decisions cover the invoice and omit a line
reference. Line-review decisions reference an individual invoice line. Every
line must be approved at each line-review step before the next step can proceed.
Missing decisions are pending; rejection or a request for changes blocks the
chain. Overall approval is derived from completion of all required steps.

Only one chain per invoice may be non-superseded. Invoice contents and chain
steps are frozen during that review attempt. Corrections or renewed review
require superseding the chain, preserving the reviewed values and decisions,
and starting a new chain without reusing old approvals. The structure for
immutable invoice snapshots remains to be defined; implementations must enforce
the history requirement in `rules.yaml` or document the gap.

The initial model uses sequential steps with one assigned user per step.
Parallel review, delegation, partial invoice payment, and adjustments to approved
line amounts remain unresolved.
