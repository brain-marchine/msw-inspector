# Roadmap

`msw-inspector` is a small developer-tooling project. The roadmap should stay grounded in real MSW usage, especially cases where mock coverage silently drifts away from production API calls.

## v0.2 focus

### Adoption

- Add copy-paste examples for common stacks such as Vite, Next.js, Vitest, and Playwright.
- Document how to run the CLI in CI before using the GitHub Action.
- Show one minimal repo layout with handlers, app code, and an expected JSON report.

### Scanner precision

- Improve unsupported-pattern output so users can find the exact file and code shape to fix.
- Add regression fixtures for common `fetch`, `axios`, `http.*`, and `rest.*` patterns.
- Explore limited support for configured wrapper helpers without turning the analyzer into a runtime evaluator.

### GitHub Action

- Keep the action output stable and predictable.
- Explore baseline or delta reporting for pull requests.
- Improve docs around sticky comments and summary-file usage.

## Good first issue candidates

- Add a framework-specific docs example.
- Add a small scanner fixture for a supported static URL pattern.
- Improve one CLI error message.
- Document one limitation with a clear example and workaround.

## Non-goals

- Runtime interception or browser automation.
- Guessing dynamic URLs that cannot be resolved statically.
- Replacing MSW, OpenAPI, or contract-testing tools.
- Large rewrites without a failing test or user-facing reason.

## How priorities are chosen

Issues are prioritized when they meet at least one of these criteria:

- They reproduce a real MSW drift problem.
- They reduce false positives or false negatives.
- They make CI adoption easier.
- They make the first contribution path clearer.
