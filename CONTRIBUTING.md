# Contributing to msw-inspector

Thanks for helping improve `msw-inspector`. This project is focused on one practical problem: finding drift between the API calls an app makes and the MSW handlers that are supposed to cover those calls.

## Good first contributions

The best starter issues are labeled `good first issue` or `help wanted`. Before opening a pull request, comment on the issue you want to take so duplicated work is easy to avoid.

Useful contribution areas:

- Small docs examples for real MSW setups.
- Minimal test fixtures for uncovered handler or API call patterns.
- Clear bug reports with a small reproduction.
- Improvements to CLI output that make unsupported patterns easier to act on.

## Development setup

Requirements:

- Node.js 18.18 or newer
- npm

Install dependencies:

```bash
npm install
```

Run the local checks:

```bash
npm run check
npm run build
```

During development, use the tests closest to the code you changed:

```bash
npm test -- scan-handlers
npm test -- scan-api-calls
npm test -- compare
```

## Reporting issues

High-quality reports help the project move faster. Please include:

- The command you ran.
- The `msw-inspector-cli` version.
- Your Node.js version.
- A small handler or API-call example.
- The expected result.
- The actual result.

If the issue comes from a private app, reduce it to a tiny reproduction before posting. Do not include tokens, private URLs, cookies, request bodies with personal data, or internal API keys.

## Pull request guidelines

Keep pull requests narrow. A strong PR usually does one thing:

- Adds support for one handler or API-call shape.
- Fixes one incorrect match.
- Improves one section of documentation.
- Adds one focused regression test.

For scanner changes, add or update tests in `test/` with small inline fixtures. Prefer reporting ambiguous code as unsupported instead of guessing incorrectly.

Do not update files in `dist/` unless a maintainer explicitly asks for a release-oriented PR.

## Maintainer triage

The project uses these labels to keep work clear:

- `bug`: something is incorrect or broken.
- `enhancement`: a new capability or behavior improvement.
- `documentation`: README, examples, setup, or explanation work.
- `good first issue`: scoped for a first-time contributor.
- `help wanted`: useful work that is ready for community help.
- `status: needs reproduction`: waiting for a small reproduction or failing test.
- `status: ready`: enough detail exists for implementation.
- `area: scanner`, `area: cli`, `area: github-action`, `area: docs`: where the work lives.

Maintainer decisions should favor small, tested changes that help real MSW users understand coverage drift.
