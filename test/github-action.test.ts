import type { CoverageReport } from '../src/core/types'
import { describe, expect, it } from 'vitest'

import { renderJobSummary, renderStickyComment } from '../src/github-action/index'

const report = {
  schemaVersion: 1,
  handlers: [
    {
      id: 'handler-1',
      method: 'GET',
      pattern: {
        raw: '/users/:id',
        kind: 'path',
        normalized: '/users/:id',
        pathname: '/users/:id',
        origin: null,
      },
      location: { filePath: 'src/mocks/users.ts', line: 1, column: 1 },
      source: 'msw-http' as const,
    },
    {
      id: 'handler-2',
      method: 'POST',
      pattern: {
        raw: '/checkout',
        kind: 'path',
        normalized: '/checkout',
        pathname: '/checkout',
        origin: null,
      },
      location: { filePath: 'src/mocks/checkout.ts', line: 2, column: 1 },
      source: 'msw-http' as const,
    },
  ],
  apiCalls: [
    {
      id: 'call-1',
      method: 'GET',
      pattern: {
        raw: '/users/:id',
        kind: 'path',
        normalized: '/users/:id',
        pathname: '/users/:id',
        origin: null,
      },
      location: { filePath: 'src/api/users.ts', line: 4, column: 10 },
      source: 'fetch' as const,
    },
    {
      id: 'call-2',
      method: 'POST',
      pattern: {
        raw: '/payments',
        kind: 'path',
        normalized: '/payments',
        pathname: '/payments',
        origin: null,
      },
      location: { filePath: 'src/api/payments.ts', line: 7, column: 12 },
      source: 'axios' as const,
    },
  ],
  matches: [
    { callId: 'call-1', handlerId: 'handler-1' },
  ],
  mockedCallIds: ['call-1'],
  usedHandlerIds: ['handler-1'],
  staleHandlerIds: ['handler-2'],
  unmockedCallIds: ['call-2'],
  ambiguousCallIds: [],
  unsupported: [],
  summary: {
    mockedCalls: 1,
    totalCalls: 2,
    usedHandlers: 1,
    totalHandlers: 2,
    staleHandlers: 1,
    unmockedCalls: 1,
    ambiguousCalls: 0,
    percentage: 50,
  },
} satisfies CoverageReport

describe('github action formatting', () => {
  it('renders a job summary table', () => {
    const markdown = renderJobSummary(report)
    expect(markdown).toContain('## MSW mock coverage')
    expect(markdown).toContain('| Coverage | 50% |')
    expect(markdown).toContain('| Unmocked API calls | 1 |')
  })

  it('renders a sticky comment with marker and top items', () => {
    const markdown = renderStickyComment(report, 'Coverage report', 5)
    expect(markdown).toContain('<!-- msw-inspector-comment -->')
    expect(markdown).toContain('## Coverage report')
    expect(markdown).toContain('### Unmocked API calls')
    expect(markdown).toContain('- POST /payments')
    expect(markdown).toContain('### Stale handlers')
    expect(markdown).toContain('- POST /checkout')
  })
})
