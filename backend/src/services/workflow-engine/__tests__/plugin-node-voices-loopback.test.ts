/**
 * The standalone orchestrator loads no plugin, so under the voice lock it asks
 * this container's own API to read the voices a plugin-served node will speak
 * in (POST /v1/voices/internal/node-voices, with the internal secret). Anything
 * but a 200 carrying a list of voice ids or null THROWS, and the node then
 * fails before its job exists: never an allow.
 */
import { describe, it, expect, vi } from "vitest"
import { askApiPluginNodeVoices } from "../plugin-node-voices-loopback.js"

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }))

describe("askApiPluginNodeVoices", () => {
  it("posts the node's type, data and inputs to the internal route with the internal secret, and reads the voices", async () => {
    const fetchImpl = reply(200, { voices: ["VoiceA", "VoiceB"] })

    const voices = await askApiPluginNodeVoices("voice-changer-pro", { orderedVoices: [{ voiceId: "VoiceA" }] }, { audioUrl: "https://x/a.mp3" }, fetchImpl as unknown as typeof fetch)

    expect(voices).toEqual(["VoiceA", "VoiceB"])
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/^http:\/\/localhost:\d+\/v1\/voices\/internal\/node-voices$/)
    expect(init.method).toBe("POST")
    const headers = init.headers as Record<string, string>
    expect(headers["X-Internal-Orchestrator-Secret"]).toBeTypeOf("string")
    expect(headers["X-Internal-Orchestrator-Secret"]!.length).toBeGreaterThan(0)
    expect(headers["Content-Type"]).toBe("application/json")
    expect(JSON.parse(init.body as string)).toEqual({
      type: "voice-changer-pro",
      data: { orderedVoices: [{ voiceId: "VoiceA" }] },
      inputs: { audioUrl: "https://x/a.mp3" },
    })
  })

  it("passes the API's null on (no reader is declared for the type)", async () => {
    expect(await askApiPluginNodeVoices("voice-changer-pro", {}, {}, reply(200, { voices: null }) as unknown as typeof fetch)).toBeNull()
  })

  it("throws on an error status, or an answer that is not a list of voice ids or null", async () => {
    for (const [status, body] of [
      [500, { error: { code: "internal_error" } }],
      [403, { error: { code: "forbidden" } }],
      [200, {}],
      [200, { voices: "VoiceA" }],
      [200, { voices: [1] }],
    ] as const) {
      await expect(askApiPluginNodeVoices("voice-changer-pro", {}, {}, reply(status, body) as unknown as typeof fetch)).rejects.toThrow()
    }
  })
})
