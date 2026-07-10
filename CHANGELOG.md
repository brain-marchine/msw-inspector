# Changelog

All notable changes to this project should be documented here.

## v0.3.2

- Added the documented `--version` CLI flag so installed users can report the exact package version reliably.

## v0.3.1

- Corrected static MSW handler resolution for direct and const-backed `new URL(...).href` values, including absolute URLs without a base.
- Preserved JavaScript `new RegExp(pattern, flags)` semantics when matching static handler patterns.
- Made MSW import bindings and same-file matcher constants scope-aware, so shadowed aliases and values are not mistaken for real handlers.
- Made `--limit` consistently cap unsupported-pattern output as well as the other detailed text sections.
- Clarified the published package name (`msw-inspector-cli`) and installed binary (`msw-inspector`).

## v0.2.0

- Cleared all `npm audit` findings: upgraded `path-to-regexp` past a ReDoS advisory, upgraded `@actions/core`/`@actions/github` off vulnerable `undici` 5, and overrode transitive `esbuild` past its dev-server advisory.
- Declared the real Node.js requirement: `>=20` (the `commander` runtime dependency already required it, so `>=18.18` was never accurate).
- Fixed stale-handler false positives: every handler matching a call is now marked used, not just the first.
- Text output now lists unmocked API calls and stale handlers with file and line; `--limit` controls how many.
- The CLI validates `--format`, `--min-coverage`, and `--limit` (usage errors exit 2), warns on empty scans, and supports `--fail-on-empty`. Exit codes are documented in the README.
- Report file paths are now relative to `--cwd` with forward slashes on every platform, making reports portable across machines.
- Calls with statically unresolvable HTTP methods that path-match a handler are reported as `ambiguousCalls`/`ambiguousCallIds` instead of unmocked; their handlers are not flagged stale.
- Added support for `fetch(new Request(url, init))` with static arguments.
- The JSON report contract is documented in `docs/report-schema.md` and defined in `schema/coverage-report.v1.json`, which ships with the npm package and is validated in tests.
- `felmonon/msw-inspector-action` is now the canonical GitHub Action; this repository no longer ships `action.yml` or committed `dist/` output.
- CI now tests Node 20/22/24 on Ubuntu and Windows.
- Added end-to-end CLI tests covering output formats, `--report-file`, and all exit codes.
- Added contributor documentation, issue templates, a pull request template, roadmap, and release process notes.

## v0.1.5

- Text output lists unsupported patterns with file, line, kind, and reason (capped at 5).
- Added an npm publish workflow for releases.
- Dependency updates via Dependabot, including TypeScript 6.

## v0.1.4

- Linked the GitHub Marketplace action from the README.

## v0.1.3 and earlier

- Added the first published MSW coverage analyzer releases.
- Added base URL-aware coverage analysis.
- Documented the `msw-inspector-cli` package name and `msw-inspector` binary.
