# Coverage report schema (schemaVersion 1)

The JSON report written by `--report-file` (and printed by `--format json`) is a stable contract for CI consumers. The machine-readable definition lives in [`schema/coverage-report.v1.json`](../schema/coverage-report.v1.json) and ships with the npm package; a test validates every analyzer run against it.

## Stability promise

- Fields documented here keep their name, type, and meaning for as long as `schemaVersion` is `1`.
- New fields may be added in minor releases. Consumers should ignore unknown fields.
- Removing or changing the meaning of a field requires a `schemaVersion` bump and a major release.

## Top-level fields

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | `1` | Report format version. |
| `handlers` | `HandlerRecord[]` | Every statically resolved MSW handler, sorted by file, line, column. |
| `apiCalls` | `ApiCallRecord[]` | Every statically resolved `fetch`/`axios` call, sorted by file, line, column. |
| `matches` | `{callId, handlerId}[]` | One entry per mocked call, pointing at the first handler that matched it. |
| `mockedCallIds` | `string[]` | Calls covered by at least one handler. |
| `usedHandlerIds` | `string[]` | Handlers matched by at least one call, including every handler that matches a mocked call and handlers whose path matches an ambiguous call. |
| `staleHandlerIds` | `string[]` | Handlers matched by nothing — candidates for deletion. |
| `unmockedCallIds` | `string[]` | Calls no handler covers — the coverage gaps. |
| `ambiguousCallIds` | `string[]` | Calls whose HTTP method could not be resolved statically but whose path matches a handler. Not counted as mocked or unmocked; `--fail-on-unmocked` ignores them. |
| `unsupported` | `UnsupportedPattern[]` | Code shapes the scanner refused to guess about, with a reason and the exact expression text. |
| `summary` | `CoverageSummary` | The counts below. |

Every call is in exactly one of `mockedCallIds`, `unmockedCallIds`, or `ambiguousCallIds`. Every handler is in exactly one of `usedHandlerIds` or `staleHandlerIds`.

## Records

`HandlerRecord` and `ApiCallRecord` share the same shape:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `string` | Stable identifier built from location, source, method, and pattern. Stable across machines because paths are repo-relative. |
| `method` | `GET`/`POST`/`PUT`/`PATCH`/`DELETE`/`HEAD`/`OPTIONS`/`ALL`/`UNKNOWN` | `ALL` only appears on handlers; `UNKNOWN` means the method could not be resolved statically. |
| `pattern.raw` | `string` | The matcher or URL as written (query/hash stripped for URLs). |
| `pattern.kind` | `path`/`regexp`/`unknown` | How the pattern is matched. |
| `pattern.normalized` | `string` | Canonical form: `origin + pathname` for absolute URLs, leading-slash pathname otherwise. |
| `pattern.pathname` | `string \| null` | Pathname component when `kind` is `path`. |
| `pattern.origin` | `string \| null` | Origin when the pattern is absolute or resolved via `--base-url`. |
| `location` | `{filePath, line, column}` | 1-based position. `filePath` is relative to `--cwd` with forward slashes on every platform. |
| `source` | handlers: `msw-http`/`msw-rest`; calls: `fetch`/`axios` | Which API produced the record. |

## Summary

| Field | Meaning |
| --- | --- |
| `mockedCalls` / `totalCalls` | Covered calls over all resolved calls. |
| `usedHandlers` / `totalHandlers` | Handlers matched by anything over all resolved handlers. |
| `staleHandlers` | `totalHandlers - usedHandlers`. |
| `unmockedCalls` | Calls with no covering handler (excludes ambiguous calls). |
| `ambiguousCalls` | Unknown-method calls whose path matches a handler. |
| `percentage` | `mockedCalls / totalCalls` rounded to one decimal; `100` when `totalCalls` is `0`. |

## Validating a report

```bash
npx ajv-cli validate -s node_modules/msw-inspector-cli/schema/coverage-report.v1.json -d msw-inspector.json
```
