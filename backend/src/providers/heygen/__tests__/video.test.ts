import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — registered before module under test
// ---------------------------------------------------------------------------

vi.mock("@/lib/config.js", () => ({
  config: { HEYGEN_API_KEY: "test-heygen-key", NODE_ENV: "test" },
}))

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import { generateAvatarVideo } from "../video.js"
import { HeygenError } from "../client.js"
import { aiAvatarUsdCost } from "@nodaro/shared"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const CREATE_RESPONSE = {
  code: 0,
  message: "success",
  data: { video_id: "vid-123", status: "waiting", output_format: "mp4" },
}

function makeStatusResponse(
  status: "waiting" | "processing" | "completed" | "failed",
  extra?: Record<string, unknown>,
) {
  return {
    code: 0,
    message: "success",
    data: {
      id: "vid-123",
      status,
      video_url: status === "completed" ? "https://cdn.heygen.com/vid-123.mp4" : undefined,
      duration: status === "completed" ? 5.5 : undefined,
      error: status === "failed" ? "Rendering failed" : undefined,
      ...extra,
    },
  }
}

// Default opts shared across tests — pollIntervalMs: 0 skips sleep
const baseOpts = {
  engine: "avatar-iv" as const,
  avatarId: "avatar-1",
  speechMode: "text" as const,
  script: "Hello world",
  voiceId: "voice-abc",
  voiceSpeed: 1.0,
  resolution: "720p" as const,
  aspectRatio: "16:9" as const,
  pollIntervalMs: 0,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateAvatarVideo", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ── Happy path ─────────────────────────────────────────────────────────

  it("happy path: POST → poll(completed) returns correct result shape", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    const result = await generateAvatarVideo(baseOpts)

    expect(result.videoUrl).toBe("https://cdn.heygen.com/vid-123.mp4")
    expect(result.durationSec).toBe(5.5)
    expect(result.meteredCost).toBe(true)

    // Cost must equal aiAvatarUsdCost("avatar-iv", "720p", 5.5)
    const expectedCost = aiAvatarUsdCost("avatar-iv", "720p", 5.5)
    expect(result.cost).toBe(expectedCost)
  })

  it("POST sends avatar_iv (underscore form) for engine avatar-iv", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    await generateAvatarVideo(baseOpts)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect((body.engine as { type: string }).type).toBe("avatar_iv")
  })

  it("POST sends avatar_v (underscore form) for engine avatar-v", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    await generateAvatarVideo({ ...baseOpts, engine: "avatar-v" })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect((body.engine as { type: string }).type).toBe("avatar_v")
  })

  it("POST sends script + voice_id + voice_settings in text mode", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    await generateAvatarVideo(baseOpts)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.script).toBe("Hello world")
    expect(body.voice_id).toBe("voice-abc")
    expect((body.voice_settings as { speed: number }).speed).toBe(1.0)
    expect(body.audio_url).toBeUndefined()
  })

  it("POST sends audio_url (not script/voice_id) in audio mode", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    await generateAvatarVideo({
      ...baseOpts,
      speechMode: "audio",
      audioUrl: "https://r2.example.com/audio.mp3",
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.audio_url).toBe("https://r2.example.com/audio.mp3")
    expect(body.script).toBeUndefined()
    expect(body.voice_id).toBeUndefined()
  })

  it("POST includes caption field when caption=true", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    await generateAvatarVideo({ ...baseOpts, caption: true })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.caption).toEqual({ file_format: "srt", style: "default" })
  })

  it("does NOT include caption field when caption=false or undefined", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    await generateAvatarVideo({ ...baseOpts, caption: false })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.caption).toBeUndefined()
  })

  it("polls until status is completed, skipping intermediate waiting/processing states", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("waiting")))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("processing")))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    const result = await generateAvatarVideo(baseOpts)
    expect(result.videoUrl).toBe("https://cdn.heygen.com/vid-123.mp4")
    // Should have called fetch 4 times: 1 POST + 3 polls
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  // ── Cost calculation ───────────────────────────────────────────────────

  it("uses the effective engine for cost calculation (not always the requested one)", async () => {
    // This test verifies cost is computed correctly with the actual engine used
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed", { duration: 3.06 })))

    const result = await generateAvatarVideo({ ...baseOpts, engine: "avatar-iv", resolution: "720p" })

    const expectedCost = aiAvatarUsdCost("avatar-iv", "720p", 3.06)
    expect(result.cost).toBe(expectedCost)
  })

  // ── Engine V → IV eligibility fallback ────────────────────────────────

  it("retries with avatar-iv when avatar-v returns 'does not support Avatar' error", async () => {
    // First POST (avatar_v) → HeyGen returns 200 + error body
    fetchMock
      .mockResolvedValueOnce(
        makeResponse({
          code: 400,
          error: {
            code: "NOT_SUPPORTED",
            message: "This avatar does not support Avatar V",
          },
        }),
      )
      // Second POST (avatar_iv) → success
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      // Poll → completed
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    const result = await generateAvatarVideo({ ...baseOpts, engine: "avatar-v" })

    expect(result.videoUrl).toBe("https://cdn.heygen.com/vid-123.mp4")

    // Second POST should have engine avatar_iv (underscore)
    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    const retryBody = JSON.parse(secondInit.body as string) as Record<string, unknown>
    expect((retryBody.engine as { type: string }).type).toBe("avatar_iv")

    // Cost should be calculated using avatar-iv rates (the effective engine)
    const expectedCost = aiAvatarUsdCost("avatar-iv", "720p", 5.5)
    expect(result.cost).toBe(expectedCost)
  })

  it("does NOT retry when a non-eligibility error occurs with avatar-v", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ error: { code: "QUOTA_EXCEEDED", message: "Quota exceeded" } }, 429),
    )

    await expect(generateAvatarVideo({ ...baseOpts, engine: "avatar-v" })).rejects.toBeInstanceOf(
      HeygenError,
    )
    // Only one fetch call (no retry)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("does NOT retry eligibility error when engine is already avatar-iv", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        error: { code: "NOT_SUPPORTED", message: "does not support Avatar V" },
      }, 400),
    )

    await expect(generateAvatarVideo({ ...baseOpts, engine: "avatar-iv" })).rejects.toBeInstanceOf(
      HeygenError,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // ── Failed status ──────────────────────────────────────────────────────

  it("throws HeygenError when status is 'failed' with error message", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("failed")))

    await expect(generateAvatarVideo(baseOpts)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof HeygenError && err.message === "Rendering failed",
    )
  })

  it("throws HeygenError with fallback message when failed status has no error field", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(
        makeResponse({
          code: 0,
          message: "success",
          data: { id: "vid-123", status: "failed" },
        }),
      )

    await expect(generateAvatarVideo(baseOpts)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof HeygenError &&
        err.message === "HeyGen video generation failed",
    )
  })

  // ── Duration guard ─────────────────────────────────────────────────────

  it("throws HeygenError when completed status is returned without a duration", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(
        makeResponse({
          code: 0,
          message: "success",
          data: {
            id: "vid-123",
            status: "completed",
            video_url: "https://cdn.heygen.com/vid-123.mp4",
            // duration intentionally omitted — must not give cost=0 (free video)
          },
        }),
      )

    await expect(generateAvatarVideo(baseOpts)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof HeygenError &&
        err.message === "HeyGen returned completed without a duration",
    )
  })

  it("throws HeygenError when completed status has duration=0", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(
        makeResponse(makeStatusResponse("completed", { duration: 0 })),
      )

    await expect(generateAvatarVideo(baseOpts)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof HeygenError &&
        err.message === "HeyGen returned completed without a duration",
    )
  })

  // ── motion_prompt filtering ────────────────────────────────────────────

  it("includes motion_prompt when engine is avatar-iv", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    await generateAvatarVideo({ ...baseOpts, engine: "avatar-iv", motionPrompt: "nod slowly" })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.motion_prompt).toBe("nod slowly")
  })

  it("omits motion_prompt when engine is avatar-v to avoid API rejection", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    await generateAvatarVideo({ ...baseOpts, engine: "avatar-v", motionPrompt: "nod slowly" })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.motion_prompt).toBeUndefined()
  })

  // ── expressiveness filtering (IV-class only, same gate as motion_prompt) ──

  it("includes expressiveness when engine is avatar-iv", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    await generateAvatarVideo({ ...baseOpts, engine: "avatar-iv", expressiveness: "high" })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.expressiveness).toBe("high")
  })

  it("omits expressiveness when engine is avatar-v (ignored/rejected for V)", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    await generateAvatarVideo({ ...baseOpts, engine: "avatar-v", expressiveness: "high" })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.expressiveness).toBeUndefined()
  })

  it("includes expressiveness in image-source mode (image is IV-class) even with engine avatar-v", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    await generateAvatarVideo({
      ...baseOpts,
      engine: "avatar-v",
      avatarSource: "image",
      imageUrl: "https://r2.example.com/portrait.png",
      expressiveness: "medium",
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.expressiveness).toBe("medium")
  })

  // ── voice_settings extra fields ───────────────────────────────────────

  it("includes pitch, volume, and locale in voice_settings when provided", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    await generateAvatarVideo({
      ...baseOpts,
      pitch: 5,
      volume: 0.8,
      locale: "en-US",
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    const vs = body.voice_settings as Record<string, unknown>
    expect(vs.pitch).toBe(5)
    expect(vs.volume).toBe(0.8)
    expect(vs.locale).toBe("en-US")
  })

  it("does not include pitch/volume/locale in voice_settings when not provided", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    await generateAvatarVideo(baseOpts)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    const vs = body.voice_settings as Record<string, unknown>
    expect(vs.pitch).toBeUndefined()
    expect(vs.volume).toBeUndefined()
    expect(vs.locale).toBeUndefined()
  })

  it("passes ttsEngine as engine_settings in voice_settings", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    const ttsEngine = {
      engine_type: "elevenlabs" as const,
      model: "eleven_turbo_v2_5" as const,
      stability: 0.6,
    }
    await generateAvatarVideo({ ...baseOpts, ttsEngine })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    const vs = body.voice_settings as Record<string, unknown>
    expect(vs.engine_settings).toEqual(ttsEngine)
  })

  it("maps camelCase ElevenLabs ttsEngine fields → snake_case (workflow-DAG path)", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    // The orchestrator's payload-builder forwards raw node data, which uses
    // camelCase (`similarityBoost` / `useSpeakerBoost`). The provider must
    // normalize these to HeyGen's snake_case keys.
    await generateAvatarVideo({
      ...baseOpts,
      ttsEngine: {
        engine_type: "elevenlabs",
        model: "eleven_v3",
        stability: 0.4,
        similarityBoost: 0.9,
        style: 0.3,
        useSpeakerBoost: true,
      } as never,
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    const vs = body.voice_settings as Record<string, unknown>
    expect(vs.engine_settings).toEqual({
      engine_type: "elevenlabs",
      model: "eleven_v3",
      stability: 0.4,
      similarity_boost: 0.9,
      style: 0.3,
      use_speaker_boost: true,
    })
    // The camelCase keys must NOT leak through to the HeyGen body.
    const settings = vs.engine_settings as Record<string, unknown>
    expect(settings.similarityBoost).toBeUndefined()
    expect(settings.useSpeakerBoost).toBeUndefined()
  })

  // ── background passthrough ────────────────────────────────────────────

  it("passes background with asset_id mapping when assetId is provided", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    await generateAvatarVideo({
      ...baseOpts,
      background: { type: "image", assetId: "bg-asset-99" },
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    const bg = body.background as Record<string, unknown>
    expect(bg.type).toBe("image")
    expect(bg.asset_id).toBe("bg-asset-99")
    expect(bg.assetId).toBeUndefined()
  })

  it("does not include background when not provided", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    await generateAvatarVideo(baseOpts)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.background).toBeUndefined()
  })

  // ── image source mode (type:"image") ───────────────────────────────────

  it("image source mode: POST sends type:image with image{type:url} and NO engine/avatar_id", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    await generateAvatarVideo({
      ...baseOpts,
      avatarSource: "image",
      imageUrl: "https://r2.example.com/portrait.png",
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.type).toBe("image")
    expect(body.image).toEqual({ type: "url", url: "https://r2.example.com/portrait.png" })
    expect(body.avatar_id).toBeUndefined()
    expect(body.engine).toBeUndefined()
    // Speech + voice settings still apply in image mode.
    expect(body.script).toBe("Hello world")
    expect(body.voice_id).toBe("voice-abc")
  })

  it("image source mode: bills at avatar-iv rate regardless of the engine opt", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    const result = await generateAvatarVideo({
      ...baseOpts,
      engine: "avatar-v", // ignored in image mode
      avatarSource: "image",
      imageUrl: "https://r2.example.com/portrait.png",
    })

    // Cost must use the avatar-iv rate (IV-class), NOT avatar-v.
    expect(result.cost).toBe(aiAvatarUsdCost("avatar-iv", "720p", 5.5))
  })

  it("image source mode: includes motion_prompt (image is IV-class)", async () => {
    fetchMock
      .mockResolvedValueOnce(makeResponse(CREATE_RESPONSE))
      .mockResolvedValueOnce(makeResponse(makeStatusResponse("completed")))

    await generateAvatarVideo({
      ...baseOpts,
      engine: "avatar-v",
      avatarSource: "image",
      imageUrl: "https://r2.example.com/portrait.png",
      motionPrompt: "slow zoom in",
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.motion_prompt).toBe("slow zoom in")
  })
})
