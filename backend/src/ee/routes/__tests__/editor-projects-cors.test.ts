import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
import cors from "@fastify/cors"
import { gzipSync } from "node:zlib"

/**
 * The video editor calls the project routes from another origin, so the app's
 * real CORS options (`buildCorsOptions`) must let its save headers through
 * the preflight and expose the revision the file read answers with.
 */

vi.mock("@/lib/dynamic-origins.js", () => ({ isOriginAllowedDynamic: async (origin: string) => origin === ORIGIN }))
vi.mock("@/lib/supabase.js", async () => ({ supabase: (await import("./editor-projects-fakes.js")).fakeSupabase }))
vi.mock("@/ee/lib/editor-projects/bucket.js", async () => ({
  editorProjectsStore: (await import("./editor-projects-fakes.js")).fakeEditorProjectsStore,
}))

const ORIGIN = "https://tools.nodaro.ai"
const ME = "00000000-0000-4000-8000-000000000001"
const MCP_IFRAME_RE = /^https:\/\/[a-f0-9]+\.claudemcpcontent\.com$/

const { buildCorsOptions } = await import("../../../app.js")
const { editorProjectRoutes } = await import("../editor-projects.js")
const { seedProject, storage } = await import("./editor-projects-fakes.js")
// A core module (plain header names), so the app's CORS options import nothing from ee/.
const { EDITOR_PROJECT_REQUEST_HEADERS } = await import("../../../lib/editor-project-headers.js")

async function appWithCors() {
  const app = Fastify({ logger: false })
  await app.register(cors, buildCorsOptions(MCP_IFRAME_RE) as never)
  app.addHook("preHandler", async (req) => {
    if (req.method !== "OPTIONS") req.userId = ME
  })
  await app.register(editorProjectRoutes)
  await app.ready()
  return app
}

describe("editor-project routes across origins", () => {
  it("a preflight for PATCH /:id/file with the save headers succeeds from an allowed origin", async () => {
    const app = await appWithCors()
    const headers = ["authorization", "content-type", "x-holder", "x-content-hash", "x-base-hash", "x-cut-version"]
    expect([...EDITOR_PROJECT_REQUEST_HEADERS].sort()).toEqual(["x-base-hash", "x-content-hash", "x-cut-version", "x-holder"])
    const res = await app.inject({
      method: "OPTIONS",
      url: `/v1/editor-projects/${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}/file`,
      headers: { origin: ORIGIN, "access-control-request-method": "PATCH", "access-control-request-headers": headers.join(",") },
    })
    await app.close()
    expect(res.statusCode).toBeLessThan(300)
    expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN)
    const methods = String(res.headers["access-control-allow-methods"]).toUpperCase()
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) expect(methods).toContain(method)
    const allowed = String(res.headers["access-control-allow-headers"]).toLowerCase()
    for (const header of headers) expect(allowed, header).toContain(header)
  })

  it("the file read exposes x-revision to the page", async () => {
    const app = await appWithCors()
    const p = seedProject({ user_id: ME, content_hash: "a".repeat(64), revision: 4 })
    p.blob_key = `editor-projects/${ME}/${p.id}/00000000-0000-4000-8000-0000000000b1.json.gz`
    storage.objects.set(p.blob_key, { body: gzipSync("{}") })
    const res = await app.inject({ method: "GET", url: `/v1/editor-projects/${p.id}/file`, headers: { origin: ORIGIN } })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(res.headers["x-revision"]).toBe("4")
    expect(String(res.headers["access-control-expose-headers"]).toLowerCase()).toContain("x-revision")
  })
})
