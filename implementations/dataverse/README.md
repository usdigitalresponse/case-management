# Dataverse case intake prototype

This implementation evaluates the case intake slice in `model/forms.yaml`.
The canonical schema and rules remain in `model/`; this is not a production
platform decision. Use only synthetic data in a development environment.

See [deployment to another environment](../../docs/deployment.md) and the
[architecture assessment](../../docs/architecture-assessment.md).

## Contents and mapping

The unmanaged solution is `CaseIntakePrototype`, with publisher `caseprototype`
and prefix `cm`. The model-driven app is **Case Intake Prototype**.

| Canonical artifact | Dataverse mapping |
| --- | --- |
| `client` | Custom user/team-owned table `cm_client` |
| `case` | Custom user/team-owned table `cm_case` |
| `county` | Custom organization-owned table `cm_county` |
| `case_categories` | Custom organization-owned reference table `cm_case_category` |
| `case_statuses` | Custom organization-owned reference table `cm_case_status` |
| Entity UUID | Native generated primary key, such as `cm_caseid` |
| Non-reference fields | `cm_` plus the canonical field key |
| `county.display_name` | Primary name column `cm_name` |
| Four case references | Lookup columns retaining canonical field keys, such as `cm_client_id` |
| Canonical date | Date Only column with Date Only behavior, without time-zone conversion |
| Required field | Dataverse Business Required (`ApplicationRequired`) metadata |
| `audit_event` | Native Dataverse auditing; no custom audit table in this slice |

Strings currently have a 200-character implementation limit. Reference deletes
are restricted while referenced by a case; sharing, reparenting, and assignment
do not cascade. Native Active/Inactive record state is separate from the case's
configurable `cm_status_id` lookup.

Dataverse requires primary display columns. Case `cm_name` is an implementation
autonumber (`CASE-{SEQNUM:6}`), separate from the canonical UUID and optional
external reference. Client `cm_name` is a display label populated for fixtures;
the separate given/middle/family name fields remain authoritative. Reference
tables use `cm_name` and `cm_active`; those reference-table structures are
implementation scaffolding pending a canonical reference-data specification.

## First form

The **New case** main form shows the generated case number read-only, followed
by client, case status, external reference, county, case category, and opened
date. Client and status are required. Status and opened date have no default.
Closed date exists in the table but is excluded from this intake form.

The app navigation exposes a Cases list. Supporting tables have simple main
forms for prototype administration and lookup navigation. The intended intake
path selects an existing client. Client creation, duplicate-client review,
closure, assignments, and billing are outside this slice.

Fixtures consist of two synthetic clients and one record each labeled
`Synthetic County A`, `Sample Category A`, and `Sample Intake`. These are demo
values, not approved workflow or jurisdiction configuration. Reruns preserve
existing records rather than overwriting their values.

## Run

For guided setup, double-click `setup.command` (Mac) or `setup.cmd` (Windows) in
the repository root. It explains how to find your environment information and
handles the build, sign-in, target confirmation, and deployment/verification.
See [guided setup](../../docs/deployment.md#guided-setup-recommended) for details.

Prerequisites: .NET 10, network access to NuGet and Microsoft, an English-base
Dataverse development environment, and an account with sufficient customization
and auditing privileges. Power Platform CLI is useful for solution export; its
authentication profile is separate from this tool's API session.

From the repository root:

```sh
dotnet build implementations/dataverse/Provision/Provision.csproj
dotnet run --no-build --project implementations/dataverse/Provision -- --check
dotnet run --no-build --project implementations/dataverse/Provision -- inspect "$DATAVERSE_URL"
dotnet run --no-build --project implementations/dataverse/Provision -- deploy "$DATAVERSE_URL"
dotnet run --no-build --project implementations/dataverse/Provision -- verify "$DATAVERSE_URL"
dotnet run --no-build --project implementations/dataverse/Provision -- smoke "$DATAVERSE_URL"
```

Set `DATAVERSE_URL` only in your local shell to the environment origin, without
an API path. Never commit environment URLs, tenant details, credentials, exports,
or deployment logs. On Homebrew installations, .NET tools may also require
`DOTNET_ROOT` to point to Homebrew's `dotnet/libexec` directory.

The tool uses Microsoft device-code sign-in. The default public application ID
is Microsoft's documented development example client; set `DATAVERSE_CLIENT_ID`
to use a tenant-owned public client with Dataverse delegated permissions. It does
not accept passwords or client secrets. Tokens are cached with Microsoft's MSAL
extension using macOS Keychain or Windows protected storage. On other systems,
the cache is in memory only. There is no plaintext-cache fallback.

`upgrade-client` updates the existing app's client setting to Unified Interface
(`clienttype = 4`), publishes it, republishes all customizations to clear the
UCI manifest cache, then runs verification. Use it to repair the legacy web
client warning without rebuilding forms. `verify` rejects legacy client
settings; `deploy` explicitly selects Unified Interface. If the browser
warning persists after `upgrade-client` reports success, it is a client-side
cache issue, not a server-side setting; try a private/incognito window against
the app URL.

`inspect` and `verify` read environment data. `deploy` creates missing prototype
components, updates prototype main forms, enables environment auditing if needed,
seeds synthetic records, and publishes the prototype tables and app. Enabling
environment auditing also activates auditing for any other tables already marked
for auditing. No security roles are assigned or expanded by the tool.

Deployment is incremental, not transactional. A failure can leave some components
created; inspect the error and rerun after correction. Do not point the bootstrap
at an environment with unrelated `cm_*` tables. Rerunning `deploy` replaces the
prototype main form layout; preserve any maker edits before doing so. It is not
a general schema-migration tool.

`smoke` creates two synthetic cases with fixed fixture UUIDs, updates the complete
case once, rereads their values and relationships, checks client reuse, and reads
audit entries. It leaves those cases available for inspection and never deletes
records. Reruns only verify existing fixture cases; they do not overwrite edits.
Run this only against the intended prototype development environment.

## Gaps and validation

- Business Required metadata enforces required fields in model-driven forms;
  it is not a server-side guarantee for API/import writes. A server-side rule or
  plug-in remains necessary before exposing alternate write paths.
- No ordinary-user intake role or assignment-derived access is implemented.
  This initial app is for authorized administrators/customizers; do not broadly
  share it until roles and permitted actions are defined and tested.
- Native audit history approximates the canonical event model. Event naming,
  retention, administrator deletion, and access by ordinary users need explicit
  policy and acceptance testing. Creation/modification columns alone are not
  treated as sufficient audit history.
- Creating clients from supporting administration forms does not yet implement
  the duplicate warning rule. Use seeded clients for the intake demonstration.
- The reference lifecycle, active-only lookup filtering, default status, status
  transitions, and client display-label maintenance remain unresolved.
- `--check` validates generated form XML and the intake field mapping offline.
  `verify` checks deployed field requiredness, table auditing, and app dependency
  validation. Those checks do not replace the UI acceptance scenarios in
  `scenarios/new-case.md`.

## Verification of the initial baseline

- Build completed without warnings or errors; offline form checks passed.
- All model YAML files parsed; the intake form references existing case fields
  and includes every required, non-generated case field.
- Live metadata checks passed, and Dataverse app validation returned success
  with no validation issues.
- Two synthetic cases were created and reread through the API. Minimum and
  complete values persisted; both referenced one existing client; client count
  did not change. Creation/update audit entries included actor and timestamp.
- The unmanaged Solution exported and unpacked successfully with `pac`.
- Full interactive form testing, required-field error messages, ordinary-user
  access, and a second-environment deployment have not been verified. Browser
  verification did not get past Microsoft sign-in in the available browser.

The wizard's offline interaction tests can be run with:

```sh
dotnet run --project implementations/dataverse/SetupTests/SetupTests.csproj
```

They use synthetic input and a fake provisioning runner. They test URL handling,
confirmation/cancellation, existing-installation defaults, and failure handling
without signing in or changing any environment.

## Microsoft references

- [Create table definitions through the Web API](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/create-update-entity-definitions-using-web-api)
- [Create table relationships](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/create-update-entity-relationships-using-web-api)
- [Create and publish model-driven apps](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/create-manage-model-driven-apps-using-code)
- [Protected MSAL token caching](https://learn.microsoft.com/en-us/entra/msal/dotnet/how-to/token-cache-serialization)
