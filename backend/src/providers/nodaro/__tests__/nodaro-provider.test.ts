import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — the provider talks to the cloud ONLY through nodaroCloudFetch, and
// registration gates ONLY on isNodaroConnected. Mocking that module isolates
// every test from Supabase + the network.
// ---------------------------------------------------------------------------

const { mockFetch, mockIsConnected } = vi.hoisted(() => ({
  mockFetch: vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(),
  mockIsConnected: vi.fn<() => Promise<boolean>>(),
}))

vi.mock("@/lib/nodaro-connect.js", () => ({
  nodaroCloudFetch: mockFetch,
  isNodaroConnected: mockIsConnected,
}))

vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: vi.fn(() =>
    Promise.resolve({ ai_provider: "kie", cost_markup_percent: 0 }),
  ),
  calculateDisplayCost: vi.fn((cost: number, markup: number) => cost * (1 + markup / 100)),
}))

import { NodaroCloudImageProvider } from "../image.js"
import { NodaroCloudVideoProvider } from "../video.js"
import { registerNodaroCloudProviderIfConnected } from "../index.js"
import { providerRegistry } from "../../registry.js"
import { buildRoutingDecision } from "../../config.js"

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

/** Queue up sequential nodaroCloudFetch responses. */
function queueResponses(...responses: Response[]): void {
  for (const res of responses) {
    mockFetch.mockResolvedValueOnce(res)
  }
}

function completedJob(outputData: Record<string, unknown>): Response {
  return jsonResponse(200, {
    data: { id: "cloud-job-1", status: "completed", progress: 100, output_data: outputData },
  })
}

beforeEach(() => {
  mockFetch.mockReset()
  mockIsConnected.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// 1. Registration gating (registry is a per-file singleton with no
//    unregister — the "not connected" cases MUST run before the final
//    describe registers the provider for real).
// ---------------------------------------------------------------------------

describe("registration gating (not connected)", () => {
  it("does not register when the instance holds no cloud token", async () => {
    mockIsConnected.mockResolvedValue(false)
    await expect(registerNodaroCloudProviderIfConnected()).resolves.toBe(false)
    expect(providerRegistry.getProviderInfo("nodaro")).toBeNull()
  })
})

describe("routing chains while nodaro is unregistered", () => {
  it("keeps every base chain byte-identical to pre-connect behavior", async () => {
    expect((await buildRoutingDecision("image-generation", "flux")).providerChain).toEqual([
      "kie",
      "replicate",
    ])
    expect((await buildRoutingDecision("image-to-video", "minimax")).providerChain).toEqual([
      "kie",
    ])
    expect((await buildRoutingDecision("text-to-video", "kling")).providerChain).toEqual([
      "kie",
    ])
    expect((await buildRoutingDecision("lip-sync", "kling-avatar")).providerChain).toEqual([
      "kie",
    ])
  })
})

// ---------------------------------------------------------------------------
// 2. Provider behavior (direct instances — no registry involvement)
// ---------------------------------------------------------------------------

describe("NodaroCloudImageProvider", () => {
  it("POSTs the cloud generate-image body (camelCase) and resolves the finished imageUrl", async () => {
    queueResponses(
      jsonResponse(200, { jobId: "cloud-job-1" }),
      completedJob({
        imageUrl: "https://r2.example/img-a.png",
        imageUrls: ["https://r2.example/img-a.png", "https://r2.example/img-b.png"],
      }),
    )

    const result = await new NodaroCloudImageProvider().generateImage(
      "a cat",
      ["https://r2.example/ref.png"],
      "nano-banana",
      {
        aspect_ratio: "16:9",
        resolution: "2K",
        negative_prompt: "blurry",
        seed: 42,
        // Unknown provider-internal keys must NOT leak into the route body.
        lora_version: "should-be-dropped",
      },
    )

    expect(result).toEqual({
      url: "https://r2.example/img-a.png",
      extraUrls: ["https://r2.example/img-b.png"],
      cost: null,
    })

    const [createPath, createInit] = mockFetch.mock.calls[0]!
    expect(createPath).toBe("/v1/generate-image")
    expect(JSON.parse(String(createInit?.body))).toEqual({
      prompt: "a cat",
      provider: "nano-banana",
      referenceImageUrls: ["https://r2.example/ref.png"],
      aspectRatio: "16:9",
      resolution: "2K",
      negativePrompt: "blurry",
      seed: 42,
    })
    expect(mockFetch.mock.calls[1]![0]).toBe("/v1/jobs/cloud-job-1")
  })

  it("relays the cloud's 402 insufficient_credits message", async () => {
    queueResponses(
      jsonResponse(402, {
        error: { code: "insufficient_credits", message: "Insufficient credits. Need 10, have 2." },
      }),
    )
    await expect(
      new NodaroCloudImageProvider().generateImage("a cat", undefined, "nano-banana"),
    ).rejects.toThrow("nodaro.ai: Insufficient credits. Need 10, have 2.")
  })

  it("relays the cloud's 403 message and falls back to the revoked hint when absent", async () => {
    queueResponses(jsonResponse(403, { error: { code: "forbidden", message: "Token revoked" } }))
    await expect(
      new NodaroCloudImageProvider().generateImage("a cat", undefined, "nano-banana"),
    ).rejects.toThrow("nodaro.ai: Token revoked")

    queueResponses(jsonResponse(403, {}))
    await expect(
      new NodaroCloudImageProvider().generateImage("a cat", undefined, "nano-banana"),
    ).rejects.toThrow(/may have been revoked/)
  })

  it("maps a bodyless 5xx into a generic operation failure", async () => {
    queueResponses(jsonResponse(500, null))
    await expect(
      new NodaroCloudImageProvider().generateImage("a cat", undefined, "nano-banana"),
    ).rejects.toThrow("nodaro.ai: POST /v1/generate-image failed (500)")
  })

  it("throws the cloud's error_message when the job fails", async () => {
    queueResponses(
      jsonResponse(200, { jobId: "cloud-job-9" }),
      jsonResponse(200, {
        data: { id: "cloud-job-9", status: "failed", error_message: "Provider rejected the prompt" },
      }),
    )
    await expect(
      new NodaroCloudImageProvider().generateImage("a cat", undefined, "nano-banana"),
    ).rejects.toThrow("nodaro.ai: Provider rejected the prompt")
  })

  it("keeps polling through non-terminal statuses (fake timers)", async () => {
    vi.useFakeTimers()
    queueResponses(
      jsonResponse(200, { jobId: "cloud-job-2" }),
      jsonResponse(200, { data: { id: "cloud-job-2", status: "processing", progress: 40 } }),
      completedJob({ imageUrl: "https://r2.example/done.png" }),
    )

    const pending = new NodaroCloudImageProvider().generateImage("a cat", undefined, "flux")
    await vi.advanceTimersByTimeAsync(2_000)
    const result = await pending
    expect(result.url).toBe("https://r2.example/done.png")
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })
})

describe("NodaroCloudVideoProvider", () => {
  it("imageToVideo POSTs /v1/generate-video with full option mapping", async () => {
    queueResponses(
      jsonResponse(200, { jobId: "cloud-vid-1" }),
      completedJob({ videoUrl: "https://r2.example/clip.mp4", thumbnailUrl: "https://r2.example/t.jpg" }),
    )

    const result = await new NodaroCloudVideoProvider().imageToVideo(
      "https://r2.example/frame.png",
      "gentle pan",
      "kling-3.0",
      10,
      "https://r2.example/end.png",
      {
        sound: false,
        mode: "pro",
        multiShots: true,
        multiPrompt: [{ prompt: "shot one", duration: 5 }],
        klingElements: [
          { name: "hero", description: "the hero", element_input_urls: ["https://r2.example/a.png", "https://r2.example/b.png"] },
          { name: "clip", description: "motion ref", element_input_video_urls: ["https://r2.example/m.mp4"] },
        ],
        aspectRatio: "16:9",
        resolution: "1080p",
        seed: 0,
        generateAudio: false,
      },
    )

    expect(result).toEqual({ url: "https://r2.example/clip.mp4", cost: null })

    const [createPath, createInit] = mockFetch.mock.calls[0]!
    expect(createPath).toBe("/v1/generate-video")
    expect(JSON.parse(String(createInit?.body))).toEqual({
      imageUrl: "https://r2.example/frame.png",
      prompt: "gentle pan",
      provider: "kling-3.0",
      duration: 10,
      endFrameUrl: "https://r2.example/end.png",
      sound: false,
      mode: "pro",
      multiShot: true,
      shots: [{ prompt: "shot one", duration: 5 }],
      elements: [
        { name: "hero", description: "the hero", type: "image", urls: ["https://r2.example/a.png", "https://r2.example/b.png"] },
        { name: "clip", description: "motion ref", type: "video", urls: ["https://r2.example/m.mp4"] },
      ],
      aspectRatio: "16:9",
      resolution: "1080p",
      seed: 0,
      generateAudio: false,
    })
  })

  it("textToVideo POSTs /v1/text-to-video without i2v-only fields", async () => {
    queueResponses(
      jsonResponse(200, { jobId: "cloud-vid-2" }),
      completedJob({ videoUrl: "https://r2.example/t2v.mp4" }),
    )

    const result = await new NodaroCloudVideoProvider().textToVideo(
      "a city at night",
      "kling",
      5,
      "9:16",
      { sound: true, grokMode: "fun", motionPrompt: "never-sent-on-t2v" },
    )

    expect(result).toEqual({ url: "https://r2.example/t2v.mp4", cost: null })

    const [createPath, createInit] = mockFetch.mock.calls[0]!
    expect(createPath).toBe("/v1/text-to-video")
    const body = JSON.parse(String(createInit?.body)) as Record<string, unknown>
    expect(body).toEqual({
      prompt: "a city at night",
      provider: "kling",
      duration: 5,
      aspectRatio: "9:16",
      sound: true,
    })
    expect(body).not.toHaveProperty("grokMode")
    expect(body).not.toHaveProperty("motionPrompt")
  })

  it("throws when a completed video job carries no videoUrl", async () => {
    queueResponses(
      jsonResponse(200, { jobId: "cloud-vid-3" }),
      completedJob({}),
    )
    await expect(
      new NodaroCloudVideoProvider().textToVideo("a city", "kling", 5),
    ).rejects.toThrow(/completed but returned no videoUrl/)
  })
})

// ---------------------------------------------------------------------------
// 3. Registration when connected + chain extension (LAST — registers into the
//    per-file registry singleton).
// ---------------------------------------------------------------------------

describe("registration + chain extension when connected", () => {
  it("registers the provider when the instance is connected", async () => {
    mockIsConnected.mockResolvedValue(true)
    await expect(registerNodaroCloudProviderIfConnected()).resolves.toBe(true)

    const info = providerRegistry.getProviderInfo("nodaro")
    expect(info).not.toBeNull()
    // EXPANDED 2026-08-14: the connection used to serve three capabilities and
    // everything else told the user to get their own key — the opposite of
    // "one connection, every model". The cloud already accepted all of these
    // from an instance token (probed live), so the gap was purely this
    // declaration plus the provider methods.
    expect(info!.capabilities).toEqual([
      "image-generation",
      "image-editing",
      "image-to-video",
      "text-to-video",
      "video-to-video",
      "motion-transfer",
      "video-upscale",
      "lip-sync",
      // #644: the last node hardwired to a vendor — routes through the
      // capability walk now, so the connection can serve it too.
      "speech-to-video",
      "text-to-speech",
    ])
    expect(providerRegistry.supportsModel("nodaro", "speech-to-video", "speech-to-video")).toBe(true)
    expect(providerRegistry.supportsModel("nodaro", "image-generation", "nano-banana")).toBe(true)
    expect(providerRegistry.supportsModel("nodaro", "image-to-video", "kling-3.0")).toBe(true)
    expect(providerRegistry.supportsModel("nodaro", "text-to-video", "kling")).toBe(true)
    // Newly covered — these were the "needs your own API key" wall.
    expect(providerRegistry.supportsModel("nodaro", "lip-sync", "kling-avatar")).toBe(true)
    expect(providerRegistry.supportsModel("nodaro", "image-editing", "nano-banana-edit")).toBe(true)
    expect(providerRegistry.supportsModel("nodaro", "video-upscale", "topaz")).toBe(true)
    // Speech joined the set once the handler learned to use it — declaring a
    // capability the worker never routes to would be a lie, so the two land
    // together.
    expect(providerRegistry.supportsModel("nodaro", "text-to-speech", "elevenlabs-v3")).toBe(true)
    // Still NOT claimed: music and the LLM lane call their vendors directly
    // and no handler routes them yet.
    expect(providerRegistry.supportsModel("nodaro", "music-generation", "suno")).toBe(false)
  })

  it("appends nodaro at the END of every connect capability, never in front", async () => {
    expect((await buildRoutingDecision("image-generation", "flux")).providerChain).toEqual([
      "kie",
      "replicate",
      "nodaro",
    ])
    expect((await buildRoutingDecision("image-to-video", "minimax")).providerChain).toEqual([
      "kie",
      "nodaro",
    ])
    expect((await buildRoutingDecision("text-to-video", "kling")).providerChain).toEqual([
      "kie",
      "nodaro",
    ])
    expect((await buildRoutingDecision("lip-sync", "kling-avatar")).providerChain).toEqual([
      "kie",
      "nodaro",
    ])
    expect((await buildRoutingDecision("image-editing", "nano-banana-edit")).providerChain).toEqual([
      "kie",
      "nodaro",
    ])
    // A capability the connection does NOT serve stays untouched — local keys
    // first everywhere, and nothing claims what it can't do.
    expect((await buildRoutingDecision("music-generation", "suno")).providerChain).toEqual([
      "kie",
    ])
  })
})

describe("media re-hosting is narrow on purpose (SSRF containment)", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it("refuses to read a private host that isn't our own storage", async () => {
    vi.doMock("../../../lib/config.js", () => ({
      config: {
        R2_PUBLIC_URL: "http://localhost:3000/storage/nodaro-assets",
        PUBLIC_URL: "http://localhost:3000",
        R2_PUBLIC_FALLBACK_DOMAIN: "",
      },
    }))
    vi.doMock("../../../lib/nodaro-connect.js", () => ({
      getNodaroConnection: async () => ({ accessToken: "ndr_app_test" }),
      nodaroCloudBase: () => "https://cloud.example",
      nodaroCloudFetch: vi.fn(),
    }))
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const { ensureCloudReachableMediaUrl } = await import("../client.js")

    // Cloud metadata service: private, therefore "unreachable by the cloud",
    // and previously that alone was enough for us to fetch it and publish the
    // bytes to a public URL.
    await expect(
      ensureCloudReachableMediaUrl("http://169.254.169.254/latest/meta-data/iam/"),
    ).rejects.toThrow(/doesn't own|can't reach/)
    await expect(ensureCloudReachableMediaUrl("http://192.168.1.50/secret.png")).rejects.toThrow()
    // Nothing was read at all — the refusal happens before any network call.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("leaves public URLs completely alone", async () => {
    vi.doMock("../../../lib/config.js", () => ({
      config: { R2_PUBLIC_URL: "", PUBLIC_URL: "", R2_PUBLIC_FALLBACK_DOMAIN: "" },
    }))
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const { ensureCloudReachableMediaUrl } = await import("../client.js")
    await expect(ensureCloudReachableMediaUrl("https://picsum.photos/200")).resolves.toBe(
      "https://picsum.photos/200",
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
