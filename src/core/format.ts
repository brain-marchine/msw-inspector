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
  ]

  if (report.summary.ambiguousCalls > 0) {
    lines.push(`${pc.yellow('◌')} ${report.summary.ambiguousCalls} ambiguous calls`)
  }

  lines.push('', `Coverage: ${report.summary.percentage}% (${report.summary.mockedCalls}/${report.summary.totalCalls})`)

  const unmocked = pickRecords(report.apiCalls, report.unmockedCallIds)
  if (unmocked.length > 0) {
    lines.push('', 'Unmocked API calls:')
    lines.push(...recordLines(unmocked, limit))
  }

  const ambiguous = pickRecords(report.apiCalls, report.ambiguousCallIds ?? [])
  if (ambiguous.length > 0) {
    lines.push('', `Ambiguous API calls (method unknown, path matches a handler):`)
    lines.push(...recordLines(ambiguous, limit))
  }

  const stale = pickRecords(report.handlers, report.staleHandlerIds)
  if (stale.length > 0) {
    lines.push('', 'Stale handlers:')
    lines.push(...recordLines(stale, limit))
  }

  if (report.unsupported.length > 0) {
    lines.push('', `${pc.yellow('◌')} ${report.unsupported.length} unsupported patterns skipped`)
    const shown = report.unsupported.slice(0, limit)
    for (const pattern of shown) {
      lines.push(
        `  ${pattern.location.filePath}:${pattern.location.line} (${pattern.kind}) — ${pattern.reason}`,
      )
    }
    const remaining = report.unsupported.length - shown.length
    if (remaining > 0) {
      lines.push(`  … and ${remaining} more`)
    }
  }

  lines.push('', verdictLine(report))

  return lines.join('\n')
}

function verdictLine(report: CoverageReport): string {
  const { summary } = report

  if (summary.totalCalls === 0 && summary.totalHandlers === 0) {
    return pc.bold(pc.yellow('◌ nothing scanned — no handlers or API calls found'))
  }

  if (summary.unmockedCalls > 0) {
    const noun = summary.unmockedCalls === 1 ? 'unmocked call' : 'unmocked calls'
    return pc.bold(pc.red(`✗ ${summary.percentage}% mock coverage — ${summary.unmockedCalls} ${noun}`))
  }

  if (summary.ambiguousCalls > 0) {
    const noun = summary.ambiguousCalls === 1 ? 'ambiguous call' : 'ambiguous calls'
    return pc.bold(pc.yellow(`◌ ${summary.percentage}% mock coverage — ${summary.ambiguousCalls} ${noun} to review`))
  }

  const noun = summary.totalCalls === 1 ? 'call' : 'calls'
  return pc.bold(pc.green(`✓ ${summary.percentage}% mock coverage — all ${summary.totalCalls} ${noun} mocked`))
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
