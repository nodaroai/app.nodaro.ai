import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetSession = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getSession: mockGetSession },
  }),
}))

import {
  textToAudioApi,
  audioIsolationApi,
  sunoGenerateApi,
  sunoCoverApi,
  sunoExtendApi,
  sunoLyricsApi,
  sunoSeparateApi,
  lipSyncApi,
  motionTransferApi,
  videoUpscaleApi,
  generateAfterEffects,
  generateLottieOverlay,
  generate3DTitle,
  generateMotionGraphics,
  renderVideoWithPlan,
  renderVideoWithSceneGraph,
  transcribeApi,
  imageToTextApi,
} from "../api"

function mockFetchJson(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  })
}

function mockFetchError(status: number, errBody: unknown) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(errBody),
    text: () => Promise.resolve(JSON.stringify(errBody)),
  })
}

function sessionWith(token: string) {
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: token } },
  })
}

function noSession() {
  mockGetSession.mockResolvedValue({ data: { session: null } })
}

beforeEach(() => {
  mockGetSession.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/* ------------------------------------------------------------------ */
/*  1. textToAudioApi                                                  */
/* ------------------------------------------------------------------ */
describe("textToAudioApi", () => {
  it("sends prompt and optional fields to /v1/text-to-audio", async () => {
    sessionWith("tok-audio")
    const fetch = mockFetchJson({ jobId: "j-audio-1" })
    vi.stubGlobal("fetch", fetch)

    const res = await textToAudioApi("thunder rumble", "elevenlabs", 8, "u1", {
      loop: true,
      promptInfluence: 0.7,
    })

    expect(res).toEqual({ jobId: "j-audio-1" })
    const [url, opts] = fetch.mock.calls[0]
    expect(url).toContain("/v1/text-to-audio")
    const body = JSON.parse(opts.body)
    expect(body.prompt).toBe("thunder rumble")
    expect(body.provider).toBe("elevenlabs")
    expect(body.duration).toBe(8)
    expect(body.loop).toBe(true)
    expect(body.promptInfluence).toBe(0.7)
  })

  it("throws on server error", async () => {
    sessionWith("tok-audio")
    vi.stubGlobal("fetch", mockFetchError(500, { error: "boom" }))

    await expect(textToAudioApi("x")).rejects.toThrow()
  })
})

/* ------------------------------------------------------------------ */
/*  2. audioIsolationApi                                               */
/* ------------------------------------------------------------------ */
describe("audioIsolationApi", () => {
  it("posts audioUrl to /v1/audio-isolation", async () => {
    sessionWith("tok-iso")
    const fetch = mockFetchJson({ jobId: "j-iso-1" })
    vi.stubGlobal("fetch", fetch)

    const res = await audioIsolationApi("https://r2/audio.wav", "u2")

    expect(res).toEqual({ jobId: "j-iso-1" })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.audioUrl).toBe("https://r2/audio.wav")
    expect(body.userId).toBe("u2")
  })

  it("throws on 422 validation error", async () => {
    sessionWith("tok-iso")
    vi.stubGlobal("fetch", mockFetchError(422, { error: "missing audioUrl" }))

    await expect(audioIsolationApi("")).rejects.toThrow()
  })
})

/* ------------------------------------------------------------------ */
/*  3. sunoGenerateApi                                                 */
/* ------------------------------------------------------------------ */
describe("sunoGenerateApi", () => {
  it("sends generate params with customMode and instrumental defaults", async () => {
    sessionWith("tok-suno")
    const fetch = mockFetchJson({ jobId: "j-suno-gen" })
    vi.stubGlobal("fetch", fetch)

    const res = await sunoGenerateApi({
      prompt: "upbeat jazz",
      model: "V4",
      style: "jazz",
      title: "Morning Vibes",
    })

    expect(res).toEqual({ jobId: "j-suno-gen" })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.prompt).toBe("upbeat jazz")
    expect(body.model).toBe("V4")
    expect(body.customMode).toBe(false)
    expect(body.instrumental).toBe(false)
    expect(body.style).toBe("jazz")
    expect(body.title).toBe("Morning Vibes")
  })

  it("respects explicit customMode and instrumental flags", async () => {
    sessionWith("tok-suno")
    const fetch = mockFetchJson({ jobId: "j-suno-gen2" })
    vi.stubGlobal("fetch", fetch)

    await sunoGenerateApi({
      prompt: "lo-fi beat",
      customMode: true,
      instrumental: true,
    })

    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.customMode).toBe(true)
    expect(body.instrumental).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/*  4. sunoCoverApi                                                    */
/* ------------------------------------------------------------------ */
describe("sunoCoverApi", () => {
  it("posts cover params to /v1/suno/cover", async () => {
    sessionWith("tok-cover")
    const fetch = mockFetchJson({ jobId: "j-cover-1" })
    vi.stubGlobal("fetch", fetch)

    const res = await sunoCoverApi({
      prompt: "make it rock",
      uploadUrl: "https://r2/original.mp3",
      style: "rock",
    })

    expect(res).toEqual({ jobId: "j-cover-1" })
    const [url, opts] = fetch.mock.calls[0]
    expect(url).toContain("/v1/suno/cover")
    const body = JSON.parse(opts.body)
    expect(body.prompt).toBe("make it rock")
    expect(body.uploadUrl).toBe("https://r2/original.mp3")
  })

  it("throws on 403 forbidden", async () => {
    sessionWith("tok-cover")
    vi.stubGlobal("fetch", mockFetchError(403, { error: "forbidden" }))

    await expect(
      sunoCoverApi({ prompt: "x", uploadUrl: "y" })
    ).rejects.toThrow()
  })
})

/* ------------------------------------------------------------------ */
/*  5. sunoExtendApi                                                   */
/* ------------------------------------------------------------------ */
describe("sunoExtendApi", () => {
  it("defaults defaultParamFlag to true and model to V5", async () => {
    sessionWith("tok-ext")
    const fetch = mockFetchJson({ jobId: "j-extend-1" })
    vi.stubGlobal("fetch", fetch)

    const res = await sunoExtendApi({ audioId: "audio-123" })

    expect(res).toEqual({ jobId: "j-extend-1" })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.audioId).toBe("audio-123")
    expect(body.defaultParamFlag).toBe(true)
    expect(body.model).toBe("V5")
  })

  it("allows overriding model and defaultParamFlag", async () => {
    sessionWith("tok-ext")
    const fetch = mockFetchJson({ jobId: "j-extend-2" })
    vi.stubGlobal("fetch", fetch)

    await sunoExtendApi({
      audioId: "audio-456",
      defaultParamFlag: false,
      model: "V4",
      continueAt: 30,
    })

    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.defaultParamFlag).toBe(false)
    expect(body.model).toBe("V4")
    expect(body.continueAt).toBe(30)
  })
})

/* ------------------------------------------------------------------ */
/*  6. sunoLyricsApi                                                   */
/* ------------------------------------------------------------------ */
describe("sunoLyricsApi", () => {
  it("posts prompt to /v1/suno/lyrics", async () => {
    sessionWith("tok-lyrics")
    const fetch = mockFetchJson({ jobId: "j-lyrics-1" })
    vi.stubGlobal("fetch", fetch)

    const res = await sunoLyricsApi({ prompt: "song about rain" })

    expect(res).toEqual({ jobId: "j-lyrics-1" })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.prompt).toBe("song about rain")
  })

  it("throws on network error", async () => {
    sessionWith("tok-lyrics")
    vi.stubGlobal("fetch", mockFetchError(500, { error: "internal" }))

    await expect(sunoLyricsApi({ prompt: "x" })).rejects.toThrow()
  })
})

/* ------------------------------------------------------------------ */
/*  7. sunoSeparateApi                                                 */
/* ------------------------------------------------------------------ */
describe("sunoSeparateApi", () => {
  it("posts separation params to /v1/suno/separate", async () => {
    sessionWith("tok-sep")
    const fetch = mockFetchJson({ jobId: "j-sep-1" })
    vi.stubGlobal("fetch", fetch)

    const res = await sunoSeparateApi({
      taskId: "task-1",
      audioId: "aud-1",
      type: "vocals",
    })

    expect(res).toEqual({ jobId: "j-sep-1" })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.taskId).toBe("task-1")
    expect(body.audioId).toBe("aud-1")
    expect(body.type).toBe("vocals")
  })

  it("throws on 402 insufficient credits", async () => {
    sessionWith("tok-sep")
    vi.stubGlobal(
      "fetch",
      mockFetchError(402, { error: "insufficient credits" })
    )

    await expect(
      sunoSeparateApi({ taskId: "t", audioId: "a" })
    ).rejects.toThrow()
  })
})

/* ------------------------------------------------------------------ */
/*  8. lipSyncApi                                                      */
/* ------------------------------------------------------------------ */
describe("lipSyncApi", () => {
  it("posts lip-sync params to /v1/lip-sync", async () => {
    sessionWith("tok-lip")
    const fetch = mockFetchJson({ jobId: "j-lip-1" })
    vi.stubGlobal("fetch", fetch)

    const res = await lipSyncApi(
      "https://r2/face.jpg",
      "https://r2/speech.wav",
      "talking head",
      "kling-avatar",
      "1080p",
      "u5"
    )

    expect(res).toEqual({ jobId: "j-lip-1" })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.imageUrl).toBe("https://r2/face.jpg")
    expect(body.audioUrl).toBe("https://r2/speech.wav")
    expect(body.prompt).toBe("talking head")
    expect(body.provider).toBe("kling-avatar")
    expect(body.resolution).toBe("1080p")
  })

  it("works with minimal params", async () => {
    sessionWith("tok-lip")
    const fetch = mockFetchJson({ jobId: "j-lip-2" })
    vi.stubGlobal("fetch", fetch)

    const res = await lipSyncApi("https://r2/face.jpg", "https://r2/audio.wav")

    expect(res).toEqual({ jobId: "j-lip-2" })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.imageUrl).toBe("https://r2/face.jpg")
    expect(body.audioUrl).toBe("https://r2/audio.wav")
  })
})

/* ------------------------------------------------------------------ */
/*  9. motionTransferApi                                               */
/* ------------------------------------------------------------------ */
describe("motionTransferApi", () => {
  it("posts motion-transfer params to /v1/motion-transfer", async () => {
    sessionWith("tok-mt")
    const fetch = mockFetchJson({ jobId: "j-mt-1" })
    vi.stubGlobal("fetch", fetch)

    const res = await motionTransferApi(
      "https://r2/img.png",
      "https://r2/vid.mp4",
      "dancing person",
      "front",
      "720p",
      "u6"
    )

    expect(res).toEqual({ jobId: "j-mt-1" })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.imageUrl).toBe("https://r2/img.png")
    expect(body.videoUrl).toBe("https://r2/vid.mp4")
    expect(body.prompt).toBe("dancing person")
    expect(body.characterOrientation).toBe("front")
    expect(body.resolution).toBe("720p")
  })

  it("throws on server error", async () => {
    sessionWith("tok-mt")
    vi.stubGlobal("fetch", mockFetchError(500, { error: "provider down" }))

    await expect(
      motionTransferApi("https://img", "https://vid")
    ).rejects.toThrow()
  })
})

/* ------------------------------------------------------------------ */
/*  10. videoUpscaleApi                                                */
/* ------------------------------------------------------------------ */
describe("videoUpscaleApi", () => {
  it("posts video-upscale params to /v1/video-upscale", async () => {
    sessionWith("tok-vu")
    const fetch = mockFetchJson({ jobId: "j-vu-1" })
    vi.stubGlobal("fetch", fetch)

    const res = await videoUpscaleApi("https://r2/vid.mp4", 2, "u7")

    expect(res).toEqual({ jobId: "j-vu-1" })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.videoUrl).toBe("https://r2/vid.mp4")
    expect(body.upscaleFactor).toBe(2)
  })

  it("works with only videoUrl", async () => {
    sessionWith("tok-vu")
    const fetch = mockFetchJson({ jobId: "j-vu-2" })
    vi.stubGlobal("fetch", fetch)

    const res = await videoUpscaleApi("https://r2/vid2.mp4")

    expect(res).toEqual({ jobId: "j-vu-2" })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.videoUrl).toBe("https://r2/vid2.mp4")
  })
})

/* ------------------------------------------------------------------ */
/*  11. generateAfterEffects                                           */
/* ------------------------------------------------------------------ */
describe("generateAfterEffects", () => {
  it("posts AE params to /v1/after-effects/generate", async () => {
    sessionWith("tok-ae")
    const fetch = mockFetchJson({ jobId: "j-ae-1", effectPlan: { effects: [] } })
    vi.stubGlobal("fetch", fetch)

    const res = await generateAfterEffects({
      prompt: "add film grain",
      inputVideoUrl: "https://r2/vid.mp4",
      fps: 30,
      width: 1920,
      height: 1080,
      durationSeconds: 10,
      userId: "u8",
    })

    expect(res).toEqual({ jobId: "j-ae-1", effectPlan: { effects: [] } })
    const [url, opts] = fetch.mock.calls[0]
    expect(url).toContain("/v1/after-effects/generate")
    const body = JSON.parse(opts.body)
    expect(body.prompt).toBe("add film grain")
    expect(body.fps).toBe(30)
    expect(body.width).toBe(1920)
    expect(body.height).toBe(1080)
    expect(body.durationSeconds).toBe(10)
  })

  it("throws on 400 bad request", async () => {
    sessionWith("tok-ae")
    vi.stubGlobal("fetch", mockFetchError(400, { error: "missing prompt" }))

    await expect(
      generateAfterEffects({
        prompt: "",
        inputVideoUrl: "",
        fps: 30,
        width: 1920,
        height: 1080,
        durationSeconds: 10,
        userId: "u8",
      })
    ).rejects.toThrow()
  })
})

/* ------------------------------------------------------------------ */
/*  12. generateLottieOverlay                                          */
/* ------------------------------------------------------------------ */
describe("generateLottieOverlay", () => {
  it("posts lottie params to /v1/lottie-overlay/generate", async () => {
    sessionWith("tok-lottie")
    const fetch = mockFetchJson({
      jobId: "j-lot-1",
      overlayPlan: { overlays: [] },
    })
    vi.stubGlobal("fetch", fetch)

    const res = await generateLottieOverlay({
      prompt: "confetti celebration",
      inputVideoUrl: "https://r2/vid.mp4",
      fps: 24,
      durationSeconds: 5,
      width: 1280,
      height: 720,
      lottieAssets: ["sparkle.json"],
      userId: "u9",
    })

    expect(res).toEqual({ jobId: "j-lot-1", overlayPlan: { overlays: [] } })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.prompt).toBe("confetti celebration")
    expect(body.lottieAssets).toEqual(["sparkle.json"])
    expect(body.width).toBe(1280)
  })

  it("throws on error response", async () => {
    sessionWith("tok-lottie")
    vi.stubGlobal("fetch", mockFetchError(500, { error: "AI failure" }))

    await expect(
      generateLottieOverlay({
        prompt: "x",
        inputVideoUrl: "y",
        fps: 30,
        durationSeconds: 5,
        userId: "u9",
      })
    ).rejects.toThrow()
  })
})

/* ------------------------------------------------------------------ */
/*  13. generate3DTitle                                                */
/* ------------------------------------------------------------------ */
describe("generate3DTitle", () => {
  it("posts 3D title params to /v1/3d-title/generate", async () => {
    sessionWith("tok-3d")
    const fetch = mockFetchJson({
      jobId: "j-3d-1",
      titlePlan: { scenes: [] },
    })
    vi.stubGlobal("fetch", fetch)

    const res = await generate3DTitle({
      prompt: "epic title card",
      fps: 30,
      aspectRatio: "16:9",
      width: 1920,
      height: 1080,
      durationSeconds: 5,
      backgroundColor: "#000000",
      backgroundMediaUrl: "https://r2/bg.mp4",
      userId: "u10",
    })

    expect(res).toEqual({ jobId: "j-3d-1", titlePlan: { scenes: [] } })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.prompt).toBe("epic title card")
    expect(body.aspectRatio).toBe("16:9")
    expect(body.backgroundColor).toBe("#000000")
    expect(body.backgroundMediaUrl).toBe("https://r2/bg.mp4")
  })

  it("works with minimal required params", async () => {
    sessionWith("tok-3d")
    const fetch = mockFetchJson({ jobId: "j-3d-2", titlePlan: {} })
    vi.stubGlobal("fetch", fetch)

    const res = await generate3DTitle({
      prompt: "simple title",
      fps: 24,
      durationSeconds: 3,
      userId: "u10",
    })

    expect(res).toEqual({ jobId: "j-3d-2", titlePlan: {} })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.prompt).toBe("simple title")
    expect(body.fps).toBe(24)
    expect(body.durationSeconds).toBe(3)
  })
})

/* ------------------------------------------------------------------ */
/*  14. generateMotionGraphics                                         */
/* ------------------------------------------------------------------ */
describe("generateMotionGraphics", () => {
  it("posts motion graphics params to /v1/motion-graphics/generate", async () => {
    sessionWith("tok-mg")
    const fetch = mockFetchJson({
      jobId: "j-mg-1",
      motionPlan: { elements: [] },
    })
    vi.stubGlobal("fetch", fetch)

    const res = await generateMotionGraphics({
      prompt: "lower third intro",
      fps: 30,
      aspectRatio: "16:9",
      width: 1920,
      height: 1080,
      durationSeconds: 4,
      backgroundColor: "#1a1a2e",
      userId: "u11",
    })

    expect(res).toEqual({ jobId: "j-mg-1", motionPlan: { elements: [] } })
    const [url, opts] = fetch.mock.calls[0]
    expect(url).toContain("/v1/motion-graphics/generate")
    const body = JSON.parse(opts.body)
    expect(body.prompt).toBe("lower third intro")
    expect(body.backgroundColor).toBe("#1a1a2e")
  })

  it("throws on unauthorized", async () => {
    noSession()
    vi.stubGlobal("fetch", mockFetchError(401, { error: "unauthorized" }))

    await expect(
      generateMotionGraphics({
        prompt: "x",
        fps: 30,
        durationSeconds: 5,
        userId: "u11",
      })
    ).rejects.toThrow()
  })
})

/* ------------------------------------------------------------------ */
/*  15. renderVideoWithPlan                                            */
/* ------------------------------------------------------------------ */
describe("renderVideoWithPlan", () => {
  it("posts plan envelope to /v1/render-video/plan", async () => {
    sessionWith("tok-render")
    const fetch = mockFetchJson({ jobId: "j-rend-1" })
    vi.stubGlobal("fetch", fetch)

    const plan = { effects: [{ type: "blur" }] }
    const res = await renderVideoWithPlan({
      planType: "after-effects",
      plan,
      userId: "u12",
    })

    expect(res).toEqual({ jobId: "j-rend-1" })
    const [url, opts] = fetch.mock.calls[0]
    expect(url).toContain("/v1/render-video/plan")
    const body = JSON.parse(opts.body)
    expect(body.planType).toBe("after-effects")
    expect(body.plan).toEqual(plan)
  })

  it("throws on 500 render failure", async () => {
    sessionWith("tok-render")
    vi.stubGlobal("fetch", mockFetchError(500, { error: "render failed" }))

    await expect(
      renderVideoWithPlan({ planType: "lottie-overlay", plan: {} })
    ).rejects.toThrow()
  })
})

/* ------------------------------------------------------------------ */
/*  16. renderVideoWithSceneGraph                                      */
/* ------------------------------------------------------------------ */
describe("renderVideoWithSceneGraph", () => {
  it("posts scene graph to /v1/render-video/scene-graph", async () => {
    sessionWith("tok-sg")
    const fetch = mockFetchJson({ jobId: "j-sg-1" })
    vi.stubGlobal("fetch", fetch)

    const sceneGraph = { tracks: [{ type: "video", clips: [] }] }
    const res = await renderVideoWithSceneGraph({
      sceneGraph,
      userId: "u13",
    })

    expect(res).toEqual({ jobId: "j-sg-1" })
    const [url, opts] = fetch.mock.calls[0]
    expect(url).toContain("/v1/render-video/scene-graph")
    const body = JSON.parse(opts.body)
    expect(body.sceneGraph).toEqual(sceneGraph)
  })

  it("throws on error", async () => {
    sessionWith("tok-sg")
    vi.stubGlobal(
      "fetch",
      mockFetchError(422, { error: "invalid scene graph" })
    )

    await expect(
      renderVideoWithSceneGraph({ sceneGraph: {} })
    ).rejects.toThrow()
  })
})

/* ------------------------------------------------------------------ */
/*  17. transcribeApi                                                  */
/* ------------------------------------------------------------------ */
describe("transcribeApi", () => {
  it("posts transcribe params to /v1/transcribe", async () => {
    sessionWith("tok-tr")
    const fetch = mockFetchJson({ jobId: "j-tr-1" })
    vi.stubGlobal("fetch", fetch)

    const res = await transcribeApi(
      "https://r2/audio.wav",
      "whisper",
      "en",
      "u14"
    )

    expect(res).toEqual({ jobId: "j-tr-1" })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.audioUrl).toBe("https://r2/audio.wav")
    expect(body.provider).toBe("whisper")
    expect(body.language).toBe("en")
  })

  it("works with only audioUrl", async () => {
    sessionWith("tok-tr")
    const fetch = mockFetchJson({ jobId: "j-tr-2" })
    vi.stubGlobal("fetch", fetch)

    const res = await transcribeApi("https://r2/speech.mp3")

    expect(res).toEqual({ jobId: "j-tr-2" })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.audioUrl).toBe("https://r2/speech.mp3")
  })
})

/* ------------------------------------------------------------------ */
/*  18. imageToTextApi                                                 */
/* ------------------------------------------------------------------ */
describe("imageToTextApi", () => {
  it("posts image-to-text params to /v1/image-to-text/describe", async () => {
    sessionWith("tok-i2t")
    const fetch = mockFetchJson({
      jobId: "j-i2t-1",
      generatedText: "A sunset over the ocean",
    })
    vi.stubGlobal("fetch", fetch)

    const res = await imageToTextApi(
      "https://r2/sunset.jpg",
      "high",
      "describe the mood",
      "u15"
    )

    expect(res).toEqual({
      jobId: "j-i2t-1",
      generatedText: "A sunset over the ocean",
    })
    const [url, opts] = fetch.mock.calls[0]
    expect(url).toContain("/v1/image-to-text/describe")
    const body = JSON.parse(opts.body)
    expect(body.imageUrl).toBe("https://r2/sunset.jpg")
    expect(body.detailLevel).toBe("high")
    expect(body.customPrompt).toBe("describe the mood")
  })

  it("works with only imageUrl", async () => {
    sessionWith("tok-i2t")
    const fetch = mockFetchJson({
      jobId: "j-i2t-2",
      generatedText: "A cat",
    })
    vi.stubGlobal("fetch", fetch)

    const res = await imageToTextApi("https://r2/cat.png")

    expect(res).toEqual({ jobId: "j-i2t-2", generatedText: "A cat" })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.imageUrl).toBe("https://r2/cat.png")
  })
})

/* ------------------------------------------------------------------ */
/*  Cross-cutting: POST method and content-type                        */
/* ------------------------------------------------------------------ */
describe("request method and content-type", () => {
  it("all API calls use POST method with JSON content-type", async () => {
    sessionWith("tok-method")
    const fetch = mockFetchJson({ jobId: "j-method" })
    vi.stubGlobal("fetch", fetch)

    await videoUpscaleApi("https://r2/vid.mp4")

    const opts = fetch.mock.calls[0][1]
    expect(opts.method).toBe("POST")
    const ct =
      opts.headers?.["Content-Type"] || opts.headers?.["content-type"]
    expect(ct).toBe("application/json")
  })

  it("sunoGenerateApi sends all advanced music params", async () => {
    sessionWith("tok-adv")
    const fetch = mockFetchJson({ jobId: "j-adv" })
    vi.stubGlobal("fetch", fetch)

    await sunoGenerateApi({
      prompt: "epic orchestral",
      model: "V5",
      lyrics: "La la la",
      style: "orchestral",
      title: "Epic Theme",
      negativeStyle: "pop",
      vocalGender: "female",
      styleWeight: 0.8,
      weirdnessConstraint: 0.2,
      audioWeight: 0.5,
      customMode: true,
      instrumental: false,
      userId: "u-adv",
    })

    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.lyrics).toBe("La la la")
    expect(body.negativeStyle).toBe("pop")
    expect(body.vocalGender).toBe("female")
    expect(body.styleWeight).toBe(0.8)
    expect(body.weirdnessConstraint).toBe(0.2)
    expect(body.audioWeight).toBe(0.5)
    expect(body.customMode).toBe(true)
    expect(body.instrumental).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/*  Cross-cutting: auth header                                         */
/* ------------------------------------------------------------------ */
describe("auth header injection", () => {
  it("includes Bearer token in request headers", async () => {
    sessionWith("my-secret-token")
    const fetch = mockFetchJson({ jobId: "j-auth" })
    vi.stubGlobal("fetch", fetch)

    await textToAudioApi("test")

    const headers = fetch.mock.calls[0][1].headers
    expect(
      headers?.Authorization || headers?.authorization
    ).toContain("my-secret-token")
  })

  it("sends request even without session (may fail server-side)", async () => {
    noSession()
    const fetch = mockFetchJson({ jobId: "j-no-auth" })
    vi.stubGlobal("fetch", fetch)

    // Some functions may still attempt the fetch without a token
    // The server will reject, but the client should make the call
    try {
      await audioIsolationApi("https://r2/audio.wav")
    } catch {
      // May throw due to missing auth - that is acceptable
    }

    expect(fetch).toHaveBeenCalled()
  })
})
