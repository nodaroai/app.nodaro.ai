import { describe, it, expect, vi, afterEach } from "vitest"
import type { FastifyInstance } from "fastify"

/**
 * GET /v1/billing/plans exists only where credits exist (Nodaro Cloud): it
 * lives in the ee billing routes, which app.ts registers under hasCredits().
 * On Community and Business the path is not registered at all — a 404, and
 * never a 401, since it is a public route.
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

async function plansStatus(credits: boolean): Promise<{ status: number; code?: string }> {
  edition.credits = credits
  const { buildApp } = await import("../../../app.js")
  app = await buildApp()
  const res = await app.inject({ method: "GET", url: "/v1/billing/plans" })
  return { status: res.statusCode, code: res.json()?.error?.code }
}

describe("GET /v1/billing/plans is a Cloud route", () => {
  it("is not registered on an edition without credits", async () => {
    expect((await plansStatus(false)).status).toBe(404)
  }, 60_000)

  it("is registered, and public, on Cloud", async () => {
    // No Stripe key in tests: the route answers its own 503, which proves it
    // was registered and that no credential was asked for.
    expect(await plansStatus(true)).toEqual({ status: 503, code: "stripe_not_configured" })
  }, 60_000)
})
