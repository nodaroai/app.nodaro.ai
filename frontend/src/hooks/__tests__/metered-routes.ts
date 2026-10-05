/**
 * Which routes charge, read from the backend's own route registrations, and
 * which routes each function of the client (`lib/api.ts`) calls. The half of
 * `paid-run-mark-guard.test.ts` that checks its paid set against the server:
 * a client function that calls a route which charges, and that no rule of the
 * guard brings in, fails it. A plain read of the sources; nothing runs.
 */
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

/**
 * A registration charges when its call holds one of these: `creditGuard` as
 * its `preHandler`, or a reservation or a metered LLM call in its handler.
 */
const CHARGES = /\b(?:creditGuard|meterSyncLlm|reserveCreditsForJob|reserveCredits)\(/

const VERBS = new Set(["get", "post", "put", "patch", "delete"])

export interface ChargingRoute {
  /** Its verb and path, every parameter as `:`: `POST /v1/characters/:/llm-caption`. */
  readonly route: string
  /** Its path alone, in the same spelling. */
  readonly path: string
  /** Where it is registered: `backend/src/routes/….ts:205`. */
  readonly at: string
}

/** One spelling for a route's path: no query, and every parameter as `:`. */
export function routePath(raw: string): string {
  return raw
    .replace(/[?#].*$/, "")
    .split("/")
    .map((segment) => (segment.startsWith(":") ? ":" : segment))
    .join("/")
}

/** One spelling for a route: its verb, then its path. */
export function routeOf(verb: string, raw: string): string {
  return `${verb.toUpperCase()} ${routePath(raw)}`
}

/** The routes one source file registers as `<server>.<verb>("/v1/…", …)` whose registration charges. */
export function chargingRoutesIn(file: string, text: string): ChargingRoute[] {
  if (!CHARGES.test(text)) return []
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const found: ChargingRoute[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && VERBS.has(node.expression.name.text)) {
      const first = node.arguments[0]
      if (first && ts.isStringLiteralLike(first) && first.text.startsWith("/v1/") && CHARGES.test(node.getText(sf))) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
        found.push({ route: routeOf(node.expression.name.text, first.text), path: routePath(first.text), at: `${file}:${line}` })
      }
    }
    node.forEachChild(visit)
  }
  visit(sf)
  return found
}

function backendSources(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules" || entry.name === "test") continue
      backendSources(full, acc)
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") && !entry.name.endsWith(".test.ts")) {
      acc.push(full)
    }
  }
  return acc
}

/** Every route that charges, across `backend/src` of the repository at `repoRoot`. */
export function chargingRoutes(repoRoot: string): ChargingRoute[] {
  return backendSources(path.join(repoRoot, "backend/src")).flatMap((file) =>
    chargingRoutesIn(path.relative(repoRoot, file).split(path.sep).join("/"), fs.readFileSync(file, "utf8")),
  )
}

/**
 * The `/v1/…` paths each exported function of the client names in its own
 * body, in the spelling of {@link routePath}: a string, or a template whose
 * every `${…}` stands for one parameter (`${API_BASE_URL}/v1/…` included).
 */
export function clientRoutesIn(file: string, text: string): Map<string, string[]> {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out = new Map<string, string[]>()
  const record = (name: string, body: ts.Node) => {
    const paths: string[] = []
    const visit = (node: ts.Node): void => {
      const raw = ts.isStringLiteralLike(node)
        ? node.text
        : ts.isTemplateExpression(node)
          ? node.head.text + node.templateSpans.map((span) => `:${span.literal.text}`).join("")
          : null
      const at = raw?.indexOf("/v1/") ?? -1
      if (raw !== null && at >= 0) paths.push(routePath(raw.slice(at)))
      node.forEachChild(visit)
    }
    visit(body)
    out.set(name, [...(out.get(name) ?? []), ...paths])
  }
  for (const st of sf.statements) {
    const exported = ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    if (!exported) continue
    if (ts.isFunctionDeclaration(st) && st.name) record(st.name.text, st)
    if (ts.isVariableStatement(st)) {
      for (const decl of st.declarationList.declarations) {
        const init = decl.initializer
        if (ts.isIdentifier(decl.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) record(decl.name.text, init)
      }
    }
  }
  return out
}
