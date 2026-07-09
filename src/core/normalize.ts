import path from 'node:path'

import type { HttpMethod, RoutePattern, SourceLocation } from './types'

const ABSOLUTE_PROTOCOL = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//

export function normalizeMethod(value: string | undefined): HttpMethod {
  if (!value) {
    return 'GET'
  }

  const normalized = value.toUpperCase()
  switch (normalized) {
    case 'GET':
    case 'POST':
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
    case 'HEAD':
    case 'OPTIONS':
    case 'ALL':
      return normalized
    default:
      return 'UNKNOWN'
  }
}

export function createPathPattern(raw: string, baseUrl?: string): RoutePattern {
  const trimmed = raw.trim()

  if (ABSOLUTE_PROTOCOL.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      const pathname = url.pathname
      return {
        raw,
        kind: 'path',
        normalized: `${url.origin}${pathname}`,
        pathname,
        origin: url.origin,
      }
    } catch {
      return {
        raw,
        kind: 'unknown',
        normalized: trimmed,
        pathname: null,
        origin: null,
      }
    }
  }

  const resolvedFromBase = resolveAgainstBaseUrl(raw, trimmed, baseUrl)
  if (resolvedFromBase) {
    return resolvedFromBase
  }

  const pathname = normalizePathname(trimmed)
  return {
    raw,
    kind: 'path',
    normalized: pathname,
    pathname,
    origin: null,
  }
}

function resolveAgainstBaseUrl(raw: string, trimmed: string, baseUrl: string | undefined): RoutePattern | null {
  if (!baseUrl || !shouldResolveAgainstBaseUrl(trimmed)) {
    return null
  }

  try {
    const url = new URL(trimmed, new URL(baseUrl))
    const pathname = url.pathname
    return {
      raw,
      kind: 'path',
      normalized: `${url.origin}${pathname}`,
      pathname,
      origin: url.origin,
    }
  } catch {
    return null
  }
}

function shouldResolveAgainstBaseUrl(value: string): boolean {
  if (!value || value === '*') {
    return false
  }

  if (value.startsWith('*') || value.startsWith('//')) {
    return false
  }

  return true
}

export function createRegExpPattern(raw: string): RoutePattern {
  return {
    raw,
    kind: 'regexp',
    normalized: raw,
    pathname: null,
    origin: null,
  }
}

export function createUnknownPattern(raw: string): RoutePattern {
  return {
    raw,
    kind: 'unknown',
    normalized: raw.trim(),
    pathname: null,
    origin: null,
  }
}

export function normalizePathname(value: string): string {
  if (value === '*') {
    return value
  }

  const cleaned = stripSearchAndHash(value.trim()).replace(/\\/g, '/')
  if (cleaned.startsWith('/')) {
    return cleaned
  }

  if (cleaned.startsWith('./') || cleaned.startsWith('../')) {
    return cleaned
  }

  return `/${cleaned}`
}

function stripSearchAndHash(value: string): string {
  const queryIndex = value.indexOf('?')
  const hashIndex = value.indexOf('#')
  const stopIndex = [queryIndex, hashIndex].filter((index) => index >= 0).sort((left, right) => left - right)[0]

  if (stopIndex === undefined) {
    return value
  }

  return value.slice(0, stopIndex)
}

export function createRecordId(parts: string[]): string {
  return parts.join(':')
}

export function normalizeLocation(cwd: string, filePath: string, line: number, column: number): SourceLocation {
  return {
    filePath: toRepoRelativePath(cwd, filePath),
    line,
    column,
  }
}

export function toRepoRelativePath(cwd: string, filePath: string): string {
  const relative = path.relative(cwd, path.normalize(filePath))
  if (relative === '') {
    return '.'
  }

  return relative.split(path.sep).join('/')
}
