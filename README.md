**Please review USDR’s general guidelines for software and data:**
https://policies.usdigitalresponse.org/data-and-software-guidelines

[![Code of Conduct](https://img.shields.io/badge/%E2%9D%A4-code%20of%20conduct-blue.svg?style=flat)](./CODE_OF_CONDUCT.md)

# Invoice Review and Case Management Prototype

This project's working prototype is an invoice review tool for public-sector
organizations that pay attorneys and other providers. It sits beside an
existing case management system: providers send invoices, staff review them
line by line, approvers sign them off, and the approved result is exported for
payment elsewhere.

The prototype is built on a broader, implementation-neutral specification for
case management and billing, covering case data, assignments, time and
expenses, vendor services, reporting and audit history. Those wider
capabilities are later scope. The specification can be used to evaluate
prototypes built with different technology stacks.


## Project Status

This repository is a prototype, not production-ready software. The
[Postgres/AWS prototype](implementations/postgres-aws/README.md) implements
invoice review; the [Dataverse prototype](implementations/dataverse/README.md)
is a schema review. No production technology stack has been chosen. See
[the product definition](docs/PRODUCT.md#current-focus) for what is in and out
of the current focus.


## Project Principles

- Keep the initial domain model independent of a particular implementation.
- Treat shared specifications and acceptance scenarios as the basis for
  comparing prototypes.
- Make business rules and workflow transitions explicit.
- Preserve auditability for important case, assignment, and financial changes.
- Document platform-specific compromises and limitations.
- Keep organization-specific information and private source research out of the
  repository.


## Adopting and Customizing This Project

This is a prototype, not production-ready software. If your organization is
considering using or adapting it, we recommend the following.

1. **Start from the shared specification, not an implementation.** Read
   [the product definition](docs/PRODUCT.md), the [model](model/README.md) and
   the [acceptance scenarios](scenarios/). Walk through your current process
   against the scenarios. Where your process differs, write a new synthetic
   scenario first, so the difference is recorded before any code changes.
2. **Use the Postgres/AWS prototype as the starting point for a working
   system.** The [Postgres/AWS prototype](implementations/postgres-aws/README.md)
   is the most complete implementation. It covers invoice upload and import,
   line-by-line review with questions and sign-off, rates, pre-authorizations,
   case matching and an external submitter portal. The
   [Microsoft platform plan](docs/microsoft-platform-plan.md) covers
   organizations that use Microsoft services. Running the app as it is on
   Azure needs the fewest changes. Moving its data into Dataverse is a larger
   change, worth it only if the data must live there (for example, to share it
   with other Power Platform apps).

   The [Dataverse prototype](implementations/dataverse/README.md) is much less
   developed. It loads the shared schema and synthetic records into a
   model-driven app so people can review the schema. Its forms are read-only
   and it enforces no workflows, approvals or permissions. Use it to judge how
   the data model fits Power Platform, not as a working application.
3. **Answer the organizational and technical questions before you build.**
   Work through the [organizational questions](#questions-for-your-organization)
   with program, billing and records staff, and the
   [technical questions](#technical-questions) with your IT team. Their answers
   set the configuration, the hosting choice and the cost estimate your
   organization will need to approve.
4. **Customize through configuration, not code.** Most policy differences are
   meant to be reference data or settings rather than code changes. In the
   Postgres/AWS prototype these include rates by role and by person, counties
   and other settings, pre-authorization thresholds, review settings such as
   time log checks, review reason lists and named sign-off approvers. If a
   requirement can't be expressed that way, add it to the model as a general,
   configurable rule. Don't hard-code one organization's policy.
5. **Keep the specification authoritative.** When behavior changes, update the
   model, the scenarios and the affected implementation's mapping together.
   Record each decision in [DECISIONS.md](docs/DECISIONS.md). Document every
   platform compromise in that implementation's notes. [AGENTS.md](AGENTS.md)
   describes these rules in detail.
6. **Keep your organization's details out of the shared repository.** Real
   names, jurisdictions, codes, thresholds, invoices and research notes belong
   in your own deployment configuration and database, never in fixtures,
   documentation or commit history.
7. **Pilot in stages.** Start with the synthetic demo data, then try a small
   group of real users and invoices in a separate environment. Keep demo
   sign-in and demo reset turned off anywhere real data is stored, because
   reseeding deletes application data.
8. **Contribute generic improvements back.** Fixes and capabilities that would
   help other organizations are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
   Strip out anything specific to your organization first.


## Questions for Your Organization

These are policy and process decisions that the software can't make for you.
Many become configuration. Others decide whether the prototype fits your work
at all.

**Process fit**

- Do the [acceptance scenarios](scenarios/) match how invoices arrive, how
  they're reviewed and how they're approved? Where do they differ?
- Which system is the source of truth for cases and people: this one or your
  existing case management system? Will staff keep recording time in the
  existing system?
- Should invoices be filed by the person whose work they bill, with the case
  number as typed and matched to a case during review, or under a known case
  from the start?
- Who reviews invoices and who signs them off? Can anyone on staff sign off,
  or only named approvers? Must someone other than the person who entered a
  request finish its review, and above what amount?
- How will payment completion be recorded here, given that payments are made
  in another system?

**Billing policy**

- What are the rates by role, and which people have their own rates? From
  what date does each rate apply?
- How are travel time, waiting time, mileage and travel costs billed? Should
  claimed mileage be checked against driving distance?
- Is pre-authorization required, and for which kinds of service? What
  thresholds apply in each county, and how should overruns be handled?
- Can one supplier invoice be split across requests or cases?

**Roles and access**

- Which roles exist, and what can each one see and do? Who can see sensitive
  notes?
- Who can submit on someone else's behalf, for example office support staff?
- Who can add people, providers, organizations and counties?

**Records and accountability**

- Which statuses do you use? Who can correct a record, and can dates be
  backdated? Which time zone do reports use?
- What text must submitters attest to, and what level of signature assurance
  is required?
- How long must each kind of record be kept? Must finished invoices go to a
  records or document management system?
- Which funding sources, programs and reports does the system need to
  support?

**Ownership**

- Who owns the product and its configuration after launch? Who trains users
  and supports them?

The full list of open product decisions is in
[the model review](docs/model-review.md#product-decisions-still-required).


## Technical Questions

Ask your IT team. Their answers decide where and how the system runs and what
it costs.

**Hosting and cost**

- Which cloud providers and accounts can the project use, including
  government clouds? Who pays for them and who operates them?
- Are there data residency, encryption or authorization-to-operate
  requirements?
- What will it cost each month, including per-request services?
- If you use Microsoft services: can the existing app be hosted on Azure
  (Azure Government for a government tenant), or must the data be stored in
  Dataverse? Hosting on Azure is the smaller change.
- Only if the data must be in Dataverse: which Power Platform licenses and how
  much Dataverse capacity would be needed? See
  [the Microsoft platform plan](docs/microsoft-platform-plan.md#questions-to-answer-before-building).

**Identity and email**

- Which identity provider will staff sign in with?
- How should external submitters sign in? The app's own emailed codes are one
  option; an external identity service is another.
- Which service will send sign-in codes and notification emails?

**Integrations**

- How will the system exchange cases, people and approved invoices with your
  case management, finance and document management systems? Will that be
  through exports, APIs or by hand?
- Should the mileage check call a mapping service? It is billed per request.
- Reading uploaded PDFs currently runs inside the server. Is that enough, or
  does adding a separate extraction service justify its cost?

**Operations and assurance**

- Which environments are needed (for example development, testing and
  production), and who promotes changes between them?
- Who handles backups, restores, monitoring, updates and incidents?
- Which security review and accessibility standard (such as WCAG 2.1 AA) must
  the system pass before launch?


## Setup & Installation

The shared model is platform-neutral, and neither prototype selects a
production technology stack. The [domain model review](docs/model-review.md)
records each model revision.

### Postgres/AWS invoice review prototype

The most complete implementation runs locally with Docker:
`docker compose up` in `implementations/postgres-aws/`, then load the
synthetic demo data once. See [its README](implementations/postgres-aws/README.md)
for setup, tests and the single-host demo deployment, and
[MAPPING.md](implementations/postgres-aws/MAPPING.md) for its documented gaps.
The [Microsoft platform plan](docs/microsoft-platform-plan.md) covers hosting
it on Azure or on Dataverse, and the questions to answer first.

### Dataverse schema review

For guided setup, double-click **setup.command** on Mac or **setup.cmd** on
Windows in this repository's folder. The wizard explains where to find your
Power Apps environment information; no shell-variable commands are required.
See [guided setup](docs/deployment.md#guided-setup-recommended) for prerequisites.

The Dataverse prototype began as a small case intake app. Its
[schema-review commands](implementations/dataverse/README.md#prepare-check-deploy-and-seed)
load the synthetic relationships into that app for review; runtime workflows
remain implementation work. See
[its setup and documented gaps](implementations/dataverse/README.md),
[deployment instructions](docs/deployment.md) and the
[Power Platform architecture assessment](docs/architecture-assessment.md).


## Developing Locally

The repository contains the shared model, the
[Postgres/AWS prototype](implementations/postgres-aws/README.md) and a Dataverse
provisioning tool. Before
contributing, read [AGENTS.md](./AGENTS.md) for the source-of-truth, privacy,
working-practice, and Git guidance that applies to this project.


The [offline test guide](tests/README.md) explains how to validate the shared
specification against [synthetic sample records](scenarios/fixtures/README.md)
before updating a platform implementation.

## Code of Conduct

This repository falls under [U.S. Digital Response’s Code of Conduct](./CODE_OF_CONDUCT.md), and we will hold all participants in issues, pull requests, discussions, and other spaces related to this project to that Code of Conduct. Please see [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) for the full code.


## Contributing

This project wouldn’t exist without the hard work of many people. Thanks to the following for all their contributions! Please see [`CONTRIBUTING.md`](./CONTRIBUTING.md) to find out how you can help.

**Lead Maintainer:** [@adelepeterson](https://github.com/adelepeterson)

**Additional Contributors:**

- [@gideonkdavis](https://github.com/gideonkdavis)
- [@{YOUR_GITHUB_USERNAME}](https://github.com/{YOUR_GITHUB_USERNAME})

## License & Copyright

Copyright (C) 2022 U.S. Digital Response (USDR)

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this software except in compliance with the License. You may obtain a copy of the License at:

[`LICENSE`](./LICENSE) in this repository or http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
