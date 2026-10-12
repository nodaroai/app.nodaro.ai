import { describe, it, expect, vi, beforeEach } from "vitest"
import { _resetRegistry } from "../tasks.js"
import { buildServer, callTool, executeSession, stubRoute } from "../tools/__tests__/_helpers.js"

/**
 * `pitch_tempo` takes exactly one source. An `asset_id` resolves as a VIDEO
 * first (a video keeps its picture), else as audio — including a dual-mode job
 * (voice-changer, dubbing, an earlier pitch_tempo) whose run made audio: it
 * passes the video kind check and then has no videoUrl, which must fall back
 * to its audio rather than fail.
 */

const VIDEO_JOB = "11111111-1111-4111-8111-111111111111"
const VIDEO_URL = "https://cdn.nodaro.ai/videos/clip.mp4"
const AUDIO_JOB = "22222222-2222-4222-8222-222222222222"
const AUDIO_URL = "https://cdn.nodaro.ai/audio/vo.mp3"
const FOREIGN_JOB = "33333333-3333-4333-8333-333333333333"
const IMAGE_JOB = "44444444-4444-4444-8444-444444444444"
const DUAL_AUDIO_JOB = "55555555-5555-4555-8555-555555555555"

const JOBS: Record<string, Record<string, unknown>> = {
  [VIDEO_JOB]: {
    id: VIDEO_JOB,
    user_id: "u1",
    job_type: "image-to-video",
    output_data: { videoUrl: VIDEO_URL },
  },
  [AUDIO_JOB]: {
    id: AUDIO_JOB,
    user_id: "u1",
    job_type: "text-to-speech",
    output_data: { audioUrl: AUDIO_URL },
  },
  [FOREIGN_JOB]: {
    id: FOREIGN_JOB,
    user_id: "SOMEONE-ELSE",
    job_type: "image-to-video",
    output_data: { videoUrl: VIDEO_URL },
  },
  [DUAL_AUDIO_JOB]: {
    id: DUAL_AUDIO_JOB,
    user_id: "u1",
    job_type: "voice-changer",
    output_data: { audioUrl: AUDIO_URL, inputType: "audio" },
  },
  [IMAGE_JOB]: {
    id: IMAGE_JOB,
    user_id: "u1",
    job_type: "generate-image",
    output_data: { imageUrl: "https://cdn.nodaro.ai/images/a.png" },
  },
}

vi.mock("../../supabase.js", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => ({
            data: table === "jobs" ? (JOBS[id] ?? null) : null,
            error: null,
          }),
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
  const { fastify, received } = stubRoute("POST", "/v1/pitch-tempo", { jobId: "j-1" })
  const server = buildServer()
  registerVerbs({ server, session: executeSession(), fastify })
  return { server, received }
}

describe("pitch_tempo", () => {
  it("sends a video job's URL as the video, with the settings", async () => {
    const { server, received } = setup()
    const res = await callTool(server, "pitch_tempo", { asset_id: VIDEO_JOB, semitones: 3, preserve_formants: false })
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy()
    expect(received.body).toMatchObject({ videoUrl: VIDEO_URL, semitones: 3, preserveFormants: false })
    expect(received.body?.audioUrl).toBeUndefined()
  })

  it("sends an audio job's URL as the audio", async () => {
    const { server, received } = setup()
    await callTool(server, "pitch_tempo", { asset_id: AUDIO_JOB, tempo: 0.75 })
    expect(received.body).toMatchObject({ audioUrl: AUDIO_URL, tempo: 0.75 })
    expect(received.body?.videoUrl).toBeUndefined()
  })

  it("falls back to the audio of a dual-mode job that made audio", async () => {
    const { server, received } = setup()
    const res = await callTool(server, "pitch_tempo", { asset_id: DUAL_AUDIO_JOB })
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy()
    expect(received.body?.audioUrl).toBe(AUDIO_URL)
  })

  it("passes a direct URL through", async () => {
    const { server, received } = setup()
    await callTool(server, "pitch_tempo", { audio_url: "https://cdn.nodaro.ai/a.mp3", semitones: -12 })
    expect(received.body).toMatchObject({ audioUrl: "https://cdn.nodaro.ai/a.mp3", semitones: -12 })
  })

  it.each([[{}], [{ audio_url: "https://cdn.nodaro.ai/a.mp3", video_url: "https://cdn.nodaro.ai/v.mp4" }]])(
    "refuses anything but exactly one source (%j)",
    async (args) => {
      const { server, received } = setup()
      const res = await callTool(server, "pitch_tempo", args)
      expect(res.isError).toBe(true)
      expect(received.body).toBeUndefined()
    },
  )

  it("does not retry a foreign id as audio", async () => {
    const { server, received } = setup()
    let text = ""
    try {
      const res = await callTool(server, "pitch_tempo", { asset_id: FOREIGN_JOB })
      text = JSON.stringify(res.content)
    } catch (err) {
      text = err instanceof Error ? err.message : String(err)
    }
    expect(text).toMatch(/forbidden/i)
    expect(received.body).toBeUndefined()
  })
})
