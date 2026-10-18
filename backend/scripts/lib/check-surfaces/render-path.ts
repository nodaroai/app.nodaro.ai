/**
 * Renders the URL a TypeScript expression builds, statically, as every
 * spelling it can take: `${root}/${encodeURIComponent(id)}/ops` → `/v1/x/:p/ops`.
 *
 * Interpolations it can resolve (a module const, a local const, a helper
 * arrow or function, a private method like `this.path(id, "/ops")`, a
 * parameter bound by the caller) are substituted; anything else becomes `:p`.
 * A conditional whose test it can decide (`type === "edit-3d-scene"` with
 * `type` bound) takes one branch, otherwise both, so a method that picks its
 * route at run time yields each route it can call. A lookup in a const object
 * literal (`PATHS[type]`) is the one entry its key names, or every entry when
 * the key is not known — a route table picked from at run time. A parameter
 * typed by a finite type a package publishes (`type: UseCaseNodeType`) and
 * not bound to a known value takes every value of that type
 * (`/v1/${type}/continue` → one route per use-case type): a route chosen from
 * that list at run time.
 */
import ts from "typescript"

/** A name in scope: the expression it holds, or a value already rendered. */
export type Binding = { expr: ts.Expression; scope: Scope } | { values: string[] | null }

export interface Scope {
  /** Names visible here, innermost first (locals, then the module). */
  lookup(name: string): Binding | undefined
  /** A callable visible here (module function / arrow, or a `this.<method>`). */
  callable(name: string, viaThis: boolean): Callable | undefined
  /**
   * An imported function the checker runs for real (a route table in a
   * package, which the AST cannot see into): given each argument's spellings,
   * every spelling the call can return.
   */
  native?(name: string): NativeFn | undefined
  /** Every value of a finite type imported from a package (`UseCaseNodeType`), by its local name. */
  domain?(typeName: string): readonly string[] | undefined
}

export type NativeFn = (args: string[][]) => string[]

export interface Callable {
  params: ts.NodeArray<ts.ParameterDeclaration>
  /** The returned expression (an arrow's expression body, or a single `return`). */
  body: ts.Expression | undefined
  /** The scope the body reads module names from. */
  scope: Scope
  /** Local consts declared in the callable's body. */
  locals: Map<string, ts.Expression>
}

const MAX_SPELLINGS = 64
export const PARAM = ":p"

function cross(a: string[], b: string[]): string[] {
  const out: string[] = []
  for (const x of a) for (const y of b) if (out.length < MAX_SPELLINGS) out.push(x + y)
  return out
}

export function unwrap(e: ts.Expression): ts.Expression {
  let cur = e
  for (;;) {
    if (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur) || ts.isSatisfiesExpression(cur)) {
      cur = cur.expression
    } else if (ts.isTypeAssertionExpression(cur)) cur = cur.expression
    else return cur
  }
}

/** `a` for `this.a`, `this.client.a.b` → ["client","a","b"]; null when not rooted at `this`. */
export function thisChain(e: ts.Expression): string[] | null {
  const parts: string[] = []
  let cur = unwrap(e)
  while (ts.isPropertyAccessExpression(cur)) {
    parts.unshift(cur.name.text)
    cur = unwrap(cur.expression)
  }
  return cur.kind === ts.SyntaxKind.ThisKeyword ? parts : null
}

type Truth = true | false | undefined

function decide(e: ts.Expression, scope: Scope, depth: number): Truth {
  const x = unwrap(e)
  if (ts.isBinaryExpression(x)) {
    const op = x.operatorToken.kind
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      const l = decide(x.left, scope, depth)
      const r = decide(x.right, scope, depth)
      if (l === false || r === false) return false
      return l === true && r === true ? true : undefined
    }
    if (op === ts.SyntaxKind.BarBarToken) {
      const l = decide(x.left, scope, depth)
      const r = decide(x.right, scope, depth)
      if (l === true || r === true) return true
      return l === false && r === false ? false : undefined
    }
    const eq = op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken
    const ne = op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken
    if (eq || ne) {
      const l = renderExpr(x.left, scope, depth + 1)
      const r = renderExpr(x.right, scope, depth + 1)
      const known = (v: string[]) => v.length === 1 && !v[0]!.includes(PARAM)
      if (!known(l) || !known(r)) return undefined
      return (l[0] === r[0]) === eq
    }
  }
  return undefined
}

/** A name's literal key (`a`, `"a-b"`), or undefined for a computed one. */
function propertyName(p: ts.PropertyAssignment): string | undefined {
  return ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : undefined
}

/** The entries of the const object literal `e` names (`const PATHS = { … }`), or null. */
function tableOf(e: ts.Expression, scope: Scope): { entries: ts.PropertyAssignment[]; scope: Scope } | null {
  const id = unwrap(e)
  if (!ts.isIdentifier(id)) return null
  const b = scope.lookup(id.text)
  if (!b || !("expr" in b)) return null
  const lit = unwrap(b.expr)
  if (!ts.isObjectLiteralExpression(lit)) return null
  return { entries: lit.properties.filter(ts.isPropertyAssignment), scope: b.scope }
}

/** Every spelling `e` can render to. Unknown parts are `:p`. */
export function renderExpr(e: ts.Expression, scope: Scope, depth = 0): string[] {
  if (depth > 12) return [PARAM]
  const x = unwrap(e)
  if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return [x.text]
  if (ts.isTemplateExpression(x)) {
    let acc = [x.head.text]
    for (const span of x.templateSpans) {
      acc = cross(acc, renderExpr(span.expression, scope, depth + 1))
      acc = cross(acc, [span.literal.text])
    }
    return acc
  }
  if (ts.isIdentifier(x)) {
    const b = scope.lookup(x.text)
    if (!b) return [PARAM]
    if ("values" in b) return b.values ?? [PARAM]
    return renderExpr(b.expr, b.scope, depth + 1)
  }
  if (ts.isPropertyAccessExpression(x)) {
    const chain = thisChain(x)
    // `${this.client.baseUrl}/v1/…` — the host is not part of the route.
    if (chain && chain[chain.length - 1] === "baseUrl") return [""]
    return [PARAM]
  }
  if (ts.isElementAccessExpression(x)) {
    // An unknown key credits EVERY entry: right only for a route table keyed by type (one route per entry).
    const table = tableOf(x.expression, scope)
    if (!table) return [PARAM]
    const keys = renderExpr(x.argumentExpression, scope, depth + 1)
    const known = keys.length === 1 && !keys[0]!.includes(PARAM)
    const entries = known ? table.entries.filter((p) => propertyName(p) === keys[0]) : table.entries
    return entries.length ? entries.flatMap((p) => renderExpr(p.initializer, table.scope, depth + 1)) : [PARAM]
  }
  if (ts.isConditionalExpression(x)) {
    const t = decide(x.condition, scope, depth)
    if (t === true) return renderExpr(x.whenTrue, scope, depth + 1)
    if (t === false) return renderExpr(x.whenFalse, scope, depth + 1)
    return [...renderExpr(x.whenTrue, scope, depth + 1), ...renderExpr(x.whenFalse, scope, depth + 1)]
  }
  if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return cross(renderExpr(x.left, scope, depth + 1), renderExpr(x.right, scope, depth + 1))
  }
  if (ts.isCallExpression(x)) {
    const callee = unwrap(x.expression)
    let target: Callable | undefined
    if (ts.isIdentifier(callee)) {
      // Escaping does not change a route's shape: a bound literal stays itself,
      // an unbound value renders `:p` either way.
      if (callee.text === "encodeURIComponent" || callee.text === "String") {
        const arg = x.arguments[0]
        return arg ? renderExpr(arg, scope, depth + 1) : [PARAM]
      }
      const native = scope.native?.(callee.text)
      if (native) return native(x.arguments.map((a) => renderExpr(a, scope, depth + 1)))
      target = scope.callable(callee.text, false)
    } else {
      const chain = thisChain(callee)
      if (chain && chain.length === 1) target = scope.callable(chain[0]!, true)
    }
    if (!target?.body) return [PARAM]
    return renderExpr(target.body, bindCall(target, x.arguments, scope, depth), depth + 1)
  }
  return [PARAM]
}

/** The scope a callable's body renders in, its parameters bound to the call's arguments. */
export function bindCall(
  target: Callable,
  args: readonly ts.Expression[],
  callerScope: Scope,
  depth = 0,
): Scope {
  const bound = new Map<string, Binding>()
  // A parameter typed by a known finite type: every value it can hold, when the call does not name one.
  const domainOf = (p: ts.ParameterDeclaration): string[] | undefined => {
    const t = p.type
    if (!t || !ts.isTypeReferenceNode(t) || !ts.isIdentifier(t.typeName)) return undefined
    const values = target.scope.domain?.(t.typeName.text)
    return values ? [...values] : undefined
  }
  target.params.forEach((p, i) => {
    if (!ts.isIdentifier(p.name)) return
    const arg = args[i]
    if (arg) {
      const values = renderExpr(arg, callerScope, depth + 1)
      const unknown = values.every((v) => v === PARAM)
      bound.set(p.name.text, { values: unknown ? domainOf(p) ?? values : values })
    } else if (p.initializer) bound.set(p.name.text, { expr: p.initializer, scope: target.scope })
    else bound.set(p.name.text, { values: domainOf(p) ?? null })
  })
  for (const [name, expr] of target.locals) if (!bound.has(name)) bound.set(name, { expr, scope: target.scope })
  return childScope(target.scope, bound)
}

export function childScope(parent: Scope, names: Map<string, Binding>): Scope {
  const self: Scope = {
    lookup: (name) => {
      const own = names.get(name)
      if (!own) return parent.lookup(name)
      // A local const's initializer reads the same scope (params, other locals).
      return "expr" in own && own.scope === parent ? { expr: own.expr, scope: self } : own
    },
    callable: (name, viaThis) => parent.callable(name, viaThis),
    native: (name) => parent.native?.(name),
    domain: (typeName) => parent.domain?.(typeName),
  }
  return self
}

/** Local `const x = …` declarations anywhere in a body (identifier names only). */
export function collectLocals(body: ts.Node | undefined): Map<string, ts.Expression> {
  const out = new Map<string, ts.Expression>()
  if (!body) return out
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) out.set(n.name.text, n.initializer)
    // Nested functions keep their own locals.
    if (n !== body && (ts.isFunctionLike(n) && !ts.isArrowFunction(n))) return
    n.forEachChild(visit)
  }
  visit(body)
  return out
}

/** The single returned expression of a function-like, when there is one to render. */
export function returnedExpr(fn: ts.SignatureDeclaration & { body?: ts.Node }): ts.Expression | undefined {
  const body = fn.body
  if (!body) return undefined
  if (!ts.isBlock(body)) return body as ts.Expression
  let found: ts.Expression | undefined
  const visit = (n: ts.Node): void => {
    if (found) return
    if (ts.isReturnStatement(n) && n.expression) {
      found = n.expression
      return
    }
    if (ts.isFunctionLike(n)) return
    n.forEachChild(visit)
  }
  body.forEachChild(visit)
  return found
}

/** The URL path part of a rendered spelling, from `/v1/` on; null when there is none. */
export function v1Part(spelling: string): string | null {
  const i = spelling.indexOf("/v1/")
  return i < 0 ? null : spelling.slice(i)
}
