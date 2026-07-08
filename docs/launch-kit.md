# Launch kit

Use this when the PR is merged, tests are green, and the next npm release is published.

## Positioning

Main sentence:

> MSW Inspector finds the API calls your tests forgot to mock.

Longer version:

> `msw-inspector` is a static analysis CLI for MSW users. It scans app API calls, scans MSW handlers, compares both sides, and reports unmocked calls, stale handlers, unsupported dynamic patterns, and mock coverage for CI.

## Launch checklist

1. Merge the adoption tooling PR.
2. Run `npm run build` and confirm `dist/` is refreshed if the package/action ships generated files.
3. Publish the next npm version.
4. Create the standalone demo repo from `examples/msw-inspector-demo`.
5. Add the demo repo link to the README.
6. Post the announcement.
7. Share in MSW, Vitest, Playwright, React Query, and frontend testing communities.
8. Watch npm downloads, GitHub stars, issues, and real bug reports for 72 hours.

## Announcement post

```md
# MSW Inspector: find the API calls your tests forgot to mock

I built `msw-inspector`, a small static analysis CLI for teams using MSW.

The problem is simple: mock coverage decays quietly.

A feature adds `fetch('/api/billing')`. Nobody adds the MSW handler. Another handler survives long after the app stops calling that endpoint. Tests still pass, but the mock layer no longer matches the app.

`msw-inspector` scans both sides:

- app API calls: `fetch`, Axios, and configured wrapper helpers
- MSW handlers: `http.*` and legacy `rest.*`
- route patterns like `/users/:id`
- relative URLs with an optional base URL

Then it reports:

- unmocked API calls
- stale handlers
- mock coverage percentage
- unsupported dynamic patterns
- file locations
- suggested handler snippets

Install:

```bash
npm install -D msw-inspector-cli
npx msw-inspector init
npx msw-inspector
```

CI example:

```bash
npx msw-inspector \
  --report-file msw-inspector.json \
  --format json \
  --min-coverage 80 \
  --fail-on-unmocked
```

The goal is not to replace MSW, OpenAPI, Pact, or contract tests. The goal is smaller: catch frontend mock drift before it hides inside passing tests.

Repo: https://github.com/felmonon/msw-inspector
Package: `msw-inspector-cli`
```

## Short version

```md
I built `msw-inspector`: a CLI that finds API calls your MSW tests forgot to mock.

It scans frontend API calls, scans MSW handlers, then reports unmocked calls, stale handlers, mock coverage %, file locations, and suggested handler snippets.

```bash
npm install -D msw-inspector-cli
npx msw-inspector init
npx msw-inspector
```

Useful for Vite, Next.js, Vitest, Playwright, React Query, and CI.

Repo: https://github.com/felmonon/msw-inspector
```

## Hacker News / Reddit title ideas

- Show HN: MSW Inspector — find API calls your tests forgot to mock
- I built a CLI that checks whether your MSW mocks cover your app API calls
- Stop letting MSW mock coverage decay quietly
- Static MSW coverage checks for frontend tests

## Dev.to / blog title ideas

- Your MSW mocks are probably stale. Here is how to check.
- Finding unmocked API calls before CI lies to you
- A small static analyzer for MSW mock coverage

## First 72-hour response plan

When people reply, ask for concrete examples:

- Which stack are you using?
- What API helper shape does your app use?
- Which call or handler did the scanner miss?
- Can you share a tiny fixture?

Turn those into small fixtures and releases. The fastest path to adoption is not more features. It is fewer false positives and clearer examples.
