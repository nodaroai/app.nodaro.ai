import { describe, it, expect, vi, beforeEach } from "vitest"
import { _resetRegistry } from "../tasks.js"
import { buildServer, callTool, executeSession, stubRoute } from "../tools/__tests__/_helpers.js"

/**
 * `audio_isolation`, `apply_audio_fx` and `transcribe` all describe
 * `audio_asset_id` as a "Nodaro audio or video job id" — and a video is the
 * common input: isolating a voice out of a clip, reverbing a voice-over,
 * captioning. `resolveAssetId` is kind-strict, so asking it for audio refused
 * every ordinary video job with "expected audio, got job of type …". Only
 * `transcribe` had the audio-then-video fallback; the other two promised the
 * same thing and refused.
 *
 * All three now go through ONE helper (`resolveSpeechSourceUrl` in
 * tools/_speech-source.ts). What is under test is the promise, not the helper: each verb
 * takes a video job id and reaches its route with that video's URL, and a
 * failure that is NOT "wrong kind" still stops the call.
 */

const VIDEO_JOB = "11111111-1111-4111-8111-111111111111"
const VIDEO_URL = "https://cdn.nodaro.ai/videos/clip.mp4"
const AUDIO_JOB = "22222222-2222-4222-8222-222222222222"
const AUDIO_URL = "https://cdn.nodaro.ai/audio/vo.mp3"
const FOREIGN_JOB = "33333333-3333-4333-8333-333333333333"
const IMAGE_JOB = "44444444-4444-4444-8444-444444444444"

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

/** A refusal reaches the caller as a throw or as an isError result — take either. */
async function failureText(
  server: Parameters<typeof callTool>[0],
  tool: string,
  assetId: string,
): Promise<string> {
  try {
    const res = await callTool(server, tool, { audio_asset_id: assetId })
    expect(res.isError, `expected ${tool} to refuse ${assetId}`).toBe(true)
    return JSON.stringify(res.content)
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

const LANES = [
  { tool: "audio_isolation", route: "/v1/audio-isolation" },
  { tool: "apply_audio_fx", route: "/v1/audio-fx" },
  { tool: "transcribe", route: "/v1/transcribe" },
] as const

describe("audio verbs that take an 'audio or video' asset id", () => {
  it.each(LANES)("$tool resolves a VIDEO job id to its video URL", async ({ tool, route }) => {
    const { fastify, received } = stubRoute("POST", route, { jobId: "j-1" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const res = await callTool(server, tool, { audio_asset_id: VIDEO_JOB })

    expect(res.isError, JSON.stringify(res.content)).toBeFalsy()
    expect(received.body?.audioUrl).toBe(VIDEO_URL)
  })

  it.each(LANES)("$tool still resolves an AUDIO job id", async ({ tool, route }) => {
    const { fastify, received } = stubRoute("POST", route, { jobId: "j-1" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    await callTool(server, tool, { audio_asset_id: AUDIO_JOB })

    expect(received.body?.audioUrl).toBe(AUDIO_URL)
  })

  it.each(LANES)("$tool does not retry a foreign id as a video", async ({ tool, route }) => {
    const { fastify, received } = stubRoute("POST", route, { jobId: "j-1" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    expect(await failureText(server, tool, FOREIGN_JOB)).toMatch(/forbidden/i)
    expect(received.body).toBeUndefined()
  })

  it.each(LANES)("$tool refuses an image id on both attempts", async ({ tool, route }) => {
    const { fastify, received } = stubRoute("POST", route, { jobId: "j-1" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    expect(await failureText(server, tool, IMAGE_JOB)).toMatch(
      /expected video, got job of type generate-image/,
    )
    expect(received.body).toBeUndefined()
  })
})
