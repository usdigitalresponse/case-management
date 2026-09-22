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

Server-side data layer, intake handler, and HTTP API (routes + auth) are
built and tested. Not yet built: the React client, Docker Compose, and
Terraform. See `MAPPING.md` for the schema subset in scope and documented
gaps, and `../../docs/case-intake-comparison-plan.md` for how this relates
to the Dataverse comparison.

## Scope

In scope: create a case (existing person, opening status/effective timestamp,
optional context and identifier) per `../../model/forms.yaml:new_case`; view a
saved case; a basic case list/detail view. See `../../scenarios/new-case.md`
for the acceptance scenarios this implementation targets.

Out of scope: person creation/duplicate review, closing/reopening,
assignments, time/expense, billing, invoicing, documents, and production-grade
auth/SSO. See `MAPPING.md` for details.

## Setup

Requires Node 20+ (see `server/.node-version`) and a local Postgres — easiest
via Docker, since no `docker-compose.yml` exists yet:

```sh
docker run -d --name case-management-postgres-aws-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=case_management_postgres_aws \
  -p 5432:5432 postgres:15-alpine

cd server
npm install
npm run migrate   # applies migrations/*.sql (generated from src/db/schema.ts)
npm run seed       # loads synthetic reference data + fixture people/accounts
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
npm run db:generate            # regenerate migrations/*.sql after editing src/db/schema.ts
```

### Running the API server

Against the dev DB from Setup above:

```sh
cd server
npm run dev   # tsx watch src/app.ts, http://localhost:3000
```

Without `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` set, Google sign-in is
disabled and only `/auth/dev-login` is available (see MAPPING.md — this
bypass never mounts when `NODE_ENV=production`). A quick smoke test:

```sh
curl -c cookies.txt -X POST http://localhost:3000/auth/dev-login
curl -b cookies.txt http://localhost:3000/auth/me
curl -b cookies.txt http://localhost:3000/api/cases
```

Routes: `POST /api/cases` (intake), `GET /api/cases` (list, optional
`countyId`/`statusId`/`caseCategoryId` query filters), `GET /api/cases/:id`
(detail with participants/lifecycle events/identifiers), `GET /api/people?q=`
(existing-person search for the intake form). All require a session
(`requireAuth`).

## Deploy

_To be filled in alongside the Terraform configuration (not yet built)._

## Documented gaps

See `MAPPING.md` for the full list (auth, person creation, infrastructure,
reference data). In short: this is a dev/demo-scoped prototype, not a
production deployment — there is no React client or infra yet, only the API
server (`server/src/app.ts`) and its data layer.
