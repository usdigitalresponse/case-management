# End-to-end tests

Playwright drives Chromium and WebKit (Safari's engine) through the running
app: a sender uploads, checks and sends an invoice, then a reviewer decides
its lines and finishes the review. They sign in with the demo sign-ins and
pick seeded synthetic accounts by role.

Each run **adds a synthetic invoice** to the database it points at, so run
it only against data you can lose. CI starts a fresh stack, seeds it and
throws it away (the `end-to-end` job in `.github/workflows/postgres-aws.yml`).

Locally, with a seeded app at http://localhost:5173 (or `E2E_BASE_URL`):

```sh
cd e2e
npm ci
npm run install-browsers   # Chromium and WebKit, a few hundred MB
npm test                   # or: npx playwright test --project=chromium
```

A failed run keeps a trace in `test-results/`; open it with
`npx playwright show-trace <path>`.

Page-level rules (saving before acting, the true-and-correct statement, a
stale `linesVersion`) are tested faster without a browser, in the client's
`*.test.tsx` files against `client/src/test/fakeApi.ts`.
