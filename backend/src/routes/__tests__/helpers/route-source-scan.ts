// @test-watches backend/src/**/*.ts
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, sep } from "node:path"

/**
 * Source scan shared by the OAuth-scope totality tests: which routes are
 * registered anywhere in backend/src. Each scope test owns one disjoint set of
 * paths (the predicates below); route-source-scan.test.ts holds them disjoint
 * and owns the computed-path check.
 */

/** Running published apps and components, and reading their runs (app-run-route-scopes.test.ts). */
export function isAppRunPath(path: string): boolean {
  return (
    path.startsWith("/v1/app/") ||
    path === "/v1/me/archived-runs" ||
    path.startsWith("/v1/me/archived-runs/") ||
    path.startsWith("/v1/component/")
  )
}

/** Published-app management and the creator's monetization (apps-route-scopes.test.ts). */
export function isAppManagementPath(path: string): boolean {
  return path === "/v1/apps" || path.startsWith("/v1/apps/") || /^\/v1\/user\/(earnings|monetization)/.test(path)
}

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

/**
 * Files that register routes on a computed path, which a source scan cannot
 * read, each with why none of them is a covered route. A new one fails the
 * scan until it is listed here.
 */
export const DYNAMIC_ROUTE_FILES: Record<string, string> = {
  "routes/use-case-run.ts": "use-case node routes: one top-level path per use-case descriptor (`d.route`)",
  "routes/use-case-continue.ts": "use-case continue routes: one per use-case node (`usecaseContinuePath(type)`)",
}

const LITERAL = /^(["'`])((?:(?!\1)[^\\]|\\.)*)\1/

/** A route path written as a string literal, or null when it is computed. */
function literalPath(src: string): string | null {
  const m = LITERAL.exec(src)
  if (!m || (m[1] === "`" && m[2]!.includes("${"))) return null
  return m[2]!
}

/**
 * Every covered route registered anywhere in backend/src, read from the source:
 * `<x>.get("<path>", …)` (and post / put / patch / delete), and
 * `<x>.route({ method, url })` with its keys in either order. An inject or a
 * fetch is not a registration and is not read. A registration on a Fastify
 * instance (`app` / `fastify` / `instance` / `server` / `scoped`) whose path is
 * computed is reported as dynamic.
 */
export function routesInSource(isCoveredPath: (path: string) => boolean): { routes: string[]; files: string[]; dynamic: string[] } {
  const routes: string[] = []
  const files = new Set<string>()
  const dynamic = new Set<string>()
  const call = /\.(get|post|put|patch|delete)\(\s*/g
  const onInstance = /\b(?:app|fastify|instance|server|scoped)\.(get|post|put|patch|delete|route)\(\s*/g
  const routeObject = /\.route\(\s*\{/g
  for (const entry of readdirSync(SRC_ROOT, { recursive: true }) as string[]) {
    const rel = entry.split(sep).join("/")
    if (!rel.endsWith(".ts") || rel.includes("__tests__") || rel.endsWith(".test.ts")) continue
    // Comments out, so a route named in prose is not read as a registration.
    const text = readFileSync(join(SRC_ROOT, entry), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
    const add = (method: string, path: string) => {
      if (!isCoveredPath(path)) return
      routes.push(`${method.toUpperCase()} ${path}`)
      files.add(rel)
    }
    for (const m of text.matchAll(call)) {
      const path = literalPath(text.slice(m.index! + m[0].length))
      if (path !== null) add(m[1]!, path)
    }
    for (const m of text.matchAll(routeObject)) {
      const body = text.slice(m.index! + m[0].length, m.index! + m[0].length + 600)
      const method = /\bmethod:\s*["'](\w+)["']/.exec(body)?.[1]
      const urlAt = /\burl:\s*/.exec(body)
      const url = urlAt ? literalPath(body.slice(urlAt.index + urlAt[0].length)) : null
      if (method && url !== null) add(method, url)
      else if (/from ["']fastify["']/.test(text)) dynamic.add(rel)
    }
    if (/from ["']fastify["']/.test(text)) {
      for (const m of text.matchAll(onInstance)) {
        if (m[1] === "route") continue
        if (literalPath(text.slice(m.index! + m[0].length)) === null) dynamic.add(rel)
      }
    }
  }
  return { routes, files: [...files], dynamic: [...dynamic] }
}
