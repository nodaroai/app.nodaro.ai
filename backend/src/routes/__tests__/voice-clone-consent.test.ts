/**
 * POST /v1/voice-clone/consent — the editor's consent box for a one-off voice clone (decided 2026-11-13):
 * a record of the SESSION user's consent for exactly these recordings, refused where clones are withheld.
 */
import { describe, it, expect, afterEach, beforeAll, vi } from "vitest"

vi.mock("../../lib/admin-check.js", () => ({ checkIsAdmin: async () => false, warmAdminCache: () => {} }))
import Fastify from "fastify"
import { voiceCloneConsentRoutes } from "../voice-clone-consent.js"
import { replicaConsentIsFor } from "../../lib/voice-clone-consent.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { __availabilityUniverseReadyForTests } from "../../lib/availability-override.js"

const USER = "00000000-0000-4000-8000-0000000000a1"
const REPLICA = { sourceAudioUrl: "https://media.example/s.wav", consentAudioUrl: "https://media.example/c.wav" }

async function app(userId: string | null = USER, appScopes?: string[]) {
  const a = Fastify({ logger: false })
  a.addHook("preHandler", async (req) => {
    ;(req as { userId?: string }).userId = userId ?? undefined
    if (appScopes) (req as { appAuthorization?: unknown }).appAuthorization = { scopes: appScopes }
  })
  await a.register(voiceCloneConsentRoutes)
  await a.ready()
  return a
}

beforeAll(() => __availabilityUniverseReadyForTests())
afterEach(() => {
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

describe("POST /v1/voice-clone/consent", () => {
  it("issues the session user's own record over exactly these recordings — never one for anyone else", async () => {
    const a = await app()
    const res = await a.inject({ method: "POST", url: "/v1/voice-clone/consent", payload: { ...REPLICA, userId: "someone-else" } })
    expect(res.statusCode).toBe(200)
    const record = res.json()
    expect(record.userId).toBe(USER)
    expect(replicaConsentIsFor(record, USER, REPLICA)).toBe(true)
    await a.close()
  })

  it("an OAuth app needs a :write or :execute scope: one granted only read scopes cannot consent in the account's name", async () => {
    const readOnly = await app(USER, ["workflows:read"])
    const refused = await readOnly.inject({ method: "POST", url: "/v1/voice-clone/consent", payload: REPLICA })
    expect(refused.statusCode).toBe(403)
    expect(refused.json().error.code).toBe("insufficient_scope")
    await readOnly.close()
    const writer = await app(USER, ["workflows:execute"])
    expect((await writer.inject({ method: "POST", url: "/v1/voice-clone/consent", payload: REPLICA })).statusCode).toBe(200)
    await writer.close()
  })

  it("refuses without a session, and links that are not https", async () => {
    const anon = await app(null)
    expect((await anon.inject({ method: "POST", url: "/v1/voice-clone/consent", payload: REPLICA })).statusCode).toBe(401)
    await anon.close()
    const a = await app()
    const bad = await a.inject({ method: "POST", url: "/v1/voice-clone/consent", payload: { ...REPLICA, sourceAudioUrl: "http://x/s.wav" } })
    expect(bad.statusCode).toBe(400)
    await a.close()
  })

  it("is refused where the deployment withholds one-off clones", async () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { deny: ["voice-clone-one-off"] } })
    __resetSurfaceProfileCacheForTests()
    const a = await app()
    const res = await a.inject({ method: "POST", url: "/v1/voice-clone/consent", payload: REPLICA })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("node_not_available")
    await a.close()
  })
})
