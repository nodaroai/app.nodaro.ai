import { describe, it, expect, vi, beforeEach } from "vitest"
import { _resetRegistry } from "../tasks.js"
import { buildServer, callTool, executeSession, stubRoute } from "../tools/__tests__/_helpers.js"

/**
 * The MCP `transcribe` tool (Nemotron 3.5 Transcribe, 2026-11-12): it runs
 * `elevenlabs-stt` unless `model` names another engine, always SENDS the engine
 * it runs (never the route's legacy fallback), and carries `target_language`
 * to the route — refusing, before anything is dispatched, a translation the
 * route would refuse.
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
  const { fastify, received } = stubRoute("POST", "/v1/transcribe", { jobId: "j-1" })
  const server = buildServer()
  registerVerbs({ server, session: executeSession(), fastify })
  return { server, received }
}

const AUDIO = "https://cdn.nodaro.ai/audio/talk.mp3"

describe("transcribe", () => {
  it("runs elevenlabs-stt when no model is named", async () => {
    const { server, received } = setup()
    const res = await callTool(server, "transcribe", { audio_url: AUDIO })
    expect(res.isError).toBeFalsy()
    expect(received.body).toMatchObject({ audioUrl: AUDIO, provider: "elevenlabs-stt" })
    expect(received.body).not.toHaveProperty("targetLanguage")
  })

  it("runs the named engine, with word timings when asked", async () => {
    const { server, received } = setup()
    await callTool(server, "transcribe", { audio_url: AUDIO, model: "nemotron-3-5-transcribe", word_timestamps: true })
    expect(received.body).toMatchObject({ provider: "nemotron-3-5-transcribe", wordTimestamps: true })
  })

  it("carries a translation to the route on Nemotron", async () => {
    const { server, received } = setup()
    await callTool(server, "transcribe", { audio_url: AUDIO, model: "nemotron-3-5-transcribe", target_language: "en" })
    expect(received.body).toMatchObject({ provider: "nemotron-3-5-transcribe", targetLanguage: "en" })
  })

  it("refuses a translation on the default engine, and beside word timings, before dispatching", async () => {
    const { server, received } = setup()
    const onDefault = await callTool(server, "transcribe", { audio_url: AUDIO, target_language: "en" })
    expect(onDefault.isError).toBe(true)
    expect(JSON.stringify(onDefault.content)).toContain("nemotron-3-5-transcribe")
    const withWords = await callTool(server, "transcribe", { audio_url: AUDIO, model: "nemotron-3-5-transcribe", target_language: "en", word_timestamps: true })
    expect(withWords.isError).toBe(true)
    expect(received.body).toBeUndefined()
  })

  it("rejects an engine the route does not take, and a language Nemotron does not translate into", async () => {
    const { server } = setup()
    expect((await callTool(server, "transcribe", { audio_url: AUDIO, model: "deepgram" })).isError).toBe(true)
    expect((await callTool(server, "transcribe", { audio_url: AUDIO, model: "nemotron-3-5-transcribe", target_language: "vi" })).isError).toBe(true)
  })
})
