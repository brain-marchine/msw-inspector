import { describe, expect, it } from 'vitest'

import { buildCoverageReport } from '../src/core/compare'
import { createPathPattern } from '../src/core/normalize'
import type { ApiCallRecord, HandlerRecord } from '../src/core/types'

function handler(input: Partial<HandlerRecord> & Pick<HandlerRecord, 'id'>): HandlerRecord {
  return {
    id: input.id,
    method: input.method ?? 'GET',
    pattern: input.pattern ?? createPathPattern('/users/:id'),
    location: input.location ?? { filePath: 'handlers.ts', line: 1, column: 1 },
    source: input.source ?? 'msw-http',
  }
}

function call(input: Partial<ApiCallRecord> & Pick<ApiCallRecord, 'id'>): ApiCallRecord {
  return {
    id: input.id,
    method: input.method ?? 'GET',
    pattern: input.pattern ?? createPathPattern('/users/123'),
    location: input.location ?? { filePath: 'api.ts', line: 1, column: 1 },
    source: input.source ?? 'fetch',
  }
}

describe('buildCoverageReport', () => {
  it('matches parametrized handlers against concrete API calls', () => {
    const report = buildCoverageReport({
      handlers: [handler({ id: 'h1' })],
      apiCalls: [call({ id: 'c1' })],
    })

    expect(report.summary.percentage).toBe(100)
    expect(report.matches).toEqual([{ callId: 'c1', handlerId: 'h1' }])
    expect(report.unmockedCallIds).toEqual([])
    expect(report.staleHandlerIds).toEqual([])
  })

  it('treats unmatched handlers as stale and unmatched calls as unmocked', () => {
    const report = buildCoverageReport({
      handlers: [handler({ id: 'h1', pattern: createPathPattern('/users/:id') })],
      apiCalls: [call({ id: 'c1', pattern: createPathPattern('/projects/123') })],
    })

    expect(report.summary.mockedCalls).toBe(0)
    expect(report.summary.unmockedCalls).toBe(1)
    expect(report.summary.staleHandlers).toBe(1)
    expect(report.unmockedCallIds).toEqual(['c1'])
    expect(report.staleHandlerIds).toEqual(['h1'])
  })

  it('allows absolute API calls to match relative handlers by pathname', () => {
    const report = buildCoverageReport({
      handlers: [handler({ id: 'h1', pattern: createPathPattern('/users/:id') })],
      apiCalls: [call({ id: 'c1', pattern: createPathPattern('https://api.example.com/users/123?active=1') })],
    })

    expect(report.summary.mockedCalls).toBe(1)
    expect(report.matches).toEqual([{ callId: 'c1', handlerId: 'h1' }])
  })

  it('supports ALL handlers across different methods', () => {
    const report = buildCoverageReport({
      handlers: [handler({ id: 'h1', method: 'ALL', pattern: createPathPattern('/health') })],
      apiCalls: [call({ id: 'c1', method: 'POST', pattern: createPathPattern('/health') })],
    })

    expect(report.summary.mockedCalls).toBe(1)
  })

  it('marks every handler matching a call as used, not just the first', () => {
    const report = buildCoverageReport({
      handlers: [
        handler({ id: 'h1', pattern: createPathPattern('/users/:id') }),
        handler({ id: 'h2', pattern: createPathPattern('/users/:id') }),
      ],
      apiCalls: [call({ id: 'c1' })],
    })

    expect(report.matches).toEqual([{ callId: 'c1', handlerId: 'h1' }])
    expect(report.usedHandlerIds).toEqual(['h1', 'h2'])
    expect(report.staleHandlerIds).toEqual([])
    expect(report.summary.usedHandlers).toBe(2)
    expect(report.summary.staleHandlers).toBe(0)
  })

  it('does not flag a broad wildcard handler as stale when a specific handler also matches', () => {
    const report = buildCoverageReport({
      handlers: [
        handler({ id: 'specific', pattern: createPathPattern('/users/:id') }),
        handler({ id: 'wildcard', pattern: createPathPattern('/users/*') }),
      ],
      apiCalls: [call({ id: 'c1' })],
    })

    expect(report.matches).toEqual([{ callId: 'c1', handlerId: 'specific' }])
    expect(report.usedHandlerIds).toEqual(['specific', 'wildcard'])
    expect(report.staleHandlerIds).toEqual([])
  })

  it('reports UNKNOWN-method calls with a path-matching handler as ambiguous, not unmocked', () => {
    const report = buildCoverageReport({
      handlers: [handler({ id: 'h1', method: 'GET', pattern: createPathPattern('/profile') })],
      apiCalls: [call({ id: 'c1', method: 'UNKNOWN', pattern: createPathPattern('/profile') })],
    })

    expect(report.ambiguousCallIds).toEqual(['c1'])
    expect(report.unmockedCallIds).toEqual([])
    expect(report.summary.ambiguousCalls).toBe(1)
    expect(report.summary.unmockedCalls).toBe(0)
    expect(report.summary.mockedCalls).toBe(0)
    // The handler likely serves this call, so it must not be flagged stale.
    expect(report.usedHandlerIds).toEqual(['h1'])
    expect(report.staleHandlerIds).toEqual([])
  })

  it('keeps UNKNOWN-method calls with no path match in the unmocked list', () => {
    const report = buildCoverageReport({
      handlers: [handler({ id: 'h1', pattern: createPathPattern('/orders') })],
      apiCalls: [call({ id: 'c1', method: 'UNKNOWN', pattern: createPathPattern('/profile') })],
    })

    expect(report.ambiguousCallIds).toEqual([])
    expect(report.unmockedCallIds).toEqual(['c1'])
    expect(report.staleHandlerIds).toEqual(['h1'])
  })

  it('still counts UNKNOWN-method calls as mocked when an ALL handler matches', () => {
    const report = buildCoverageReport({
      handlers: [handler({ id: 'h1', method: 'ALL', pattern: createPathPattern('/profile') })],
      apiCalls: [call({ id: 'c1', method: 'UNKNOWN', pattern: createPathPattern('/profile') })],
    })

    expect(report.summary.mockedCalls).toBe(1)
    expect(report.ambiguousCallIds).toEqual([])
  })

  it('matches wildcard handlers using MSW-style coercion', () => {
    const report = buildCoverageReport({
      handlers: [handler({ id: 'h1', pattern: createPathPattern('https://api.example.com/users/*') })],
      apiCalls: [call({ id: 'c1', pattern: createPathPattern('https://api.example.com/users/123') })],
    })

    expect(report.summary.mockedCalls).toBe(1)
  })
})
