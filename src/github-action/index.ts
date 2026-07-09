import { appendFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'

import * as core from '@actions/core'
import * as github from '@actions/github'

import type {
  ApiCallRecord,
  CoverageReport,
  HandlerRecord,
  UnsupportedPattern,
} from '../core/types'

const COMMENT_MARKER = '<!-- msw-inspector-comment -->'
const DEFAULT_COMMENT_TITLE = 'MSW mock coverage'
const DEFAULT_COMMENT_LIMIT = 8

export interface GitHubActionOptions {
  summaryFile: string
  comment: boolean
  commentTitle: string
  githubToken: string
  commentLimit: number
}

export async function readCoverageReport(summaryFile: string): Promise<CoverageReport> {
  const raw = await readFile(summaryFile, 'utf8')
  const parsed = JSON.parse(raw) as unknown

  if (!isCoverageReport(parsed)) {
    throw new Error(`Invalid coverage report in ${summaryFile}. Expected analyzer JSON output.`)
  }

  return parsed
}

export function renderJobSummary(report: CoverageReport): string {
  const lines: string[] = []
  lines.push('## MSW mock coverage')
  lines.push('')
  lines.push('| Metric | Value |')
  lines.push('| --- | ---: |')
  lines.push(`| Coverage | ${report.summary.percentage}% |`)
  lines.push(`| Mocked API calls | ${report.summary.mockedCalls} / ${report.summary.totalCalls} |`)
  lines.push(`| Used handlers | ${report.summary.usedHandlers} / ${report.summary.totalHandlers} |`)
  lines.push(`| Unmocked API calls | ${report.summary.unmockedCalls} |`)
  lines.push(`| Ambiguous API calls | ${report.summary.ambiguousCalls ?? 0} |`)
  lines.push(`| Stale handlers | ${report.summary.staleHandlers} |`)

  if (report.unsupported.length > 0) {
    lines.push('')
    lines.push(`Unsupported patterns skipped: ${report.unsupported.length}`)
  }

  return `${lines.join('\n')}\n`
}

export function renderStickyComment(report: CoverageReport, title = DEFAULT_COMMENT_TITLE, limit = DEFAULT_COMMENT_LIMIT): string {
  const unmocked = takeLabels(report.apiCalls, report.unmockedCallIds, formatApiCall, limit)
  const ambiguous = takeLabels(report.apiCalls, report.ambiguousCallIds ?? [], formatApiCall, limit)
  const stale = takeLabels(report.handlers, report.staleHandlerIds, formatHandler, limit)
  const unsupported = report.unsupported.slice(0, limit).map(formatUnsupported)

  const lines: string[] = []
  lines.push(COMMENT_MARKER)
  lines.push(`## ${title}`)
  lines.push('')
  lines.push(`Coverage: **${report.summary.percentage}%** (${report.summary.mockedCalls}/${report.summary.totalCalls})`)
  lines.push(`Handlers used: **${report.summary.usedHandlers}** / ${report.summary.totalHandlers}`)
  lines.push(`Unmocked API calls: **${report.summary.unmockedCalls}**`)
  lines.push(`Stale handlers: **${report.summary.staleHandlers}**`)

  if (unmocked.length > 0) {
    lines.push('')
    lines.push('### Unmocked API calls')
    lines.push(...unmocked.map((value) => `- ${value}`))
  }

  if (ambiguous.length > 0) {
    lines.push('')
    lines.push('### Ambiguous API calls')
    lines.push(...ambiguous.map((value) => `- ${value}`))
  }

  if (stale.length > 0) {
    lines.push('')
    lines.push('### Stale handlers')
    lines.push(...stale.map((value) => `- ${value}`))
  }

  if (unsupported.length > 0) {
    lines.push('')
    lines.push('### Unsupported patterns')
    lines.push(...unsupported.map((value) => `- ${value}`))
  }

  return `${lines.join('\n')}\n`
}

export async function writeJobSummary(report: CoverageReport): Promise<void> {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) {
    return
  }

  await appendFile(summaryPath, renderJobSummary(report), 'utf8')
}

export async function upsertStickyComment(
  report: CoverageReport,
  options: GitHubActionOptions,
): Promise<string | undefined> {
  const number = github.context.issue.number
  if (!number) {
    core.warning('Skipping PR comment because no issue or pull request number is available.')
    return undefined
  }

  const token = options.githubToken || core.getInput('github-token')
  if (!token) {
    core.warning('Skipping PR comment because no GitHub token was provided.')
    return undefined
  }

  const octokit = github.getOctokit(token)
  const body = renderStickyComment(report, options.commentTitle, options.commentLimit)
  const existing = await findStickyComment(octokit, number)

  if (existing) {
    await octokit.rest.issues.updateComment({
      ...github.context.repo,
      comment_id: existing.id,
      body,
    })
    return existing.html_url
  }

  const created = await octokit.rest.issues.createComment({
    ...github.context.repo,
    issue_number: number,
    body,
  })

  return created.data.html_url
}

export async function run(): Promise<void> {
  try {
    const options = readActionOptions()
    const report = await readCoverageReport(options.summaryFile)

    await writeJobSummary(report)

    core.setOutput('coverage-pct', String(report.summary.percentage))
    core.setOutput('mocked-calls', String(report.summary.mockedCalls))
    core.setOutput('total-calls', String(report.summary.totalCalls))
    core.setOutput('unmocked-count', String(report.summary.unmockedCalls))
    core.setOutput('ambiguous-count', String(report.summary.ambiguousCalls ?? 0))
    core.setOutput('stale-count', String(report.summary.staleHandlers))
    core.setOutput('covered-handlers', String(report.summary.usedHandlers))
    core.setOutput('total-handlers', String(report.summary.totalHandlers))
    core.setOutput('uncovered-count', String(report.summary.unmockedCalls))

    if (options.comment) {
      const commentUrl = await upsertStickyComment(report, options)
      if (commentUrl) {
        core.setOutput('comment-url', commentUrl)
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    core.setFailed(message)
  }
}

function readActionOptions(): GitHubActionOptions {
  const summaryFile = core.getInput('summary-file', { required: true })
  return {
    summaryFile,
    comment: core.getBooleanInput('comment'),
    commentTitle: core.getInput('comment-title') || DEFAULT_COMMENT_TITLE,
    githubToken: core.getInput('github-token'),
    commentLimit: Number(core.getInput('comment-limit')) || DEFAULT_COMMENT_LIMIT,
  }
}

async function findStickyComment(
  octokit: ReturnType<typeof github.getOctokit>,
  issueNumber: number,
): Promise<{ id: number; html_url: string } | undefined> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    ...github.context.repo,
    issue_number: issueNumber,
    per_page: 100,
  })

  const comment = comments.find((entry) => typeof entry.body === 'string' && entry.body.includes(COMMENT_MARKER))
  if (!comment) {
    return undefined
  }

  return {
    id: comment.id,
    html_url: comment.html_url,
  }
}

function takeLabels<T extends { id: string }>(
  items: readonly T[],
  ids: string[],
  formatter: (item: T) => string,
  limit: number,
): string[] {
  const byId = new Map<string, T>()
  for (const item of items) {
    const id = getId(item)
    if (id) {
      byId.set(id, item)
    }
  }

  return ids
    .map((id) => byId.get(id))
    .filter((item): item is T => Boolean(item))
    .slice(0, limit)
    .map(formatter)
}

function formatHandler(handler: HandlerRecord): string {
  return `${handler.method} ${handler.pattern.normalized}`
}

function formatApiCall(call: ApiCallRecord): string {
  return `${call.method} ${call.pattern.normalized}`
}

function formatUnsupported(item: UnsupportedPattern): string {
  return `${item.kind}: ${item.expressionText} (${item.reason})`
}

function getId<T extends { id: string }>(item: T): string {
  return item.id
}

function isCoverageReport(value: unknown): value is CoverageReport {
  if (!isObject(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>
  const summary = candidate.summary

  return (
    candidate.schemaVersion === 1 &&
    Array.isArray(candidate.handlers) &&
    Array.isArray(candidate.apiCalls) &&
    Array.isArray(candidate.unsupported) &&
    Array.isArray(candidate.staleHandlerIds) &&
    Array.isArray(candidate.unmockedCallIds) &&
    isObject(summary) &&
    typeof summary.percentage === 'number' &&
    typeof summary.mockedCalls === 'number' &&
    typeof summary.totalCalls === 'number' &&
    typeof summary.usedHandlers === 'number' &&
    typeof summary.totalHandlers === 'number' &&
    typeof summary.staleHandlers === 'number' &&
    typeof summary.unmockedCalls === 'number'
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

if (require.main === module) {
  void run()
}
