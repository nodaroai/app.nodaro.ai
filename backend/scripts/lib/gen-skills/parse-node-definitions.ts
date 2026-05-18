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
import { Project, SyntaxKind, type ObjectLiteralExpression } from "ts-morph"

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
    results.push(readNodeDefObject(el.asKindOrThrow(SyntaxKind.ObjectLiteralExpression)))
  }
  return results
}

function readNodeDefObject(obj: ObjectLiteralExpression): NodeDef {
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
      defaultData = readObjectLiteralOrCast(initExpr) ?? {}
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
): Record<string, unknown> | undefined {
  if (expr.getKind() === SyntaxKind.ObjectLiteralExpression) {
    return readObjectLiteral(expr.asKindOrThrow(SyntaxKind.ObjectLiteralExpression))
  }
  if (expr.getKind() === SyntaxKind.AsExpression) {
    const inner = expr.asKindOrThrow(SyntaxKind.AsExpression).getExpression()
    return readObjectLiteralOrCast(inner)
  }
  return undefined
}

function readObjectLiteral(obj: ObjectLiteralExpression): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const prop of obj.getProperties()) {
    if (prop.getKind() === SyntaxKind.SpreadAssignment) {
      // TODO(gen-skills): Resolve spread references (e.g. `...MUSIC_GENRE_DEFAULT_DATA`)
      // by following the imported const back to its definition. Today the 5
      // known spreads in frontend/src/types/nodes.ts target objects that are
      // empty (music-genre, music-mood, voice-character, voice-delivery) or
      // contain only `{ instruments: [] }` (instrumentation) — none of which
      // currently matter in the rendered skill. The moment any of those gains
      // a non-trivial key, the rendered skill content will silently drift and
      // CI's drift gate won't catch it. Promote this warn to a throw once a
      // resolver exists.
      const sf = prop.getSourceFile()
      console.warn(
        `gen-skills parser: silently skipping spread '${prop.getText()}' at ${sf.getFilePath()}:${prop.getStartLineNumber()}. ` +
          `Spread targets are not resolved — any non-empty keys will be dropped from the rendered skill. ` +
          `Inline the spread's keys into the literal, or extend the parser to resolve module-scoped const refs.`,
      )
      continue
    }
    if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue
    const pa = prop.asKindOrThrow(SyntaxKind.PropertyAssignment)
    const name = pa.getNameNode().getText().replace(/^["']|["']$/g, "")
    const init = pa.getInitializer()
    if (!init) continue
    out[name] = readLiteralValue(init)
  }
  return out
}

function readLiteralValue(expr: import("ts-morph").Node): unknown {
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
      const operand = readLiteralValue(pu.getOperand())
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
      return arr.getElements().map((e) => readLiteralValue(e))
    }
    case SyntaxKind.ObjectLiteralExpression:
      return readObjectLiteral(expr.asKindOrThrow(SyntaxKind.ObjectLiteralExpression))
    case SyntaxKind.AsExpression:
      return readLiteralValue(expr.asKindOrThrow(SyntaxKind.AsExpression).getExpression())
    default: {
      const sf = expr.getSourceFile()
      throw new Error(
        `gen-skills parser cannot serialize expression kind '${expr.getKindName()}' at ${sf.getFilePath()}:${expr.getStartLineNumber()}: ${expr.getText().slice(0, 80)}. Either rewrite the source to use a literal, or extend readLiteralValue to handle this kind.`,
      )
    }
  }
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

  const fields: InterfaceField[] = []
  for (const member of members) {
    if (member.getKind() !== SyntaxKind.PropertySignature) continue
    const ps = member.asKindOrThrow(SyntaxKind.PropertySignature)
    const name = ps.getName()
    const typeNode = ps.getTypeNode()
    const type = typeNode ? typeNode.getText() : "unknown"
    const optional = ps.hasQuestionToken()
    fields.push({ name, type, optional })
  }
  return { name: interfaceName, fields }
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
  // Other type alias shapes (unions, intersections, references) don't have
  // a simple member list — surface as "no fields" rather than throwing so
  // callers can still detect the alias exists with `parseDataInterface !== undefined`.
  return []
}
