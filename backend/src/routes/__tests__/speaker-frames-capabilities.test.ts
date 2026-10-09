import { describe, it, expect, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { speakerFramesCapabilitiesRoutes as routes } from "../speaker-frames-capabilities.js"
import { setPluginSupports, getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { speakerFramesRelaySupport, _resetSpeakerFramesRelaySupportForTests } from "../../lib/private-plugins/speaker-frames-relay-support.js"

/** GET /v1/speaker-frames/capabilities — what a connected self-host asks before it relays Speaker Frames. */
let app: FastifyInstance

async function build(): Promise<void> {
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") (req as { userId?: string }).userId = header
  })
  // nodaro.ai: read the loaded plugin's declaration at request time.
  await app.register(routes, {
    support: () =>
      speakerFramesRelaySupport({
        hasCredits: () => true,
        getPluginSupports,
        isNodaroConnected: async () => false,
        cloudFetch: async () => new Response("", { status: 500 }),
        now: () => 0,
      }),
  })
  await app.ready()
}

afterEach(async () => {
  setPluginSupports({})
  _resetSpeakerFramesRelaySupportForTests()
  await app.close()
})

describe("GET /v1/speaker-frames/capabilities", () => {
  it("answers the loaded plugin's declaration, read at request time", async () => {
    await build()
    const before = await app.inject({ method: "GET", url: "/v1/speaker-frames/capabilities", headers: { "x-user-id": "u" } })
    expect(before.statusCode).toBe(200)
    expect(before.json()).toEqual({ relay: false, source: "server" })
    setPluginSupports({ speakerFramesRelayedProxies: true })
    const after = await app.inject({ method: "GET", url: "/v1/speaker-frames/capabilities", headers: { "x-user-id": "u" } })
    expect(after.json()).toEqual({ relay: true, source: "server" })
    expect(after.headers["cache-control"]).toBe("private, no-store")
  })

  it("asks for authentication", async () => {
    await build()
    const res = await app.inject({ method: "GET", url: "/v1/speaker-frames/capabilities" })
    expect(res.statusCode).toBe(401)
  })
})
