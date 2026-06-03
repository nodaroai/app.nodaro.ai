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
// Imports (after mocks) — a BREADTH sample of plain-JSON functions across
// categories, deliberately NOT overlapping the functions already covered by
// the other api-*.test.ts files. The point is that an apiJson() refactor that
// changes the common shape (url / method / Content-Type / Authorization /
// body / return passthrough) for ANY category trips a test here.
// ---------------------------------------------------------------------------

import {
  // image / mask
  generateScriptApi,
  generateMask,
  // video
  videoToVideo,
  extractFrameApi,
  extendVideo,
  faceSwapApi,
  videoSfx,
  speechToVideoApi,
  // audio / voice
  textToDialogueApi,
  voiceChangerApi,
  dubbingApi,
  voiceDesignApi,
  forcedAlignmentApi,
  // music / suno
  sunoMusicVideoApi,
  sunoMashupApi,
  // misc job-producing
  webScrape,
  sendWebhookOutput,
  promoteToLibrary,
  // GET-shaped + apiRequest-helper paths
  checkCredits,
  importWorkflow,
  qaCheckApi,
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

/** First fetch call's [url, init]. */
function lastCall(mock: ReturnType<typeof mockFetchJson>) {
  return mock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
}

function parseBody(mock: ReturnType<typeof mockFetchJson>) {
  return JSON.parse(lastCall(mock)[1].body as string)
}

beforeEach(() => {
  mockGetSession.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ===========================================================================
// generateScriptApi  — POST /v1/generate-script (passes params through verbatim)
// ===========================================================================

describe("generateScriptApi", () => {
  it("POSTs the params verbatim with Content-Type + Bearer auth, returns the json", async () => {
    sessionWith("tok-script")
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    const result = await generateScriptApi({
      prompt: "A heist",
      sceneCount: 3,
      tone: "tense",
      provider: "claude",
    })

    const [url, init] = lastCall(mock)
    expect(url).toBe("/v1/generate-script")
    expect(init.method).toBe("POST")
    expect(init.headers["Content-Type"]).toBe("application/json")
    expect(init.headers.Authorization).toBe("Bearer tok-script")
    expect(parseBody(mock)).toEqual({
      prompt: "A heist",
      sceneCount: 3,
      tone: "tense",
      provider: "claude",
    })
    expect(result).toEqual({ jobId: "j1" })
  })

  it("omits the Authorization header when there is no session", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", mock)

    await generateScriptApi({ prompt: "x" })

    expect(lastCall(mock)[1].headers.Authorization).toBeUndefined()
    expect(lastCall(mock)[1].headers["Content-Type"]).toBe("application/json")
  })

  it("throws on error", async () => {
    noSession()
    vi.stubGlobal("fetch", mockFetchError(500, { error: { message: "nope" } }))
    await expect(generateScriptApi({ prompt: "x" })).rejects.toThrow("nope")
  })
})

// ===========================================================================
// generateMask — POST /v1/generate-mask
// ===========================================================================

describe("generateMask", () => {
  it("POSTs imageUrl + prompt + threshold and returns json", async () => {
    sessionWith("tok-mask")
    const mock = mockFetchJson({ jobId: "j-mask" })
    vi.stubGlobal("fetch", mock)

    const result = await generateMask({
      imageUrl: "http://i.png",
      prompt: "the dog",
      threshold: 0.3,
    })

    const [url, init] = lastCall(mock)
    expect(url).toBe("/v1/generate-mask")
    expect(init.method).toBe("POST")
    expect(init.headers["Content-Type"]).toBe("application/json")
    expect(init.headers.Authorization).toBe("Bearer tok-mask")
    expect(parseBody(mock)).toEqual({
      imageUrl: "http://i.png",
      prompt: "the dog",
      threshold: 0.3,
    })
    expect(result).toEqual({ jobId: "j-mask" })
  })
})

// ===========================================================================
// videoToVideo — POST /v1/video-to-video (spreads ...options into body)
// ===========================================================================

describe("videoToVideo", () => {
  it("spreads options into the body and includes userId when given", async () => {
    sessionWith("tok-v2v")
    const mock = mockFetchJson({ jobId: "j2v" })
    vi.stubGlobal("fetch", mock)

    await videoToVideo("http://v.mp4", "make it night", "wan-videoedit", "user-9", {
      resolution: "720p",
      seed: 42,
    })

    const [url, init] = lastCall(mock)
    expect(url).toBe("/v1/video-to-video")
    expect(init.method).toBe("POST")
    expect(init.headers.Authorization).toBe("Bearer tok-v2v")
    expect(parseBody(mock)).toEqual({
      videoUrl: "http://v.mp4",
      prompt: "make it night",
      provider: "wan-videoedit",
      resolution: "720p",
      seed: 42,
      userId: "user-9",
    })
  })

  it("omits undefined prompt/provider (JSON.stringify drops them) when only videoUrl given", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "j2v" })
    vi.stubGlobal("fetch", mock)

    await videoToVideo("http://v.mp4")

    expect(parseBody(mock)).toEqual({ videoUrl: "http://v.mp4" })
  })
})

// ===========================================================================
// extractFrameApi — POST /v1/extract-frame
// ===========================================================================

describe("extractFrameApi", () => {
  it("defaults mode to 'first' and includes timestamp + extras only when provided", async () => {
    sessionWith("tok-frame")
    const mock = mockFetchJson({ jobId: "jf" })
    vi.stubGlobal("fetch", mock)

    await extractFrameApi("http://v.mp4", "timestamp", 2.5, "user-1", {
      frameIndex: 10,
      framesFromEnd: 4,
    })

    const [url, init] = lastCall(mock)
    expect(url).toBe("/v1/extract-frame")
    expect(init.method).toBe("POST")
    expect(parseBody(mock)).toEqual({
      videoUrl: "http://v.mp4",
      mode: "timestamp",
      timestamp: 2.5,
      frameIndex: 10,
      framesFromEnd: 4,
      userId: "user-1",
    })
  })

  it("uses default mode 'first' and a bare body when only videoUrl supplied", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "jf" })
    vi.stubGlobal("fetch", mock)

    await extractFrameApi("http://v.mp4")

    expect(parseBody(mock)).toEqual({ videoUrl: "http://v.mp4", mode: "first" })
  })
})

// ===========================================================================
// extendVideo — POST /v1/extend-video (params passed through verbatim)
// ===========================================================================

describe("extendVideo", () => {
  it("POSTs the params object verbatim", async () => {
    sessionWith("tok-ext")
    const mock = mockFetchJson({ jobId: "je" })
    vi.stubGlobal("fetch", mock)

    await extendVideo({
      kieTaskId: "kie-1",
      prompt: "keep going",
      provider: "veo-extend",
    })

    const [url, init] = lastCall(mock)
    expect(url).toBe("/v1/extend-video")
    expect(init.method).toBe("POST")
    expect(init.headers.Authorization).toBe("Bearer tok-ext")
    expect(parseBody(mock)).toEqual({
      kieTaskId: "kie-1",
      prompt: "keep going",
      provider: "veo-extend",
    })
  })
})

// ===========================================================================
// faceSwapApi — POST /v1/face-swap
// ===========================================================================

describe("faceSwapApi", () => {
  it("POSTs faceImageUrl + videoUrl + provider and returns json", async () => {
    sessionWith("tok-fs")
    const mock = mockFetchJson({ jobId: "jfs" })
    vi.stubGlobal("fetch", mock)

    const result = await faceSwapApi({
      faceImageUrl: "http://face.png",
      videoUrl: "http://v.mp4",
      provider: "akool",
    })

    const [url, init] = lastCall(mock)
    expect(url).toBe("/v1/face-swap")
    expect(init.method).toBe("POST")
    expect(parseBody(mock)).toEqual({
      faceImageUrl: "http://face.png",
      videoUrl: "http://v.mp4",
      provider: "akool",
    })
    expect(result).toEqual({ jobId: "jfs" })
  })

  it("throws on error", async () => {
    noSession()
    vi.stubGlobal("fetch", mockFetchError(400, { error: { message: "bad face" } }))
    await expect(
      faceSwapApi({ faceImageUrl: "f", videoUrl: "v" }),
    ).rejects.toThrow("bad face")
  })
})

// ===========================================================================
// videoSfx — POST /v1/video-sfx (response can be jobId | jobIds | deduped)
// ===========================================================================

describe("videoSfx", () => {
  it("POSTs the payload verbatim and passes the full response through", async () => {
    sessionWith("tok-sfx")
    const mock = mockFetchJson({ jobIds: ["a", "b"] })
    vi.stubGlobal("fetch", mock)

    const result = await videoSfx({ videoUrl: "http://v.mp4", versions: 2 })

    const [url, init] = lastCall(mock)
    expect(url).toBe("/v1/video-sfx")
    expect(init.method).toBe("POST")
    expect(parseBody(mock)).toEqual({ videoUrl: "http://v.mp4", versions: 2 })
    // Whole body returned verbatim (jobIds path).
    expect(result).toEqual({ jobIds: ["a", "b"] })
  })

  it("passes through the deduped short-circuit shape unchanged", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "existing", deduped: true })
    vi.stubGlobal("fetch", mock)

    const result = await videoSfx({ videoUrl: "http://v.mp4" })
    expect(result).toEqual({ jobId: "existing", deduped: true })
  })
})

// ===========================================================================
// speechToVideoApi — POST /v1/speech-to-video
// ===========================================================================

describe("speechToVideoApi", () => {
  it("POSTs the three required fields and only the optional fields provided", async () => {
    sessionWith("tok-s2v")
    const mock = mockFetchJson({ jobId: "js2v" })
    vi.stubGlobal("fetch", mock)

    await speechToVideoApi({
      imageUrl: "http://i.png",
      audioUrl: "http://a.mp3",
      prompt: "talking",
      resolution: "480p",
      seed: 7,
    })

    const [url, init] = lastCall(mock)
    expect(url).toBe("/v1/speech-to-video")
    expect(init.method).toBe("POST")
    expect(parseBody(mock)).toEqual({
      imageUrl: "http://i.png",
      audioUrl: "http://a.mp3",
      prompt: "talking",
      resolution: "480p",
      seed: 7,
    })
  })
})

// ===========================================================================
// textToDialogueApi — POST /v1/text-to-dialogue
// ===========================================================================

describe("textToDialogueApi", () => {
  it("POSTs dialogue array + optional stability/languageCode", async () => {
    sessionWith("tok-dlg")
    const mock = mockFetchJson({ jobId: "jd" })
    vi.stubGlobal("fetch", mock)

    const dialogue = [
      { text: "Hi", voice: "v1" },
      { text: "Bye", voice: "v2" },
    ]
    await textToDialogueApi(dialogue, "user-2", 0.4, "en")

    const [url, init] = lastCall(mock)
    expect(url).toBe("/v1/text-to-dialogue")
    expect(init.method).toBe("POST")
    expect(parseBody(mock)).toEqual({
      dialogue,
      userId: "user-2",
      stability: 0.4,
      languageCode: "en",
    })
  })

  it("omits optional fields when not provided", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "jd" })
    vi.stubGlobal("fetch", mock)

    await textToDialogueApi([{ text: "Hi", voice: "v1" }])

    expect(parseBody(mock)).toEqual({ dialogue: [{ text: "Hi", voice: "v1" }] })
  })
})

// ===========================================================================
// voiceChangerApi — POST /v1/voice-changer
// ===========================================================================

describe("voiceChangerApi", () => {
  it("POSTs audioUrl + voiceId and the numeric/boolean options when set", async () => {
    sessionWith("tok-vc")
    const mock = mockFetchJson({ jobId: "jvc" })
    vi.stubGlobal("fetch", mock)

    await voiceChangerApi("http://a.mp3", "voice-7", "user-3", 0.5, 0.8, 0.3, true)

    const [url, init] = lastCall(mock)
    expect(url).toBe("/v1/voice-changer")
    expect(init.method).toBe("POST")
    expect(parseBody(mock)).toEqual({
      audioUrl: "http://a.mp3",
      voiceId: "voice-7",
      userId: "user-3",
      stability: 0.5,
      similarityBoost: 0.8,
      style: 0.3,
      removeBackgroundNoise: true,
    })
  })
})

// ===========================================================================
// dubbingApi — POST /v1/dubbing
// ===========================================================================

describe("dubbingApi", () => {
  it("POSTs audioUrl + targetLanguage with optional sourceLanguage/numSpeakers", async () => {
    sessionWith("tok-dub")
    const mock = mockFetchJson({ jobId: "jdub" })
    vi.stubGlobal("fetch", mock)

    await dubbingApi("http://a.mp3", "es", "user-4", "en", 2)

    const [url, init] = lastCall(mock)
    expect(url).toBe("/v1/dubbing")
    expect(init.method).toBe("POST")
    expect(parseBody(mock)).toEqual({
      audioUrl: "http://a.mp3",
      targetLanguage: "es",
      userId: "user-4",
      sourceLanguage: "en",
      numSpeakers: 2,
    })
  })
})

// ===========================================================================
// voiceDesignApi — POST /v1/voice-design (spreads ...options into body)
// ===========================================================================

describe("voiceDesignApi", () => {
  it("spreads options into the body alongside text + voiceDescription", async () => {
    sessionWith("tok-vd")
    const mock = mockFetchJson({ jobId: "jvd" })
    vi.stubGlobal("fetch", mock)

    await voiceDesignApi(
      "Read this",
      "a gravelly baritone",
      { model: "eleven_v3", guidanceScale: 5, seed: 11 },
      "user-5",
    )

    const [url, init] = lastCall(mock)
    expect(url).toBe("/v1/voice-design")
    expect(init.method).toBe("POST")
    expect(parseBody(mock)).toEqual({
      text: "Read this",
      voiceDescription: "a gravelly baritone",
      model: "eleven_v3",
      guidanceScale: 5,
      seed: 11,
      userId: "user-5",
    })
  })

  it("works with no options object (just the two required strings)", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "jvd" })
    vi.stubGlobal("fetch", mock)

    await voiceDesignApi("Hi", "soft voice")

    expect(parseBody(mock)).toEqual({ text: "Hi", voiceDescription: "soft voice" })
  })
})

// ===========================================================================
// forcedAlignmentApi — POST /v1/forced-alignment
// ===========================================================================

describe("forcedAlignmentApi", () => {
  it("POSTs audioUrl + transcript (+ userId when given)", async () => {
    sessionWith("tok-fa")
    const mock = mockFetchJson({ jobId: "jfa" })
    vi.stubGlobal("fetch", mock)

    await forcedAlignmentApi("http://a.mp3", "hello world", "user-6")

    const [url, init] = lastCall(mock)
    expect(url).toBe("/v1/forced-alignment")
    expect(init.method).toBe("POST")
    expect(parseBody(mock)).toEqual({
      audioUrl: "http://a.mp3",
      transcript: "hello world",
      userId: "user-6",
    })
  })
})

// ===========================================================================
// sunoMusicVideoApi — POST /v1/suno/music-video
// ===========================================================================

describe("sunoMusicVideoApi", () => {
  it("POSTs taskId + audioId (+ userId)", async () => {
    sessionWith("tok-smv")
    const mock = mockFetchJson({ jobId: "jsmv" })
    vi.stubGlobal("fetch", mock)

    await sunoMusicVideoApi({ taskId: "t1", audioId: "a1", userId: "user-7" })

    const [url, init] = lastCall(mock)
    expect(url).toBe("/v1/suno/music-video")
    expect(init.method).toBe("POST")
    expect(parseBody(mock)).toEqual({ taskId: "t1", audioId: "a1", userId: "user-7" })
  })
})

// ===========================================================================
// sunoMashupApi — POST /v1/suno/mashup (customMode defaults to false in body)
// ===========================================================================

describe("sunoMashupApi", () => {
  it("always sends customMode (default false) and the upload pair", async () => {
    sessionWith("tok-mash")
    const mock = mockFetchJson({ jobId: "jmash" })
    vi.stubGlobal("fetch", mock)

    await sunoMashupApi({ uploadUrlList: ["http://a.mp3", "http://b.mp3"] })

    const [url, init] = lastCall(mock)
    expect(url).toBe("/v1/suno/mashup")
    expect(init.method).toBe("POST")
    expect(parseBody(mock)).toEqual({
      uploadUrlList: ["http://a.mp3", "http://b.mp3"],
      customMode: false,
    })
  })

  it("passes customMode through when explicitly true", async () => {
    noSession()
    const mock = mockFetchJson({ jobId: "jmash" })
    vi.stubGlobal("fetch", mock)

    await sunoMashupApi({
      uploadUrlList: ["http://a.mp3", "http://b.mp3"],
      customMode: true,
      style: "lofi",
    })

    expect(parseBody(mock)).toEqual({
      uploadUrlList: ["http://a.mp3", "http://b.mp3"],
      customMode: true,
      style: "lofi",
    })
  })
})

// ===========================================================================
// webScrape — POST /v1/web-scrape (params passed through verbatim)
// ===========================================================================

describe("webScrape", () => {
  it("POSTs the params verbatim and returns { jobId, json }", async () => {
    sessionWith("tok-scrape")
    const mock = mockFetchJson({ jobId: "jsc", json: { items: [] } })
    vi.stubGlobal("fetch", mock)

    const result = await webScrape({
      actor: "apify-web-scraper" as never,
      url: "http://example.com",
      mode: "page",
    })

    const [url, init] = lastCall(mock)
    expect(url).toBe("/v1/web-scrape")
    expect(init.method).toBe("POST")
    expect(parseBody(mock)).toEqual({
      actor: "apify-web-scraper",
      url: "http://example.com",
      mode: "page",
    })
    expect(result).toEqual({ jobId: "jsc", json: { items: [] } })
  })
})

// ===========================================================================
// sendWebhookOutput — POST /v1/webhook-output/send
// ===========================================================================

describe("sendWebhookOutput", () => {
  it("POSTs { url, payload } and returns the full response", async () => {
    sessionWith("tok-wh")
    const mock = mockFetchJson({
      jobId: "jwh",
      success: true,
      statusCode: 200,
      responseBody: "ok",
    })
    vi.stubGlobal("fetch", mock)

    const result = await sendWebhookOutput({
      url: "http://hook.site/x",
      payload: { a: 1 },
    })

    const [url, init] = lastCall(mock)
    expect(url).toBe("/v1/webhook-output/send")
    expect(init.method).toBe("POST")
    expect(parseBody(mock)).toEqual({
      url: "http://hook.site/x",
      payload: { a: 1 },
    })
    expect(result).toEqual({
      jobId: "jwh",
      success: true,
      statusCode: 200,
      responseBody: "ok",
    })
  })
})

// ===========================================================================
// promoteToLibrary — POST /v1/library/:assetId/promote (id is in the path,
// userId in the body — NOT wrapped in withWorkflowId)
// ===========================================================================

describe("promoteToLibrary", () => {
  it("puts assetId in the path and userId in the body", async () => {
    sessionWith("tok-promote")
    const mock = mockFetchJson({ success: true })
    vi.stubGlobal("fetch", mock)

    const result = await promoteToLibrary("asset-9", "user-8")

    const [url, init] = lastCall(mock)
    expect(url).toBe("/v1/library/asset-9/promote")
    expect(init.method).toBe("POST")
    expect(init.headers["Content-Type"]).toBe("application/json")
    expect(init.headers.Authorization).toBe("Bearer tok-promote")
    expect(parseBody(mock)).toEqual({ userId: "user-8" })
    expect(result).toEqual({ success: true })
  })
})

// ===========================================================================
// checkCredits — GET /v1/credits/check (query params, auth header, NO body /
// NO Content-Type). Representative of the GET shape apiJson must preserve.
// ===========================================================================

describe("checkCredits", () => {
  it("GETs with encoded query params + auth and returns the json", async () => {
    sessionWith("tok-cc")
    const mock = mockFetchJson({ data: { allowed: true, balance: 100 } })
    vi.stubGlobal("fetch", mock)

    const result = await checkCredits("user 1", "gpt-image")

    const [url, init] = lastCall(mock)
    expect(url).toBe("/v1/credits/check?userId=user%201&model=gpt-image")
    // No explicit method -> fetch default GET; the code omits `method`.
    expect(init.method).toBeUndefined()
    // GET path: only the auth headers, no Content-Type.
    expect(init.headers.Authorization).toBe("Bearer tok-cc")
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined()
    expect(result).toEqual({ data: { allowed: true, balance: 100 } })
  })

  it("sends no Authorization header when unauthenticated", async () => {
    noSession()
    const mock = mockFetchJson({ data: { allowed: false } })
    vi.stubGlobal("fetch", mock)

    await checkCredits("u", "m")

    expect(lastCall(mock)[1].headers.Authorization).toBeUndefined()
  })
})

// ===========================================================================
// importWorkflow — POST /v1/workflows/import via the apiRequest() helper.
// Body is reshaped to { projectId, workflow_json } and the returned value is
// unwrapped from { data }. This pins the apiRequest helper contract.
// ===========================================================================

describe("importWorkflow", () => {
  it("reshapes the input to { projectId, workflow_json } and unwraps json.data", async () => {
    sessionWith("tok-imp")
    const imported = {
      id: "wf-new",
      projectId: "proj-1",
      userId: "u",
      name: "Imported",
      nodes: [],
      edges: [],
      settings: {},
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
    }
    const mock = mockFetchJson({ data: imported })
    vi.stubGlobal("fetch", mock)

    const result = await importWorkflow({
      projectId: "proj-1",
      version: 1,
      name: "Imported",
      nodes: [],
      edges: [],
    } as never)

    const [url, init] = lastCall(mock)
    expect(url).toBe("/v1/workflows/import")
    expect(init.method).toBe("POST")
    expect(init.headers["Content-Type"]).toBe("application/json")
    expect(init.headers.Authorization).toBe("Bearer tok-imp")
    // projectId is split out of the body; everything else lands in workflow_json.
    expect(parseBody(mock)).toEqual({
      projectId: "proj-1",
      workflow_json: { version: 1, name: "Imported", nodes: [], edges: [] },
    })
    // Return value is unwrapped from { data }.
    expect(result).toEqual(imported)
  })

  it("throws on error", async () => {
    noSession()
    vi.stubGlobal("fetch", mockFetchError(400, { error: { message: "bad bundle" } }))
    await expect(
      importWorkflow({ projectId: "p", version: 1, nodes: [], edges: [] } as never),
    ).rejects.toThrow("bad bundle")
  })
})

// ===========================================================================
// qaCheckApi — POST /v1/qa-check via apiRequest() + withWorkflowId. Returns the
// json directly (no { data } unwrap). Confirms the apiRequest body path keeps
// the response passthrough that the editor relies on.
// ===========================================================================

describe("qaCheckApi", () => {
  it("POSTs the params and returns the json body directly", async () => {
    sessionWith("tok-qa")
    const mock = mockFetchJson({
      jobId: "jqa",
      score: 0.9,
      approved: true,
      reason: "looks good",
    })
    vi.stubGlobal("fetch", mock)

    const result = await qaCheckApi({ content: "hello", checkType: "quality" })

    const [url, init] = lastCall(mock)
    expect(url).toBe("/v1/qa-check")
    expect(init.method).toBe("POST")
    expect(init.headers["Content-Type"]).toBe("application/json")
    expect(init.headers.Authorization).toBe("Bearer tok-qa")
    expect(parseBody(mock)).toEqual({ content: "hello", checkType: "quality" })
    expect(result).toEqual({
      jobId: "jqa",
      score: 0.9,
      approved: true,
      reason: "looks good",
    })
  })
})
