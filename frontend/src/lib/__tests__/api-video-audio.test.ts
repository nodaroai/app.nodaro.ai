import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock: Supabase client
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getSession: mockGetSession },
  }),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  generateVideo,
  videoToVideo,
  textToVideo,
  textToSpeech,
  generateMusicApi,
  combineVideos,
  mergeVideoAudioApi,
  trimAudioApi,
  trimVideoApi,
  transcodeVideoApi,
  speedRampApi,
  loopVideoApi,
  fadeVideoApi,
  resizeVideoApi,
  adjustVolumeApi,
  addCaptionsApi,
  mixAudioApi,
} from "../api"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// generateVideo (overloaded: positional args OR options object)
// ---------------------------------------------------------------------------

describe("generateVideo", () => {
  it("sends correct URL and body with options object (startFrameUrl mapped to imageUrl)", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const result = await generateVideo({
      startFrameUrl: "http://start.png",
      prompt: "zoom in",
      provider: "minimax",
    })

    expect(mock).toHaveBeenCalledWith(
      "/v1/generate-video",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    // startFrameUrl is mapped to imageUrl for backend backward compat
    expect(body.imageUrl).toBe("http://start.png")
    expect(body.prompt).toBe("zoom in")
    expect(body.provider).toBe("minimax")
    expect(result).toEqual({ jobId: "j1" })
  })

  it("sends options object with endFrameUrl and audioUrl", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    await generateVideo({
      startFrameUrl: "http://start.png",
      endFrameUrl: "http://end.png",
      audioUrl: "http://audio.mp3",
      prompt: "pan left",
      provider: "kling",
      duration: 10,
    })

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    // startFrameUrl mapped to imageUrl for backend backward compat
    expect(body.imageUrl).toBe("http://start.png")
    expect(body.endFrameUrl).toBe("http://end.png")
    expect(body.audioUrl).toBe("http://audio.mp3")
    expect(body.duration).toBe(10)
  })

  it("includes auth header when session exists", async () => {
    sessionWith("tok-gv")
    const mock = mockFetchJson({ jobId: "j3" })
    vi.stubGlobal("fetch", mock)

    await generateVideo({ startFrameUrl: "http://img.png" })

    const headers = mock.mock.calls[0][1].headers
    expect(headers.Authorization).toBe("Bearer tok-gv")
  })

  it("throws on error response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: { message: "Video gen failed" } }),
    )

    await expect(
      generateVideo({ startFrameUrl: "http://img.png" }),
    ).rejects.toThrow("Video gen failed")
  })
})

// ---------------------------------------------------------------------------
// videoToVideo
// ---------------------------------------------------------------------------

describe("videoToVideo", () => {
  it("sends correct URL, method, and body", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const result = await videoToVideo("http://vid.mp4", "stylize")

    expect(mock).toHaveBeenCalledWith(
      "/v1/video-to-video",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.videoUrl).toBe("http://vid.mp4")
    expect(body.prompt).toBe("stylize")
    expect(result).toEqual({ jobId: "j1" })
  })

  it("includes provider when provided", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    await videoToVideo("http://vid.mp4", "transform", "wan-2.6")

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.provider).toBe("wan-2.6")
  })

  it("throws on error response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(500, { error: { message: "V2V fail" } }),
    )

    await expect(videoToVideo("http://vid.mp4")).rejects.toThrow("V2V fail")
  })
})

// ---------------------------------------------------------------------------
// textToVideo
// ---------------------------------------------------------------------------

describe("textToVideo", () => {
  it("sends correct URL and body with prompt", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const result = await textToVideo("a cat dancing")

    expect(mock).toHaveBeenCalledWith(
      "/v1/text-to-video",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.prompt).toBe("a cat dancing")
    expect(result).toEqual({ jobId: "j1" })
  })

  it("includes provider and options when provided", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    await textToVideo("sunset", "minimax", undefined, { duration: 5 })

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.prompt).toBe("sunset")
    expect(body.provider).toBe("minimax")
    expect(body.duration).toBe(5)
  })

  it("throws on error response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: { message: "T2V fail" } }),
    )

    await expect(textToVideo("x")).rejects.toThrow("T2V fail")
  })
})

// ---------------------------------------------------------------------------
// textToSpeech
// ---------------------------------------------------------------------------

describe("textToSpeech", () => {
  it("sends correct URL and body with text", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const result = await textToSpeech("Hello world")

    expect(mock).toHaveBeenCalledWith(
      "/v1/text-to-speech",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.text).toBe("Hello world")
    expect(result).toEqual({ jobId: "j1" })
  })

  it("includes voice and options when provided", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    await textToSpeech("Hi", "Rachel", "elevenlabs", undefined, {
      stability: 0.5,
      similarityBoost: 0.8,
      speed: 1.2,
    })

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.text).toBe("Hi")
    expect(body.voice).toBe("Rachel")
    expect(body.provider).toBe("elevenlabs")
    expect(body.stability).toBe(0.5)
    expect(body.similarityBoost).toBe(0.8)
    expect(body.speed).toBe(1.2)
  })

  it("includes auth header when session exists", async () => {
    sessionWith("tok-tts")
    const mock = mockFetchJson({ jobId: "j3" })
    vi.stubGlobal("fetch", mock)

    await textToSpeech("test")

    const headers = mock.mock.calls[0][1].headers
    expect(headers.Authorization).toBe("Bearer tok-tts")
  })
})

// ---------------------------------------------------------------------------
// generateMusicApi
// ---------------------------------------------------------------------------

describe("generateMusicApi", () => {
  it("sends correct URL and body with prompt", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const result = await generateMusicApi("epic orchestral")

    expect(mock).toHaveBeenCalledWith(
      "/v1/generate-music",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.prompt).toBe("epic orchestral")
    expect(result).toEqual({ jobId: "j1" })
  })

  it("includes all optional fields", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    await generateMusicApi(
      "jazz",
      "suno",
      30,
      "jazz",
      "chill",
      true,
      "la la la",
      "http://ref.mp3",
    )

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.prompt).toBe("jazz")
    expect(body.provider).toBe("suno")
    expect(body.duration).toBe(30)
    expect(body.genre).toBe("jazz")
    expect(body.mood).toBe("chill")
    expect(body.instrumental).toBe(true)
    expect(body.lyrics).toBe("la la la")
    expect(body.referenceAudioUrl).toBe("http://ref.mp3")
  })

  it("throws on error response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: { message: "Music gen fail" } }),
    )

    await expect(generateMusicApi("x")).rejects.toThrow("Music gen fail")
  })
})

// ---------------------------------------------------------------------------
// combineVideos
// ---------------------------------------------------------------------------

describe("combineVideos", () => {
  it("sends correct URL and body with videoUrls", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const result = await combineVideos(["http://a.mp4", "http://b.mp4"])

    expect(mock).toHaveBeenCalledWith(
      "/v1/combine-videos",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.videoUrls).toEqual(["http://a.mp4", "http://b.mp4"])
    expect(result).toEqual({ jobId: "j1" })
  })

  it("includes transition and audioMode options", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    await combineVideos(
      ["http://a.mp4", "http://b.mp4"],
      "dissolve",
      1.0,
      "keep",
    )

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.transition).toBe("dissolve")
    expect(body.transitionDuration).toBe(1.0)
    expect(body.audioMode).toBe("keep")
  })

  it("throws on error response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: { message: "Combine fail" } }),
    )

    await expect(combineVideos(["http://a.mp4"])).rejects.toThrow(
      "Combine fail",
    )
  })
})

// ---------------------------------------------------------------------------
// mergeVideoAudioApi
// ---------------------------------------------------------------------------

describe("mergeVideoAudioApi", () => {
  it("sends correct URL and body with videoUrl and audioTracks", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const tracks = [
      { url: "http://audio.mp3", startTime: 0, volume: 0.8, sourceType: "audio" as const },
    ]
    const result = await mergeVideoAudioApi("http://vid.mp4", tracks)

    expect(mock).toHaveBeenCalledWith(
      "/v1/merge-video-audio",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.videoUrl).toBe("http://vid.mp4")
    expect(body.audioTracks).toEqual(tracks)
    expect(result).toEqual({ jobId: "j1" })
  })

  it("includes backgroundVolume and keepOriginalAudio", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    await mergeVideoAudioApi(
      "http://vid.mp4",
      [{ url: "http://a.mp3", startTime: 0 }],
      0.3,
      true,
    )

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.backgroundVolume).toBe(0.3)
    expect(body.keepOriginalAudio).toBe(true)
  })

  it("throws on error response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(500, { error: { message: "Merge fail" } }),
    )

    await expect(
      mergeVideoAudioApi("http://vid.mp4", [
        { url: "http://a.mp3", startTime: 0 },
      ]),
    ).rejects.toThrow("Merge fail")
  })
})

// ---------------------------------------------------------------------------
// trimAudioApi
// ---------------------------------------------------------------------------

describe("trimAudioApi", () => {
  it("sends correct URL and body with videoUrl", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const result = await trimAudioApi("http://vid.mp4")

    expect(mock).toHaveBeenCalledWith(
      "/v1/trim-audio",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.videoUrl).toBe("http://vid.mp4")
    expect(result).toEqual({ jobId: "j1" })
  })

  it("includes audioFormat and outputSilentVideo", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    await trimAudioApi("http://vid.mp4", "wav", true)

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.audioFormat).toBe("wav")
    expect(body.outputSilentVideo).toBe(true)
  })

  it("includes auth header when session exists", async () => {
    sessionWith("tok-trim-audio")
    const mock = mockFetchJson({ jobId: "j3" })
    vi.stubGlobal("fetch", mock)

    await trimAudioApi("http://vid.mp4")

    const headers = mock.mock.calls[0][1].headers
    expect(headers.Authorization).toBe("Bearer tok-trim-audio")
  })
})

// ---------------------------------------------------------------------------
// trimVideoApi
// ---------------------------------------------------------------------------

describe("trimVideoApi", () => {
  it("sends correct URL and body with videoUrl and startTime", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const result = await trimVideoApi("http://vid.mp4", 5)

    expect(mock).toHaveBeenCalledWith(
      "/v1/trim-video",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.videoUrl).toBe("http://vid.mp4")
    expect(body.startTime).toBe(5)
    expect(result).toEqual({ jobId: "j1" })
  })

  it("includes endTime when provided", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    await trimVideoApi("http://vid.mp4", 2, 10)

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.startTime).toBe(2)
    expect(body.endTime).toBe(10)
  })

  it("throws on error response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: { message: "Trim fail" } }),
    )

    await expect(trimVideoApi("http://vid.mp4", 0)).rejects.toThrow(
      "Trim fail",
    )
  })
})

// ---------------------------------------------------------------------------
// transcodeVideoApi
// ---------------------------------------------------------------------------

describe("transcodeVideoApi", () => {
  it("sends correct URL and body with videoUrl", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const result = await transcodeVideoApi("http://vid.mp4")

    expect(mock).toHaveBeenCalledWith(
      "/v1/transcode-video",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.videoUrl).toBe("http://vid.mp4")
    expect(result).toEqual({ jobId: "j1" })
  })

  it("includes codec, crf, resolution, and audioBitrate", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    await transcodeVideoApi("http://vid.mp4", "h265", 23, "1080p", "192k")

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.codec).toBe("h265")
    expect(body.crf).toBe(23)
    expect(body.resolution).toBe("1080p")
    expect(body.audioBitrate).toBe("192k")
  })

  it("throws on error response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(500, { error: { message: "Transcode fail" } }),
    )

    await expect(transcodeVideoApi("http://vid.mp4")).rejects.toThrow(
      "Transcode fail",
    )
  })
})

// ---------------------------------------------------------------------------
// speedRampApi
// ---------------------------------------------------------------------------

describe("speedRampApi", () => {
  it("sends correct URL and body", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const result = await speedRampApi("http://vid.mp4", 2.0, true)

    expect(mock).toHaveBeenCalledWith(
      "/v1/speed-ramp",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.videoUrl).toBe("http://vid.mp4")
    expect(body.speed).toBe(2.0)
    expect(body.adjustAudio).toBe(true)
    expect(result).toEqual({ jobId: "j1" })
  })

  it("includes auth header when session exists", async () => {
    sessionWith("tok-speed")
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    await speedRampApi("http://vid.mp4", 0.5, false)

    const headers = mock.mock.calls[0][1].headers
    expect(headers.Authorization).toBe("Bearer tok-speed")
  })

  it("throws on error response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: { message: "Speed fail" } }),
    )

    await expect(speedRampApi("http://vid.mp4", 2, true)).rejects.toThrow(
      "Speed fail",
    )
  })
})

// ---------------------------------------------------------------------------
// loopVideoApi
// ---------------------------------------------------------------------------

describe("loopVideoApi", () => {
  it("sends correct URL and body with repeat mode", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const result = await loopVideoApi("http://vid.mp4", "repeat", 3)

    expect(mock).toHaveBeenCalledWith(
      "/v1/loop-video",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.videoUrl).toBe("http://vid.mp4")
    expect(body.mode).toBe("repeat")
    expect(body.repeatCount).toBe(3)
    expect(result).toEqual({ jobId: "j1" })
  })

  it("sends duration mode with targetDuration", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    await loopVideoApi("http://vid.mp4", "duration", undefined, 60)

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.mode).toBe("duration")
    expect(body.targetDuration).toBe(60)
  })

  it("throws on error response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: { message: "Loop fail" } }),
    )

    await expect(
      loopVideoApi("http://vid.mp4", "repeat", 2),
    ).rejects.toThrow("Loop fail")
  })
})

// ---------------------------------------------------------------------------
// fadeVideoApi
// ---------------------------------------------------------------------------

describe("fadeVideoApi", () => {
  it("sends correct URL and body with fade options", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const result = await fadeVideoApi(
      "http://vid.mp4",
      true,
      1.5,
      true,
      2.0,
      "black",
    )

    expect(mock).toHaveBeenCalledWith(
      "/v1/fade-video",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.videoUrl).toBe("http://vid.mp4")
    expect(body.fadeIn).toBe(true)
    expect(body.fadeInDuration).toBe(1.5)
    expect(body.fadeOut).toBe(true)
    expect(body.fadeOutDuration).toBe(2.0)
    expect(body.color).toBe("black")
    expect(result).toEqual({ jobId: "j1" })
  })

  it("sends white color option", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    await fadeVideoApi("http://vid.mp4", false, 0, true, 1.0, "white")

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.fadeIn).toBe(false)
    expect(body.color).toBe("white")
  })

  it("throws on error response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(500, { error: { message: "Fade fail" } }),
    )

    await expect(
      fadeVideoApi("http://vid.mp4", true, 1, true, 1, "black"),
    ).rejects.toThrow("Fade fail")
  })
})

// ---------------------------------------------------------------------------
// resizeVideoApi
// ---------------------------------------------------------------------------

describe("resizeVideoApi", () => {
  it("sends correct URL and body", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const result = await resizeVideoApi("http://vid.mp4", "16:9", "pad")

    expect(mock).toHaveBeenCalledWith(
      "/v1/resize-video",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.videoUrl).toBe("http://vid.mp4")
    expect(body.targetAspect).toBe("16:9")
    expect(body.method).toBe("pad")
    expect(result).toEqual({ jobId: "j1" })
  })

  it("includes padColor when provided", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    await resizeVideoApi("http://vid.mp4", "9:16", "pad", "#ff0000")

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.padColor).toBe("#ff0000")
  })

  it("includes auth header when session exists", async () => {
    sessionWith("tok-resize")
    const mock = mockFetchJson({ jobId: "j3" })
    vi.stubGlobal("fetch", mock)

    await resizeVideoApi("http://vid.mp4", "1:1", "crop")

    const headers = mock.mock.calls[0][1].headers
    expect(headers.Authorization).toBe("Bearer tok-resize")
  })
})

// ---------------------------------------------------------------------------
// adjustVolumeApi
// ---------------------------------------------------------------------------

describe("adjustVolumeApi", () => {
  it("sends videoUrl when inputType is video", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const result = await adjustVolumeApi(
      "http://vid.mp4",
      "video",
      0.5,
    )

    expect(mock).toHaveBeenCalledWith(
      "/v1/adjust-volume",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.videoUrl).toBe("http://vid.mp4")
    // inputType is NOT sent in body, only used to pick videoUrl vs audioUrl key
    expect(body.volume).toBe(0.5)
    expect(result).toEqual({ jobId: "j1" })
  })

  it("sends audioUrl when inputType is audio", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    await adjustVolumeApi(
      "http://audio.mp3",
      "audio",
      1.5,
      true,
      0.5,
      0.5,
    )

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.audioUrl).toBe("http://audio.mp3")
    // inputType is NOT sent in body, only used to pick audioUrl vs videoUrl key
    expect(body.videoUrl).toBeUndefined()
    expect(body.normalize).toBe(true)
    expect(body.fadeIn).toBe(0.5)
    expect(body.fadeOut).toBe(0.5)
  })

  it("throws on error response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: { message: "Volume fail" } }),
    )

    await expect(
      adjustVolumeApi("http://vid.mp4", "video", 1.0),
    ).rejects.toThrow("Volume fail")
  })
})

// ---------------------------------------------------------------------------
// addCaptionsApi
// ---------------------------------------------------------------------------

describe("addCaptionsApi", () => {
  it("sends correct URL and body with videoUrl and text", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const result = await addCaptionsApi("http://vid.mp4", "Hello world")

    expect(mock).toHaveBeenCalledWith(
      "/v1/add-captions",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.videoUrl).toBe("http://vid.mp4")
    expect(body.text).toBe("Hello world")
    expect(result).toEqual({ jobId: "j1" })
  })

  it("includes all style options when provided", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    await addCaptionsApi(
      "http://vid.mp4",
      "Subtitle text",
      "bold",
      "bottom",
      24,
      "#ffffff",
      "#000000",
    )

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.style).toBe("bold")
    expect(body.position).toBe("bottom")
    expect(body.fontSize).toBe(24)
    expect(body.color).toBe("#ffffff")
    expect(body.backgroundColor).toBe("#000000")
  })

  it("throws on error response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(500, { error: { message: "Caption fail" } }),
    )

    await expect(
      addCaptionsApi("http://vid.mp4", "test"),
    ).rejects.toThrow("Caption fail")
  })
})

// ---------------------------------------------------------------------------
// mixAudioApi
// ---------------------------------------------------------------------------

describe("mixAudioApi", () => {
  it("sends correct URL and body with audioUrls", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const result = await mixAudioApi(["http://a.mp3", "http://b.mp3"])

    expect(mock).toHaveBeenCalledWith(
      "/v1/mix-audio",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.audioUrls).toEqual(["http://a.mp3", "http://b.mp3"])
    expect(result).toEqual({ jobId: "j1" })
  })

  it("includes trackVolumes when array has items", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2" })
    vi.stubGlobal("fetch", mock)

    await mixAudioApi(["http://a.mp3", "http://b.mp3"], [0.8, 1.0])

    const body = JSON.parse(mock.mock.calls[0][1].body as string)
    expect(body.trackVolumes).toEqual([0.8, 1.0])
  })

  it("throws on error response", async () => {
    noSession()
    vi.stubGlobal(
      "fetch",
      mockFetchError(400, { error: { message: "Mix fail" } }),
    )

    await expect(
      mixAudioApi(["http://a.mp3"]),
    ).rejects.toThrow("Mix fail")
  })
})
