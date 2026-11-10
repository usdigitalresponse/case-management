**Please review USDR’s general guidelines for software and data:**
https://policies.usdigitalresponse.org/data-and-software-guidelines

[![Code of Conduct](https://img.shields.io/badge/%E2%9D%A4-code%20of%20conduct-blue.svg?style=flat)](./CODE_OF_CONDUCT.md)

# Invoice Review and Case Management Prototype

An invoice review tool for public-sector organizations that pay attorneys and
other providers. It sits beside an existing case management system: providers
send invoices, staff review them line by line, approvers sign them off, and
the approved result is exported for payment elsewhere.

The tool is built on a broader, implementation-neutral specification for case
management and billing, covering case data, assignments, time and expenses,
vendor services, reporting and audit history. Those wider capabilities are
later scope.


## Project Status

This is a prototype, not production-ready software.

- The [Postgres/AWS prototype](implementations/postgres-aws/README.md)
  implements invoice review and is the most complete implementation.
- The [Dataverse prototype](implementations/dataverse/README.md) is much less
  developed. It loads the shared schema and synthetic records into a
  read-only model-driven app so people can review the schema. It enforces no
  workflows, approvals or permissions.
- No production technology stack has been chosen.

See [the product definition](docs/PRODUCT.md#current-focus) for what is in and
out of the current focus.


## Where to Start

| If you are… | Start with |
| --- | --- |
| Program or billing staff deciding whether this fits your work | [The product definition](docs/PRODUCT.md), the [acceptance scenarios](scenarios/), then the [questions for your organization](docs/adopting.md#questions-for-your-organization) |
| An IT team deciding where and how it would run | The [technical questions](docs/adopting.md#technical-questions) and, if you use Microsoft services, [the Microsoft platform plan](docs/microsoft-platform-plan.md) |
| Trying the prototype | [Trying the Prototype](#trying-the-prototype) |
| An organization planning to adopt or adapt it | [The adoption guide](docs/adopting.md) |
| Running it beside your case management system, or building these features into one | [The integration guide](docs/integration.md) |
| A developer contributing changes | [Developing](#developing) |


## What's in This Repository

| Location | Contents |
| --- | --- |
| [`docs/`](docs/) | The [product definition](docs/PRODUCT.md), [decisions](docs/DECISIONS.md), the [domain model review](docs/model-review.md), the adoption and integration guides, and platform plans |
| [`model/`](model/README.md) | The platform-neutral specification: schema, rules, workflows and forms |
| [`scenarios/`](scenarios/) | Platform-neutral acceptance scenarios and [synthetic sample records](scenarios/fixtures/README.md) |
| [`tests/`](tests/README.md) | Offline checks of the specification against the sample records |
| [`implementations/postgres-aws/`](implementations/postgres-aws/README.md) | The working invoice review prototype, with its documented gaps in [MAPPING.md](implementations/postgres-aws/MAPPING.md) |
| [`implementations/dataverse/`](implementations/dataverse/README.md) | The Dataverse schema review and its provisioning tool, with `setup.command` and `setup.cmd` at the root for guided setup |

The specification is the authoritative source. Each implementation documents
how it maps to it and where it falls short.


## Trying the Prototype

### Postgres/AWS invoice review prototype

You need Docker. In `implementations/postgres-aws/`:

```sh
docker compose up
docker compose exec server npm run seed   # in a second terminal, once
```

Then open http://localhost:5173 and choose "Demo sign-in" for the staff app or
"Demo partner sign-in" for the external submitter portal. All demo data is
synthetic. The seed command deletes all application data, so run it only to
set up or reset the demo. See [its README](implementations/postgres-aws/README.md)
for configuration, tests and the single-host demo deployment.

### Dataverse schema review

You need a Power Apps environment. Double-click **setup.command** on Mac or
**setup.cmd** on Windows in this repository's folder. The wizard explains
where to find your environment's details. See
[guided setup](docs/deployment.md#guided-setup-recommended) for prerequisites
and the [Dataverse README](implementations/dataverse/README.md) for the
[schema-review commands](implementations/dataverse/README.md#prepare-check-deploy-and-seed)
and documented gaps. The
[Power Platform architecture assessment](docs/architecture-assessment.md)
explains that track's history.


## Adopting and Integrating

If your organization is considering this project, read
[the adoption guide](docs/adopting.md). It has:

- recommended steps, from checking the scenarios against your process to
  piloting with real users;
- questions for program, billing and records staff;
- technical questions for your IT team.

To combine invoice review with a case management system, read
[the integration guide](docs/integration.md). It covers two approaches:

- running this tool beside your case management system and connecting the two;
- building these features into a case management system you develop.

It lists which prototype features stop being needed once case data is
available.


## Developing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). AGENTS.md
is written for coding agents but applies to everyone: it covers which files
are authoritative, privacy, working practices and Git.

**Principles**

- Keep the domain model independent of any implementation.
- Use the shared specification and scenarios to compare implementations.
- Make business rules and workflow transitions explicit.
- Preserve audit history for important case, assignment and financial changes.
- Document each platform's compromises and gaps.
- Keep organization-specific information and private research out of the
  repository.

**Checking changes**

- Specification: `python3 -B -m unittest discover -s tests -v` from the
  repository root (see the [test guide](tests/README.md)).
- Postgres/AWS prototype: type checks and tests are in
  [its README](implementations/postgres-aws/README.md).
- Dataverse provisioning tool: build and offline checks are in
  [its README](implementations/dataverse/README.md).

The [domain model review](docs/model-review.md) records each model revision.


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
