import pc from 'picocolors'

import type { ApiCallRecord, CoverageReport, HandlerRecord } from './types'

export interface FormatOptions {
  limit?: number
}

export const DEFAULT_FORMAT_LIMIT = 10

export function formatCoverageReport(report: CoverageReport, options: FormatOptions = {}): string {
  const limit = options.limit ?? DEFAULT_FORMAT_LIMIT

  const lines = [
    `${pc.green('✓')} ${report.handlers.length} handlers found`,
    `${pc.green('✓')} ${report.apiCalls.length} API calls found`,
    `${report.summary.unmockedCalls > 0 ? pc.red('✗') : pc.green('✓')} ${report.summary.unmockedCalls} unmocked endpoints`,
    `${report.summary.staleHandlers > 0 ? pc.red('✗') : pc.green('✓')} ${report.summary.staleHandlers} stale mocks`,
    '',
    `Coverage: ${report.summary.percentage}% (${report.summary.mockedCalls}/${report.summary.totalCalls})`,
  ]

  const unmocked = pickRecords(report.apiCalls, report.unmockedCallIds)
  if (unmocked.length > 0) {
    lines.push('', 'Unmocked API calls:')
    lines.push(...recordLines(unmocked, limit))
  }

  const stale = pickRecords(report.handlers, report.staleHandlerIds)
  if (stale.length > 0) {
    lines.push('', 'Stale handlers:')
    lines.push(...recordLines(stale, limit))
  }

  if (report.unsupported.length > 0) {
    lines.push('', `${pc.yellow('!')} ${report.unsupported.length} unsupported patterns skipped`)
  }

  return lines.join('\n')
}

function pickRecords<T extends { id: string }>(records: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map(records.map((record) => [record.id, record]))
  return ids.map((id) => byId.get(id)).filter((record): record is T => Boolean(record))
}

function recordLines(records: Array<ApiCallRecord | HandlerRecord>, limit: number): string[] {
  const lines = records
    .slice(0, limit)
    .map((record) => `  ${record.method} ${record.pattern.normalized}  ${pc.dim(`${record.location.filePath}:${record.location.line}`)}`)

  const remaining = records.length - limit
  if (remaining > 0) {
    lines.push(`  … and ${remaining} more`)
  }

  return lines
}
