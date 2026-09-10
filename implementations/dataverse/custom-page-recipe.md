# Custom Page build recipe: New case intake

> Superseded save approach: the [three-interface comparison plan](../../docs/case-intake-comparison-plan.md)
> requires one shared transactional backend for standard forms, Power Fx and
> React. Before building this page, replace the sequential-write approach below
> with the confirmed shared operation. The remaining layout/input notes are
> provisional; this page has not been built or tested.

This is the build recipe for a Power Apps Custom Page implementing
`model/forms.yaml:new_case` (0.2), for comparison against the existing
model-driven `cm_case` form's "intake" tab. It is the Custom Page analog of
`forms.yaml` itself: precise enough to author in Power Apps Studio without
guessing intent. It targets the same tables already deployed by the 0.2
review (`implementations/dataverse/README.md`), using the confirmed logical
names below (read from `Solution/Entities/*/FormXml/main/*.xml`).

This recipe does not change canonical behavior. Everything it specifies is
downstream of `model/forms.yaml`; if the two disagree, `forms.yaml` is
authoritative and this file must be corrected.

## Scope

One screen, one save action, matching `forms.yaml:new_case` exactly:

- Create one `cm_case` row.
- Create one `cm_case_participant` row (client role) linked to it.
- Create one `cm_case_lifecycle_event` row (opening event) linked to it.
- Optionally create one `cm_case_identifier` row linked to it.

Out of scope for this page (same exclusions as `forms.yaml:new_case`):
person creation/duplicate review, closing/reopening, assignments, billing,
payments.

## Data sources

Add these Dataverse tables as data sources in the Custom Page:

- `cm_case`
- `cm_case_participant`
- `cm_case_lifecycle_event`
- `cm_case_identifier`
- `cm_person` (for the existing-person picker; read-only lookup, no create)
- Reference tables backing each dropdown below (`cm_case_category`, `cm_case_status`,
  organization/office/jurisdiction/language reference tables, `cm_case_identifier_types`,
  `role` — the participant-role reference)

## Screen: `IntakeScreen`

One vertical form, top to bottom. Field list, control type, and source column
(logical name) below.

| Section | Label | Control | Bound column | Required | Notes |
| --- | --- | --- | --- | --- | --- |
| Case | County | Combo box (or Lookup control) | `cm_county_id` | No | Filtered active counties |
| Case | Case category | Drop down | `cm_case_category_id` | No | From `cm_case_category` |
| Case | Organization | Lookup | `cm_organization_id` | No | |
| Case | Office | Lookup | `cm_office_id` | No | Optionally filter by selected organization |
| Case | Jurisdiction | Drop down | `cm_jurisdiction_id` | No | |
| Case | Preferred language | Drop down | `cm_preferred_language_id` | No | |
| Participant | Person (existing) | Lookup (search, no "+ new") | `cm_person_id` on `cm_case_participant` | **Yes** | Must select an existing `cm_person`; this screen must not offer person creation (`forms.yaml` requirement: "Require an existing person...") |
| Participant | Participant role | Drop down, pre-filtered/defaulted to the configured client role | `cm_participant_role_id` on `cm_case_participant` | **Yes** | Role reference; client role only for this journey |
| Opening event | Opening status | Drop down | `cm_resulting_status_id` on `cm_case_lifecycle_event` | **Yes** | No default value — user must choose |
| Opening event | Effective date/time | Date/time picker | `cm_effective_at` on `cm_case_lifecycle_event` | **Yes** | No default value |
| Identifier (optional) | Identifier type | Drop down | `cm_identifier_type_id` on `cm_case_identifier` | No, but if any identifier field is filled all become required | From `cm_case_identifier_types` |
| Identifier (optional) | Issuer | Text input | `cm_issuer` | conditional | |
| Identifier (optional) | Value | Text input | `cm_value` | conditional | |
| Identifier (optional) | Primary indicator | Toggle | `cm_is_primary` | conditional | |

## Validation and prerequisites

This is an implementation recipe, not a paste-ready Power Fx formula. Resolve
Studio data-source/display names and lookup record types against the actual
app before writing formulas. Include `cm_county`, `cm_role`, `cm_user_account`
and `cm_case_lifecycle_event_types` in addition to the sources listed above.

Before enabling Save:

- Require an existing person, a configured client role, an allowed opening
  status and an explicit date **and time**. Combine the controls into one
  effective timestamp using the agreed time-zone convention; a date picker
  alone is insufficient. Backdating policy and reporting time zone remain open.
- Resolve exactly one authenticated user's `cm_user_account` and the configured
  opening event type. Block saving if either is missing or ambiguous. Synthetic
  fixture actors are not a mapping of the signed-in user.
- If any identifier input is supplied, require type, nonblank trimmed issuer
  and value, and a boolean primary indicator (false is valid).
- Validate organization/office compatibility when both are selected. Keep
  omitted optional values blank.
- Disable Save while saving and after an uncertain or partial failure. Repeat
  validation in the save action; button disabling alone is insufficient.
- Show a specific validation message without making any write.

Client checks do not establish server-side authorization or validation.

## Save action (`OnSelect` of `SaveButton`)

The canonical requirement is an atomic case, participant and opening-event
creation. Sequential `Patch` calls cannot satisfy that requirement. For this
bounded UI experiment, report atomicity as a known gap; do not mark the full
minimum-case acceptance scenario as passing merely because a happy path saves.
A future service operation must supply the transaction and trusted actor/time.

Implement the following sequence in Studio with formula-level error management
enabled. This is pseudocode; each write must have its own error boundary:

```text
validate all inputs and resolve configuration before writing
set saving = true; clear prior errors and saved-record variables
try create case and retain its returned ID
  include selected case fields and status_id = selected opening status
  initialize client_id from the selected person for this one-client intake
  initialize opened_on from the effective timestamp in the agreed reporting zone
  initialize external_reference only when the supplied identifier is primary
only on success, create participant using that case ID and effective timestamp
only on success, create opening event using that case ID, selected status,
  effective timestamp, recording timestamp, resolved actor, opening type,
  and sequence_number = 1
only on success, create the optional complete identifier
only when every required write succeeds, show confirmation
on any error, stop further writes and show the error and any returned case ID
always clear saving
```

Use nested success branches or sequential value/error pairs in `IfError`.
Wrapping a semicolon-separated chain in one error handler does not stop later
writes when an earlier write fails. See Microsoft's
[IfError chaining guidance](https://learn.microsoft.com/en-us/power-platform/power-fx/reference/function-iferror).
Capture `FirstError.Message` at the failing operation; do not navigate to
confirmation from a shared unconditional continuation.

Do not attempt compensating deletion of partially created records. Display
“Save incomplete” with a link to the returned case when available, preserve
entered values, and block automatic retry. A network timeout may have committed
without returning an ID, so even a first-write failure needs inspection before
retry. The comparison operator must reconcile synthetic records separately;
this page does not implement recovery or idempotent resubmission.

The initial case values above are explicit writes for this intake only, not
maintained projections. Later edits will not automatically synchronize them.
Client-supplied actor and recording time are also not trusted audit enforcement.
Both limitations must remain visible in the comparison results.

Before walkthroughs, exercise failure at each write, an uncertain timeout,
repeated Save clicks, missing actor/configuration, and date/time conversion.
Verify no later writes or success navigation occur after a failure. This
checks the UI behavior, not atomic rollback or runtime security.

## Confirmation screen

Read-only summary of the created case (case fields, participant, opening
event, identifier if present) with a link/button back to the case record —
satisfies `forms.yaml`'s "make the saved case available for viewing again."

## What this recipe deliberately does not specify

- Visual styling/branding — use whatever the Studio default theme provides;
  this comparison is about data-capture behavior, not visual design.
- The person-duplicate-review scenario (scenario 6) — out of scope for this
  page's `Patch` logic; it is a separate person-creation journey. Scenario 6 is
  not applicable to this existing-person intake and does not block its UI
  comparison.
