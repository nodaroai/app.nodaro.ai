/**
 * POST /v1/voices/internal/node-voices — the voice lock's door for the
 * standalone orchestrator, which runs workflows but loads no plugin. It asks
 * this route (the API process loaded the plugins) to read the voices a
 * plugin-served node will speak in, with the reader its plugin declares.
 *
 * Internal only: the internal secret's caller, never a user, an app token or
 * an API key. `{ voices: null }` = no reader declared for the type (the engine
 * then refuses the node under a lock). A reader that fails is a 500, never an
 * empty list.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { pluginNodeVoicesRoutes } from "../plugin-node-voices.js"
import { setPluginNodeVoiceReaders, _resetPluginNodeVoiceReadersForTests } from "../../lib/private-plugins/node-voices-registry.js"
import type { PluginNodeVoiceReader } from "../../lib/private-plugins/types.js"

const URL = "/v1/voices/internal/node-voices"
const internal = { "x-internal": "1" }
const slotReader: PluginNodeVoiceReader = (data) =>
  ((data.orderedVoices ?? []) as Array<{ voiceId: string } | null>).flatMap((v) => (v ? [v.voiceId] : []))

let app: FastifyInstance

beforeEach(async () => {
  _resetPluginNodeVoiceReadersForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    if (req.headers["x-internal"] === "1") req.authKind = "internal"
    if (req.headers["x-jwt"] === "1") req.authKind = "jwt"
  })
  await app.register(pluginNodeVoicesRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

const body = { type: "voice-changer-pro", data: { orderedVoices: [{ voiceId: "VoiceA" }, null, { voiceId: "VoiceB" }] }, inputs: { audioUrl: "https://x/a.mp3" } }

describe("POST /v1/voices/internal/node-voices", () => {
  it("refuses every caller but the internal one, before reading anything", async () => {
    let read = 0
    setPluginNodeVoiceReaders(new Map([["voice-changer-pro", () => (read++, ["VoiceA"])]]))

    for (const headers of [{}, { "x-user-id": "00000000-0000-4000-8000-000000000001", "x-jwt": "1" }]) {
      const res = await app.inject({ method: "POST", url: URL, headers, payload: body })
      expect(res.statusCode).toBe(403)
      expect(res.json()).toEqual({ error: { code: "forbidden", message: "Internal only" } })
    }
    expect(read).toBe(0)
  })

  it("answers the voices the declared reader reads", async () => {
    setPluginNodeVoiceReaders(new Map([["voice-changer-pro", slotReader]]))

    const res = await app.inject({ method: "POST", url: URL, headers: internal, payload: body })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ voices: ["VoiceA", "VoiceB"] })
    expect(res.headers["cache-control"]).toBe("no-store")
  })

  it("answers null when no reader is declared for the type", async () => {
    setPluginNodeVoiceReaders(new Map([["voice-changer-pro", slotReader]]))

    const res = await app.inject({ method: "POST", url: URL, headers: internal, payload: { ...body, type: "some-other-node" } })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ voices: null })
  })

  it("is a 500 when the reader fails or answers something that is not a list of voice ids", async () => {
    for (const reader of [
      () => {
        throw new Error("reader bug")
      },
      () => "VoiceA",
    ] as unknown as PluginNodeVoiceReader[]) {
      setPluginNodeVoiceReaders(new Map([["voice-changer-pro", reader]]))
      const res = await app.inject({ method: "POST", url: URL, headers: internal, payload: body })
      expect(res.statusCode).toBe(500)
      expect(res.json()).not.toHaveProperty("voices")
    }
  })

  it("refuses a malformed body with a 400", async () => {
    setPluginNodeVoiceReaders(new Map([["voice-changer-pro", slotReader]]))
    for (const payload of [{}, { type: "", data: {}, inputs: {} }, { type: "voice-changer-pro", data: [], inputs: {} }, { type: "voice-changer-pro", data: {} }]) {
      const res = await app.inject({ method: "POST", url: URL, headers: internal, payload })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
  })
})
