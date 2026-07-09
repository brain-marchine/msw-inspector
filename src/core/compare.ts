import { match } from 'path-to-regexp'

import type { ApiCallRecord, CoverageMatch, CoverageReport, HandlerRecord, RoutePattern, UnsupportedPattern } from './types'

function patternCandidates(pattern: RoutePattern): string[] {
  if (pattern.kind !== 'path') {
    return []
  }

  const values = new Set<string>()
  if (pattern.pathname) {
    values.add(pattern.pathname)
  }
  values.add(pattern.normalized)

  return [...values]
}

function matchesPath(call: ApiCallRecord, handler: HandlerRecord): boolean {
  if (handler.pattern.kind !== 'path' || call.pattern.kind !== 'path') {
    return false
  }

  if (handler.pattern.origin && call.pattern.origin && handler.pattern.origin !== call.pattern.origin) {
    return false
  }

  const handlerCandidates = patternCandidates(handler.pattern)
  const callCandidates = patternCandidates(call.pattern)

  for (const handlerCandidate of handlerCandidates) {
    const matcher = compilePathMatcher(handlerCandidate)
    if (!matcher) {
      continue
    }

    for (const callCandidate of callCandidates) {
      const { origin, path } = splitOriginAndPath(callCandidate)
      if (handler.pattern.origin && origin && handler.pattern.origin !== origin) {
        continue
      }

      if (matcher(path)) {
        return true
      }
    }
  }

  return false
}

function compilePathMatcher(pattern: string): ((value: string) => boolean) | null {
  try {
    const matcher = match(coerceWildcardParams(normalizePath(pattern)), {
      decode: false,
      sensitive: false,
    })

    return (value: string) => Boolean(matcher(normalizePath(value)))
  } catch {
    return null
  }
}

function coerceWildcardParams(pattern: string): string {
  let index = 0
  return pattern.replace(/(^|\/)\*\*?(?=\/|$)/g, (_, prefix: string) => `${prefix}*wildcard${++index}`)
}

function splitOriginAndPath(value: string): { origin: string | null; path: string } {
  try {
    const url = new URL(value)
    return {
      origin: url.origin,
      path: url.pathname,
    }
  } catch {
    return {
      origin: null,
      path: normalizePath(value),
    }
  }
}

function normalizePath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return '/'
  }

  if (trimmed.startsWith('/')) {
    return trimmed
  }

  return `/${trimmed}`
}

function matchesRegExp(call: ApiCallRecord, handler: HandlerRecord): boolean {
  if (handler.pattern.kind !== 'regexp') {
    return false
  }

  try {
    const expression = handler.pattern.raw
    const lastSlash = expression.lastIndexOf('/')
    const source = expression.slice(1, lastSlash)
    const flags = expression.slice(lastSlash + 1)
    const regex = new RegExp(source, flags)

    return patternCandidates(call.pattern).some((candidate) => regex.test(candidate))
  } catch {
    return false
  }
}

function methodsMatch(call: ApiCallRecord, handler: HandlerRecord): boolean {
  return handler.method === 'ALL' || call.method === handler.method
}

function handlerMatches(call: ApiCallRecord, handler: HandlerRecord): boolean {
  if (!methodsMatch(call, handler)) {
    return false
  }

  if (handler.pattern.kind === 'path') {
    return matchesPath(call, handler)
  }

  if (handler.pattern.kind === 'regexp') {
    return matchesRegExp(call, handler)
  }

  return false
}

function findMatches(call: ApiCallRecord, handlers: HandlerRecord[]): HandlerRecord[] {
  return handlers.filter((handler) => handlerMatches(call, handler))
}

function patternMatches(call: ApiCallRecord, handler: HandlerRecord): boolean {
  if (handler.pattern.kind === 'path') {
    return matchesPath(call, handler)
  }

  if (handler.pattern.kind === 'regexp') {
    return matchesRegExp(call, handler)
  }

  return false
}

function percentage(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 100
  }

  return Math.round((numerator / denominator) * 1000) / 10
}

export function buildCoverageReport(input: {
  handlers: HandlerRecord[]
  apiCalls: ApiCallRecord[]
  unsupported?: UnsupportedPattern[]
}): CoverageReport {
  const matches: CoverageMatch[] = []
  const mockedCallIds = new Set<string>()
  const usedHandlerIds = new Set<string>()

  for (const call of input.apiCalls) {
    const matched = findMatches(call, input.handlers)
    const [primary] = matched
    if (!primary) {
      continue
    }

    matches.push({
      callId: call.id,
      handlerId: primary.id,
    })
    mockedCallIds.add(call.id)
    for (const handler of matched) {
      usedHandlerIds.add(handler.id)
    }
  }

  // A call whose method could not be resolved statically may still hit a
  // handler on the same path. Report it as ambiguous instead of unmocked, and
  // keep the path-matching handlers out of the stale list: deleting a handler
  // that likely serves this call is worse than leaving the call unresolved.
  const unmockedCallIds: string[] = []
  const ambiguousCallIds: string[] = []
  for (const call of input.apiCalls) {
    if (mockedCallIds.has(call.id)) {
      continue
    }

    const pathMatched = call.method === 'UNKNOWN' ? input.handlers.filter((handler) => patternMatches(call, handler)) : []
    if (pathMatched.length > 0) {
      ambiguousCallIds.push(call.id)
      for (const handler of pathMatched) {
        usedHandlerIds.add(handler.id)
      }
    } else {
      unmockedCallIds.push(call.id)
    }
  }

  const staleHandlerIds = input.handlers.filter((handler) => !usedHandlerIds.has(handler.id)).map((handler) => handler.id)

  return {
    schemaVersion: 1,
    handlers: input.handlers,
    apiCalls: input.apiCalls,
    matches,
    mockedCallIds: [...mockedCallIds],
    usedHandlerIds: [...usedHandlerIds],
    staleHandlerIds,
    unmockedCallIds,
    ambiguousCallIds,
    unsupported: input.unsupported ?? [],
    summary: {
      mockedCalls: mockedCallIds.size,
      totalCalls: input.apiCalls.length,
      usedHandlers: usedHandlerIds.size,
      totalHandlers: input.handlers.length,
      staleHandlers: staleHandlerIds.length,
      unmockedCalls: unmockedCallIds.length,
      ambiguousCalls: ambiguousCallIds.length,
      percentage: percentage(mockedCallIds.size, input.apiCalls.length),
    },
  }
}
