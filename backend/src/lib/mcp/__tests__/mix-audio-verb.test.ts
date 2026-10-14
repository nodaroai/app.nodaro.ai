import { describe, it, expect, vi, beforeEach } from "vitest"
import { _resetRegistry } from "../tasks.js"
import { buildServer, callTool, executeSession, stubRoute } from "../tools/__tests__/_helpers.js"

/**
 * `mix_audio.end_at`: "voice" ends the mix when the voice (the duck.under
 * track) ends, so it needs a duck — refused up front, like a bad duck.under,
 * before any job is dispatched.
 */

vi.mock("../../supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: { mcp_preferences: {} }, error: null }),
        }),
      }),
    }),
  },
}))

const { registerVerbs } = await import("../tools/verbs.js")

beforeEach(() => {
  _resetRegistry()
})

function setup() {
  const { fastify, received } = stubRoute("POST", "/v1/mix-audio", { jobId: "j-1" })
  const server = buildServer()
  registerVerbs({ server, session: executeSession(), fastify })
  return { server, received }
}

const tracks = [{ audio_url: "https://cdn.nodaro.ai/videos/cut.mp4" }, { audio_url: "https://cdn.nodaro.ai/audio/bed.mp3" }]

describe("mix_audio end_at", () => {
  it("sends endAt voice with the duck", async () => {
    const { server, received } = setup()
    const res = await callTool(server, "mix_audio", { tracks, duck: { under: 0 }, end_at: "voice" })
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy()
    expect(received.body).toMatchObject({ duck: { under: 0 }, endAt: "voice" })
  })

  it("sends no endAt when it is not given", async () => {
    const { server, received } = setup()
    await callTool(server, "mix_audio", { tracks, duck: { under: 0 } })
    expect(received.body).not.toHaveProperty("endAt")
  })

  it('refuses end_at "voice" without a duck, and dispatches nothing', async () => {
    const { server, received } = setup()
    const res = await callTool(server, "mix_audio", { tracks, end_at: "voice" })
    expect(res.isError).toBe(true)
    expect(JSON.stringify(res.content)).toContain("duck.under")
    expect(received.body).toBeUndefined()
  })
})
