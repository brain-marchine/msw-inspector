import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { normalizeLocation, toRepoRelativePath } from '../src/core/normalize'

describe('toRepoRelativePath', () => {
  it('returns paths relative to the scan root with forward slashes', () => {
    const cwd = path.join(path.sep, 'repo')
    const filePath = path.join(cwd, 'src', 'mocks', 'handlers.ts')

    expect(toRepoRelativePath(cwd, filePath)).toBe('src/mocks/handlers.ts')
  })

  it('returns "." for the scan root itself', () => {
    const cwd = path.join(path.sep, 'repo')

    expect(toRepoRelativePath(cwd, cwd)).toBe('.')
  })
})

describe('normalizeLocation', () => {
  it('stores repo-relative file paths', () => {
    const cwd = path.join(path.sep, 'repo')
    const location = normalizeLocation(cwd, path.join(cwd, 'src', 'api.ts'), 3, 7)

    expect(location).toEqual({ filePath: 'src/api.ts', line: 3, column: 7 })
  })
})
