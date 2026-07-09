export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | 'ALL'
  | 'UNKNOWN'

export type PatternKind = 'path' | 'regexp' | 'unknown'

export interface SourceLocation {
  filePath: string
  line: number
  column: number
}

export interface RoutePattern {
  raw: string
  kind: PatternKind
  normalized: string
  pathname: string | null
  origin: string | null
}

export interface HandlerRecord {
  id: string
  method: HttpMethod
  pattern: RoutePattern
  location: SourceLocation
  source: 'msw-http' | 'msw-rest'
}

export interface ApiCallRecord {
  id: string
  method: HttpMethod
  pattern: RoutePattern
  location: SourceLocation
  source: 'fetch' | 'axios'
}

export interface UnsupportedPattern {
  kind: 'handler' | 'api-call'
  reason: string
  location: SourceLocation
  expressionText: string
}

export interface CoverageSummary {
  mockedCalls: number
  totalCalls: number
  usedHandlers: number
  totalHandlers: number
  staleHandlers: number
  unmockedCalls: number
  ambiguousCalls: number
  percentage: number
}

export interface CoverageMatch {
  callId: string
  handlerId: string
}

export interface CoverageReport {
  schemaVersion: 1
  handlers: HandlerRecord[]
  apiCalls: ApiCallRecord[]
  matches: CoverageMatch[]
  mockedCallIds: string[]
  usedHandlerIds: string[]
  staleHandlerIds: string[]
  unmockedCallIds: string[]
  ambiguousCallIds: string[]
  unsupported: UnsupportedPattern[]
  summary: CoverageSummary
}

export interface AnalyzerOptions {
  cwd: string
  baseUrl?: string
  handlerGlobs?: string[]
  sourceGlobs?: string[]
  excludeGlobs?: string[]
}
