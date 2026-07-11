# Playwright + MSW Quickstart

This guide shows how to point `msw-inspector` at a Playwright project that keeps
MSW handlers under `src/mocks/` and API calls under `src/`. It is a **static
inspector layout**: it assumes you already run MSW in the browser or test
process during Playwright. The inspector does **not** trace live browser network
traffic or instrument `page.goto()` — it scans source files for handlers and
supported `fetch` / `axios` calls.

## MSW runtime setup (Playwright)

Wire MSW separately before you run Playwright. A common pattern is a worker
under `src/mocks/browser.ts` and Playwright `webServer` + `baseURL` in
`playwright.config.ts`. That runtime setup is outside this doc; the globs below
only tell `msw-inspector` where to look in your tree.

## Minimal handler file

```ts
// src/mocks/handlers.ts
import { http, HttpResponse } from "msw";

export const handlers = [
  http.get("/api/user", () => {
    return HttpResponse.json({ id: "user-1", name: "Ada" });
  }),
];
```

## Minimal API-call file

```ts
// src/api/user.ts
export async function loadUser() {
  const response = await fetch("/api/user");
  if (!response.ok) {
    throw new Error("Failed to load user");
  }
  return response.json();
}
```

## When to include `e2e/`

Add `e2e/**/*.{ts,tsx}` to `--sources` **only when the Playwright spec itself**
contains supported requests (for example a direct `fetch` or `axios` call). If the
spec only imports app helpers — as in the fixture under
`test/fixtures/playwright-example/` — scanning `src/` is enough because the
`fetch("/api/user")` call lives in application code.

## Run the inspector

Install the package:

```bash
npm install -D msw-inspector-cli
```

The package is `msw-inspector-cli`; the installed binary you run is
`msw-inspector`.

From your project root:

```bash
npx msw-inspector \
  --handlers "src/mocks/**/*.{ts,tsx,js,jsx}" \
  --sources "src/**/*.{ts,tsx,js,jsx}" \
  --exclude "**/node_modules/**" "**/dist/**" "**/coverage/**" "**/build/**" "**/.next/**" "**/.turbo/**" "**/*.d.ts" \
  --base-url "http://localhost:4173" \
  --format text
```

Use `--handlers` for files that export `http.*` or `rest.*` MSW handlers. Use
`--sources` for app modules (and optionally `e2e/` when specs call APIs
directly). `--exclude` **replaces** the built-in defaults, so keep generated
output folders in the list above.

## CI gate

Pick **one** primary gate flag:

- `--fail-on-unmocked` — exits non-zero when any scanned source call has no matching handler.
- `--min-coverage` — exits non-zero when mock coverage falls below the threshold you set (ambiguous calls still reduce the percentage).

Using both together is stricter, but it does **not** require 100% coverage: unmocked calls always fail, while `--min-coverage` only enforces whatever percentage threshold you pass (which can be below 100%).

```bash
npx msw-inspector \
  --handlers "src/mocks/**/*.{ts,tsx,js,jsx}" \
  --sources "src/**/*.{ts,tsx,js,jsx}" \
  --exclude "**/node_modules/**" "**/dist/**" "**/coverage/**" "**/build/**" "**/.next/**" "**/.turbo/**" "**/*.d.ts" \
  --base-url "http://localhost:4173" \
  --report-file msw-inspector.json \
  --format json \
  --fail-on-unmocked
```

Optional: add `--fail-on-empty` when handlers or sources must not scan empty.

## Read the result

An unmocked call means `msw-inspector` found a request in `--sources` with no
matching handler in `--handlers`. A stale handler means a handler exists but no
scanned source currently calls that route.

## Fixture test in this repo

The exact globs above are exercised by
`test/playwright-example.test.ts` against `test/fixtures/playwright-example/`.
Run `npm test` to verify the `/api/user` match is found.
