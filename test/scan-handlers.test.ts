import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildCoverageReport } from '../src/core/compare'
import { createPathPattern } from '../src/core/normalize'
import { scanHandlers } from '../src/core/scan-handlers'

const fixturesDir = path.join(process.cwd(), 'test/fixtures/handlers')

async function scanHandlerSource(source: string, fileName = 'handlers.ts') {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'msw-inspector-handlers-'))
  const sourceDir = path.join(cwd, 'src')
  await mkdir(sourceDir, { recursive: true })
  await writeFile(path.join(sourceDir, fileName), source, 'utf8')

  return scanHandlers({
    cwd,
    handlerGlobs: ['src/**/*.{ts,tsx,js,jsx,mts,mjs,cjs}'],
  })
}

describe('scanHandlers', () => {
  it('extracts static msw handlers and flags unsupported ones', async () => {
    const result = await scanHandlers({
      cwd: fixturesDir,
      handlerGlobs: ['src/**/*.{ts,tsx,js,jsx,mts,mjs,cjs}'],
    })

    expect(result.handlers).toHaveLength(7)
    expect(result.unsupported).toHaveLength(1)

    expect(result.handlers.map((handler) => [handler.source, handler.method, handler.pattern.normalized])).toEqual([
      ['msw-http', 'GET', '/users/:id'],
      ['msw-rest', 'POST', 'https://api.example.com/v1/orders'],
      ['msw-http', 'DELETE', '/search/active'],
      ['msw-rest', 'GET', '/https?:\\/\\/example\\.com\\/legacy\\/.*/'],
      ['msw-rest', 'ALL', '/health'],
      ['msw-http', 'HEAD', 'https://api.example.com/logs'],
      ['msw-http', 'PUT', '/dynamic'],
    ])

    expect(result.unsupported.map((item) => item.reason)).toEqual([
      'bare new URL() is not supported; use .href or .toString()',
    ])
  })

  it('resolves relative handlers against a configured baseUrl', async () => {
    const result = await scanHandlers({
      cwd: fixturesDir,
      baseUrl: 'https://api.example.com/v2/',
      handlerGlobs: ['src/**/*.{ts,tsx,js,jsx,mts,mjs,cjs}'],
    })

    expect(result.handlers.map((handler) => [handler.method, handler.pattern.normalized])).toContainEqual([
      'GET',
      'https://api.example.com/users/:id',
    ])
    expect(result.handlers.map((handler) => [handler.method, handler.pattern.normalized])).toContainEqual([
      'DELETE',
      'https://api.example.com/search/active',
    ])
  })

  it('resolves direct and const-backed URL.href matchers', async () => {
    const result = await scanHandlerSource(`
      import { http } from 'msw'

      const BASE = 'https://api.example.com/v1/'
      const endpoint = new URL('const?preview=true#details', BASE)
      const savedHref = new URL('saved?preview=true#details', BASE).href
      const absolute = new URL('https://api.example.com/absolute?preview=true#details')

      export const handlers = [
        http.get(new URL('direct?preview=true#details', BASE).href, () => null),
        http.post(endpoint.href, () => null),
        http.put(savedHref, () => null),
        http.head(absolute.href, () => null),
      ]
    `)

    expect(result.unsupported).toEqual([])
    expect(result.handlers.map((handler) => [handler.method, handler.pattern.normalized])).toEqual([
      ['GET', 'https://api.example.com/v1/direct'],
      ['POST', 'https://api.example.com/v1/const'],
      ['PUT', 'https://api.example.com/v1/saved'],
      ['HEAD', 'https://api.example.com/absolute'],
    ])
  })

  it('preserves static RegExp constructor semantics through matching', async () => {
    const result = await scanHandlerSource(`
      import { http } from 'msw'

      const matcher = new RegExp('^/users/\\\\d+$', 'i')

      export const handlers = [
        http.get(matcher, () => null),
      ]
    `)

    const [handler] = result.handlers
    expect(handler?.pattern.raw).toBe(new RegExp('^/users/\\d+$', 'i').toString())

    const report = buildCoverageReport({
      handlers: result.handlers,
      apiCalls: [
        {
          id: 'matched',
          method: 'GET',
          pattern: createPathPattern('/USERS/42'),
          location: { filePath: 'api.ts', line: 1, column: 1 },
          source: 'fetch',
        },
        {
          id: 'unmatched',
          method: 'GET',
          pattern: createPathPattern('/users/not-a-number'),
          location: { filePath: 'api.ts', line: 2, column: 1 },
          source: 'fetch',
        },
      ],
    })

    expect(report.mockedCallIds).toEqual(['matched'])
    expect(report.unmockedCallIds).toEqual(['unmatched'])
  })

  it('uses TypeScript bindings for MSW imports and matcher constants', async () => {
    const result = await scanHandlerSource(`
      import { http as h, rest } from 'msw'
      import * as msw from 'msw'

      const PATH = '/outer'

      export const handlers = [
        h.get('/real', () => null),
        rest.post('/rest', () => null),
        msw.http.put('/namespace', () => null),
      ]

      function nestedHandler() {
        const PATH = '/nested'
        const alias = PATH
        return h.patch(alias, () => null)
      }

      function fakeHandler(h) {
        return h.get('/fake-direct', () => null)
      }

      function fakeNamespaceHandler(msw) {
        return msw.http.get('/fake-namespace', () => null)
      }

      function unresolvedHandler() {
        const PATH = getPath()
        return h.delete(PATH, () => null)
      }
    `)

    expect(result.handlers.map((handler) => [handler.method, handler.pattern.normalized])).toEqual([
      ['GET', '/real'],
      ['POST', '/rest'],
      ['PUT', '/namespace'],
      ['PATCH', '/nested'],
    ])
    expect(result.unsupported).toHaveLength(1)
    expect(result.unsupported[0]?.expressionText).toBe('h.delete(PATH, () => null)')
    expect(result.unsupported[0]?.reason).toBe('unable to statically resolve const PATH')
  })

  it('keeps JavaScript import fallbacks scope-aware', async () => {
    const result = await scanHandlerSource(`
      import { http as h } from 'msw'
      import * as msw from 'msw'

      export const handlers = [
        h.get('/real', () => null),
        msw.http.post('/real-namespace', () => null),
      ]

      function fakeHandler(h) {
        return h.get('/fake-direct', () => null)
      }

      function fakeNamespaceHandler(msw) {
        return msw.http.get('/fake-namespace', () => null)
      }
    `, 'handlers.js')

    expect(result.handlers.map((handler) => [handler.method, handler.pattern.normalized])).toEqual([
      ['GET', '/real'],
      ['POST', '/real-namespace'],
    ])
    expect(result.unsupported).toEqual([])
  })
})
