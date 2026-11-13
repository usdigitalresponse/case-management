# Integrating with an existing case management system

There are two ways to combine invoice review with a case management system:

- **Connect this tool to it.** Run the Postgres/AWS prototype beside your case
  management system and exchange data between them.
- **Build these features into it.** If you develop a case management system,
  add invoice review to your own product using this project's specification
  and, where useful, its code.

The prototype isn't connected to any case management system yet. Its links to
one are placeholders, and data moves only through files: staff upload a
case's exported time log during review, and approved invoices leave as
exports. Some features exist only to work around this.

Code paths below are under `implementations/postgres-aws/server/src/`. See the
prototype's [design notes](../implementations/postgres-aws/docs/) for how
each feature is built, and its
[MAPPING.md](../implementations/postgres-aws/MAPPING.md) for its gaps.

## Features that change once case data is available

| Feature | Why it exists | With case data |
| --- | --- | --- |
| Local cases, added by staff outside invoice matching | Review needs case details, and submitters' access follows case assignment | Use the real cases and assignments. Keep local creation only for cases not entered yet |
| Filing invoices by person, with the case number as typed | Submitters bill for cases the tool doesn't know | Look up the number on sending. Keep filing by person for numbers not found |
| Case number matching and correction, to existing cases only | Staff match each invoice to a case by hand | Search the real cases. Keep the sender's typed number beside the match |
| Proposed details for an unlisted case, provider or timekeeper | The tool's own lists are incomplete | Needed less often. Keep for records not entered yet |
| A submitter's "Your cases" list | The tool can't see real assignments | List the provider's actual assignments |
| People, providers, clients and organizations | Review needs names, roles and offices | Use the real records. Keep only what they lack, such as rates, CVs and fee schedules |
| Uploading a case's time log during review | The tool can't read recorded time | Read the time records directly. Still don't store them or show them to submitters |
| Submitter portal and emailed-code sign-in | Providers need somewhere to send invoices | Keep it, or use an existing provider portal |
| Hidden case features (overview, closing cases, lifecycle history) | The earlier, broader prototype | Leave them out |
| Counties and other settings | Reference data for thresholds and reports | Use the case management system's values if it has them |

## Features that carry over either way

Invoice upload, reading and entry; line review with reasons and questions;
rate, mileage and pre-authorization checks; sign-off; attestation; audit
history; and redacted exports. Keep pre-authorizations and per-person rates
wherever they're already tracked.

## Connecting this tool to your case management system

- **Source of truth.** Usually the case management system owns cases, people
  and assignments; this tool owns invoices, review, sign-off and the billing
  record.
- **Link by identifier.** Store the other system's ID on each local case (the
  model's `case.external_reference`), not just the case number.
- **Keep what review used.** Store the case details each invoice was reviewed
  against, so later changes don't rewrite a finished review.
- **Decide what goes back,** such as status, approved total or a link to the
  review. Payment stays in the finance system.
- **Start with what's available:** an API, a read-only database view or a
  scheduled export. Read-only access to cases, assignments and time removes
  most of the workarounds above.
- **Expect custom work.** Case matching (`cases/casesByNumber.ts`) and the
  time log check (`billing/reviewTimeLog.ts`) read only local data.

## Email and mailbox integration

This is a gap for a future vendor or contributor. Some organizations want the
invoice review conversation tied to their email, such as Outlook, rather
than only to the portal. Today a reviewer's question to the submitter
appears only on the invoice. A submitter who answers by email has their
answer typed in by a reviewer, who is named as the one who recorded it
(`billing/reviewQuestions.ts`). The email itself isn't stored or linked.

Possible additions:

- Email the submitter when a question is waiting, with a link to the
  invoice, not the question's text.
- Save an emailed reply, or a record of it (sender, time, message ID), with
  the answer it backs up.
- Answer by replying to the email, through a shared mailbox read by Microsoft
  Graph or a similar service.

Each of these must keep the rules for questions:

- A question and its answer are each recorded once and never changed. A
  saved email adds evidence to an answer; it never edits or replaces one.
- Questions, answers and saved emails are never put in exports or the
  billing record.
- An email is matched to a question only by an exact identifier, such as a
  reply token, or when a reviewer confirms it. Never match by sender name or
  subject alone.
- Only people who may read the invoice can see saved emails.

Still to be decided:

- Whether saved emails are kept records, like providers' CVs, or working
  copies deleted when the request ends, like uploaded invoice files.
- Which mailbox and service is used, and what it costs.
- How replies from an unknown address, or about several questions, are
  handled.

## Building these features into your case management system

You don't need a second application or a connection layer. Build invoice
review on your own cases, people, assignments and time records, and skip the
workarounds above.

- **Start from the specification.** The [schema](../model/schema.yaml) has the
  invoice entities (lines, review decisions, questions, approval chains,
  pre-authorizations, attestations and events). The [rules](../model/rules.yaml)
  and [workflows](../model/workflows.yaml) define behavior. The
  [invoice review](../scenarios/invoice-review.md),
  [import and export](../scenarios/invoice-import-export.md),
  [pre-authorization](../scenarios/preauthorization.md) and
  [payment request](../scenarios/payment-request.md) scenarios are the
  acceptance tests.
- **Map, don't copy.** The model's `case`, `person`, `case_participant` and
  professional profiles stand for records you already have. Add only the
  invoice entities.
- **Keep the rules that protect the review:**
  - Finished review rounds are never changed.
  - Questions and answers are never changed, and an unanswered one blocks
    finishing the round.
  - Lines are never repriced automatically; a reviewer's changed rate is
    flagged for sign-off.
  - A trip's travel time, mileage and costs stay separate lines.
  - Going over a pre-authorization needs an explanation, never a refusal.
  - Uploaded invoice files are deleted when the request ends.
- **Reuse code where it fits.** The prototype is TypeScript, Express,
  PostgreSQL and React, under Apache 2.0. Invoice reading (`imports/`) and
  pricing and checks (`billing/`) are
  the most reusable, but depend on its schema, so expect to adapt them.
- **Test extraction** with the synthetic invoices and expected results in
  [`scenarios/fixtures/invoices/`](../scenarios/fixtures/README.md).
