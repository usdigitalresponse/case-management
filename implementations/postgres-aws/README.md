# Postgres + AWS implementation (React frontend)

A production-shaped prototype of the canonical model (`../../model/`), scoped to
case intake and a few core read screens. This is a separate track from
`../dataverse/`, which compares native-form, Power Fx and React UIs against a
Dataverse backend; this implementation instead evaluates a conventional
React + Node/Express + Postgres stack deployed on AWS.

Modeled on two prior USDR applications of similar shape: `usdr-gost` and
`arpa-reporter` (Express/Postgres servers, Terraform-managed AWS infra, Docker
Compose for local development) — with TypeScript and Drizzle ORM instead of
Knex; see `MAPPING.md`'s "Stack" section for why.

## Status

Server-side data layer, intake handler, HTTP API (routes + auth), the React
client (case list/detail, intake form), and local Docker Compose loop are
built. Terraform is an undeployed infrastructure skeleton. See `MAPPING.md`
for the schema subset in scope and documented gaps, and
`../../docs/case-intake-comparison-plan.md` for how this relates to the
Dataverse comparison.

## Scope

In scope: create a case (existing person, opening status/effective timestamp,
optional context and identifier) per `../../model/forms.yaml:new_case`; view a
saved case; a basic case list/detail view. See `../../scenarios/new-case.md`
for the acceptance scenarios this implementation targets.

Out of scope: person creation/duplicate review, closing/reopening,
assignments, time/expense, billing, invoicing, documents, and production-grade
auth/SSO. See `MAPPING.md` for details.

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

Without a `.env` file (copy
`.env.example`), Google sign-in is disabled and only the "Demo sign-in"
(staff) and "Demo partner sign-in" (external partner, who is also their
office's billing delegate) buttons work.

Open http://localhost:5173, click "Demo sign-in," and you should see 10
seeded cases with synthetic (Faker-generated) client names on the overview.
Cases are grouped by derived stage (Needs assignment, Represented, Billing,
Closing). Select a card for details or View all to open the case list.
Unavailable tools and stages are shown as disabled controls.

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
npm run verify-schema-mapping  # checks src/db/schema.ts against model/schema.yaml
npm run demo-invoices          # read-only: writes ../demo-invoices/ files naming the seeded demo vendors
npm run generate-sample-pdfs   # regenerates the synthetic PDFs and their expected values in scenarios/fixtures/invoices/
npm run extraction-accuracy    # scores PDF extraction methods against those samples, field by field
npm run extract-invoice -- f   # shows what import would read from invoice files (no database); --json or --csv for tools and spreadsheets
npm run db:generate            # regenerate migrations/*.sql after editing src/db/schema.ts
```

`demo-invoices` needs the demo seed. Its files name the seeded vendors, so
uploading one under "Demo partner sign-in" shows timekeeper matching; the
command prints which case to open. The files are regenerated rather than
committed because the seed's Faker names change with the seed. Portable
samples with expected results are in `scenarios/fixtures/invoices/`.

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
also their office's billing delegate). Each
is off when `NODE_ENV=production` unless `DEMO_LOGIN_ENABLED=true` or
`EXTERNAL_DEMO_LOGIN_ENABLED=true` (see MAPPING.md, "Demo sign-in"). A
quick smoke test:

```sh
curl -c cookies.txt -X POST http://localhost:3000/auth/demo-login
curl -b cookies.txt http://localhost:3000/auth/me
curl -b cookies.txt http://localhost:3000/api/cases
```

Routes: `POST /api/cases` (intake), `GET /api/cases` (list, optional
`countyId`/`statusId`/`caseCategoryId` query filters), `GET /api/cases/:id`
(detail with participants/lifecycle events/identifiers), `GET /api/people?q=`
(existing-person search for the intake form), `GET /api/reference-data`
(statuses/categories/roles/etc. for building forms). All require a session
(`requireAuth`).

### Running the client without Docker Compose

```sh
cd client
npm install
API_PROXY_TARGET=http://localhost:3000 npm run dev   # http://localhost:5173
npm run typecheck
npm test        # unit tests for client-side logic (no browser, no server)
npm run build   # production build; verifies USWDS asset resolution
```

`API_PROXY_TARGET` defaults to `http://localhost:3000`, so it can usually be
omitted when the server is running locally too (not in a container).

## CI

`.github/workflows/postgres-aws.yml` runs on PRs/pushes touching this
directory: `server` (typecheck, migrate, test, schema-mapping check),
`client` (typecheck, build), and `compose-smoke-test` (a real
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

See `MAPPING.md` for the full list (auth, person creation, infrastructure,
reference data). In short: this is a dev/demo-scoped prototype, not a
production deployment. Terraform is an undeployed skeleton; Docker Compose
is the runnable development environment.
