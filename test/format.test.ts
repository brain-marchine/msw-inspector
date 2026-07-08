import { describe, expect, it } from 'vitest'
import { formatCoverageReport } from '../src/core/format'
import type { CoverageReport, UnsupportedPattern } from '../src/core/types'

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
    unsupported: [],
    summary: {
      mockedCalls: 0,
      totalCalls: 0,
      usedHandlers: 0,
      totalHandlers: 0,
      staleHandlers: 0,
      unmockedCalls: 0,
      percentage: 100,
    },
    ...overrides,
  }
}

describe('formatCoverageReport', () => {
  it('omits the unsupported section when there are no unsupported patterns', () => {
    const output = formatCoverageReport(baseReport())
    expect(output).not.toContain('unsupported patterns skipped')
  })

  it('lists file:line, kind, and reason for each unsupported pattern', () => {
    const report = baseReport({
      unsupported: [
        unsupported({ reason: 'dynamic pattern', location: { filePath: 'handlers.ts', line: 12, column: 3 } }),
      ],
    })
    const output = formatCoverageReport(report)
    expect(output).toContain('1 unsupported patterns skipped')
    expect(output).toContain('handlers.ts:12 (handler)')
    expect(output).toContain('dynamic pattern')
  })

  it('caps the listed patterns at 5 and reports the remaining count', () => {
    const report = baseReport({
      unsupported: Array.from({ length: 7 }, (_, i) =>
        unsupported({ reason: `reason ${i}`, location: { filePath: `file${i}.ts`, line: i, column: 1 } }),
      ),
    })
    const output = formatCoverageReport(report)
    const lines = output.split('\n')
    const listedLines = lines.filter((line) => line.trim().startsWith('file'))
    expect(listedLines).toHaveLength(5)
    expect(output).toContain('...and 2 more')
  })
})