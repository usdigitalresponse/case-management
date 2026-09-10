# Dataverse prototype

The existing **Case Intake Prototype** app and `CaseIntakePrototype` unmanaged
Solution are extended in place for a **0.2 synthetic model review**. The canonical
schema, rules and scenarios remain authoritative. This is a development prototype,
not a production platform decision or full workflow implementation.

## Current review slice

`prepare_review.py` reads the canonical schema and the shared synthetic fixture.
It prepares a local, bounded review package for the provisioning tool: 39 domain
tables, 26 reference tables, and 78 synthetic rows. It is not a general platform
migration framework or a canonical reference-data generator.

The app exposes populated domain tables through standard lists and forms. Review
form controls are disabled; related-record navigation exposes child relationships.
Form-level disabling is a usability boundary, **not server-side security**.
Administrators and API writers can still change records. Do not use this slice to
claim intake, approval, closure or permission scenarios pass end to end.

The temporary review-only write guard was disabled in the development environment
on 2026-09-10: all 299 registered steps were verified disabled. Its assembly and
step registrations remain for reversibility; its source is shelved. A future
Solution export may therefore include these disabled components. Review them
before copying exports into Git or importing an older package that could
re-enable the guard. This change does not enable form controls, remove earlier
command-hiding customizations, or implement domain workflow enforcement.

No payment execution is implemented. `payment` contains external completion
evidence only. Synthetic user-account records represent fixture actors and are
not provisioned logins, native security principals or impersonation.

## Mapping

| Canonical concept | Review mapping |
| --- | --- |
| Domain entity/key | `cm_` plus entity key; native primary UUID retains fixture ID |
| Stable field key | `cm_` plus field key; primary UUID uses the native primary key |
| UUID relationship | Lookup to the mapped entity, with restricted delete and no ownership/sharing cascade |
| Reference data | Organization-owned lookup tables; old `cm_case_status` and `cm_case_category` names are retained |
| Other domain tables | User/team owned, except organization-owned county and role |
| Source date | Date Only with Date Only behavior |
| Timestamp | Date And Time, User Local behavior; API values retain UTC instants |
| Money/decimal | Decimal with four fractional digits and range 0–100,000,000,000; request currency is explicit text, no exchange or payment processing |
| Integer | Nonnegative whole number |
| Object / long narrative | Memo; snapshots are serialized JSON, maximum 1,048,576 characters |
| Other string / nonrelationship UUID | Text, maximum 200 characters |
| Primary name | Human-readable fixture label; operational source fields retain their own keys |
| Assignment native Active/Inactive | Materialized from ending intervals at the fixture as-of instant; native state is not the authoritative assignment history |
| Case/request status, dates, external reference, current client, professional display/office | Plain fields in the canonical model; this review's values are computed once by `prepare_review.py` from lifecycle/participant/affiliation history, not maintained by any runtime rule — see "Deferred: fields that should become read models" in `model/README.md` |
| `audit_event` | Explicit domain table plus native auditing; empty in the sample; native import provenance is separate from synthetic event actors |

Optional fields omitted in the shared source fixture remain absent, including the
external completion amount/date. Required metadata uses Business Required and is
not an API-level guarantee. Historical decisions/snapshots are physically separate
records, but runtime immutability has not been implemented.

Legacy client name columns and older sample records are not deleted. Mapped
requiredness is synchronized for the current person/profile relationships.
Unused legacy data does not require conversion. Unmapped columns are left alone. The seed operation writes only
the UUIDs in its prepared synthetic package and does not reset other records.

## Prepare, check, deploy and seed

Requirements: .NET 10, Python 3.9+ with PyYAML 6.x, and an English-base Dataverse
development environment. See [offline test dependencies](../../tests/README.md).
Set `DATAVERSE_URL` to the intended environment origin in your local shell, not in
repository files. The protected sign-in cache and device-code flow are unchanged.

From the repository root:

```sh
python3 -B -m unittest discover -s tests -v
python3 -B implementations/dataverse/prepare_review.py /tmp/case-review.json
dotnet build implementations/dataverse/Provision/Provision.csproj
dotnet run --no-build --project implementations/dataverse/Provision -- --check-review /tmp/case-review.json
dotnet run --no-build --project implementations/dataverse/Provision -- inspect "$DATAVERSE_URL"
dotnet run --no-build --project implementations/dataverse/Provision -- deploy-review "$DATAVERSE_URL" /tmp/case-review.json
```

Use the [Solution source workflow](SOLUTION.md) for command customizations and
subsequent maker changes.

Before deployment, inspect the environment's existing apps in `make.powerapps.com`
as well. Reuse the existing app; do not create a parallel troubleshooting copy.
`deploy-review` adds missing schema and lookups, updates app navigation,
publishes, seeds, and verifies. It retains Unified Interface (`clienttype = 4`).
It can resume a partial deployment. Changes are incremental, not one
transaction. It does not grant security roles or change account permissions;
auditing is enabled if needed.

Existing main forms retain their identities, layouts, scripts and controls.
When the schema adds a field, deployment appends only missing fields in an
**Additional schema fields** tab. It does not delete or regenerate a form.
Unmapped maker columns retain their requiredness. Views remain maker-owned;
update them in the designer or unpacked Solution source when their columns change.
An app update failure stops deployment without deleting the app.

For seed-only or read-only verification after schema deployment:

```sh
dotnet run --no-build --project implementations/dataverse/Provision -- seed-review "$DATAVERSE_URL" /tmp/case-review.json
dotnet run --no-build --project implementations/dataverse/Provision -- verify-review "$DATAVERSE_URL" /tmp/case-review.json
```

## Resetting the review environment

`deploy-review` is additive only — it never deletes a table, column or
relationship, so a schema revision that renames or removes an entity (for
example, an earlier `client` table or an old role reference table) leaves the
previous version's metadata behind. A leftover relationship can then collide
with a same-named new one and block the next `deploy-review`.

`reset-review` clears that by deleting **every** `cm_`-prefixed custom table
(and therefore all of its records) and relationship in the target environment,
then runs the normal `deploy-review` sequence to rebuild and reseed from
nothing:

```sh
dotnet run --no-build --project implementations/dataverse/Provision -- reset-review "$DATAVERSE_URL" /tmp/case-review.json
```

This is **irreversible** and is not scoped to the current review package — it
removes any `cm_`-prefixed table in the environment, including the 0.1
baseline's tables and anything left over from a prior schema revision. Only
run it against a disposable development environment you are prepared to lose
entirely, never anything with real or shared data. Before it deletes anything
it prints every table it found with a best-effort record count and requires
two separate typed confirmations — the exact organization name, then a random
one-time code it generates on the spot — so it cannot be triggered by a
pasted command, a stray keypress, or a scripted/non-interactive run.

Seeding uses two passes: create/update scalar values, then bind relationships.
This supports cycles and stable IDs but is **not atomic**. It is suitable only for
this disposable synthetic review dataset. Rerunning resets included fields at
fixture IDs, including snapshots, to the package values; do not edit these sample
rows expecting them to survive reseeding. Read verification compares every
packaged value and foreign key with live rows, including unknown date/amount.

The original `deploy`, `smoke`, `verify`, `--check` and guided setup are the 0.1
intake baseline; use the explicit review commands for 0.2. Original offline
checks remain useful regression coverage for that baseline. Run setup tests with:

```sh
dotnet run --project implementations/dataverse/SetupTests/SetupTests.csproj
```

## Remaining workflow gaps

- Atomic new-case creation with person participation and opening event.
- Server-side closure ending all active assignment roles and rejecting concurrent
  assignment creation; fixture ending timestamps alone do not establish this.
- Recalculation of projections after edits; access and workload effects.
- Immutable lifecycle, review, attestation and document evidence across all writers.
- Approval routing, identity authorization, duplicate detection and qualified
  assignment rules; synthetic actor IDs are not authentication.
- Atomic authorization balances and concurrency; correct sample totals are not
  financial enforcement.
- Permission-filtered timeline UI, secure document storage and electronic signatures.
- Native-user mapping, ordinary-user roles, and alternate/custom web write paths.

Next workflow work should implement these using supported Dataverse capabilities
and Solution tooling, with shared scenarios and server-side checks. Avoid growing
this review bootstrap into an application backend.

## Packaging

The privacy-reviewed unpacked [Solution source](Solution) captures the actual
app, forms, views, relationships and command customizations. Use `pac solution
export` and `pac solution unpack` to capture subsequent maker changes.
Keep raw exports, connection details and logs under ignored `artifacts/` or outside
the repository. Review unpacked content for private environment metadata before
adding any Solution source to Git. The canonical YAML remains the requirements
source; Solution source captures the actual Power Platform implementation. See
[SOLUTION.md](SOLUTION.md) for the supported build and maintenance commands.
See [deployment guidance](../../docs/deployment.md).

## Microsoft references

- [Table relationships through the Web API](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/create-update-entity-relationships-using-web-api)
- [Create table definitions](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/create-update-entity-definitions-using-web-api)
- [Solution commands](https://learn.microsoft.com/en-us/power-platform/developer/cli/reference/solution)
