/**
 * The REST route surface, and why a route is or is not scored on every
 * surface (its bucket).
 *
 * Static by default: the shared route inventory (src/lib/route-inventory.ts,
 * the same scan the frontend path-parity test uses) plus `/mcp`. Routes the
 * Cloud plugin serves are not in this repo and are bucketed `plugin` from a
 * declared prefix list (features.ts). `--runtime` boots the app per edition
 * instead (capture-routes.ts) for the exact set.
 */
// @reads backend/src/** packages/*/src/** backend/skills/** .claude/skills/nodaro-film-director/SKILL.md
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import ts from "typescript"
import { extractRouteRegistrations, normalizePath, ROUTE_DIRS, walkRouteFiles } from "../../../src/lib/route-inventory.js"
import { parseText } from "../../../src/lib/__tests__/source-ast.js"
import { isPluginPath } from "./features.js"
import type { RouteBucket } from "./types.js"

export interface RouteEntry {
  method: string
  path: string
  /** `backend/src/routes/x.ts:12`; for a runtime capture, the edition it was seen in. */
  ref: string
  bucket: RouteBucket
  anonymous: boolean
}

/** Route files that refuse anything but a signed-in browser session (`in_app_only`). */
function inAppOnlyFiles(repoRoot: string, files: string[]): Set<string> {
  return new Set(files.filter((f) => readFileSync(f, "utf8").includes('"in_app_only"')).map((f) => f.slice(repoRoot.length + 1)))
}

export interface Classifier {
  (method: string, path: string, file?: string): RouteBucket
}

export function makeClassifier(inAppOnly: ReadonlySet<string>): Classifier {
  return (_method, path, file) => {
    const seg = path.split("/")
    if (path === "/mcp" || path === "/health" || path.startsWith("/og/") || path.startsWith("/.well-known/")) return "infra"
    if (path === "/v1/openapi.json" || path === "/v1/version") return "infra"
    if (!path.startsWith("/v1/")) return "infra"
    if (seg[2] === "admin") return "admin"
    if (file && inAppOnly.has(file)) return "in_app_only"
    if (seg.some((s) => s === "webhooks" || s === "webhook" || /-webhook$/.test(s)) || seg.includes("callback") || path.startsWith("/v1/social/meta/")) {
      return "webhook"
    }
    if (seg[2] === "setup" || seg[2] === "nodaro-connect") return "selfhost"
    if (isPluginPath(path)) return "plugin"
    return "public"
  }
}

export async function staticRoutes(repoRoot: string): Promise<{ routes: RouteEntry[]; classify: Classifier }> {
  const files = ROUTE_DIRS.flatMap((d) => walkRouteFiles(join(repoRoot, d)))
  const classify = makeClassifier(inAppOnlyFiles(repoRoot, files))
  const { isAnonymousRoute } = await import("../../../src/middleware/auth.js")
  const anonymous = (method: string, path: string) => isAnonymousRoute(method, path.replace(/:p/g, "x"))
  const routes: RouteEntry[] = []
  for (const f of files) {
    const rel = f.slice(repoRoot.length + 1)
    for (const r of extractRouteRegistrations(readFileSync(f, "utf8"))) {
      if (r.method === "HEAD") continue
      // A route this repo registers is not the plugin's, even under a plugin
      // prefix (the self-hosted relays share their paths with the plugin).
      const bucket = classify(r.method, r.path, rel)
      routes.push({ method: r.method, path: r.path, ref: `${rel}:${r.line}`, bucket: bucket === "plugin" ? "public" : bucket, anonymous: anonymous(r.method, r.path) })
    }
  }
  // `/mcp` is registered by registerMcpRoute with `app.all`, which the
  // `<app>.<verb>("/v1/…")` scan does not see.
  const mcpFile = "backend/src/routes/mcp.ts"
  const mcpSrc = readFileSync(join(repoRoot, mcpFile), "utf8")
  const mcpLine = mcpSrc.slice(0, mcpSrc.indexOf('"/mcp"')).split("\n").length
  for (const method of ["GET", "POST", "DELETE"]) routes.push({ method, path: "/mcp", ref: `${mcpFile}:${mcpLine}`, bucket: "infra", anonymous: false })
  return { routes, classify }
}

/**
 * The OpenAPI document's operations, `METHOD /path` → present. Modules that
 * register at import time are imported; the ones that register inside an
 * exported route function have that function called on a stub app, as the
 * OpenAPI document test does.
 */
export async function openApiOperations(repoRoot: string): Promise<Set<string>> {
  const files = ROUTE_DIRS.flatMap((d) => walkRouteFiles(join(repoRoot, d))).filter((f) =>
    readFileSync(f, "utf8").includes("openApiRegistry.registerPath"),
  )
  // Every Fastify call is a no-op: only the OpenAPI registrations matter.
  const stubApp: unknown = new Proxy({}, { get: () => () => stubApp })
  for (const f of files) {
    const mod = (await import(pathToFileURL(f).href)) as Record<string, unknown>
    const sf = parseText(f, readFileSync(f, "utf8"))
    for (const st of sf.statements) {
      if (!ts.isFunctionDeclaration(st) || !st.name || !st.body) continue
      const exported = (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      if (!exported || !sf.text.slice(st.body.pos, st.body.end).includes("openApiRegistry.registerPath")) continue
      const fn = mod[st.name.text]
      if (typeof fn === "function") await (fn as (app: unknown) => unknown)(stubApp)
    }
  }
  const { generateOpenApiDoc } = await import("../../../src/lib/openapi-registry.js")
  const doc = generateOpenApiDoc() as { paths?: Record<string, Record<string, unknown>> }
  const ops = new Set<string>()
  for (const [path, operations] of Object.entries(doc.paths ?? {})) {
    const p = normalizePath(path)
    if (!p) continue
    for (const m of Object.keys(operations)) ops.add(`${m.toUpperCase()} ${p}`)
  }
  return ops
}
