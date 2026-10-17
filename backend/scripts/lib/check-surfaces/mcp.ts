/**
 * The MCP surface: the tools the server registers per edition (captured in a
 * child process exactly as gen:skills does, see tool-surface.ts) and the REST
 * routes each tool calls.
 *
 * Which routes a tool calls is read from the AST of backend/src/lib/mcp/tools —
 * never a regex, because comments must not count (a tool may describe in a
 * comment a route it deliberately does not call). Inside each
 * `server.registerTool("name", …)` call, every literal that renders to a
 * `/v1/…` URL is a route the tool calls: an `mcpInject(…, { method, url })`
 * takes the method beside it, `dispatchJob` / `postJob` / `postBuilder` post,
 * anything else matches the path on any method. Helpers the handler calls by
 * name (in its own file or a `_*.ts` helper file) are followed, so a helper's
 * literal (`/v1/jobs/:id` in a polling helper) is credited to every tool that
 * calls it. A templated tool name (`list_${cfg.table}`) is expanded against the
 * captured tool names.
 */
// @reads backend/src/lib/mcp/tools/*.ts
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import { USE_CASE_NODE_TYPES, isUseCaseNodeType, usecaseContinuePath } from "@nodaro/render-rules"
import { lineOf, parseText } from "../../../src/lib/__tests__/source-scan.js"
import { normalizePath } from "../../../src/lib/route-inventory.js"
import { captureToolSurface, type ToolSurface } from "../gen-skills/tool-surface.js"
import { PARAM, bindCall, childScope, collectLocals, renderExpr, unwrap, v1Part, type Binding, type NativeFn, type Scope } from "./render-path.js"
import { MCP_DIRECT_TOOL_ROUTES } from "./features.js"
import { moduleScope } from "./ts-scope.js"

export const MCP_TOOLS_DIR = "backend/src/lib/mcp/tools"

/** Helpers whose URL argument is always POSTed. */
const POST_HELPERS = new Set(["dispatchJob", "postJob", "postBuilder"])

/**
 * `@nodaro/render-rules` functions a tool file may import to pick a route, run
 * for real. A type read at run time (the run a job id names) can reach every
 * registered use-case type's route.
 */
const RENDER_RULES_NATIVES: Readonly<Record<string, NativeFn>> = {
  usecaseContinuePath: ([types = [PARAM]]) =>
    types.flatMap((t) => (t.includes(PARAM) ? USE_CASE_NODE_TYPES.map(usecaseContinuePath) : isUseCaseNodeType(t) ? [usecaseContinuePath(t)] : [])),
}

/** The RENDER_RULES_NATIVES a file imports from `@nodaro/render-rules`, by local name. */
function renderRulesNatives(sf: ts.SourceFile): Map<string, NativeFn> {
  const out = new Map<string, NativeFn>()
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.moduleSpecifier.text !== "@nodaro/render-rules") continue
    const named = st.importClause?.namedBindings
    if (!named || !ts.isNamedImports(named) || st.importClause?.isTypeOnly) continue
    for (const el of named.elements) {
      const fn = RENDER_RULES_NATIVES[(el.propertyName ?? el.name).text]
      if (fn && !el.isTypeOnly) out.set(el.name.text, fn)
    }
  }
  return out
}

export interface McpRoute {
  /** Upper-case verb, or `?` (matches any). */
  method: string
  path: string
}

export interface McpTool {
  name: string
  /** `backend/src/lib/mcp/tools/x.ts:12`, when the registration was found. */
  ref?: string
  file?: string
  cloudOnly: boolean
  routes: McpRoute[]
  /** Routes whose operation the tool performs without calling them (MCP_DIRECT_TOOL_ROUTES). */
  serves?: McpRoute[]
  /** A tool with no `/v1` route: `direct-service` (reads/writes itself) or `content-only`. */
  kind: "route" | "direct-service" | "content-only"
}

export interface McpInventory {
  tools: Map<string, McpTool>
  /** Registrations found in the source whose name no edition registers. */
  astOnly: string[]
  /** Captured tools whose registration the AST scan did not find. */
  notFoundInSource: string[]
}

interface Literal {
  node: ts.Expression
  method: string
}

interface FnInfo {
  file: string
  body: ts.Node
  /** The scope the function is defined in (module, or the enclosing function's). */
  scope: Scope
  params: ts.NodeArray<ts.ParameterDeclaration>
  /** Local consts of the body, bound per call alongside the parameters. */
  locals: Map<string, ts.Expression>
}

/** URL literals under `node` with their method, plus the calls of functions named by identifier. */
function scanUrls(node: ts.Node, scope: Scope): { urls: McpRoute[]; calls: Map<string, ts.CallExpression[]> } {
  const literals: Literal[] = []
  const calls = new Map<string, ts.CallExpression[]>()
  const methodFor = new Map<ts.Node, string>()
  const visit = (n: ts.Node): void => {
    if (ts.isObjectLiteralExpression(n)) {
      let method: string | undefined
      let url: ts.Expression | undefined
      for (const p of n.properties) {
        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue
        const v = unwrap(p.initializer)
        if (p.name.text === "method" && (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v))) method = v.text.toUpperCase()
        if (p.name.text === "url") url = p.initializer
      }
      if (url && method) methodFor.set(unwrap(url), method)
    }
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression)
      if (ts.isIdentifier(callee)) {
        calls.set(callee.text, [...(calls.get(callee.text) ?? []), n])
        if (POST_HELPERS.has(callee.text)) {
          for (const a of n.arguments) {
            const x = unwrap(a)
            if (ts.isObjectLiteralExpression(x)) {
              for (const p of x.properties) {
                if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "url" && !methodFor.has(unwrap(p.initializer))) {
                  methodFor.set(unwrap(p.initializer), "POST")
                }
              }
            } else if (!methodFor.has(x)) methodFor.set(x, "POST")
          }
        }
      }
    }
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) {
      literals.push({ node: n, method: "" })
      return
    }
    n.forEachChild(visit)
  }
  visit(node)
  const urls: McpRoute[] = []
  for (const lit of literals) {
    for (const spelling of renderExpr(lit.node, scope)) {
      // A URL, not prose that names one: a tool description saying "calls
      // POST /v1/x" is a string too, but it does not START with the path.
      if (!/^(:p)?\/v1\//.test(spelling)) continue
      const path = normalizePath(v1Part(spelling))
      if (path && path !== "/v1") urls.push({ method: methodFor.get(lit.node) ?? "?", path })
    }
  }
  // An identifier passed as the URL (`url: route`) renders through its binding;
  // a call or a table lookup (`url: usecaseContinuePath(type)`) through what it returns.
  for (const [n, method] of methodFor) {
    if (!ts.isIdentifier(n) && !ts.isCallExpression(n) && !ts.isElementAccessExpression(n)) continue
    for (const spelling of renderExpr(n, scope)) {
      const path = normalizePath(v1Part(spelling))
      if (path) urls.push({ method, path })
    }
  }
  return { urls, calls }
}

function dedupe(routes: McpRoute[]): McpRoute[] {
  const byKey = new Map<string, McpRoute>()
  for (const r of routes) byKey.set(`${r.method} ${r.path}`, r)
  // A known method makes the `?` spelling of the same path redundant.
  return [...byKey.values()].filter((r) => r.method !== "?" || ![...byKey.values()].some((o) => o.path === r.path && o.method !== "?"))
}

interface Registration {
  /** The rendered name; `:p` where it is templated. */
  name: string
  file: string
  line: number
  call: ts.CallExpression
  /** The registration's source text. */
  text: string
  scope: Scope
}

function isRegisterTool(n: ts.Node): n is ts.CallExpression {
  if (!ts.isCallExpression(n)) return false
  const callee = unwrap(n.expression)
  return ts.isPropertyAccessExpression(callee) && callee.name.text === "registerTool"
}

export interface ToolSources {
  registrations: Registration[]
  functions: Map<string, FnInfo[]>
}

export function scanToolSources(repoRoot: string): ToolSources {
  const dir = join(repoRoot, MCP_TOOLS_DIR)
  const files = readdirSync(dir)
    .filter((x) => x.endsWith(".ts"))
    .sort()
    .map((f) => ({ rel: `${MCP_TOOLS_DIR}/${f}`, text: readFileSync(join(dir, f), "utf8") }))
  return scanToolFiles(files)
}

/** The registrations and named functions of tool source files given as text. */
export function scanToolFiles(files: ReadonlyArray<{ rel: string; text: string }>): ToolSources {
  const registrations: Registration[] = []
  const functions = new Map<string, FnInfo[]>()
  for (const { rel, text } of files) {
    const sf = parseText(rel, text)
    const mod = moduleScope(sf, renderRulesNatives(sf))
    // A helper is recorded with the scope it is DEFINED in, so one declared
    // inside a register function sees that function's other locals.
    const addFn = (name: string, fn: ts.SignatureDeclaration & { body?: ts.Node }, scope: Scope) => {
      if (!fn.body) return
      const info: FnInfo = { file: rel, body: fn.body, scope, params: fn.parameters, locals: collectLocals(fn.body) }
      functions.set(name, [...(functions.get(name) ?? []), info])
    }
    const visit = (n: ts.Node, scope: Scope): void => {
      if (ts.isFunctionDeclaration(n) && n.name) addFn(n.name.text, n, scope)
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        const init = unwrap(n.initializer)
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) addFn(n.name.text, init, scope)
      }
      let inner = scope
      if (ts.isFunctionLike(n) && (n as { body?: ts.Node }).body) {
        const locals = new Map<string, Binding>()
        for (const [k, e] of collectLocals((n as { body?: ts.Node }).body)) locals.set(k, { expr: e, scope })
        inner = childScope(scope, locals)
      }
      if (isRegisterTool(n) && n.arguments[0]) {
        const name = renderExpr(n.arguments[0], inner)[0] ?? PARAM
        registrations.push({ name, file: rel, line: lineOf(sf, n), call: n, text: sf.text.slice(n.pos, n.end), scope: inner })
      }
      n.forEachChild((c) => visit(c, inner))
    }
    visit(sf, mod)
  }
  return { registrations, functions }
}

/**
 * The routes a registration's handler reaches, following named helpers up to
 * `depth` hops. Each call binds the helper's parameters to its arguments (as
 * the SDK extractor does), so `post(id, "voice")` renders `…/:p/voice`; a
 * helper is followed once per distinct argument list.
 */
export function routesOf(reg: Registration, functions: Map<string, FnInfo[]>, depth = 3): McpRoute[] {
  const out: McpRoute[] = []
  const seen = new Set<string>()
  let frontier: Array<{ node: ts.Node; scope: Scope; file: string }> = [{ node: reg.call, scope: reg.scope, file: reg.file }]
  for (let d = 0; d <= depth && frontier.length; d++) {
    const next: typeof frontier = []
    for (const f of frontier) {
      const { urls, calls } = scanUrls(f.node, f.scope)
      out.push(...urls)
      for (const [name, callExprs] of calls) {
        const candidates = functions.get(name) ?? []
        // Same file first; else a shared `_*.ts` helper.
        const pick = candidates.filter((c) => c.file === f.file)
        const chosen = pick.length ? pick : candidates.filter((c) => /\/_[^/]+\.ts$/.test(c.file))
        if (!chosen.length) continue
        for (const call of callExprs) {
          const sig = `${name}(${call.arguments.map((a) => renderExpr(a, f.scope).join("|")).join(",")})`
          if (seen.has(sig)) continue
          seen.add(sig)
          for (const c of chosen) {
            const scope = bindCall({ params: c.params, body: undefined, scope: c.scope, locals: c.locals }, call.arguments, f.scope)
            next.push({ node: c.body, scope, file: c.file })
          }
        }
      }
    }
    frontier = next
  }
  return dedupe(out)
}

function nameMatcher(rendered: string): RegExp {
  const escaped = rendered.split(PARAM).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  return new RegExp(`^${escaped.join("[a-z0-9_]+")}$`)
}

export async function extractMcp(repoRoot: string): Promise<McpInventory & { cloud: ToolSurface; community: ToolSurface }> {
  const backendDir = join(repoRoot, "backend")
  const [cloud, community] = await Promise.all([captureToolSurface("cloud", backendDir), captureToolSurface("community", backendDir)])
  return { ...joinMcp(repoRoot, cloud, community), cloud, community }
}

export function joinMcp(repoRoot: string, cloud: ToolSurface, community: ToolSurface): McpInventory {
  const { registrations, functions } = scanToolSources(repoRoot)
  const tools = new Map<string, McpTool>()
  const captured = Object.keys(cloud.tools)
  const astOnly: string[] = []
  // Literal names first, so a templated name (`get_${cfg.singular}`) only
  // claims the captured tools no literal registration owns.
  const ordered = [...registrations].sort((a, b) => Number(a.name.includes(PARAM)) - Number(b.name.includes(PARAM)))
  const literalNames = new Set(registrations.filter((r) => !r.name.includes(PARAM)).map((r) => r.name))
  for (const reg of ordered) {
    const names = reg.name.includes(PARAM)
      ? captured.filter((n) => nameMatcher(reg.name).test(n) && !literalNames.has(n))
      : [reg.name]
    if (!reg.name.includes(PARAM) && !(reg.name in cloud.tools)) {
      astOnly.push(reg.name)
      continue
    }
    const routes = routesOf(reg, functions)
    const text = reg.text
    const kind: McpTool["kind"] = routes.length
      ? "route"
      : /supabase|fastify|from\(|\.rpc\(|await /.test(text)
        ? "direct-service"
        : "content-only"
    for (const name of names) {
      if (tools.has(name)) continue
      tools.set(name, { name, ref: `${reg.file}:${reg.line}`, file: reg.file, cloudOnly: !(name in community.tools), routes, kind })
    }
  }
  const notFoundInSource: string[] = []
  for (const name of captured) {
    if (tools.has(name)) continue
    notFoundInSource.push(name)
    tools.set(name, { name, cloudOnly: !(name in community.tools), routes: [], kind: "direct-service" })
  }
  for (const [name, keys] of Object.entries(MCP_DIRECT_TOOL_ROUTES)) {
    const tool = tools.get(name)
    if (!tool) continue
    tool.serves = keys.map((k) => ({ method: k.slice(0, k.indexOf(" ")), path: k.slice(k.indexOf(" ") + 1) }))
  }
  return { tools, astOnly, notFoundInSource }
}
