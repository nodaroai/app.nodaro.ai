/**
 * ts-morph-based parser for NODE_DEFINITIONS literal + *Data interfaces in
 * frontend/src/types/nodes.ts.
 *
 * Why ts-morph rather than runtime import: nodes.ts (6050 lines, 66
 * interfaces) imports frontend-only modules. A runtime import would
 * require bundling or shimming those deps. AST parsing at gen-time has
 * none of those concerns and gives access to TypeScript interface
 * declarations (which don't survive to runtime).
 *
 * Used only by backend/scripts/gen-skills.ts.
 */
import { existsSync } from "node:fs"
import path from "node:path"
import {
  Project,
  SyntaxKind,
  type ObjectLiteralExpression,
  type SourceFile,
  type VariableDeclaration,
} from "ts-morph"

/**
 * Map non-relative module specifiers to their on-disk source roots.
 * Add new entries here when nodes.ts starts spreading a const from another
 * workspace package — the parser can only follow paths it knows about.
 */
const WORKSPACE_PACKAGE_ROOTS: Record<string, string> = {
  "@nodaro/shared": "packages/shared/src/index",
}

export interface NodeDef {
  type: string
  label: string
  category: string
  creditCost: number
  inputs: string[]
  outputs: string[]
  defaultData: Record<string, unknown>
}

export interface InterfaceField {
  name: string
  type: string
  optional: boolean
}

export interface InterfaceShape {
  name: string
  fields: InterfaceField[]
}

export function parseNodeDefinitions(filePath: string): NodeDef[] {
  const project = new Project({ skipAddingFilesFromTsConfig: true })
  const sourceFile = project.addSourceFileAtPath(filePath)
  // frontend/src/types/nodes.ts → repo root is 4 levels up. Used to resolve
  // workspace-package module specifiers (e.g. `@nodaro/shared`) to on-disk
  // source files for the spread resolver.
  const repoRoot = path.resolve(filePath, "..", "..", "..", "..")
  const ctx: ParseContext = { project, repoRoot }

  const decl = sourceFile.getVariableDeclaration("NODE_DEFINITIONS")
  if (!decl) throw new Error(`NODE_DEFINITIONS not found in ${filePath}`)

  const init = decl.getInitializer()
  if (!init || init.getKind() !== SyntaxKind.ArrayLiteralExpression) {
    throw new Error("NODE_DEFINITIONS initializer is not an array literal")
  }

  const elements = init
    .asKindOrThrow(SyntaxKind.ArrayLiteralExpression)
    .getElements()

  const results: NodeDef[] = []
  for (const el of elements) {
    if (el.getKind() !== SyntaxKind.ObjectLiteralExpression) continue
    results.push(readNodeDefObject(el.asKindOrThrow(SyntaxKind.ObjectLiteralExpression), ctx))
  }
  return results
}

interface ParseContext {
  project: Project
  repoRoot: string
}

function readNodeDefObject(obj: ObjectLiteralExpression, ctx: ParseContext): NodeDef {
  const type = readStringProp(obj, "type")
  const label = readStringProp(obj, "label")
  const category = readStringProp(obj, "category")
  const creditCost = readNumberProp(obj, "creditCost") ?? 0
  const inputs = readStringArrayProp(obj, "inputs") ?? []
  const outputs = readStringArrayProp(obj, "outputs") ?? []

  let defaultData: Record<string, unknown> = {}
  const dataProp = obj.getProperty("defaultData")
  if (dataProp && dataProp.getKind() === SyntaxKind.PropertyAssignment) {
    const initExpr = dataProp
      .asKindOrThrow(SyntaxKind.PropertyAssignment)
      .getInitializer()
    if (initExpr) {
      defaultData = readObjectLiteralOrCast(initExpr, ctx) ?? {}
    }
  }

  return { type, label, category, creditCost, inputs, outputs, defaultData }
}

function readStringProp(obj: ObjectLiteralExpression, name: string): string {
  const prop = obj.getProperty(name)
  if (!prop) throw new Error(`property '${name}' missing on NODE_DEFINITIONS entry`)
  const init = prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
  if (!init) throw new Error(`property '${name}' has no initializer`)
  return readStringExpr(init, name)
}

function readStringExpr(expr: import("ts-morph").Node, name: string): string {
  if (expr.getKind() === SyntaxKind.StringLiteral) {
    return expr.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText()
  }
  if (expr.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) {
    return expr.asKindOrThrow(SyntaxKind.NoSubstitutionTemplateLiteral).getLiteralText()
  }
  // Peel `as Foo` / `as const` casts that wrap a string literal.
  if (expr.getKind() === SyntaxKind.AsExpression) {
    const inner = expr.asKindOrThrow(SyntaxKind.AsExpression).getExpression()
    return readStringExpr(inner, name)
  }
  throw new Error(`property '${name}' is not a string literal: kind=${expr.getKindName()}`)
}

function readNumberProp(obj: ObjectLiteralExpression, name: string): number | undefined {
  const prop = obj.getProperty(name)
  if (!prop) return undefined
  const init = prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
  if (!init) return undefined
  return readNumberFromExpr(init)
}

function readNumberFromExpr(expr: import("ts-morph").Node): number | undefined {
  if (expr.getKind() === SyntaxKind.NumericLiteral) {
    return Number(expr.asKindOrThrow(SyntaxKind.NumericLiteral).getLiteralText())
  }
  // Peel `as Foo` / `as const` casts that wrap a numeric literal — keeps
  // readNumberProp symmetric with readStringExpr.
  if (expr.getKind() === SyntaxKind.AsExpression) {
    return readNumberFromExpr(expr.asKindOrThrow(SyntaxKind.AsExpression).getExpression())
  }
  return undefined
}

function readStringArrayProp(obj: ObjectLiteralExpression, name: string): string[] | undefined {
  const prop = obj.getProperty(name)
  if (!prop) return undefined
  const init = prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
  if (!init || init.getKind() !== SyntaxKind.ArrayLiteralExpression) return undefined
  const arr = init.asKindOrThrow(SyntaxKind.ArrayLiteralExpression)
  return arr.getElements().map((e) => {
    if (e.getKind() === SyntaxKind.StringLiteral) {
      return e.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText()
    }
    return e.getText()
  })
}

function readObjectLiteralOrCast(
  expr: import("ts-morph").Node,
  ctx: ParseContext,
): Record<string, unknown> | undefined {
  if (expr.getKind() === SyntaxKind.ObjectLiteralExpression) {
    return readObjectLiteral(expr.asKindOrThrow(SyntaxKind.ObjectLiteralExpression), ctx)
  }
  if (expr.getKind() === SyntaxKind.AsExpression) {
    const inner = expr.asKindOrThrow(SyntaxKind.AsExpression).getExpression()
    return readObjectLiteralOrCast(inner, ctx)
  }
  return undefined
}

function readObjectLiteral(obj: ObjectLiteralExpression, ctx: ParseContext): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const prop of obj.getProperties()) {
    if (prop.getKind() === SyntaxKind.SpreadAssignment) {
      const spread = prop.asKindOrThrow(SyntaxKind.SpreadAssignment)
      const resolved = resolveSpread(spread, ctx)
      // Loud failure: with a resolver in place, any unresolved spread is a
      // real bug — either a new identifier the resolver can't follow, or a
      // missing workspace-package mapping. Silent skipping would let the
      // rendered skill drift past CI's drift gate.
      if (resolved === undefined) {
        const sf = prop.getSourceFile()
        throw new Error(
          `gen-skills parser cannot resolve spread '${prop.getText()}' at ${sf.getFilePath()}:${prop.getStartLineNumber()}. ` +
            `Inline the spread's keys into the literal, or add a resolution path (same-file const, relative import, or workspace-package entry in WORKSPACE_PACKAGE_ROOTS).`,
        )
      }
      Object.assign(out, resolved)
      continue
    }
    if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue
    const pa = prop.asKindOrThrow(SyntaxKind.PropertyAssignment)
    const name = pa.getNameNode().getText().replace(/^["']|["']$/g, "")
    const init = pa.getInitializer()
    if (!init) continue
    out[name] = readLiteralValue(init, ctx)
  }
  return out
}

function readLiteralValue(expr: import("ts-morph").Node, ctx: ParseContext): unknown {
  switch (expr.getKind()) {
    case SyntaxKind.StringLiteral:
      return expr.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText()
    case SyntaxKind.NoSubstitutionTemplateLiteral:
      return expr.asKindOrThrow(SyntaxKind.NoSubstitutionTemplateLiteral).getLiteralText()
    case SyntaxKind.NumericLiteral:
      return Number(expr.asKindOrThrow(SyntaxKind.NumericLiteral).getLiteralText())
    case SyntaxKind.TrueKeyword:
      return true
    case SyntaxKind.FalseKeyword:
      return false
    case SyntaxKind.NullKeyword:
      return null
    case SyntaxKind.UndefinedKeyword:
      return undefined
    case SyntaxKind.Identifier: {
      // The only legal Identifier in defaultData today is the `undefined`
      // global (e.g. `{ actionFx: undefined }` at nodes.ts:4149). Anything
      // else is an unresolved module-scoped reference the parser can't follow
      // and must surface loudly.
      const text = expr.getText()
      if (text === "undefined") return undefined
      const sf = expr.getSourceFile()
      throw new Error(
        `gen-skills parser cannot resolve identifier '${text}' at ${sf.getFilePath()}:${expr.getStartLineNumber()}. Either rewrite the source to use a literal, or extend readLiteralValue to resolve module-scoped const refs.`,
      )
    }
    case SyntaxKind.PrefixUnaryExpression: {
      // Handle negative numeric literals (`-1`, `-0.5`, etc.). The operand
      // must itself be a recognized literal — anything else falls through to
      // the loud default branch.
      const pu = expr.asKindOrThrow(SyntaxKind.PrefixUnaryExpression)
      const operator = pu.getOperatorToken()
      const operand = readLiteralValue(pu.getOperand(), ctx)
      if (typeof operand === "number") {
        if (operator === SyntaxKind.MinusToken) return -operand
        if (operator === SyntaxKind.PlusToken) return operand
      }
      const sf = expr.getSourceFile()
      throw new Error(
        `gen-skills parser cannot serialize PrefixUnaryExpression at ${sf.getFilePath()}:${expr.getStartLineNumber()}: ${expr.getText().slice(0, 80)}. Only -<number> / +<number> are supported.`,
      )
    }
    case SyntaxKind.ArrayLiteralExpression: {
      const arr = expr.asKindOrThrow(SyntaxKind.ArrayLiteralExpression)
      return arr.getElements().map((e) => readLiteralValue(e, ctx))
    }
    case SyntaxKind.ObjectLiteralExpression:
      return readObjectLiteral(expr.asKindOrThrow(SyntaxKind.ObjectLiteralExpression), ctx)
    case SyntaxKind.AsExpression:
      return readLiteralValue(expr.asKindOrThrow(SyntaxKind.AsExpression).getExpression(), ctx)
    default: {
      const sf = expr.getSourceFile()
      throw new Error(
        `gen-skills parser cannot serialize expression kind '${expr.getKindName()}' at ${sf.getFilePath()}:${expr.getStartLineNumber()}: ${expr.getText().slice(0, 80)}. Either rewrite the source to use a literal, or extend readLiteralValue to handle this kind.`,
      )
    }
  }
}

/**
 * Resolve `...IDENT` inside an object literal back to a `Record<string, unknown>`.
 *
 * Strategy: identifier → same-file VariableDeclaration; failing that, scan
 * ImportDeclarations in the current file, resolve the module specifier to an
 * on-disk source file (relative path or workspace package), then recursively
 * follow `export ... from` re-exports until a `VariableDeclaration` is found.
 * Returns undefined if no resolution path exists — the caller throws.
 */
function resolveSpread(
  spread: import("ts-morph").SpreadAssignment,
  ctx: ParseContext,
): Record<string, unknown> | undefined {
  const expr = spread.getExpression()
  if (expr.getKind() !== SyntaxKind.Identifier) return undefined
  const name = expr.getText()
  return resolveExportedConst(spread.getSourceFile(), name, ctx)
}

function resolveExportedConst(
  file: SourceFile,
  name: string,
  ctx: ParseContext,
): Record<string, unknown> | undefined {
  const local = file.getVariableDeclaration(name)
  if (local) return evalObjectDecl(local, ctx)

  for (const imp of file.getImportDeclarations()) {
    const named = imp.getNamedImports().find((n) => {
      const alias = n.getAliasNode()?.getText()
      return (alias ?? n.getName()) === name
    })
    if (!named) continue
    const target = resolveModuleToSourceFile(imp.getModuleSpecifierValue(), file, ctx)
    if (!target) continue
    return resolveExportedConst(target, named.getName(), ctx)
  }

  for (const exp of file.getExportDeclarations()) {
    const moduleSpec = exp.getModuleSpecifierValue()
    if (!moduleSpec) continue
    const target = resolveModuleToSourceFile(moduleSpec, file, ctx)
    if (!target) continue
    const named = exp.getNamedExports()
    if (named.length === 0) {
      // export * from "./x" — recurse with the same name
      const resolved = resolveExportedConst(target, name, ctx)
      if (resolved !== undefined) return resolved
      continue
    }
    const match = named.find((n) => {
      const alias = n.getAliasNode()?.getText()
      return (alias ?? n.getName()) === name
    })
    if (match) return resolveExportedConst(target, match.getName(), ctx)
  }

  return undefined
}

function evalObjectDecl(
  decl: VariableDeclaration,
  ctx: ParseContext,
): Record<string, unknown> | undefined {
  const init = decl.getInitializer()
  if (!init) return undefined
  return readObjectLiteralOrCast(init, ctx)
}

/**
 * Map a module specifier to an on-disk `.ts` source file and load it into the
 * shared project (idempotent). Handles:
 *   - relative paths (`./foo`, `../foo/bar`) — strips a trailing `.js` since
 *     ESM-internal re-exports in this repo write `from "./foo.js"`
 *   - bare specifiers listed in WORKSPACE_PACKAGE_ROOTS (e.g. `@nodaro/shared`)
 * Returns undefined for unknown bare specifiers so the caller can keep looking.
 */
function resolveModuleToSourceFile(
  spec: string | undefined,
  fromFile: SourceFile,
  ctx: ParseContext,
): SourceFile | undefined {
  if (!spec) return undefined
  let basePath: string
  if (spec.startsWith(".")) {
    const stripped = spec.replace(/\.js$/, "")
    basePath = path.resolve(path.dirname(fromFile.getFilePath()), stripped)
  } else {
    const rel = WORKSPACE_PACKAGE_ROOTS[spec]
    if (!rel) return undefined
    basePath = path.resolve(ctx.repoRoot, rel)
  }
  for (const candidate of [`${basePath}.ts`, `${basePath}.tsx`, `${basePath}/index.ts`, `${basePath}/index.tsx`]) {
    if (existsSync(candidate)) {
      // ts-morph throws on a duplicate add; check first.
      return ctx.project.getSourceFile(candidate) ?? ctx.project.addSourceFileAtPath(candidate)
    }
  }
  return undefined
}

export function parseDataInterface(
  filePath: string,
  interfaceName: string,
): InterfaceShape | undefined {
  const project = new Project({ skipAddingFilesFromTsConfig: true })
  const sourceFile = project.addSourceFileAtPath(filePath)

  // nodes.ts mixes `interface Foo { ... }` and `type Foo = { ... }`. Both
  // produce a member-bearing node: the InterfaceDeclaration itself, or the
  // TypeLiteralNode inside the alias's type. Fall back from interface →
  // type alias so callers don't need to know which form was used.
  const members = collectInterfaceMembers(sourceFile, interfaceName)
  if (!members) return undefined

  const fields = membersToFields(members)
  // A plain interface or `type X = { ... }` yields its fields directly.
  if (fields.length > 0) return { name: interfaceName, fields }

  // The name exists but has no direct member list — it's an intersection /
  // Omit / Pick / mapped type (e.g. `GenerateVideoNodeData =
  // Omit<ImageToVideoData,…> & Omit<TextToVideoData,…> & { … }`). Expand it
  // through the ts-morph type checker, which flattens those forms into a
  // concrete property set. Union aliases (e.g. SceneNodeData) are left empty —
  // they have no single data shape.
  const resolved = resolveIntersectionFields(sourceFile, interfaceName)
  return { name: interfaceName, fields: resolved ?? [] }
}

function membersToFields(members: import("ts-morph").Node[]): InterfaceField[] {
  const fields: InterfaceField[] = []
  for (const member of members) {
    if (member.getKind() !== SyntaxKind.PropertySignature) continue
    const ps = member.asKindOrThrow(SyntaxKind.PropertySignature)
    const typeNode = ps.getTypeNode()
    fields.push({
      name: ps.getName(),
      type: typeNode ? typeNode.getText() : "unknown",
      optional: ps.hasQuestionToken(),
    })
  }
  return fields
}

/**
 * Flatten an intersection / Omit / Pick alias into a concrete field list by
 * walking the AST (NOT the type checker — gen-skills runs ts-morph without a
 * tsconfig/lib, so the checker can't evaluate the `Omit<…>` utility and would
 * silently drop the omitted bases, leaving only the inline literal). Used ONLY
 * as a fallback when {@link collectInterfaceMembers} found the name but it had
 * no direct member list — plain interfaces / `type X = { … }` keep their fast
 * path. Returns undefined for union aliases (no single shape) so the caller
 * renders an empty block, preserving prior behavior for types like
 * SceneNodeData.
 */
function resolveIntersectionFields(
  sourceFile: import("ts-morph").SourceFile,
  name: string,
): InterfaceField[] | undefined {
  const alias = sourceFile.getTypeAlias(name)
  if (!alias) return undefined
  const typeNode = alias.getTypeNode()
  if (!typeNode) return undefined
  if (typeNode.getKind() === SyntaxKind.UnionType) return undefined
  return resolveTypeNodeFields(sourceFile, typeNode, new Set([name]))
}

/**
 * Resolve a type NODE to a field list, following same-file interface/alias
 * references and interpreting `Omit` / `Pick` / `Partial` / `Required` /
 * `Readonly` / intersections. `seen` guards against reference cycles. Returns
 * undefined for shapes with no field list (e.g. unions, unresolved externals).
 */
function resolveTypeNodeFields(
  sourceFile: import("ts-morph").SourceFile,
  typeNode: import("ts-morph").Node,
  seen: Set<string>,
): InterfaceField[] | undefined {
  const kind = typeNode.getKind()

  if (kind === SyntaxKind.TypeLiteral) {
    return membersToFields(typeNode.asKindOrThrow(SyntaxKind.TypeLiteral).getMembers())
  }

  if (kind === SyntaxKind.IntersectionType) {
    // Merge constituents left → right; later members override earlier by name
    // (so `GenerateVideoNodeData`'s inline block wins over the Omit'd bases).
    const merged = new Map<string, InterfaceField>()
    for (const constituent of typeNode.asKindOrThrow(SyntaxKind.IntersectionType).getTypeNodes()) {
      for (const f of resolveTypeNodeFields(sourceFile, constituent, seen) ?? []) {
        merged.set(f.name, f)
      }
    }
    return [...merged.values()]
  }

  if (kind === SyntaxKind.TypeReference) {
    const ref = typeNode.asKindOrThrow(SyntaxKind.TypeReference)
    const typeName = ref.getTypeName().getText()
    const args = ref.getTypeArguments()
    if (typeName === "Omit" && args.length === 2) {
      const base = resolveTypeNodeFields(sourceFile, args[0], seen) ?? []
      const keys = extractStringLiteralKeys(args[1])
      return base.filter((f) => !keys.has(f.name))
    }
    if (typeName === "Pick" && args.length === 2) {
      const base = resolveTypeNodeFields(sourceFile, args[0], seen) ?? []
      const keys = extractStringLiteralKeys(args[1])
      return base.filter((f) => keys.has(f.name))
    }
    if (args.length === 1 && (typeName === "Partial" || typeName === "Required" || typeName === "Readonly")) {
      const base = resolveTypeNodeFields(sourceFile, args[0], seen) ?? []
      if (typeName === "Partial") return base.map((f) => ({ ...f, optional: true }))
      if (typeName === "Required") return base.map((f) => ({ ...f, optional: false }))
      return base
    }
    // Plain reference to an interface / alias declared in this file.
    return resolveNamedTypeFields(sourceFile, typeName, seen)
  }

  return undefined
}

function resolveNamedTypeFields(
  sourceFile: import("ts-morph").SourceFile,
  name: string,
  seen: Set<string>,
): InterfaceField[] | undefined {
  if (seen.has(name)) return [] // cycle guard
  seen.add(name)

  const iface = sourceFile.getInterface(name)
  if (iface) {
    // Own members first; follow `extends` clauses so derived interfaces resolve fully.
    const fields = new Map<string, InterfaceField>()
    for (const ext of iface.getExtends()) {
      for (const f of resolveTypeNodeFields(sourceFile, ext, seen) ?? []) fields.set(f.name, f)
    }
    for (const f of membersToFields(iface.getMembers())) fields.set(f.name, f)
    return [...fields.values()]
  }

  const alias = sourceFile.getTypeAlias(name)
  if (!alias) return undefined
  const typeNode = alias.getTypeNode()
  if (!typeNode || typeNode.getKind() === SyntaxKind.UnionType) return undefined
  return resolveTypeNodeFields(sourceFile, typeNode, seen)
}

/** Collect string-literal keys from a `K` type node (single literal or a union). */
function extractStringLiteralKeys(node: import("ts-morph").Node): Set<string> {
  const keys = new Set<string>()
  const visit = (n: import("ts-morph").Node): void => {
    if (n.getKind() === SyntaxKind.UnionType) {
      for (const t of n.asKindOrThrow(SyntaxKind.UnionType).getTypeNodes()) visit(t)
      return
    }
    if (n.getKind() === SyntaxKind.LiteralType) {
      const lit = n.asKindOrThrow(SyntaxKind.LiteralType).getLiteral()
      if (lit.getKind() === SyntaxKind.StringLiteral) {
        keys.add(lit.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText())
      }
    }
  }
  visit(node)
  return keys
}

function collectInterfaceMembers(
  sourceFile: import("ts-morph").SourceFile,
  name: string,
): import("ts-morph").Node[] | undefined {
  const iface = sourceFile.getInterface(name)
  if (iface) return iface.getMembers()

  const alias = sourceFile.getTypeAlias(name)
  if (!alias) return undefined

  const typeNode = alias.getTypeNode()
  if (!typeNode) return undefined
  if (typeNode.getKind() === SyntaxKind.TypeLiteral) {
    return typeNode.asKindOrThrow(SyntaxKind.TypeLiteral).getMembers()
  }
  // Other type alias shapes (unions, intersections, references) don't have a
  // simple member list — surface as "no fields" (empty array, not undefined)
  // so parseDataInterface knows the alias EXISTS and can try the type-checker
  // fallback (resolveIntersectionFields) for intersections / Omit / Pick.
  return []
}
