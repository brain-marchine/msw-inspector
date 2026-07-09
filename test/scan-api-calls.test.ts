import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { scanApiCalls } from '../src/core/scan-api-calls'

const fixturesDir = path.join(process.cwd(), 'test/fixtures/api-calls')

describe('scanApiCalls', () => {
  it('extracts static fetch and axios calls and flags dynamic urls', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'msw-inspector-api-'))
    const sourceDir = path.join(cwd, 'src')
    await mkdir(sourceDir, { recursive: true })
    await writeFile(
      path.join(sourceDir, 'api.ts'),
      `
        import axios from 'axios'

        const USER_ID = '123'
        const buildUrl = () => '/dynamic'

        export async function run() {
          await fetch(\`/users/\${USER_ID}?view=full\`, { method: 'post' })
          await window.fetch(new URL('/v1/orders?debug=1', 'https://api.example.com'))
          await axios.get('/search/active')
          await axios.request({ method: 'head', url: 'https://api.example.com/logs?level=info' })
          await axios(buildUrl())
        }
      `,
      'utf8',
    )

    const result = await scanApiCalls({
      cwd,
      sourceGlobs: ['src/**/*.ts'],
    })

    expect(result.apiCalls).toHaveLength(4)
    expect(result.apiCalls.map((call) => [call.source, call.method, call.pattern.normalized])).toEqual([
      ['fetch', 'POST', '/users/123'],
      ['fetch', 'GET', 'https://api.example.com/v1/orders'],
      ['axios', 'GET', '/search/active'],
      ['axios', 'HEAD', 'https://api.example.com/logs'],
    ])

    expect(result.unsupported).toHaveLength(1)
    expect(result.unsupported[0]?.reason).toBe('unable to statically resolve axios URL')
  })

  it('supports axios instances and keeps unresolved methods as UNKNOWN', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'msw-inspector-api-'))
    const sourceDir = path.join(cwd, 'src')
    await mkdir(sourceDir, { recursive: true })
    await writeFile(
      path.join(sourceDir, 'client.ts'),
      `
        import axios from 'axios'

        const API = axios.create({ baseURL: 'https://api.example.com/v1' })
        const REQUEST_INIT = { method: 'delete' }

        export async function run(opts) {
          await API.get('/users?active=1')
          await API({ url: '/health', method: 'head' })
          await fetch('/projects/123', REQUEST_INIT)
          await fetch('/dynamic', opts)
        }
      `,
      'utf8',
    )

    const result = await scanApiCalls({
      cwd,
      sourceGlobs: ['src/**/*.ts'],
    })

    expect(result.apiCalls.map((call) => [call.source, call.method, call.pattern.normalized])).toEqual([
      ['axios', 'GET', 'https://api.example.com/users'],
      ['axios', 'HEAD', 'https://api.example.com/health'],
      ['fetch', 'DELETE', '/projects/123'],
      ['fetch', 'UNKNOWN', '/dynamic'],
    ])
    expect(result.unsupported).toEqual([])
  })

  it('supports axios instance aliases and ignores locally shadowed fetch and axios bindings', async () => {
    const result = await scanApiCalls({
      cwd: fixturesDir,
      sourceGlobs: ['src/**/*.ts'],
    })

    expect(result.apiCalls.map((call) => [call.source, call.method, call.pattern.normalized])).toEqual([
      ['fetch', 'GET', '/users'],
      ['fetch', 'GET', 'https://api.example.com/checkout'],
      ['fetch', 'PATCH', '/posts'],
      ['fetch', 'UNKNOWN', '/profile'],
      ['axios', 'POST', '/checkout'],
      ['axios', 'GET', 'https://api.example.com/users'],
      ['axios', 'GET', 'https://api.example.com/users'],
      ['axios', 'PATCH', 'https://api.example.com/search/active'],
      ['axios', 'DELETE', '/orders'],
      ['axios', 'HEAD', '/accounts'],
      ['axios', 'PATCH', 'https://api.example.com/refresh'],
      ['axios', 'PATCH', 'https://api.example.com/mirror'],
      ['fetch', 'PUT', '/request-literal'],
    ])
    expect(result.unsupported.map((item) => item.expressionText)).toEqual([
      'fetch(new Request(randomUrl))',
    ])
  })

  it('resolves fetch(new Request(...)) constructions', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'msw-inspector-api-'))
    const sourceDir = path.join(cwd, 'src')
    await mkdir(sourceDir, { recursive: true })
    await writeFile(
      path.join(sourceDir, 'requests.ts'),
      `
        const saved = new Request('/saved', { method: 'delete' })
        const dynamic = Math.random() > 0.5 ? '/a' : '/b'

        export async function run() {
          await fetch(new Request('/orders'))
          await fetch(new Request('/orders', { method: 'post' }))
          await fetch(new Request('/orders', { method: 'post' }), { method: 'patch' })
          await fetch(saved)
          await fetch(new Request(dynamic))
        }
      `,
      'utf8',
    )

    const result = await scanApiCalls({
      cwd,
      sourceGlobs: ['src/**/*.ts'],
    })

    expect(result.apiCalls.map((call) => [call.method, call.pattern.normalized])).toEqual([
      ['GET', '/orders'],
      ['POST', '/orders'],
      ['PATCH', '/orders'],
      ['DELETE', '/saved'],
    ])
    expect(result.unsupported.map((item) => item.expressionText)).toEqual([
      'fetch(new Request(dynamic))',
    ])
  })

  it('resolves relative API calls against a configured baseUrl', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'msw-inspector-api-'))
    const sourceDir = path.join(cwd, 'src')
    await mkdir(sourceDir, { recursive: true })
    await writeFile(
      path.join(sourceDir, 'api.ts'),
      `
        import axios from 'axios'

        export async function run() {
          await fetch('/users/123?view=full')
          await axios.get('health')
        }
      `,
      'utf8',
    )

    const result = await scanApiCalls({
      cwd,
      baseUrl: 'https://api.example.com/v1/',
      sourceGlobs: ['src/**/*.ts'],
    })

    expect(result.apiCalls.map((call) => [call.source, call.method, call.pattern.normalized])).toEqual([
      ['fetch', 'GET', 'https://api.example.com/users/123'],
      ['axios', 'GET', 'https://api.example.com/v1/health'],
    ])
  })
})
