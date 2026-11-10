# Microsoft platform plan: reusing the postgres-aws app

Status: planned, not started. Nothing here selects a production platform; it
sets out the options and the questions that must be answered before building.

## Why

The postgres-aws prototype has the most complete UI and rules (invoice review,
questions, rounds, upload/check/send, people, settings). An organization that
runs on Microsoft 365 may want it hosted on Microsoft services, or its data in
Dataverse. Either can reuse the React client unchanged: every server call goes
through `implementations/postgres-aws/client/src/api/client.ts`, so its
endpoint shapes are the contract any backend must meet.

The postgres-aws prototype currently depends on services such an organization
may not have (paths below are under `implementations/postgres-aws/`):

| Dependency | Where | Microsoft replacement |
|---|---|---|
| Email for sign-in codes (AWS SES) | `server/src/email/sendEmail.ts` | Send from a Microsoft 365 mailbox via Microsoft Graph |
| Driving distances (AWS Geo) | `server/src/billing/routeCheck.ts` | Azure Maps (billed per request), or leave the mileage rule off so reviewers get a directions link |
| Google sign-in | `server/src/auth/oidcProviders.ts` | Drop it; Entra ID sign-in is already supported |
| Hosting (single host, `docker-compose.prod.yml`) | | Azure (see Option A) |

## Option A: host the existing app on Azure (fewest changes)

Keep Postgres, the server and the client. Changes are deployment and the three
replacements above. Cost is a small fixed monthly amount that does not grow
with users, and it covers external submitters, who keep the emailed-code
sign-in (or move to Entra External ID's one-time passcode).

Order-of-magnitude list prices before any government-cloud markup, to be
replaced with figures from the Azure pricing calculator for the right cloud:

- one small VM running the existing Compose stack: roughly $30–70/month
  including disk and backups;
- managed PostgreSQL plus a small container host: roughly $50–120/month;
- Azure Maps, only if the mileage rule is on: per request, cached by address
  pair as today.

Azure is not included in Microsoft 365 licences; it is a separate,
usage-billed subscription.

## Option B: Dataverse as the system of record

Use only if the organization needs the data in Dataverse (for example to share
it with other Power Platform apps). Existing guidance:
`docs/architecture-assessment.md` authorizes "a focused React experiment, not
a complete web application" and requires custom UIs and platform forms to
enforce the same transitions at the service boundary.

Architecture: the unchanged client talks to a new Node backend-for-frontend in
`implementations/dataverse/web-bff/`, which keeps sessions and sign-in, holds
the rules for the experiment, and stores data through the Dataverse Web API.
The browser never calls Dataverse directly.

- **Not a database switch inside postgres-aws.** Its rules query Drizzle
  directly; threading an adapter through them is the speculative portability
  layer `AGENTS.md` rules out. Import its database-free modules instead (e.g.
  `billing/timeLogCheck.ts`, `billing/money.ts`, pure parts of
  `billing/priceLines.ts`), splitting pure logic out first where needed.
- **Transactions become `$batch` changesets.** Read with ETags, then write in
  one all-or-nothing changeset with `If-Match`, so a stale `linesVersion` is
  still refused, never merged.
- **Staff** sign in with Entra; the backend calls Dataverse on their behalf
  (on-behalf-of tokens), which needs security roles defined (none exist yet).
  **External submitters** keep emailed-code sign-in and the backend calls
  Dataverse as an application user, with access checked in the backend.
- **Rules live in the backend for the experiment.** This is a documented
  compromise: model-driven forms on the same tables can bypass them, so slice
  tables are read-only there. Whether rules move into Dataverse Custom APIs is
  decided after the first slice.
- **Unchanged:** document store, PDF reading queue, email and route check stay
  in the backend process.

Phases:

1. **Schema catch-up.** The captured Solution reflects about model 0.2; the
   model is at 0.11.0 and 12 entities are not provisioned (trip, the three
   rate tables, billing_rule_setting, invoice_import,
   invoice_line_working_decision, review_time_log, invoice_review_question,
   invoice_review_assignment, case_invoice_reviewer, invoice_review_setting).
   Add them with `prepare_review.py`, `--check-review` and `deploy-review`,
   following `implementations/dataverse/SOLUTION.md` (export maker edits
   first, append fields, never regenerate forms).
2. **Slice 1: staff invoice review.** The endpoints behind the review queue,
   `/billing/:invoiceId` and `/finished` (queue, detail, line decisions with
   `linesVersion`, questions, finish, reopen, sign-off, complete), ported from
   `reviewInvoiceLine.ts`, `reviewRounds.ts`, `reviewQuestions.ts`,
   `reviewAccess.ts` and `reviewQueue.ts`, on `seed-review` data. Other
   endpoints return 501.
3. **Slice 2: external upload, check and send**, only after the licensing
   questions below are answered.
4. **Record findings** in `docs/architecture-assessment.md`: what ported,
   what needed Custom APIs, `$batch` limits, latency, licensing, and the
   recommendation on where rules live.

Licensing is the main cost risk. As understood when this was written, the
Power Apps rights included with Microsoft 365 cover standard connectors and
Dataverse for Teams; full Dataverse, model-driven apps and custom connectors
usually need Power Apps Premium per user, and Microsoft's multiplexing rules
mean users reaching Dataverse through a custom app or service account still
need licences. External users usually need Power Pages. Confirm all of this
for the organization's cloud before going beyond synthetic data.

## Questions to answer before building

Ask the organization's IT team. The answers decide between A and B and supply
the cost projection the organization needs to approve.

**Cloud and subscriptions**

1. Which Microsoft cloud is the tenant in (commercial or a government cloud
   such as GCC)? Government clouds have their own pricing and service
   availability.
2. Is there an existing Azure subscription (Azure Government, for a
   government tenant) the project can use, and who pays and operates it?
3. Are any other cloud providers available? If not, the AWS and Google
   dependencies above must be replaced.

**Identity and email**

4. Will IT allow an Entra app registration for staff sign-in, and grant
   consent for sending mail through Microsoft Graph from a dedicated mailbox?
5. How should external submitters sign in: the app's own emailed codes, Entra
   External ID, or Power Pages? Is there a cost or policy constraint on each?

**Licensing (Option B)**

6. Which Power Platform rights do staff licences include? Do they cover full
   Dataverse and model-driven apps, or only the rights seeded with Microsoft
   365?
7. For the expected number of staff reviewers and external submitters, what
   Power Apps Premium and Power Pages licences would be needed, and at what
   cost?
8. Is there spare Dataverse capacity in the tenant, or would storage add
   charges?

**Data and records**

9. Does the organization need the data in Dataverse, or is a Microsoft-hosted
   database acceptable? (If not required, Option A is cheaper and simpler.)
10. Must finished invoices be kept in a records or document management
    system? The app deliberately keeps uploads only as temporary working
    copies; permanent retention would be a separate integration and decision.
11. Should the mileage route check be on? It adds a per-request mapping cost.

**Operations**

12. Who owns the app registration, the hosting subscription and the Dataverse
    application user, and who handles backups and updates?

## Verification (either option)

- postgres-aws suites stay green after any change there: server and client
  `npm run typecheck`, client `npm run build` and `npm test`, server
  `npm test` against a test database.
- Option B backend: unit tests with Dataverse faked (no live calls); a
  contract check comparing the slice's responses from the Postgres server and
  the new backend on equivalent synthetic data; then on a dev environment,
  `deploy-review`, `seed-review`, `verify-review` and a walk through the
  review queue (decide lines, ask and answer a question so the request goes
  to `awaiting_answer` and finishing is blocked, finish a round, confirm a
  stale `linesVersion` is refused).
- Any model or provisioning change: `python3 -B -m unittest discover -s tests
  -v` and the Dataverse `--check` and SetupTests commands.
