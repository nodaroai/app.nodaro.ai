import { describe, it, expect, vi, afterEach } from "vitest"
import type { FastifyInstance } from "fastify"

/**
 * The editor-project routes exist only on Nodaro Cloud (registered under
 * isCloud() in app.ts): on any other edition every one of them is a 404.
 */

const edition = vi.hoisted(() => ({ cloud: true }))
/** An internal caller acting for a user: how this test reaches a route through the real auth hook. */
const SECRET = vi.hoisted(() => "editor-projects-registration-secret-0123456789")

vi.mock("@/lib/config.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/config.js")>()
  return {
    ...real,
    config: { ...real.config, INTERNAL_ORCHESTRATOR_SECRET: SECRET },
    isCloud: () => edition.cloud,
    isCommunity: () => !edition.cloud,
    isBusiness: () => false,
    hasCredits: () => edition.cloud,
    hasAdmin: () => edition.cloud,
  }
})

// A deployment with its private bucket (the fake): the save's own checks run.
vi.mock("@/ee/lib/editor-projects/bucket.js", async () => ({
  editorProjectsStore: (await import("./editor-projects-fakes.js")).fakeEditorProjectsStore,
}))

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

const ID = "00000000-0000-4000-8000-0000000000a1"
const ROUTES = [
  ["GET", "/v1/editor-projects"],
  ["POST", "/v1/editor-projects"],
  ["GET", `/v1/editor-projects/${ID}`],
  ["PATCH", `/v1/editor-projects/${ID}`],
  ["DELETE", `/v1/editor-projects/${ID}`],
  ["POST", `/v1/editor-projects/${ID}/claim`],
  ["POST", `/v1/editor-projects/${ID}/release`],
  ["GET", `/v1/editor-projects/${ID}/file`],
  ["PUT", `/v1/editor-projects/${ID}/file`],
  ["PATCH", `/v1/editor-projects/${ID}/file`],
] as const

async function boot(cloud: boolean): Promise<FastifyInstance> {
  edition.cloud = cloud
  const { buildApp } = await import("../../../app.js")
  app = await buildApp()
  return app
}

describe("editor-project route registration", () => {
  it("the routes are not registered on a community edition", async () => {
    const built = await boot(false)
    // Asked of the router itself: the auth hook answers an anonymous request
    // 401 before the not-found handler, on any path.
    for (const [method, url] of ROUTES) {
      expect(built.hasRoute({ method, url: url.replace(ID, ":id") }), `${method} ${url}`).toBe(false)
    }
  }, 60_000)

  it("the routes are registered on Cloud, and need a signed-in caller", async () => {
    const built = await boot(true)
    for (const [method, url] of ROUTES) {
      expect(built.hasRoute({ method, url: url.replace(ID, ":id") }), `${method} ${url}`).toBe(true)
    }
    const res = await built.inject({ method: "GET", url: "/v1/editor-projects" })
    expect(res.statusCode).toBe(401)
  }, 60_000)

  it("on the real app, a gzip save reaches its own checks: a malformed id is 404, an over-limit body 413", async () => {
    const built = await boot(true)
    const headers = {
      "x-internal-orchestrator-secret": SECRET,
      "x-internal-user-id": "00000000-0000-4000-8000-000000000001",
      "content-type": "application/gzip",
      "x-holder": "tab-aaaa-1111",
      "x-content-hash": "a".repeat(64),
    }
    const { gzipSync } = await import("node:zlib")
    const notFound = await built.inject({ method: "PUT", url: "/v1/editor-projects/not-a-uuid/file", headers, payload: gzipSync("{}") })
    expect(notFound.statusCode).toBe(404)
    expect(notFound.json()).toEqual({ error: "not_found" })
    const tooLarge = await built.inject({ method: "PUT", url: `/v1/editor-projects/${ID}/file`, headers, payload: Buffer.alloc(5 * 1024 * 1024 + 1) })
    expect(tooLarge.statusCode).toBe(413)
    expect(tooLarge.json()).toEqual({ error: "too_large" })
    const patchTooLarge = await built.inject({
      method: "PATCH",
      url: `/v1/editor-projects/${ID}/file`,
      headers: { ...headers, "x-base-hash": "b".repeat(64) },
      payload: Buffer.alloc(1024 * 1024 + 1),
    })
    expect(patchTooLarge.statusCode).toBe(413)
  }, 60_000)

  it("on the real app, an anonymous call is 401 in the general envelope; a save with no content type, or one no parser takes, is 415 in the framework's shape", async () => {
    const built = await boot(true)
    const anonymous = await built.inject({ method: "GET", url: "/v1/editor-projects" })
    expect(anonymous.statusCode).toBe(401)
    expect(anonymous.json()).toMatchObject({ error: { code: "unauthorized" } })
    const headers = {
      "x-internal-orchestrator-secret": SECRET,
      "x-internal-user-id": "00000000-0000-4000-8000-000000000001",
      "x-holder": "tab-aaaa-1111",
      "x-content-hash": "a".repeat(64),
    }
    const put = (contentType?: string) =>
      built.inject({
        method: "PUT",
        url: `/v1/editor-projects/${ID}/file`,
        headers: contentType ? { ...headers, "content-type": contentType } : headers,
        payload: Buffer.from("x"),
      })
    for (const contentType of [undefined, "application/x-something"]) {
      const res = await put(contentType)
      expect(res.statusCode, String(contentType)).toBe(415)
      expect(res.json(), String(contentType)).toMatchObject({ statusCode: 415, code: "FST_ERR_CTP_INVALID_MEDIA_TYPE" })
    }
    // A type the app does parse (text, JSON) reaches the route, which takes only gzip bytes.
    const text = await put("text/plain")
    expect(text.statusCode).toBe(400)
    expect(text.json()).toEqual({ error: "invalid_gzip" })
  }, 60_000)
})
