import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { runCli } from '../src/cli-main'

interface CliRun {
  code: number
  stdout: string
  stderr: string
}

async function run(args: string[]): Promise<CliRun> {
  let stdout = ''
  let stderr = ''

  const code = await runCli(['node', 'msw-inspector', ...args], {
    stdout: (text) => {
      stdout += text
    },
    stderr: (text) => {
      stderr += text
    },
  })

  return { code, stdout, stderr }
}

async function createProject(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'msw-inspector-cli-'))
  const mocksDir = path.join(cwd, 'src', 'mocks')
  const apiDir = path.join(cwd, 'src', 'api')

  await mkdir(mocksDir, { recursive: true })
  await mkdir(apiDir, { recursive: true })

  await writeFile(
    path.join(mocksDir, 'handlers.ts'),
    `
      import { http } from 'msw'

      export const handlers = [
        http.get('/users/:id', () => null),
        http.get('/stale', () => null),
      ]
    `,
    'utf8',
  )

  await writeFile(
    path.join(apiDir, 'client.ts'),
    `
      export async function load() {
        await fetch('/users/123')
        await fetch('/missing')
      }
    `,
    'utf8',
  )

  return cwd
}

describe('runCli', () => {
  it('prints a text summary and exits 0 by default', async () => {
    const cwd = await createProject()
    const result = await run(['--cwd', cwd])

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('2 handlers found')
    expect(result.stdout).toContain('2 API calls found')
    expect(result.stdout).toContain('Coverage: 50% (1/2)')
  })

  it('prints the full report with --format json', async () => {
    const cwd = await createProject()
    const result = await run(['--cwd', cwd, '--format', 'json'])

    expect(result.code).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report.schemaVersion).toBe(1)
    expect(report.summary.totalCalls).toBe(2)
    expect(report.summary.unmockedCalls).toBe(1)
  })

  it('writes the JSON report to --report-file with a trailing newline', async () => {
    const cwd = await createProject()
    const result = await run(['--cwd', cwd, '--report-file', 'out/msw-inspector.json'])

    expect(result.code).toBe(0)
    const raw = await readFile(path.join(cwd, 'out', 'msw-inspector.json'), 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
    const report = JSON.parse(raw)
    expect(report.schemaVersion).toBe(1)
    expect(report.summary.percentage).toBe(50)
  })

  it('exits 1 when coverage is below --min-coverage', async () => {
    const cwd = await createProject()
    const result = await run(['--cwd', cwd, '--min-coverage', '80'])

    expect(result.code).toBe(1)
  })

  it('exits 0 when coverage meets --min-coverage', async () => {
    const cwd = await createProject()
    const result = await run(['--cwd', cwd, '--min-coverage', '50'])

    expect(result.code).toBe(0)
  })

  it('exits 1 with --fail-on-unmocked when unmocked calls exist', async () => {
    const cwd = await createProject()
    const result = await run(['--cwd', cwd, '--fail-on-unmocked'])

    expect(result.code).toBe(1)
  })

  it('exits 1 with --fail-on-stale when stale handlers exist', async () => {
    const cwd = await createProject()
    const result = await run(['--cwd', cwd, '--fail-on-stale'])

    expect(result.code).toBe(1)
  })
})
