# Agent Instructions

Guidance for coding agents and other automated tools working in this repository.

## Project purpose

This repository currently begins as a generic, implementation-neutral prototype
specification for public-sector case management and billing. The canonical model
should initially be usable as the basis for multiple implementations, including
Airtable, Dataverse, and a conventional cloud-hosted application. As the project
develops and its technical direction is validated, the prototype may adopt a
specific technology stack and evolve into a stack-specific implementation.

The durable artifact is the shared specification, not any one platform-specific
prototype. Do not let the constraints or conveniences of an implementation
platform silently redefine the domain model.

## Current phase

The repository is at an early design and prototyping stage. The current
prototyping direction is Power Platform: Dataverse, Solutions, and model-driven
apps using standard forms and views by default. Preserve enough separation for
a future fully custom web implementation of the same shared specification.

Use supported Microsoft capabilities and `pac`/Solution tooling for packaging
and deployment. Introduce Custom Pages, PCF, flows, environment variables, and
connection references when the workflow or integration needs them. Do not build
custom CRUD interfaces or speculative portability infrastructure. See
`docs/architecture-assessment.md` for the assessment and incremental plan.

Do not select a production platform, framework, database, or cloud architecture
unless the user explicitly asks for that decision.

## Source of truth

As the repository develops, treat these locations as authoritative:

- `model/` for the platform-neutral schema, rules, forms, workflows, and
  reference-data definitions.
- `scenarios/` for platform-neutral acceptance scenarios.
- `implementations/` for platform-specific mappings, code, and documented gaps.
- `docs/` and `README.md` for human-readable context and decisions.

When a change affects more than one of these artifacts, update all affected
artifacts together. Do not resolve a disagreement by quietly changing only an
implementation.

If an authoritative location does not exist yet, create it only when needed for
the requested work. Do not scaffold speculative files or directories.

## Data and privacy

This is a generic prototype. Do not add organization-specific, confidential, or
personally identifying information to this repository.

In particular, do not add:

- organization, agency, employee, stakeholder, client, attorney, or vendor names;
- real state, county, court, office, or jurisdiction names;
- organization-specific legal citations, policy names, or internal terminology;
- names of incumbent internal systems;
- real account, funding, payment, case, or vendor codes;
- real workload thresholds or other organization-specific configuration values;
- source research, interview notes, or verbatim user-story text that could reveal
  the organization or people involved.

Use generic terminology, synthetic examples, and configurable reference data.
Represent organization-specific requirements as general capabilities or
configurable rules whenever possible.

Do not copy private research or source documents into code, comments, fixtures,
documentation, agent instructions, commit messages, or test data. If private
context is needed to explain a generic requirement, preserve only the resulting
generic requirement in the repository.

## Modeling principles

- Keep the canonical schema independent of Airtable, Dataverse, AWS, or any
  other implementation technology.
- Separate entity structure, business rules, workflows, forms, reference data,
  and acceptance scenarios rather than burying them in prose or platform code.
- Preserve audit history for important state, assignment, and financial changes.
- Prefer validation at data entry over downstream cleanup.
- Do not silently merge probable duplicate records.
- Do not overwrite historical facts when requirements call for an audit trail.
- Make workflow transitions explicit, including actor, timestamp, and required
  information where applicable.
- Derive access from defined roles or active assignments; do not assume broad
  access by default.
- Document every platform-specific compromise, approximation, or unenforceable
  requirement in that implementation's mapping or notes.
- Use shared acceptance scenarios to compare implementations consistently.

## Working practices

Before changing files:

1. Read this file and the relevant existing documentation and specifications.
2. Inspect the working tree and preserve unrelated user changes.
3. Identify which artifact is authoritative for the requested change.
4. Before provisioning a new Dataverse app, solution, or table as a fix, run
   `inspect` (or `pac model list`) and check the target environment in
   `make.powerapps.com` for an existing app or an earlier troubleshooting
   attempt with a similar name. Prefer repairing the existing app over
   creating a parallel one; duplicate apps from separate sessions are hard to
   reconcile later and the user has to notice and remove them manually.

While working:

- Keep changes scoped to the user's request.
- Prefer clear, conventional formats and the smallest useful abstraction.
- Add comments only when they explain necessary context that the code or
  specification cannot express clearly on its own. Keep comments concise,
  current, and free of redundant narration or project bloat.
- Do not introduce dependencies or infrastructure without a concrete need.
- Do not invent domain facts that are absent from the repository or the user's
  instructions. Mark unresolved decisions clearly.
- Update documentation when behavior, structure, commands, or architectural
  decisions change. Stale documentation is a defect.
- Keep model `spec_version` values unchanged until the initial model has been
  pushed; then follow the versioning convention in `model/README.md`.

Before handing work back:

1. Review the diff for accidental sensitive or organization-specific content.
2. Run the relevant formatting, validation, and tests that exist for the files
   changed.
3. Report what changed, what was verified, and any unresolved decisions or gaps.
4. Update this file if the change introduces a durable command, invariant,
   directory boundary, or working convention that future agents must know.

## Git workflow

- Never push commits or branches to a remote. All pushes are performed manually
  by the user.
- Do not create pull requests or otherwise publish repository changes.
- Do not commit unless the user explicitly asks for a commit.
- Leave completed changes in the working tree for user review.
- Do not discard, overwrite, or rewrite user-authored changes.
- Do not use destructive Git commands unless the user explicitly requests the
  exact operation.
- If asked to suggest a commit message, use a concise Conventional Commits-style
  message such as `docs: add project agent instructions`.

## Commands

The initial Dataverse prototype and its mapping live in
`implementations/dataverse/`; canonical form definitions live in
`model/forms.yaml`, with acceptance scenarios in `scenarios/`.

For changes to the provisioning tool, run from the repository root:

```sh
dotnet build implementations/dataverse/Provision/Provision.csproj
dotnet run --no-build --project implementations/dataverse/Provision -- --check
dotnet run --project implementations/dataverse/SetupTests/SetupTests.csproj
```

See the implementation README before any deployment. `deploy` changes the
target environment and replaces prototype form layouts; `upgrade-client` patches
and publishes the existing app's client setting only. App creation and verification
must enforce Unified Interface (`clienttype = 4`). `smoke` creates and
retains synthetic test cases; `inspect` and `verify` are read-only. Keep
environment configuration, authentication caches, logs,
exports, and build output out of Git. Do not mistake form-level requiredness
for server-side validation or native auditing for a complete domain event model.

`setup.command` (Mac/Linux) and `setup.cmd` (Windows) launch the guided setup.
The wizard must inspect and display the target before deployment, default to
read-only verification for existing installations, pass input as process arguments
without shell evaluation, and keep entered configuration out of repository files.
Its offline tests must not authenticate or mutate a live environment.
