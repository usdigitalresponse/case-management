**Please review USDR’s general guidelines for software and data:**
https://policies.usdigitalresponse.org/data-and-software-guidelines

[![Code of Conduct](https://img.shields.io/badge/%E2%9D%A4-code%20of%20conduct-blue.svg?style=flat)](./CODE_OF_CONDUCT.md)

# Case Management Prototype

This project explores a generic case-management and billing system for
public-sector workflows. It begins with an implementation-neutral specification
that can be used to evaluate prototypes built with different technology stacks.
As the project develops and its technical direction is validated, it may evolve
into a stack-specific implementation.

The prototype is intended to describe reusable capabilities such as structured
case data, assignments, workflow controls, time and expense tracking, billing,
vendor services, reporting, and audit history. 


## Project Status

This repository is in an early design and prototyping phase. Initial work will
focus on defining the shared domain model, business rules, workflows, forms, and
acceptance scenarios before committing to a production technology stack.


## Project Principles

- Keep the initial domain model independent of a particular implementation.
- Treat shared specifications and acceptance scenarios as the basis for
  comparing prototypes.
- Make business rules and workflow transitions explicit.
- Preserve auditability for important case, assignment, and financial changes.
- Document platform-specific compromises and limitations.
- Keep organization-specific information and private source research out of the
  repository.


## Setup & Installation

There is no runnable application or installation process yet. Setup instructions
will be added when the first implementation stack is selected.


## Developing Locally

The repository currently contains project documentation and conventions. Before
contributing, read [AGENTS.md](./AGENTS.md) for the source-of-truth, privacy,
working-practice, and Git guidance that applies to this project.


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
