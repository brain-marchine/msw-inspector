import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { Command, CommanderError } from 'commander'
import { analyzeProject } from './core/analyze'
import { DEFAULT_EXCLUDE_GLOBS, DEFAULT_HANDLER_GLOBS, DEFAULT_SOURCE_GLOBS } from './core/defaults'
import { DEFAULT_FORMAT_LIMIT, formatCoverageReport } from './core/format'

export interface CliIo {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

const defaultIo: CliIo = {
  stdout: (text) => {
    process.stdout.write(text)
  },
  stderr: (text) => {
    process.stderr.write(text)
  },
}

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  let exitCode = 0

  const program = new Command()

  program
    .name('msw-inspector')
    .description('Find gaps in your MSW mock coverage.')
    .option('--handlers <globs...>', 'Override handler file globs.', DEFAULT_HANDLER_GLOBS)
    .option('--sources <globs...>', 'Override source file globs.', DEFAULT_SOURCE_GLOBS)
    .option('--exclude <globs...>', 'Exclude file globs.', DEFAULT_EXCLUDE_GLOBS)
    .option('--base-url <url>', 'Resolve relative handlers and calls against this base URL.')
    .option('--format <format>', 'Output format: text or json.', 'text')
    .option('--limit <count>', 'Maximum unmocked/stale entries listed in text output.', String(DEFAULT_FORMAT_LIMIT))
    .option('--report-file <path>', 'Write the JSON report to a file.')
    .option('--min-coverage <percentage>', 'Fail if API mock coverage drops below this percentage.')
    .option('--fail-on-unmocked', 'Fail if any API call is unmocked.')
    .option('--fail-on-stale', 'Fail if any stale handler is found.')
    .option('--fail-on-empty', 'Fail if no handlers and no API calls are found.')
    .option('--cwd <cwd>', 'Working directory to inspect.', process.cwd())
    .action(async (options) => {
      if (options.format !== 'text' && options.format !== 'json') {
        io.stderr(`Invalid --format value: ${options.format}. Expected "text" or "json".\n`)
        exitCode = 2
        return
      }

      let minCoverage: number | null = null
      if (options.minCoverage !== undefined) {
        minCoverage = Number(options.minCoverage)
        if (!Number.isFinite(minCoverage) || minCoverage < 0 || minCoverage > 100) {
          io.stderr(`Invalid --min-coverage value: ${options.minCoverage}. Expected a number between 0 and 100.\n`)
          exitCode = 2
          return
        }
      }

      const limit = Number(options.limit)
      if (!Number.isInteger(limit) || limit < 0) {
        io.stderr(`Invalid --limit value: ${options.limit}. Expected a non-negative integer.\n`)
        exitCode = 2
        return
      }

      const report = await analyzeProject({
        cwd: options.cwd,
        baseUrl: options.baseUrl,
        handlerGlobs: options.handlers,
        sourceGlobs: options.sources,
        excludeGlobs: options.exclude,
      })

      const json = JSON.stringify(report, null, 2)
      if (options.reportFile) {
        const outputPath = path.resolve(options.cwd, options.reportFile)
        await mkdir(path.dirname(outputPath), { recursive: true })
        await writeFile(outputPath, `${json}\n`, 'utf8')
      }

      if (options.format === 'json') {
        io.stdout(`${json}\n`)
      } else {
        io.stdout(`${formatCoverageReport(report, { limit })}\n`)
      }

      const isEmptyScan = report.summary.totalHandlers === 0 && report.summary.totalCalls === 0
      if (isEmptyScan) {
        io.stderr('Warning: no MSW handlers or API calls were found. Check --cwd, --handlers, and --sources globs.\n')
      }

      const shouldFail =
        (minCoverage !== null && report.summary.percentage < minCoverage) ||
        (options.failOnUnmocked && report.summary.unmockedCalls > 0) ||
        (options.failOnStale && report.summary.staleHandlers > 0) ||
        (options.failOnEmpty && isEmptyScan)

      if (shouldFail) {
        exitCode = 1
      }
    })

  program.exitOverride()
  program.configureOutput({
    writeOut: (text) => io.stdout(text),
    writeErr: (text) => io.stderr(text),
  })

  try {
    await program.parseAsync(argv)
  } catch (error) {
    if (error instanceof CommanderError) {
      // Help and version requests exit 0; anything else is a usage error.
      return error.exitCode === 0 ? 0 : 2
    }

    const message = error instanceof Error ? error.message : String(error)
    io.stderr(`${message}\n`)
    return 1
  }

  return exitCode
}
