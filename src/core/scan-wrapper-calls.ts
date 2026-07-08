import fs from 'node:fs/promises'

import fg from 'fast-glob'
import { Node, Project, SyntaxKind, VariableDeclarationKind, type CallExpression, type Identifier, type ObjectLiteralExpression, type SourceFile, type VariableDeclaration } from 'ts-morph'

import { DEFAULT_EXCLUDE_GLOBS, DEFAULT_SOURCE_GLOBS } from './defaults'
import { createPathPattern, createRecordId, normalizeLocation, normalizeMethod } from './normalize'
import type { AnalyzerOptions, ApiCallRecord, ApiWrapperConfig, HttpMethod, UnsupportedPattern } from './types'

export interface WrapperCallScanResult {
  apiCalls: ApiCallRecord[]
  unsupported: UnsupportedPattern[]
}

interface StaticContext {
  sourceFile: SourceFile
  stringCache: Map<string, string | null>
  objectCache: Map<string, ObjectLiteralExpression | null>
  visiting: Set<string>
}

export async function scanWrapperCalls(options: AnalyzerOptions): Promise<WrapperCallScanResult> {
  const wrappers = options.apiWrappers ?? []
  if (wrappers.length === 0) {
    return { apiCalls: [], unsupported: [] }
  }

  const cwd = options.cwd
  const sourceGlobs = options.sourceGlobs?.length ? options.sourceGlobs : DEFAULT_SOURCE_GLOBS
  const excludeGlobs = options.excludeGlobs?.length ? options.excludeGlobs : DEFAULT_EXCLUDE_GLOBS

  const files = await fg(sourceGlobs, {
    cwd,
    absolute: true,
    onlyFiles: true,
    ignore: excludeGlobs,
  })

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
  })

  const sourceFiles = await Promise.all(
    files.map(async (filePath) => {
      const text = await fs.readFile(filePath, 'utf8')
      return project.createSourceFile(filePath, text, { overwrite: true })
    }),
  )

  const apiCalls: ApiCallRecord[] = []
  const unsupported: UnsupportedPattern[] = []

  for (const sourceFile of sourceFiles) {
    const context: StaticContext = {
      sourceFile,
      stringCache: new Map(),
      objectCache: new Map(),
      visiting: new Set(),
    }

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const wrapper = identifyWrapperCall(call, wrappers)
      if (!wrapper) {
        continue
      }

      const resolved = resolveWrapperCall(call, wrapper, context)
      if (!resolved) {
        unsupported.push(buildUnsupported(call, `unable to statically resolve wrapper URL for ${wrapper.name}`))
        continue
      }

      const location = getLocation(sourceFile, call)
      const pattern = createPathPattern(stripQueryAndHash(resolved.url), options.baseUrl)

      apiCalls.push({
        id: createRecordId([location.filePath, String(location.line), String(location.column), 'wrapper', resolved.method, pattern.normalized]),
        method: resolved.method,
        pattern,
        location,
        source: 'wrapper',
      })
    }
  }

  apiCalls.sort(compareRecords)
  unsupported.sort(compareUnsupported)

  return { apiCalls, unsupported }
}

function identifyWrapperCall(call: CallExpression, wrappers: ApiWrapperConfig[]): ApiWrapperConfig | null {
  const name = expressionName(call.getExpression())
  if (!name) {
    return null
  }

  return wrappers.find((wrapper) => wrapper.name === name) ?? null
}

function resolveWrapperCall(
  call: CallExpression,
  wrapper: ApiWrapperConfig,
  context: StaticContext,
): { url: string; method: HttpMethod } | null {
  const url = resolveWrapperUrl(call, wrapper, context)
  if (!url) {
    return null
  }

  return {
    url: joinUrl(wrapper.baseUrl ?? null, url),
    method: resolveWrapperMethod(call, wrapper, context) ?? 'UNKNOWN',
  }
}

function resolveWrapperUrl(call: CallExpression, wrapper: ApiWrapperConfig, context: StaticContext): string | null {
  const args = call.getArguments()

  if (wrapper.urlFrom === 'arg.url') {
    const arg = args[wrapper.urlArg ?? 0]
    const object = resolveObjectLiteral(arg, context)
    return object ? resolveUrlFromObject(object, context) : null
  }

  if (wrapper.urlFrom === 'options.url') {
    const arg = args[wrapper.optionsArg ?? 1]
    const object = resolveObjectLiteral(arg, context)
    return object ? resolveUrlFromObject(object, context) : null
  }

  return resolveString(args[wrapper.urlArg ?? 0], context)
}

function resolveWrapperMethod(call: CallExpression, wrapper: ApiWrapperConfig, context: StaticContext): HttpMethod | null {
  const args = call.getArguments()

  if (wrapper.method) {
    return normalizeMethod(String(wrapper.method))
  }

  if (typeof wrapper.methodArg === 'number') {
    const value = resolveString(args[wrapper.methodArg], context)
    return value ? normalizeMethod(value) : 'UNKNOWN'
  }

  if (wrapper.methodFrom === 'arg.method') {
    const object = resolveObjectLiteral(args[wrapper.urlArg ?? 0], context)
    return object ? resolveMethodFromObject(object, context) : null
  }

  if (wrapper.methodFrom === 'options.method') {
    const object = resolveObjectLiteral(args[wrapper.optionsArg ?? 1], context)
    return object ? resolveMethodFromObject(object, context) : null
  }

  return null
}

function expressionName(node: import('ts-morph').Node): string | null {
  if (Node.isIdentifier(node)) {
    return node.getText()
  }

  if (!Node.isPropertyAccessExpression(node)) {
    return null
  }

  const parent = expressionName(node.getExpression())
  if (!parent) {
    return null
  }

  return `${parent}.${node.getName()}`
}

function resolveMethodFromObject(node: ObjectLiteralExpression, context: StaticContext): HttpMethod | null {
  const value = getPropertyValue(node, 'method')
  if (!value) {
    return null
  }

  const resolved = resolveString(value, context)
  return resolved ? normalizeMethod(resolved) : 'UNKNOWN'
}

function resolveUrlFromObject(node: ObjectLiteralExpression, context: StaticContext): string | null {
  const value = getPropertyValue(node, 'url')
  return value ? resolveString(value, context) : null
}

function getPropertyValue(node: ObjectLiteralExpression, name: string): import('ts-morph').Node | undefined {
  const property = node.getProperty(name)
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined
  }

  return property.getInitializer()
}

function resolveObjectLiteral(
  node: import('ts-morph').Node | undefined,
  context: StaticContext,
): ObjectLiteralExpression | null {
  if (!node) {
    return null
  }

  if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isNonNullExpression(node)) {
    return resolveObjectLiteral(node.getExpression(), context)
  }

  if (Node.isObjectLiteralExpression(node)) {
    return node
  }

  if (!Node.isIdentifier(node)) {
    return null
  }

  const cacheKey = getIdentifierCacheKey(node)
  if (context.objectCache.has(cacheKey)) {
    return context.objectCache.get(cacheKey) ?? null
  }

  if (context.visiting.has(cacheKey)) {
    return null
  }

  const declaration = resolveConstDeclaration(node)
  const initializer = declaration?.getInitializer()
  if (!initializer) {
    context.objectCache.set(cacheKey, null)
    return null
  }

  context.visiting.add(cacheKey)
  const resolved = resolveObjectLiteral(initializer, context)
  context.visiting.delete(cacheKey)
  context.objectCache.set(cacheKey, resolved)
  return resolved
}

function resolveString(node: import('ts-morph').Node | undefined, context: StaticContext): string | null {
  if (!node) {
    return null
  }

  if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isNonNullExpression(node)) {
    return resolveString(node.getExpression(), context)
  }

  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText()
  }

  if (Node.isTemplateExpression(node)) {
    let result = node.getHead().getLiteralText()
    for (const span of node.getTemplateSpans()) {
      const value = resolveString(span.getExpression(), context)
      if (value === null) {
        return null
      }
      result += value + span.getLiteral().getLiteralText()
    }
    return result
  }

  if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() === SyntaxKind.PlusToken) {
    const left = resolveString(node.getLeft(), context)
    const right = resolveString(node.getRight(), context)
    if (left === null || right === null) {
      return null
    }
    return left + right
  }

  if (Node.isIdentifier(node)) {
    const cacheKey = getIdentifierCacheKey(node)
    if (context.stringCache.has(cacheKey)) {
      return context.stringCache.get(cacheKey) ?? null
    }

    if (context.visiting.has(cacheKey)) {
      return null
    }

    const declaration = resolveConstDeclaration(node)
    const initializer = declaration?.getInitializer()
    if (!initializer) {
      context.stringCache.set(cacheKey, null)
      return null
    }

    context.visiting.add(cacheKey)
    const resolved = resolveString(initializer, context)
    context.visiting.delete(cacheKey)
    context.stringCache.set(cacheKey, resolved)
    return resolved
  }

  return null
}

function resolveConstDeclaration(identifier: Identifier): VariableDeclaration | null {
  const symbol = identifier.getSymbol()
  if (!symbol) {
    return null
  }

  for (const declaration of symbol.getDeclarations()) {
    if (!Node.isVariableDeclaration(declaration)) {
      continue
    }

    const statement = declaration.getVariableStatement()
    if (!statement || statement.getDeclarationKind() !== VariableDeclarationKind.Const) {
      continue
    }

    if (declaration.getSourceFile().getFilePath() !== identifier.getSourceFile().getFilePath()) {
      continue
    }

    return declaration
  }

  return null
}

function joinUrl(baseUrl: string | null, value: string): string {
  if (!baseUrl || isAbsoluteUrl(value)) {
    return value
  }

  try {
    return new URL(value, baseUrl).toString()
  } catch {
    return value
  }
}

function isAbsoluteUrl(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value)
}

function stripQueryAndHash(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return trimmed
  }

  try {
    if (isAbsoluteUrl(trimmed)) {
      const url = new URL(trimmed)
      url.search = ''
      url.hash = ''
      return url.toString()
    }
  } catch {
    // Fall through to path-based cleanup.
  }

  return trimmed.replace(/[?#].*$/, '')
}

function getIdentifierCacheKey(identifier: Identifier): string {
  return `${identifier.getSourceFile().getFilePath()}:${identifier.getText()}:${identifier.getStart()}`
}

function buildUnsupported(call: CallExpression, reason: string): UnsupportedPattern {
  const sourceFile = call.getSourceFile()
  const location = getLocation(sourceFile, call)
  return {
    kind: 'api-call',
    reason,
    location,
    expressionText: call.getText(),
  }
}

function getLocation(sourceFile: SourceFile, node: import('ts-morph').Node) {
  const { line, column } = sourceFile.getLineAndColumnAtPos(node.getStart())
  return normalizeLocation(sourceFile.getFilePath(), line, column)
}

function compareRecords(left: ApiCallRecord, right: ApiCallRecord): number {
  return compareLocation(left.location, right.location) || left.id.localeCompare(right.id)
}

function compareUnsupported(left: UnsupportedPattern, right: UnsupportedPattern): number {
  return compareLocation(left.location, right.location) || left.expressionText.localeCompare(right.expressionText)
}

function compareLocation(
  left: { filePath: string; line: number; column: number },
  right: { filePath: string; line: number; column: number },
): number {
  return left.filePath.localeCompare(right.filePath) || left.line - right.line || left.column - right.column
}
