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

The shared specification now includes lifecycle and payment transitions and
acceptance scenarios. Configured state vocabularies, roles and permission rules
still need product decisions before implementation. See [the model review](model-review.md).

## UI choices

| Workflow | Initial UI choice | When to reconsider |
| --- | --- | --- |
| New case, case details, person/reference administration | Standard forms and views | Observed intake problems that a standard form cannot resolve well |
| Case lists, filtering, related records | Standard views and related-record controls | A demonstrated cross-record workflow problem |
| Time/expense entry, invoice headers, service-provider records | Start with standard forms/views when implemented | Repeated-entry usability findings |
| Assignment with qualification/workload review | Start with standard related data and views | Consider a Custom Page if users need a guided comparison and override flow |
| Sequential invoice/line review | Start with views, subgrids, and explicit server-side rules | Consider a Custom Page for a combined line-review workspace if testing warrants it |

No current interface demonstrates a need for PCF. Consider it only when a
specialized control is both necessary and reusable; a custom control should not
be the authority for access or approval rules. Some journeys may use custom web applications alongside platform forms. Both
must enforce the same domain transitions and access rules at the service boundary.
A future complete web implementation remains supported by these specifications;
this review does not require creating a web project now.

**2026-09-10 addendum:** a bounded comparison is planned for new-case intake:
standard model-driven form, Power Fx Custom Page, and React web UI, all using the
same Dataverse backend and authoritative save behavior. See the
[implementation plan](case-intake-comparison-plan.md) and
[comparison worksheet](case-intake-ui-comparison.md). This authorizes a focused
React experiment, not a complete web application or a production-stack choice.
Until results are recorded in `docs/DECISIONS.md`, standard forms remain the default.

## Deployment assessment

The live prototype is packaged in `CaseIntakePrototype`, and its bootstrap is
repeatable in the limited sense that it can resume after partial creation. That
is not yet a proven clean-environment deployment process.

The repository now includes the privacy-reviewed unpacked Solution under
`implementations/dataverse/Solution`. This captures maker forms, views, navigation
and command customizations alongside the canonical YAML. The provisioning tool
remains a bounded bootstrap and schema maintenance tool; it preserves app IDs and
existing form layouts, adding only missing fields. Do not grow it into a general
deployment framework.

Use `pac` and Solution tooling for export/unpack/pack/import. Export maker changes
before editing Solution source, review for private metadata, then retain the
result in Git. The canonical specification remains authoritative for intended
behavior; the Solution records the actual Power Platform implementation.
Unmanaged development source and managed downstream artifacts have distinct roles.

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
Power Fx expressions have entered the canonical model. UUIDs, shared person identities, case participants, dates, references, and
explicit lifecycle and approval decisions are portable concepts.

Maintain these distinctions as the implementation grows:

- A required domain field remains required even though Dataverse Business
  Required metadata alone does not block every API/import write.
- Native Active/Inactive state is not the case lifecycle. The configurable
  case status and valid transitions must be defined independently.
- Native audit history is an implementation mechanism, not permission to
  weaken immutable-history requirements. Immutable reviewed submission snapshots are now required; native auditing
  alone does not fulfill their contract.
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
2. **Maintain the captured Solution source.** The initial export is now captured.
   Continue the designer-change/export/privacy-review loop documented in
   `implementations/dataverse/SOLUTION.md`, preserving native component identities.
3. **Make deployment complete.** Add a small deployment wrapper and configuration
   template with explicit source/target selection. Separate reference-data seeding
   and environment setup from Solution import. Prefer a tenant-owned deployment
   identity for recurring use; keep credentials outside the repository.
4. **Prove a second-environment installation.** Import the built artifact into
   an authorized clean, compatible development environment, apply required
   configuration and role assignments, and run the same acceptance scenarios.
   Record prerequisites, results, upgrade behavior, and any manual steps.
5. **Implement the next workflow from the shared model.** Define person creation
   and duplicate review, intake permissions, and status transitions before
   extending the app. Choose native capabilities first and document real gaps.

Do now: preserve the current boundaries, complete intake verification, capture
the Solution, and document/test deployment. Defer a directory reorganization,
full YAML-to-platform generators, unrelated custom UI components, and
organization-wide production architecture. The bounded React intake experiment
is described in the comparison plan above.

For cross-implementation comparisons, reuse the acceptance scenarios and record
development effort, task success/usability, performance, deployment effort,
operating cost, customization effort, and maintainability. These can be evaluated
without selecting a second stack today.

## Revised domain implementation boundary

Power Platform remains the active prototype direction. The same model supports
an AWS-hosted relational/custom implementation, a possible lightweight Airtable
prototype, and a later fully custom web app. No production platform is selected.
Keep platform forms and custom web journeys interchangeable at the domain
boundary: reads may use projections, but writes must validate relationships,
append required history and atomically maintain approval balances and caches.

Use child relationships for participants, affiliations, issues, lifecycle,
activities and authorization draws. A relational implementation can use foreign
keys, transactions and views; platform implementations must document their actual
mechanism and any unavailable guarantees. An Airtable comparison must explicitly
assess relationship integrity, immutable history and concurrent financial writes
before claiming those scenarios pass. Do not build a universal storage adapter
or schema generator as part of this model review.

Resource/template recommendations remain optional configuration evaluated against
case attributes and related records. They return accessible resource versions;
they do not add template-specific columns to Case or define a new core rules engine.

The Dataverse bootstrap now has a bounded 0.2 schema-review path, prepared from
the canonical model and synthetic examples. It reuses the existing app and adds
standard related-record forms and views. Read-only form controls and precomputed
fixture projections do not establish domain enforcement. Use the implementation
mapping and shared scenarios to distinguish schema/data verification from
runtime workflow conformance. Capture the actual customization through Solution
export/unpack; do not turn the review preparer into a general deployment engine.

## External payment boundary

The application handles approval and records external payment completion only.
Do not add payment initiation, bank-transfer scheduling or disbursement execution.
Platform forms and custom interfaces may capture manual confirmation; future
integrations may receive completion evidence. Both use the same audited
confirmation contract and keep approval status separate from completion status.
