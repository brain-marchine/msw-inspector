import { describe, expect, it } from 'vitest'

import { buildCoverageReport } from '../src/core/compare'
import { formatCoverageReport } from '../src/core/format'
import { createPathPattern } from '../src/core/normalize'
import type { ApiCallRecord, HandlerRecord } from '../src/core/types'

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

describe('formatCoverageReport', () => {
  it('prints only the summary when nothing is unmocked or stale', () => {
    const report = buildCoverageReport({
      handlers: [{ ...handler('h1', '/users/:id'), method: 'POST' }],
      apiCalls: [call('c1', '/users/123')],
    })

    const output = formatCoverageReport(report)
    expect(output).toContain('Coverage: 100% (1/1)')
    expect(output).not.toContain('Unmocked API calls:')
    expect(output).not.toContain('Stale handlers:')
  })

  it('lists unmocked calls and stale handlers with file and line', () => {
    const report = buildCoverageReport({
      handlers: [handler('h1', '/orders', 'src/mocks/orders.ts', 4)],
      apiCalls: [call('c1', '/api/chat', 'src/chat.ts', 12)],
    })

    const output = formatCoverageReport(report)
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

    const output = formatCoverageReport(report, { limit: 2 })
    expect(output).toContain('POST /one')
    expect(output).toContain('POST /two')
    expect(output).not.toContain('POST /three')
    expect(output).toContain('… and 1 more')
  })
})
