# Invoice Review and Case Management Prototype

## Purpose

This project explores how a modern case-management and billing system could
support public-sector organizations with complex assignments, financial
workflows, compliance responsibilities, and reporting needs.

The project begins with a platform-neutral product definition and may become
specific to a technology stack as prototype findings clarify the appropriate
direction.


## Current Focus

Prototype findings have narrowed the first product to **invoice review beside
an external case management system** (see
[DECISIONS.md](DECISIONS.md#invoice-review-beside-an-external-case-management-system)).
Cases, assignments and time records may be kept in that external system.
This product receives invoices from attorneys and other providers, reviews
them line by line, has them signed off, and exports the approved result for
payment elsewhere. It keeps only the case information that review needs.

The [Postgres/AWS prototype](../implementations/postgres-aws/README.md)
implements this focus. The broader case-management capabilities below remain
in the shared model as later scope, marked as such, and are not removed.


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

The current focus serves billing staff who review and sign off invoices,
administrators, and external attorneys and providers who send invoices and
pre-authorization requests. The broader product should account for the needs
of:

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
6. Support configurable approval categories and review routing rules.
7. Manage external-service requests and related billing.
8. Give users visibility into work status and required actions.
9. Preserve an auditable history of important decisions and changes.
10. Produce operational and compliance reporting from trusted source data.


## Initial Capability Areas

Areas marked **current focus** are built in the Postgres/AWS prototype, with
the gaps its `MAPPING.md` lists. Areas marked **later scope** are defined in the
model but not yet a product priority.

### Case Intake and Management (later scope, except as review needs it)

Review keeps a lightweight case record: case numbers, client, county or other
setting, the providers on the case, and pre-authorized amounts. Staff create
cases from invoices during review, after duplicate and close-match checks.

- Structured client and case information
- Duplicate detection
- Related-case relationships
- Conflict information
- Case status and closure
- Historical record preservation


### Assignment and Workload (later scope)

- Qualification records
- Assignment eligibility
- Current workload visibility
- Warnings and documented overrides
- Assignment notices
- Transfer and reassignment history


### Time and Expenses

Current focus: providers keep recording time in the external system, not
here. Invoice lines are travel time, waiting time, mileage, costs and other
expenses as well as time; a trip's lines stay separate and are each decided.
Reviewers may compare an invoice with a case's time log exported from the
external system, as a working aid that is deleted when the review round ends.

Later scope:

- Case-specific activity entries recorded directly in this system
- Structured activity categories
- Validation against case access and assignment
- Support for timely entry


### Billing and Payments (current focus)

- Invoice submission by external submitters, under one of their cases or
  with a case number staff match during review
- Filing invoices by the person whose work it is, with the case number as
  typed: built in the Postgres/AWS prototype; whether the shared model files
  invoices by person rather than by case is still to be decided
- Staff entry of invoices received by email or from other tools, including
  entry straight into review
- Reading uploaded PDF and structured invoice files into editable lines, with
  the file kept only as a working copy
- Proposed details for a case, provider or timekeeper that isn't listed,
  matched to records by staff before review
- Automatic totals and discrepancy detection
- Duplicate or overlapping billing checks
- Rates by provider kind and by person, case rates set during review, and
  separate rates for travel time, waiting time and mileage, with mileage
  checked against driving distance where configured
- Line-by-line review with reasons, questions to the submitter about a line,
  then sign-off by at least two people, with changed rates flagged for
  sign-off
- Matching an invoice to a case during review
- Exports and a billing record for payment elsewhere, with optional redaction
- Pipeline status and aging
- Later scope: external payment completion tracking; actual payment always
  occurs outside this system


### External Services (current focus)

- Service-provider records, including CVs and fee schedules kept on file
- Pre-authorization requests from attorneys, and requests staff record when
  they arrive another way
- Thresholds by county, below which no pre-authorization is needed
- Overruns explained by the sender and flagged for review, never refused
- Pre-authorization usage by county
- Later scope: qualification information


### Reporting and Oversight

Current focus: the billing record, county filters on exports, and
pre-authorization usage. Later scope:

- Workload and capacity reporting
- Case and assignment reporting
- Data-quality monitoring
- Configurable periodic reports
- Trend and operational analysis


### Administration and Access

- One staff role, with administrators keeping settings, configured rates and
  the removal of people (current focus)
- External submitters sign in with an emailed code and attest that each
  invoice is true and correct (current focus)
- Audit history (current focus)
- Configurable reference data and policies (current focus)
- Later scope: role- and assignment-based access beyond review, provisioning
  and deprovisioning, and delegable administrative responsibilities


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

The first demonstration is invoice review (see Current Focus). Blocking and
warning behavior, and what external users submit and see, are recorded rule by
rule in `model/rules.yaml` and [DECISIONS.md](DECISIONS.md). Still open:

- Which user roles should participate in prototype testing?
- What audit and retention behavior is required beyond what review records?
- Which integrations with the external case management, finance and document
  management systems are needed, and in what form?
- What criteria will be used to compare candidate technology stacks?

An adopting organization's own questions are listed in the
[README](../README.md#questions-for-your-organization).
