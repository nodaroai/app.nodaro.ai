/**
 * The SDK surface (@nodaro/sdk, packages/client): every public method of every
 * resource the client exposes, keyed `<property path>.<method>`
 * (`characters.list`, `workflows.collaborators.add`), and the routes it calls.
 *
 * Read from the TypeScript AST, so comments never count and every way a
 * resource spells a URL renders the same: string and template literals, module
 * consts and helpers (`root`, `path(id)`), private helpers
 * (`this.path(id, "/ops")`), `${this.client.baseUrl}/v1/…` for raw fetches,
 * and run-time route choices (`nodes.run` picks its route by node type).
 *
 * A method that calls another resource (`scene3d.generate` →
 * `nodes.run("generate-3d-scene")`) or another method of its own class is
 * followed, with the literal arguments bound, so it is credited with the route
 * the call actually reaches.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import { lineOf, parseText, walk } from "../../../src/lib/__tests__/source-scan.js"
import { normalizePath } from "../../../src/lib/route-inventory.js"
import { bindCall, renderExpr, thisChain, unwrap, v1Part, type Callable, type Scope } from "./render-path.js"
import { classScope, moduleScope } from "./ts-scope.js"
import { collectLocals, returnedExpr } from "./render-path.js"

export const SDK_DIR = "packages/client/src"

export interface SdkRoute {
  /** Upper-case verb, or `?` when the verb is not a literal. */
  method: string
  path: string
}

export interface SdkMethod {
  /** `characters.list`, `workflows.collaborators.add`. */
  key: string
  /** The resource property path (`characters`, `studio.productions`). */
  prop: string
  name: string
  /** `packages/client/src/resources/x.ts:12`. */
  ref: string
  /** Every route this method reaches, directly or through what it calls. */
  routes: SdkRoute[]
}

export interface SdkInventory {
  /** Every resource property path, top level and nested. */
  props: string[]
  methods: Map<string, SdkMethod>
  /** The routes `nodes.run(type)` posts to for one node type. */
  nodeRunRoutes(type: string): string[]
}

interface ClassInfo {
  cls: ts.ClassDeclaration
  sf: ts.SourceFile
  rel: string
  scope: Scope
}

/** `this.x = new Y(...)` assignments in a class's constructor. */
function constructedMembers(cls: ts.ClassDeclaration): Array<{ prop: string; className: string }> {
  const out: Array<{ prop: string; className: string }> = []
  for (const m of cls.members) {
    if (!ts.isConstructorDeclaration(m) || !m.body) continue
    for (const st of m.body.statements) {
      if (!ts.isExpressionStatement(st)) continue
      const e = st.expression
      if (!ts.isBinaryExpression(e) || e.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue
      const chain = thisChain(e.left)
      const right = unwrap(e.right)
      if (chain?.length === 1 && ts.isNewExpression(right) && ts.isIdentifier(right.expression)) {
        out.push({ prop: chain[0]!, className: right.expression.text })
      }
    }
  }
  return out
}

function isPublicMethod(m: ts.ClassElement): m is ts.MethodDeclaration {
  if (!ts.isMethodDeclaration(m) || !m.body || !ts.isIdentifier(m.name)) return false
  const mods = ts.canHaveModifiers(m) ? ts.getModifiers(m) ?? [] : []
  return !mods.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.ProtectedKeyword)
}

const REQUEST_FNS = new Set(["request", "requestText", "requestBytes"])

function methodLiteral(e: ts.Expression | undefined): string {
  if (!e) return "?"
  const x = unwrap(e)
  return ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) ? x.text.toUpperCase() : "?"
}

/** The `method:` of a fetch's init object, GET when it names none. */
function fetchMethod(init: ts.Expression | undefined): string {
  if (!init || !ts.isObjectLiteralExpression(unwrap(init))) return "GET"
  for (const p of (unwrap(init) as ts.ObjectLiteralExpression).properties) {
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "method") return methodLiteral(p.initializer)
  }
  return "GET"
}

export function extractSdk(repoRoot: string): SdkInventory {
  const classes = new Map<string, ClassInfo>()
  const resDir = join(repoRoot, SDK_DIR, "resources")
  const files = [join(repoRoot, SDK_DIR, "client.ts"), ...readdirSync(resDir).filter((f) => f.endsWith(".ts")).map((f) => join(resDir, f))]
  for (const file of files) {
    const sf = parseText(file, readFileSync(file, "utf8"))
    const mod = moduleScope(sf)
    const rel = file.slice(repoRoot.length + 1)
    walk(sf, (n) => {
      if (ts.isClassDeclaration(n) && n.name) classes.set(n.name.text, { cls: n, sf, rel, scope: classScope(n, mod) })
    })
  }
  const client = classes.get("NodaroClient")
  if (!client) throw new Error("check-surfaces: NodaroClient class not found in packages/client/src/client.ts")

  // Property path → class, walking nested resources (workflows.collaborators).
  const propClass = new Map<string, ClassInfo>()
  const queue = constructedMembers(client.cls).map((m) => ({ path: m.prop, className: m.className }))
  while (queue.length) {
    const { path, className } = queue.shift()!
    const info = classes.get(className)
    if (!info || propClass.has(path)) continue
    propClass.set(path, info)
    for (const m of constructedMembers(info.cls)) queue.push({ path: `${path}.${m.prop}`, className: m.className })
  }
  // The client's own methods (`client.me()`) are a resource of their own.
  propClass.set("client", client)
  const topProps = new Set([...propClass.keys()].filter((p) => !p.includes(".") && p !== "client"))

  const declOf = new Map<string, { decl: ts.MethodDeclaration; info: ClassInfo; prop: string }>()
  for (const [prop, info] of propClass) {
    for (const m of info.cls.members) {
      if (!isPublicMethod(m)) continue
      const name = (m.name as ts.Identifier).text
      // The transport itself is not a feature method.
      if (prop === "client" && REQUEST_FNS.has(name)) continue
      declOf.set(`${prop}.${name}`, { decl: m, info, prop })
    }
  }

  const callableOf = (decl: ts.MethodDeclaration, scope: Scope): Callable => ({
    params: decl.parameters,
    body: returnedExpr(decl),
    scope,
    locals: collectLocals(decl.body),
  })

  /** Routes reached from `key`, its parameters bound to `args` read in `callerScope`. */
  const routesOf = (key: string, args: readonly ts.Expression[], callerScope: Scope, seen: Set<string>): SdkRoute[] => {
    const target = declOf.get(key)
    if (!target || seen.has(key) || seen.size > 8) return []
    const nextSeen = new Set(seen).add(key)
    const scope = bindCall(callableOf(target.decl, target.info.scope), args, callerScope)
    const out: SdkRoute[] = []
    walk(target.decl.body!, (n) => {
      if (!ts.isCallExpression(n)) return
      const chain = thisChain(n.expression)
      if (!chain) return
      let method: string | undefined
      let urlExpr: ts.Expression | undefined
      // Inside the client class the transport is `this.request(…)`.
      const transport = target.prop === "client" ? chain.length === 1 && REQUEST_FNS.has(chain[0]!) : false
      if (transport || (chain.length === 2 && chain[0] === "client" && REQUEST_FNS.has(chain[1]!))) {
        method = methodLiteral(n.arguments[0])
        urlExpr = n.arguments[1]
      } else if (chain.length === 2 && chain[0] === "client" && chain[1] === "fetch") {
        method = fetchMethod(n.arguments[1])
        urlExpr = n.arguments[0]
      } else if (chain.length === 3 && chain[0] === "client" && topProps.has(chain[1]!)) {
        out.push(...routesOf(`${chain[1]}.${chain[2]}`, n.arguments, scope, nextSeen))
        return
      } else if (chain.length === 1 && declOf.has(`${target.prop}.${chain[0]}`)) {
        out.push(...routesOf(`${target.prop}.${chain[0]}`, n.arguments, scope, nextSeen))
        return
      }
      if (!method || !urlExpr) return
      for (const spelling of renderExpr(urlExpr, scope)) {
        const path = normalizePath(v1Part(spelling))
        if (path) out.push({ method, path })
      }
    })
    const uniq = new Map(out.map((r) => [`${r.method} ${r.path}`, r]))
    return [...uniq.values()]
  }

  const emptyScope: Scope = { lookup: () => undefined, callable: () => undefined }
  const methods = new Map<string, SdkMethod>()
  for (const [key, { decl, info, prop }] of declOf) {
    methods.set(key, {
      key,
      prop,
      name: (decl.name as ts.Identifier).text,
      ref: `${info.rel}:${lineOf(info.sf, decl)}`,
      routes: routesOf(key, [], emptyScope, new Set()),
    })
  }

  const nodeRunRoutes = (type: string): string[] => {
    const lit = ts.factory.createStringLiteral(type)
    return [...new Set(routesOf("nodes.run", [lit], emptyScope, new Set()).map((r) => r.path))]
  }

  return { props: [...propClass.keys()].sort(), methods, nodeRunRoutes }
}
