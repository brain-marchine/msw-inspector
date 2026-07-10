import { describe, expect, it } from 'vitest'

import { buildCoverageReport } from '../src/core/compare'
import { formatCoverageReport } from '../src/core/format'
import { createPathPattern } from '../src/core/normalize'
import type { ApiCallRecord, CoverageReport, HandlerRecord, UnsupportedPattern } from '../src/core/types'

// CI environments force terminal colors; assertions compare plain text.
function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, '')
}

function handler(id: string, pattern: string, filePath = 'src/mocks/handlers.ts', line = 1): HandlerRecord {
  return {
    id,
    method: 'GET',
    pattern: createPathPattern(pattern),
    location: { filePath, line, column: 1 },
    source: 'msw-http',
  }
}

function call(id: string, pattern: string, filePath = 'src/api/client.ts', line = 1): ApiCallRecord {
  return {
    id,
    method: 'POST',
    pattern: createPathPattern(pattern),
    location: { filePath, line, column: 1 },
    source: 'fetch',
  }
}

function unsupported(input: Partial<UnsupportedPattern> & Pick<UnsupportedPattern, 'reason'>): UnsupportedPattern {
  return {
    kind: input.kind ?? 'handler',
    reason: input.reason,
    location: input.location ?? { filePath: 'handlers.ts', line: 1, column: 1 },
    expressionText: input.expressionText ?? 'rest.get(someDynamicPattern)',
  }
}

function baseReport(overrides: Partial<CoverageReport> = {}): CoverageReport {
  return {
    schemaVersion: 1,
    handlers: [],
    apiCalls: [],
    matches: [],
    mockedCallIds: [],
    usedHandlerIds: [],
    staleHandlerIds: [],
    unmockedCallIds: [],
    ambiguousCallIds: [],
    unsupported: [],
    summary: {
      mockedCalls: 0,
      totalCalls: 0,
      usedHandlers: 0,
      totalHandlers: 0,
      staleHandlers: 0,
      unmockedCalls: 0,
      ambiguousCalls: 0,
      percentage: 100,
    },
    ...overrides,
  }
}

describe('formatCoverageReport', () => {
  it('prints only the summary when nothing is unmocked or stale', () => {
    const report = buildCoverageReport({
      handlers: [{ ...handler('h1', '/users/:id'), method: 'POST' }],
      apiCalls: [call('c1', '/users/123')],
    })

    const output = stripAnsi(formatCoverageReport(report))
    expect(output).toContain('Coverage: 100% (1/1)')
    expect(output).not.toContain('Unmocked API calls:')
    expect(output).not.toContain('Stale handlers:')
  })

  it('lists unmocked calls and stale handlers with file and line', () => {
    const report = buildCoverageReport({
      handlers: [handler('h1', '/orders', 'src/mocks/orders.ts', 4)],
      apiCalls: [call('c1', '/api/chat', 'src/chat.ts', 12)],
    })

    const output = stripAnsi(formatCoverageReport(report))
    expect(output).toContain('Unmocked API calls:')
    expect(output).toContain('POST /api/chat  src/chat.ts:12')
    expect(output).toContain('Stale handlers:')
    expect(output).toContain('GET /orders  src/mocks/orders.ts:4')
  })

  it('truncates long lists at the limit and reports the remainder', () => {
    const report = buildCoverageReport({
      handlers: [],
      apiCalls: [call('c1', '/one'), call('c2', '/two'), call('c3', '/three')],
    })

    const output = stripAnsi(formatCoverageReport(report, { limit: 2 }))
    expect(output).toContain('POST /one')
    expect(output).toContain('POST /two')
    expect(output).not.toContain('POST /three')
    expect(output).toContain('… and 1 more')
  })

  it('ends with a red verdict line when calls are unmocked', () => {
    const report = buildCoverageReport({
      handlers: [],
      apiCalls: [call('c1', '/missing')],
    })

    const output = stripAnsi(formatCoverageReport(report))
    expect(output.trimEnd().split('\n').at(-1)).toBe('\u2717 0% mock coverage \u2014 1 unmocked call')
  })

  it('ends with a green verdict line when everything is mocked', () => {
    const report = buildCoverageReport({
      handlers: [{ ...handler('h1', '/users/:id'), method: 'POST' }],
      apiCalls: [call('c1', '/users/123')],
    })

    const output = stripAnsi(formatCoverageReport(report))
    expect(output.trimEnd().split('\n').at(-1)).toBe('\u2713 100% mock coverage \u2014 all 1 call mocked')
  })

  it('ends with a review verdict when only ambiguous calls remain', () => {
    const report = buildCoverageReport({
      handlers: [handler('h1', '/profile')],
      apiCalls: [{ ...call('c1', '/profile'), method: 'UNKNOWN' as const }],
    })

    const output = stripAnsi(formatCoverageReport(report))
    expect(output).toContain('\u25CC 1 ambiguous calls')
    expect(output.trimEnd().split('\n').at(-1)).toBe('\u25CC 0% mock coverage \u2014 1 ambiguous call to review')
  })

  it('omits the unsupported section when there are no unsupported patterns', () => {
    const output = stripAnsi(formatCoverageReport(baseReport()))
    expect(output).not.toContain('unsupported patterns skipped')
  })

  it('lists file:line, kind, and reason for each unsupported pattern', () => {
    const report = baseReport({
      unsupported: [
        unsupported({ reason: 'dynamic pattern', location: { filePath: 'handlers.ts', line: 12, column: 3 } }),
      ],
    })
    const output = stripAnsi(formatCoverageReport(report))
    expect(output).toContain('1 unsupported patterns skipped')
    expect(output).toContain('handlers.ts:12 (handler)')
    expect(output).toContain('dynamic pattern')
  })

  it('caps the listed unsupported patterns at the configured limit and reports the remaining count', () => {
    const report = baseReport({
      unsupported: Array.from({ length: 7 }, (_, i) =>
        unsupported({ reason: `reason ${i}`, location: { filePath: `file${i}.ts`, line: i + 1, column: 1 } }),
      ),
    })
    const output = stripAnsi(formatCoverageReport(report, { limit: 3 }))
    const lines = output.split('\n')
    const listedLines = lines.filter((line) => line.trim().startsWith('file'))
    expect(listedLines).toHaveLength(3)
    expect(output).toContain('… and 4 more')
  })
})
