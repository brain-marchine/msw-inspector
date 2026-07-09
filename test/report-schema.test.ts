import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'

import { analyzeProject } from '../src/core/analyze'

describe('coverage report schema', () => {
  it('validates real analyzer output against schema/coverage-report.v1.json', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'msw-inspector-schema-'))
    const mocksDir = path.join(cwd, 'src', 'mocks')
    const apiDir = path.join(cwd, 'src', 'api')

    await mkdir(mocksDir, { recursive: true })
    await mkdir(apiDir, { recursive: true })

    // Exercise every report bucket: mocked, unmocked, ambiguous, stale,
    // regexp handlers, and unsupported patterns.
    await writeFile(
      path.join(mocksDir, 'handlers.ts'),
      `
        import { http, rest } from 'msw'

        const dynamic = Math.random() > 0.5 ? '/a' : '/b'

        export const handlers = [
          http.get('/users/:id', () => null),
          http.get('/stale', () => null),
          http.post('/profile', () => null),
          rest.get(/legacy/, () => null),
          http.put(dynamic, () => null),
        ]
      `,
      'utf8',
    )

    await writeFile(
      path.join(apiDir, 'client.ts'),
      `
        export async function run(init: RequestInit) {
          await fetch('/users/123')
          await fetch('/missing')
          await fetch('/profile', init)
        }
      `,
      'utf8',
    )

    const report = await analyzeProject({
      cwd,
      handlerGlobs: ['src/mocks/**/*.ts'],
      sourceGlobs: ['src/api/**/*.ts'],
    })

    expect(report.summary.unmockedCalls).toBeGreaterThan(0)
    expect(report.summary.ambiguousCalls).toBeGreaterThan(0)
    expect(report.summary.staleHandlers).toBeGreaterThan(0)
    expect(report.unsupported.length).toBeGreaterThan(0)

    const schemaPath = path.join(process.cwd(), 'schema', 'coverage-report.v1.json')
    const schema = JSON.parse(await readFile(schemaPath, 'utf8'))

    const ajv = new Ajv({ allErrors: true })
    const validate = ajv.compile(schema)

    // Round-trip through JSON so the schema sees exactly what CI consumers see.
    const valid = validate(JSON.parse(JSON.stringify(report)))
    expect(validate.errors ?? []).toEqual([])
    expect(valid).toBe(true)
  })
})
