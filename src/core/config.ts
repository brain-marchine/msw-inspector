import { access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { MswInspectorConfig } from './types'

export const DEFAULT_CONFIG_FILES = [
  'msw-inspector.config.cjs',
  'msw-inspector.config.js',
  'msw-inspector.config.mjs',
  'msw-inspector.config.json',
]

export const DEFAULT_INIT_CONFIG_FILE = 'msw-inspector.config.cjs'

export const INIT_CONFIG_CONTENT = `/** @type {import('msw-inspector-cli').MswInspectorConfig} */
module.exports = {
  handlers: [
    'src/mocks/**/*.{ts,tsx,js,jsx}',
    'mocks/**/*.{ts,tsx,js,jsx}',
    'src/test/**/*.{ts,tsx,js,jsx}',
  ],
  sources: [
    'src/**/*.{ts,tsx,js,jsx}',
    'app/**/*.{ts,tsx,js,jsx}',
    'pages/**/*.{ts,tsx,js,jsx}',
  ],
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/.next/**',
    '**/.turbo/**',
    '**/build/**',
    '**/*.d.ts',
    '**/*.{test,spec}.{ts,tsx,js,jsx}',
  ],
  baseUrl: 'http://localhost:3000',
  apiWrappers: [
    // Teach the scanner project-specific request helpers.
    // { name: 'api.get', method: 'GET', urlArg: 0 },
    // { name: 'api.post', method: 'POST', urlArg: 0 },
    // { name: 'request', urlArg: 0, methodFrom: 'options.method', optionsArg: 1 },
    // { name: 'request', urlFrom: 'arg.url', methodFrom: 'arg.method' },
  ],
}
`

export interface LoadedConfig {
  path?: string
  config: MswInspectorConfig
}

export function defineConfig(config: MswInspectorConfig): MswInspectorConfig {
  return config
}

export async function loadConfig(cwd: string, configPath?: string): Promise<LoadedConfig> {
  if (configPath) {
    const resolved = path.resolve(cwd, configPath)
    return {
      path: resolved,
      config: await readConfigFile(resolved),
    }
  }

  for (const filename of DEFAULT_CONFIG_FILES) {
    const resolved = path.join(cwd, filename)
    if (!(await exists(resolved))) {
      continue
    }

    return {
      path: resolved,
      config: await readConfigFile(resolved),
    }
  }

  return { config: {} }
}

async function readConfigFile(filePath: string): Promise<MswInspectorConfig> {
  const extension = path.extname(filePath)

  if (extension === '.json') {
    const raw = await readFile(filePath, 'utf8')
    return normalizeConfig(JSON.parse(raw), filePath)
  }

  if (extension === '.cjs' || extension === '.js') {
    const requireFromConfig = createRequire(filePath)
    const loaded = requireFromConfig(filePath) as unknown
    return normalizeConfig(readDefaultExport(loaded), filePath)
  }

  if (extension === '.mjs') {
    const loaded = (await import(pathToFileURL(filePath).href)) as unknown
    return normalizeConfig(readDefaultExport(loaded), filePath)
  }

  if (extension === '.ts' || extension === '.mts' || extension === '.cts') {
    throw new Error(
      `Cannot load ${path.basename(filePath)} directly. Use ${DEFAULT_INIT_CONFIG_FILE}, .js, .mjs, or .json for now.`,
    )
  }

  throw new Error(`Unsupported msw-inspector config extension: ${extension || '(none)'}`)
}

function readDefaultExport(value: unknown): unknown {
  if (!isRecord(value)) {
    return value
  }

  return 'default' in value ? value.default : value
}

function normalizeConfig(value: unknown, filePath: string): MswInspectorConfig {
  if (!isRecord(value)) {
    throw new Error(`Invalid config in ${filePath}. Expected an object.`)
  }

  return {
    handlers: readStringArray(value.handlers, 'handlers', filePath),
    sources: readStringArray(value.sources, 'sources', filePath),
    exclude: readStringArray(value.exclude, 'exclude', filePath),
    baseUrl: readOptionalString(value.baseUrl, 'baseUrl', filePath),
    apiWrappers: Array.isArray(value.apiWrappers) ? value.apiWrappers : undefined,
  }
}

function readStringArray(value: unknown, field: string, filePath: string): string[] | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`Invalid ${field} in ${filePath}. Expected an array of strings.`)
  }

  return value
}

function readOptionalString(value: unknown, field: string, filePath: string): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new Error(`Invalid ${field} in ${filePath}. Expected a string.`)
  }

  return value
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
