/**
 * The pure AST half of the `workflow_executions` write guards
 * (`workflow-execution-inserts.test.ts`, `trigger-data-stamps.test.ts`): what a
 * row written to that table holds, read off the source.
 *
 * Nothing here reads a file: the guards hand it parsed sources
 * (`source-scan.ts`), and their self-tests hand it snippets.
 *
 * It resolves only what the source shows in place: an object literal, an array
 * of them, a spread of either, and an in-scope `const` bound to one. Whatever it
 * cannot see into (a parameter, an import, a call's result) it reports as
 * `blind`, and the guards fail on that rather than assume it is harmless.
 */
import ts from "typescript"
import { lineOf } from "./source-ast.js"

export type Ancestors = readonly ts.Node[]

export const EXECUTIONS_TABLE = "workflow_executions"
/** The query-builder methods that write a row. */
const WRITE_METHODS = new Set(["insert", "upsert", "update"])
/** Helpers that insert their second argument into the table their first argument names. */
export const INSERT_HELPERS = new Set(["insertWithIdempotencyKey"])
/** Helpers that only read the table their first argument names. */
export const READ_HELPERS = new Set(["findIdempotentRow"])

/** Walk with each node's ancestors (the shared parser keeps no parent pointers). */
export function walkWithAncestors(node: ts.Node, visit: (n: ts.Node, ancestors: Ancestors) => void, ancestors: ts.Node[] = []): void {
  visit(node, ancestors)
  ancestors.push(node)
  node.forEachChild((child) => walkWithAncestors(child, visit, ancestors))
  ancestors.pop()
}

/** An expression without the wrappers that do not change its value. */
export function unwrap(e: ts.Expression): ts.Expression {
  let at = e
  for (;;) {
    if (ts.isParenthesizedExpression(at) || ts.isAsExpression(at) || ts.isNonNullExpression(at) || ts.isSatisfiesExpression(at) || ts.isTypeAssertionExpression(at)) at = at.expression
    else return at
  }
}

const statementsOf = (n: ts.Node): readonly ts.Statement[] | null =>
  ts.isSourceFile(n) || ts.isBlock(n) || ts.isModuleBlock(n) || ts.isCaseClause(n) || ts.isDefaultClause(n) ? n.statements : null

/** The names a binding (an identifier, or a destructuring pattern) introduces. */
function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap((el) => (ts.isOmittedExpression(el) ? [] : boundNames(el.name)))
}

/**
 * The initializer of the in-scope `const` `name` is bound to, with the ancestors of
 * its scope; `null` when the nearest binding of that name is anything else (a
 * parameter, a `let`, a destructured binding, an import) or there is none.
 */
export function constInit(name: string, ancestors: Ancestors): { readonly init: ts.Expression; readonly ancestors: Ancestors } | null {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const scope = ancestors[i]!
    // A parameter, a loop's or a catch clause's binding of the name hides any outer const.
    if (ts.isFunctionLike(scope) && scope.parameters.some((p) => boundNames(p.name).includes(name))) return null
    if ((ts.isForOfStatement(scope) || ts.isForInStatement(scope) || ts.isForStatement(scope)) && scope.initializer && ts.isVariableDeclarationList(scope.initializer)) {
      if (scope.initializer.declarations.some((d) => boundNames(d.name).includes(name))) return null
    }
    if (ts.isCatchClause(scope) && scope.variableDeclaration && boundNames(scope.variableDeclaration.name).includes(name)) return null
    const statements = statementsOf(scope)
    if (!statements) continue
    for (const st of statements) {
      if (ts.isImportDeclaration(st)) {
        const names = st.importClause
        if (names?.name?.text === name) return null
        const bindings = names?.namedBindings
        if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === name) return null
        if (bindings && ts.isNamedImports(bindings) && bindings.elements.some((el) => el.name.text === name)) return null
      }
      if (!ts.isVariableStatement(st)) continue
      const isConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0
      for (const d of st.declarationList.declarations) {
        if (!boundNames(d.name).includes(name)) continue
        return isConst && ts.isIdentifier(d.name) && d.initializer ? { init: d.initializer, ancestors: ancestors.slice(0, i + 1) } : null
      }
    }
  }
  return null
}

/** The string an expression always is (a literal, or a `const` bound to one); `null` when it is not one. */
export function stringValue(e: ts.Expression, ancestors: Ancestors, depth = 0): string | null {
  const at = unwrap(e)
  if (ts.isStringLiteral(at) || ts.isNoSubstitutionTemplateLiteral(at)) return at.text
  if (ts.isIdentifier(at) && depth < 8) {
    const bound = constInit(at.text, ancestors)
    return bound ? stringValue(bound.init, bound.ancestors, depth + 1) : null
  }
  return null
}

/** A property's key, or `null` for a computed key that is not a known string. */
export function propertyKey(name: ts.PropertyName, ancestors: Ancestors): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name) || ts.isPrivateIdentifier(name)) return name.text
  if (ts.isComputedPropertyName(name)) return stringValue(name.expression, ancestors)
  return null
}

/** What a row holds, as far as the source shows it. */
export interface RowShape {
  /** Unconditional top-level keys and the values written under them. */
  readonly direct: Map<string, ts.Expression[]>
  /** Keys a spread (a nested literal, a branch of one) may write, and their values. */
  readonly spread: Map<string, ts.Expression[]>
  /** What the guard cannot see into; a row with any is not checked, it fails. */
  readonly blind: string[]
}

const emptyShape = (): RowShape => ({ direct: new Map(), spread: new Map(), blind: [] })
const add = (into: Map<string, ts.Expression[]>, key: string, value: ts.Expression) => into.set(key, [...(into.get(key) ?? []), value])
const brief = (sf: ts.SourceFile, node: ts.Node): string => {
  const text = node.getText(sf).replace(/\s+/g, " ").trim()
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

/**
 * The shapes of the rows `e` writes, one per object literal it is (an array's
 * elements, a `.map` callback's returned literal, an in-scope `const`), and what
 * of it the guard cannot see into. `columnBuilders` are calls whose output the
 * caller has checked: a row or a spread may be one.
 */
export function rowShapes(
  sf: ts.SourceFile,
  e: ts.Expression,
  ancestors: Ancestors,
  columnBuilders: ReadonlySet<string>,
): { readonly shapes: RowShape[]; readonly blind: string[] } {
  const blind: string[] = []
  const shapes = rowObjects(sf, e, ancestors, blind, columnBuilders, 0).map(({ obj, ancestors: anc }) => objectShape(sf, obj, anc, columnBuilders))
  return { shapes, blind: [...blind, ...shapes.flatMap((s) => s.blind)] }
}

function mergeInto(into: RowShape, from: RowShape, asSpread = false): void {
  for (const [k, vs] of from.direct) for (const v of vs) add(asSpread ? into.spread : into.direct, k, v)
  for (const [k, vs] of from.spread) for (const v of vs) add(into.spread, k, v)
  into.blind.push(...from.blind)
}

function rowObjects(
  sf: ts.SourceFile,
  e: ts.Expression,
  ancestors: Ancestors,
  blind: string[],
  columnBuilders: ReadonlySet<string>,
  depth: number,
): Array<{ obj: ts.ObjectLiteralExpression; ancestors: Ancestors }> {
  const at = unwrap(e)
  if (ts.isObjectLiteralExpression(at)) return [{ obj: at, ancestors }]
  if (ts.isCallExpression(at) && ts.isIdentifier(at.expression) && columnBuilders.has(at.expression.text)) return []
  if (ts.isArrayLiteralExpression(at)) {
    return at.elements.flatMap((el) => (ts.isOmittedExpression(el) ? [] : rowObjects(sf, ts.isSpreadElement(el) ? el.expression : el, ancestors, blind, columnBuilders, depth + 1)))
  }
  if (ts.isIdentifier(at) && depth < 8) {
    const bound = constInit(at.text, ancestors)
    if (bound) return rowObjects(sf, bound.init, bound.ancestors, blind, columnBuilders, depth + 1)
  }
  // `items.map((item) => ({ … }))`: the literal the callback returns.
  if (ts.isCallExpression(at) && ts.isPropertyAccessExpression(at.expression) && at.expression.name.text === "map") {
    const fn = at.arguments[0] && unwrap(at.arguments[0])
    if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
      const returned = ts.isBlock(fn.body)
        ? fn.body.statements.filter(ts.isReturnStatement).map((r) => r.expression).filter((x): x is ts.Expression => !!x)
        : [fn.body]
      if (returned.length > 0) return returned.flatMap((r) => rowObjects(sf, r, [...ancestors, fn, ...(ts.isBlock(fn.body) ? [fn.body] : [])], blind, columnBuilders, depth + 1))
    }
  }
  blind.push(`the row ${brief(sf, at)} is not visible where it is written`)
  return []
}

function objectShape(sf: ts.SourceFile, obj: ts.ObjectLiteralExpression, ancestors: Ancestors, columnBuilders: ReadonlySet<string>): RowShape {
  const shape = emptyShape()
  for (const p of obj.properties) {
    if (ts.isSpreadAssignment(p)) {
      mergeInto(shape, spreadShape(sf, p.expression, ancestors, columnBuilders, 0), true)
      continue
    }
    if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isAccessor(p)) {
      const key = propertyKey(p.name, ancestors)
      if (key === null) {
        shape.blind.push(`a computed key ${brief(sf, p.name)} the guard cannot read`)
        continue
      }
      const value = ts.isPropertyAssignment(p) ? p.initializer : ts.isShorthandPropertyAssignment(p) ? p.name : (p as ts.Node as ts.Expression)
      add(shape.direct, key, value)
    }
  }
  return shape
}

function spreadShape(sf: ts.SourceFile, e: ts.Expression, ancestors: Ancestors, columnBuilders: ReadonlySet<string>, depth: number): RowShape {
  const at = unwrap(e)
  if (ts.isObjectLiteralExpression(at)) return objectShape(sf, at, ancestors, columnBuilders)
  if (ts.isConditionalExpression(at)) {
    const shape = emptyShape()
    mergeInto(shape, spreadShape(sf, at.whenTrue, ancestors, columnBuilders, depth + 1), true)
    mergeInto(shape, spreadShape(sf, at.whenFalse, ancestors, columnBuilders, depth + 1), true)
    return shape
  }
  if (ts.isBinaryExpression(at) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(at.operatorToken.kind)) {
    const shape = emptyShape()
    // `cond && { … }` spreads only the right; `a ?? b` and `a || b` either.
    if (at.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) mergeInto(shape, spreadShape(sf, at.left, ancestors, columnBuilders, depth + 1), true)
    mergeInto(shape, spreadShape(sf, at.right, ancestors, columnBuilders, depth + 1), true)
    return shape
  }
  // A spread of nothing: `...(x ? {…} : undefined)`, `...null`.
  if (at.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(at) && at.text === "undefined") || at.kind === ts.SyntaxKind.FalseKeyword) return emptyShape()
  if (ts.isIdentifier(at) && depth < 8) {
    const bound = constInit(at.text, ancestors)
    if (bound) return spreadShape(sf, bound.init, bound.ancestors, columnBuilders, depth + 1)
  }
  if (ts.isCallExpression(at) && ts.isIdentifier(at.expression) && columnBuilders.has(at.expression.text)) return emptyShape()
  const shape = emptyShape()
  shape.blind.push(`a spread of ${brief(sf, at)} the guard cannot see into`)
  return shape
}

/** One write of a row to `workflow_executions`. */
export interface ExecutionWrite {
  readonly kind: "insert" | "update"
  readonly line: number
  /** `.insert`, `.upsert`, `.update`, or the insert helper's name. */
  readonly via: string
  /** One per row the write holds (an array insert holds several). */
  readonly shapes: RowShape[]
  /** What of its rows the guard cannot see into. */
  readonly blind: string[]
  /** The ancestors at the write, for resolving what its values name. */
  readonly ancestors: Ancestors
}

/** A `"workflow_executions"` literal that is neither a query's table nor a helper's (a table-name const, a table list). */
export interface StrayTableName {
  readonly line: number
  /** The function it sits in (`<top>` at module level). */
  readonly fn: string
}

/** The function a node sits in, by the name it is declared under. */
export function enclosingFunction(sf: ts.SourceFile, ancestors: Ancestors): string {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const n = ancestors[i]!
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText(sf)
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && i > 0) {
      const up = ancestors[i - 1]!
      if (ts.isVariableDeclaration(up) && ts.isIdentifier(up.name)) return up.name.text
      if (ts.isPropertyAssignment(up)) return up.name.getText(sf)
    }
  }
  return "<top>"
}

const isTypePosition = (ancestors: Ancestors): boolean => ancestors.some((a) => ts.isTypeNode(a) && !ts.isExpressionWithTypeArguments(a))

/**
 * Every row this file writes to `workflow_executions`, and every mention of the
 * table name the guard cannot follow to a write or a read:
 *
 * - `.from("workflow_executions").insert|upsert|update(row)` (through any
 *   wrapper that does not change the value — `(… as any).update`);
 * - `insertWithIdempotencyKey("workflow_executions", row, …)`;
 * - `helperCalls`: every insert helper's call whose table is not a known string.
 */
export function executionWrites(
  sf: ts.SourceFile,
  columnBuilders: ReadonlySet<string>,
): { writes: ExecutionWrite[]; strays: StrayTableName[]; unreadHelperTables: number[] } {
  const writes: ExecutionWrite[] = []
  const strays: StrayTableName[] = []
  const unreadHelperTables: number[] = []
  walkWithAncestors(sf, (node, ancestors) => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression)
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null
      if (name && INSERT_HELPERS.has(name)) {
        const table = node.arguments[0] ? stringValue(node.arguments[0], ancestors) : null
        if (table === null) unreadHelperTables.push(lineOf(sf, node))
        else if (table === EXECUTIONS_TABLE && node.arguments[1]) {
          writes.push({ kind: "insert", line: lineOf(sf, node), via: name, ...rowShapes(sf, node.arguments[1], ancestors, columnBuilders), ancestors: [...ancestors] })
        }
      }
    }
    if (!(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) || node.text !== EXECUTIONS_TABLE) return
    if (isTypePosition(ancestors)) return
    // Climb out of the wrappers to the call it is an argument of.
    let i = ancestors.length - 1
    let child: ts.Node = node
    const call = ancestors[i]
    if (call && ts.isCallExpression(call) && call.arguments[0] === child) {
      const callee = unwrap(call.expression)
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null
      if (name && (INSERT_HELPERS.has(name) || READ_HELPERS.has(name))) return
      if (name === "from" && ts.isPropertyAccessExpression(callee)) {
        // `.from(table)` then the method called on it.
        child = call
        i--
        while (i >= 0 && (ts.isParenthesizedExpression(ancestors[i]!) || ts.isAsExpression(ancestors[i]!) || ts.isNonNullExpression(ancestors[i]!) || ts.isSatisfiesExpression(ancestors[i]!))) {
          child = ancestors[i]!
          i--
        }
        const access = ancestors[i]
        const invoked = ancestors[i - 1]
        if (access && ts.isPropertyAccessExpression(access) && access.expression === child && invoked && ts.isCallExpression(invoked) && invoked.expression === access) {
          const method = access.name.text
          if (WRITE_METHODS.has(method)) {
            const row = invoked.arguments[0]
            const at = ancestors.slice(0, i - 1)
            writes.push({
              kind: method === "update" ? "update" : "insert",
              line: lineOf(sf, invoked),
              via: `.${method}`,
              ...(row ? rowShapes(sf, row, at, columnBuilders) : { shapes: [], blind: ["a write with no row"] }),
              ancestors: at,
            })
          }
          return
        }
        // A query builder held apart from its call: its writes would go unseen.
        strays.push({ line: lineOf(sf, node), fn: enclosingFunction(sf, ancestors) })
        return
      }
    }
    strays.push({ line: lineOf(sf, node), fn: enclosingFunction(sf, ancestors) })
  })
  return { writes, strays, unreadHelperTables }
}

/** One write of a key: where, and what it stores (a `delete` stores nothing). */
export interface KeyWrite {
  readonly line: number
  /** The value's text, whitespace collapsed and cut at 60 characters. */
  readonly value: string
  readonly node: ts.Node
}

const isAssignment = (kind: ts.SyntaxKind) => kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment

/**
 * Every write of `key` in a file, in any shape: an object property (plain,
 * shorthand, string or computed key that resolves to it) and a member
 * assignment or `delete` (`row.key = …`, `row["key"] ??= …`, `delete row.key`).
 * A type's property and a destructuring target are not writes.
 */
export function keyWrites(sf: ts.SourceFile, key: string): KeyWrite[] {
  const out: KeyWrite[] = []
  const memberKey = (e: ts.Expression, ancestors: Ancestors): string | null => {
    const at = unwrap(e)
    return ts.isPropertyAccessExpression(at) ? at.name.text : ts.isElementAccessExpression(at) ? stringValue(at.argumentExpression, ancestors) : null
  }
  walkWithAncestors(sf, (node, ancestors) => {
    if (isTypePosition(ancestors)) return
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      if (propertyKey(node.name, ancestors) !== key) return
      // A destructuring target (`({ key: x } = row)`) writes nothing.
      const parent = ancestors[ancestors.length - 1]
      const grand = ancestors[ancestors.length - 2]
      if (parent && grand && ts.isBinaryExpression(grand) && grand.left === parent && grand.operatorToken.kind === ts.SyntaxKind.EqualsToken) return
      const value = ts.isPropertyAssignment(node) ? node.initializer : node.name
      out.push({ line: lineOf(sf, node), value: brief(sf, value), node: value })
      return
    }
    if (ts.isBinaryExpression(node) && isAssignment(node.operatorToken.kind) && memberKey(node.left, ancestors) === key) {
      out.push({ line: lineOf(sf, node), value: brief(sf, node.right), node: node.right })
      return
    }
    if (ts.isDeleteExpression(node) && memberKey(node.expression, ancestors) === key) {
      out.push({ line: lineOf(sf, node), value: "delete", node })
    }
  })
  return out
}

export { brief as briefText }
