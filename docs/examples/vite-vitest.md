# Vite + Vitest + MSW Quickstart

This example shows how to point `msw-inspector` at a common Vite/Vitest project
that keeps MSW handlers beside test setup code and API calls beside application
code.

## Minimal handler file

```ts
// src/test/handlers.ts
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

## Run the inspector

Install the package:

```bash
npm install -D msw-inspector-cli
```

Then run the binary from your project root:

```bash
npx msw-inspector \
  --handlers "src/test/**/*.{ts,tsx,js,jsx}" \
  --sources "src/**/*.{ts,tsx,js,jsx}" \
  --exclude "**/node_modules/**" "**/dist/**" "**/*.d.ts" \
  --base-url "http://localhost:5173" \
  --format text
```

Use `--handlers` for files that export `http.*` or `rest.*` MSW handlers. Use
`--sources` for app and test files that make `fetch` or supported `axios` calls.
The `--base-url` option lets relative calls such as `/api/user` and relative
handlers resolve against the same origin.

## Read the result

An unmocked call means `msw-inspector` found a request in `--sources` that has no
matching handler in `--handlers`. Add a handler or narrow the source glob if the
call is outside the test surface.

A stale handler means a handler exists but no scanned source currently calls
that route. Remove it if it is obsolete, or expand the source glob if another
test file still uses it.

For CI, switch to JSON output:

```bash
npx msw-inspector \
  --handlers "src/test/**/*.{ts,tsx,js,jsx}" \
  --sources "src/**/*.{ts,tsx,js,jsx}" \
  --report-file msw-inspector.json \
  --format json
```
