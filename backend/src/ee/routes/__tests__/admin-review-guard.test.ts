import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Static guards on the review surface (spec §11.1). Every one of these is the
 * shape of a specific hole, and every one is invisible to a behavioural test
 * that only exercises the routes it remembered to write.
 */
const ROUTE_FILE = resolve(__dirname, "..", "admin-review.ts")
const SRC = readFileSync(ROUTE_FILE, "utf8")
const APP_TS = readFileSync(resolve(__dirname, "..", "..", "..", "app.ts"), "utf8")

/** Every `app.get(...)` / `app.post(...)` call, with the ~200 chars that follow
 *  it — enough to carry the route's options object. */
function routeDeclarations(src: string): { verb: string; path: string; window: string }[] {
  const out: { verb: string; path: string; window: string }[] = []
  for (const m of src.matchAll(/app\.(get|post)(?:<[^>]*>)?\(\s*\n?\s*"([^"]+)"/g)) {
    out.push({
      verb: m[1],
      path: m[2],
      window: src.slice(m.index ?? 0, (m.index ?? 0) + 400),
    })
  }
  return out
}

describe("admin-review route guards", () => {
  it("declares all six review routes", () => {
    const paths = routeDeclarations(SRC).map((r) => `${r.verb.toUpperCase()} ${r.path}`)
    expect(paths.sort()).toEqual([
      "GET /v1/admin/review/decisions",
      "GET /v1/admin/review/jobs",
      "GET /v1/admin/review/jobs/:jobId",
      "GET /v1/admin/review/jobs/:jobId/output/:index",
      "POST /v1/admin/review/jobs/:jobId/approve",
      "POST /v1/admin/review/jobs/:jobId/reject",
    ])
  })

  it("every route carries a preHandler (D27: requireAdmin, on all six)", () => {
    const routes = routeDeclarations(SRC)
    expect(routes.length).toBeGreaterThanOrEqual(6)
    const naked = routes.filter((r) => !/preHandler:\s*requireAdmin/.test(r.window))
    expect(naked.map((r) => `${r.verb} ${r.path}`)).toEqual([])
  })

  it("never mints a public URL for held media", () => {
    // The hold's whole promise is "this output is not exposed". A public URL
    // survives the review in browser history, in the referrer chain and in a
    // screenshot — and `r2KeyFromOurUrl` is lossy in the other direction (D7).
    expect(SRC).not.toMatch(/\br2Url\s*\(/)
    expect(SRC).not.toContain("R2_PUBLIC_URL")
    expect(SRC).not.toMatch(/\br2KeyFromOurUrl\b/)
  })

  it("does not import workers/shared.js (eager IORedis via lib/queue.ts:5)", () => {
    expect(SRC).not.toMatch(/from\s+"[^"]*workers\/shared\.js"/)
  })

  it("streams held bytes rather than buffering them (D28)", () => {
    // `readR2Object` buffers the whole object: a 200 MB held video would be
    // 200 MB of API-process heap per reviewer looking at it.
    expect(SRC).toContain("streamR2Object")
    expect(SRC).not.toMatch(/\breadR2Object\s*\(/)
  })

  it("reads the preview key from held_objects, never from client input", () => {
    // Without this the route is an authenticated read-anything proxy over the
    // whole bucket.
    expect(SRC).toContain("held_objects")
    expect(SRC).not.toMatch(/query\.(key|url)\b/)
  })

  it("is registered in app.ts behind hasAdmin()", () => {
    expect(APP_TS).toMatch(/import\s*\{\s*adminReviewRoutes\s*\}\s*from\s*"\.\/ee\/routes\/admin-review\.js"/)
    expect(APP_TS).toMatch(/if\s*\(hasAdmin\(\)\)\s*await app\.register\(adminReviewRoutes\)/)
  })
})
