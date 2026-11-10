// @test-watches backend/src/routes/** backend/src/ee/routes/** backend/src/nodes/*/route*.ts
/**
 * TOTALITY: every route that attaches `creditGuard` runs a node the
 * availability funnel knows, or carries a documented exemption.
 *
 * `creditGuard` refuses a request whose node this deployment does not offer
 * (`nodes.allow` / `nodes.deny`, Admin → Availability). The node is the one the
 * ROUTE runs (lib/route-node-gate.ts) — it used to be the path minus `/v1/`,
 * so every nested route was asked about under a name no allowlist holds and
 * ran on a deployment that had withdrawn its node. This boots the whole app
 * (Cloud edition, `buildApp()`), finds every route whose preHandlers carry a
 * credit guard (they are marked), and holds each to a node or an exemption.
 *
 * Three kinds of guard the boot cannot see attached are pinned by hand below:
 * a guard run inside a wrapper or a handler, the community/business stubs of
 * the Cloud plugin's routes, and the plugin's own routes
 * (PLUGIN_CREDIT_GUARDED_ROUTES, checked in route-node-gate.test.ts).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import type { FastifyInstance } from "fastify"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const h = vi.hoisted(() => {
  const routes: Array<{ method: string; url: string; creditGuards: number; nodeGates: string[] }> = []
  // The marks the two guards carry (registered symbols: the same in every module).
  const CREDIT_GUARD = Symbol.for("nodaro.creditGuard")
  const NODE_GATE = Symbol.for("nodaro.nodeAvailabilityGate")
  function chain(): unknown {
    const proxy: unknown = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok, ko)
        if (prop === "single" || prop === "maybeSingle") return async () => ({ data: null, error: null })
        return () => proxy
      },
    })
    return proxy
  }
  return {
    routes,
    CREDIT_GUARD,
    NODE_GATE,
    supabase: { from: () => chain(), rpc: () => chain(), auth: { getUser: async () => ({ data: { user: null }, error: null }) } },
  }
})

vi.mock("@/lib/overlay/load.js", () => ({ loadOverlay: async () => ({ loaded: null }) }))
vi.mock("@/lib/supabase.js", () => ({ supabase: h.supabase }))
vi.mock("fastify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fastify")>()
  const make = ((...args: unknown[]) => {
    const app = (actual.default as unknown as (...a: unknown[]) => FastifyInstance)(...args)
    app.addHook("onRoute", (r) => {
      const methods = Array.isArray(r.method) ? r.method : [r.method]
      const pre: unknown[] = r.preHandler ? (Array.isArray(r.preHandler) ? r.preHandler : [r.preHandler]) : []
      const creditGuards = pre.filter((f) => typeof f === "function" && (f as unknown as Record<symbol, unknown>)[h.CREDIT_GUARD] === true).length
      const nodeGates = pre
        .map((f) => (typeof f === "function" ? (f as unknown as Record<symbol, unknown>)[h.NODE_GATE] : undefined))
        .filter((t): t is string => typeof t === "string")
      for (const method of methods) {
        if (method !== "HEAD") h.routes.push({ method, url: r.url, creditGuards, nodeGates })
      }
    })
    return app
  }) as unknown as typeof actual.default
  return { ...actual, default: make }
})

import {
  routeNodeGate,
  isKnownNodeType,
  ROUTE_NODES,
  EXEMPT_ROUTES,
  PLUGIN_CREDIT_GUARDED_ROUTES,
} from "../lib/route-node-gate.js"
import { __availabilityUniverseReadyForTests } from "../lib/availability-override.js"
import { CREDIT_GUARD } from "../middleware/credit-guard.js"
import { NODE_AVAILABILITY_GATE } from "../lib/availability-viewer.js"
import { allRouteFiles, extractRouteRegistrations, normalizePath } from "../lib/route-inventory.js"

const REPO_ROOT = join(__dirname, "..", "..", "..")

/**
 * Routes whose credit guard runs inside a wrapper preHandler or the handler —
 * invisible to the boot, so listed. 3D scene picks the Basic guard or the Pro
 * engine's own admission; 3D Render Pro hands every run to that engine's
 * admission; Extend Video one of two guards by provider; an entity approval
 * meters its optional caption through `meterOptionalSyncLlm`.
 */
const INLINE_GUARD_ROUTES = [
  "POST /v1/pro-3d-render",
  "POST /v1/3d-scene/generate",
  "POST /v1/generate-3d-scene",
  "POST /v1/3d-scene/edit",
  "POST /v1/edit-3d-scene",
  "POST /v1/extend-video",
  "POST /v1/characters/:id/approve-portrait",
  "POST /v1/creatures/:id/approve-main-image",
  "POST /v1/locations/:id/approve-main-image",
  "POST /v1/objects/:id/approve-main-image",
]

/** Route files that create more credit guards than they attach (the inline ones above, or an edition's). */
const INLINE_GUARD_FILES = [
  "backend/src/routes/3d-scene.ts",
  "backend/src/routes/character-portrait-approval.ts",
  "backend/src/routes/creature-main-image-approval.ts",
  "backend/src/routes/extend-video.ts",
  "backend/src/routes/location-main-image-approval.ts",
  "backend/src/routes/nodaro-exclusive.ts",
  "backend/src/routes/object-main-image-approval.ts",
].sort()

/** The community/business stubs of the plugin's routes (nodaro-exclusive.ts registers them only without credits). */
const EDITION_STUB_GUARDED_ROUTES = [
  "POST /v1/voice-changer-pro",
  "POST /v1/generate-video-pro",
  "POST /v1/edit-video-pro",
  "POST /v1/video-analysis",
  "POST /v1/video-audit",
  "POST /v1/edit-plan",
  "POST /v1/camera-switch",
  "POST /v1/speaker-view",
  "POST /v1/speaker-frames",
  "POST /v1/generate-video-pro/continue",
]

let app: FastifyInstance

beforeAll(async () => {
  const { buildApp } = await import("@/app.js")
  app = await buildApp()
  await app.ready()
  await __availabilityUniverseReadyForTests()
}, 120_000)

afterAll(async () => {
  await app?.close()
})

/** Problems resolving `route` — empty when it runs known nodes or is exempt. */
function unresolved(route: string): string[] {
  const gate = routeNodeGate(route, {})
  if (gate.kind === "exempt") return []
  if (gate.kind === "unclassified") return [`${route}: linked to no node (name it in lib/route-node-gate.ts, or exempt it with a reason)`]
  return gate.types.filter((t) => !isKnownNodeType(t)).map((t) => `${route}: resolves to "${t}", a node the availability funnel does not know`)
}

const guarded = () => h.routes.filter((r) => r.creditGuards > 0)
const registered = () => new Set(h.routes.map((r) => `${r.method} ${r.url}`))

describe("every credit-guarded route runs a node the availability funnel knows", () => {
  it("found the guarded routes (the boot and the marker work)", () => {
    expect(h.CREDIT_GUARD).toBe(CREDIT_GUARD)
    expect(h.NODE_GATE).toBe(NODE_AVAILABILITY_GATE)
    expect(guarded().length).toBeGreaterThan(100)
    expect(guarded().map((r) => r.url)).toEqual(expect.arrayContaining(["/v1/generate-image", "/v1/suno/generate"]))
  })

  it("every route that attaches creditGuard resolves to a node, or carries a documented exemption", () => {
    expect(guarded().flatMap((r) => unresolved(r.url))).toEqual([])
  })

  it("every route whose guard runs inside a wrapper or the handler resolves too — and is still registered", () => {
    const all = registered()
    expect(INLINE_GUARD_ROUTES.filter((r) => !all.has(r))).toEqual([])
    expect(INLINE_GUARD_ROUTES.flatMap((r) => unresolved(r.split(" ")[1]!))).toEqual([])
  })

  it("the community/business stubs of the plugin's routes resolve, and are the routes that file registers", () => {
    const src = readFileSync(join(REPO_ROOT, "backend/src/routes/nodaro-exclusive.ts"), "utf8")
    const inFile = new Set(extractRouteRegistrations(src).map((r) => `${r.method} ${r.path}`))
    expect(EDITION_STUB_GUARDED_ROUTES.filter((r) => !inFile.has(r))).toEqual([])
    expect(EDITION_STUB_GUARDED_ROUTES.flatMap((r) => unresolved(r.split(" ")[1]!))).toEqual([])
  })

  it("a route file that creates more guards than it attaches is pinned — so an inline guard is a decision made here", () => {
    const attached = new Set(guarded().map((r) => `${r.method} ${normalizePath(r.url)}`))
    const found: string[] = []
    for (const file of allRouteFiles(REPO_ROOT)) {
      // Comments name `creditGuard(` too; only code installs one.
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
      const installs = code.split("creditGuard(").length - 1
      if (installs === 0) continue
      const attachedHere = extractRouteRegistrations(code).filter((r) => attached.has(`${r.method} ${r.path}`)).length
      if (installs > attachedHere) found.push(file.slice(REPO_ROOT.length + 1).split("\\").join("/"))
    }
    expect(found.sort()).toEqual(INLINE_GUARD_FILES)
  })

  it("no route the old path derivation already named changes node (a deployment's lists keep meaning what they did)", () => {
    const changed = guarded()
      .map((r) => ({ url: r.url, derived: r.url.replace(/^\/v1\//, ""), gate: routeNodeGate(r.url, {}) }))
      .filter(({ derived }) => isKnownNodeType(derived))
      .filter(({ derived, gate }) => gate.kind !== "node" || gate.types.length !== 1 || gate.types[0] !== derived || gate.since !== 0)
      .map(({ url }) => url)
    expect(changed).toEqual([])
  })

  it("every route the tables name exists: registered here, or one of the Cloud plugin's", () => {
    const urls = new Set(h.routes.map((r) => r.url.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ":")))
    const plugin = new Set(PLUGIN_CREDIT_GUARDED_ROUTES.map((r) => r.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ":")))
    const stale = [...Object.keys(ROUTE_NODES), ...Object.keys(EXEMPT_ROUTES)]
      .filter((r) => {
        const key = r.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ":")
        return !urls.has(key) && !plugin.has(key)
      })
    expect(stale).toEqual([])
  })
})

describe("the trend run paths follow cast-swap", () => {
  it("estimate and run carry Nodaro Motion's node gate", () => {
    for (const url of ["/v1/trends/:slug/estimate", "/v1/trends/:slug/runs"]) {
      const route = h.routes.find((r) => r.method === "POST" && r.url === url)
      expect(route, url).toBeDefined()
      expect(route?.nodeGates, url).toEqual(["cast-swap"])
    }
  })
})
