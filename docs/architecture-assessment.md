# Power Platform prototype: assessment and incremental plan

The current prototyping direction is Power Platform. Use its built-in
capabilities where appropriate while keeping the requirements sufficient for
a future custom web implementation. The production platform remains undecided.
This assessment proposes incremental work; it does not initiate a large refactor.

## What already fits

- `model/schema.yaml`, `model/rules.yaml`, and `model/forms.yaml` describe
  platform-neutral entities, requirements, and intake fields.
- `scenarios/new-case.md` describes behavior that another implementation can
  demonstrate without depending on a Power Apps screen or API.
- `implementations/dataverse/` separates the Power Platform bootstrap and mapping
  from the model. Keep that path for now; renaming it would not improve this slice.
- The prototype uses Dataverse, an unmanaged Solution, standard model-driven
  forms/views, lookups, and native auditing. There is no custom CRUD frontend or
  additional hosted infrastructure.
- Runtime environment addresses and authentication are outside Git. Fixtures are
  synthetic, and status/category values are records rather than canonical enums.

## Specification and implementation boundaries

| Belongs in the shared specification | Belongs in the Power Platform implementation |
| --- | --- |
| Entity meanings, relationships, required fields | Logical names, publisher prefix, column types and length limits |
| Valid transitions, actors, prerequisites, timestamps | Business rules, synchronous plug-ins, flows, and form event bindings |
| Roles, actions, record scope, assignment effects | Dataverse security roles, ownership, teams, app-role associations |
| Duplicate warnings and override policy | Matching rules and their platform limitations |
| History that must be preserved and who may change it | Audit settings, retention configuration, snapshot implementation |
| Form purpose, fields, validation, task completion | Main forms, views, Custom Pages, PCF components, navigation |
| Reusable reference concepts and configuration constraints | Seed/import tooling, environment variables, connection references |

The specification still needs explicit workflow/state-transition definitions,
roles and permission rules, reference-data definitions, and user journeys beyond
case intake. Add these when implementing the next bounded workflow, not as empty
placeholder files. Existing invoice approval requirements should remain in the
shared rules and be extended with transitions and acceptance scenarios before
their Power Platform implementation is built.

## UI choices

| Workflow | Initial UI choice | When to reconsider |
| --- | --- | --- |
| New case, case details, client/reference administration | Standard forms and views | Observed intake problems that a standard form cannot resolve well |
| Case lists, filtering, related records | Standard views and related-record controls | A demonstrated cross-record workflow problem |
| Time/expense entry, invoice headers, service-provider records | Start with standard forms/views when implemented | Repeated-entry usability findings |
| Assignment with qualification/workload review | Start with standard related data and views | Consider a Custom Page if users need a guided comparison and override flow |
| Sequential invoice/line review | Start with views, subgrids, and explicit server-side rules | Consider a Custom Page for a combined line-review workspace if testing warrants it |

No current interface demonstrates a need for PCF. Consider it only when a
specialized control is both necessary and reusable; a custom control should not
be the authority for access or approval rules. No current workflow justifies a
standalone web interface. A future complete web implementation is an architectural
option, not a reason to create a web project now.

## Deployment assessment

The live prototype is packaged in `CaseIntakePrototype`, and its bootstrap is
repeatable in the limited sense that it can resume after partial creation. That
is not yet a proven clean-environment deployment process.

The main gap is that the repository currently contains imperative provisioning
code rather than the unpacked Solution as the supported source representation.
The code duplicates a subset of the YAML model, reconstructs form XML, requires
a separate API sign-in, and can replace maker edits on rerun. Keep it as the
initial bootstrap, but avoid growing it into a general deployment framework.

Use `pac` and Solution tooling for the durable export/unpack/build/import path.
Keep the platform-neutral specification authoritative for intended behavior;
use Solution source to capture the actual Power Platform implementation, including
changes made with Microsoft's designers. Unmanaged development source and managed
downstream deployment artifacts have distinct roles.
[Microsoft Solution concepts](https://learn.microsoft.com/en-us/power-platform/alm/solution-concepts-alm)

Clean deployment must separately account for reference data, environment-level
audit settings, users and role assignments, privileges, language/licensing
prerequisites, and future connection bindings. Solution schema packaging alone
does not establish those operational prerequisites. Use deployment settings for
environment variables and connection references when actual integrations need
them; there are no flows or external connections requiring those components yet.
[Power Platform CLI Solution commands](https://learn.microsoft.com/en-us/power-platform/developer/cli/reference/solution)

## Portability check

No Dataverse-specific names, ownership types, native state codes, form XML, or
Power Fx expressions have entered the canonical model. UUIDs, separate client
records, dates, references, and explicit approval decisions are portable concepts.

Maintain these distinctions as the implementation grows:

- A required domain field remains required even though Dataverse Business
  Required metadata alone does not block every API/import write.
- Native Active/Inactive state is not the case lifecycle. The configurable
  case status and valid transitions must be defined independently.
- Native audit history is an implementation mechanism, not permission to
  weaken immutable-history requirements. Reviewed invoice snapshots remain an
  unresolved modeling issue.
- User/team ownership and platform security roles must implement explicit
  domain access rules; they must not become the implicit definition of them.
- Dataverse display names, autonumbers, and the current 200-character text
  limit are mapping choices. A future web implementation need not copy them.
- The existing `user_account` entity describes authenticated actors. A future
  Dataverse mapping should evaluate native users rather than mechanically
  creating another identity store.

## Incremental plan

1. **Finish and record the intake baseline.** Publish and validate the app;
   record API and UI test results separately. Keep ordinary-user access and
   missing duplicate validation explicit. Do not call the slice production-ready.
2. **Capture the Solution as source.** Export using `pac`, inspect for private
   content and unwanted dependencies, and unpack beneath the existing Dataverse
   implementation. Establish a designer-change/export/review loop and a build
   command. Preserve native component identities; avoid wholesale renaming.
3. **Make deployment complete.** Add a small deployment wrapper and configuration
   template with explicit source/target selection. Separate reference-data seeding
   and environment setup from Solution import. Prefer a tenant-owned deployment
   identity for recurring use; keep credentials outside the repository.
4. **Prove a second-environment installation.** Import the built artifact into
   an authorized clean, compatible development environment, apply required
   configuration and role assignments, and run the same acceptance scenarios.
   Record prerequisites, results, upgrade behavior, and any manual steps.
5. **Implement the next workflow from the shared model.** Define client creation
   and duplicate review, intake permissions, and status transitions before
   extending the app. Choose native capabilities first and document real gaps.

Do now: preserve the current boundaries, complete intake verification, capture
the Solution, and document/test deployment. Defer a directory reorganization,
full YAML-to-platform generators, custom UI components, a standalone web stack,
and organization-wide production architecture until a concrete need is established.

For cross-implementation comparisons, reuse the acceptance scenarios and record
development effort, task success/usability, performance, deployment effort,
operating cost, customization effort, and maintainability. These can be evaluated
without selecting a second stack today.
