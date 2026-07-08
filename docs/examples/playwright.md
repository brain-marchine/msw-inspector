# Playwright + MSW Quickstart

This example shows how to use `msw-inspector` with a Playwright project that uses MSW to mock browser-visible API calls.

## Minimal layout

```text
mocks/
  handlers.ts
tests/
  user.spec.ts
src/
  api/user.ts
msw-inspector.config.cjs
```

## Handler file

```ts
// mocks/handlers.ts
import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('/api/user', () => {
    return HttpResponse.json({ id: 'user-1', name: 'Ada' })
  }),
]
```

## App API file

```ts
// src/api/user.ts
export async function loadUser() {
  const response = await fetch('/api/user')
  return response.json()
}
```

## Config

```js
/** @type {import('msw-inspector-cli').MswInspectorConfig} */
module.exports = {
  handlers: ['mocks/**/*.{ts,tsx,js,jsx}'],
  sources: ['src/**/*.{ts,tsx,js,jsx}', 'tests/**/*.{ts,tsx,js,jsx}'],
  exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],
  baseUrl: 'http://localhost:3000',
}
```

## Run locally

```bash
npx msw-inspector
```

## Run in CI

```bash
npx msw-inspector \
  --report-file msw-inspector.json \
  --format json \
  --fail-on-unmocked
```

Then publish the result with the GitHub Action:

```yaml
- uses: felmonon/msw-inspector-action@v1
  with:
    summary-file: msw-inspector.json
    comment: true
    annotate: true
```

## Read the result

An unmocked call means Playwright or app code can reach an API route that has no matching MSW handler. Add a handler, or narrow `sources` if the call is outside the test surface.

A stale handler means a mock exists but no scanned source currently calls that route. Remove it if obsolete, or expand `sources` if another test/helper still uses it.
