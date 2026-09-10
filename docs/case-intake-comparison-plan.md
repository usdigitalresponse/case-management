# Plan: compare three case-intake interfaces

Status: planned; no interface has passed the complete intake acceptance suite.

## Objective and scope

Build and compare three ways to create a case against the same Dataverse backend:

1. A standard model-driven form using native platform controls.
2. A Power Apps Custom Page using canvas controls and Power Fx.
3. A custom React web interface.

Compare user experience and development/maintenance effort without implementing
three versions of the business rules. Dataverse is the backend for this experiment;
this does not select the production platform. The canonical model remains
implementation-neutral and usable for other implementations.

Use [the canonical intake form](../model/forms.yaml), [schema](../model/schema.yaml),
[rules](../model/rules.yaml), [workflows](../model/workflows.yaml), and
[acceptance scenarios](../scenarios/new-case.md) as requirements. Record results in
[the comparison worksheet](case-intake-ui-comparison.md).

The journey selects an existing person, captures an explicit opening status and
effective timestamp, accepts optional case context and a complete optional
identifier, and creates the case, client participation and opening event.
The saved case must be available for viewing again.

Person creation, duplicate-person review, assignment, closure/reopening, billing
and payment execution are outside this slice. Later steps of scenario 4 (additional
roles/participants) and scenario 5 (identifier changes) are follow-on backend
checks, not reasons to add those screens to all three intake interfaces. Record
that scope explicitly; do not claim those complete scenarios have passed.

## Starting point

- The existing app and Solution contain a standard case form with an intake tab,
  currently configured for read-only synthetic review. It is a starting artifact,
  not a working baseline for the current intake specification.
- The temporary review guard's 299 steps were disabled and verified. Registrations
  remain, and earlier command hiding may still affect native entry points.
- The Power Fx Custom Page has a recipe but has not been built. Its sequential
  write example is superseded by this plan's shared transactional backend.
- No React intake interface is implemented.
- Atomic intake, trusted actor attribution and runtime permissions remain gaps.
  Existing offline fixture tests do not establish any of these guarantees.

## Phase 1: settle the intake contract and native-form integration

Document one platform-neutral create-case request/result contract alongside the
canonical form/workflow specifications before implementing it. Include:

- The existing form inputs, stable person/reference IDs and complete optional
  identifier payload. No inferred opening status or effective timestamp.
- A request ID for retry correlation. Specify its scope, retention and behavior
  for a repeated ID with different content before building retry handling.
- A successful result containing the case and child IDs; validation/permission
  errors that each UI can associate with fields; an outcome lookup for uncertain
  responses so retry cannot silently create a second case.
- Server-resolved authenticated actor, recording timestamp, opening event type
  and initial sequence number. The browser cannot select another actor.
- Initial values for required case status and compatibility/display fields.
  Distinguish these writes from ongoing projections, which remain deferred.

Resolve or record configurable prototype choices for allowed opening statuses,
client role, backdating, time zone, actor-account mapping, intake permissions and
record visibility. Use synthetic configuration; do not invent organization policy.

First perform a narrow native-form feasibility check. Standard case controls do
not automatically submit all child-record inputs as one operation. Evaluate a
native intake form backed by a narrowly scoped implementation-only submission
record, versus adapting the existing case form with minimal supported bindings.
A submission record, if needed, is transport/staging, not a second canonical Case.
Do not add participant/event fields to the canonical Case merely for form binding.

Document which native Save operation invokes the shared handler and how its
successful response opens the case. Keep native controls and layout; count any
scripts, commands or submission metadata as implementation effort. If this
requires a custom save command, label the baseline accurately: standard form UI
with custom backend integration, not zero-customization out of the box.

Exit: reviewed contract, named native integration approach, and explicit open
product decisions. Do not build three separate save paths to avoid this decision.

## Phase 2: implement and verify the shared Dataverse backend

Build one synchronous intake handler, packaged through supported Solution tooling.
A Dataverse Custom API is a candidate entry point for the custom UIs; a native
form adapter may use a different transport but must invoke the same handler and
transactional rules. Confirm the mechanism in a small integration test before
committing to packaging details.

The handler must authorize the caller, validate references and compatible context,
and create the case, participant, opening event and supplied identifier in one
transaction. Enforce retry behavior within the same persistence boundary. An
invalid request must leave no partial case or history. Derive the actor from the
caller and validate the application's user-account mapping without impersonating
synthetic fixture actors.

Prevent ordinary callers from bypassing the intake invariants through direct
case/child creation. Define the permissions and server-side checks required for
that boundary, including protection of created lifecycle history. Do not restore
the blanket review-only write guard as workflow enforcement. Reads use the same
record-access policy for every UI; avoid elevated service credentials in a browser.

Verify using synthetic users/data:

- Minimum and complete intake; stable linked IDs; optional values remain empty.
- Missing inputs, invalid references/statuses and incompatible context rejected.
- Injected failure at each record creation leaves no partial aggregate.
- Repeated and concurrent submissions follow the agreed request-ID contract.
- An uncertain response can be resolved without creating a duplicate.
- Unauthorized callers/direct writes fail; actor spoofing and ordinary history
  edits fail; an authorized user can retrieve the created case.
- Effective time, recording time and reporting date conversions are correct.

Exit: backend integration tests pass independently of UI. Update implementation
mapping, commands and documented gaps together; keep environment details out of Git.

## Phase 3: finish the standard-form baseline

Export and inspect the existing Solution before editing maker components. Preserve
app/form identities, layouts and events. Restore only the controls and entry points
needed for intake; inspect residual command customizations rather than resetting
the whole Solution or recreating the app.

Implement the Phase 1 native binding, using built-in fields, lookups, validation
feedback and navigation where possible. Save must reach the shared handler and
show the resulting case. No client-first creation of an incomplete Case.

Run the scoped acceptance walkthrough and backend checks as an ordinary test user.
Capture navigation steps, required customizations and any remaining limitations.
Exit: a usable, tested standard-form baseline, not merely an editable case row.

## Phase 4: implement the Power Fx Custom Page

Revise the [recipe](../implementations/dataverse/custom-page-recipe.md) to use the
confirmed shared operation before Studio authoring. Replace sequential table
`Patch` calls with one intake submission. Retain field validation, loading state,
error feedback and a saved-case link. Do not duplicate authoritative business rules
in formulas; immediate UI hints may mirror server validation.

Build one bounded intake page in the existing app. Resolve connector/action binding
and caller identity, then capture privacy-reviewed source through the Solution
workflow. Verify keyboard navigation, responsive layout and error recovery.

Exit: same inputs, backend outcomes and permissions as the baseline; actual Studio
formulas and deployment verified, with no atomicity waiver for this UI.

## Phase 5: implement the React interface

Build only intake and its confirmation/view link. Choose the smallest supported
hosting/integration approach after evaluating authenticated access to the shared
operation. Record whether it is independently hosted or platform hosted, along
with redirect/origin configuration, licensing implications and deployment steps.
React is selected for this comparison; hosting and production architecture are not.

Use the same backend, reference records, ordinary-user permissions and request-ID
contract. Keep secrets out of frontend bundles and configuration committed to Git.
A thin client adapter may translate transport names; it must not implement another
business-rule engine. Cover loading, field/server errors, uncertain outcomes,
keyboard use and narrow-screen layout.

Exit: authenticated end-to-end intake through the same handler, with reproducible
build/test/deployment instructions and the scoped acceptance checks passing.

## Phase 6: conduct and record the comparison

Use the same fixture cohort, reference configuration, backend version and user
permissions. Give each attempt a unique test/request ID so results can be traced
without overwriting other runs. Keep fixture seeding separate from cleanup and
preserve failed-run evidence until reviewed.

For each UI, record minimum/complete intake, invalid-input correction, repeated
submission, permission denial, simulated backend failure and reopening the saved
case. Distinguish backend integration evidence from browser walkthrough evidence.
Rotate interface order when possible to reduce learning effects.

Record task completion, elapsed time, interaction count, user errors, clarity of
feedback, keyboard accessibility, responsive behavior and observed latency. Record
shared backend effort separately from per-UI build, test, deployment, maintenance
and licensing/hosting costs. Use observed results; leave unmeasured items blank.

Apply one small, identical follow-up requirement to all three (for example, expose
an existing optional case-context field) and record effort and regressions. Agree
on evaluation priorities before scoring; do not invent weighted scores afterward.

Exit: results and limitations in the worksheet, with a recommendation in
`DECISIONS.md`. No automatic change to the project's standard-form default.

## Completion and working practices

The comparison is complete when all three UIs can create the same valid aggregate
through the shared handler, failure/security/retry checks pass, source and setup
are reproducible, and measured findings support a recommendation. Remaining domain
questions or failed criteria must be named rather than treated as a pass.

Continue on focused feature branches. Keep changes uncommitted for review unless
asked to commit; the user pushes, opens PRs and merges. Do not apply shelved work
as part of this plan. Create implementation folders/dependencies only in their
respective phases, and update agent instructions when durable commands or
boundaries are introduced.
