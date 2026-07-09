import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { Command, CommanderError } from 'commander'
import { analyzeProject } from './core/analyze'
import { DEFAULT_EXCLUDE_GLOBS, DEFAULT_HANDLER_GLOBS, DEFAULT_SOURCE_GLOBS } from './core/defaults'
import { formatCoverageReport } from './core/format'

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
    .option('--report-file <path>', 'Write the JSON report to a file.')
    .option('--min-coverage <percentage>', 'Fail if API mock coverage drops below this percentage.')
    .option('--fail-on-unmocked', 'Fail if any API call is unmocked.')
    .option('--fail-on-stale', 'Fail if any stale handler is found.')
    .option('--cwd <cwd>', 'Working directory to inspect.', process.cwd())
    .action(async (options) => {
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
        io.stdout(`${formatCoverageReport(report)}\n`)
      }

      const minCoverage = options.minCoverage ? Number(options.minCoverage) : null
      const shouldFail =
        (typeof minCoverage === 'number' && Number.isFinite(minCoverage) && report.summary.percentage < minCoverage) ||
        (options.failOnUnmocked && report.summary.unmockedCalls > 0) ||
        (options.failOnStale && report.summary.staleHandlers > 0)

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
      return error.exitCode
    }

    const message = error instanceof Error ? error.message : String(error)
    io.stderr(`${message}\n`)
    return 1
  }

  return exitCode
}
