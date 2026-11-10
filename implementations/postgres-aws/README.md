# Postgres + AWS implementation (React frontend)

A production-shaped prototype of the canonical model (`../../model/`): an
invoice review tool designed to sit beside an external case management system
(see "Current Focus" in `../../docs/PRODUCT.md`). It is the most complete
implementation. The separate `../dataverse/` track loads the same model into a
Dataverse app for schema review; this one evaluates a conventional
React + Node/Express + Postgres stack deployed on AWS.

Modeled on two prior USDR applications of similar shape: `usdr-gost` and
`arpa-reporter` (Express/Postgres servers, Terraform-managed AWS infra, Docker
Compose for local development) — with TypeScript and Drizzle ORM instead of
Knex; see `MAPPING.md`'s "Stack" section for why.

## Status

Server-side data layer, HTTP API (routes + auth), the React client and the
local Docker Compose loop are built. The client covers the invoice review
queue and review, questions to submitters, sign-off, exports and the billing
record; cases, people, providers, clients and organizations; pre-authorization
requests; settings; and the external submitter portal. A single-host
production-mode stack runs the demo; Terraform is an undeployed infrastructure
skeleton. See `MAPPING.md` for the schema subset in scope and documented
gaps, and `docs/` for how the client, intake and API are built.

## Scope

In scope, with the acceptance scenarios this implementation targets:

- invoice upload, import and entry by external submitters and staff, and
  line-by-line review with questions, rates and sign-off
  (`../../scenarios/invoice-review.md`, `../../scenarios/payment-request.md`,
  `../../scenarios/invoice-import-export.md`);
- pre-authorization requests, county thresholds and overruns
  (`../../scenarios/preauthorization.md`);
- cases as review needs them: created from an invoice or directly, matched to
  invoices, with their providers, rates and pre-authorized amounts. The
  earlier direct case intake (`../../scenarios/new-case.md`) still works by
  address but is off the sidebar.

Out of scope: duplicate review of people, reopening closed cases, time and
expense tracking outside invoices, payment, integration with an external case
management system (its links are inert placeholders), and production sign-in
decisions. Uploaded invoice files are temporary working copies; only
providers' CVs, fee schedules and quotes are kept. See `MAPPING.md` for
details.

## Setup

Fastest path — requires only Docker:

```sh
docker compose up
```

This starts Postgres, the server, and the client together: the server
container runs `npm install`, applies migrations, then starts `npm run dev`
(file-watching) on
http://localhost:3000; the client container runs `npm install && npm run
dev` on http://localhost:5173, proxying `/api` and `/auth` to the server
container. Restarts preserve existing records. Once the server is running,
initialize demo data explicitly in a second terminal:

```sh
docker compose exec server npm run seed
```

**`npm run seed` is a destructive demo reset:** it deletes all application
data and creates synthetic reference data plus 10 demo cases. Run it only
for initial setup or when intentionally resetting the demo database.
Wherever the staff demo sign-in is on, Settings has a Demo section: any staff
member can switch their own role there, and administrators can do the same
reset ("Reset demo data", after a confirmation), which signs them out.

Without a `.env` file (copy
`.env.example`), Google sign-in is disabled and only the "Demo sign-in"
(staff, also an administrator who can review, sign off and change Settings)
and "Demo partner sign-in" (external partner, who is also their office's
billing delegate) buttons work.

Open http://localhost:5173 and click "Demo sign-in." The staff app opens on
the invoice review queue, filtered to invoices assigned to you; choose "To
review" for everyone's. The seed leaves invoices signed off, waiting for
sign-off, part-reviewed, assigned and unassigned, one waiting past the
callout and one billed above the configured rate. Three are yours: one
part-reviewed and waiting for the sender's answer to your question, one
just submitted and billed above the configured rate, and one another
reviewer finished, with a changed rate, for you to sign off. Settings has the demo
reviewers' and approver's roles, the sign-off default and the callout
threshold. The demo partner also has invoices uploaded as synthetic PDFs
(`src/db/demoUploads.ts`): one not yet checked, one with a changed and a
removed line, one misread, one sent with changes for review beside its file,
one entered by hand, and staff have an upload waiting on Intake for a case.
The sidebar's Cases group has the case overview board and all cases. Links
to an external case management system are disabled placeholders. See
`docs/api.md` "Invoice review".

If you pulled these changes onto an existing database, restart the server
container (`docker compose restart server`) to apply the new migrations;
existing data stays. Reseed only if you want the review demo data.

`docker compose down -v` stops everything and removes the Postgres volume
(a clean-slate reset); drop `-v` to keep data across restarts.

### Without Docker Compose

Requires Node 24+ (pinned in `mise.toml` for mise users; `server/.nvmrc` for nvm) and a local Postgres:

```sh
docker run -d --name case-management-postgres-aws-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=case_management_postgres_aws \
  -p 5432:5432 postgres:15-alpine

cd server
npm install
npm run migrate   # applies migrations/*.sql (generated from src/db/schema.ts)
npm run seed       # DESTRUCTIVE reset: replaces all application data with demo fixtures
```

Default connection strings (overridable via `DATABASE_URL`) assume
`postgres://postgres:postgres@localhost:5432/case_management_postgres_aws`.

### Running tests

Tests run against a **separate** database so they can freely truncate tables
between runs without touching your dev data:

```sh
docker run -d --name case-management-postgres-aws-test-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=case_management_postgres_aws_test \
  -p 5433:5432 postgres:15-alpine

cd server
DATABASE_URL="postgres://postgres:postgres@localhost:5433/case_management_postgres_aws_test" npm run migrate
TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5433/case_management_postgres_aws_test" npm test
```

Each test resets and reseeds baseline fixtures itself (`src/db/fixtures.ts`,
shared with `npm run seed`), so tests can run in any order against a
migrated-but-empty test database.

### Other useful commands

```sh
npm run typecheck              # tsc --noEmit
npm run lint                   # eslint (eslint.config.mjs); also in client/
npm run verify-schema-mapping  # checks src/db/schema.ts against model/schema.yaml
npm run demo-invoices          # read-only: writes ../demo-invoices/ files naming the seeded demo vendors
npm run demo-time-logs         # read-only: writes ../demo-invoices/time-logs/ case time logs, with expected results, for seeded invoices
npm run generate-sample-pdfs   # regenerates the synthetic PDFs and their expected values in scenarios/fixtures/invoices/
npm run extraction-accuracy    # scores PDF extraction methods against those samples, field by field
npm run extraction-accuracy -- --samples ../local-samples   # scores real files kept outside Git against their expected.json, figures only
npm run extract-invoice -- f   # shows what import would read from invoice files (no database); --json or --csv for tools and spreadsheets
npm run db:generate            # regenerate migrations/*.sql after editing src/db/schema.ts
```

`demo-invoices` needs the demo seed. Its files name the seeded vendors, so
uploading one under "Demo partner sign-in" shows timekeeper matching; the
command prints which case to open. The files are regenerated rather than
committed because the seed's Faker names change with the seed.
`demo-time-logs` likewise writes one case's time log per file, in an
external case management system's export layout, against fixed seeded
invoices, with a `README.md` of what review should show for each; it fails
if the seeded lines it targets have changed. Portable
samples with expected results are in `scenarios/fixtures/invoices/`.

Real invoices for local testing go in the gitignored `../local-samples/`,
never in Git or a fixture. Scanned PDFs are read by in-process text
recognition (tesseract.js with bundled language data; no system install or
download). To score them, write `local-samples/expected.json` by hand with
each file's printed figures; the format is at the top of
`scripts/extraction-accuracy.ts`.

PDF uploads are read in the background and the review screens show
progress.

Improving accuracy with AI: the in-app reader uses layout rules and text
recognition only, so handwriting, unusual layouts and poor scans still need
hand entry. Adopters can add an AI reading method, such as a vision
language model or a cloud document-extraction service, as another entry in
`EXTRACTORS` (`server/src/imports/extractors/index.ts`), chosen with
`INVOICE_EXTRACTOR` in place of the in-app reader. Using it only as a second
pass, for files the in-app reader can't read or whose figures don't add up,
is cheaper but needs the import pipeline to call it after the first; that
isn't built yet. Before adopting one:

- Run it within the organization's processing boundary (its own cloud
  account or hosts), mark it `inBoundary`, and agree its hosting cost and
  licence first. A small model tried here needed a GPU host
  (`docs/invoice-import-export-plan.md`, "Future work").
- Ask for a fixed output schema and treat what comes back as untrusted
  suggestions: keep the same reconciliation warnings, page locations and
  side-by-side review, and never let a model confirm or submit anything.
- Score it against the same files as the in-app reader (`npm run
  extraction-accuracy`, with and without `--samples ../local-samples`),
  including `pdf-letter-injected.pdf`, whose small print tries to instruct
  an AI reader.

### Running the API server

`docker compose up` already does this. Without Docker Compose, against the
dev DB from Setup above:

```sh
cd server
npm run dev   # tsx watch src/app.ts, http://localhost:3000
```

Without `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` set, Google sign-in is
disabled and only the demo sign-ins are available: `/auth/demo-login`
(staff) and `/auth/demo-login/external` (a seeded external partner, who is
also their office's billing delegate). The sign-in page lets you pick any
seeded staff role or partner from a dropdown (`GET /auth/demo-accounts`). Each
is off when `NODE_ENV=production` unless `DEMO_LOGIN_ENABLED=true` or
`EXTERNAL_DEMO_LOGIN_ENABLED=true` (see `docs/api.md`, "Demo sign-in"). A
quick smoke test:

```sh
curl -c cookies.txt -X POST http://localhost:3000/auth/demo-login
curl -b cookies.txt http://localhost:3000/auth/me
curl -b cookies.txt http://localhost:3000/api/cases
```

Routes are in `server/src/routes/`, one file per area, mounted in
`server/src/app.ts`; `docs/api.md` describes them. Staff
routes need a staff session (`requireFullUser`), `/api/portal` and
`/api/preauthorizations` any session (`requireAuth`), and settings changes
an administrator (`requireAdmin`).

### Running the client without Docker Compose

```sh
cd client
npm install
API_PROXY_TARGET=http://localhost:3000 npm run dev   # http://localhost:5173
npm run typecheck
npm run lint
npm test        # unit tests for client-side logic (no browser, no server)
npm run build   # production build; verifies USWDS asset resolution
```

`API_PROXY_TARGET` defaults to `http://localhost:3000`, so it can usually be
omitted when the server is running locally too (not in a container).

## CI

`.github/workflows/postgres-aws.yml` runs on PRs/pushes touching this
directory: `server` (typecheck, lint, migrate, test, schema-mapping check),
`client` (typecheck, lint, test, build), and `compose-smoke-test` (a real
`docker compose up` + explicit demo seed + demo-login/list-cases round trip,
followed by a restart check that verifies case IDs are preserved).

## Deploy

### Single-host demo stack

`docker-compose.prod.yml` runs the production build on one host:
Postgres, the compiled server (`server/Dockerfile`; applies migrations on
every start) and Caddy (`client/Dockerfile`, `client/Caddyfile`), which
serves the built client, proxies `/api` and `/auth`, and obtains an HTTPS
certificate when `SITE_ADDRESS` is a hostname. It uses its own Compose
project name, so its containers and data never touch the dev stack's.
Sign-in is the staff and partner demo sign-ins (`DEMO_LOGIN_ENABLED` and
`EXTERNAL_DEMO_LOGIN_ENABLED` in `.env.prod`); SSO and SES are not
configured.

To try it locally on http://localhost:

```sh
cp .env.prod.example .env.prod   # then fill in the two secrets
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod exec server node dist/src/db/seed.js
```

Restarts and rebuilds keep all data. The seed command is the same
destructive demo reset as `npm run seed`: it deletes everything,
including records users entered, and recreates the synthetic demo data.
With `DEMO_LOGIN_ENABLED=true`, any administrator can run it from Settings
too.
`docker compose -f docker-compose.prod.yml --env-file .env.prod down -v`
removes the stack and all its data.

`deploy/ec2/` provisions one EC2 instance for this stack with Terraform
and deploys it over SSH; see its README.

### Full AWS skeleton

`terraform/` is a single-environment (`sandbox.tfvars`) infra skeleton —
VPC, RDS Postgres, ECS Fargate + ALB, ECR, S3 + CloudFront, Secrets
Manager. It has been `validate`d and `plan`-checked but **never applied**;
see `MAPPING.md`'s "Infrastructure" section for what's deliberately missing
before this could serve real traffic (no CI/CD image pipeline, empty
Google OAuth secrets, HTTP-only, etc.).

```sh
cd terraform
terraform init
terraform plan -var-file=sandbox.tfvars    # review before ever applying
```

Applying this creates real AWS resources and costs money — don't run
`terraform apply` without deciding that deliberately.

## Documented gaps

See `MAPPING.md` for the full list (auth, duplicate review of people,
infrastructure, reference data). In short: this is a dev/demo-scoped
prototype, not a production deployment. Terraform is an undeployed skeleton;
Docker Compose is the runnable development environment.

## Next steps

What the notes already record as not built, nearest first. None is decided
or scheduled here; each links to where it is described.

1. Production sign-in: which identity provider staff use, and how external
   senders are allowed in (`MAPPING.md` "Known gaps", Auth).
2. Scan uploaded files for malware before reading them, which
   `validate_invoice_import` requires (`MAPPING.md` "Known gaps", Upload
   scanning).
3. Email a submitter when a reviewer's question is waiting (`MAPPING.md`
   "Known gaps", Review questions).
4. A holiday calendar, so working days skip holidays as well as weekends
   (`docs/api.md` "Invoice review").
5. One lines table for submitters, in place of two (`MAPPING.md` "Known
   gaps", Cleanup).
6. A second reading pass for files the in-app reader can't read ("Improving
   accuracy with AI" above), with its hosting cost agreed first.
7. Links to the external case management system, now inert placeholders
   (`../../docs/integration.md`).
8. Hosting beyond the single-host demo: `terraform/` has never been applied
   (`MAPPING.md` "Infrastructure").
9. Duplicate review of people, and reopening closed cases ("Scope" above).
