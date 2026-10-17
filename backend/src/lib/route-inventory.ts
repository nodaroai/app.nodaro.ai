/**
 * The static inventory of the REST routes this repo registers: every
 * `<app>.<verb>("/v1/…")` call under backend/src/routes/ and backend/src/ee/routes/,
 * read from the source without booting the app.
 *
 * Shared by the frontend ↔ backend path-parity test (route-path-parity.test.ts)
 * and the surface-completeness checker (scripts/check-surfaces.ts), so the two
 * can never disagree about what "a registered route" is.
 *
 * Known blind spots of a static scan, by design: routes registered by the
 * cloud plugin at runtime and paths built at runtime (a registration in a
 * loop over a list, a path held in a variable). `check:surfaces --runtime` boots the
 * app to see the exact set. One loop is read from its registry instead: the
 * use-case route factories (see {@link usecaseFactoryRegistrations}).
 */
// @reads backend/src/routes/** backend/src/ee/routes/**
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { USE_CASE_NODE_TYPES, usecaseContinuePath, usecaseDescriptor } from "@nodaro/render-rules"

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

export interface RouteRegistration {
  method: HttpMethod
  /** Normalized: every parameter is `:p` (see {@link normalizePath}). */
  path: string
  /** 1-based line of the registration in its file. */
  line: number
}

/** Replace `${expr}` with `:p`, handling nested braces. */
export function substituteTemplateExprs(text: string): string {
  let result = ""
  let i = 0
  while (i < text.length) {
    if (text[i] === "$" && text[i + 1] === "{") {
      let depth = 1
      i += 2
      while (i < text.length && depth > 0) {
        if (text[i] === "{") depth++
        else if (text[i] === "}") depth--
        i++
      }
      result += ":p"
    } else {
      result += text[i]
      i++
    }
  }
  return result
}

/**
 * One spelling for every path: query and hash stripped, every `:param` and
 * OpenAPI `{param}` collapsed to `:p`, trailing slash dropped. Returns null for
 * docstring placeholders (`/v1/api/run/EXECUTION_ID`).
 */
export function normalizePath(path: string | null): string | null {
  if (!path) return null
  let p = path.replace(/\?.*$/, "").replace(/#.*$/, "")
  // Skip docstring placeholders like /v1/api/run/EXECUTION_ID — segments
  // that are ALL_CAPS_WITH_UNDERSCORES are convention placeholders, not
  // real route paths.
  if (p.split("/").some((seg) => /^[A-Z][A-Z0-9_]{2,}$/.test(seg))) return null
  p = p.replace(/\{[^}/]+\}/g, ":p")
  p = p.replace(/:[a-zA-Z][a-zA-Z0-9_]*/g, ":p")
  // Iteratively strip trailing-:p artifacts where the ":p" is preceded by a
  // non-slash char. These come from templates like `/v1/foo${qs}` — the
  // ${qs} substituted to ":p" but it's not a real path param, just a query
  // string or conditional.
  let prev: string
  do {
    prev = p
    p = p.replace(/([^/]):p/g, "$1")
  } while (p !== prev)
  if (p.endsWith("/") && p !== "/v1/") p = p.slice(0, -1)
  return p
}

/**
 * `<app>.<verb>` + an optional generic (balanced to two levels, quotes inside
 * allowed) + `(` + the path string as the FIRST argument. Anchoring the path to
 * the call's first argument keeps an unrelated `map.get(` from running on to a
 * later registration's path.
 */
const REGISTRATION_RE =
  /\b\w+\.(get|post|put|patch|delete|head)\s*(?:<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*>)?\s*\(\s*["'`](\/v1\/[^"'`]+)["'`]/g

/** A file that registers its routes once per use-case type (`for (const type of USE_CASE_NODE_TYPES) …`). */
const USE_CASE_LOOP_RE = /\bfor\s*\(\s*const\s+\w+\s+of\s+USE_CASE_NODE_TYPES\s*\)/
/**
 * A registration whose path is the type's, from its descriptor: `d.route`,
 * `` `${d.route}/<suffix>` ``, or `usecaseContinuePath(type)`.
 */
const USE_CASE_REGISTRATION_RE =
  /\b\w+\.(get|post|put|patch|delete)\s*\(\s*(?:d\.route\b|`\$\{d\.route\}(\/[^`$]*)`|(usecaseContinuePath)\(\s*\w+\s*\))/g

/**
 * The use-case route factories (routes/use-case-run.ts, routes/use-case-continue.ts)
 * register one route per registered use-case type, its path read from the
 * type's descriptor — invisible to a literal scan. Expanded here from the same
 * registry (`@nodaro/render-rules`), so a new use-case node's routes are in the
 * inventory the moment it is registered, and a file that stops looping over
 * the types stops reporting them.
 */
export function usecaseFactoryRegistrations(src: string): RouteRegistration[] {
  if (!USE_CASE_LOOP_RE.test(src)) return []
  const out: RouteRegistration[] = []
  for (const m of src.matchAll(USE_CASE_REGISTRATION_RE)) {
    const line = src.slice(0, m.index).split("\n").length
    for (const type of USE_CASE_NODE_TYPES) {
      const raw = m[3] ? usecaseContinuePath(type) : `${usecaseDescriptor(type).route}${m[2] ?? ""}`
      const path = normalizePath(raw)
      if (path) out.push({ method: m[1]!.toUpperCase() as HttpMethod, path, line })
    }
  }
  return out
}

/**
 * Route registrations in one backend file. Matches both `app.<verb>(...)` and
 * `<subapp>.<verb>(...)` (nested Fastify instances created via
 * `app.register(async (api) => { ... })`), and the use-case factories' routes.
 */
export function extractRouteRegistrations(src: string): RouteRegistration[] {
  const out: RouteRegistration[] = []
  for (const m of src.matchAll(REGISTRATION_RE)) {
    const path = normalizePath(substituteTemplateExprs(m[2]!))
    if (!path) continue
    const line = src.slice(0, m.index).split("\n").length
    out.push({ method: m[1]!.toUpperCase() as HttpMethod, path, line })
  }
  return [...out, ...usecaseFactoryRegistrations(src)]
}

/** The normalized paths a backend file registers, any verb. */
export function extractBackendV1Paths(src: string): Set<string> {
  return new Set(extractRouteRegistrations(src).map((r) => r.path))
}

/** Every shipped .ts file under `dir` (tests and declarations excluded). */
export function walkRouteFiles(dir: string): string[] {
  const out: string[] = []
  const stat = statSync(dir, { throwIfNoEntry: false })
  if (!stat) return out
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue
    const p = join(dir, entry)
    const s = statSync(p)
    if (s.isDirectory()) {
      out.push(...walkRouteFiles(p))
    } else if (
      s.isFile() &&
      entry.endsWith(".ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".d.ts")
    ) {
      out.push(p)
    }
  }
  return out
}

/** The two route trees, relative to the repo root. */
export const ROUTE_DIRS = ["backend/src/routes", "backend/src/ee/routes"] as const
