# Deploying the case intake prototype

The current prototype targets an English-base Dataverse development environment.
The production architecture is not selected. Use synthetic data only.

## 0.2 synthetic review deployment

For the expanded model and shared synthetic data, follow the
[current implementation commands](../implementations/dataverse/README.md#prepare-check-deploy-and-seed).
Use `prepare_review.py`, `deploy-review`, `seed-review` and `verify-review`.
The review uses the existing app/Solution and adds related tables; it is not yet
an operational workflow implementation. Fields are displayed read-only for review;
this is a usability boundary, not server-side enforcement. See
[Solution maintenance](../implementations/dataverse/SOLUTION.md).
The older guided setup does not deploy this slice and cannot overwrite it.

The original five-table bootstrap and guided setup documentation below describes
the 0.1 baseline. Use it only when specifically evaluating that earlier slice.

## Current status

The bootstrap has been exercised in the initial development environment. It
creates the `CaseIntakePrototype` unmanaged Solution, five custom tables, forms,
views, a model-driven app, and synthetic reference/client records. Read the
[mapping and limitations](../implementations/dataverse/README.md) before running it.

Export with `pac solution export` and extraction with `pac solution unpack`
have also succeeded. A clean second-environment installation and a Solution
import into another environment have **not yet been verified**. The procedures
below distinguish the current bootstrap from the intended Solution-based
deployment path.

## Prerequisites

- A compatible development environment with a provisioned Dataverse database
  and English base language (1033).
- A Microsoft account with environment access, sufficient customization
  privileges, and privileges to configure auditing. App users also need the
  applicable Power Apps licensing and Dataverse privileges.
- .NET 10 for the current bootstrap and Microsoft Power Platform CLI (`pac`)
  for Solution export/import.
- No unrelated tables using the prototype's `cm_*` names. Do not run this
  bootstrap against a production environment or use it to migrate existing data.

The baseline export declares dependencies on Microsoft's **AppModuleWebResources
(2.5)** package for the default app icon and **PowerAppsAppFramework_Anchor
(1.0.0.25)** for the AppChannel setting. Confirm compatible platform packages in
the destination; do not bypass dependency validation. These are platform
dependencies, not tenant-specific configuration or partner data.

Set environment addresses in the local shell; do not put them in Git. Keep
authentication profiles, tokens, logs, raw exports, and tenant-specific settings
outside version control.

## Guided setup (recommended)

Download or clone this repository, extract it if needed, and open its folder.
On **Mac**, double-click `setup.command`. On **Windows**, double-click `setup.cmd`.
On Linux, run `sh setup.command` from the repository folder. If your device's
security policy blocks scripts, ask your administrator for help; do not bypass it.

The launcher checks for the .NET 10 SDK. If it is missing, it displays Microsoft's
download address and tells you which installer to choose. Install the SDK, then
reopen the launcher. The launcher builds the tool, which requires access to NuGet;
it does not install software or request administrator privileges automatically.

The wizard then walks you through:

1. Finding **Power Apps → environment selector → Settings → Developer resources**
   and copying the Web API endpoint. It also explains the admin-center alternative.
2. Pasting that endpoint or the environment URL. The wizard validates it and
   converts API endpoints to the environment origin for you.
3. Choosing Microsoft's development sign-in application, or entering an
   administrator-provided Application (client) ID. It explains where that ID is
   found in Microsoft Entra and distinguishes it from the Object ID.
4. Completing Microsoft sign-in and checking the returned environment name.
5. Confirming setup in the intended development environment. If the prototype
   already exists, the default is read-only verification. Explicit `REBUILD`
   resumes prototype configuration and adds missing fields while preserving existing forms.
6. Opening the app link and trying a synthetic case.

You do not need to set shell variables or edit configuration files for this path.
The wizard asks for values each time and passes them only to its child process;
it does not save them in the repository. Choosing the default sign-in application
also overrides any custom application ID inherited from your terminal.
Microsoft sign-in tokens continue to use the protected local cache described in
the implementation README. The wizard currently supports commercial-cloud
Dataverse addresses (`crm[number].dynamics.com`); other clouds need separate
authentication support.

This wizard wraps the current bootstrap, not the future Solution import-only
deployment path. It checks database access and base language before asking to
deploy; it does not prove that every customization privilege is present or create
an environment/database for you. A clean second-environment installation remains
unverified.

For developers, the same wizard can be started after building with:

```sh
dotnet run --no-build --project implementations/dataverse/Provision -- setup
```

The manual variable-based commands below remain available for troubleshooting
and automation.

## Set your local environment variables

In Power Apps, select your own development environment and find its environment
URL in the environment details or Developer resources. Use the HTTPS environment
origin, such as `https://your-org.crm.dynamics.com`, without `/main.aspx` or an
`/api/data/...` suffix. Region-specific hostnames may differ; use your actual URL.

In a macOS/Linux terminal using zsh or bash, replace the example address and run:

```sh
export DATAVERSE_URL='https://your-org.crm.dynamics.com'
```

In PowerShell, the equivalent is:

```powershell
$env:DATAVERSE_URL = 'https://your-org.crm.dynamics.com'
```

Run the build/deployment commands below in that same terminal. Variables set this
way last for that shell session; set them again in a new terminal. The provisioning
tool receives the URL as a command argument, for example `inspect "$DATAVERSE_URL"`
in zsh/bash or `inspect "$env:DATAVERSE_URL"` in PowerShell.

The application ID override is optional. The bootstrap defaults to Microsoft's
documented example client for development. If your administrator supplies a
tenant-owned public client configured for device-code sign-in with Dataverse
delegated permissions, set its Application (client) ID:

```sh
export DATAVERSE_CLIENT_ID='your-application-client-id'
```

Or in PowerShell:

```powershell
$env:DATAVERSE_CLIENT_ID = 'your-application-client-id'
```

Omit this variable to use the development default. No password, token, client
secret, or tenant ID is required in these variables; complete the Microsoft
sign-in prompt when it appears.

For Solution transport between two environments, also set the following with
your own source and destination addresses before using that section's commands:

```sh
export DATAVERSE_SOURCE_URL='https://your-source-org.crm.dynamics.com'
export DATAVERSE_TARGET_URL='https://your-target-org.crm.dynamics.com'
```

In PowerShell:

```powershell
$env:DATAVERSE_SOURCE_URL = 'https://your-source-org.crm.dynamics.com'
$env:DATAVERSE_TARGET_URL = 'https://your-target-org.crm.dynamics.com'
```

The command blocks below use zsh/bash syntax. In PowerShell, use `$env:NAME`
instead of `$NAME`, and put multiline commands on one line or use PowerShell's
backtick continuation instead of a backslash.

These shell variables are local deployment configuration, not Dataverse Solution
environment-variable components. The repository does not automatically load `.env`
files. You do not need to create one; `.env` and `.env.*` are ignored as a precaution.
Never replace the placeholders in this document with actual tenant values.

## Bootstrap into a new development environment

1. Set `DATAVERSE_URL` locally to the new environment's HTTPS origin, without
   `/api/data/v9.2`. Check the environment in the Power Apps environment selector.
2. From the repository root, compile and perform the offline checks:

   ```sh
   dotnet build implementations/dataverse/Provision/Provision.csproj
   dotnet run --no-build --project implementations/dataverse/Provision -- --check
   ```

3. Inspect the target. Complete Microsoft device sign-in when prompted:

   ```sh
   dotnet run --no-build --project implementations/dataverse/Provision -- inspect "$DATAVERSE_URL"
   ```

4. Deploy the prototype:

   ```sh
   dotnet run --no-build --project implementations/dataverse/Provision -- deploy "$DATAVERSE_URL"
   ```

   This also enables environment auditing if it is disabled, which activates
   auditing for other tables already marked for auditing. It does not assign
   security roles. Deployment is incremental; inspect errors before resuming.
   A rerun preserves existing form layouts and adds missing fields. Export maker
   edits before further Solution customization.

5. Verify the metadata and run the synthetic data checks:

   ```sh
   dotnet run --no-build --project implementations/dataverse/Provision -- verify "$DATAVERSE_URL"
   dotnet run --no-build --project implementations/dataverse/Provision -- smoke "$DATAVERSE_URL"
   ```

   If an earlier installation displays the legacy web client warning, run
   `dotnet run --no-build --project implementations/dataverse/Provision -- upgrade-client "$DATAVERSE_URL"`.
   This sets and publishes Unified Interface for the existing app, republishes
   all customizations, then verifies the setting server-side. It does not
   replace forms or modify case records. New deployments explicitly select
   Unified Interface.

   The browser can keep showing this warning after `upgrade-client` reports
   success and verification passes; closing and reopening the browser is not
   enough to clear it. Confirm in a private/incognito window first. If the
   warning is gone there, it is a stale browser cache of the old app manifest,
   not a server-side problem — clear site data/cookies for the `*.dynamics.com`
   origin in the regular browser profile rather than re-running provisioning
   or standing up a replacement app.

   `smoke` leaves two synthetic cases for review. It does not delete data or
   overwrite existing fixture cases. Run [the UI scenarios](../scenarios/new-case.md)
   separately, including missing required fields and access with an ordinary role.

6. In Power Apps, select the target environment and open
   **Apps → Case Intake Prototype**. The components are also under
   **Solutions → Case Intake Prototype**. Start with an authorized administrator;
   ordinary-user intake roles still need to be specified and configured.

## Solution-based transport

This is the supported direction for repeatable packaging. It is a procedure for
the next deployment validation, not a claim that a second-environment import has
already passed. See the [incremental plan](architecture-assessment.md).

Set `DATAVERSE_SOURCE_URL` and `DATAVERSE_TARGET_URL` locally and use explicit
environment arguments so changing the active authentication profile cannot silently
redirect a deployment. Keep the source developer environment unmanaged. For
another editable development environment, an unmanaged export is appropriate:

```sh
mkdir -p implementations/dataverse/artifacts
pac auth create --name intake-source --environment "$DATAVERSE_SOURCE_URL" --deviceCode
pac solution export --environment "$DATAVERSE_SOURCE_URL" \
  --name CaseIntakePrototype \
  --path implementations/dataverse/artifacts/CaseIntakePrototype.zip

pac auth create --name intake-target --environment "$DATAVERSE_TARGET_URL" --deviceCode
pac env who --environment "$DATAVERSE_TARGET_URL"
pac solution import --environment "$DATAVERSE_TARGET_URL" \
  --path implementations/dataverse/artifacts/CaseIntakePrototype.zip \
  --publish-changes
```

For downstream test/release environments, plan to export a managed artifact from
the unmanaged source and test its install/upgrade behavior. Do not treat changing
the package type of an existing installation as a routine reinstall. Avoid force
overwrite and dependency-check bypasses.

Solution import transports the included component definitions. Separately handle:

- synthetic or partner-approved reference records and client fixtures;
- environment-level auditing and retention configuration;
- user provisioning, security-role assignments, and app access;
- future environment-variable values and connection-reference bindings.

For the 0.2 review, `seed-review` restores the prepared synthetic package after
Solution import without rebuilding schema or forms. Do not run the full
bootstrap merely to seed data. The 0.1 baseline does not support this route.

There are currently no flows or external connections requiring connection
references. Introduce them with the relevant integration, and use
`pac solution create-settings` plus `pac solution import --settings-file` for
environment-specific bindings when applicable.

## Source control and completion criteria

The privacy-reviewed source is now under `implementations/dataverse/Solution`.
Capture subsequent changes with `pac solution export` and `pac solution unpack`,
then validate the rebuild with `pac solution pack`. Preserve
component identities and maker changes. Raw exports can contain environment
metadata; review them before adding any representation to Git.

A deployment is verified only after the app opens in the target, all shared
intake scenarios are recorded, reference records and access work, and the
remaining manual steps are documented. Exporting successfully alone does not
prove installation into a clean environment.

References: [Power Platform CLI Solution commands](https://learn.microsoft.com/en-us/power-platform/developer/cli/reference/solution),
[Solution concepts](https://learn.microsoft.com/en-us/power-platform/alm/solution-concepts-alm).
