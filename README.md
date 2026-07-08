# msw-inspector

[![npm version](https://img.shields.io/npm/v/msw-inspector-cli?label=npm)](https://www.npmjs.com/package/msw-inspector-cli)
[![CI](https://github.com/felmonon/msw-inspector/actions/workflows/ci.yml/badge.svg)](https://github.com/felmonon/msw-inspector/actions/workflows/ci.yml)
[![Node](https://img.shields.io/node/v/msw-inspector-cli)](https://www.npmjs.com/package/msw-inspector-cli)
[![types](https://img.shields.io/npm/types/msw-inspector-cli)](https://www.npmjs.com/package/msw-inspector-cli)
[![license](https://img.shields.io/github/license/felmonon/msw-inspector)](./LICENSE)

Find the API calls your tests forgot to mock.

`msw-inspector` scans your MSW handlers and your application API calls, compares both sides, and reports what is covered, what is unmocked, which mocks look stale, and which patterns need a clearer static shape.

## Why this exists

Mock coverage usually decays quietly:

- a feature adds `fetch('/billing')` but no matching MSW handler
- an old handler survives after the app stops calling that endpoint
- relative URLs and origin-specific URLs drift apart
- tests pass, but the mock surface is no longer honest

`msw-inspector` makes that drift visible. It is intentionally static and conservative: when it cannot understand a dynamic pattern, it reports the pattern as unsupported instead of guessing.

## Install

```bash
npm install -D msw-inspector-cli
```

The npm package is published as `msw-inspector-cli` because the original `msw-inspector` name is already taken on the registry. The installed binary remains `msw-inspector`.

## Quick start

Create a starter config:

```bash
npx msw-inspector init
```

Then run it from the project root:

```bash
npx msw-inspector
```

Or run without installing first:

```bash
npx msw-inspector-cli
```

For CI, write the full report and fail on the rules that matter to your project:

```bash
npx msw-inspector \
  --report-file msw-inspector.json \
  --format json \
  --min-coverage 80 \
  --fail-on-unmocked
```

## Config file

`npx msw-inspector init` creates `msw-inspector.config.cjs`:

```js
/** @type {import('msw-inspector-cli').MswInspectorConfig} */
module.exports = {
  handlers: ['src/mocks/**/*.{ts,tsx,js,jsx}', 'mocks/**/*.{ts,tsx,js,jsx}'],
  sources: ['src/**/*.{ts,tsx,js,jsx}', 'app/**/*.{ts,tsx,js,jsx}'],
  baseUrl: 'http://localhost:3000',
  apiWrappers: [
    { name: 'api.get', method: 'GET', urlArg: 0 },
    { name: 'api.post', method: 'POST', urlArg: 0 },
    { name: 'request', urlArg: 0, methodFrom: 'options.method', optionsArg: 1 },
  ],
}
```

Supported config files:

- `msw-inspector.config.cjs`
- `msw-inspector.config.js`
- `msw-inspector.config.mjs`
- `msw-inspector.config.json`

Use `--config ./path/to/config.cjs` for a custom path. See [`docs/configuration.md`](docs/configuration.md).

## Terminal demo

Screenshot-friendly text output:

```text
$ npx msw-inspector --base-url https://api.example.com --min-coverage 80
✓ 4 handlers found
✓ 6 API calls found
✗ 2 unmocked endpoints
✓ 0 stale mocks

Coverage: 66.7% (4/6)

Unmocked API calls
  ✗ POST https://api.example.com/billing
    Found in: src/features/billing/checkout.ts:42:13
    Suggested handler:
      http.post('/billing', () => {
        return HttpResponse.json({})
      })
```

Use `--format json` when you want the full report for CI, dashboards, or the companion GitHub Action.

## Matching example

Given these handlers:

```ts
import { http } from 'msw'

export const handlers = [
  http.get('/users/:id', () => null),
  http.post('/checkout', () => null),
]
```

And these API calls:

```ts
import axios from 'axios'

await fetch('https://api.example.com/users/123?include=profile')
await axios.post('/checkout')
await fetch('/billing')
```

`msw-inspector` reports two covered calls and one unmocked call. Route parameters and query strings are normalized, so `/users/:id` matches `/users/123?include=profile`.

If your app uses relative URLs but you want origin-aware matching, set `--base-url`:

```bash
npx msw-inspector --base-url https://api.example.com
```

That resolves relative handlers and API calls against one canonical origin, which is useful when the same pathname exists on multiple backends.

## Useful flags

```bash
npx msw-inspector \
  --handlers "src/**/*.{ts,tsx,js,jsx,mts,mjs,cjs}" \
  --sources "src/**/*.{ts,tsx,js,jsx,mts,mjs,cjs}" \
  --exclude "**/dist/**" "**/*.d.ts" \
  --base-url "https://api.example.com" \
  --report-file msw-inspector.json \
  --format text
```

For copy-paste setups, see:

- [`docs/examples/vite-vitest.md`](docs/examples/vite-vitest.md)
- [`docs/examples/nextjs.md`](docs/examples/nextjs.md)
- [`docs/examples/playwright.md`](docs/examples/playwright.md)
- [`docs/examples/react-query.md`](docs/examples/react-query.md)

Common CI gates:

```bash
npx msw-inspector --min-coverage 90
npx msw-inspector --fail-on-unmocked
npx msw-inspector --fail-on-stale
```

## JSON report

The JSON report written by `--report-file` includes a stable schema version and a summary:

```json
{
  "schemaVersion": 1,
  "summary": {
    "mockedCalls": 23,
    "totalCalls": 31,
    "usedHandlers": 20,
    "totalHandlers": 23,
    "staleHandlers": 3,
    "unmockedCalls": 8,
    "percentage": 74.2
  }
}
```

## GitHub Action

The CLI ships with a matching GitHub Action wrapper in a separate repository: [`felmonon/msw-inspector-action`](https://github.com/felmonon/msw-inspector-action). It reads the JSON report that the CLI already produced, writes a job summary, can create annotations, and can optionally upsert one sticky PR comment.

Marketplace listing: [`MSW Inspector`](https://github.com/marketplace/actions/msw-inspector)

```yaml
name: msw coverage

on:
  pull_request:
  push:

jobs:
  inspect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx msw-inspector --report-file msw-inspector.json --format json
      - uses: felmonon/msw-inspector-action@v1
        with:
          summary-file: msw-inspector.json
          comment: true
          annotate: true
```

For baseline/delta reporting, pass a previous `msw-inspector.json` as `baseline-file`. See [`docs/ci-delta.md`](docs/ci-delta.md).

## Node API

```ts
import { analyzeProject, formatCoverageReport } from 'msw-inspector-cli'

const report = await analyzeProject({
  cwd: process.cwd(),
  baseUrl: 'https://api.example.com',
  apiWrappers: [
    { name: 'api.get', method: 'GET', urlArg: 0 },
  ],
})

console.log(formatCoverageReport(report))
```

## Supported patterns

The first release is intentionally narrow:

- `msw` `http.*` handlers
- legacy `msw` `rest.*` handlers
- handler matchers from string literals, static template literals, static `const`s, `new URL(...).href`, `new URL(...).toString()`, and `String(new URL(...))`
- `fetch(...)`, `window.fetch(...)`, `globalThis.fetch(...)`
- common `axios` call shapes, including `axios.get(...)`, `axios.request(...)`, `axios(...)`, and same-file `axios.create(...)` instances
- configured wrapper helpers such as `api.get('/x')` or `request('/x', { method: 'POST' })`

Unsupported dynamic or ambiguous patterns are included in the report so you can decide whether to simplify the code, add explicit handlers, configure a wrapper, or ignore the pattern.

## What this is not

`msw-inspector` does not replace MSW, OpenAPI, Pact, or contract testing. It is a fast static check for frontend mock drift. See [`docs/why-not-contract-testing.md`](docs/why-not-contract-testing.md).

## Limitations

- It does not execute application code.
- It does not resolve cross-file constants or imported axios instances.
- It does not analyze GraphQL, WebSocket, or SSE handlers.
- It reports dynamic or ambiguous patterns as unsupported instead of guessing.

## Project health

- [Security policy](./SECURITY.md)
- [Support guide](./SUPPORT.md)
- [Code of conduct](./CODE_OF_CONDUCT.md)

## Local development

```bash
npm install
npm test
npm run typecheck
npm run build
```

If you are changing the scanning logic, keep the test fixtures small and explicit. The tool is more useful when it stays opinionated.

## Contributing

`msw-inspector` is open to focused contributions that improve real MSW coverage workflows. The strongest issues include a small handler/API-call example, the command that was run, and the expected coverage result.

Start with [CONTRIBUTING.md](./CONTRIBUTING.md) and the [roadmap](./ROADMAP.md). Good first contributions include framework examples, focused scanner fixtures, clearer unsupported-pattern messages, and docs that help teams add the CLI to CI.
