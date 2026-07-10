import fs from 'node:fs/promises'

import fg from 'fast-glob'
import { Node, Project, SyntaxKind, VariableDeclarationKind, type Identifier, type SourceFile, type VariableDeclaration } from 'ts-morph'

import { DEFAULT_EXCLUDE_GLOBS, DEFAULT_HANDLER_GLOBS } from './defaults'
import { createPathPattern, createRegExpPattern, createRecordId, normalizeLocation, normalizeMethod } from './normalize'
import type { AnalyzerOptions, HandlerRecord, HttpMethod, UnsupportedPattern } from './types'

export interface HandlerScanResult {
  handlers: HandlerRecord[]
  unsupported: UnsupportedPattern[]
}

type MswApi = 'http' | 'rest'

interface ImportBindings {
  direct: Map<string, MswApi>
  namespaces: Set<string>
}

interface StaticContext {
  baseUrl?: string
  constCache: Map<string, string | null>
  visiting: Set<string>
}

const HANDLER_VERBS = new Set(['all', 'get', 'post', 'put', 'patch', 'delete', 'head', 'options'])

export async function scanHandlers(options: AnalyzerOptions): Promise<HandlerScanResult> {
  const cwd = options.cwd
  const handlerGlobs = options.handlerGlobs?.length ? options.handlerGlobs : DEFAULT_HANDLER_GLOBS
  const excludeGlobs = options.excludeGlobs?.length ? options.excludeGlobs : DEFAULT_EXCLUDE_GLOBS

  const files = await fg(handlerGlobs, {
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

  const handlers: HandlerRecord[] = []
  const unsupported: UnsupportedPattern[] = []

  for (const sourceFile of sourceFiles) {
    const bindings = collectImportBindings(sourceFile)
    const context: StaticContext = {
      baseUrl: options.baseUrl,
      constCache: new Map(),
      visiting: new Set(),
    }

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const handlerMeta = identifyHandlerCall(call, bindings)
      if (!handlerMeta) {
        continue
      }

      const arg = call.getArguments()[0]
      if (!arg) {
        unsupported.push(buildUnsupported(cwd, call, 'handler', 'handler call is missing a matcher argument'))
        continue
      }

      const resolved = resolveHandlerMatcher(arg, context)
      if (!resolved) {
        unsupported.push(buildUnsupported(cwd, call, 'handler', describeUnsupportedMatcher(arg, context)))
        continue
      }

      const location = getLocation(cwd, sourceFile, call)
      handlers.push({
        id: createRecordId([location.filePath, String(location.line), String(location.column), handlerMeta.source, handlerMeta.method, resolved.normalized]),
        method: handlerMeta.method,
        pattern: resolved,
        location,
        source: handlerMeta.source,
      })
    }
  }

  handlers.sort(compareRecords)
  unsupported.sort(compareUnsupported)

  return {
    handlers,
    unsupported,
  }
}

function collectImportBindings(sourceFile: SourceFile): ImportBindings {
  const direct = new Map<string, MswApi>()
  const namespaces = new Set<string>()

  for (const declaration of sourceFile.getImportDeclarations()) {
    if (declaration.getModuleSpecifierValue() !== 'msw') {
      continue
    }

    for (const namedImport of declaration.getNamedImports()) {
      const imported = namedImport.getName()
      const local = namedImport.getAliasNode()?.getText() ?? imported
      if (imported === 'http' || imported === 'rest') {
        direct.set(local, imported)
      }
    }

    const namespaceImport = declaration.getNamespaceImport()
    if (namespaceImport) {
      namespaces.add(namespaceImport.getText())
    }
  }

  return { direct, namespaces }
}

function identifyHandlerCall(
  call: import('ts-morph').CallExpression,
  bindings: ImportBindings,
): { method: HttpMethod; source: 'msw-http' | 'msw-rest' } | null {
  const expression = call.getExpression()
  if (!Node.isPropertyAccessExpression(expression)) {
    return null
  }

  const verb = expression.getName()
  if (!HANDLER_VERBS.has(verb)) {
    return null
  }

  const root = expression.getExpression()
  if (Node.isIdentifier(root)) {
    const api = resolveMswApiBinding(root, bindings)
    if (!api) {
      return null
    }

    return {
      method: normalizeMethod(verb),
      source: api === 'http' ? 'msw-http' : 'msw-rest',
    }
  }

  if (Node.isPropertyAccessExpression(root)) {
    const namespace = root.getExpression()
    if (!Node.isIdentifier(namespace) || !isMswNamespaceBinding(namespace, bindings)) {
      return null
    }

    const api = root.getName()
    if (api !== 'http' && api !== 'rest') {
      return null
    }

    return {
      method: normalizeMethod(verb),
      source: api === 'http' ? 'msw-http' : 'msw-rest',
    }
  }

  return null
}

function resolveMswApiBinding(identifier: Identifier, bindings: ImportBindings): MswApi | null {
  const symbol = identifier.getSymbol()
  if (!symbol) {
    return hasSyntacticShadow(identifier) ? null : bindings.direct.get(identifier.getText()) ?? null
  }

  for (const declaration of symbol.getDeclarations()) {
    if (!Node.isImportSpecifier(declaration) || !isMswImportDeclaration(declaration)) {
      continue
    }

    const imported = declaration.getName()
    if (imported === 'http' || imported === 'rest') {
      return imported
    }
  }

  return null
}

function isMswNamespaceBinding(identifier: Identifier, bindings: ImportBindings): boolean {
  const symbol = identifier.getSymbol()
  if (!symbol) {
    return !hasSyntacticShadow(identifier) && bindings.namespaces.has(identifier.getText())
  }

  return symbol.getDeclarations().some(
    (declaration) => Node.isNamespaceImport(declaration) && isMswImportDeclaration(declaration),
  )
}

function isMswImportDeclaration(node: import('ts-morph').Node): boolean {
  return node.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)?.getModuleSpecifierValue() === 'msw'
}

function hasSyntacticShadow(identifier: Identifier): boolean {
  const name = identifier.getText()

  for (const ancestor of identifier.getAncestors()) {
    if (Node.isFunctionLikeDeclaration(ancestor) && ancestor.getParameters().some((parameter) => parameter.getName() === name)) {
      return true
    }

    if (!Node.isBlock(ancestor) && !Node.isSourceFile(ancestor)) {
      continue
    }

    for (const statement of ancestor.getStatements()) {
      if (Node.isVariableStatement(statement) && statement.getDeclarations().some((declaration) => declaration.getName() === name)) {
        return true
      }

      if (Node.isFunctionDeclaration(statement) && statement.getName() === name) {
        return true
      }
    }
  }

  return false
}

function resolveHandlerMatcher(node: import('ts-morph').Node, context: StaticContext) {
  const regexp = resolveStaticRegExp(node, context)
  if (regexp) {
    return createRegExpPattern(regexp)
  }

  const value = resolveStaticString(node, context)
  if (value === null) {
    return null
  }

  return createPathPattern(stripQueryAndHash(value), context.baseUrl)
}

function resolveStaticString(node: import('ts-morph').Node, context: StaticContext): string | null {
  if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isNonNullExpression(node)) {
    return resolveStaticString(node.getExpression(), context)
  }

  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText()
  }

  if (Node.isTemplateExpression(node)) {
    let result = node.getHead().getLiteralText()
    for (const span of node.getTemplateSpans()) {
      const value = resolveStaticString(span.getExpression(), context)
      if (value === null) {
        return null
      }
      result += value + span.getLiteral().getLiteralText()
    }
    return result
  }

  if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() === SyntaxKind.PlusToken) {
    const left = resolveStaticString(node.getLeft(), context)
    const right = resolveStaticString(node.getRight(), context)
    if (left === null || right === null) {
      return null
    }
    return left + right
  }

  const urlValue = resolveUrlLikeString(node, context)
  if (urlValue !== null) {
    return urlValue
  }

  if (Node.isIdentifier(node)) {
    const cacheKey = getIdentifierCacheKey(node)
    if (context.constCache.has(cacheKey)) {
      return context.constCache.get(cacheKey) ?? null
    }

    const declaration = resolveConstDeclaration(node)
    if (!declaration) {
      context.constCache.set(cacheKey, null)
      return null
    }

    if (context.visiting.has(cacheKey)) {
      return null
    }

    const initializer = declaration.getInitializer()
    if (!initializer) {
      context.constCache.set(cacheKey, null)
      return null
    }

    context.visiting.add(cacheKey)
    const resolved = resolveStaticString(initializer, context)
    context.visiting.delete(cacheKey)
    context.constCache.set(cacheKey, resolved)
    return resolved
  }

  if (Node.isCallExpression(node)) {
    if (isStringConstructor(node)) {
      const [arg] = node.getArguments()
      if (!arg) {
        return null
      }
      return resolveStaticString(arg, context)
    }

    if (isToStringCall(node)) {
      const expression = node.getExpression().asKind(SyntaxKind.PropertyAccessExpression)
      if (expression) {
        return resolveUrlLikeString(expression.getExpression(), context)
      }
      return null
    }
  }

  return null
}

function resolveStaticRegExp(node: import('ts-morph').Node, context: StaticContext): string | null {
  if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isNonNullExpression(node)) {
    return resolveStaticRegExp(node.getExpression(), context)
  }

  if (Node.isRegularExpressionLiteral(node)) {
    return node.getText()
  }

  if (Node.isNewExpression(node) && isIdentifierName(node.getExpression(), 'RegExp')) {
    const [patternArg, flagsArg] = node.getArguments()
    const pattern = patternArg ? resolveStaticString(patternArg, context) : null
    const flags = flagsArg ? resolveStaticString(flagsArg, context) : ''
    if (pattern === null || flags === null) {
      return null
    }

    try {
      return new RegExp(pattern, flags).toString()
    } catch {
      return null
    }
  }

  if (Node.isIdentifier(node)) {
    const cacheKey = getIdentifierCacheKey(node)
    if (context.constCache.has(cacheKey)) {
      return context.constCache.get(cacheKey) ?? null
    }

    const declaration = resolveConstDeclaration(node)
    if (!declaration || !declaration.getInitializer()) {
      context.constCache.set(cacheKey, null)
      return null
    }

    if (context.visiting.has(cacheKey)) {
      return null
    }

    context.visiting.add(cacheKey)
    const resolved = resolveStaticRegExp(declaration.getInitializerOrThrow(), context)
    context.visiting.delete(cacheKey)
    if (resolved !== null) {
      context.constCache.set(cacheKey, resolved)
    }
    return resolved
  }

  return null
}

function resolveUrlLikeString(node: import('ts-morph').Node, context: StaticContext): string | null {
  if (Node.isPropertyAccessExpression(node) && node.getName() === 'href') {
    return resolveUrlExpression(node.getExpression(), context)
  }

  if (Node.isCallExpression(node) && isToStringCall(node)) {
    const expression = node.getExpression().asKind(SyntaxKind.PropertyAccessExpression)
    if (expression) {
      return resolveUrlExpression(expression.getExpression(), context)
    }
    return null
  }

  if (Node.isCallExpression(node) && isStringConstructor(node)) {
    const [arg] = node.getArguments()
    if (!arg) {
      return null
    }
    return resolveUrlExpression(arg, context) ?? resolveStaticString(arg, context)
  }

  return null
}

function resolveUrlExpression(node: import('ts-morph').Node, context: StaticContext): string | null {
  if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isNonNullExpression(node)) {
    return resolveUrlExpression(node.getExpression(), context)
  }

  if (Node.isNewExpression(node) && isIdentifierName(node.getExpression(), 'URL')) {
    const [pathArg, baseArg] = node.getArguments()
    const path = pathArg ? resolveStaticString(pathArg, context) : null
    const base = baseArg ? resolveStaticString(baseArg, context) : null
    if (path === null) {
      return null
    }

    try {
      return base === null ? new URL(path).toString() : new URL(path, base).toString()
    } catch {
      return null
    }
  }

  if (Node.isIdentifier(node)) {
    const cacheKey = getIdentifierCacheKey(node)
    if (context.constCache.has(cacheKey)) {
      return context.constCache.get(cacheKey) ?? null
    }

    const declaration = resolveConstDeclaration(node)
    if (!declaration) {
      context.constCache.set(cacheKey, null)
      return null
    }

    if (context.visiting.has(cacheKey)) {
      return null
    }

    const initializer = declaration.getInitializer()
    if (!initializer) {
      context.constCache.set(cacheKey, null)
      return null
    }

    context.visiting.add(cacheKey)
    const resolved = resolveUrlExpression(initializer, context)
    context.visiting.delete(cacheKey)
    context.constCache.set(cacheKey, resolved)
    return resolved
  }

  return resolveStaticString(node, context)
}

function resolveConstDeclaration(identifier: Identifier): VariableDeclaration | null {
  const symbol = identifier.getSymbol()
  if (!symbol) {
    return resolveLexicalConstDeclaration(identifier)
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

function resolveLexicalConstDeclaration(identifier: Identifier): VariableDeclaration | null {
  const name = identifier.getText()

  for (const ancestor of identifier.getAncestors()) {
    if (!Node.isBlock(ancestor) && !Node.isSourceFile(ancestor)) {
      continue
    }

    for (const statement of ancestor.getVariableStatements()) {
      if (statement.getDeclarationKind() !== VariableDeclarationKind.Const) {
        continue
      }

      const declaration = statement.getDeclarations().find((candidate) => candidate.getName() === name)
      if (declaration) {
        return declaration
      }
    }
  }

  return null
}

function getIdentifierCacheKey(identifier: import('ts-morph').Identifier): string {
  return `${identifier.getSourceFile().getFilePath()}:${identifier.getText()}:${identifier.getStart()}`
}

function isIdentifierName(node: import('ts-morph').Node, name: string): boolean {
  return Node.isIdentifier(node) && node.getText() === name
}

function isStringConstructor(node: import('ts-morph').CallExpression): boolean {
  return isIdentifierName(node.getExpression(), 'String') && node.getArguments().length === 1
}

function isToStringCall(node: import('ts-morph').CallExpression): boolean {
  const expression = node.getExpression()
  return Node.isPropertyAccessExpression(expression) && expression.getName() === 'toString' && node.getArguments().length === 0
}

function stripQueryAndHash(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return trimmed
  }

  try {
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) {
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

function describeUnsupportedMatcher(node: import('ts-morph').Node, context: StaticContext): string {
  if (Node.isNewExpression(node) && isIdentifierName(node.getExpression(), 'URL')) {
    return 'bare new URL() is not supported; use .href or .toString()'
  }

  if (Node.isIdentifier(node)) {
    const declaration = resolveConstDeclaration(node)
    if (declaration?.getInitializer() && !resolveStaticString(declaration.getInitializerOrThrow(), context)) {
      return `unable to statically resolve const ${node.getText()}`
    }
  }

  return 'unable to statically resolve handler matcher'
}

function buildUnsupported(cwd: string, call: import('ts-morph').CallExpression, kind: 'handler' | 'api-call', reason: string): UnsupportedPattern {
  const sourceFile = call.getSourceFile()
  const location = getLocation(cwd, sourceFile, call)
  return {
    kind,
    reason,
    location,
    expressionText: call.getText(),
  }
}

function getLocation(cwd: string, sourceFile: SourceFile, node: import('ts-morph').Node) {
  const { line, column } = sourceFile.getLineAndColumnAtPos(node.getStart())
  return normalizeLocation(cwd, sourceFile.getFilePath(), line, column)
}

function compareRecords(left: HandlerRecord, right: HandlerRecord): number {
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
