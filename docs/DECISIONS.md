# Project Decisions

This file records durable project decisions that contributors and agents should
understand. Update an existing entry when a decision is refined, and add a dated
entry when a decision materially changes.


## Current Decisions

### Case closure ends assignments

- **Status:** Active
- **Decided:** 2026-09-09

Closing a case atomically ends every active assignment role at the effective
closure time, preserving history and recording the closing actor and reason.
Reopening does not reactivate assignments; renewed assignments use new records.

### External payment completion

- **Status:** Active
- **Decided:** 2026-09-09

The application owns approval and tracks confirmation of payment completed
elsewhere. Retain `payment` for audited external completion evidence; do not
implement payment execution. Approval and completion are separate states.

### Domain relationships and history review

- **Status:** Active
- **Decided:** 2026-09-09

Adopt the platform-neutral 0.2 model described in [the model review](model-review.md).
Separate person identity from case roles and preserve typed lifecycle, assignment
and financial history. Retain `invoice` as the payment-request aggregate and
`service_provider` as payee rather than creating parallel names. Existing
Dataverse now has a schema/data review path; operational workflows and
server-side enforcement remain documented implementation gaps.
Support platform forms, custom web journeys, and future complete custom
implementations from the same contracts without selecting a production stack.


### Initial Dataverse Intake Prototype

- **Status:** Active
- **Decided:** 2026-09-08

Evaluate a Dataverse implementation with one case intake form for an existing
client, using synthetic reference data. Keep the shared model authoritative and
record mappings, commands, and gaps under `implementations/dataverse/`. This
does not select a production platform. Client creation and the full case
lifecycle remain outside the first intake slice.

The current prototyping direction is Power Platform, using its built-in
capabilities wherever appropriate. Standard model-driven forms and views are
the default; specialized interfaces require a demonstrated workflow need.
Preserve the option to compare this prototype with a hybrid or fully custom
web implementation of the same specification. See the
[assessment and incremental plan](architecture-assessment.md).

### Prototype Direction

- **Status:** Active
- **Decided:** 2026-09-04

The project begins as a generic, implementation-neutral prototype specification
for public-sector case management and billing. It may adopt a specific technology
stack as its direction is validated.

The shared specification should remain the source for comparing candidate
implementations until the project explicitly chooses a different direction.


### Data and Privacy

- **Status:** Active
- **Decided:** 2026-09-04

Repository content must use generic terminology, synthetic examples, and
configurable reference data. Organization-specific, confidential, personally
identifying, and private source material must remain outside the repository.


### Agent Instructions

- **Status:** Active
- **Decided:** 2026-09-04

The root [AGENTS.md](../AGENTS.md) file is the source of truth for agents working
in this repository. Agents should update it when a durable command, invariant,
directory boundary, or working convention changes.


### Git and Review Workflow

- **Status:** Active
- **Decided:** 2026-09-04

Agents must not push commits or branches, create pull requests, or otherwise
publish repository changes. Agents should leave changes uncommitted for review
unless the user explicitly requests a commit.

The project does not currently require every change to use a pull request and
has not selected a single required merge method. Contributors should seek review
from existing contributors for changes that benefit from discussion or affect
shared project conventions.


## Deferred Decisions

The following decisions will be made when the project has enough information to
support them:

- production technology stack and hosting architecture;
- detailed product scope and domain model;
- YAML schema, formatting, and validation tooling;
- continuous integration and required checks;
- additional implementation-specific directory structures; and
- design-tool export and handoff conventions.
