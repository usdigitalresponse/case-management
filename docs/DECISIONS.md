# Project Decisions

This file records durable project decisions that contributors and agents should
understand. Update an existing entry when a decision is refined, and add a dated
entry when a decision materially changes.


## Current Decisions

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
- implementation-specific directory structure; and
- design-tool export and handoff conventions.
