# Next.js + MSW Quickstart

This example shows how to point `msw-inspector` at a common Next.js project
that keeps request handlers under `mocks/` and API calls under `app/` or `src/`.

## Minimal handler file

```ts
// mocks/handlers.ts
import { http, HttpResponse } from "msw";

export const handlers = [
  http.get("/api/user", () => {
    return HttpResponse.json({ id: "user-1", name: "Ada" });
  }),
];
```

## Minimal API-call file

```tsx
// app/users/page.tsx
async function loadUser() {
  const response = await fetch("/api/user", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load user");
  }
  return response.json();
}

export default async function UsersPage() {
  const user = await loadUser();
  return <pre>{JSON.stringify(user, null, 2)}</pre>;
}
```

## Run the inspector

Install the package:

```bash
npm install -D msw-inspector-cli
```

Then run the binary from your project root:

```bash
npx msw-inspector \
  --handlers "mocks/**/*.{ts,tsx,js,jsx}" \
  --sources "app/**/*.{ts,tsx,js,jsx}" "src/**/*.{ts,tsx,js,jsx}" \
  --exclude "**/node_modules/**" "**/.next/**" "**/dist/**" "**/*.d.ts" \
  --base-url "http://localhost:3000" \
  --format text
```

Use `--handlers` for files that export `http.*` or `rest.*` MSW handlers. Use
`--sources` for route files, shared modules, and test helpers that make `fetch`
or supported `axios` calls. Scanning both `app/` and `src/` works well when a
project is midway through a router or folder migration.

The `--base-url` option helps when your handlers and calls stay relative, such
as `/api/user`, but you still want them resolved against the same origin.

## Common layouts

If your project keeps handlers somewhere more specific, narrow the glob instead
of broadening the source scan:

```bash
# App Router with handlers in mocks/
npx msw-inspector \
  --handlers "mocks/**/*.{ts,tsx}" \
  --sources "app/**/*.{ts,tsx}" "src/**/*.{ts,tsx}"

# Pages Router with handlers in src/mocks/
npx msw-inspector \
  --handlers "src/mocks/**/*.{ts,tsx}" \
  --sources "pages/**/*.{ts,tsx}" "src/**/*.{ts,tsx}"
```

## Read the result

An unmocked call means `msw-inspector` found a request in `--sources` that has no
matching handler in `--handlers`. Add a handler or narrow the source glob if the
call is outside the test surface.

A stale handler means a handler exists but no scanned source currently calls
that route. Remove it if it is obsolete, or expand the source glob if another
test or setup file still uses it.

For CI, switch to JSON output:

```bash
npx msw-inspector \
  --handlers "mocks/**/*.{ts,tsx,js,jsx}" \
  --sources "app/**/*.{ts,tsx,js,jsx}" "src/**/*.{ts,tsx,js,jsx}" \
  --report-file msw-inspector.json \
  --format json
```
