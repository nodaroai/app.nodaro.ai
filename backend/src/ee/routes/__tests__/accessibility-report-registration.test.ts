import { describe, it, expect, vi, afterEach } from "vitest"
import type { FastifyInstance } from "fastify"
import { __isPublicRouteForTest as isPublicRoute, isAnonymousRoute } from "../../../middleware/auth.js"

/**
 * POST /v1/accessibility/report exists only where the statement does (Nodaro
 * Cloud, registered under hasCredits()) and takes no credential: someone who
 * cannot use the site cannot be asked to sign in to report it. Exactly that
 * path, POST only.
 */

const edition = vi.hoisted(() => ({ credits: true }))

vi.mock("@/lib/config.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/config.js")>()
  return {
    ...real,
    isCloud: () => edition.credits,
    isCommunity: () => !edition.credits,
    isBusiness: () => false,
    hasCredits: () => edition.credits,
    hasAdmin: () => edition.credits,
  }
})

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

async function reportStatus(credits: boolean): Promise<number> {
  edition.credits = credits
  const { buildApp } = await import("../../../app.js")
  app = await buildApp()
  // An empty description: a registered, public route answers its own 400.
  const res = await app.inject({ method: "POST", url: "/v1/accessibility/report", payload: { message: "" } })
  return res.statusCode
}

describe("POST /v1/accessibility/report", () => {
  it("is public at exactly that path, POST only", () => {
    expect(isPublicRoute("POST", "/v1/accessibility/report")).toBe(true)
    expect(isAnonymousRoute("POST", "/v1/accessibility/report")).toBe(true)
    expect(isPublicRoute("GET", "/v1/accessibility/report")).toBe(false)
    expect(isPublicRoute("POST", "/v1/accessibility/report/x")).toBe(false)
    expect(isPublicRoute("POST", "/v1/accessibility/reportX")).toBe(false)
  })

  it("is not registered on an edition without credits", async () => {
    expect(await reportStatus(false)).toBe(404)
  }, 60_000)

  it("is registered, and asks for no credential, on Cloud", async () => {
    expect(await reportStatus(true)).toBe(400)
  }, 60_000)
})
