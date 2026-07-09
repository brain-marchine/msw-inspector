import fs from 'node:fs/promises'

import fg from 'fast-glob'
import { Node, Project, SyntaxKind, VariableDeclarationKind, type CallExpression, type Identifier, type ObjectLiteralExpression, type SourceFile, type VariableDeclaration } from 'ts-morph'

import { DEFAULT_EXCLUDE_GLOBS, DEFAULT_SOURCE_GLOBS } from './defaults'
import { createPathPattern, createRecordId, normalizeLocation, normalizeMethod } from './normalize'
import type { AnalyzerOptions, ApiCallRecord, HttpMethod, UnsupportedPattern } from './types'

export interface ApiCallScanResult {
  apiCalls: ApiCallRecord[]
  unsupported: UnsupportedPattern[]
}

interface ImportBindings {
  axios: Set<string>
}

interface AxiosTarget {
  baseUrl: string | null
}

interface StaticContext {
  sourceFile: SourceFile
  stringCache: Map<string, string | null>
  objectCache: Map<string, ObjectLiteralExpression | null>
  axiosTargetCache: Map<string, AxiosTarget | null>
  visiting: Set<string>
}

type ApiCallMeta =
  | { kind: 'fetch'; source: 'fetch' }
  | { kind: 'axios-call'; source: 'axios'; target: AxiosTarget }
  | { kind: 'axios-verb'; source: 'axios'; target: AxiosTarget; method: HttpMethod }
  | { kind: 'axios-request'; source: 'axios'; target: AxiosTarget }

const AXIOS_HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])
const FETCH_ROOTS = new Set(['window', 'globalThis', 'self', 'global'])

export async function scanApiCalls(options: AnalyzerOptions): Promise<ApiCallScanResult> {
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
    const bindings = collectImportBindings(sourceFile)
    const context: StaticContext = {
      sourceFile,
      stringCache: new Map(),
      objectCache: new Map(),
      axiosTargetCache: new Map(),
      visiting: new Set(),
    }

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const meta = identifyApiCall(call, bindings, context)
      if (!meta) {
        continue
      }

      const resolved = resolveApiCall(call, meta, context)
      if (!resolved) {
        unsupported.push(buildUnsupported(cwd, call, `unable to statically resolve ${meta.source} URL`))
        continue
      }

      const location = getLocation(cwd, sourceFile, call)
      const pattern = createPathPattern(stripQueryAndHash(resolved.url), options.baseUrl)

      apiCalls.push({
        id: createRecordId([location.filePath, String(location.line), String(location.column), meta.source, resolved.method, pattern.normalized]),
        method: resolved.method,
        pattern,
        location,
        source: meta.source,
      })
    }
  }

  apiCalls.sort(compareRecords)
  unsupported.sort(compareUnsupported)

  return {
    apiCalls,
    unsupported,
  }
}

function collectImportBindings(sourceFile: SourceFile): ImportBindings {
  const axios = new Set<string>()

  for (const declaration of sourceFile.getImportDeclarations()) {
    if (declaration.getModuleSpecifierValue() !== 'axios') {
      continue
    }

    const defaultImport = declaration.getDefaultImport()
    if (defaultImport) {
      axios.add(defaultImport.getText())
    }

    const namespaceImport = declaration.getNamespaceImport()
    if (namespaceImport) {
      axios.add(namespaceImport.getText())
    }
  }

  for (const statement of sourceFile.getVariableStatements()) {
    for (const declaration of statement.getDeclarations()) {
      const initializer = declaration.getInitializer()
      if (!initializer || !Node.isCallExpression(initializer)) {
        continue
      }

      if (!isRequireCall(initializer, 'axios')) {
        continue
      }

      if (Node.isIdentifier(declaration.getNameNode())) {
        axios.add(declaration.getNameNode().getText())
      }
    }
  }

  return { axios }
}

function identifyApiCall(call: CallExpression, bindings: ImportBindings, context: StaticContext): ApiCallMeta | null {
  const expression = call.getExpression()

  if (Node.isIdentifier(expression) && expression.getText() === 'fetch' && isGlobalFetchIdentifier(expression)) {
    return {
      kind: 'fetch',
      source: 'fetch',
    }
  }

  if (Node.isPropertyAccessExpression(expression) && expression.getName() === 'fetch' && isFetchRoot(expression.getExpression())) {
    return {
      kind: 'fetch',
      source: 'fetch',
    }
  }

  if (Node.isIdentifier(expression)) {
    const target = resolveAxiosTarget(expression, bindings, context)
    if (target) {
      return {
        kind: 'axios-call',
        source: 'axios',
        target,
      }
    }
  }

  if (!Node.isPropertyAccessExpression(expression)) {
    return null
  }

  const target = resolveAxiosTarget(expression.getExpression(), bindings, context)
  if (!target) {
    return null
  }

  const name = expression.getName()
  if (AXIOS_HTTP_METHODS.has(name)) {
    return {
      kind: 'axios-verb',
      source: 'axios',
      target,
      method: normalizeMethod(name),
    }
  }

  if (name === 'request') {
    return {
      kind: 'axios-request',
      source: 'axios',
      target,
    }
  }

  return null
}

function resolveApiCall(
  call: CallExpression,
  meta: ApiCallMeta,
  context: StaticContext,
): { url: string; method: HttpMethod } | null {
  if (meta.kind === 'fetch') {
    return resolveFetchCall(call, context)
  }

  if (meta.kind === 'axios-verb') {
    return resolveAxiosVerbCall(call, meta.target, meta.method, context)
  }

  if (meta.kind === 'axios-request') {
    return resolveAxiosConfigCall(call.getArguments()[0], meta.target, context)
  }

  return resolveAxiosDirectCall(call, meta.target, context)
}

function resolveFetchCall(call: CallExpression, context: StaticContext): { url: string; method: HttpMethod } | null {
  const [input, initArg] = call.getArguments()

  const request = input ? resolveRequestConstruction(input, context) : null
  const url = request ? request.url : resolveString(input, context)
  if (!url) {
    return null
  }

  if (!initArg) {
    return { url, method: request ? request.method : 'GET' }
  }

  const init = resolveObjectLiteral(initArg, context)
  if (!init) {
    return { url, method: 'UNKNOWN' }
  }

  // Per the fetch spec, the init argument overrides the Request's own method.
  return {
    url,
    method: resolveMethodFromObject(init, context) ?? (request ? request.method : 'GET'),
  }
}

function resolveRequestConstruction(node: import('ts-morph').Node, context: StaticContext): { url: string; method: HttpMethod } | null {
  if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isNonNullExpression(node)) {
    return resolveRequestConstruction(node.getExpression(), context)
  }

  if (Node.isIdentifier(node)) {
    const cacheKey = getIdentifierCacheKey(node)
    if (context.visiting.has(cacheKey)) {
      return null
    }

    const declaration = resolveConstDeclaration(node)
    const initializer = declaration?.getInitializer()
    if (!initializer) {
      return null
    }

    context.visiting.add(cacheKey)
    const resolved = resolveRequestConstruction(initializer, context)
    context.visiting.delete(cacheKey)
    return resolved
  }

  if (!Node.isNewExpression(node) || !isIdentifierName(node.getExpression(), 'Request')) {
    return null
  }

  const [urlArg, initArg] = node.getArguments()
  const url = urlArg ? resolveString(urlArg, context) : null
  if (!url) {
    return null
  }

  if (!initArg) {
    return { url, method: 'GET' }
  }

  const init = resolveObjectLiteral(initArg, context)
  if (!init) {
    return { url, method: 'UNKNOWN' }
  }

  return {
    url,
    method: resolveMethodFromObject(init, context) ?? 'GET',
  }
}

function resolveAxiosDirectCall(
  call: CallExpression,
  target: AxiosTarget,
  context: StaticContext,
): { url: string; method: HttpMethod } | null {
  const [firstArg, secondArg] = call.getArguments()
  const config = resolveObjectLiteral(firstArg, context)
  if (config) {
    return resolveAxiosConfigObject(config, target, context)
  }

  const url = resolveString(firstArg, context)
  if (!url) {
    return null
  }

  if (!secondArg) {
    return {
      url: joinUrl(target.baseUrl, url),
      method: 'GET',
    }
  }

  const secondConfig = resolveObjectLiteral(secondArg, context)
  if (!secondConfig) {
    return {
      url: joinUrl(target.baseUrl, url),
      method: 'UNKNOWN',
    }
  }

  return {
    url: joinUrl(resolveBaseUrlFromObject(secondConfig, context) ?? target.baseUrl, url),
    method: resolveMethodFromObject(secondConfig, context) ?? 'GET',
  }
}

function resolveAxiosVerbCall(
  call: CallExpression,
  target: AxiosTarget,
  method: HttpMethod,
  context: StaticContext,
): { url: string; method: HttpMethod } | null {
  const [input, , configArg] = call.getArguments()
  const url = resolveString(input, context)
  if (!url) {
    return null
  }

  const secondArg = call.getArguments()[1]
  const configNode = method === 'POST' || method === 'PUT' || method === 'PATCH' ? configArg : secondArg
  const config = configNode ? resolveObjectLiteral(configNode, context) : null

  return {
    url: joinUrl(config ? resolveBaseUrlFromObject(config, context) ?? target.baseUrl : target.baseUrl, url),
    method,
  }
}

function resolveAxiosConfigCall(
  arg: import('ts-morph').Node | undefined,
  target: AxiosTarget,
  context: StaticContext,
): { url: string; method: HttpMethod } | null {
  if (!arg) {
    return null
  }

  const config = resolveObjectLiteral(arg, context)
  if (!config) {
    return null
  }

  return resolveAxiosConfigObject(config, target, context)
}

function resolveAxiosConfigObject(
  config: ObjectLiteralExpression,
  target: AxiosTarget,
  context: StaticContext,
): { url: string; method: HttpMethod } | null {
  const url = resolveUrlFromObject(config, context)
  if (!url) {
    return null
  }

  return {
    url: joinUrl(resolveBaseUrlFromObject(config, context) ?? target.baseUrl, url),
    method: resolveMethodFromObject(config, context) ?? 'GET',
  }
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

function resolveBaseUrlFromObject(node: ObjectLiteralExpression, context: StaticContext): string | null {
  const value = getPropertyValue(node, 'baseURL')
  return value ? resolveString(value, context) : null
}

function getPropertyValue(node: ObjectLiteralExpression, name: string): import('ts-morph').Node | undefined {
  const property = node.getProperty(name)
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined
  }

  return property.getInitializer()
}

function resolveAxiosTarget(
  node: import('ts-morph').Node,
  bindings: ImportBindings,
  context: StaticContext,
): AxiosTarget | null {
  if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isNonNullExpression(node)) {
    return resolveAxiosTarget(node.getExpression(), bindings, context)
  }

  if (!Node.isIdentifier(node)) {
    if (Node.isCallExpression(node)) {
      const expression = node.getExpression()
      if (Node.isPropertyAccessExpression(expression) && expression.getName() === 'create') {
        const parentTarget = resolveAxiosTarget(expression.getExpression(), bindings, context)
        if (!parentTarget) {
          return null
        }

        const config = resolveObjectLiteral(node.getArguments()[0], context)
        return {
          baseUrl: config ? resolveBaseUrlFromObject(config, context) ?? parentTarget.baseUrl : parentTarget.baseUrl,
        }
      }
    }

    return null
  }

  const cacheKey = getIdentifierCacheKey(node)
  if (context.axiosTargetCache.has(cacheKey)) {
    return context.axiosTargetCache.get(cacheKey) ?? null
  }

  if (isAxiosBindingIdentifier(node, bindings)) {
    const root = { baseUrl: null }
    context.axiosTargetCache.set(cacheKey, root)
    return root
  }

  if (context.visiting.has(cacheKey)) {
    return null
  }

  const declaration = resolveConstDeclaration(node)
  const initializer = declaration?.getInitializer()
  if (!initializer) {
    context.axiosTargetCache.set(cacheKey, null)
    return null
  }

  if (Node.isIdentifier(initializer)) {
    context.visiting.add(cacheKey)
    const aliasTarget = resolveAxiosTarget(initializer, bindings, context)
    context.visiting.delete(cacheKey)
    context.axiosTargetCache.set(cacheKey, aliasTarget)
    return aliasTarget
  }

  if (!Node.isCallExpression(initializer)) {
    context.axiosTargetCache.set(cacheKey, null)
    return null
  }

  const expression = initializer.getExpression()
  if (!Node.isPropertyAccessExpression(expression) || expression.getName() !== 'create') {
    context.axiosTargetCache.set(cacheKey, null)
    return null
  }

  context.visiting.add(cacheKey)
  const parentTarget = resolveAxiosTarget(expression.getExpression(), bindings, context)
  context.visiting.delete(cacheKey)
  if (!parentTarget) {
    context.axiosTargetCache.set(cacheKey, null)
    return null
  }

  const config = resolveObjectLiteral(initializer.getArguments()[0], context)
  const resolved = {
    baseUrl: config ? resolveBaseUrlFromObject(config, context) ?? parentTarget.baseUrl : parentTarget.baseUrl,
  }

  context.axiosTargetCache.set(cacheKey, resolved)
  return resolved
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

  const urlValue = resolveUrlExpression(node, context)
  if (urlValue !== null) {
    return urlValue
  }

  if (Node.isCallExpression(node) && isStringConstructor(node)) {
    return resolveString(node.getArguments()[0], context)
  }

  if (!Node.isIdentifier(node)) {
    return null
  }

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

function resolveUrlExpression(node: import('ts-morph').Node, context: StaticContext): string | null {
  if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isNonNullExpression(node)) {
    return resolveUrlExpression(node.getExpression(), context)
  }

  if (Node.isPropertyAccessExpression(node) && node.getName() === 'href') {
    return resolveUrlExpression(node.getExpression(), context)
  }

  if (Node.isCallExpression(node) && isToStringCall(node)) {
    const expression = node.getExpression()
    if (Node.isPropertyAccessExpression(expression)) {
      return resolveUrlExpression(expression.getExpression(), context)
    }
    return null
  }

  if (Node.isNewExpression(node) && isIdentifierName(node.getExpression(), 'URL')) {
    const [pathArg, baseArg] = node.getArguments()
    const path = resolveString(pathArg, context)
    if (!path) {
      return null
    }

    const base = baseArg ? resolveString(baseArg, context) : null
    try {
      return base ? new URL(path, base).toString() : new URL(path).toString()
    } catch {
      return null
    }
  }

  if (Node.isCallExpression(node) && isStringConstructor(node)) {
    return resolveUrlExpression(node.getArguments()[0], context)
  }

  if (!Node.isIdentifier(node)) {
    return null
  }

  if (context.visiting.has(getIdentifierCacheKey(node))) {
    return null
  }

  const declaration = resolveConstDeclaration(node)
  const initializer = declaration?.getInitializer()
  if (!initializer) {
    return null
  }

  return resolveUrlExpression(initializer, context)
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

function isGlobalFetchIdentifier(identifier: Identifier): boolean {
  const symbol = identifier.getSymbol()
  if (!symbol) {
    return true
  }

  return !symbol.getDeclarations().some((declaration) => declaration.getSourceFile().getFilePath() === identifier.getSourceFile().getFilePath())
}

function isAxiosBindingIdentifier(identifier: Identifier, bindings: ImportBindings): boolean {
  if (!bindings.axios.has(identifier.getText())) {
    return false
  }

  const symbol = identifier.getSymbol()
  if (!symbol) {
    return false
  }

  return symbol.getDeclarations().some((declaration) => {
    if (declaration.getSourceFile().getFilePath() !== identifier.getSourceFile().getFilePath()) {
      return false
    }

    if (Node.isImportClause(declaration) || Node.isNamespaceImport(declaration)) {
      return true
    }

    if (!Node.isVariableDeclaration(declaration)) {
      return false
    }

    const initializer = declaration.getInitializer()
    return Boolean(initializer && Node.isCallExpression(initializer) && isRequireCall(initializer, 'axios'))
  })
}

function isFetchRoot(node: import('ts-morph').Node): boolean {
  if (Node.isIdentifier(node)) {
    return FETCH_ROOTS.has(node.getText())
  }

  if (Node.isPropertyAccessExpression(node)) {
    return isFetchRoot(node.getExpression())
  }

  return false
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

function isIdentifierName(node: import('ts-morph').Node, name: string): boolean {
  return Node.isIdentifier(node) && node.getText() === name
}

function isRequireCall(node: CallExpression, moduleName: string): boolean {
  const expression = node.getExpression()
  const [arg] = node.getArguments()
  return isIdentifierName(expression, 'require') && Node.isStringLiteral(arg) && arg.getLiteralText() === moduleName
}

function isStringConstructor(node: CallExpression): boolean {
  return isIdentifierName(node.getExpression(), 'String') && node.getArguments().length === 1
}

function isToStringCall(node: CallExpression): boolean {
  const expression = node.getExpression()
  return Node.isPropertyAccessExpression(expression) && expression.getName() === 'toString' && node.getArguments().length === 0
}

function getIdentifierCacheKey(identifier: Identifier): string {
  return `${identifier.getSourceFile().getFilePath()}:${identifier.getText()}:${identifier.getStart()}`
}

function buildUnsupported(cwd: string, call: CallExpression, reason: string): UnsupportedPattern {
  const sourceFile = call.getSourceFile()
  const location = getLocation(cwd, sourceFile, call)
  return {
    kind: 'api-call',
    reason,
    location,
    expressionText: call.getText(),
  }
}

function getLocation(cwd: string, sourceFile: SourceFile, node: import('ts-morph').Node) {
  const { line, column } = sourceFile.getLineAndColumnAtPos(node.getStart())
  return normalizeLocation(cwd, sourceFile.getFilePath(), line, column)
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
