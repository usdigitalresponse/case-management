# Case Management Prototype


This project explores how a modern case-management and billing system could
support public-sector organizations with complex assignments, financial
workflows, compliance responsibilities, and reporting needs.

The project begins with a platform-neutral product definition and may become
specific to a technology stack as prototype findings clarify the appropriate
direction.


## Problem

Organizations managing cases and related billing often depend on disconnected
systems, spreadsheets, email, paper documents, and staff knowledge to complete
core work.

These conditions can lead to:

- incomplete or duplicate case records;
- assignment decisions made without current qualification or workload data;
- billing records that require manual reconciliation;
- work moving through approval steps without visible status or ownership;
- reporting assembled manually from unreliable source data;
- access that does not consistently follow assignments or roles;
- historical information being overwritten or lost; and
- critical processes depending on one person's knowledge.

The prototype will explore whether these workflows can be represented in a
shared system that improves data quality, visibility, consistency, and
auditability.


## Intended Users

The prototype should account for the needs of:

- intake and case-assignment staff;
- professionals assigned to cases;
- billing and payment staff;
- supervisors and organizational leadership;
- compliance and oversight staff;
- system administrators; and
- external service providers.

These are generic roles. Specific organizations may divide or combine these
responsibilities differently.


## Product Outcomes

The prototype should demonstrate how a system could:

1. Create complete case records and identify possible duplicates.
2. Evaluate conflicts, qualifications, workload, and other assignment rules.
3. Track assignments and access throughout the case lifecycle.
4. Capture structured time, activities, and expenses.
5. Receive, review, approve, and track invoices digitally.
6. Support configurable payment categories and routing rules.
7. Manage external-service requests and related billing.
8. Give users visibility into work status and required actions.
9. Preserve an auditable history of important decisions and changes.
10. Produce operational and compliance reporting from trusted source data.


## Initial Capability Areas

### Case Intake and Management

- Structured client and case information
- Duplicate detection
- Related-case relationships
- Conflict information
- Case status and closure
- Historical record preservation


### Assignment and Workload

- Qualification records
- Assignment eligibility
- Current workload visibility
- Warnings and documented overrides
- Assignment notices
- Transfer and reassignment history


### Time and Expenses

- Case-specific activity entries
- Structured activity categories
- Expense and travel entries
- Validation against case access and assignment
- Support for timely entry


### Billing and Payments

- Digital invoice submission
- Automatic totals and discrepancy detection
- Duplicate or overlapping billing checks
- Review and approval workflow
- Requests for additional information
- Payment routing and confirmation
- Pipeline status and aging


### External Services

- Service-provider records
- Preauthorization requests
- Approval and status tracking
- Rate and qualification information
- Connection between services, cases, invoices, and payments


### Reporting and Oversight

- Workload and capacity reporting
- Case and assignment reporting
- Billing pipeline visibility
- Data-quality monitoring
- Configurable periodic reports
- Trend and operational analysis


### Administration and Access

- Role- and assignment-based access
- Provisioning and deprovisioning
- Delegable administrative responsibilities
- Audit history
- Configurable reference data and policies


## Product Principles

- Validate information as close as possible to where it is entered.
- Make workflow status, ownership, and next actions visible.
- Preserve history rather than overwriting significant facts.
- Keep policy values and reference data configurable.
- Avoid making one person the sole source of operational knowledge.
- Support different user roles without exposing unnecessary information.
- Record important decisions, overrides, actors, and timestamps.
- Design for accessibility and users with varied technical experience.
- Document limitations rather than silently weakening requirements.


## Prototype Boundaries

The initial prototype will not:

- contain real case, client, employee, or vendor information;
- reproduce organization-specific terminology or legal requirements;
- serve as a production system of record;
- perform a production data migration;
- establish a final hosting or technology-stack decision;
- implement every reporting or administrative feature; or
- assume that one prototype platform is suitable for production.


## Questions the Prototype Should Answer

- Can users complete the core workflow without relying on parallel spreadsheets
  or paper tracking?
- Can important rules be enforced when data is entered or decisions are made?
- Can users understand the current status and ownership of work?
- Can the system preserve useful audit history?
- Can reporting be generated from operational data without substantial manual
  cleanup?
- Can external users participate without receiving unnecessary system access?
- Which requirements can each candidate platform enforce directly?
- What compromises, custom development, or integrations would each platform
  require?


## Measures of Prototype Success

The prototype will be useful if it allows the team to:

- demonstrate representative end-to-end workflows;
- test the highest-priority scenarios with intended users;
- identify unclear or conflicting requirements;
- compare candidate platforms using the same scenarios;
- document implementation gaps and risks; and
- make an evidence-based decision about the next technical direction.


## Open Questions

- Which workflows should be included in the first demonstration?
- Which user roles should participate in prototype testing?
- Which rules must be blocking, and which should produce warnings?
- What information should external users be able to submit or view?
- What audit and retention behavior is required?
- Which integrations need to be represented in the prototype?
- What criteria will be used to compare candidate technology stacks?
