# Create-case operation contract

Status: draft, not implemented. This adds an operation contract without changing
entity keys or the existing YAML schema versions. It refines
[`forms.yaml:new_case`](forms.yaml) and the opening transition in
[`workflows.yaml`](workflows.yaml). Platform transport and storage bindings belong
under `implementations/`. Changes to the request/result shape must be reviewed
before clients are built against it.

## Request

Operation: `create_case`. Request shape version: `1` (proposed).

| Path | Type / source | Required |
| --- | --- | --- |
| `contract_version` | Integer; supported value 1 | Yes |
| `request_id` | Caller-generated UUID, reused for the same submission | Yes |
| `case` | Object containing only the case inputs below | Yes; may be empty |
| `case.county_id` | `case.county_id` | No |
| `case.case_category_id` | `case.case_category_id` | No |
| `case.organization_id` | `case.organization_id` | No |
| `case.office_id` | `case.office_id` | No |
| `case.jurisdiction_id` | `case.jurisdiction_id` | No |
| `case.preferred_language_id` | `case.preferred_language_id` | No |
| `participant.person_id` | `case_participant.person_id` | Yes |
| `participant.participant_role_id` | `case_participant.participant_role_id` | Yes |
| `opening.resulting_status_id` | `case_lifecycle_event.resulting_status_id` | Yes |
| `opening.effective_at` | `case_lifecycle_event.effective_at` | Yes |
| `identifier.identifier_type_id` | `case_identifier.identifier_type_id` | If identifier supplied |
| `identifier.issuer` | `case_identifier.issuer` | If identifier supplied |
| `identifier.value` | `case_identifier.value` | If identifier supplied |
| `identifier.is_primary` | `case_identifier.is_primary`; boolean false is valid | If identifier supplied |

Types, relationships and field constraints inherit from `schema.yaml`. Required
objects `participant` and `opening` must be present. Omitted optional values and
explicit null optional values mean the same thing. An absent/null identifier
means no identifier; an empty or partial identifier object is invalid. Unknown
properties are rejected, including caller-supplied entity IDs, actor, recording
time, sequence number or generated status/date compatibility fields.

`effective_at` uses an ISO 8601 timestamp with an explicit UTC offset, normalized
to UTC. Do not accept an ambiguous local timestamp or infer midnight. Trim issuer
and identifier value before validation/storage, reject empty results, and preserve
case and internal whitespace. No assumed defaults for status, effective time,
role or case context.

## Trusted context and validation

Authenticate and authorize the caller before revealing reference or request
existence. Resolve exactly one active application user-account mapping from the
trusted identity; zero or multiple mappings block creation. Never accept an actor
from the UI or use a fixture actor as the signed-in user's identity.

Validate that references exist and are selectable under configured policy, the
person is accessible to the caller, the role belongs to the participant context
and is configured for client intake, and the status is an allowed opening status.
Validate office/organization compatibility and backdating/time-zone policy.
Unresolved policy is configuration missing, not permission to guess defaults.
The resulting case must be readable by its authorized creator under the chosen
ownership/access policy. Do not elevate permissions based on client input.

## Atomic effects and result

In one transaction, generate stable IDs and create:

1. One case, with the supplied optional context.
2. One participant linked to that case/person/role, with `started_at` equal to
   the effective timestamp and no ending.
3. One opening event linked to the case, with sequence 1, the configured opening
   event type, supplied resulting status/effective timestamp, server recording
   timestamp and trusted actor. No close reason or correction target is supplied.
4. One identifier linked to the case, only when a complete identifier was supplied.
5. Durable deduplication/result evidence sufficient to resolve the request ID.

Initialize case `status_id` from the opening status, `opened_on` using the agreed
reporting time zone, `closed_on` to null, `client_id` to the selected person, and
`external_reference` to the supplied identifier value only if primary (else null).
These are initial writes, not a promise of ongoing projection synchronization.
Future participation/history operations remain responsible for their own behavior.

Any failure rolls back all effects, including a success receipt. History must be
protected against ordinary editing/deletion independently of native audit logging.
No assignments, person/profile creation, financial records or notifications occur.

Successful result:

| Field | Meaning |
| --- | --- |
| `request_id` | Original submission UUID |
| `outcome` | `created` or `replayed` |
| `case_id` | Created case UUID |
| `case_participant_id` | Created participant UUID |
| `case_lifecycle_event_id` | Created opening event UUID |
| `case_identifier_id` | Created identifier UUID or null |
| `recorded_at` | Original server recording timestamp, including on replay |

Transport adapters may add a navigation link; platform URLs are not part of the
canonical result. A replay returns original IDs rather than creating more records.

## Retry and outcome lookup

Proposed comparison policy: scope `request_id` by backend environment, operation
and authenticated caller. UI type is not part of the scope. Different callers
cannot inspect each other's requests. Recheck current authorization on lookup or
replay; possession of a request ID does not grant access to a case.

Retain successful request IDs and results for the lifetime of this prototype's
case data, with no automatic expiry. A deliberate synthetic reset can clear both
case data and request evidence. Production retention/erasure policy remains open.
Store only the minimum protected request fingerprint/result needed for replay;
request payloads must not appear in ordinary logs.

Define normalized equality from the validated input: supported version, UUIDs in
canonical form, timestamps as UTC instants, sorted object keys, trimmed identifier
strings, explicit boolean values and omitted/null optional equivalence. Compare
the normalized request, not JSON text or UI formatting. The request ID itself,
transport metadata and trusted context are not payload fields in the fingerprint.

For an existing successful key, identical normalized content returns the original
result; different content returns `request_conflict`. Concurrent submissions must
use a database uniqueness/transaction mechanism, not a check-then-create query.
An authorized replay remains a replay if selectable reference policy changed since
the original commit; do not rerun creation or revise historical facts.

`get_create_case_outcome` accepts version and request ID under the same trusted
caller scope. Return `completed` with original result, or `not_observed` when no
committed receipt is visible. `not_observed` is not evidence that an in-flight
request cannot commit. Retry only the same ID and payload while resolving an
uncertain outcome; never silently generate a replacement ID. Rejected requests
with no committed effects may be corrected and resubmitted under the same ID.

## Error contract

Return a stable code, safe user-readable message, optional field path from the
request table, and a diagnostic correlation ID. Do not return database details,
stack traces or inaccessible record identifiers. Transport status mapping is an
implementation concern.

| Code | Meaning / client behavior |
| --- | --- |
| `invalid_request` | Malformed shape/version/value; correct before submitting |
| `validation_failed` | Domain/reference constraint failed; identify an accessible input |
| `not_authorized` | Caller or record access denied; no effects |
| `configuration_missing` | Actor mapping or required policy/configuration unavailable |
| `request_conflict` | Previously committed key has different content; inspect original outcome |
| `temporarily_unavailable` | Server could not complete; retry same ID/payload |

A connection loss/timeout is an unknown outcome at the client, not a definitive
server rejection. Keep entered values and request ID, disable duplicate clicks,
and resolve the outcome before offering a new attempt. Never show success solely
because the case header was created.

## Decisions before enabling writes

- Allowed opening states and client-role reference mapping.
- Permitted effective dates, including backdating/future dating, and reporting zone.
- Authenticated identity mapping, intake privileges, ownership and read scope.
- Whether an office with no organization can accompany a selected organization.
- Selectability of inactive references and case categories for new intake.

No organization-specific defaults are established here. The retry policy above is
a proposed engineering contract for the comparison; its runtime mechanism still
requires concurrency and failure testing.
